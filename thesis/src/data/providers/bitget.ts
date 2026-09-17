import {
  BitgetApiError,
  BitgetRestClient,
  loadConfig,
  NetworkError,
  type RequestResult,
} from '@bitget-ai/bitget-agent-sdk';

import { BITGET_BASE, REQUEST_TIMEOUT_MS } from '../config';
import {
  NoDataError,
  ProviderError,
  sourced,
  type BookLevel,
  type Candle,
  type Instrument,
  type Interval,
  type OrderBook,
  type Quote,
  type Sourced,
} from '../types';

/**
 * Bitget market data, via the official Bitget Agent Hub SDK.
 *
 * SAFETY POSTURE — this is deliberate and worth keeping:
 *   - readOnly: true       every write tool is stripped at construction
 *   - modules: ['market']  only public market endpoints are reachable
 *   - no credentials       hasAuth is false, so private endpoints cannot be called
 *
 * THESIS never places an order. The human does that on their own account, and
 * this client is structurally incapable of doing it for them.
 *
 * Operations used, resolved through the SDK catalog by operationId rather than
 * hand-written paths:
 *   getInstruments        the rToken catalog
 *   getTickers            live 7x24 quote
 *   getKlineCandlestick   OHLCV
 *   getOrderbook          resting depth, i.e. whether an exit exists at all
 */

let client: BitgetRestClient | null = null;

function getClient(): BitgetRestClient {
  if (client) return client;
  const config = loadConfig({
    readOnly: true,
    modules: 'market',
    baseUrl: BITGET_BASE,
    timeoutMs: REQUEST_TIMEOUT_MS,
    userAgent: 'THESIS/0.1 (research desk; read-only market data)',
  });
  client = new BitgetRestClient(config);
  return client;
}

/**
 * The SDK raises typed errors. Translate them into our vocabulary so callers
 * never need to know which HTTP client is underneath.
 */
async function call<T>(operationId: string, args: Record<string, unknown>): Promise<T> {
  try {
    const result: RequestResult<T> = await getClient().callOperation<T>(operationId, args);
    if (result.data === undefined || result.data === null) {
      throw new NoDataError(`Bitget returned no data for ${operationId}`, 'bitget');
    }
    return result.data;
  } catch (err) {
    if (err instanceof NoDataError) throw err;
    if (err instanceof NetworkError) {
      // Almost always geo-blocking rather than a code fault. Say so plainly.
      throw new ProviderError(
        `Could not reach Bitget (${operationId}). This API is geo-restricted in some regions — check VPN/network.`,
        'bitget',
        err,
      );
    }
    if (err instanceof BitgetApiError) {
      throw new ProviderError(`Bitget API error on ${operationId}: ${err.message}`, 'bitget', err);
    }
    throw new ProviderError(`Bitget call failed (${operationId}): ${(err as Error).message}`, 'bitget', err);
  }
}

// ---------------------------------------------------------------------------

interface RawInstrument {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  symbolType: string;
  status: string;
  /*
    The venue's own order rules. Every one arrives as a STRING, including the
    numeric ones, which is normal for this API and is exactly how a precision
    of "4" silently becomes NaN two layers away. Parsed at the boundary.
  */
  pricePrecision?: string;
  quantityPrecision?: string;
  minOrderQty?: string;
  minOrderAmount?: string;
}

interface RawTicker {
  symbol: string;
  lastPrice: string;
  openPrice24h: string;
  highPrice24h: string;
  lowPrice24h: string;
  bid1Price: string;
  ask1Price: string;
  price24hPcnt: string;
  volume24h: string;
  ts: string;
}

/** Every tokenized equity listed on Bitget spot. Used to build the registry. */
export async function listStockInstruments(): Promise<RawInstrument[]> {
  const rows = await call<RawInstrument[]>('getInstruments', { category: 'SPOT' });
  return rows.filter((i) => i.symbolType === 'stock' && i.status === 'online');
}

function requireRToken(instrument: Instrument): string {
  if (!instrument.rTokenSymbol) {
    throw new NoDataError(`${instrument.ticker} has no rToken listed on Bitget spot`, 'bitget');
  }
  return instrument.rTokenSymbol;
}

