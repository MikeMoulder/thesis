/**
 * Self-test for the thesis autopsy.
 *
 *   npm run autopsy:selftest
 *
 * No model and no network. The autopsy is the section most likely to be
 * believed, because it reads like a conclusion, so every date in it has to come
 * from a stored timestamp rather than from a model's narrative. That is only
 * checkable because it is derived.
 */
import { deriveAutopsy } from '../thesis/autopsy';
import type { Assumption } from '../engine/decomposer/types';
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

function assumption(over: Partial<Assumption> & { id: string }): Assumption {
  return {
    statement: `statement ${over.id}`,
    origin: 'stated',
    supports: ['C1'],
    loadBearing: 'high',
    testability: 'fundamental',
    dataNeeded: 'x',
    rationale: 'y',
    ...over,
  };
}

/** A check on a given day, with the health each assumption stood at. */
function day(
  d: number,
  states: Record<string, Check['assumptions'][number]['health']>,
  changes: HealthChange[] = [],
  source: Check['source'] = 'live',
): Check {
  return {
    at: `2026-06-${String(d).padStart(2, '0')}T00:00:00.000Z`,
    version: 1,
    evaluations: [],
    assumptions: Object.entries(states).map(([assumptionId, health]) => ({
      assumptionId,
      statement: `statement ${assumptionId}`,
      loadBearing: 'high' as const,
      health,
      basis: 'stable' as const,
      directionUnknown: false,
      drivers: [],
    })),
    health: 'healthy',
    changes,
    modelCalls: 0,
    source,
  };
}

function change(assumptionId: string, from: HealthChange['from'], to: HealthChange['to'], extra: Partial<HealthChange> = {}): HealthChange {
  return { assumptionId, statement: `statement ${assumptionId}`, from, to, ...extra } as HealthChange;
}

function thesisOf(assumptions: Assumption[], checks: Check[]): ThesisRecord {
  return {
    id: 't1',
    ticker: 'TSLA',
    direction: 'bullish',
    createdAt: checks[0]?.at ?? '',
    status: 'live',
    versions: [
      {
        n: 1,
        statement: 'I am long TSLA',
        createdAt: checks[0]?.at ?? '',
        decomposition: { assumptions } as never,
        breakerSet: { breakers: [] } as never,
      },
    ],
    checks,
  } as unknown as ThesisRecord;
}

// ---- the headline: the gap ------------------------------------------------

console.log('\nthe warning gap');

{
  // Warned on the 3rd, broke on the 17th. Fourteen days of notice.
  const t = thesisOf(
    [assumption({ id: 'A1' })],
    [
      day(1, { A1: 'healthy' }),
      day(3, { A1: 'weakening' }, [change('A1', 'healthy', 'weakening')]),
      day(10, { A1: 'weakening' }),
      day(17, { A1: 'broken' }, [change('A1', 'weakening', 'broken', { metric: 'volatility90d', observed: 50.05, threshold: 50 })]),
    ],
  );
  const autopsy = deriveAutopsy(t);
  const row = autopsy.assumptions[0]!;

  check('the first warning is dated from the log', row.firstWarningAt?.startsWith('2026-06-03') === true, row.firstWarningAt);
  check('so is the break', row.firstBreakAt?.startsWith('2026-06-17') === true, row.firstBreakAt);
  check('THE HEADLINE: the gap between them is measured, not claimed', row.warningDays === 14, String(row.warningDays));
  check('and the evidence at the break travels with it', row.observed === 50.05 && row.threshold === 50);
  check('the thesis level headline picks it up', autopsy.earliestWarning?.days === 14, String(autopsy.earliestWarning?.days));
}

{
  // Warning and break in the SAME check. Zero is a real answer.
  const t = thesisOf(
    [assumption({ id: 'A1' })],
    [
      day(1, { A1: 'healthy' }),
      day(9, { A1: 'broken' }, [change('A1', 'healthy', 'broken')]),
    ],
  );
  const row = deriveAutopsy(t).assumptions[0]!;
  check(
    'a break with no prior warning reports zero days, not nothing',
    row.warningDays === 0,
    String(row.warningDays),
  );
}

