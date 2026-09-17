import * as signal from './providers/signal';
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
  type OrderBook,
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

  /**
   * Health is the Skills probe now, not one call to one dead tool.
   *
   * This used to call global_assets, whose upstream is down, so the entire
   * Skills layer reported unavailable while the MCP transport and
   * technical_analysis were both working fine. A health check aimed at a known
   * broken dependency measures that dependency, not the thing it claims to
   * describe.
   *
   * Healthy now means the handshake succeeded AND at least one Skill returned
   * usable data. Every tool is listed either way, so a partial outage at
   * Bitget's end stays visible instead of collapsing into one boolean.
   *
   * The MCP client itself lives in providers/signal.ts. It was duplicated here
   * as three private methods, which is the sort of second copy that drifts.
   */
  async healthCheck(): Promise<HealthReport> {
    const checkedAt = new Date().toISOString();
    try {
      const tools = await signal.probe();
      return {
        source: this.name,
        healthy: tools.some((t) => t.ok),
        providers: tools.map((t) => ({
          name: `skill:${t.tool}`,
          ok: t.ok,
          latencyMs: t.latencyMs,
          ...(t.detail ? { detail: `${t.detail} (upstream: ${t.upstream})` } : {}),
        })),
        checkedAt,
      };
    } catch (err) {
      return {
        source: this.name,
        healthy: false,
        providers: [{ name: 'datahub-mcp', ok: false, detail: (err as Error).message }],
        checkedAt,
      };
    }
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
  getOrderBook(_i: Instrument, _l?: number): Promise<Sourced<OrderBook>> {
    // No signal tool exposes resting depth even when the backend is healthy.
    // Order book data is Bitget-native and has no equivalent here.
    this.notAvailable('getOrderBook');
  }
  getUnderlyingHistory(_i: Instrument, _p: HistoryPeriod): Promise<Sourced<Candle[]>> {
    this.notAvailable('getUnderlyingHistory');
  }
  getSharesOutstanding(_i: Instrument): Promise<Sourced<number>> {
    this.notAvailable('getSharesOutstanding');
  }

  getSharesOutstandingSeries(_i: Instrument): Promise<Array<{ date: string; value: number }>> {
    this.notAvailable('getSharesOutstandingSeries');
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
