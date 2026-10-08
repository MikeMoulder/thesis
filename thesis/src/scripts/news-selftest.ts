/**
 * Headlines for event tripwires.
 *
 * The rule this suite protects above all: a headline never decides anything.
 * An event tripwire with matching news is still undeterminable, because a
 * keyword match MAY report the event and a quiet feed does not prove it did
 * not happen. Around that: parsing a feed safely, naming the company the way
 * headlines do, matching whole words, and keeping links off the stored log.
 *
 * Offline. The network is replaced with canned RSS.
 */
import {
  companyAliases,
  newsQuery,
  parseRss,
  relevant,
  watchNews,
  type NewsHit,
} from '../data/providers/news';
import { evaluateLive } from '../engine/breakers/evaluate';
import type { ThesisBreaker } from '../engine/breakers/types';
import { createMemoryStore } from '../thesis/store';
import type { ThesisRecord } from '../thesis/types';

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const NOW = Date.parse('2026-10-08T12:00:00Z');
const day = (n: number) => new Date(NOW - n * 86_400_000).toUTCString();

function item(title: string, ago: number, link = `https://news.example/${encodeURIComponent(title)}`) {
  return `<item><title>${title}</title><link>${link}</link><pubDate>${day(ago)}</pubDate></item>`;
}
const rss = (...items: string[]) => `<?xml version="1.0"?><rss><channel>${items.join('')}</channel></rss>`;
const serve = (xml: string, status = 200) => async () => new Response(xml, { status });

// ---------------------------------------------------------------------------

console.log('\nreading a feed');

{
  const hits = parseRss(
    rss(
      `<item><title><![CDATA[Nvidia &amp; AMD cut prices - Reuters]]></title><link>https://a.example/1</link><pubDate>${day(1)}</pubDate><source url="https://reuters.com">Reuters</source></item>`,
      item('Nvidia guidance cut &#39;sharply&#39; - Bloomberg', 2),
      '<item><title>No date, so skipped</title><link>https://a.example/x</link></item>',
      `<item><title>Bad date</title><link>https://a.example/y</link><pubDate>not a date</pubDate></item>`,
    ),
  );
  check('well-formed items are read, malformed ones skipped', hits.length === 2, String(hits.length));
  check('CDATA and entities are decoded', hits[0]?.title === 'Nvidia & AMD cut prices', hits[0]?.title);
  check('the source tag wins over the title suffix', hits[0]?.source === 'Reuters');
  check('the " - Source" suffix is split off the title', hits[1]?.title === "Nvidia guidance cut 'sharply'" && hits[1]?.source === 'Bloomberg', `${hits[1]?.title} / ${hits[1]?.source}`);
  check('dates become ISO', hits[1]?.publishedAt === new Date(day(2)).toISOString());
  check('an empty or garbage document yields nothing', parseRss('').length === 0 && parseRss('<html>nope</html>').length === 0);
}

console.log('\nnaming the company the way headlines do');

{
  const nvda = companyAliases({ ticker: 'NVDA', name: 'NVIDIA CORP' });
  check('"NVIDIA CORP" gives the ticker and "Nvidia"', nvda.includes('NVDA') && nvda.includes('Nvidia'), nvda.join('|'));
  const amd = companyAliases({ ticker: 'AMD', name: 'ADVANCED MICRO DEVICES INC' });
  check('"ADVANCED MICRO DEVICES INC" gives the full name', amd.includes('Advanced Micro Devices'), amd.join('|'));
  check('but never the generic first word "Advanced"', !amd.includes('Advanced'));
  const meta = companyAliases({ ticker: 'META', name: 'Meta Platforms, Inc.' });
  check('"Meta Platforms, Inc." gives "Meta Platforms" and "Meta"', meta.includes('Meta Platforms') && meta.includes('Meta'), meta.join('|'));
  check('no name still gives the ticker', companyAliases({ ticker: 'tsla' }).join() === 'TSLA');

  const q = newsQuery(['AMD', 'Advanced Micro Devices'], ['price cut', 'MI400']);
  check('the query quotes phrases and ORs both sides', q === '(AMD OR "Advanced Micro Devices") ("price cut" OR MI400) when:7d', q);
}

console.log('\nwhat counts as relevant');

{
  const aliases = ['AMD', 'Advanced Micro Devices'];
  const hit = (title: string, ago = 1): NewsHit => ({ title, source: null, url: 'x', publishedAt: new Date(day(ago)).toISOString() });
  check('company and keyword both named: kept', relevant(hit('AMD announces MI400 price cut'), aliases, ['price cut'], NOW));
  check('company without a keyword: dropped', !relevant(hit('AMD shares rise'), aliases, ['price cut'], NOW));
  check('keyword without the company: dropped', !relevant(hit('Intel price cut'), aliases, ['price cut'], NOW));
  check('whole words only: "Amdocs" is not AMD', !relevant(hit('Amdocs price cut'), aliases, ['price cut'], NOW));
  check('case does not matter', relevant(hit('amd PRICE CUT'), aliases, ['price cut'], NOW));
  check('older than the window: dropped', !relevant(hit('AMD price cut', 9), aliases, ['price cut'], NOW));
}

