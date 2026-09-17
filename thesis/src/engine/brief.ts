import { formatValue, type Evaluation } from './breakers/evaluate';
import { PERCENT_METRICS, type BreakerSet, type ThesisBreaker } from './breakers/types';
import type { Decomposition } from './decomposer/types';
import { metricPhrase } from '../lib/glossary';

/**
 * The brief: everything the run found, in the order a person would want it.
 *
 * The closing section used to be a list of gaps. It opened with what could not
 * be measured and closed with what could not be read, and a reader who scrolled
 * to the bottom of a full analysis was handed nothing but caveats. There was no
 * statement of what the work had actually established and no number to take
 * away. "Actionable insight" cannot mean a list of things we failed to do.
 *
 * So the brief now states the bet, counts what it rests on, prints the LIVE
 * READINGS with how much room each one has left, names the single thing most
 * worth watching, and only then gets to the limits. The caveats are still
 * there, last, where caveats belong.
 *
 * PURE FUNCTION OVER DATA THE RUN ALREADY PRODUCED. No model call, by design.
 * A model asked to summarise its own analysis writes fluent prose that drifts
 * from the numbers, and this is the section most likely to be read and
 * repeated. Everything here is derived and therefore checkable.
 */

/** One tripwire as a row a reader can act on: where it is, where it breaks. */
export interface BriefReading {
  /** The metric in the words a person uses for it. */
  label: string;
  /** Plain statement of what would break it. */
  condition: string;
  /** Current reading, formatted. Absent when it could not be read. */
  now?: string;
  /** The level that trips it, formatted. */
  breaksAt?: string;
  /** Distance left, formatted. Absent when it could not be read. */
  room?: string;
  status: 'holding' | 'fired' | 'unreadable';
  /** When this can next change. */
  movesWhen: string;
  /** Why it could not be read, when that is the case. */
  reason?: string;
}

export interface Brief {
  /** What the user is betting on, in their own decomposed words. */
  bet: string[];
  /** The one line summary of what the analysis established. */
  standing: string;
  /** Plain sentences counting what the thesis rests on. */
  foundation: string[];
  /** Live readings, most urgent first. The part worth holding on to. */
  readings: BriefReading[];
  /** The single tripwire most worth watching, if there is one. */
  focus: { line: string; detail: string } | null;
  /** Assumptions no data can settle. */
  judgement: string[];
  /** Honest limits: covered by nothing, or unreadable today. */
  limits: string[];
}

function unit(breaker: ThesisBreaker): string {
  return breaker.kind === 'threshold' && PERCENT_METRICS.has(breaker.metric) ? ' points' : '';
}

function movesWhen(breaker: ThesisBreaker): string {
  if (breaker.cadence === 'periodic') return 'only when the next quarterly report is filed';
  if (breaker.cadence === 'event') return 'only if it is announced';
  return 'at any moment, it follows the live price';
}

/**
 * Distance to the threshold relative to the threshold's own size.
 *
 * Raw headroom is not comparable across metrics: 4.98 points of gross margin
 * and 29 points of annualised volatility are not the same kind of gap. This at
 * least asks the same question of each one. It is a heuristic and the interface
 * says so rather than presenting the ordering as measured fact.
 */
function relativeProximity(evaluation: Evaluation): number | null {
  if (evaluation.headroom === undefined || evaluation.threshold === undefined) return null;
  const scale = Math.abs(evaluation.threshold);
  if (scale === 0) return null;
  return Math.abs(evaluation.headroom) / scale;
}

/**
 * A model statement, made into a sentence.
 *
 * Model output does not reliably end in a full stop and does not reliably start
 * with a capital, and every string here is rendered standalone or at the head of
 * one of our own sentences. Without this the brief prints
 * "the market has priced this in." as a quoted finding, and runs one statement
 * into the next where they are concatenated.
 */
function sentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return trimmed;
  const capitalised = trimmed[0]!.toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function deriveBrief(
  decomposition: Decomposition,
  breakerSet?: BreakerSet,
  evaluations?: Evaluation[],
): Brief {
  const assumptions = decomposition.assumptions;
  const byId = (id: string) => assumptions.find((a) => a.id === id);
  const evals = evaluations ?? [];
  const breakers = breakerSet?.breakers ?? [];

  // ---- the bet ------------------------------------------------------------
  const bet = decomposition.claims.map((c) => sentence(c.statement));

  // ---- what it rests on ---------------------------------------------------
  const total = decomposition.summary.assumptionCount;
  const unstated = decomposition.summary.implicitCount;
  const blindIds = decomposition.summary.unfalsifiableLoadBearing;
  const watched = breakers.length;

  const foundation: string[] = [
    `${total} ${plural(total, 'thing has', 'things have')} to be true for this trade to work.`,
  ];
  if (unstated > 0) {
    foundation.push(
      `${unstated} of ${plural(total, 'it', 'them')} you never wrote down. Your reasoning needs ` +
        `${plural(unstated, 'it', 'them')} anyway.`,
    );
  }
  if (watched > 0) {
    foundation.push(
      `${watched} now ${plural(watched, 'has', 'have')} a specific number attached, so you find ` +
        `out from the data rather than from the price.`,
    );
  }
  if (blindIds.length > 0) {
    foundation.push(
      `${blindIds.length} ${plural(blindIds.length, 'is', 'are')} holding up the whole trade and ` +
        `cannot be measured by anything here.`,
    );
  }

  // ---- the live readings: the part worth taking away ----------------------
  const readings: BriefReading[] = breakers
    .filter((b): b is Extract<ThesisBreaker, { kind: 'threshold' }> => b.kind === 'threshold')
    .map((breaker) => {
      const evaluation = evals.find((e) => e.breakerId === breaker.id);
      const base = {
        // The words a person uses, never the engine's property name.
        label: metricPhrase(breaker.metric),
        condition: sentence(breaker.statement),
        movesWhen: movesWhen(breaker),
      };

      if (!evaluation || evaluation.status === 'undeterminable' || evaluation.status === 'unaffected') {
        return {
          ...base,
          status: 'unreadable' as const,
          breaksAt: formatValue(breaker.metric, breaker.threshold),
          ...(evaluation?.reason ? { reason: sentence(evaluation.reason) } : {}),
        };
      }

      return {
        ...base,
        status: evaluation.status === 'fired' ? ('fired' as const) : ('holding' as const),
        ...(evaluation.observed !== undefined
          ? { now: formatValue(breaker.metric, evaluation.observed) }
          : {}),
        breaksAt: formatValue(breaker.metric, breaker.threshold),
        ...(evaluation.headroom !== undefined
          ? {
              room: `${formatValue(breaker.metric, Math.abs(evaluation.headroom)).replace(/%$/, '')}${unit(breaker)}`,
            }
          : {}),
      };
    })
    // Fired first, then unreadable, then holding. A crossed line outranks
    // everything, and "we could not look" outranks "we looked and it is fine".
    .sort((a, b) => {
      const rank = { fired: 0, unreadable: 1, holding: 2 } as const;
      return rank[a.status] - rank[b.status];
    });

  // ---- the one to watch ---------------------------------------------------
  const holding = evals
    .filter((e) => e.status === 'holding')
    .map((e) => ({ evaluation: e, proximity: relativeProximity(e) }))
    .filter((r): r is { evaluation: Evaluation; proximity: number } => r.proximity !== null)
    .sort((a, b) => a.proximity - b.proximity);

  const closest = holding[0];
  const closestBreaker = closest
    ? breakers.find((b) => b.id === closest.evaluation.breakerId)
    : undefined;

  const focus =
    closest && closestBreaker
      ? {
          line: sentence(closestBreaker.statement),
          detail:
            `It is ${formatValue(
              closest.evaluation.metric ?? 'price',
              Math.abs(closest.evaluation.headroom ?? 0),
            ).replace(/%$/, '')}${unit(closestBreaker)} from tripping, the nearest of the ` +
            `${holding.length} that could be read, and it moves ${movesWhen(closestBreaker)}.`,
        }
      : null;

  // ---- what only the user can settle -------------------------------------
  const judgement = blindIds.map((id) => byId(id)?.statement ?? id).map(sentence);

  // ---- honest limits, last ------------------------------------------------
  const limits: string[] = [];
  const uncovered = (breakerSet?.summary.uncoveredHighLoad ?? []).filter(
    (id) => byId(id)?.testability !== 'none',
  );
  for (const id of uncovered) {
    limits.push(
      `${sentence(byId(id)?.statement ?? id)} This one could have been measured, but no tripwire ` +
        `was built for it.`,
    );
  }
  for (const evaluation of evals.filter((e) => e.status === 'undeterminable')) {
    const breaker = breakers.find((b) => b.id === evaluation.breakerId);
    limits.push(
      `${sentence(breaker?.statement ?? 'A tripwire')} could not be read today. ` +
        `${evaluation.reason ? sentence(evaluation.reason) : ''} Treat it as unknown rather than as fine.`.trim(),
    );
  }

  // ---- the one line ------------------------------------------------------
  const fired = evals.filter((e) => e.status === 'fired').length;
  const standing =
    fired > 0
      ? `${fired} of your tripwires ${plural(fired, 'has', 'have')} already been crossed.`
      : watched === 0
        ? 'Nothing here can be watched automatically yet.'
        : `Nothing has been crossed. ${watched} ${plural(watched, 'number is', 'numbers are')} ` +
          `being checked against real filings and prices from here on.`;

  return { bet, standing, foundation, readings, focus, judgement, limits };
}
