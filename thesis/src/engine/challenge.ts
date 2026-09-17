import { getLlm } from '../llm/index';
import { extractJson } from '../llm/json';
import { checkDataNeeded } from './decomposer/capabilities';
import { downgradeUntestable, validateDecomposition } from './decomposer/validate';
import { summarise, type Assumption, type Decomposition } from './decomposer/types';
import { summariseBreakers, type BreakerSet } from './breakers/types';

/**
 * The second opinion, on a different model family.
 *
 * ## Why this stage exists
 *
 * The decomposer's most valuable output is the IMPLICIT assumption: the load a
 * user is carrying without having noticed. Its most likely failure is missing
 * one, and a missed load-bearing assumption is the single worst outcome this
 * product can produce, because the report then looks complete while the real
 * risk is absent from it.
 *
 * Asking the same model to check its own work does not help much. It reaches
 * for the same associations on the second pass as on the first, so the
 * assumptions it missed tend to stay missed.
 *
 * So this runs on Qwen while everything else runs on Gemini. The claim that
 * supports is narrow and worth stating exactly: **a different family does not
 * make the two independent.** They share training data, they share the
 * internet, and they will share blind spots. What it reduces is dependence on
 * one model's particular reasoning path, which is a real but partial gain.
 *
 * ## Why it fails open
 *
 * Qwen runs through Bitget's hackathon gateway, whose quota is not published
 * and whose availability is not ours. A challenge that cannot run must never
 * take the analysis down with it: the user still gets the full decomposition,
 * the breakers and every evaluation. The stage reports that it did not run,
 * which is honest, and the pipeline continues.
 *
 * That is also why the challenger cannot touch claims or edit existing
 * assumptions. It may only ADD. A second model silently rewriting the first
 * one's output would make the result unattributable, and nothing on screen
 * could tell you which model said what.
 */

/**
 * How long the second reader gets before the run moves on without it.
 *
 * Below the client's 120 second default, because that default is sized for a
 * model failing rather than for a person watching.
 *
 * The gateway is slow and highly variable, measured rather than guessed. Trivial
 * completions return in about 3s. Real analytical generation measured 17.5s at
 * best, and repeatedly exceeded 30s, 60s and 110s on identical input. Prompt
 * SIZE is not the cause: a 650 character filler prompt answers in 8.5s while a
 * shorter prompt demanding real reasoning hangs. What costs time here is
 * generating tokens, which is why the output contract above is capped at two
 * terse assumptions.
 *
 * Forty-five seconds leaves room for a genuine answer while keeping the worst
 * case survivable for someone watching. The stage is optional by design, so
 * giving up is cheap.
 */
export const CHALLENGE_TIMEOUT_MS = Number(process.env.CHALLENGE_TIMEOUT_MS ?? 45_000);

/*
  The system prompt is tiny, and that is a measured constraint rather than a
  style choice.

  Bitget's Qwen gateway will not serve this workload with a large system
  message. Held everything else equal and varied only the two message sizes:

    system   77 chars + user 321 chars   ->  answered in 34.5s
    system   77 chars + user 652 chars   ->  answered in 15.3s
    system 1114 chars + user 321 chars   ->  no response, timed out at 40s
    system 1114 chars + user 652 chars   ->  no response, timed out at 40s

  USER length does not matter. SYSTEM length does, and the ceiling sits
  somewhere under a kilobyte. So every instruction that would normally live in
  a system prompt is carried in the user message instead, where the same
  content costs nothing. The guidance is not reduced, only relocated.
*/
export const CHALLENGE_SYSTEM =
  'You find load-bearing assumptions an earlier analysis missed. Reply with one json object only.';

const CHALLENGE_GUIDANCE = `Find at most TWO load-bearing assumptions this thesis rests on that are NOT listed below. Fewer is better; an empty list is a good answer. Never restate a listed one. Under 25 words each.

testability: fundamental | price | valuation | liquidity | event | none. Never cite analyst estimates, forward multiples, price targets or market share; use "none".

Reply only:
{"assumptions":[{"statement":"...","origin":"implicit","supports":["C1"],"loadBearing":"high|medium|low","testability":"...","dataNeeded":"...","whyMissed":"..."}]}`;

