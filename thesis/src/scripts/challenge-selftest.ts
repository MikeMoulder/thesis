/**
 * Self-test for the second reader's merge logic.
 *
 *   npm run challenge:selftest
 *
 * No model and no network. The model call itself is not the risky part here:
 * it fails open, and a failure is visible. The dangerous code is what happens
 * when the challenge SUCCEEDS, because the additions arrive after the main
 * tripwires have already been generated, evaluated and put on screen.
 *
 * Two ways that goes wrong quietly. Ids can collide, because a second
 * generation pass starts counting at B1 again and every evaluation is keyed by
 * breaker id, so a duplicate silently attaches one breaker's reading to
 * another. And the challenger can restate an assumption the first pass already
 * found, which pads the report with a finding that is not one.
 *
 * Both produce output that renders perfectly and is wrong.
 */
import { challenge, mergeBreakers } from '../engine/challenge';
import { summarise, type Assumption, type Decomposition } from '../engine/decomposer/types';
import type { BreakerSet, Cadence, Metric, ThesisBreaker } from '../engine/breakers/types';
import { OpenAICompatibleClient, __setLlm, type LlmClient } from '../llm/index';
import { IDLE_RUN, applyEvent } from '../lib/run-client';

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function breaker(id: string, ref: string, metric: Metric, cadence: Cadence = 'continuous'): ThesisBreaker {
  return {
    id,
    assumptionRef: ref,
    statement: `${metric} moves`,
    severity: 'high',
    severityInherited: true,
    kind: 'threshold',
    metric,
    operator: '<',
    threshold: 1,
    cadence,
  } as ThesisBreaker;
}

function set(breakers: ThesisBreaker[], uncovered: BreakerSet['uncovered'] = []): BreakerSet {
  return {
    ticker: 'TEST',
    breakers,
    uncovered,
    summary: {
      total: breakers.length,
      byCadence: { continuous: 0, event: 0, periodic: 0 },
      quietUntilEarnings: false,
      uncoveredHighLoad: [],
    },
    meta: { model: 'stub', latencyMs: 100, generatedAt: '2026-09-17T00:00:00Z' },
  };
}

function assumption(id: string, loadBearing: Assumption['loadBearing'], testability: Assumption['testability']): Assumption {
  return {
    id,
    statement: `assumption ${id}`,
    origin: 'implicit',
    supports: ['C1'],
    loadBearing,
    testability,
  } as Assumption;
}

// ---------------------------------------------------------------------------
// Renumbering. The reason this function exists.
// ---------------------------------------------------------------------------

console.log('\nids must not collide');

const base = set([breaker('B1', 'A1', 'grossMargin'), breaker('B2', 'A2', 'exitDepthUsd')]);
// A fresh generation pass counts from B1 again. This is the real input shape.
const extra = set([breaker('B1', 'A3', 'trailingPE'), breaker('B2', 'A4', 'volatility90d')]);
const assumptions = [
  assumption('A1', 'high', 'fundamental'),
  assumption('A2', 'high', 'liquidity'),
  assumption('A3', 'medium', 'valuation'),
  assumption('A4', 'low', 'price'),
];

const merged = mergeBreakers(base, extra, assumptions);

check('every id in the merged set is unique', new Set(merged.breakers.map((b) => b.id)).size === merged.breakers.length, merged.breakers.map((b) => b.id).join(','));
check('the merged set holds every breaker from both', merged.breakers.length === 4, String(merged.breakers.length));
check(
  'the additions are renumbered to continue the sequence',
  merged.breakers.map((b) => b.id).join(',') === 'B1,B2,B3,B4',
  merged.breakers.map((b) => b.id).join(','),
);
check(
  'the ORIGINAL ids are untouched, because their evaluations are already on screen',
  merged.breakers[0]!.id === 'B1' && merged.breakers[1]!.id === 'B2',
);
check(
  'renumbering does not move a breaker onto a different assumption',
  merged.breakers[2]!.assumptionRef === 'A3' && merged.breakers[3]!.assumptionRef === 'A4',
  `${merged.breakers[2]!.assumptionRef}, ${merged.breakers[3]!.assumptionRef}`,
);
check(
  'and it does not change what a breaker measures',
  merged.breakers[2]!.kind === 'threshold' &&
    (merged.breakers[2] as { metric: Metric }).metric === 'trailingPE',
);

