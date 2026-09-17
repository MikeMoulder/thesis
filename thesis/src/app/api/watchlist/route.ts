import { getDataSource } from '@/data/index';

/**
 * Live quotes for the sidebar watchlist.
 *
 * These are the tokenised US stocks on Bitget, which is the whole reason this
 * product can say anything about a US equity outside New York trading hours.
 * The sidebar is where that shows: a watchlist that is actually moving at 3am
 * is the 24/7 argument made without a paragraph about it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WATCHLIST = ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMD', 'META'] as const;

export interface WatchRow {
  ticker: string;
  name?: string;
  last?: number;
  changePct24h?: number;
  /** Why this row has no price, when it has none. */
  error?: string;
}

export async function GET(): Promise<Response> {
  const ds = getDataSource();

  // In parallel: six sequential round trips would make the sidebar the slowest
  // thing on the page, and it is the least important.
  const rows = await Promise.all(
    WATCHLIST.map(async (ticker): Promise<WatchRow> => {
      try {
        const instrument = await ds.resolve(ticker);
        const quote = await ds.getQuote(instrument);
        return {
          ticker,
          ...(instrument.name ? { name: instrument.name } : {}),
          last: quote.value.last,
          ...(quote.value.changePct24h !== undefined
            ? { changePct24h: quote.value.changePct24h }
            : {}),
        };
      } catch (error) {
        // One unlisted or unreachable ticker must not empty the whole list.
        return {
          ticker,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  return Response.json(
    { rows, asOf: new Date().toISOString() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
