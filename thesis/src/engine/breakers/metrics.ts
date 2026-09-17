import type { DataSource } from '../../data/DataSource';
import { NoDataError, type Candle, type Instrument, type Provenance } from '../../data/types';
import { knowableFrom } from './evaluate';
import {
  FUNDAMENTAL_METRICS,
  type FundamentalMetric,
  type Metric,
  type PriceMetric,
} from './types';

/**
 * Resolving a breaker's metric to an actual number.
 *
 * This is the bridge between the breaker vocabulary and the data layer. Every
 * metric in the vocabulary must land here, or the generator could emit a
 * condition nothing can evaluate.
 */

export interface MetricReading {
  metric: Metric;
  value: number;
  /** When the value was observed or reported (ISO). */
  asOf: string;
  provenance: Provenance;
  /** Fiscal period end, for fundamental metrics. */
  period?: string;
}

export function isFundamental(metric: Metric): metric is FundamentalMetric {
  return (FUNDAMENTAL_METRICS as readonly string[]).includes(metric);
}

/** Direct XBRL concepts. Ratios go through getDerivedMetric instead. */
const CONCEPT_FOR: Partial<Record<FundamentalMetric, string>> = {
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

const DERIVED_FOR = {
  grossMargin: 'grossMargin',
  operatingMargin: 'operatingMargin',
  netMargin: 'netMargin',
  revenueGrowthYoY: 'revenueGrowthYoY',
} as const;

// ---------------------------------------------------------------------------
// Price series selection
// ---------------------------------------------------------------------------

/** Calendar days of history each price metric needs. */
/** Extra days a series must carry beyond the window it has to look back over. */
export const LOOKBACK_MARGIN_DAYS = 7;

export const WINDOW_DAYS: Record<PriceMetric, number> = {
  price: 1,
  return30d: 30,
  return90d: 90,
  drawdownFromHigh: 365,
  volatility90d: 90,
};

export interface PriceSeries {
  candles: Candle[];
  /** Which instrument the series came from. */
  from: 'rToken' | 'underlying';
  provenance: Provenance;
}

/**
 * Pick the series that can actually answer the question.
 *
 * Prefer the rToken, because that is the 7x24 instrument and the reason this
 * product needs a live market at all. But rTokens listed around 2026-06, so
 * roughly 90 days of history exists — anything needing a longer window has to
 * come from the underlying equity, which has years.
 *
 * Which one was used is recorded in provenance rather than hidden.
 */
export async function getPriceSeries(
  ds: DataSource,
  instrument: Instrument,
  daysNeeded: number,
): Promise<PriceSeries> {
  if (instrument.rTokenSymbol) {
    try {
      const rt = await ds.getCandles(instrument, '1D', 400);
      const c = rt.value;
      const first = c[0];
      const last = c[c.length - 1];
      if (first && last) {
        const span = (last.ts - first.ts) / 86_400_000;
        /*
          The span must EXCEED the window, not merely approach it.

          This read `span >= daysNeeded * 0.95` and called a 90 day window
          against 89 days of bars "fine". It is not. A lookback needs a bar at
          or BEFORE the target date, and with 89 days of history the oldest bar
          falls three days on the wrong side of a 90 day target, so the
          computation returns null and the metric reads as unmeasurable.

          rTokens trade 7x24, so 90 bars really is 89 calendar days, and
          return90d was failing this way for EVERY ticker. The margin covers
          gaps and listing-day partials.
        */
        if (span >= daysNeeded + LOOKBACK_MARGIN_DAYS) {
          return { candles: c, from: 'rToken', provenance: rt.provenance };
        }
      }
    } catch {
      // Fall through to the underlying rather than failing the evaluation.
    }
  }

  const period = daysNeeded > 730 ? '5y' : daysNeeded > 365 ? '2y' : '1y';
  const under = await ds.getUnderlyingHistory(instrument, period);
  return {
    candles: under.value,
    from: 'underlying',
    provenance: {
      ...under.provenance,
      derivation:
        `underlying equity history used because the rToken has too little history ` +
        `for a ${daysNeeded}-day window`,
    },
  };
}

// ---------------------------------------------------------------------------
// Computation over a candle series
// ---------------------------------------------------------------------------

/** Latest close at or before `atIndex`, looking back `days` calendar days. */
function closeDaysBefore(candles: Candle[], atIndex: number, days: number): number | null {
  const target = candles[atIndex]!.ts - days * 86_400_000;
  for (let i = atIndex; i >= 0; i--) {
    if (candles[i]!.ts <= target) return candles[i]!.close;
  }
  return null;
}

/**
 * Compute a price metric as of `atIndex` in the series.
 * Exported so historical mode can walk the series and compute at every point.
 */
export function computePriceMetric(
  candles: Candle[],
  metric: PriceMetric,
  atIndex = candles.length - 1,
): number | null {
  const here = candles[atIndex];
  if (!here) return null;

  switch (metric) {
    case 'price':
      return here.close;

    case 'return30d':
    case 'return90d': {
      const days = metric === 'return30d' ? 30 : 90;
      const then = closeDaysBefore(candles, atIndex, days);
      if (then === null || then === 0) return null;
      return (here.close / then - 1) * 100;
    }

    case 'drawdownFromHigh': {
      // Trailing one-year high. Zero or negative by convention — see
      // METRIC_SEMANTICS; a 25% drawdown is -25, never +25.
      const cutoff = here.ts - 365 * 86_400_000;
      let high = -Infinity;
      for (let i = atIndex; i >= 0 && candles[i]!.ts >= cutoff; i--) {
        if (candles[i]!.high > high) high = candles[i]!.high;
      }
      if (!Number.isFinite(high) || high === 0) return null;
      return Math.min(0, (here.close / high - 1) * 100);
    }

    case 'volatility90d': {
      const cutoff = here.ts - 90 * 86_400_000;
      const returns: number[] = [];
      for (let i = atIndex; i > 0 && candles[i]!.ts >= cutoff; i--) {
        const prev = candles[i - 1]!.close;
        if (prev > 0) returns.push(Math.log(candles[i]!.close / prev));
      }
      if (returns.length < 10) return null;
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance =
        returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
      // Annualised, in percent. 252 trading days.
      return Math.sqrt(variance) * Math.sqrt(252) * 100;
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Read a metric's current value. */
export async function readMetric(
  ds: DataSource,
  instrument: Instrument,
  metric: Metric,
): Promise<MetricReading> {
  if (isFundamental(metric)) {
    if (metric in DERIVED_FOR) {
      const r = await ds.getDerivedMetric(
        instrument,
        DERIVED_FOR[metric as keyof typeof DERIVED_FOR],
        { limit: 1 },
      );
      const latest = r.value[r.value.length - 1];
      if (!latest) throw new NoDataError(`No ${metric} available`, 'edgar');
      return {
        metric,
        value: latest.value,
        // Latest input, not the first — see knowableFrom().
        asOf: knowableFrom(latest.inputs) ?? latest.end,
        period: latest.end,
        provenance: r.provenance,
      };
    }

    const concept = CONCEPT_FOR[metric];
    if (!concept) throw new NoDataError(`No XBRL concept mapped for ${metric}`, 'edgar');
    const r = await ds.getFundamentalSeries(instrument, concept, { limit: 1 });
    const latest = r.value[r.value.length - 1];
    if (!latest) throw new NoDataError(`No ${metric} available`, 'edgar');
    return {
      metric,
      value: latest.value,
      asOf: latest.firstFiled,
      period: latest.end,
      provenance: r.provenance,
    };
  }

  const priceMetric = metric as PriceMetric;

  // The live quote is the rToken's 7x24 price — the one number that keeps
  // moving while US markets are shut.
  if (priceMetric === 'price' && instrument.rTokenSymbol) {
    const q = await ds.getQuote(instrument);
    return {
      metric,
      value: q.value.last,
      asOf: new Date(q.value.ts).toISOString(),
      provenance: q.provenance,
    };
  }

  let series = await getPriceSeries(ds, instrument, WINDOW_DAYS[priceMetric]);
  let value = computePriceMetric(series.candles, priceMetric);

  /*
    A series can pass the span check and still not answer the question, because
    span is a proxy for "has a bar old enough" and a gap can defeat it. Rather
    than report a metric as unmeasurable when a longer series is one call away,
    ask the underlying before giving up.
  */
  if (value === null && series.from === 'rToken') {
    series = await getPriceSeries(ds, { ...instrument, rTokenSymbol: undefined }, WINDOW_DAYS[priceMetric]);
    value = computePriceMetric(series.candles, priceMetric);
  }

  if (value === null) {
    throw new NoDataError(
      `Not enough price history to compute ${metric} (${series.candles.length} bars from ${series.from})`,
      'market',
    );
  }
  const last = series.candles[series.candles.length - 1]!;
  return {
    metric,
    value,
    asOf: new Date(last.ts).toISOString(),
    provenance: {
      ...series.provenance,
      status: 'inferred',
      derivation: `${metric} computed from ${series.from} daily closes${
        series.provenance.derivation ? `; ${series.provenance.derivation}` : ''
      }`,
    },
  };
}
