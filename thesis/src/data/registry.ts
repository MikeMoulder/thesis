import { ProviderError, type Instrument, type TradingRules } from './types';
import { SEC_TICKERS_URL, USER_AGENT } from './config';
import { listStockInstruments } from './providers/bitget';

/**
 * Maps a company ticker to everything needed to fetch data about it:
 * the Bitget rToken symbol, the Yahoo symbol, and the SEC CIK.
 *
 * Both catalogs are fetched once and cached for the process lifetime. They
 * change on the order of days, and re-fetching per request would be rude to
 * both providers.
 */

/** Symbol plus the venue's order rules, keyed by underlying ticker. */
export interface RTokenListing {
  symbol: string;
  rules: TradingRules;
}

let rTokenIndex: Map<string, RTokenListing> | null = null;
let cikIndex: Map<string, { cik: string; name: string }> | null = null;

/**
 * Bitget lists tokenized equities on SPOT as R<TICKER>USDT with
 * symbolType "stock" — e.g. NVDA -> RNVDAUSDT (baseCoin "rNVDA").
 * Verified 2026-09-16: 1,175 stock instruments listed.
 */
export async function loadRTokenIndex(): Promise<Map<string, RTokenListing>> {
  if (rTokenIndex) return rTokenIndex;

  const instruments = await listStockInstruments();
  const index = new Map<string, RTokenListing>();
  for (const inst of instruments) {
    // baseCoin is "rNVDA"; strip the leading "r" to get the underlying ticker.
    if (!inst.baseCoin.startsWith('r')) continue;
    index.set(inst.baseCoin.slice(1).toUpperCase(), {
      symbol: inst.symbol,
      /*
        Defaults matter here and are not arbitrary. A missing precision that
        fell back to "unlimited decimals" would generate an order the venue
        rejects; falling back to the tightest plausible value generates one it
        accepts but slightly smaller than asked. Wrong in the safe direction.
      */
      rules: {
        pricePrecision: Number(inst.pricePrecision ?? 2),
        quantityPrecision: Number(inst.quantityPrecision ?? 4),
        minOrderQty: Number(inst.minOrderQty ?? 0),
        minOrderAmount: Number(inst.minOrderAmount ?? 0),
        baseCoin: inst.baseCoin,
        quoteCoin: inst.quoteCoin,
      },
    });
  }
  rTokenIndex = index;
  return index;
}

/** SEC publishes the full ticker -> CIK map as one small JSON file. */
export async function loadCikIndex(): Promise<Map<string, { cik: string; name: string }>> {
  if (cikIndex) return cikIndex;

  const res = await fetch(SEC_TICKERS_URL, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new ProviderError(`SEC ticker map returned ${res.status}`, 'edgar');
  }
  // Shape: { "0": { cik_str: 1045810, ticker: "NVDA", title: "NVIDIA CORP" }, ... }
  const body = (await res.json()) as Record<
    string,
    { cik_str: number; ticker: string; title: string }
  >;

  const index = new Map<string, { cik: string; name: string }>();
  for (const row of Object.values(body)) {
    index.set(row.ticker.toUpperCase(), {
      cik: String(row.cik_str).padStart(10, '0'),
      name: row.title,
    });
  }
  cikIndex = index;
  return index;
}

/**
 * Resolve a ticker into a full Instrument.
 *
 * Missing pieces are left undefined rather than throwing: a company with no
 * rToken listing is still researchable, and a foreign issuer with no CIK still
 * has a price. Callers decide what a missing piece means for them.
 */
export async function resolveInstrument(ticker: string): Promise<Instrument> {
  const key = ticker.trim().toUpperCase();
  const [rTokens, ciks] = await Promise.all([
    loadRTokenIndex().catch(() => new Map<string, RTokenListing>()),
    loadCikIndex().catch(() => new Map<string, { cik: string; name: string }>()),
  ]);

  const sec = ciks.get(key);
  const listing = rTokens.get(key);
  return {
    ticker: key,
    ...(listing ? { rTokenSymbol: listing.symbol, rules: listing.rules } : {}),
    yahooSymbol: key,
    cik: sec?.cik,
    name: sec?.name,
  };
}

/** Test seam — lets unit tests start from a clean cache. */
export function __resetRegistryCache(): void {
  rTokenIndex = null;
  cikIndex = null;
}
