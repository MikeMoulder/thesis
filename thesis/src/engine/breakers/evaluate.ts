import type { DataSource } from '../../data/DataSource';
import { NoDataError, type Candle, type Instrument, type Provenance } from '../../data/types';
import {
  computePriceMetric,
  getPriceSeries,
  isFundamental,
  isLiquidity,
  isValuation,
  readMetric,
} from './metrics';
import {
  PERCENT_METRICS,
  type Metric,
  type Operator,
  type Severity,
  type ThesisBreaker,
  type ThresholdBreaker,
} from './types';

/**
 * The breaker evaluator — one engine, three modes.
 *
 *   LIVE        did it happen?          current data
 *   SCENARIO    what if it happened?    a hypothetical value
 *   HISTORICAL  when it happened before, the underlying's multi-year record
 *               what followed?
 *
 * The same stored condition answers all three. That is the whole reason
 * breakers are structured rather than prose.
 */

export type EvalMode = 'live' | 'scenario' | 'historical';

export type EvalStatus =
  | 'fired'
  /** Condition not met — the assumption still stands on this measure. */
  | 'holding'
  /** Cannot be checked. Never conflated with "holding". */
  | 'undeterminable'
  /** Scenario mode only: this breaker's metric was not part of the scenario. */
  | 'unaffected';

export interface Evaluation {
  breakerId: string;
  mode: EvalMode;
  status: EvalStatus;
  metric?: Metric;
  observed?: number;
  threshold?: number;
  /**
   * Distance from the threshold in the metric's own units. Negative means past
   * it. More useful than a bare boolean: "holding, but 1.2 points away" is a
   * different situation from "holding, 40 points away".
   */
  headroom?: number;
  asOf?: string;
  period?: string;
  provenance?: Provenance;
  /** Why a breaker could not be evaluated. Always set when undeterminable. */
  reason?: string;
}

export function compare(value: number, operator: Operator, threshold: number): boolean {
  switch (operator) {
    case '<':
      return value < threshold;
    case '<=':
      return value <= threshold;
    case '>':
      return value > threshold;
    case '>=':
      return value >= threshold;
  }
}

/** Signed distance to the threshold, in the direction that would trip it. */
function headroomOf(value: number, operator: Operator, threshold: number): number {
  return operator === '<' || operator === '<=' ? value - threshold : threshold - value;
}

