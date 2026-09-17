import { PERCENT_METRICS, type Cadence, type Metric, type ThesisBreaker } from './breakers/types';
import type { BreakerSet } from './breakers/types';
import type { Evaluation } from './breakers/evaluate';

/**
 * Turning a thesis into a signal, by DERIVATION rather than generation.
 *
 * ## The distinction this file exists to defend
 *
 * Asking a model for an entry, a stop and a size is easy, and the answer is
 * always plausible and never traceable. A number a model invented cannot be
 * checked against anything, and "stop at 164" is exactly the kind of output a
 * reader assumes was computed.
 *
 * Nothing here is invented. Every figure below already exists on the thesis as
 * a measurement, and this file only rearranges them into the shape a trade
 * needs:
 *
 *   INVALIDATION   the tripwires already say where the user is wrong. A
 *                  price tripwire IS a stop level, it was just never
 *                  expressed as one.
 *   SIZE           exitDepthUsd already measures the dollars actually bid.
 *                  A position larger than that cannot leave at the stop.
 *   RISK           the gap between the live price and the nearest
 *                  invalidation, which is the only honest definition of what
 *                  a position risks before its own reasoning says to quit.
 *
 * Model calls: zero. Same as the preset stress tests, and for the same reason.
 * That is the return on keeping breakers structured instead of as prose.
 *
 * ## The finding that matters most is usually a refusal
 *
 * A thesis whose tripwires are all fundamental has NO price at which it is
 * wrong. Gross margin moves when a 10-Q is filed, four times a year. Such a
 * thesis cannot be given a stop, and this says so rather than inventing one.
 * Most tools in this space will happily print a number there.
 */

/**
 * The share of visible resting depth a position may occupy.
 *
 * exitDepthUsd counts dollars bid within 1% of reference. Taking all of it
 * means eating that entire band on the way out, so the exit price becomes the
 * bottom of the measured window rather than anywhere near the top. A fifth
 * leaves the rest of the band as the buffer that makes the stop reachable.
 *
 * Exported because a number this consequential should be visible and arguable,
 * not buried in an expression.
 */
export const MAX_DEPTH_PARTICIPATION = 0.2;

export type Side = 'long' | 'short' | 'flat';

/**
 * Whether an invalidation level stays where it is.
 *
 * This is not bookkeeping. A level derived from a rolling window is only true
 * today, and a user who writes it on a sticky note is working from a number
 * that expired overnight. Saying which kind you are looking at is the
 * difference between a stop and a reminder to recompute.
 */
export type LevelStability =
  /** An absolute price condition. It is where it is. */
  | 'fixed'
  /** Anchored to the high, so it rises whenever the stock makes a new one. */
  | 'moves-with-high'
  /** Anchored to a rolling window, so it moves every single day. */
  | 'moves-daily';

export interface InvalidationLevel {
  breakerId: string;
  metric: Metric;
  statement: string;
  /** The price at which this breaker fires. */
  price: number;
  /** Signed distance from the live price, as a percent of it. */
  distancePct: number;
  stability: LevelStability;
  /** How this price was arrived at, in full. Shown, never hidden. */
  derivation: string;
}

export interface SizeCap {
  /** Dollars actually bid within 1% of reference, as measured. */
  exitDepthUsd: number;
  participation: number;
  maxNotionalUsd: number;
  /** Cost of leaving at the reference notional, when the book can absorb it. */
  slippageBps?: number;
  note: string;
}

export interface RiskToInvalidation {
  level: InvalidationLevel;
  /** Percent of position value at risk before the thesis says to quit. */
  riskPct: number;
  /** That percentage applied to the size cap, in dollars. */
  riskUsdAtMaxSize?: number;
}

export interface Monitorability {
  continuous: number;
  periodic: number;
  event: number;
  /** High-load assumptions nothing watches at all. */
  uncoveredHighLoad: number;
  note: string;
}