// ---------------------------------------------------------------------------
// The summary counts the WHOLE set, not just the first half
// ---------------------------------------------------------------------------

console.log('\nthe summary is recomputed, not carried over');

check('total reflects both sets', merged.summary.total === 4, String(merged.summary.total));
check(
  'cadences are counted across the merged list',
  merged.summary.byCadence.continuous === 4,
  JSON.stringify(merged.summary.byCadence),
);

const withUncovered = mergeBreakers(
  base,
  set([], [{ assumptionId: 'A5', statement: 'nothing can read this', reason: 'no data' }]),
  [...assumptions, assumption('A5', 'high', 'none')],
);
check(
  'an addition nothing can watch is carried into uncovered',
  withUncovered.uncovered.some((u) => u.assumptionId === 'A5'),
);
check(
  'and a high-load one nothing watches reaches the blind spot list',
  withUncovered.summary.uncoveredHighLoad.includes('A5'),
  withUncovered.summary.uncoveredHighLoad.join(','),
);

// ---------------------------------------------------------------------------
// Nothing to merge
// ---------------------------------------------------------------------------

console.log('\nan empty second pass changes nothing');

const untouched = mergeBreakers(base, set([]), assumptions);
check('the base set is returned as-is', untouched === base);
check('no id is rewritten when there is nothing to add', untouched.breakers.map((b) => b.id).join(',') === 'B1,B2');

// ---------------------------------------------------------------------------
// Latency is additive, because two calls really were made
// ---------------------------------------------------------------------------

console.log('\nmeta');

check(
  'latency adds up across both generation passes',
  merged.meta.latencyMs === 200,
  String(merged.meta.latencyMs),
);
check('the ticker survives the merge', merged.ticker === 'TEST');

// ---------------------------------------------------------------------------
// What a seat that did not answer is allowed to claim
//
// Until 17 Sep 2026 a timed-out challenge still reported its model name, and
// run.ts folded that straight into the list of models shown under a finished
// analysis. The footer read "gemini-3.5-flash-lite + qwen3.8-max" on runs where
// Qwen contributed nothing at all.
//
// It rendered perfectly and it was wrong, which is the class of bug this whole
// file exists for.
// ---------------------------------------------------------------------------

function seat(behaviour: () => Promise<string>): LlmClient {
  return {
    model: 'test-model',
    label: 'bear/test-model',
    complete: async () => ({ text: await behaviour(), model: 'test-model', latencyMs: 1 }),
  };
}

function decomposition(): Decomposition {
  const claims = [{ id: 'C1', statement: 'It goes up.', origin: 'stated' as const }];
  const assumptions: Assumption[] = [
    {
      id: 'A1',
      statement: 'Margins hold',
      origin: 'stated',
      supports: ['C1'],
      loadBearing: 'high',
      testability: 'fundamental',
      dataNeeded: 'Gross margin from the next filed quarter',
      rationale: 'Stated outright',
    },
  ];
  return {
    ticker: 'TEST',
    thesis: 'A thesis long enough to be worth attacking, stated plainly.',
    claims,
    assumptions,
    ambiguities: [],
    summary: summarise(claims, assumptions),
    meta: { model: 'test', latencyMs: 0, decomposedAt: new Date().toISOString() },
  };
}

console.log('\na second opinion that never arrives');

__setLlm('bear', seat(() => Promise.reject(new Error('Could not reach bear/test-model'))));
const dead = await challenge(decomposition());

check('no model is named', dead.model === null, String(dead.model));
check('the reason is carried', Boolean(dead.skipped), dead.skipped ?? 'none');
check('the reason names the seat', (dead.skipped ?? '').includes('bear/test-model'));
check('nothing is added', dead.added.length === 0);
check('whyMissed stays empty', Object.keys(dead.whyMissed).length === 0);

