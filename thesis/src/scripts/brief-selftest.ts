/**
 * Self-test for the closing brief.
 *
 *   npm run brief:selftest
 *
 * No model and no network. `deriveBrief` is a pure function over data the run
 * already produced, which is the whole reason it can be checked at all: this is
 * the section a reader is most likely to take away and repeat, so every claim
 * in it has to follow from the numbers rather than from a model's prose.
 */
import { deriveBrief } from '../engine/brief';
import type { Evaluation } from '../engine/breakers/evaluate';
import { summariseBreakers, type BreakerSet, type ThesisBreaker } from '../engine/breakers/types';
import { summarise, type Assumption, type Decomposition } from '../engine/decomposer/types';

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

function decompositionOf(assumptions: Assumption[]): Decomposition {
  const claims = [{ id: 'C1', statement: 'NVDA outperforms', direction: 'bullish' as const }];
  return {
    ticker: 'NVDA',
    claims,
    assumptions,
    summary: summarise(claims, assumptions),
    meta: { model: 'fixture', latencyMs: 0, generatedAt: '2026-01-01T00:00:00.000Z' },
  } as unknown as Decomposition;
}

function breakerSetOf(
  breakers: ThesisBreaker[],
  assumptions: Assumption[],
  uncovered: BreakerSet['uncovered'] = [],
): BreakerSet {
  return {
    ticker: 'NVDA',
    breakers,
    uncovered,
    summary: summariseBreakers(breakers, uncovered, assumptions),
    meta: { model: 'fixture', latencyMs: 0, generatedAt: '2026-01-01T00:00:00.000Z' },
  };
}

function evaluation(over: Partial<Evaluation> & { breakerId: string }): Evaluation {
  return {
    mode: 'live',
    status: 'holding',
    metric: 'grossMargin',
    observed: 74.98,
    threshold: 70,
    headroom: 4.98,
    ...over,
  } as Evaluation;
}

// ---- the bet and the standing --------------------------------------------

console.log('\nthe bet');

{
  const a = [assumption({ id: 'A1' })];
  const brief = deriveBrief(decompositionOf(a));
  check('the brief opens with what is being bet on', brief.bet[0] === 'NVDA outperforms.');
  check(
    'a claim without a full stop gets one, because these get concatenated',
    brief.bet[0]?.endsWith('.') === true,
    brief.bet[0],
  );
}

{
  const a = [assumption({ id: 'A1' })];
  const bs = breakerSetOf([breaker({ id: 'B1', assumptionRef: 'A1' })], a);
  const brief = deriveBrief(decompositionOf(a), bs, [evaluation({ breakerId: 'B1' })]);
  check(
    'with nothing crossed, the standing line says so and counts what is watched',
    brief.standing.includes('Nothing has been crossed') && brief.standing.includes('1'),
    brief.standing,
  );
}

{
  const a = [assumption({ id: 'A1' })];
  const bs = breakerSetOf([breaker({ id: 'B1', assumptionRef: 'A1' })], a);
  const brief = deriveBrief(decompositionOf(a), bs, [
    evaluation({ breakerId: 'B1', status: 'fired', observed: 62, headroom: -8 }),
  ]);
  check(
    'a crossed tripwire takes over the standing line',
    brief.standing.startsWith('1 of your tripwires'),
    brief.standing,
  );
}

// ---- the readings: the part a reader takes away ---------------------------

console.log('\nreadings');

{
  const a = [assumption({ id: 'A1' })];
  const bs = breakerSetOf([breaker({ id: 'B1', assumptionRef: 'A1' })], a);
  const brief = deriveBrief(decompositionOf(a), bs, [evaluation({ breakerId: 'B1' })]);
  const row = brief.readings[0]!;

  check('THE POINT: a reading carries a number to hold on to', row.now === '74.98%', row.now);
  check('and the level that would break it', row.breaksAt === '70.00%', row.breaksAt);
  check('and how much room is left', row.room === '4.98 points', row.room);
  check('and when it can next move', row.movesWhen.includes('quarterly report'), row.movesWhen);
  check('the metric is named in words, never as a property', row.label === 'gross margin', row.label);
}

