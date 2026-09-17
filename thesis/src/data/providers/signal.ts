import { SIGNAL_MCP_URL } from '../config';
import { ProviderError } from '../types';

/**
 * The bitget-signal Skills, over MCP.
 *
 * Bitget ships a set of research Skills as an MCP server. This is the client
 * for them, lifted out of SignalDataSource so it is a provider in its own right
 * rather than three private methods on a class that cannot currently be used.
 *
 * ## What actually works, measured rather than assumed
 *
 * The server is not down. It answers the protocol correctly: initialize,
 * tools/list and every schema come back clean. What it mostly lacks is
 * outbound network, and the split is by UPSTREAM rather than by tool.
 * Re-tested 17 Sep 2026, one day after the first check, with identical results:
 *
 *   technical_analysis      exchange/CCXT      WORKS, real values
 *   macro_indicators        FRED               {"error": ""}
 *   derivatives_sentiment   Binance futures    {"error": ""}
 *   crypto_market           CoinGecko          ConnectTimeout
 *   cross_asset             Yahoo              empty error
 *   global_assets           Yahoo              empty error
 *   sentiment_index         alternative.me     {"alt_me_error": ""}
 *   news_feed               44 RSS feeds       every feed empty
 *
 * One working upstream out of eight. That is a fact about their host, not
 * about this code, and it is reported rather than hidden: `probe()` calls the
 * tools for real and says which answered.
 *
 * ## Why this is wired at all
 *
 * Two reasons, and neither is decoration.
 *
 * First, `technical_analysis` genuinely works and genuinely applies. rTokens
 * trade against USDT on a crypto venue, 7x24. While US equity markets are
 * shut, the participant setting the price of rNVDA is a crypto market
 * participant, so crypto risk appetite is real overnight context for an equity
 * thesis. It is used as a labelled proxy and never as a prediction.
 *
 * Second, everything above is checked live. If Bitget repairs the host before
 * the deadline, the tools light up here with no code change, and `probe()`
 * will say so on the next page load rather than waiting for someone to notice.
 */

/** One tool call's outcome, kept raw so the caller decides what it means. */
export interface ToolResult {
  text: string;
  isError: boolean;
}

/** What `probe` reports per tool. */
export interface ToolProbe {
  tool: string;
  /** True only when the tool returned usable data, not merely a 200. */
  ok: boolean;
  latencyMs: number;
  /** The upstream this tool depends on, so a failure points somewhere. */
  upstream: string;
  detail?: string;
}

/**
 * How long a single Skill call may take before it is treated as unavailable.
 *
 * Bounded tightly because the failing tools do not fail fast. Measured on a
 * live probe: technical_analysis answered in 2.2s, while global_assets took
 * 17s, macro_indicators 21s, news_feed 22s and sentiment_index 32s to produce
 * nothing. Waiting for all of them serially is over a minute, and this data
 * feeds a health panel someone is looking at.
 *
 * A tool that cannot answer in six seconds is unavailable for our purposes,
 * which is the honest reading anyway.
 */
export const SIGNAL_TIMEOUT_MS = Number(process.env.SIGNAL_TIMEOUT_MS ?? 6_000);

let sessionId: string | null = null;

/** MCP streamable HTTP: initialize once, then call tools on that session. */
async function initialize(): Promise<void> {
  const res = await fetch(SIGNAL_MCP_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(SIGNAL_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'thesis', version: '0.1' },
      },
    }),
  });
  const sid = res.headers.get('mcp-session-id');
  if (!sid) throw new ProviderError('signal MCP gave no session id', 'signal');
  sessionId = sid;

  await fetch(SIGNAL_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sid,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
}


export async function callTool(
  name: string,
  args: Record<string, unknown>,
  timeoutMs = SIGNAL_TIMEOUT_MS,
): Promise<ToolResult> {
  if (!sessionId) await initialize();

  const res = await fetch(SIGNAL_MCP_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId!,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  if (!res.ok) {
    // A dead session is recoverable; drop it so the next call re-initializes.
    if (res.status === 404 || res.status === 400) sessionId = null;
    throw new ProviderError(`signal MCP HTTP ${res.status} on ${name}`, 'signal');
  }

  // Responses arrive as SSE frames; the payload is the last `data:` line.
  const line = (await res.text())
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .pop();
  if (!line) throw new ProviderError(`signal MCP returned no data frame for ${name}`, 'signal');

  const parsed = JSON.parse(line.slice(5).trim()) as {
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  return {
    text: parsed.result?.content?.[0]?.text ?? '',
    isError: parsed.result?.isError ?? false,
  };
}

/**
 * Whether a tool's reply actually carries data.
 *
 * The server returns HTTP 200 and a well-formed MCP envelope for calls whose
 * upstream failed, so status alone says nothing. The failures all look the
 * same from outside: an `error` key holding an empty string, or a body of
 * empty item lists. Both parse as valid JSON, which is precisely why this has
 * to be checked rather than assumed.
 */
export function carriesData(text: string): boolean {
  if (!text.trim()) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON, but non-empty. Prose from a healthy tool counts.
    return true;
  }

  const empty = (node: unknown): boolean => {
    if (Array.isArray(node)) return node.length === 0 || node.every(empty);
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      const keys = Object.keys(record);
      if (keys.length === 0) return true;

      // The signature failure: every key is an error field, all of them blank.
      const errorish = keys.filter((k) => /error/i.test(k));
      if (errorish.length === keys.length && errorish.every((k) => !String(record[k]).trim())) {
        return true;
      }

      /*
        Labels are not data.

        news_feed replies with one object per feed: {"feed": "coindesk",
        "error": "", "items": []}. Every scalar on it is a NAME, and the only
        payload is `items`, which is empty. A naive "does any field have a
        value" check sees "coindesk" and calls it data, which is how a
        completely empty news feed reported healthy in the first live probe.

        So where an object carries any array, those arrays ARE the payload and
        the scalars beside them are labels describing it. Empty arrays mean
        nothing came back, whatever the labels say.
      */
      const arrayKeys = keys.filter((k) => Array.isArray(record[k]));
      if (arrayKeys.length > 0) return arrayKeys.every((k) => empty(record[k]));

      // No arrays: a container whose every value is empty carries nothing.
      return keys.every((k) => (/error/i.test(k) ? !String(record[k]).trim() : empty(record[k])));
    }
    return node === null || node === undefined || String(node).trim() === '';
  };

  return !empty(parsed);
}

