import type { DataSource, DerivedMetricName, HealthReport, HistoryPeriod } from './DataSource';
import { resolveInstrument } from './registry';
import * as bitget from './providers/bitget';
import * as yahoo from './providers/yahoo';
import * as edgar from './providers/edgar';
import {
  NoDataError,
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
 * The shipping data source: Bitget for live rToken state, Yahoo for underlying
 * history, SEC EDGAR for fundamentals.
 *
 * This composition is deliberate. Each provider answers the question it is
 * actually authoritative for:
 *
 *   Bitget  — what is the tokenized instrument trading at right now, 7x24
 *   Yahoo   — what has the underlying company's price done over years
 *   EDGAR   — what has the company actually reported, with a filing to cite
 */
export class DirectDataSource implements DataSource {
  readonly name = 'direct';

  async healthCheck(): Promise<HealthReport> {
    const [b, y, e] = await Promise.all([bitget.ping(), yahoo.ping(), edgar.ping()]);
    const providers = [
      { name: 'bitget', ...b },
      { name: 'yahoo', ...y },
      { name: 'edgar', ...e },
    ];
    return {
      source: this.name,
      // EDGAR and Yahoo are load-bearing for research. Bitget is load-bearing
      // for live quotes but a thesis can still be analysed without it.
      healthy: e.ok && y.ok,
      providers,
      checkedAt: new Date().toISOString(),
    };
  }

  resolve(ticker: string): Promise<Instrument> {
    return resolveInstrument(ticker);
  }

  getQuote(instrument: Instrument): Promise<Sourced<Quote>> {
    return bitget.getQuote(instrument);
  }

  getCandles(
    instrument: Instrument,
    interval: Interval,
    limit?: number,
  ): Promise<Sourced<Candle[]>> {
    return bitget.getCandles(instrument, interval, limit);
  }

  getOrderBook(instrument: Instrument, limit?: number): Promise<Sourced<OrderBook>> {
    return bitget.getOrderBook(instrument, limit);
  }

  getUnderlyingHistory(
    instrument: Instrument,
    period: HistoryPeriod,
  ): Promise<Sourced<Candle[]>> {
    return yahoo.getUnderlyingHistory(instrument, period);
  }

  getSharesOutstanding(instrument: Instrument): Promise<Sourced<number>> {
    return edgar.getSharesOutstanding(instrument);
  }

  getSharesOutstandingSeries(instrument: Instrument) {
    return edgar.getSharesOutstandingSeries(instrument);
  }

  getFundamentalSeries(
    instrument: Instrument,
    concept: string,
    opts?: { periodType?: 'quarterly' | 'annual'; limit?: number },
  ): Promise<Sourced<FundamentalPoint[]>> {
    return edgar.getFundamentalSeries(instrument, concept, opts);
  }

  getDerivedMetric(
    instrument: Instrument,
    metric: DerivedMetricName,
    opts?: { limit?: number },
  ): Promise<Sourced<DerivedMetric[]>> {
    return edgar.getDerivedMetric(instrument, metric, opts);
  }

  async getNews(
    _instrument: Instrument,
    _opts?: { limit?: number; since?: string },
  ): Promise<Sourced<NewsItem[]>> {
    // Not yet wired. Throwing NoDataError rather than returning [] is
    // deliberate: an empty array reads as "no news exists", which is a
    // different and much more misleading claim than "not implemented".
    throw new NoDataError('News provider not yet wired', 'direct');
  }
}
