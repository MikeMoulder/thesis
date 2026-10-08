/**
 * Headlines for event tripwires, from Google News search RSS.
 *
 * Some beliefs cannot be read off a number: "Nvidia announces aggressive
 * pricing", "guidance is cut at the next call". Until this existed THESIS said
 * "no news feed is connected, watch for this yourself" and stopped there.
 *
 * WHAT A HEADLINE IS ALLOWED TO DO
 *
 * Point. Never decide. A keyword match on a headline is noisy: a search for
 * Nvidia pricing returns stories about AMD cards and ASUS discounts. So a hit
 * never fires a tripwire and never changes a belief's health. It is shown as
 * "may report this, read it", and the belief stays one that only the person
 * can settle. Firing on a headline would be the product inventing a break.
 *
 * WHY THIS FEED
 *
 * Free, keyless, and searchable by phrase and date. Bitget's own US stock
 * data service carries news too, and returned 503 on every query when we
 * tried it on 7 October. When it answers, it can replace this.
 *
 * No model calls, ever: this runs inside the fifteen-minute loop, whose
 * measured model-call count must stay zero.
 */

import type { Instrument } from '../types';

export interface NewsHit {
  title: string;
  /** The publication, from the " - Source" suffix Google adds. */
  source: string | null;
  url: string;
  publishedAt: string;
}

export interface NewsWatch {
  /** The search that was run, so a reader can run it themselves. */
  query: string;
  hits: NewsHit[];
  /** Headlines the feed returned before the relevance filter. */
  scanned: number;
  checkedAt: string;
}

/** How far back a headline counts. A week covers a weekend and a slow news day. */
export const NEWS_WINDOW_DAYS = 7;

/** Shown per tripwire. More than this is a search page, not a pointer. */
export const NEWS_MAX_HITS = 3;

const FEED = 'https://news.google.com/rss/search';
const TIMEOUT_MS = 8_000;

/** Suffixes SEC names carry that no headline ever uses. */
const LEGAL_SUFFIX =
  /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|holdings?|group|sa|nv|ag|class [a-c]|the)\b\.?/gi;

/** First words too generic to identify a company on their own. */
const GENERIC_FIRST = new Set([
  'advanced', 'american', 'united', 'general', 'international', 'first', 'national', 'global', 'new',
]);

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * The names a headline would use for this company.
 *
 * "ADVANCED MICRO DEVICES INC" gives "Advanced Micro Devices" and AMD, but not
 * "Advanced", which would match half the market. "NVIDIA CORP" gives "Nvidia"
 * and NVDA. "Meta Platforms, Inc." gives "Meta Platforms" and "Meta".
 */
export function companyAliases(instrument: Pick<Instrument, 'ticker' | 'name'>): string[] {
  const aliases = new Set<string>([instrument.ticker.toUpperCase()]);
  const cleaned = (instrument.name ?? '')
    .replace(/[,.]/g, ' ')
    .replace(LEGAL_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned) {
    aliases.add(titleCase(cleaned));
    const first = cleaned.split(' ')[0] ?? '';
    if (first.length >= 4 && !GENERIC_FIRST.has(first.toLowerCase())) aliases.add(titleCase(first));
  }
  return [...aliases];
}

/** Google News query: any name for the company, any keyword, the last week. */
export function newsQuery(aliases: string[], keywords: string[]): string {
  const quote = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
  const who = aliases.map(quote).join(' OR ');
  const what = keywords.map(quote).join(' OR ');
  return `(${who}) (${what}) when:${NEWS_WINDOW_DAYS}d`;
}

function decode(s: string): string {
  return s
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .trim();
}

function tag(item: string, name: string): string | null {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(item);
  return m ? decode(m[1]!) : null;
}

/** Parse an RSS document. Malformed items are skipped, never guessed at. */
export function parseRss(xml: string): NewsHit[] {
  const out: NewsHit[] = [];
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const raw = tag(item!, 'title');
    const url = tag(item!, 'link');
    const date = tag(item!, 'pubDate');
    if (!raw || !url || !date) continue;
    const at = new Date(date);
    if (Number.isNaN(at.getTime())) continue;
    const split = raw.lastIndexOf(' - ');
    const title = split > 0 ? raw.slice(0, split) : raw;
    const source = tag(item!, 'source') ?? (split > 0 ? raw.slice(split + 3) : null);
    out.push({ title, source, url, publishedAt: at.toISOString() });
  }
  return out;
}

function mentions(text: string, term: string): boolean {
  // Whole words, so "AMD" does not match "Amdocs" and "cut" does not match "shortcut".
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, 'i').test(text);
}

/**
 * Keep a headline only if it names the company AND one of the keywords.
 *
 * Google matches the query loosely, against article bodies as well as
 * titles, so its results are a superset. This is the floor, not a verdict:
 * a headline that passes still only MAY report the event.
 */
export function relevant(hit: NewsHit, aliases: string[], keywords: string[], now: number): boolean {
  if (now - Date.parse(hit.publishedAt) > NEWS_WINDOW_DAYS * 86_400_000) return false;
  return aliases.some((a) => mentions(hit.title, a)) && keywords.some((k) => mentions(hit.title, k));
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const cache = new Map<string, { at: number; watch: NewsWatch }>();
/** The loop runs every fifteen minutes; a headline search does not need to be fresher than that. */
const CACHE_MS = 10 * 60_000;

/**
 * Search the news for one event tripwire. Throws on a network or HTTP
 * failure, so the caller can say the feed was unreachable rather than quiet.
 */
export async function watchNews(
  instrument: Pick<Instrument, 'ticker' | 'name'>,
  keywords: string[],
  options: { fetchImpl?: Fetch; now?: number } = {},
): Promise<NewsWatch> {
  const now = options.now ?? Date.now();
  const aliases = companyAliases(instrument);
  const query = newsQuery(aliases, keywords);

  const cached = cache.get(query);
  if (!options.fetchImpl && cached && now - cached.at < CACHE_MS) return cached.watch;

  const url = `${FEED}?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const response = await (options.fetchImpl ?? fetch)(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': 'THESIS research desk (thesis-stocks.vercel.app)' },
  });
  if (!response.ok) throw new Error(`news feed answered ${response.status}`);

  const all = parseRss(await response.text());
  // One story syndicated to several outlets is one headline, not three.
  const seen = new Set<string>();
  const hits = all
    .filter((h) => relevant(h, aliases, keywords, now))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .filter((h) => {
      const key = h.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, NEWS_MAX_HITS);

  const watch: NewsWatch = { query, hits, scanned: all.length, checkedAt: new Date(now).toISOString() };
  if (!options.fetchImpl) cache.set(query, { at: now, watch });
  return watch;
}
