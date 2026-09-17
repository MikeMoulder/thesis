/**
 * Self-test for the bitget-signal Skills client.
 *
 *   npm run signal:selftest
 *
 * No network. Every case is a real response body captured from the live MCP
 * server, so this pins the exact shapes that decide whether a Skill counts as
 * working.
 *
 * That judgement is the whole risk here. The server returns HTTP 200 and a
 * well-formed MCP envelope for calls whose upstream failed, and the failure
 * bodies are valid JSON. Status codes say nothing, parsing says nothing, and
 * a naive "is there a field with a value in it" check reports a completely
 * empty news feed as healthy — which it did, on the first live probe, before
 * these cases existed.
 */
import { carriesData } from '../data/providers/signal';

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

function expect(label: string, body: string, want: boolean): void {
  const got = carriesData(body);
  check(`${label} -> ${want ? 'data' : 'no data'}`, got === want, `got ${got}`);
}

// ---------------------------------------------------------------------------
// Real successes, captured live
// ---------------------------------------------------------------------------

console.log('\nreplies that genuinely carry data');

expect(
  'technical_analysis rsi',
  '{"symbol": "BTC/USDT", "timeframe": "4h", "rsi": 52.17, "period": 14, "signal": "neutral"}',
  true,
);
expect('a single numeric field', '{"rsi": 52.17}', true);
expect('a populated list', '[{"feed": "coindesk", "error": "", "items": [{"title": "x"}]}]', true);
expect('plain prose from a healthy tool', 'BTC is consolidating above support.', true);
expect('a zero that is a real reading', '{"value": 0}', true);

// ---------------------------------------------------------------------------
// Real failures, captured live. Each of these returned HTTP 200.
// ---------------------------------------------------------------------------

console.log('\nreplies that look fine and carry nothing');

expect('macro_indicators via FRED', '{"error": ""}', false);
expect('derivatives_sentiment via Binance', '{"error": ""}', false);
expect('sentiment_index via alternative.me', '{"alt_me_error": ""}', false);
expect('rates_yields, every field an empty error', '{"us10y": {"error": ""}, "us2y": {"error": ""}}', false);
expect('an empty body', '', false);
expect('whitespace only', '   \n  ', false);
expect('an empty list', '[]', false);
expect('an empty object', '{}', false);

// The one that got through. news_feed answers with one object per feed, each
// carrying a NAME and nothing else. 44 of these came back on 17 Sep 2026.
console.log('\nthe case that reported healthy while returning nothing');

expect(
  'news_feed, two named feeds with no articles',
  '[{"feed": "coindesk", "error": "", "items": []}, {"feed": "decrypt", "error": "", "items": []}]',
  false,
);
expect(
  'news_feed, one feed, no articles',
  '[{"feed": "cointelegraph", "error": "", "items": []}]',
  false,
);
check(
  'a label beside an empty payload is not data',
  carriesData('{"feed": "coindesk", "items": []}') === false,
  'a feed name with no articles must not count',
);
check(
  'but a label beside a real payload is',
  carriesData('{"feed": "coindesk", "items": [{"title": "something"}]}') === true,
);

// ---------------------------------------------------------------------------
// Shapes that must not be mistaken either way
// ---------------------------------------------------------------------------

console.log('\nedges');

expect('an error field carrying an actual message', '{"error": "rate limited"}', true);
expect('nested emptiness', '{"outer": {"inner": {"error": ""}}}', false);
expect('nested data', '{"outer": {"inner": {"rsi": 30}}}', true);
expect('a list of empty objects', '[{}, {}]', false);
expect('malformed JSON that still says something', '{rsi: 52', true);

check(
  'a populated array anywhere in the reply counts as data',
  carriesData('{"meta": {"error": ""}, "rows": [1, 2, 3]}') === true,
);

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