export interface DerivedSignal {
  ticker: string;
  rToken: string | null;
  side: Side;
  /** The live price everything here is measured against. */
  reference: number | null;
  /** Can this be traded on Bitget at all, and can it be left again. */
  tradable: boolean;
  headline: string;
  levels: InvalidationLevel[];
  nearest: RiskToInvalidation | null;
  size: SizeCap | null;
  monitorability: Monitorability;
  /** Everything that stops this being a recommendation. Never empty. */
  caveats: string[];
  meta: { modelCalls: 0; derivedAt: string };
}

// ---------------------------------------------------------------------------

export interface SignalInput {
  ticker: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  breakerSet: BreakerSet;
  /** Live evaluations, which carry the observed readings the maths needs. */
  evaluations: Evaluation[];
  /** Live price of the underlying. Null when it could not be read. */
  price: number | null;
  /**
   * Resting bid depth, read directly rather than inferred from a tripwire.
   *
   * The first version of this scanned the evaluations for an exitDepthUsd
   * reading, which meant a thesis without a liquidity tripwire silently got no
   * size cap at all. Both live theses are exactly that shape, so the single
   * most valuable number in a signal was missing from every real case while
   * every test passed. Whether a position can be closed is a fact about the
   * INSTRUMENT, not about what the user happened to write down.
   *
   * Falls back to the evaluations when omitted, so the function stays pure and
   * testable without a data source.
   */
  exitDepthUsd?: number | null;
  exitSlippageBps?: number | null;
  rTokenSymbol?: string | null;
  now?: () => number;
}

function sideFor(direction: SignalInput['direction']): Side {
  if (direction === 'bullish') return 'long';
  if (direction === 'bearish') return 'short';
  return 'flat';
}

function round(value: number, dp = 2): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

function money(value: number): string {
  if (value >= 1_000_000) return `$${round(value / 1_000_000, 2)}M`;
  if (value >= 1_000) return `$${round(value / 1_000, 1)}k`;
  return `$${round(value, 2)}`;
}

/**
 * The price at which one breaker fires, when that can be derived at all.
 *
 * Three of the five price metrics imply a level and two do not. The two that
 * do not are left out rather than approximated, because a volatility threshold
 * has no price and any number produced for it would be fiction.
 *
 * The derivations for the rolling metrics run BACKWARDS through the reading:
 * the evaluation already tells us the current percentage, so the anchor the
 * percentage was measured from can be recovered, and the threshold applied to
 * that same anchor.
 */
function levelFor(
  breaker: ThesisBreaker,
  evaluation: Evaluation | undefined,
  price: number,
): InvalidationLevel | null {
  if (breaker.kind !== 'threshold') return null;

  const base = {
    breakerId: breaker.id,
    metric: breaker.metric,
    statement: breaker.statement,
  };

  if (breaker.metric === 'price') {
    return {
      ...base,
      price: round(breaker.threshold),
      distancePct: round(((breaker.threshold - price) / price) * 100),
      stability: 'fixed',
      derivation: `the tripwire names an absolute price of ${round(breaker.threshold)}`,
    };
  }

  /*
    Derived from the ROUNDED reading, not from full precision.

    The derivation string shows its working, and a reader who runs the numbers
    has to arrive at the same answer. Deriving from -25.9437% while printing
    "-25.9%" puts a high of 498.89 on screen next to a calculation that yields
    498.92, and the three centimetres between those is exactly where somebody
    decides whether to trust the rest of the page.
  */
  const observed = evaluation?.observed;
  if (observed === undefined) return null;
  const shown = round(observed);

  if (breaker.metric === 'drawdownFromHigh') {
    // observed and threshold are negative percentages from the high.
    const high = price / (1 + shown / 100);
    if (!Number.isFinite(high) || high <= 0) return null;
    const level = round(round(high) * (1 + breaker.threshold / 100));
    return {
      ...base,
      price: level,
      distancePct: round(((level - price) / price) * 100),
      stability: 'moves-with-high',
      derivation:
        `price ${round(price)} sits ${shown}% below its high, which puts the high at ` +
        `${round(high)}. ${round(breaker.threshold)}% below that high is ${level}. ` +
        `A new high moves this level up with it`,
    };
  }

  if (breaker.metric === 'return30d' || breaker.metric === 'return90d') {
    const window = breaker.metric === 'return30d' ? '30' : '90';
    const anchor = price / (1 + shown / 100);
    if (!Number.isFinite(anchor) || anchor <= 0) return null;
    const level = round(round(anchor) * (1 + breaker.threshold / 100));
    return {
      ...base,
      price: level,
      distancePct: round(((level - price) / price) * 100),
      stability: 'moves-daily',
      derivation:
        `the ${window} day return is ${shown}%, so the price ${window} days ago was ` +
        `${round(anchor)}. A ${round(breaker.threshold)}% return from there is ${level}. ` +
        `This window rolls, so the level is only true today`,
    };
  }

  // volatility90d has no price. Valuation, fundamental and liquidity metrics
  // are not price conditions at all.
  return null;
}

