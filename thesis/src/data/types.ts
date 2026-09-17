/**
 * Core data types for the THESIS data layer.
 *
 * Design rule: every fact that reaches an LLM agent carries provenance.
 * A claim without a source is not a claim, it is a guess — and the whole
 * product depends on being able to tell those apart.
 */

/** Where a fact came from, and how much of it is the system's own reasoning. */
export type ProvenanceStatus =
  /** Directly supported by retrieved data. A citation exists. */
  | 'sourced'
  /** Derived by the system from sourced data. The reasoning step is ours. */
  | 'inferred'
  /** No reliable evidence could be established. */
  | 'unverifiable';

export type Confidence = 'high' | 'moderate' | 'low';

export interface Provenance {
  status: ProvenanceStatus;
  /** Human-readable origin, e.g. "SEC 10-Q 0001045810-26-000075". */
  source: string;
  /** Resolvable link to the underlying document or endpoint, when one exists. */
  url?: string;
  /** When the underlying data was published or observed (ISO 8601). */
  asOf?: string;
  confidence?: Confidence;
  /** If status is 'inferred', what reasoning produced it. */
  derivation?: string;
}

/** A value plus where it came from. The atom of the whole system. */
export interface Sourced<T> {
  value: T;
  provenance: Provenance;
}

export function sourced<T>(value: T, provenance: Provenance): Sourced<T> {
  return { value, provenance };
}

export function unverifiable<T>(reason: string): Sourced<T | null> {
  return {
    value: null,
    provenance: {
      status: 'unverifiable',
      source: 'none',
      derivation: reason,
      confidence: 'low',
    },
  };
}

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

/**
 * A thesis is about a *company*; a trade happens in an *instrument*.
 * Keeping these separate matters: rNVDA has ~90 days of history, NVDA has
 * decades. Historical base rates come from the company, live state from the
 * instrument.
 */
export interface Instrument {
  /** Underlying equity ticker, e.g. "NVDA". The company identity. */
  ticker: string;
  /** Bitget rToken spot symbol, e.g. "RNVDAUSDT". Undefined if not listed. */
  rTokenSymbol?: string;
  /** Yahoo Finance symbol for the underlying, usually the ticker itself. */
  yahooSymbol: string;
  /** SEC Central Index Key, zero-padded to 10 digits. */
  cik?: string;
  name?: string;
}

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------

export interface Quote {
  symbol: string;
  last: number;
  open24h?: number;
  high24h?: number;
  low24h?: number;
  changePct24h?: number;
  volume24h?: number;
  bid?: number;
  ask?: number;
  /** Epoch milliseconds. */
  ts: number;
}

export interface Candle {
  /** Epoch milliseconds, bar open time. */
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Interval = '1m' | '5m' | '15m' | '30m' | '1H' | '4H' | '1D' | '1W';

/** One resting order level: the price, and the size available at it. */
export interface BookLevel {
  price: number;
  /** Size in base units, i.e. tokens, not currency. */
  size: number;
}

/**
 * A snapshot of resting orders on both sides of the book.
 *
 * This is the only source that can answer whether a position can actually be
 * closed, and it disagrees with every other source we hold. A ticker reports a
 * last price and a 24 hour volume for instruments that have NO resting orders
 * at all: rNFLX showed 76.92 and 12.4M of volume with zero bids and zero asks
 * on 17 Sep 2026. Price and volume describe what already happened. Only the
 * book describes what could happen next.
 *
 * Both sides are sorted best-first: `asks` ascending from the lowest offer,
 * `bids` descending from the highest bid. An empty side is a real answer, not
 * a failure, so it is represented as an empty array rather than an error.
 */
export interface OrderBook {
  symbol: string;
  /** Lowest offers first. Empty when nobody is offering. */
  asks: BookLevel[];
  /** Highest bids first. Empty when nobody is bidding. */
  bids: BookLevel[];
  /** Epoch milliseconds the snapshot was taken. */
  ts: number;
}

// ---------------------------------------------------------------------------
// Fundamentals
// ---------------------------------------------------------------------------

/**
 * One reported figure from one filing.
 * `accession` is what makes the claim checkable by a human.
 */
export interface FundamentalPoint {
  /** XBRL concept, e.g. "GrossProfit". */
  concept: string;
  /** Period start (ISO date), absent for instantaneous facts. */
  start?: string;
  /** Period end (ISO date). */
  end: string;
  value: number;
  unit: string;
  /** "10-Q" | "10-K" | ... */
  form: string;
  /** SEC accession number, e.g. "0001045810-26-000075". */
  accession: string;
  /** Date the filing was submitted (ISO date). */
  filed: string;
  /**
   * Earliest filing date that reported this period.
   *
   * Distinct from `filed` and it matters for historical base rates. A 10-Q also
   * restates the prior-year comparative quarter, so the most recent filing
   * carrying a period can post-date the market first learning it by a year.
   * Measuring "what happened after gross margin fell" from `filed` would start
   * the clock long after the market had already reacted.
   *
   * `value` still comes from the latest filing — restatements supersede — but
   * the event date is this.
   */
  firstFiled: string;
  /** Fiscal year / period as reported. */
  fy?: number;
  fp?: string;
  /**
   * True when this point was computed rather than read from a filing.
   * Currently only fiscal Q4, which issuers report solely inside the annual
   * 10-K totals. A derived point must never be presented as a filed figure.
   */
  derived?: boolean;
  /** How a derived point was computed. Required when `derived` is true. */
  derivation?: string;
}

/** A derived ratio with the inputs that produced it kept attached. */
export interface DerivedMetric {
  name: string;
  end: string;
  value: number;
  unit: string;
  inputs: FundamentalPoint[];
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a provider is reachable but has no data for the request.
 * Distinct from a transport failure: "no data" is a real answer that the
 * system should surface as `unverifiable`, not retry.
 */
export class NoDataError extends Error {
  constructor(
    message: string,
    readonly provider: string,
  ) {
    super(message);
    this.name = 'NoDataError';
  }
}

/** Thrown when a provider could not be reached or returned an error. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