export function buildChallengeUser(d: Decomposition): string {
  /*
    Context is trimmed to statements alone. Ids, load ratings and testability
    tags are useful to a reader and cost prompt budget this gateway does not
    have, and the challenger does not need them: it is asked what is ABSENT,
    not to reason about what is present.
  */
  const lines = [
    CHALLENGE_GUIDANCE,
    '',
    `${d.ticker}, ${d.horizon ?? 'no stated horizon'}. Thesis: ${d.thesis.slice(0, 320)}`,
    '',
    'Already found:',
  ];
  for (const a of d.assumptions) lines.push(`- ${a.statement}`);
  return lines.join('\n');
}

export interface ChallengeResult {
  /** Assumptions the second model added. Empty is a normal, good outcome. */
  added: Assumption[];
  /** Why each addition was missed, keyed by assumption id. */
  whyMissed: Record<string, string>;
  /** The model that ran, or null when the stage could not run at all. */
  model: string | null;
  latencyMs: number;
  /** Set when the challenge did not run. The analysis is still complete. */
  skipped?: string;
}

/** Loose comparison, so "margins keep expanding" does not arrive twice. */
function normalise(statement: string): string {
  return statement
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|a|an|is|are|will|be|of|to|and|that|this|it|in|on|for|remains?|stays?|continues? to)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Rough overlap between two statements, 0 to 1, on shared significant words. */
function overlap(a: string, b: string): number {
  const left = new Set(normalise(a).split(' ').filter((w) => w.length > 3));
  const right = new Set(normalise(b).split(' ').filter((w) => w.length > 3));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / Math.min(left.size, right.size);
}

/**
 * Run the second reader over a finished decomposition.
 *
 * Never throws. Every failure path returns a result carrying `skipped`, because
 * the caller is mid-analysis and the user is owed the work that already
 * succeeded.
 */
export async function challenge(d: Decomposition): Promise<ChallengeResult> {
  const started = Date.now();

  let llm;
  try {
    llm = getLlm('bear');
  } catch (err) {
    // No key configured. Expected on a machine without the sponsor gateway.
    return {
      added: [],
      whyMissed: {},
      model: null,
      latencyMs: 0,
      skipped: (err as Error).message,
    };
  }

  try {
    const result = await llm.complete(
      [
        { role: 'system', content: CHALLENGE_SYSTEM },
        { role: 'user', content: buildChallengeUser(d) },
      ],
      /*
        json mode is deliberately OFF for this seat.

        The gateway rejects response_format json_object unless the messages
        contain the literal word "json", and returns
        `InternalError.Algo.InvalidParameter: 'messages' must contain the word
        'json'`. Worse than the rejection is what happens on longer analytical
        prompts, where the same request stops returning at all: measured hangs
        past 30s, 60s and 110s on input that answers in 17 to 21 seconds with
        the flag off.

        Nothing is lost by dropping it. `extractJson` already tolerates fences
        and stray prose, because every other seat has always relied on it.
      */
      { temperature: 0.4, json: false, maxTokens: 700, timeoutMs: CHALLENGE_TIMEOUT_MS },
    );

    const parsed = extractJson(result.text) as { assumptions?: unknown };
    const proposed = Array.isArray(parsed.assumptions) ? parsed.assumptions : [];
    if (proposed.length === 0) {
      return { added: [], whyMissed: {}, model: llm.model, latencyMs: Date.now() - started };
    }

    // Keep the challenger's own words about why it was missed. They do not
    // survive validation, which only knows the Assumption shape.
    const reasons = new Map<string, string>();
    const renumbered = proposed.map((raw, i) => {
      const record = (raw ?? {}) as Record<string, unknown>;
      const id = `A${d.assumptions.length + i + 1}`;
      const why = typeof record.whyMissed === 'string' ? record.whyMissed : '';
      if (why) reasons.set(id, why);
      // Origin is forced. Anything the first pass missed is by definition not
      // something the user spelled out, whatever the challenger labels it.
      return { ...record, id, origin: 'implicit' };
    });

    /*
      Validated through the SAME validator as the first pass, with the existing
      claims supplied rather than asked for.

      Two reasons. A second copy of these rules would drift, and the last time
      this codebase kept a hand-written duplicate of a union it silently
      downgraded a load-bearing assumption to untestable. And supplying the
      claims ourselves means the challenger cannot edit them: it is given no
      route to change what the first pass concluded, only to add to it.
    */
    const validated = validateDecomposition(
      { claims: d.claims, assumptions: renumbered, ambiguities: [] },
      result.text,
    );

    const corrected = downgradeUntestable(validated.assumptions, validated.softProblems);

    // A capability breach that survives repair is dropped rather than shown.
    // There is no repair round here, so the check is the last line of defence.
    const clean = corrected.filter(
      (a) => a.testability === 'none' || !a.dataNeeded || checkDataNeeded(a.dataNeeded).length === 0,
    );

    // Drop anything the first pass already said in other words.
    const added = clean.filter((candidate) =>
      d.assumptions.every((existing) => overlap(existing.statement, candidate.statement) < 0.6),
    );

    const whyMissed: Record<string, string> = {};
    for (const a of added) {
      const why = reasons.get(a.id);
      if (why) whyMissed[a.id] = why;
    }

    return { added, whyMissed, model: llm.model, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      added: [],
      whyMissed: {},
      model: llm.model,
      latencyMs: Date.now() - started,
      skipped: (err as Error).message,
    };
  }
}

