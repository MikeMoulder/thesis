import type { Assumption } from '../decomposer/types';

/**
 * Thesis breakers — the product primitive.
 *
 * A breaker is not prose. It is a stored, evaluable condition under which the
 * user should stop believing their own thesis. Because it is structured, the
 * same object answers three different questions:
 *
 *   SCENARIO    "what if X happens?"     — evaluate against a hypothetical
 *   LIVE        "did X happen?"          — evaluate against current data
 *   HISTORICAL  "when X happened before, — evaluate against the underlying's
 *                what followed?"           multi-year history
 *
 * One engine, three modes. That is what makes the 24/7 monitoring story
 * affordable: the monitor is the scenario evaluator pointed at real data.
 */

/**
 * How often the underlying data can actually change.
 *
 * This is a practical demo requirement, not bookkeeping. A thesis whose
 * breakers are all `periodic` has nothing to check between earnings, and the
 * live view renders an empty screen. Where a thesis genuinely cannot produce a
 * continuous breaker, saying so is itself a finding: "your thesis cannot be
 * retested until the next earnings report" is real information.
 */
export type Cadence = 'continuous' | 'event' | 'periodic';

/**
 * Metrics the evaluator can actually compute.
 *
 * Closed vocabulary on purpose. An open string would let the model emit
 * conditions nothing can evaluate, which would turn breakers back into prose
 * wearing a JSON costume.
 */
export type FundamentalMetric =
  | 'revenue'
  | 'grossProfit'
  | 'operatingIncome'
  | 'netIncome'
  | 'eps'
  | 'researchAndDevelopment'
  | 'grossMargin'
  | 'operatingMargin'
  | 'netMargin'
  | 'revenueGrowthYoY';

export type PriceMetric =
  | 'price'
  | 'return30d'
  | 'return90d'
  | 'drawdownFromHigh'
  | 'volatility90d';

/**
 * Sign and unit conventions. These are contractual — the generator writes
 * thresholds against them and the evaluator compares against them, so an
 * unstated convention produces a breaker that silently never fires (or always
 * does). Kept beside the metric list so the two cannot drift apart.
 */
export const METRIC_SEMANTICS: Record<Metric, string> = {
  revenue: 'whole currency units for the quarter, e.g. 96200000000',
  grossProfit: 'whole currency units for the quarter',
  operatingIncome: 'whole currency units for the quarter; negative when loss-making',
  netIncome: 'whole currency units for the quarter; negative when loss-making',
  eps: 'diluted earnings per share for the quarter, in currency',
  researchAndDevelopment: 'whole currency units for the quarter',
  grossMargin: 'percent, 0-100. 75 means 75%',
  operatingMargin: 'percent; negative when operating at a loss',
  netMargin: 'percent; negative when loss-making',
  revenueGrowthYoY: 'percent change versus the same quarter a year earlier; negative when shrinking',
  price: 'last traded price in currency',
  return30d: 'percent change over 30 days; negative when down',
  return90d: 'percent change over 90 days; negative when down',
  drawdownFromHigh:
    'percent below the trailing high, expressed as ZERO OR NEGATIVE. 0 means at the high, -25 means 25% below it. A 25% drawdown is therefore "<= -25", never ">= 25"',
  volatility90d: 'annualised realised volatility in percent, always positive',
};

export type Metric = FundamentalMetric | PriceMetric;

export const FUNDAMENTAL_METRICS: readonly FundamentalMetric[] = [
  'revenue',
  'grossProfit',
  'operatingIncome',
  'netIncome',
  'eps',
  'researchAndDevelopment',
  'grossMargin',
  'operatingMargin',
  'netMargin',
  'revenueGrowthYoY',
];

export const PRICE_METRICS: readonly PriceMetric[] = [
  'price',
  'return30d',
  'return90d',
  'drawdownFromHigh',
  'volatility90d',
];

/** Percent-valued metrics; thresholds are read as percentages, not ratios. */
export const PERCENT_METRICS: ReadonlySet<Metric> = new Set<Metric>([
  'grossMargin',
  'operatingMargin',
  'netMargin',
  'revenueGrowthYoY',
  'return30d',
  'return90d',
  'drawdownFromHigh',
  'volatility90d',
]);

export type Operator = '<' | '<=' | '>' | '>=';

export type Severity = 'high' | 'medium' | 'low';

interface BreakerBase {
  id: string;
  /** The assumption this breaker tests. Every breaker traces to one. */
  assumptionRef: string;
  /** Plain-language statement of what would break the thesis. */
  statement: string;
  severity: Severity;
  /**
   * True while severity is inherited from the assumption's load-bearing rating
   * rather than earned from a historical base rate. The UI must not present an
   * inherited severity as if it were measured.
   */
  severityInherited: boolean;
  cadence: Cadence;
}

/** A numeric condition the evaluator can check directly. */
export interface ThresholdBreaker extends BreakerBase {
  kind: 'threshold';
  metric: Metric;
  operator: Operator;
  /** Percent for PERCENT_METRICS, otherwise the metric's natural unit. */
  threshold: number;
}

/**
 * A discrete occurrence to watch for. Not numeric, so it is matched against
 * news and announcements rather than compared to a number.
 */
export interface EventBreaker extends BreakerBase {
  kind: 'event';
  cadence: 'event';
  /** What to watch for, phrased for a news-matching pass. */
  watchFor: string;
  /** Terms that would appear in a headline if this occurred. */
  keywords: string[];
}

export type ThesisBreaker = ThresholdBreaker | EventBreaker;

export interface BreakerSet {
  ticker: string;
  breakers: ThesisBreaker[];
  /** Assumptions that produced no breaker, and why. */
  uncovered: Array<{ assumptionId: string; statement: string; reason: string }>;
  summary: BreakerSummary;
  meta: { model: string; latencyMs: number; generatedAt: string };
}

export interface BreakerSummary {
  total: number;
  byCadence: Record<Cadence, number>;
  /**
   * True when nothing can fire between earnings reports. Worth surfacing: it
   * means the live monitor has nothing to show until the next filing.
   */
  quietUntilEarnings: boolean;
  /** High-load assumptions with no breaker — the thesis's blind spots. */
  uncoveredHighLoad: string[];
}

export function summariseBreakers(
  breakers: ThesisBreaker[],
  uncovered: BreakerSet['uncovered'],
  assumptions: Assumption[],
): BreakerSummary {
  const byCadence: Record<Cadence, number> = { continuous: 0, event: 0, periodic: 0 };
  for (const b of breakers) byCadence[b.cadence]++;

  const highLoad = new Set(
    assumptions.filter((a) => a.loadBearing === 'high').map((a) => a.id),
  );

  return {
    total: breakers.length,
    byCadence,
    quietUntilEarnings: byCadence.continuous === 0 && byCadence.event === 0,
    uncoveredHighLoad: uncovered.filter((u) => highLoad.has(u.assumptionId)).map((u) => u.assumptionId),
  };
}
