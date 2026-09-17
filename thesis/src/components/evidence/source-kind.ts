import {
  ChartCandlestick,
  CircleDashed,
  CircleSlash,
  FileText,
  GitBranch,
  Newspaper,
  ShieldCheck,
  Sigma,
  type LucideIcon,
} from 'lucide-react';

import type { Provenance, ProvenanceStatus } from '@/data/types';

/**
 * A citation chip carries TWO icons, and they answer two different questions:
 *
 *   trust icon  — how far should I trust this number?
 *   kind icon   — what kind of thing produced it?
 *
 * Splitting them matters because the answers are independent. A filing is a
 * strong source; a ratio we computed *from* two filings is a weaker claim from
 * the same strong source. One icon cannot say both.
 */

export type SourceKind = 'filing' | 'market' | 'news' | 'derived' | 'none';

/** Vendors we hold a real logo for. Anything else falls back to a kind icon. */
export type SourceBrand = 'bitget' | 'yahoo';

export const KIND_ICON: Record<SourceKind, LucideIcon> = {
  filing: FileText,
  market: ChartCandlestick,
  news: Newspaper,
  derived: GitBranch,
  none: CircleSlash,
};

export const TRUST_ICON: Record<ProvenanceStatus, LucideIcon> = {
  sourced: ShieldCheck,
  inferred: Sigma, // computed by us — the reasoning step is ours, not the filer's
  unverifiable: CircleDashed,
};

/**
 * Infer a kind and a short label from the free-text `source` string.
 *
 * This is best-effort by design: callers that know better pass `kind`
 * explicitly. It never throws and always returns something renderable, because
 * a chip that fails to render would hide a citation — the opposite of the point.
 */
export function describeSource(provenance: Provenance): {
  kind: SourceKind;
  label: string;
  brand?: SourceBrand;
} {
  const { status, source } = provenance;

  if (status === 'unverifiable' || !source || source === 'none') {
    return { kind: 'none', label: 'no evidence' };
  }

  /*
    Our own source strings put the vendor first and the specific series after a
    "·" — "Bitget Agent Hub · spot ticker RNVDAUSDT". When a logo is shown, the
    word "Bitget" beside the Bitget mark is redundant, so the label becomes the
    specific half instead. The mark says who; the label says which.

    This parses a format we control, not a third party's, so it is a convention
    rather than a guess.
  */
  const detail = source.includes('·') ? source.split('·').pop()?.trim() : undefined;
  const tighten = (text: string) => text.replace(/^(spot ticker|chart)\s+/i, '');

  // "SEC 10-Q 0001045810-26-000075" → 10-Q · "SEC 10-K ..." → 10-K · 8-K → 8-K
  const form = /\b(10-[QK]|8-K|20-F|6-K|S-1)\b/i.exec(source);
  if (form?.[1]) {
    return { kind: 'filing', label: form[1].toUpperCase() };
  }
  if (/\bsec\b|edgar|xbrl/i.test(source)) {
    return { kind: 'filing', label: 'SEC' };
  }
  if (/bitget|rtoken|agent hub/i.test(source)) {
    return { kind: 'market', brand: 'bitget', label: detail ? tighten(detail) : 'Bitget' };
  }
  if (/yahoo/i.test(source)) {
    return { kind: 'market', brand: 'yahoo', label: detail ? tighten(detail) : 'Yahoo' };
  }
  if (/news|rss|finnhub|headline/i.test(source)) {
    return { kind: 'news', label: 'News' };
  }
  if (status === 'inferred') {
    return { kind: 'derived', label: 'derived' };
  }

  // Unrecognised but real: show it rather than swallowing it.
  return { kind: 'derived', label: source.length > 22 ? `${source.slice(0, 21)}…` : source };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format an ISO date as "26 Aug 2026", in UTC.
 *
 * Deliberately hand-rolled rather than `toLocaleDateString`: locale formatting
 * differs between the server and the browser, which produces a React hydration
 * mismatch on every single citation in the page. Fixed UTC output is stable.
 */
export function formatAsOf(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const month = MONTHS[date.getUTCMonth()];
  if (!month) return null;
  return `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`;
}
