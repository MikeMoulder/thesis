/**
 * Self-test for the historical backfill.
 *
 *   npm run backfill:selftest
 *
 * No model and no network. The data source is a fixture, which is the point:
 * the property that matters here — that a reconstructed check never used data
 * from after its own date — cannot be checked by reading real output, because
 * a value with tomorrow in it looks exactly like a value without.
 *
 * So it is checked structurally. The same backfill is run twice, once over a
 * series that continues past the window and once over a series TRUNCATED at the
 * window's end. If a single reconstructed number differs between the two, the
 * first run read the future.
 */
import type { DataSource } from '../data/DataSource';
import type { Candle, Instrument } from '../data/types';
import { summariseBreakers, type BreakerSet, type ThesisBreaker } from '../engine/breakers/types';
import { summarise, type Assumption, type Decomposition } from '../engine/decomposer/types';
import {
  backfilledCount,
  backfillThesis,
  fundamentalAsAt,
  indexAsAt,
} from '../thesis/backfill';
import { createThesis } from '../thesis/record';
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

const DAY = 86_400_000;
const START = Date.parse('2026-01-01T00:00:00.000Z');

// ---- fixtures -------------------------------------------------------------

/**
 * A price series that is flat, then falls off a cliff.
 *
 * The cliff sits AFTER the backfill window on purpose. Any reconstructed value
 * that moves because of it is a value that read the future.
 */
function candles(count: number, cliffAt: number, cliffTo: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const close = i >= cliffAt ? cliffTo : 100;
    out.push({ ts: START + i * DAY, open: close, high: close, low: close, close, volume: 1 });
  }
  return out;
}

function assumption(over: Partial<Assumption> & { id: string }): Assumption {
  return {
    statement: `statement ${over.id}`,
    origin: 'implicit',
    supports: ['C1'],
    loadBearing: 'high',
    testability: 'fundamental',
    dataNeeded: 'quarterly gross margin',
    rationale: 'because',
    ...over,
  };
}

function breaker(over: Partial<ThesisBreaker> & { id: string; assumptionRef: string }): ThesisBreaker {
  return {
    kind: 'threshold',
    statement: `breaker ${over.id}`,
    metric: 'grossMargin',
    operator: '<',
    threshold: 70,
    severity: 'high',
    severityInherited: true,
    cadence: 'periodic',
    ...over,
  } as ThesisBreaker;
}

const ASSUMPTIONS: Assumption[] = [
  assumption({ id: 'A1', testability: 'price', dataNeeded: 'daily closes' }),
  assumption({ id: 'A2', loadBearing: 'medium' }),
  assumption({ id: 'A3', testability: 'event', loadBearing: 'low' }),
];

const BREAKERS: ThesisBreaker[] = [
  breaker({ id: 'B1', assumptionRef: 'A1', metric: 'price', operator: '<', threshold: 90, cadence: 'continuous' }),
  breaker({ id: 'B2', assumptionRef: 'A2', metric: 'grossMargin', operator: '<', threshold: 70 }),
  {
    id: 'B3',
    assumptionRef: 'A3',
    kind: 'event',
    statement: 'a recall is announced',
    severity: 'low',
    severityInherited: true,
    cadence: 'event',
    watchFor: 'a product recall',
    keywords: ['recall'],
  },
];

function decomposition(): Decomposition {
  const claims = [{ id: 'C1', statement: 'it goes up', direction: 'bullish' as const }];
  return {
    ticker: 'TEST',
    claims,
    assumptions: ASSUMPTIONS,
    summary: summarise(claims, ASSUMPTIONS),
    meta: { model: 'fixture', latencyMs: 0, generatedAt: '2026-01-01T00:00:00.000Z' },
  } as unknown as Decomposition;
}

function breakerSet(): BreakerSet {
  return {
    ticker: 'TEST',
    breakers: BREAKERS,
    uncovered: [],
    summary: summariseBreakers(BREAKERS, [], ASSUMPTIONS),
    meta: { model: 'fixture', latencyMs: 0, generatedAt: '2026-01-01T00:00:00.000Z' },
  };
}

/** Created 100 days in, so there is a real past to reconstruct behind it. */
const CREATED_AT = new Date(START + 100 * DAY).toISOString();

function freshThesis(): ThesisRecord {
  return createThesis({
    id: 'T-backfill',
    ticker: 'TEST',
    statement: 'I believe the fixture holds.',
    decomposition: decomposition(),
    breakerSet: breakerSet(),
    evaluations: [],
    modelCalls: 3,
    at: CREATED_AT,
  });
}

const INSTRUMENT: Instrument = { ticker: 'TEST', yahooSymbol: 'TEST' } as Instrument;

/**
 * `filedAt` is when the market could first have known the figure — deliberately
 * far from the period it describes, which is the trap the no-look-ahead rule
 * exists to avoid.
 */