console.log('\na second opinion that answers');

__setLlm(
  'bear',
  seat(() =>
    Promise.resolve(
      JSON.stringify({
        assumptions: [
          {
            statement: 'Demand does not pull forward from next year',
            origin: 'stated',
            supports: ['C1'],
            loadBearing: 'high',
            testability: 'fundamental',
            dataNeeded: 'Revenue from the next filed quarter',
            whyMissed: 'The thesis treats demand as a level, not a schedule',
          },
        ],
      }),
    ),
  ),
);
const answered = await challenge(decomposition());

check('the model that answered is named', answered.model === 'test-model', String(answered.model));
check('nothing is marked skipped', answered.skipped === undefined);
check('the addition survives validation', answered.added.length === 1, String(answered.added.length));
check(
  'it is numbered after the assumptions that already existed',
  answered.added[0]?.id === 'A2',
  answered.added[0]?.id,
);
check(
  'origin is forced to implicit, whatever the challenger claimed',
  answered.added[0]?.origin === 'implicit',
  answered.added[0]?.origin,
);
check('why it was missed is kept', Boolean(answered.whyMissed.A2));

__setLlm('bear', null);

// ---------------------------------------------------------------------------
// The flag that makes this seat work at all
//
// enable_thinking rides in on opts.extra, which is an untyped bag. The bag has
// to be able to add a field the gateway needs, and must NOT be able to change
// which model answers or what it is asked.
// ---------------------------------------------------------------------------

console.log('\nthe request the gateway actually receives');

const realFetch = globalThis.fetch;
let sent: Record<string, unknown> = {};
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  sent = JSON.parse(init.body) as Record<string, unknown>;
  return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
}) as unknown as typeof fetch;

await new OpenAICompatibleClient({
  baseUrl: 'http://example.invalid/v1',
  apiKey: 'unused',
  model: 'the-real-model',
  label: 'test/seat',
}).complete([{ role: 'user', content: 'the real question' }], {
  temperature: 0.4,
  maxTokens: 700,
  extra: {
    enable_thinking: false,
    // Everything below is a hijack attempt, and every one of them must fail.
    model: 'HIJACKED',
    messages: [{ role: 'user', content: 'HIJACKED' }],
    temperature: 9.9,
    max_tokens: 1,
  },
});

globalThis.fetch = realFetch;

check('the provider flag arrives', sent.enable_thinking === false);
check('extra cannot change the model', sent.model === 'the-real-model', String(sent.model));
check(
  'extra cannot change the messages',
  JSON.stringify(sent.messages) === JSON.stringify([{ role: 'user', content: 'the real question' }]),
);
check('extra cannot change the temperature', sent.temperature === 0.4, String(sent.temperature));
check('extra cannot change max_tokens', sent.max_tokens === 700, String(sent.max_tokens));

// ---------------------------------------------------------------------------
// A stage that says something keeps what it said
//
// applyEvent used to keep only the state and drop the detail, so a stage that
// gave up rendered as a tick beside four that had succeeded.
// ---------------------------------------------------------------------------

console.log('\nwhat the client remembers about a stage');

const skipped = applyEvent(IDLE_RUN, {
  type: 'stage',
  id: 'challenge',
  state: 'done',
  ms: 20_000,
  detail: 'skipped: Could not reach bear/test-model',
});

check('the state is recorded', skipped.stages.challenge === 'done');
check('the detail is recorded too', Boolean(skipped.stageDetail.challenge));
check(
  'it is filed under the stage that said it',
  (skipped.stageDetail.challenge ?? '').startsWith('skipped:'),
);

const quiet = applyEvent(skipped, { type: 'stage', id: 'evaluate', state: 'done', ms: 5 });
check('a silent stage does not erase an earlier detail', Boolean(quiet.stageDetail.challenge));
check('a silent stage adds nothing of its own', quiet.stageDetail.evaluate === undefined);
check('IDLE_RUN starts with no details', Object.keys(IDLE_RUN.stageDetail).length === 0);

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