function describeSize(
  depth: number | undefined,
  slippage: number | undefined,
): SizeCap | null {
  if (depth === undefined) return null;

  const max = depth * MAX_DEPTH_PARTICIPATION;

  if (depth <= 0) {
    return {
      exitDepthUsd: 0,
      participation: MAX_DEPTH_PARTICIPATION,
      maxNotionalUsd: 0,
      note:
        'Nothing is bid within one percent of the reference price. A position of any size ' +
        'can be opened here and cannot be closed. No size is safe, including a small one.',
    };
  }

  return {
    exitDepthUsd: round(depth, 2),
    participation: MAX_DEPTH_PARTICIPATION,
    maxNotionalUsd: round(max, 2),
    ...(slippage === undefined ? {} : { slippageBps: round(slippage, 2) }),
    note:
      `${money(depth)} is resting within one percent of the reference price. Taking more than ` +
      `${Math.round(MAX_DEPTH_PARTICIPATION * 100)}% of that band means the exit walks the book ` +
      `down, so the cap is ${money(max)}.`,
  };
}

function describeMonitorability(set: BreakerSet): Monitorability {
  const count = (cadence: Cadence) => set.breakers.filter((b) => b.cadence === cadence).length;
  const continuous = count('continuous');
  const periodic = count('periodic');
  const event = count('event');
  const uncoveredHighLoad = set.summary.uncoveredHighLoad.length;

  const note =
    continuous === 0
      ? 'Nothing on this thesis can change between filings. Between now and the next quarterly report there is no reading that would tell you it has stopped being true.'
      : `${continuous} tripwire${continuous === 1 ? '' : 's'} can move at any moment. ${periodic} wait${periodic === 1 ? 's' : ''} for the next filing.`;

  return { continuous, periodic, event, uncoveredHighLoad, note };
}

// ---------------------------------------------------------------------------

/**
 * Derive a signal from a thesis. Pure, and it makes no model call.
 */