/**
 * Fold the additions back in, so everything downstream sees one list.
 *
 * The breaker generator, the report and the store all read `assumptions`. If
 * the additions lived somewhere else they would be decorative: no tripwire
 * would be written for them, and the whole point is that they get watched like
 * any other.
 *
 * The summary is recomputed rather than adjusted, since it counts implicit and
 * unfalsifiable load-bearing assumptions and both move here.
 */
export function merge(d: Decomposition, result: ChallengeResult): Decomposition {
  if (result.added.length === 0) return d;
  const assumptions = [...d.assumptions, ...result.added];
  return { ...d, assumptions, summary: summarise(d.claims, assumptions) };
}


/**
 * Fold a second breaker set into the first.
 *
 * The challenge now lands after the main tripwires have been generated and
 * evaluated, so its additions get their own small generation pass and have to
 * be merged in rather than produced together.
 *
 * ⚠ The additions are RENUMBERED. A separate generation call starts counting
 * at B1 again, so pasting the two lists together would produce two breakers
 * called B1, and every evaluation is keyed by breaker id. The base set keeps
 * its ids untouched, which matters because its evaluations have already been
 * emitted and are on screen.
 *
 * The summary is recomputed rather than added up: it counts cadences and
 * uncovered high-load assumptions, and both change when a set grows.
 */
export function mergeBreakers(
  base: BreakerSet,
  extra: BreakerSet,
  assumptions: Assumption[],
): BreakerSet {
  if (extra.breakers.length === 0 && extra.uncovered.length === 0) return base;

  const renumbered = extra.breakers.map((breaker, i) => ({
    ...breaker,
    id: `B${base.breakers.length + i + 1}`,
  }));
  const breakers = [...base.breakers, ...renumbered];
  const uncovered = [...base.uncovered, ...extra.uncovered];

  return {
    ...base,
    breakers,
    uncovered,
    summary: summariseBreakers(breakers, uncovered, assumptions),
    meta: {
      model: base.meta.model,
      latencyMs: base.meta.latencyMs + extra.meta.latencyMs,
      generatedAt: new Date().toISOString(),
    },
  };
}
