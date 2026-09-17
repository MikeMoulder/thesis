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
 * Valuation: what the market is currently paying for the business.
 *
 * ## Why these exist
 *
 * The most common unstated assumption in any thesis is "this is not already
 * priced in", because every thesis is a bet that the market is wrong about
 * something. It was also, until now, the one assumption this engine could never
 * touch, and both live theses had exactly one untestable assumption of exactly
 * this shape.
 *
 * These do not close that gap completely and must not be described as though
 * they do. **We still have no analyst consensus, no forward estimates and no
 * price targets**, so "the market has not priced in NEXT year's margins" remains
 * untestable. What these answer is the measurable half: what the market is
 * paying TODAY, against this company's own earnings and sales, so a re-rating
 * can be given a number and watched.
 *
 * They need BOTH a live price and filed fundamentals, which is why they are
 * their own category rather than an extension of either.
 */
export type ValuationMetric = 'marketCap' | 'trailingPE' | 'priceToSales' | 'earningsYield';

/**
 * Whether the position can actually be closed, read from resting depth.
 *
 * Its own category because it tests a different KIND of claim. Fundamental,
 * price and valuation metrics all test whether the user is RIGHT. These test
 * whether being right would pay, which is a separate question and the one
 * every thesis assumes without stating.
 *
 * The gap is specific to tokenized equities and it is large. Bitget lists 1655
 * rTokens; half the household names among them carry a live price and real
 * 24 hour volume above a completely empty book. rNFLX quoted 76.92 with 12.4M
 * of volume and zero resting orders on 17 Sep 2026. A stop placed there cannot
 * fill, and no price feed, chart or filing would ever say so.
 *
 * Read from the order book alone, so they move continuously and are only ever
 * as good as the instant they were sampled. A book is not a promise.
 */
export type LiquidityMetric = 'spreadBps' | 'exitDepthUsd' | 'exitSlippageBps';

/**
 * The notional an exit is costed against, in USD.
 *
 * Fixed rather than taken from the thesis, because a thesis states a view and
 * almost never states a size. A constant makes the number comparable across
 * instruments, which is what makes "rNVDA costs 0.4bps to exit and rKO costs
 * 44.7" a usable sentence. It is declared in METRIC_SEMANTICS so the model
 * writes thresholds against a size it can see.
 */
export const EXIT_REFERENCE_NOTIONAL_USD = 25_000;

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
  marketCap: 'share price times shares outstanding, in whole currency units',
  trailingPE:
    'price divided by the last four quarters of diluted earnings per share, as a multiple. 35 means the shares cost 35 times last year of earnings. NEVER NEGATIVE: a loss-making company has no meaningful P/E and this reads as unavailable instead',
  priceToSales:
    'market capitalisation divided by the last four quarters of revenue, as a multiple. 12 means the shares cost 12 times annual sales',
  earningsYield:
    'the last four quarters of earnings as a percent of the share price, which is the inverse of trailing P/E. 3 means 3%. Negative when the company is loss-making',
  spreadBps:
    'gap between the best bid and the best offer, in basis points of the mid price. ALWAYS POSITIVE and higher is worse: 1 means a tenth of a percent to cross, 50 means half a percent. Unavailable when either side of the book is empty, because a spread needs two sides',
  exitDepthUsd:
    'US dollars of resting BIDS within 1% below the mid price, i.e. what could be sold right now without moving the price more than 1%. Higher is better. ZERO IS A VALID AND COMMON READING and means nothing is bid at all, so a sell has nothing to fill against',
  exitSlippageBps:
    'realised cost of selling 25000 USD into the resting bids, in basis points below mid. ALWAYS POSITIVE and higher is worse. Unavailable when the book holds less than that, which is itself the finding',
};

export type Metric = FundamentalMetric | PriceMetric | ValuationMetric | LiquidityMetric;

export const VALUATION_METRICS: readonly ValuationMetric[] = [
  'marketCap',
  'trailingPE',
  'priceToSales',
  'earningsYield',
];

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

export const LIQUIDITY_METRICS: readonly LiquidityMetric[] = [
  'spreadBps',
  'exitDepthUsd',
  'exitSlippageBps',
];

/** Percent-valued metrics; thresholds are read as percentages, not ratios. */
export const PERCENT_METRICS: ReadonlySet<Metric> = new Set<Metric>([
  'earningsYield',
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
