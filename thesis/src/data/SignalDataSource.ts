import { SIGNAL_MCP_URL } from './config';
import type { DataSource, DerivedMetricName, HealthReport, HistoryPeriod } from './DataSource';
import { resolveInstrument } from './registry';
import {
  ProviderError,
  type Candle,
  type DerivedMetric,
  type FundamentalPoint,
  type Instrument,
  type Interval,
  type NewsItem,
  type Quote,
  type Sourced,
} from './types';

/**
 * bitget-signal MCP backend.
 *
 * STATUS AS OF 2026-09-16: NON-FUNCTIONAL. Do not enable without re-testing.
 *
 * The server answers MCP protocol calls correctly — initialize, tools/list, and
 * schemas all work — but it has no working outbound network. Every tool that
 * needs a real fetch fails identically:
 *
 *   global_assets  NVDA/AAPL  -> "Error executing tool global_assets: " (empty)
 *   crypto_price   BTCUSDT    -> ConnectTimeout('')
 *   rates_yields   snapshot   -> every field {"error": ""}
 *   defi_analytics tvl_rank   -> {"error": ""}
 *
 * The only calls that succeed return hardcoded lists compiled into the server
 * (news_feed/sources, social_trending/platforms, cross_asset/assets_list).
 * Verified twice, 11 minutes apart, with identical output. The same upstreams
 * are reachable from our machine, so the fault is on their host.
 *
 * This class exists so that if Bitget repairs the service before submission we
 * flip THESIS_DATA_SOURCE=signal and gain the integration without touching a
 * single call site. Until then it is a documented stub, not a dependency.
 *
 * If revived, the useful surface is:
 *   global_assets(action=price|ohlcv, symbol)  -> Yahoo-backed, covers equities
 *   cross_asset(action=correlation, base, targets)
 *   tradfi_news(action=earnings|news|company)  -> Finnhub, needs FINNHUB_API_KEY
 *   technical_analysis(...)                    -> crypto pairs only
 */
export class SignalDataSource implements DataSource {
  readonly name = 'signal';

  private sessionId: string | null = null;

  async healthCheck(): Promise<HealthReport> {
    const t0 = Date.now();
    try {
      const probe = await this.callTool('global_assets', { action: 'price', symbol: 'NVDA' });
      // A live-data call returning an error payload means degraded, not down.
      const ok = !probe.isError;
      return {
        source: this.name,
        healthy: ok,
        providers: [
          {
            name: 'datahub-mcp',
            ok,
            detail: ok ? undefined : `reachable but no live data: ${probe.text.slice(0, 120)}`,
            latencyMs: Date.now() - t0,
          },
        ],
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        source: this.name,
        healthy: false,
        providers: [
          {
            name: 'datahub-mcp',
            ok: false,
            detail: (err as Error).message,
            latencyMs: Date.now() - t0,
          },
        ],
        checkedAt: new Date().toISOString(),
      };
    }
  }

  /** Minimal MCP streamable-HTTP client: initialize once, then call tools. */
  private async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ text: string; isError: boolean }> {
    if (!this.sessionId) await this.initialize();

    const res = await fetch(SIGNAL_MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': this.sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    if (!res.ok) throw new ProviderError(`signal MCP HTTP ${res.status}`, 'signal');

    // Responses arrive as SSE frames; the payload is the last `data:` line.
    const body = await res.text();
    const line = body
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .pop();
    if (!line) throw new ProviderError('signal MCP returned no data frame', 'signal');

    const parsed = JSON.parse(line.slice(5).trim()) as {
      result?: { content?: Array<{ text?: string }>; isError?: boolean };
    };
    return {
      text: parsed.result?.content?.[0]?.text ?? '',
      isError: parsed.result?.isError ?? false,
    };
  }

  private async initialize(): Promise<void> {
    const res = await fetch(SIGNAL_MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'thesis', version: '0.1.0' },
        },
      }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (!sid) throw new ProviderError('signal MCP did not return a session id', 'signal');
    this.sessionId = sid;

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

  resolve(ticker: string): Promise<Instrument> {
    return resolveInstrument(ticker);
  }

  private notAvailable(what: string): never {
    throw new ProviderError(
      `SignalDataSource.${what} is not implemented — the backend serves no live data as of 2026-09-16. Use THESIS_DATA_SOURCE=direct.`,
      'signal',
    );
  }

  getQuote(_i: Instrument): Promise<Sourced<Quote>> {
    this.notAvailable('getQuote');
  }
  getCandles(_i: Instrument, _iv: Interval, _l?: number): Promise<Sourced<Candle[]>> {
    this.notAvailable('getCandles');
  }
  getUnderlyingHistory(_i: Instrument, _p: HistoryPeriod): Promise<Sourced<Candle[]>> {
    this.notAvailable('getUnderlyingHistory');
  }
  getFundamentalSeries(_i: Instrument, _c: string): Promise<Sourced<FundamentalPoint[]>> {
    this.notAvailable('getFundamentalSeries');
  }
  getDerivedMetric(_i: Instrument, _m: DerivedMetricName): Promise<Sourced<DerivedMetric[]>> {
    this.notAvailable('getDerivedMetric');
  }
  getNews(_i: Instrument): Promise<Sourced<NewsItem[]>> {
    this.notAvailable('getNews');
  }
}
