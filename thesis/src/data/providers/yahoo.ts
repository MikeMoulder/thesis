import { REQUEST_TIMEOUT_MS, YAHOO_CHART_BASE } from '../config';
import {
  NoDataError,
  ProviderError,
  sourced,
  type Candle,
  type Instrument,
  type Sourced,
} from '../types';
import type { HistoryPeriod } from '../DataSource';

/**
 * Yahoo Finance chart API — long-horizon history for the *underlying* equity.
 *
 * Why this exists alongside Bitget: rTokens listed around 2026-06, so rNVDA has
 * roughly 90 days of daily bars. Historical base rates for thesis breakers need
 * years. The company has that history even though the token does not.
 *
 * Unofficial endpoint. It is stable and keyless, but it is not a contract —
 * hence the narrow surface and the health check.
 */

interface YahooChartResponse {
  chart: {
    result?: Array<{
      meta: { symbol: string; regularMarketPrice?: number; currency?: string };
      timestamp?: number[];
      indicators: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
    error?: { code: string; description: string } | null;
  };
}

export async function getUnderlyingHistory(
  instrument: Instrument,
  period: HistoryPeriod = '5y',
  interval: '1d' | '1wk' | '1mo' = '1d',
): Promise<Sourced<Candle[]>> {
  const symbol = instrument.yahooSymbol;
  const url = `${YAHOO_CHART_BASE}/${encodeURIComponent(symbol)}?range=${period}&interval=${interval}`;

  let res: Response;
  try {
    res = await fetch(url, {
      // Yahoo rejects requests with no UA.
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; THESIS/0.1)' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new ProviderError(`Could not reach Yahoo Finance (${symbol})`, 'yahoo', cause);
  }
  if (!res.ok) throw new ProviderError(`Yahoo HTTP ${res.status} for ${symbol}`, 'yahoo');

  const body = (await res.json()) as YahooChartResponse;
  if (body.chart.error) {
    throw new NoDataError(`Yahoo: ${body.chart.error.description} (${symbol})`, 'yahoo');
  }

  const result = body.chart.result?.[0];
  const ts = result?.timestamp;
  const q = result?.indicators.quote?.[0];
  if (!result || !ts || !q) throw new NoDataError(`No history returned for ${symbol}`, 'yahoo');

  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q.close?.[i];
    // Yahoo pads holidays and halts with nulls; drop those bars entirely
    // rather than forward-filling, which would invent price action.
    if (close == null) continue;
    candles.push({
      ts: ts[i]! * 1000,
      open: q.open?.[i] ?? close,
      high: q.high?.[i] ?? close,
      low: q.low?.[i] ?? close,
      close,
      volume: q.volume?.[i] ?? 0,
    });
  }

  if (candles.length === 0) throw new NoDataError(`All bars empty for ${symbol}`, 'yahoo');

  return sourced(candles, {
    status: 'sourced',
    source: `Yahoo Finance ${symbol} ${period}/${interval}`,
    url,
    asOf: new Date(candles[candles.length - 1]!.ts).toISOString(),
    confidence: 'high',
  });
}

export async function ping(): Promise<{ ok: boolean; detail?: string; latencyMs: number }> {
  const t0 = Date.now();
  try {
    await getUnderlyingHistory(
      { ticker: 'NVDA', yahooSymbol: 'NVDA' },
      '1mo',
    );
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, detail: (err as Error).message, latencyMs: Date.now() - t0 };
  }
}