function fakeDataSource(bars: Candle[], filings: Array<{ filed: string; value: number; end: string }>) {
  const calls = { history: 0, derived: 0 };
  return {
    name: 'fixture',
    async getUnderlyingHistory() {
      calls.history++;
      return { value: bars, provenance: { status: 'reported', source: 'fixture daily closes' } };
    },
    async getCandles() {
      // Short, so getPriceSeries falls through to the underlying as in production.
      return { value: bars.slice(-5), provenance: { status: 'reported', source: 'fixture rToken' } };
    },
    async getDerivedMetric() {
      calls.derived++;
      return {
        value: filings.map((f) => ({
          name: 'grossMargin',
          end: f.end,
          value: f.value,
          unit: 'percent',
          inputs: [{ firstFiled: f.filed }],
        })),
        provenance: { status: 'inferred', source: 'fixture 10-Q' },
      };
    },
    async resolve(ticker: string) {
      return { ticker };
    },
    async healthCheck() {
      return { ok: true, checks: [] };
    },
    async getQuote() {
      throw new Error('backfill must never read a live quote');
    },
    async getFundamentalSeries() {
      throw new Error('not used by these breakers');
    },
    async getNews() {
      throw new Error('not used');
    },
    __calls: calls,
  } as unknown as DataSource & { __calls: typeof calls };
}

// ---- indexAsAt ------------------------------------------------------------

{
  const bars = candles(10, 99, 1);
  check('indexAsAt picks the bar exactly on the timestamp', indexAsAt(bars, START + 3 * DAY) === 3);
  check(
    'indexAsAt picks the bar BEFORE a gap, never the one after',
    indexAsAt(bars, START + 3 * DAY + 3600_000) === 3,
  );
  check('indexAsAt returns -1 before the series starts', indexAsAt(bars, START - DAY) === -1);
  check('indexAsAt clamps to the last bar after the series ends', indexAsAt(bars, START + 500 * DAY) === 9);
}

// ---- fundamentalAsAt ------------------------------------------------------

{
  const history = {
    points: [
      { date: '2026-02-10', value: 75, period: '2025-12-31' },
      { date: '2026-05-12', value: 72, period: '2026-03-31' },
      { date: '2026-08-11', value: 61, period: '2026-06-30' },
    ],
  };

  check('nothing is known before the first filing', fundamentalAsAt(history, '2026-01-09T00:00:00Z') === null);
  check(
    'a filing is invisible the day BEFORE it was filed',
    fundamentalAsAt(history, '2026-05-11T23:00:00Z')?.value === 75,
  );
  check(
    'and visible on the day it was filed',
    fundamentalAsAt(history, '2026-05-12T00:00:00Z')?.value === 72,
  );
  check(
    'the latest knowable figure wins, not the newest one that exists',
    fundamentalAsAt(history, '2026-07-01T00:00:00Z')?.value === 72,
  );
  check(
    'THE TRAP: a period ending in June is not knowable in July if it was filed in August',
    fundamentalAsAt(history, '2026-07-31T00:00:00Z')?.period === '2026-03-31',
  );
}

// ---- the headline property: no look-ahead ---------------------------------

{
  // 200 bars. The window backfilled is the 90 days before day 100, so the cliff
  // at day 120 is entirely in the future as far as every reconstructed check is
  // concerned — and must leave no trace in any of them.
  const full = candles(200, 120, 10);
  const truncated = full.slice(0, 101);

  const a = await backfillThesis(fakeDataSource(full, []), INSTRUMENT, freshThesis(), { days: 90 });
  const b = await backfillThesis(fakeDataSource(truncated, []), INSTRUMENT, freshThesis(), { days: 90 });

  const strip = (r: typeof a) =>
    JSON.stringify(r.thesis.checks.filter((c) => c.source === 'backfill').map((c) => [c.at, c.evaluations, c.health]));

  check('the backfill wrote checks', a.report.written > 0, String(a.report.written));
  check(
    'THE CLAIM: reconstructing over a series that continues past the window gives ' +
      'byte-identical output to one truncated at it — no check read the future',
    strip(a) === strip(b),
    `${a.report.written} vs ${b.report.written} checks`,
  );
  check('THE CLAIM: a backfill costs zero model calls', a.report.modelCalls === 0, String(a.report.modelCalls));
}

// ---- shape of what it writes ----------------------------------------------

