import type {
  Candle,
  DerivedMetric,
  FundamentalPoint,
  Instrument,
  Interval,
  NewsItem,
  Quote,
  Sourced,
} from './types';

/**
 * The single seam between THESIS and the outside world.
 *
 * Two implementations exist:
 *   - DirectDataSource  — Bitget + Yahoo + SEC EDGAR. What we ship.
 *   - SignalDataSource  — the bitget-signal MCP backend. Currently non-functional
 *                         (see docs/data-layer.md); flag-gated so it can be
 *                         switched on without touching call sites.
 *
 * Everything returns Sourced<T> so provenance survives all the way to the UI.
 */
export interface DataSource {
  readonly name: string;

  /** Whether this source is currently usable. Checked at startup. */
  healthCheck(): Promise<HealthReport>;

  /** Resolve a company ticker to its tradable instrument + filing identity. */
  resolve(ticker: string): Promise<Instrument>;

  // -- Live instrument state (the thing you would actually trade) ------------

  /**
   * Current quote for the tradable instrument (the rToken where listed).
   * This is the 7x24 price — the reason the product needs a live market.
   */
  getQuote(instrument: Instrument): Promise<Sourced<Quote>>;

  /** Recent candles for the tradable instrument. */
  getCandles(
    instrument: Instrument,
    interval: Interval,
    limit?: number,
  ): Promise<Sourced<Candle[]>>;

  // -- Long-horizon history (the company, not the token) --------------------

  /**
   * Underlying equity history, used for historical base rates.
   *
   * Deliberately separate from getCandles: rTokens have only ~90 days of
   * history, which is far too short to compute how often a thesis breaker has
   * fired before. Base rates come from the underlying; live state comes from
   * the token.
   */
  getUnderlyingHistory(
    instrument: Instrument,
    period: HistoryPeriod,
  ): Promise<Sourced<Candle[]>>;

  // -- Fundamentals ---------------------------------------------------------

  /**
   * Reported figures for one XBRL concept, newest last.
   * Each point cites the filing it came from.
   */
  getFundamentalSeries(
    instrument: Instrument,
    concept: string,
    opts?: { periodType?: 'quarterly' | 'annual'; limit?: number },
  ): Promise<Sourced<FundamentalPoint[]>>;

  /**
   * A derived ratio (e.g. gross margin) with its inputs retained.
   * Always provenance 'inferred' — we computed it, the filing did not report it.
   */
  getDerivedMetric(
    instrument: Instrument,
    metric: DerivedMetricName,
    opts?: { limit?: number },
  ): Promise<Sourced<DerivedMetric[]>>;

  /**
   * Shares outstanding, so a share price can become a company valuation.
   *
   * Sits beside the fundamentals because it comes from the same filings, but it
   * is a single instantaneous figure rather than a series: a share count is a
   * fact about a moment, not about a period.
   */
  getSharesOutstanding(instrument: Instrument): Promise<Sourced<number>>;

  /**
   * The share count over time, dated by when each figure became knowable.
   * Needed to value a company as it stood at a past moment rather than now.
   */
  getSharesOutstandingSeries(instrument: Instrument): Promise<Array<{ date: string; value: number }>>;

  // -- News -----------------------------------------------------------------

  getNews(
    instrument: Instrument,
    opts?: { limit?: number; since?: string },
  ): Promise<Sourced<NewsItem[]>>;
}

export type DerivedMetricName =
  | 'grossMargin'
  | 'operatingMargin'
  | 'netMargin'
  | 'revenueGrowthYoY';

export type HistoryPeriod = '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | 'max';

export interface HealthReport {
  source: string;
  healthy: boolean;
  /** Per-provider detail, so a partial outage is visible rather than silent. */
  providers: Array<{
    name: string;
    ok: boolean;
    detail?: string;
    latencyMs?: number;
  }>;
  checkedAt: string;
}