export async function getQuote(instrument: Instrument): Promise<Sourced<Quote>> {
  const symbol = requireRToken(instrument);
  const rows = await call<RawTicker[]>('getTickers', { category: 'SPOT', symbol });
  const t = rows[0];
  if (!t) throw new NoDataError(`No ticker returned for ${symbol}`, 'bitget');

  const quote: Quote = {
    symbol: t.symbol,
    last: Number(t.lastPrice),
    open24h: Number(t.openPrice24h),
    high24h: Number(t.highPrice24h),
    low24h: Number(t.lowPrice24h),
    // Bitget reports this as a fraction (0.00019), not a percentage.
    changePct24h: Number(t.price24hPcnt) * 100,
    volume24h: Number(t.volume24h),
    bid: Number(t.bid1Price),
    ask: Number(t.ask1Price),
    ts: Number(t.ts),
  };

  return sourced(quote, {
    status: 'sourced',
    source: `Bitget spot ticker ${symbol} (Agent Hub SDK)`,
    url: `${BITGET_BASE}/api/v3/market/tickers?category=SPOT&symbol=${symbol}`,
    asOf: new Date(quote.ts).toISOString(),
    confidence: 'high',
  });
}

export async function getCandles(
  instrument: Instrument,
  interval: Interval,
  limit = 200,
): Promise<Sourced<Candle[]>> {
  const symbol = requireRToken(instrument);
  // Rows are positional: [ts, open, high, low, close, volume, ...]
  const rows = await call<string[][]>('getKlineCandlestick', {
    category: 'SPOT',
    symbol,
    interval,
    limit: Math.min(limit, 1000),
  });

  const candles: Candle[] = rows
    .map((r) => ({
      ts: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }))
    .sort((a, b) => a.ts - b.ts);

  return sourced(candles, {
    status: 'sourced',
    source: `Bitget spot candles ${symbol} ${interval} (Agent Hub SDK)`,
    url: `${BITGET_BASE}/api/v3/market/candles?category=SPOT&symbol=${symbol}&interval=${interval}`,
    asOf: candles.length ? new Date(candles[candles.length - 1]!.ts).toISOString() : undefined,
    confidence: 'high',
  });
}

/**
 * Resting orders on both sides, best-first.
 *
 * WHY THIS EXISTS, and why the empty case is the point:
 *
 * Every other source we hold describes the past. A ticker gives a last price
 * and a 24 hour volume; candles give what already traded. Neither can tell you
 * whether anyone will take the other side of your exit right now, and for a
 * tokenized equity that gap is not academic. Measured 17 Sep 2026:
 *
 *   RNVDAUSDT   217.74   47.1M volume   5 asks / 5 bids
 *   RNFLXUSDT    76.92   12.4M volume   0 asks / 0 bids
 *   RDISUSDT    107.32    3.9M volume   0 asks / 0 bids
 *
 * Netflix quotes a confident price against an empty book. A stop placed there
 * has nothing to fill against. Of 28 sampled rTokens, 14 had no book at all.
 *
 * So an empty side returns an empty array, never an error: "nobody is bidding"
 * is the most important answer this function gives, and throwing would turn a
 * finding into a failure.
 */
export async function getOrderBook(
  instrument: Instrument,
  limit = 150,
): Promise<Sourced<OrderBook>> {
  const symbol = requireRToken(instrument);
  // Bitget returns `a`/`b` as positional [price, size] pairs, asks then bids.
  const raw = await call<{ a?: Array<[number, number]>; b?: Array<[number, number]>; ts?: string }>(
    'getOrderbook',
    { category: 'SPOT', symbol, limit: Math.min(limit, 200) },
  );

  const level = ([price, size]: [number, number]): BookLevel => ({
    price: Number(price),
    size: Number(size),
  });
  // Sort rather than trust the order: the metrics walk these arrays and a
  // mis-ordered book silently produces a plausible, wrong slippage number.
  const asks = (raw.a ?? []).map(level).sort((x, y) => x.price - y.price);
  const bids = (raw.b ?? []).map(level).sort((x, y) => y.price - x.price);
  const ts = raw.ts ? Number(raw.ts) : Date.now();

  return sourced(
    { symbol, asks, bids, ts },
    {
      status: 'sourced',
      source: `Bitget spot order book ${symbol} (Agent Hub SDK)`,
      url: `${BITGET_BASE}/api/v3/market/orderbook?category=SPOT&symbol=${symbol}&limit=${limit}`,
      asOf: new Date(ts).toISOString(),
      confidence: 'high',
    },
  );
}

export async function ping(): Promise<{ ok: boolean; detail?: string; latencyMs: number }> {
  const t0 = Date.now();
  try {
    await call<RawTicker[]>('getTickers', { category: 'SPOT', symbol: 'RNVDAUSDT' });
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, detail: (err as Error).message, latencyMs: Date.now() - t0 };
  }
}
