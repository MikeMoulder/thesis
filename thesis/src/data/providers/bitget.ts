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
  type Candle,
  type Instrument,
  type Interval,
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

export async function ping(): Promise<{ ok: boolean; detail?: string; latencyMs: number }> {
  const t0 = Date.now();
  try {
    await call<RawTicker[]>('getTickers', { category: 'SPOT', symbol: 'RNVDAUSDT' });
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, detail: (err as Error).message, latencyMs: Date.now() - t0 };
  }
}