{
  const full = candles(200, 120, 10);
  const original = freshThesis();
  const { thesis, report } = await backfillThesis(fakeDataSource(full, []), INSTRUMENT, original, { days: 90 });

  const backfilled = thesis.checks.filter((c) => c.source === 'backfill');
  const observed = thesis.checks.filter((c) => c.source !== 'backfill');

  check('every reconstructed check is labelled as one', backfilled.length === report.written);
  check('the observed check is still there', observed.length === 1);
  check(
    'and is carried across untouched',
    JSON.stringify(observed[0]) === JSON.stringify(original.checks[0]),
  );
  check(
    'reconstruction comes BEFORE observation, so the log still reads oldest first',
    thesis.checks.every((c, i) => i === 0 || c.at >= thesis.checks[i - 1]!.at),
  );
  check(
    'and never overlaps it',
    backfilled.every((c) => c.at < observed[0]!.at),
  );
  check('every reconstructed check records zero model calls', backfilled.every((c) => c.modelCalls === 0));
  check('backfilledCount agrees with the log', backfilledCount(thesis) === backfilled.length);
  check(
    'an event breaker stays undeterminable rather than quietly holding',
    backfilled.every((c) => c.evaluations.find((e) => e.breakerId === 'B3')?.status === 'undeterminable'),
  );
  check(
    'the first reconstructed check has no changes — nothing preceded it',
    backfilled[0]!.changes.length === 0,
  );
}

// ---- a fundamental with no filing yet -------------------------------------

{
  const full = candles(200, 999, 1);
  // Filed after the whole window: knowable to nobody inside it.
  const { thesis } = await backfillThesis(
    fakeDataSource(full, [{ filed: '2026-12-01', value: 40, end: '2026-09-30' }]),
    INSTRUMENT,
    freshThesis(),
    { days: 90 },
  );

  const backfilled = thesis.checks.filter((c) => c.source === 'backfill');
  check(
    'a figure filed after the window never appears inside it',
    backfilled.every((c) => c.evaluations.find((e) => e.breakerId === 'B2')?.status === 'undeterminable'),
  );
  check(
    'and the assumption it covers is uncheckable, never healthy',
    backfilled.every((c) => c.assumptions.find((a) => a.assumptionId === 'A2')?.health === 'uncheckable'),
  );
}

// ---- it catches a transition ----------------------------------------------

{
  // Price sits at 100, then drops to 80 at day 60 — inside the window, and
  // through the threshold of 90. This is the thing the whole feature is for.
  const full = candles(200, 60, 80);
  const { thesis, report } = await backfillThesis(
    fakeDataSource(full, []),
    INSTRUMENT,
    freshThesis(),
    { days: 90 },
  );

  const broke = report.transitions.filter((t) => t.to === 'broken');
  check('a threshold crossed inside the window produces a transition', report.transitions.length > 0);
  check('and it is recorded as a break', broke.length === 1, JSON.stringify(report.transitions.map((t) => `${t.from}->${t.to}`)));
  check('the break cites the breaker that caused it', broke[0]?.breakerId === 'B1');
  check('and the evidence behind it', broke[0]?.observed === 80 && broke[0]?.threshold === 90);
  check(
    'the thesis reads broken from that point on',
    thesis.checks.filter((c) => c.source === 'backfill' && c.at > broke[0]!.at).every((c) => c.health === 'broken'),
  );
  check(
    'and it did NOT read broken before',
    thesis.checks.filter((c) => c.source === 'backfill' && c.at < broke[0]!.at).every((c) => c.health !== 'broken'),
  );
}

// ---- guards ---------------------------------------------------------------

{
  const full = candles(200, 999, 1);
  const once = await backfillThesis(fakeDataSource(full, []), INSTRUMENT, freshThesis(), { days: 90 });

  let refused = false;
  try {
    await backfillThesis(fakeDataSource(full, []), INSTRUMENT, once.thesis, { days: 90 });
  } catch {
    refused = true;
  }
  check('re-running without replace is refused rather than duplicating history', refused);

  const again = await backfillThesis(fakeDataSource(full, []), INSTRUMENT, once.thesis, {
    days: 90,
    replace: true,
  });
  check(
    'replace rebuilds rather than appends',
    backfilledCount(again.thesis) === backfilledCount(once.thesis),
    `${backfilledCount(again.thesis)} vs ${backfilledCount(once.thesis)}`,
  );
  check(
    'and still leaves the observed check alone',
    again.thesis.checks.filter((c) => c.source !== 'backfill').length === 1,
  );

  const twoVersions: ThesisRecord = {
    ...freshThesis(),
    versions: [freshThesis().versions[0]!, { ...freshThesis().versions[0]!, n: 2 }],
  };
  let refusedVersions = false;
  try {
    await backfillThesis(fakeDataSource(full, []), INSTRUMENT, twoVersions, { days: 90 });
  } catch {
    refusedVersions = true;
  }
  check('a multi-version thesis is refused rather than mis-stamped', refusedVersions);
}

// ---- stride ---------------------------------------------------------------

{
  const full = candles(200, 999, 1);
  const daily = await backfillThesis(fakeDataSource(full, []), INSTRUMENT, freshThesis(), { days: 90 });
  const every3 = await backfillThesis(fakeDataSource(full, []), INSTRUMENT, freshThesis(), {
    days: 90,
    stride: 3,
  });
  check(
    'stride thins the log without changing its span',
    every3.report.written < daily.report.written && every3.report.from === daily.report.from,
    `${every3.report.written} vs ${daily.report.written}`,
  );
}

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