export function deriveSignal(input: SignalInput): DerivedSignal {
  const now = input.now ?? Date.now;
  const side = sideFor(input.direction);
  const byId = new Map(input.evaluations.map((e) => [e.breakerId, e]));

  const reading = (metric: Metric): number | undefined =>
    input.evaluations.find((e) => e.metric === metric && e.observed !== undefined)?.observed;

  const levels = input.price
    ? input.breakerSet.breakers
        .map((b) => levelFor(b, byId.get(b.id), input.price as number))
        .filter((l): l is InvalidationLevel => l !== null)
        .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct))
    : [];

  const size = describeSize(
    input.exitDepthUsd ?? reading('exitDepthUsd'),
    input.exitSlippageBps ?? reading('exitSlippageBps'),
  );
  const monitorability = describeMonitorability(input.breakerSet);

  /*
    The dollar risk is computed from the DISPLAYED percentage, not from full
    precision. That is deliberate. Both numbers appear on screen next to each
    other, and a user who multiplies the one by the other has to arrive at the
    third. Carrying hidden precision through makes the arithmetic on screen
    fail to close by a dollar or two, which reads as a bug in exactly the
    place a reader is checking whether to trust any of this.
  */
  const nearestLevel = levels[0];
  const nearest: RiskToInvalidation | null = nearestLevel
    ? {
        level: nearestLevel,
        riskPct: Math.abs(nearestLevel.distancePct),
        ...(size && size.maxNotionalUsd > 0
          ? {
              riskUsdAtMaxSize: round(
                (size.maxNotionalUsd * Math.abs(nearestLevel.distancePct)) / 100,
                2,
              ),
            }
          : {}),
      }
    : null;

  const tradable = Boolean(input.rTokenSymbol) && (size === null || size.maxNotionalUsd > 0);

  // -------------------------------------------------------------------------
  // Caveats. This list is never empty by construction: a signal with no stated
  // limits reads as a recommendation, and this product does not issue those.
  // -------------------------------------------------------------------------

  const caveats: string[] = [];

  if (!input.rTokenSymbol) {
    caveats.push(
      `${input.ticker} has no rToken listed on Bitget, so nothing here can be traded on this venue.`,
    );
  }
  if (input.price === null) {
    caveats.push('No live price could be read, so no level below is anchored to anything.');
  }
  if (levels.length === 0 && input.price !== null) {
    caveats.push(
      'Not one tripwire on this thesis implies a price. Every one is fundamental or ' +
        'valuation based, which means there is no level at which your own reasoning says ' +
        'you are wrong. Any stop placed here would be a number you invented rather than ' +
        'one this thesis implies.',
    );
  }
  if (levels.some((l) => l.stability !== 'fixed')) {
    caveats.push(
      'At least one level below is anchored to a moving reference and is only true as of ' +
        'this reading. Recompute it before acting on it tomorrow.',
    );
  }
  if (size?.maxNotionalUsd === 0) {
    caveats.push('The book is empty on the bid. This position could be opened and not closed.');
  }
  if (monitorability.continuous === 0) {
    caveats.push(monitorability.note);
  }
  if (monitorability.uncoveredHighLoad > 0) {
    const n = monitorability.uncoveredHighLoad;
    caveats.push(
      n === 1
        ? 'One load-bearing assumption on this thesis has no tripwire at all, so this signal cannot see it.'
        : `${n} load-bearing assumptions on this thesis have no tripwire at all, so this signal cannot see them.`,
    );
  }
  caveats.push('Derived from this thesis, not from a view on the market. Research, not advice.');

  // -------------------------------------------------------------------------

  const headline = !input.rTokenSymbol
    ? `${input.ticker} is not listed as an rToken on Bitget.`
    : size?.maxNotionalUsd === 0
      ? `${input.ticker} has no bid. There is no size that can be closed.`
      : nearest && size
        ? `${side.toUpperCase()} ${input.ticker} up to ${money(size.maxNotionalUsd)}, wrong below ${nearest.level.price}, ${nearest.riskPct}% away.`
        : nearest
          ? `${side.toUpperCase()} ${input.ticker}, wrong at ${nearest.level.price}, ${nearest.riskPct}% away.`
          : `${side.toUpperCase()} ${input.ticker} has no price-based invalidation.`;

  return {
    ticker: input.ticker,
    rToken: input.rTokenSymbol ?? null,
    side,
    reference: input.price === null ? null : round(input.price),
    tradable,
    headline,
    levels,
    nearest,
    size,
    monitorability,
    caveats,
    meta: { modelCalls: 0, derivedAt: new Date(now()).toISOString() },
  };
}

/** Kept beside the deriver so a unit change cannot drift between the two. */
export function isPercentMetric(metric: Metric): boolean {
  return PERCENT_METRICS.has(metric);
}