{
  const a = [assumption({ id: 'A1' }), assumption({ id: 'A2' }), assumption({ id: 'A3' })];
  const bs = breakerSetOf(
    [
      breaker({ id: 'B1', assumptionRef: 'A1' }),
      breaker({ id: 'B2', assumptionRef: 'A2' }),
      breaker({ id: 'B3', assumptionRef: 'A3' }),
    ],
    a,
  );
  const brief = deriveBrief(decompositionOf(a), bs, [
    evaluation({ breakerId: 'B1' }),
    evaluation({ breakerId: 'B2', status: 'undeterminable', reason: 'no filing' }),
    evaluation({ breakerId: 'B3', status: 'fired', observed: 62, headroom: -8 }),
  ]);

  check(
    'a crossed line is listed first',
    brief.readings[0]?.status === 'fired',
    brief.readings.map((r) => r.status).join(','),
  );
  check(
    'then the one nobody could read, because that outranks a clean bill of health',
    brief.readings[1]?.status === 'unreadable',
    brief.readings.map((r) => r.status).join(','),
  );
  check('and the healthy one is last', brief.readings[2]?.status === 'holding');
  check(
    'an unreadable reading carries no number, rather than a made up one',
    brief.readings[1]?.now === undefined && brief.readings[1]?.room === undefined,
  );
  check(
    'and it still says what would break it',
    brief.readings[1]?.breaksAt === '70.00%',
    brief.readings[1]?.breaksAt,
  );
}

// ---- the focus ------------------------------------------------------------

console.log('\nthe one to watch');

{
  const a = [assumption({ id: 'A1' }), assumption({ id: 'A2' })];
  const bs = breakerSetOf(
    [
      breaker({ id: 'B1', assumptionRef: 'A1', statement: 'gross margin falls under 70' }),
      breaker({
        id: 'B2',
        assumptionRef: 'A2',
        metric: 'volatility90d',
        operator: '>',
        threshold: 60,
        cadence: 'continuous',
        statement: 'volatility rises over 60',
      }),
    ],
    a,
  );
  const brief = deriveBrief(decompositionOf(a), bs, [
    evaluation({ breakerId: 'B1', headroom: 4.98 }),
    evaluation({ breakerId: 'B2', metric: 'volatility90d', observed: 31, threshold: 60, headroom: 29 }),
  ]);

  check('the nearest tripwire is picked out', brief.focus !== null);
  check(
    'and it is the one closest RELATIVE to its own threshold',
    // Case insensitive: sentence() capitalises, and what matters here is WHICH
    // breaker was picked, not how its first letter is cased.
    brief.focus?.line.toLowerCase().includes('gross margin') === true,
    brief.focus?.line,
  );
  check(
    'the detail says how far and when it can move',
    brief.focus?.detail.includes('4.98 points') === true &&
      brief.focus.detail.includes('quarterly report'),
    brief.focus?.detail,
  );
}

{
  const a = [assumption({ id: 'A1' })];
  const brief = deriveBrief(decompositionOf(a));
  check('with nothing readable there is no focus, rather than an invented one', brief.focus === null);
}

// ---- judgement and limits, last ------------------------------------------

console.log('\njudgement and limits');

{
  const a = [
    assumption({ id: 'A1', testability: 'none', loadBearing: 'high', statement: 'the market has priced this in' }),
    assumption({ id: 'A2' }),
  ];
  const brief = deriveBrief(decompositionOf(a), breakerSetOf([], a));
  check(
    'an assumption nothing can test is quoted, never named by id',
    brief.judgement[0] === 'The market has priced this in.',
    brief.judgement[0],
  );
  check(
    'and the foundation counts say the whole trade rests on it',
    brief.foundation.some((f) => f.includes('holding up the whole trade')),
    brief.foundation.join(' | '),
  );
}

{
  const a = [assumption({ id: 'A1' })];
  const bs = breakerSetOf([breaker({ id: 'B1', assumptionRef: 'A1' })], a);
  const brief = deriveBrief(decompositionOf(a), bs, [
    evaluation({ breakerId: 'B1', status: 'undeterminable', reason: 'Could not derive gross margin for AMD' }),
  ]);
  check('an unread tripwire lands in limits', brief.limits.length === 1, String(brief.limits.length));
  check(
    'the reason is punctuated, so it does not run into the next sentence',
    brief.limits[0]?.includes('for AMD. Treat it as unknown') === true,
    brief.limits[0],
  );
}

{
  const a = [assumption({ id: 'A1', testability: 'fundamental', loadBearing: 'high' })];
  const bs = breakerSetOf([], a, [{ assumptionId: 'A1', statement: 'statement A1', reason: 'none built' }]);
  const brief = deriveBrief(decompositionOf(a), bs, []);
  check(
    'a measurable assumption with no tripwire is reported as a gap',
    brief.limits.some((l) => l.includes('no tripwire')),
    brief.limits.join(' | '),
  );
}

// ---- the whole thing holds together --------------------------------------

console.log('\nshape');

{
  const a = [assumption({ id: 'A1' })];
  const brief = deriveBrief(decompositionOf(a));
  check('a run with no tripwires still produces a bet', brief.bet.length === 1);
  check('and still counts the foundation', brief.foundation.length >= 1);
  check('and says plainly that nothing can be watched', brief.standing.includes('Nothing here can be watched'), brief.standing);
  check('and invents no readings', brief.readings.length === 0);
}

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