/**
 * The tools worth probing, with the upstream each one depends on.
 *
 * Naming the upstream is the point. "news_feed is down" invites someone to go
 * looking in this repository; "news_feed depends on 44 RSS feeds the Bitget
 * host cannot currently reach" says where the fault actually is.
 */
const PROBES: Array<{ tool: string; args: Record<string, unknown>; upstream: string }> = [
  {
    tool: 'technical_analysis',
    args: { action: 'rsi', symbol: 'BTC/USDT', timeframe: '4h' },
    upstream: 'exchange OHLCV',
  },
  { tool: 'global_assets', args: { action: 'price', symbol: 'NVDA' }, upstream: 'Yahoo Finance' },
  { tool: 'news_feed', args: { action: 'latest', limit: 1 }, upstream: '44 RSS feeds' },
  { tool: 'sentiment_index', args: { action: 'current' }, upstream: 'alternative.me' },
  { tool: 'macro_indicators', args: { action: 'latest_release', indicator: 'cpi' }, upstream: 'FRED' },
];

/**
 * Call every probed tool for real and report what came back.
 *
 * Deliberately not cached and deliberately not faked. This is the evidence for
 * every claim this file makes about which Skills work, and a claim that is not
 * re-checked on demand is a claim that quietly goes stale.
 */
export async function probe(): Promise<ToolProbe[]> {
  return Promise.all(
    PROBES.map(async ({ tool, args, upstream }) => {
      const started = Date.now();
      try {
        const result = await callTool(tool, args);
        const ok = !result.isError && carriesData(result.text);
        return {
          tool,
          ok,
          upstream,
          latencyMs: Date.now() - started,
          ...(ok ? {} : { detail: result.text.slice(0, 140) || 'empty response' }),
        };
      } catch (err) {
        return {
          tool,
          ok: false,
          upstream,
          latencyMs: Date.now() - started,
          detail:
            (err as Error).name === 'TimeoutError'
              ? `no answer within ${SIGNAL_TIMEOUT_MS}ms`
              : (err as Error).message.slice(0, 140),
        };
      }
    }),
  );
}

/**
 * Crypto market state, from the one Skill whose upstream works.
 *
 * ## What this is for, stated carefully
 *
 * An rToken is an equity wrapper trading against USDT on a crypto exchange,
 * around the clock. For roughly two thirds of every weekday and all weekend,
 * the US equity market that "sets" NVDA's price is closed, and the only people
 * pricing rNVDA are crypto market participants.
 *
 * So this is CONTEXT for the hours when the underlying market is shut, and it
 * is labelled that way everywhere it surfaces. It is NOT a claim that BTC
 * predicts rNVDA, and no breaker is generated from it. Asserting a correlation
 * we have not measured would be exactly the kind of plausible, unverified
 * number this product exists to refuse.
 */
export interface CryptoSessionRisk {
  symbol: string;
  timeframe: string;
  rsi: number;
  /** The Skill's own reading: overbought, oversold or neutral. */
  signal: string;
  checkedAt: string;
}

export async function getCryptoSessionRisk(
  symbol = 'BTC/USDT',
  timeframe = '4h',
): Promise<CryptoSessionRisk> {
  const result = await callTool('technical_analysis', { action: 'rsi', symbol, timeframe });
  if (result.isError || !carriesData(result.text)) {
    throw new ProviderError(
      `bitget-signal technical_analysis returned no data for ${symbol}`,
      'signal',
    );
  }

  const parsed = JSON.parse(result.text) as {
    rsi?: number;
    signal?: string;
    error?: string;
  };
  if (parsed.error || typeof parsed.rsi !== 'number') {
    throw new ProviderError(
      `bitget-signal technical_analysis could not read ${symbol}: ${parsed.error ?? 'no rsi'}`,
      'signal',
    );
  }

  return {
    symbol,
    timeframe,
    rsi: parsed.rsi,
    signal: parsed.signal ?? 'unknown',
    checkedAt: new Date().toISOString(),
  };
}

export async function ping(): Promise<{ ok: boolean; detail?: string; latencyMs: number }> {
  const started = Date.now();
  try {
    // Probe with the tool that WORKS, not one that does not.
    //
    // This health check used to call global_assets, whose upstream is dead, so
    // the whole Skills layer reported as down while the MCP transport and
    // technical_analysis were both fine. A health check pointed at a known
    // broken dependency measures the dependency, not the thing it is meant to
    // describe.
    await getCryptoSessionRisk();
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, detail: (err as Error).message, latencyMs: Date.now() - started };
  }
}