export function formatValue(metric: Metric, value: number): string {
  const suffix = PERCENT_METRICS.has(metric) ? '%' : '';
  const abs = Math.abs(value);
  if (!suffix && abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (!suffix && abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  return `${value.toFixed(2)}${suffix}`;
}

// ---------------------------------------------------------------------------
// LIVE
// ---------------------------------------------------------------------------

export async function evaluateLive(
  ds: DataSource,
  instrument: Instrument,
  breaker: ThesisBreaker,
): Promise<Evaluation> {
  if (breaker.kind === 'event') {
    // Honest gap rather than a false "holding". A news provider is not wired,
    // so we genuinely do not know whether this occurred.
    return {
      breakerId: breaker.id,
      mode: 'live',
      status: 'undeterminable',
      reason: `event breakers need a news feed; none is wired. Watch manually for: ${breaker.watchFor}`,
    };
  }

  try {
    const reading = await readMetric(ds, instrument, breaker.metric);
    const fired = compare(reading.value, breaker.operator, breaker.threshold);
    return {
      breakerId: breaker.id,
      mode: 'live',
      status: fired ? 'fired' : 'holding',
      metric: breaker.metric,
      observed: reading.value,
      threshold: breaker.threshold,
      headroom: headroomOf(reading.value, breaker.operator, breaker.threshold),
      asOf: reading.asOf,
      ...(reading.period ? { period: reading.period } : {}),
      provenance: reading.provenance,
    };
  } catch (err) {
    return {
      breakerId: breaker.id,
      mode: 'live',
      status: 'undeterminable',
      metric: breaker.metric,
      reason: err instanceof NoDataError ? err.message : (err as Error).message,
    };
  }
}

// ---------------------------------------------------------------------------
// SCENARIO
// ---------------------------------------------------------------------------

/** Hypothetical values keyed by metric, e.g. { grossMargin: 62 }. */
export type Scenario = Partial<Record<Metric, number>>;

export function evaluateScenario(breaker: ThesisBreaker, scenario: Scenario): Evaluation {
  if (breaker.kind === 'event') {
    return {
      breakerId: breaker.id,
      mode: 'scenario',
      status: 'unaffected',
      reason: 'event breakers are not driven by a numeric scenario',
    };
  }

  const hypothetical = scenario[breaker.metric];
  if (hypothetical === undefined) {
    return {
      breakerId: breaker.id,
      mode: 'scenario',
      status: 'unaffected',
      metric: breaker.metric,
      reason: `${breaker.metric} is not part of this scenario`,
    };
  }

  const fired = compare(hypothetical, breaker.operator, breaker.threshold);
  return {
    breakerId: breaker.id,
    mode: 'scenario',
    status: fired ? 'fired' : 'holding',
    metric: breaker.metric,
    observed: hypothetical,
    threshold: breaker.threshold,
    headroom: headroomOf(hypothetical, breaker.operator, breaker.threshold),
    provenance: {
      status: 'inferred',
      source: 'user-supplied scenario',
      derivation: `assumes ${breaker.metric} = ${formatValue(breaker.metric, hypothetical)}`,
      confidence: 'low',
    },
  };
}

// ---------------------------------------------------------------------------
// HISTORICAL
// ---------------------------------------------------------------------------

export interface Occurrence {
  /** When the market could first have known (ISO date). */
  date: string;
  value: number;
  /** Fiscal period, for fundamental metrics. */
  period?: string;
  forward30d: number | null;
  forward90d: number | null;
  /** How many reported periods became knowable on this date. Usually 1. */
  periodsCovered?: number;
}

/** One point of the examined series — what the base rate was computed over. */
export interface SeriesPoint {
  date: string;
  value: number;
  /** True when this point satisfied the breaker's condition. */
  fired: boolean;
}

export interface HistoricalEvidence {
  breakerId: string;
  metric: Metric;
  occurrences: Occurrence[];
  /**
   * The series the base rate was computed over, downsampled for price metrics.
   *
   * Returned so the evidence can be looked at rather than taken on faith: a
   * count of occurrences cannot show that a threshold sat inside the normal
   * range for years, and that is usually the finding that matters.
   */
  series: SeriesPoint[];
  /** Periods or bars examined, for judging how much the count is worth. */
  examined: number;
  windowDescription: string;
  medianForward30d: number | null;
  medianForward90d: number | null;
  /**
   * Severity earned from the record rather than inherited from load-bearing.
   * Null when there is too little evidence to claim one.
   */
  measuredSeverity: Severity | null;
  /** Plain statement of what the evidence does and does not support. */
  note: string;
}

function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** Forward return from the first bar at or after `fromTs`, `days` later. */
function forwardReturn(candles: Candle[], fromTs: number, days: number): number | null {
  const first = candles[0];
  if (!first) return null;

  // The event predates our price history. Without this guard findIndex returns
  // bar 0 for every such event, so a dozen occurrences across different years
  // all report the identical forward return — fabricated data that looks
  // entirely plausible in the output. Null is the honest answer.
  if (fromTs < first.ts) return null;

  const startIdx = candles.findIndex((c) => c.ts >= fromTs);
  if (startIdx === -1) return null;
  const start = candles[startIdx]!;
  const targetTs = start.ts + days * 86_400_000;

  let endIdx = -1;
  for (let i = startIdx; i < candles.length; i++) {
    if (candles[i]!.ts >= targetTs) {
      endIdx = i;
      break;
    }
  }
  // Not enough history after the event — a recent occurrence has no forward
  // window yet. Null rather than using the last available bar, which would
  // silently mix a 12-day return into a 30-day sample.
  if (endIdx === -1) return null;
  if (start.close === 0) return null;
  return (candles[endIdx]!.close / start.close - 1) * 100;
}

/**
 * Severity from the measured record.
 *
 * Deliberately conservative: fewer than three occurrences earns no rating at
 * all, because a median of two numbers is not a base rate. Saying "not enough
 * history" is the honest output and keeps `severityInherited` in place.
 */
function severityFromEvidence(occurrences: Occurrence[], medianFwd: number | null): Severity | null {
  if (occurrences.length < 3 || medianFwd === null) return null;
  if (medianFwd <= -10) return 'high';
  if (medianFwd <= -3) return 'medium';
  return 'low';
}

export async function evaluateHistorical(
  ds: DataSource,
  instrument: Instrument,
  breaker: ThesisBreaker,
): Promise<HistoricalEvidence | Evaluation> {
  if (breaker.kind === 'event') {
    return {
      breakerId: breaker.id,
      mode: 'historical',
      status: 'undeterminable',
      reason: 'event breakers need a searchable news archive; none is wired',
    };
  }

  /*
    Liquidity has no past here, and inventing one would be the worst kind of
    wrong: plausible. Exchanges publish the CURRENT book and nothing else, so
    "how often has this had no bid?" can only be answered from snapshots we
    recorded ourselves, and we have not been recording them. Deriving depth
    from historical volume would look like an answer and would not be one,
    because volume says a trade happened, not that a bid was waiting.

    So this reports that the question is open rather than guessing at it. Once
    the recheck loop has stored book snapshots for a while, this becomes
    answerable the same way the autopsy already is.
  */
  if (isLiquidity(breaker.metric)) {
    return {
      breakerId: breaker.id,
      mode: 'historical',
      status: 'undeterminable',
      reason:
        'order books are only published as they stand right now, so there is no history to take a base rate from. This one can only be watched forward.',
    };
  }

  // Price history for forward returns always comes from the underlying: the
  // rToken has ~90 days, which cannot support a base rate. 'max' rather than
  // '5y' because fundamentals reach back ~10 years, and any occurrence older
  // than the price series yields no forward return at all.
  const priceHistory = await ds.getUnderlyingHistory(instrument, 'max');
  const candles = priceHistory.value;

  const occurrences: Occurrence[] = [];
  const series: SeriesPoint[] = [];
  let examined = 0;
  let windowDescription: string;

  if (isValuation(breaker.metric)) {
    /*
      Valuation over time needs THREE series agreeing about dates: the price on
      a day, the four quarters of results knowable by that day, and the share
      count knowable by that day.

      Getting this wrong is not a small error. Pairing today's share count with
      a price from three years ago invents a market value that never existed,
      and the resulting base rate would look entirely plausible. So every input
      is selected by its KNOWABLE date, exactly as the historical backfill does,
      and a day with no filed history behind it yet is skipped rather than
      filled in.
    */
    const [shareSeries, epsSeries, revenueSeries] = await Promise.all([
      ds.getSharesOutstandingSeries(instrument).catch(() => [] as Array<{ date: string; value: number }>),
      readFundamentalSeries(ds, instrument, { ...breaker, metric: 'eps' }).catch(() => []),
      readFundamentalSeries(ds, instrument, { ...breaker, metric: 'revenue' }).catch(() => []),
    ]);

    /*
      The window is the span we could actually VALUE, not the span of price
      history. AMD has price bars back to 1984 and filed results in this API
      back to about 2018; describing the window by the price range would claim
      four decades of evidence for eight years of it.
    */
    let firstValued = '';
    let lastValued = '';

    let previouslyFired = false;
    const stride = Math.max(1, Math.ceil(candles.length / 400));

    for (let i = 0; i < candles.length; i++) {
      const bar = candles[i]!;
      const on = new Date(bar.ts).toISOString().slice(0, 10);
      const value = valuationAsAt(breaker.metric, bar.close, on, shareSeries, epsSeries, revenueSeries);
      if (value === null) continue;
      examined++;
      if (!firstValued) firstValued = on;
      lastValued = on;

      const fired = compare(value, breaker.operator, breaker.threshold);
      if (i % stride === 0) series.push({ date: on, value, fired });

      if (fired && !previouslyFired) {
        occurrences.push({
          date: on,
          value,
          forward30d: forwardReturn(candles, bar.ts, 30),
          forward90d: forwardReturn(candles, bar.ts, 90),
        });
      }
      previouslyFired = fired;
    }

    windowDescription = firstValued
      ? `${examined} readings between ${firstValued} and ${lastValued}, each valued against the filings known that day`
      : 'no day in the price history had four quarters of filed results behind it';
  } else if (isFundamental(breaker.metric)) {
    const reading = await readFundamentalSeries(ds, instrument, breaker);
    examined = reading.length;
    windowDescription = `${examined} reported quarters`;

    for (const p of reading) {
      const fired = compare(p.value, breaker.operator, breaker.threshold);
      series.push({ date: p.date, value: p.value, fired });
      if (!fired) continue;
      const ts = Date.parse(p.date);
      occurrences.push({
        date: p.date,
        value: p.value,
        period: p.period,
        forward30d: forwardReturn(candles, ts, 30),
        forward90d: forwardReturn(candles, ts, 90),
      });
    }
  } else {
    const priceSeries = await getPriceSeries(ds, instrument, 365 * 5);
    examined = priceSeries.candles.length;
    windowDescription = `${examined} daily bars from the ${priceSeries.from}`;

    // Keep at most ~400 charted points. Enough to draw a faithful shape, small
    // enough that five years of daily bars do not bloat the payload. Occurrence
    // detection below still runs over EVERY bar — downsampling the picture must
    // never downsample the evidence.
    const stride = Math.max(1, Math.ceil(priceSeries.candles.length / 400));

    // Count only the day the condition first becomes true. A 60-day drawdown
    // is one event, not sixty — otherwise the base rate is meaningless.
    let previouslyFired = false;
    for (let i = 0; i < priceSeries.candles.length; i++) {
      const value = computePriceMetric(priceSeries.candles, breaker.metric, i);
      if (value === null) continue;
      const fired = compare(value, breaker.operator, breaker.threshold);
      const ts = priceSeries.candles[i]!.ts;

      if (i % stride === 0) {
        series.push({ date: new Date(ts).toISOString().slice(0, 10), value, fired });
      }

      if (fired && !previouslyFired) {
        occurrences.push({
          date: new Date(ts).toISOString().slice(0, 10),
          value,
          forward30d: forwardReturn(candles, ts, 30),
          forward90d: forwardReturn(candles, ts, 90),
        });
      }
      previouslyFired = fired;
    }
  }

  // Several periods can become knowable on the same day — a 10-K restates prior
  // years, and reconstructed Q4s all date from their annual filing. The market
  // learned them at once, so they are one observation. Left uncollapsed they
  // duplicate a single day's forward return and skew the median.
  const collapsed = collapseSameDay(occurrences);

  const m30 = median(collapsed.map((o) => o.forward30d).filter((x): x is number => x !== null));
  const m90 = median(collapsed.map((o) => o.forward90d).filter((x): x is number => x !== null));
  const measuredSeverity = severityFromEvidence(collapsed, m90 ?? m30);

  const n = collapsed.length;

  return {
    breakerId: breaker.id,
    metric: breaker.metric,
    occurrences: collapsed,
    series,
    examined,
    windowDescription,
    medianForward30d: m30,
    medianForward90d: m90,
    measuredSeverity,
    note:
      n === 0
        ? `Never occurred across ${windowDescription}. That says the threshold is far from normal, not that it is safe.`
        : n < 3
          ? `Only ${n} prior occurrence${n === 1 ? '' : 's'} in ${windowDescription} — too few for a base rate. Severity stays inherited.`
          : `${n} prior occurrences in ${windowDescription}.`,
  };
}

/**
 * Fundamental series dated by when it was first KNOWABLE, not by period end.
 *
 * Exported because the historical backfill needs exactly the same rule. Two
 * implementations of "when could the market have known this?" would drift, and
 * the drift would show up as a backfilled check that saw a filing before it was
 * filed — the one error a reconstruction must never make, and the hardest to
 * spot by reading the output.
 */
export async function readFundamentalSeries(
  ds: DataSource,
  instrument: Instrument,
  breaker: ThresholdBreaker,
): Promise<Array<{ date: string; value: number; period: string }>> {
  const derived = ['grossMargin', 'operatingMargin', 'netMargin', 'revenueGrowthYoY'] as const;
  const asDerived = derived.find((d) => d === breaker.metric);

  if (asDerived) {
    const r = await ds.getDerivedMetric(instrument, asDerived, { limit: 40 });
    return r.value.map((p) => ({
      // A derived metric becomes knowable when its LAST input is filed, not its
      // first. revenueGrowthYoY compares against the year-ago quarter, so
      // inputs[0] is a year stale — using it dated occurrences twelve months
      // before they could have been known.
      date: knowableFrom(p.inputs) ?? p.end,
      value: p.value,
      period: p.end,
    }));
  }

  const concept = CONCEPTS[breaker.metric];
  if (!concept) throw new NoDataError(`No concept mapped for ${breaker.metric}`, 'edgar');
  const r = await ds.getFundamentalSeries(instrument, concept, { limit: 40 });
  return r.value.map((p) => ({ date: p.firstFiled, value: p.value, period: p.end }));
}

/**
 * Collapse occurrences sharing a knowable date into one, keeping the most
 * extreme value and recording how many periods it covered.
 */
function collapseSameDay(occurrences: Occurrence[]): Occurrence[] {
  const byDate = new Map<string, Occurrence>();
  for (const o of occurrences) {
    const prev = byDate.get(o.date);
    if (!prev) {
      byDate.set(o.date, { ...o, periodsCovered: 1 });
      continue;
    }
    byDate.set(o.date, {
      ...(Math.abs(o.value) > Math.abs(prev.value) ? o : prev),
      periodsCovered: (prev.periodsCovered ?? 1) + 1,
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * When a derived metric became knowable: the latest filing date among its
 * inputs. Exported so metrics.ts uses the same rule for live readings.
 */
export function knowableFrom(inputs: Array<{ firstFiled: string }>): string | null {
  if (inputs.length === 0) return null;
  return inputs.reduce((latest, i) => (i.firstFiled > latest ? i.firstFiled : latest), inputs[0]!.firstFiled);
}

const CONCEPTS: Partial<Record<Metric, string>> = {
  // Metric ALIASES, not raw XBRL tags. The data layer resolves each one across
  // every tag the figure can arrive under and merges the results, so a filer
  // that changed tags mid-history still produces one continuous series.
  //
  // These were raw tags naming exactly one concept each. For AMD that meant
  // `Revenues`, a node it abandoned in 2018 which still holds two quarters from
  // 2017, and those were being read as the current figure.
  revenue: 'revenue',
  grossProfit: 'grossProfit',
  operatingIncome: 'operatingIncome',
  netIncome: 'netIncome',
  eps: 'eps',
  researchAndDevelopment: 'researchAndDevelopment',
};

/** Trailing twelve months of a series, as knowable on a given day. */
function ttmAsAt(
  series: Array<{ date: string; value: number }>,
  on: string,
): number | null {
  const known = series.filter((p) => p.date <= on);
  if (known.length < 4) return null;
  return known.slice(-4).reduce((sum, p) => sum + p.value, 0);
}

/** The latest single figure knowable on a given day. */
function latestAsAt(series: Array<{ date: string; value: number }>, on: string): number | null {
  let found: number | null = null;
  for (const point of series) {
    if (point.date > on) break;
    found = point.value;
  }
  return found;
}

/**
 * A valuation as it stood on one past day, from inputs knowable on that day.
 *
 * Returns null wherever an input is missing rather than substituting a later
 * one. A base rate computed over a shorter, honest window is worth more than a
 * longer one with invented numbers in it.
 */
export function valuationAsAt(
  metric: Metric,
  price: number,
  on: string,
  shares: Array<{ date: string; value: number }>,
  eps: Array<{ date: string; value: number }>,
  revenue: Array<{ date: string; value: number }>,
): number | null {
  if (price <= 0) return null;

  if (metric === 'trailingPE' || metric === 'earningsYield') {
    const ttm = ttmAsAt(eps, on);
    if (ttm === null) return null;
    if (metric === 'earningsYield') return (ttm / price) * 100;
    // A loss making period has no meaningful multiple. Skipping the day is the
    // same refusal the live reading makes, applied to history.
    return ttm > 0 ? price / ttm : null;
  }

  const count = latestAsAt(shares, on);
  if (count === null || count <= 0) return null;
  const cap = price * count;
  if (metric === 'marketCap') return cap;

  const ttmRevenue = ttmAsAt(revenue, on);
  if (ttmRevenue === null || ttmRevenue <= 0) return null;
  return cap / ttmRevenue;
}
