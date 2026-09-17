/**
 * Self-test for the activity feed.
 *
 *   npm run activity:selftest
 *
 * No model and no network. The feed is a pure reading of the check logs, which
 * is the property worth protecting: the moment it starts computing anything of
 * its own it becomes a second copy of the truth, and a second copy can disagree
 * with the first.
 */
import { buildActivityFeed, isObserved, summariseActivity } from '../thesis/activity';
import type { Check, HealthChange, ThesisRecord } from '../thesis/types';

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

// ---- builders -------------------------------------------------------------

function change(over: Partial<HealthChange> & { assumptionId: string }): HealthChange {
  return {
    statement: `statement ${over.assumptionId}`,
    from: 'healthy',
    to: 'broken',
    ...over,
  } as HealthChange;
}

function checkOf(
  at: string,
  changes: HealthChange[],
  source: Check['source'] = 'live',
): Check {
  return {
    at,
    version: 1,
    evaluations: [],
    assumptions: [],
    health: 'healthy',
    changes,
    modelCalls: 0,
    source,
  };
}

function thesisOf(id: string, ticker: string, checks: Check[]): ThesisRecord {
  return { id, ticker, direction: 'bullish', createdAt: checks[0]?.at ?? '', status: 'live', versions: [], checks } as unknown as ThesisRecord;
}

// ---- it is a reading of the log, not a computation ------------------------

console.log('\nreading the log');

{
  const t = thesisOf('t1', 'NVDA', [
    checkOf('2026-01-01T00:00:00Z', []),
    checkOf('2026-01-02T00:00:00Z', [change({ assumptionId: 'A1' })]),
    checkOf('2026-01-03T00:00:00Z', []),
  ]);
  const feed = buildActivityFeed([t]);

  check('only checks that CHANGED something appear', feed.length === 1, String(feed.length));
  check(
    'THE POINT: routine checks are excluded, however many there are',
    feed.every((e) => e.statement === 'statement A1'),
  );
  check('the entry carries the thesis it belongs to', feed[0]?.thesisId === 't1');
  check('and the ticker, so the feed can be read across theses', feed[0]?.ticker === 'NVDA');
}

{
  const t = thesisOf('t1', 'NVDA', [checkOf('2026-01-02T00:00:00Z', [])]);
  const feed = buildActivityFeed([t]);
  check('a thesis that has never moved contributes nothing', feed.length === 0);
  check('and the summary says so rather than inventing a date', summariseActivity(feed).latestAt === null);
}

// ---- ordering -------------------------------------------------------------

console.log('\nordering');

{
  const a = thesisOf('t1', 'NVDA', [checkOf('2026-01-01T00:00:00Z', [change({ assumptionId: 'A1' })])]);
  const b = thesisOf('t2', 'TSLA', [checkOf('2026-03-01T00:00:00Z', [change({ assumptionId: 'B1' })])]);
  const feed = buildActivityFeed([a, b]);

  check('newest first, across theses', feed[0]?.ticker === 'TSLA', feed.map((e) => e.ticker).join(','));
  check('and the older one follows', feed[1]?.ticker === 'NVDA');
}

{
  // One check, two transitions: a break and a recovery in the same instant.
  const t = thesisOf('t1', 'NVDA', [
    checkOf('2026-01-02T00:00:00Z', [
      change({ assumptionId: 'A1', from: 'broken', to: 'healthy' }),
      change({ assumptionId: 'A2', from: 'healthy', to: 'broken' }),
    ]),
  ]);
  const feed = buildActivityFeed([t]);
  check(
    'inside one check the worst news is listed first',
    feed[0]?.to === 'broken',
    `${feed[0]?.from} -> ${feed[0]?.to}`,
  );
  check('and the recovery follows it', feed[1]?.to === 'healthy');
}

// ---- reconstructed versus observed ---------------------------------------

console.log('\nreconstructed versus observed');

{
  const t = thesisOf('t1', 'NVDA', [
    checkOf('2026-01-01T00:00:00Z', [change({ assumptionId: 'A1' })], 'backfill'),
    checkOf('2026-02-01T00:00:00Z', [change({ assumptionId: 'A2' })], 'live'),
  ]);
  const feed = buildActivityFeed([t]);

  check('a reconstructed transition keeps its label', feed.some((e) => e.source === 'backfill'));
  check(
    'THE CLAIM: observed and reconstructed stay distinguishable',
    feed.filter(isObserved).length === 1,
    String(feed.filter(isObserved).length),
  );

  const summary = summariseActivity(feed);
  check('the summary counts both kinds separately', summary.observed === 1 && summary.reconstructed === 1);
  check('and totals them', summary.total === 2);
}

// ---- evidence travels with the entry --------------------------------------

console.log('\nevidence');

{
  const t = thesisOf('t1', 'NVDA', [
    checkOf('2026-01-02T00:00:00Z', [
      change({
        assumptionId: 'A1',
        metric: 'grossMargin',
        observed: 62,
        threshold: 70,
        provenance: { status: 'sourced', source: 'SEC 10-Q' },
      } as Partial<HealthChange> & { assumptionId: string }),
    ]),
  ]);
  const feed = buildActivityFeed([t]);

  check('the number that caused it travels with the entry', feed[0]?.observed === 62);
  check('and the line it crossed', feed[0]?.threshold === 70);
  check('and where the number came from', feed[0]?.provenance?.source === 'SEC 10-Q');
  check('a change with no evidence simply omits it', buildActivityFeed([
    thesisOf('t2', 'TSLA', [checkOf('2026-01-02T00:00:00Z', [change({ assumptionId: 'A9' })])]),
  ])[0]?.observed === undefined);
}

// ---- limit ----------------------------------------------------------------

console.log('\nlimit');

{
  const checks = Array.from({ length: 10 }, (_, i) =>
    checkOf(`2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`, [change({ assumptionId: `A${i}` })]),
  );
  const feed = buildActivityFeed([thesisOf('t1', 'NVDA', checks)], 3);
  check('a limit trims to the newest', feed.length === 3, String(feed.length));
  check('and keeps the newest, not the oldest', feed[0]?.at.startsWith('2026-01-10') === true, feed[0]?.at);
}

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