console.log('\nsearching');

await (async () => {
  const instrument = { ticker: 'NVDA', name: 'NVIDIA CORP' };
  const watch = await watchNews(instrument, ['guidance', 'outlook'], {
    now: NOW,
    fetchImpl: serve(
      rss(
        item('Nvidia cuts guidance - Reuters', 3),
        item('Nvidia trims outlook for data center - FT', 1),
        item('Nvidia trims outlook for data center - Yahoo', 1),
        item('Nvidia guidance unchanged, outlook steady - CNBC', 2),
        item('Nvidia outlook bright - Blog', 4),
        item('AMD guidance raised - Reuters', 1),
        item('Nvidia guidance from last month - Old', 20),
      ),
    ),
  });
  check('only relevant headlines are kept', watch.hits.every((h) => /nvidia/i.test(h.title)));
  check('newest first', watch.hits[0]?.title === 'Nvidia trims outlook for data center', watch.hits[0]?.title);
  check('one story syndicated twice is shown once', watch.hits.filter((h) => h.title === 'Nvidia trims outlook for data center').length === 1);
  check('capped at three', watch.hits.length === 3, String(watch.hits.length));
  check('it reports how much it scanned', watch.scanned === 7, String(watch.scanned));
  check('and the query it ran', watch.query.includes('guidance') && watch.query.endsWith('when:7d'));

  let threw = false;
  try {
    await watchNews(instrument, ['x'], { now: NOW, fetchImpl: serve('', 503) });
  } catch {
    threw = true;
  }
  check('an HTTP failure throws, so it is never mistaken for a quiet feed', threw);
})();

console.log('\nan event tripwire with news is still undeterminable');

await (async () => {
  const breaker: ThesisBreaker = {
    id: 'B9',
    kind: 'event',
    cadence: 'event',
    assumptionRef: 'A1',
    statement: 'Nvidia does not cut prices.',
    watchFor: 'Nvidia announces aggressive price cuts',
    keywords: ['zz-price-war'],
    severity: 'high',
    severityInherited: true,
  };
  const instrument = { ticker: 'NVDA', name: 'NVIDIA CORP', yahooSymbol: 'NVDA' };
  const realFetch = globalThis.fetch;
  const recent = new Date(Date.now() - 3_600_000).toUTCString();
  globalThis.fetch = (async () =>
    new Response(rss(`<item><title>Nvidia zz-price-war begins - Reuters</title><link>https://a.example/p</link><pubDate>${recent}</pubDate></item>`))) as typeof fetch;
  const withNews = await evaluateLive(null as never, instrument, breaker);
  check('headlines found: status stays undeterminable', withNews.status === 'undeterminable', withNews.status);
  check('the headline is attached', withNews.news?.hits.length === 1);
  check('and the reason says it is not proof', /not proof/.test(withNews.reason ?? ''), withNews.reason);

  globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch;
  const down = await evaluateLive(null as never, instrument, { ...breaker, keywords: ['zz-other'] });
  check('feed unreachable: undeterminable, and it says the feed was unreachable', down.status === 'undeterminable' && /could not be reached/.test(down.reason ?? ''), down.reason);
  globalThis.fetch = realFetch;
})();

console.log('\nlinks stay off the stored log');

await (async () => {
  const store = createMemoryStore();
  const news = { query: 'q', hits: [{ title: 't', source: 's', url: 'u', publishedAt: 'p' }], scanned: 1, checkedAt: 'c' };
  const checkWith = (at: string) => ({
    at,
    version: 1,
    evaluations: [{ breakerId: 'B1', mode: 'live' as const, status: 'undeterminable' as const, reason: 'r', news }],
    assumptions: [],
    health: 'uncheckable' as const,
    changes: [],
    modelCalls: 0,
    source: 'live' as const,
  });
  await store.put({ id: 'N1', checks: [checkWith('1'), checkWith('2'), checkWith('3')] } as unknown as ThesisRecord);
  const back = (await store.get('N1'))!;
  check('older checks lose their headlines', !back.checks[0]!.evaluations[0]!.news && !back.checks[1]!.evaluations[0]!.news);
  check('the newest keeps them', back.checks[2]!.evaluations[0]!.news?.hits.length === 1);
  check('and nothing else about an evaluation changes', back.checks[0]!.evaluations[0]!.reason === 'r');
})();

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