{
  const t = thesisOf([assumption({ id: 'A1' })], [day(1, { A1: 'healthy' }), day(9, { A1: 'healthy' })]);
  const row = deriveAutopsy(t).assumptions[0]!;
  check('an assumption that never broke has no gap at all', row.warningDays === undefined);
  check('and no invented dates', row.firstBreakAt === undefined && row.firstWarningAt === undefined);
}

// ---- outcomes -------------------------------------------------------------

console.log('\noutcomes');

{
  const t = thesisOf(
    [assumption({ id: 'A1' }), assumption({ id: 'A2' }), assumption({ id: 'A3' }), assumption({ id: 'A4' })],
    [
      day(1, { A1: 'healthy', A2: 'healthy', A3: 'healthy', A4: 'healthy' }),
      day(5, { A1: 'healthy', A2: 'weakening', A3: 'broken', A4: 'healthy' }, [
        change('A2', 'healthy', 'weakening'),
        change('A3', 'healthy', 'broken'),
      ]),
      day(9, { A1: 'healthy', A2: 'weakening', A3: 'healthy', A4: 'healthy' }, [
        change('A3', 'broken', 'healthy'),
      ]),
    ],
  );
  const autopsy = deriveAutopsy(t);
  const by = (id: string) => autopsy.assumptions.find((a) => a.assumptionId === id)!;

  check('an assumption that never moved held', by('A1').outcome === 'held', by('A1').outcome);
  check('one that weakened but never broke is separated out', by('A2').outcome === 'weakened', by('A2').outcome);
  check('one that broke and came back is recovered, not broken', by('A3').outcome === 'recovered', by('A3').outcome);
  check('the counts add up', autopsy.held === 2 && autopsy.broke === 1, `${autopsy.held}/${autopsy.broke}`);
}

{
  const t = thesisOf(
    [assumption({ id: 'A1', testability: 'none' })],
    [day(1, { A1: 'uncheckable' }), day(9, { A1: 'uncheckable' })],
  );
  const autopsy = deriveAutopsy(t);
  const row = autopsy.assumptions[0]!;

  check(
    'THE CLAIM: an untestable assumption is never reported as having held',
    row.outcome === 'never readable',
    row.outcome,
  );
  check('it is counted separately', autopsy.unreadable === 1 && autopsy.held === 0);
}

// ---- span and provenance of the record itself ----------------------------

console.log('\nthe record');

{
  const t = thesisOf(
    [assumption({ id: 'A1' })],
    [
      day(1, { A1: 'healthy' }, [], 'backfill'),
      day(2, { A1: 'healthy' }, [], 'backfill'),
      day(3, { A1: 'healthy' }, [], 'live'),
    ],
  );
  const autopsy = deriveAutopsy(t);

  check('the span is taken from the log ends', autopsy.from?.startsWith('2026-06-01') === true);
  check('and runs to the newest check', autopsy.to?.startsWith('2026-06-03') === true);
  check('checks are counted', autopsy.checks === 3, String(autopsy.checks));
  check(
    'reconstructed checks are counted separately, so the page can say so',
    autopsy.reconstructed === 2,
    String(autopsy.reconstructed),
  );
}

{
  const t = thesisOf([assumption({ id: 'A1' })], []);
  const autopsy = deriveAutopsy(t);
  check('a thesis with no checks yields no span rather than a fake one', autopsy.from === null && autopsy.to === null);
  check('and no headline', autopsy.earliestWarning === null);
}

// ---- the longest warning wins --------------------------------------------

console.log('\nthe longest warning');

{
  const t = thesisOf(
    [assumption({ id: 'A1' }), assumption({ id: 'A2' })],
    [
      day(1, { A1: 'healthy', A2: 'healthy' }),
      day(2, { A1: 'weakening', A2: 'healthy' }, [change('A1', 'healthy', 'weakening')]),
      day(5, { A1: 'weakening', A2: 'weakening' }, [change('A2', 'healthy', 'weakening')]),
      day(7, { A1: 'weakening', A2: 'broken' }, [change('A2', 'weakening', 'broken')]),
      day(20, { A1: 'broken', A2: 'broken' }, [change('A1', 'weakening', 'broken')]),
    ],
  );
  const autopsy = deriveAutopsy(t);
  check(
    'the headline is the LONGEST warning, not the first break',
    autopsy.earliestWarning?.days === 18,
    String(autopsy.earliestWarning?.days),
  );
  check('and names the assumption it belongs to', autopsy.earliestWarning?.statement === 'statement A1');
}

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
