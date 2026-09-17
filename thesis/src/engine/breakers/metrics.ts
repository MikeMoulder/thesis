import type { DataSource } from '../../data/DataSource';
import {
  NoDataError,
  type Candle,
  type Instrument,
  type OrderBook,
  type Provenance,
} from '../../data/types';
import { knowableFrom } from './evaluate';
import {
  EXIT_REFERENCE_NOTIONAL_USD,
  FUNDAMENTAL_METRICS,
  LIQUIDITY_METRICS,
  VALUATION_METRICS,
  type FundamentalMetric,
  type LiquidityMetric,
  type Metric,
  type PriceMetric,
  type ValuationMetric,
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

export function isValuation(metric: Metric): metric is ValuationMetric {
  return (VALUATION_METRICS as readonly string[]).includes(metric);
}

export function isLiquidity(metric: Metric): metric is LiquidityMetric {
  return (LIQUIDITY_METRICS as readonly string[]).includes(metric);
}

// ---------------------------------------------------------------------------
// Liquidity: whether the position can be closed
// ---------------------------------------------------------------------------

/**
 * The reference price a liquidity reading is measured against.
 *
 * Normally the mid. When one side is missing there is no mid, and the best bid
 * stands in: it is the only price anyone has committed to, and refusing to
 * answer would lose the distinction that matters most, which is zero depth
 * against some depth. Returns null only when nothing is bid, where every
 * liquidity question is either zero or unanswerable anyway.
 */
function referencePrice(book: OrderBook): number | null {
  const ask = bestAsk(book);
  const bid = bestBid(book);
  if (ask != null && bid != null) return (ask + bid) / 2;
  return bid ?? null;
}

/*
  Best price is derived, not read off the top of the array.

  The provider sorts before returning, and the OrderBook contract says so, but
  this function is exported and pure: anything can hand it a book. Trusting
  position 0 would make a mis-ordered book produce 104 basis points of spread
  where the truth is 10, and nothing downstream could tell the difference
  because both are numbers a real instrument could print. Deriving costs one
  pass and removes the failure mode entirely.
*/
function bestAsk(book: OrderBook): number | null {
  let best: number | null = null;
  for (const level of book.asks) if (best === null || level.price < best) best = level.price;
  return best;
}

function bestBid(book: OrderBook): number | null {
  let best: number | null = null;
  for (const level of book.bids) if (best === null || level.price > best) best = level.price;
  return best;
}

/**
 * One liquidity metric from one book snapshot. Pure, so it can be tested
 * against hand-built books rather than against whatever the market is doing.
 *
 * Returns null for genuinely unanswerable readings and 0 where zero is the
 * true answer. That distinction is the whole point of this function:
 *
 *   spreadBps        null when either side is empty. A spread needs two sides,
 *                    and calling a one-sided book "0 spread" would read as
 *                    perfectly liquid when it is the opposite.
 *   exitDepthUsd     0 when nothing is bid. This is a real measurement and the
 *                    single most important number here.
 *   exitSlippageBps  null when the book cannot absorb the reference notional.
 *                    The caller reports what WAS available, which says more
 *                    than any number this could return.
 */
export function computeLiquidityMetric(book: OrderBook, metric: LiquidityMetric): number | null {
  if (metric === 'spreadBps') {
    const ask = bestAsk(book);
    const bid = bestBid(book);
    if (ask == null || bid == null) return null;
    const mid = (ask + bid) / 2;
    if (mid <= 0) return null;
    return ((ask - bid) / mid) * 10_000;
  }

  const reference = referencePrice(book);
  if (reference == null || reference <= 0) return metric === 'exitDepthUsd' ? 0 : null;

  if (metric === 'exitDepthUsd') {
    const floor = reference * 0.99;
    return book.bids
      .filter((level) => level.price >= floor)
      .reduce((sum, level) => sum + level.price * level.size, 0);
  }

  // exitSlippageBps: walk the bids selling the reference notional, and compare
  // the average price actually achieved against the reference.
  let remaining = EXIT_REFERENCE_NOTIONAL_USD;
  let tokensSold = 0;
  let proceeds = 0;
  // Highest bids first, for the same reason best price is derived: a walk down
  // an unsorted book fills at the wrong levels and still returns a number.
  const bidsByPrice = [...book.bids].sort((x, y) => y.price - x.price);
  for (const level of bidsByPrice) {
    const available = level.price * level.size;
    const take = Math.min(remaining, available);
    tokensSold += take / level.price;
    proceeds += take;
    remaining -= take;
    if (remaining <= 0) break;
  }
  // Unfilled means the book is thinner than the trade. Not a number.
  if (remaining > 0 || tokensSold <= 0) return null;
  const achieved = proceeds / tokensSold;
  return ((reference - achieved) / reference) * 10_000;
}

/** Dollars actually bid within 1% of reference, used to explain a null exit cost. */
export function availableExitUsd(book: OrderBook): number {
  return computeLiquidityMetric(book, 'exitDepthUsd') ?? 0;
}

async function readLiquidity(
  ds: DataSource,
  instrument: Instrument,
  metric: LiquidityMetric,
): Promise<MetricReading> {
  if (!instrument.rTokenSymbol) {
    throw new NoDataError(
      `${instrument.ticker} has no rToken listed on Bitget, so there is no book to read`,
      'bitget',
    );
  }

  const book = await ds.getOrderBook(instrument);
  const value = computeLiquidityMetric(book.value, metric);

  if (value === null) {
    const sides = `${book.value.asks.length} asks / ${book.value.bids.length} bids`;
    const detail =
      metric === 'spreadBps'
        ? `${book.value.symbol} has no two-sided market right now (${sides})`
        : `${book.value.symbol} has only ${Math.round(availableExitUsd(book.value)).toLocaleString()} USD bid within 1%, less than the ${EXIT_REFERENCE_NOTIONAL_USD.toLocaleString()} USD an exit is costed against (${sides})`;
    throw new NoDataError(detail, 'bitget');
  }

  return {
    metric,
    value,
    asOf: new Date(book.value.ts).toISOString(),
    provenance: {
      ...book.provenance,
      status: 'inferred',
      derivation: `${metric} computed from ${book.value.asks.length} asks and ${book.value.bids.length} bids resting on Bitget spot`,
    },
  };
}

/**
 * Trailing twelve months: the last four reported quarters, added up.
 *
 * A single quarter cannot be compared with a share price. Price is a claim on
 * the whole future of the business, so the denominator has to be a year, and
 * four quarters is the year we can actually observe.
 *
 * Returns null rather than a part-year sum when fewer than four quarters exist.
 * Dividing a price by three quarters of earnings would overstate the multiple by
 * a third and nothing on screen would show it.
 */
function trailingTwelveMonths(points: Array<{ value: number }>): number | null {
  if (points.length < 4) return null;
  return points.slice(-4).reduce((sum, p) => sum + p.value, 0);
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

  if (isValuation(metric)) return readValuation(ds, instrument, metric);

  if (isLiquidity(metric)) return readLiquidity(ds, instrument, metric);

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

// ---------------------------------------------------------------------------
// Valuation: price meeting fundamentals
// ---------------------------------------------------------------------------

/**
 * What the market is paying for this business today.
 *
 * Needs three things that come from three different places: a live price, four
 * quarters of filed results, and a share count. Because the price is live and
 * the filings are quarterly, the reading MOVES CONTINUOUSLY even though its
 * denominator only changes four times a year, which is exactly what makes a
 * re-rating watchable.
 *
 * Provenance says so explicitly. A number built from three sources, one of them
 * months old, must not be presented as a single clean observation.
 */
async function readValuation(
  ds: DataSource,
  instrument: Instrument,
  metric: ValuationMetric,
): Promise<MetricReading> {
  const quote = await ds.getQuote(instrument).catch(() => null);
  const price = quote?.value.last;
  if (price === undefined || price <= 0) {
    throw new NoDataError(`No current price available for ${instrument.ticker}`, 'market');
  }

  const priceSource = quote?.provenance.source ?? 'market';
  const asOf = quote ? new Date(quote.value.ts).toISOString() : new Date().toISOString();

  if (metric === 'trailingPE' || metric === 'earningsYield') {
    const eps = await ds.getFundamentalSeries(instrument, 'eps', { limit: 8 });
    const ttm = trailingTwelveMonths(eps.value);
    if (ttm === null) {
      throw new NoDataError(
        `${instrument.ticker} has fewer than four quarters of earnings per share filed`,
        'edgar',
      );
    }

    if (metric === 'earningsYield') {
      return {
        metric,
        value: (ttm / price) * 100,
        asOf,
        provenance: {
          status: 'inferred',
          source: `${priceSource} + SEC filings`,
          confidence: 'high',
          derivation: `trailing twelve month earnings per share of ${ttm.toFixed(2)} as a percent of a share price of ${price.toFixed(2)}`,
        },
      };
    }

    /*
      A loss-making company has NO meaningful price to earnings ratio. Dividing
      by a negative number produces a negative multiple, which reads like a
      cheap stock and means the opposite. Refusing is the honest answer, and
      `earningsYield` remains available for exactly this case because a negative
      yield is meaningful where a negative multiple is not.
    */
    if (ttm <= 0) {
      throw new NoDataError(
        `${instrument.ticker} lost money over the last four quarters, so it has no meaningful price to earnings ratio. Use earnings yield instead.`,
        'edgar',
      );
    }

    return {
      metric,
      value: price / ttm,
      asOf,
      provenance: {
        status: 'inferred',
        source: `${priceSource} + SEC filings`,
        confidence: 'high',
        derivation: `share price of ${price.toFixed(2)} divided by trailing twelve month earnings per share of ${ttm.toFixed(2)}`,
      },
    };
  }

  const shares = await ds.getSharesOutstanding(instrument);
  const marketCap = price * shares.value;

  if (metric === 'marketCap') {
    return {
      metric,
      value: marketCap,
      asOf,
      provenance: {
        status: 'inferred',
        source: `${priceSource} + ${shares.provenance.source}`,
        confidence: 'high',
        derivation: `share price of ${price.toFixed(2)} times ${(shares.value / 1e9).toFixed(2)} billion shares outstanding`,
      },
    };
  }

  const revenue = await ds.getFundamentalSeries(instrument, 'revenue', { limit: 8 });
  const ttmRevenue = trailingTwelveMonths(revenue.value);
  if (ttmRevenue === null || ttmRevenue <= 0) {
    throw new NoDataError(
      `${instrument.ticker} has fewer than four quarters of revenue filed`,
      'edgar',
    );
  }

  return {
    metric,
    value: marketCap / ttmRevenue,
    asOf,
    provenance: {
      status: 'inferred',
      source: `${priceSource} + ${shares.provenance.source}`,
      confidence: 'high',
      derivation: `market value of ${(marketCap / 1e9).toFixed(1)} billion divided by trailing twelve month revenue of ${(ttmRevenue / 1e9).toFixed(1)} billion`,
    },
  };
}
