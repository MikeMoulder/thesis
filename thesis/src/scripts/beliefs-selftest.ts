/**
 * The belief list: one verdict per assumption, worst first.
 *
 * This is the order a reader meets a run in, so the things it must never get
 * wrong are tested here: a crossed line is "broken" and comes first, something
 * nothing can read is never "holding", the list does not reshuffle while a run
 * is still arriving, and the number formats a reader sees carry their units.
 *
 * Offline and deterministic. No network, no model.
 */
import { deriveBeliefs } from '../engine/beliefs';
import { formatGap, formatValue, type Evaluation } from '../engine/breakers/evaluate';
import { summariseBreakers, type BreakerSet, type ThesisBreaker } from '../engine/breakers/types';
import { summarise, type Assumption, type Decomposition } from '../engine/decomposer/types';
import type { AssumptionHealth } from '../thesis/types';

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
    thesis: 'fixture',
    claims,
    assumptions,
    ambiguities: [],
    summary: summarise(claims, assumptions),
    meta: { model: 'fixture', latencyMs: 0, decomposedAt: '2026-01-01T00:00:00.000Z' },
  };
}

function breakerSetOf(breakers: ThesisBreaker[], assumptions: Assumption[]): BreakerSet {
  return {
    ticker: 'NVDA',
    breakers,
    uncovered: [],
    summary: summariseBreakers(breakers, [], assumptions),
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
  };
}

const ids = (beliefs: { assumption: Assumption }[]) => beliefs.map((b) => b.assumption.id).join(',');

// ---------------------------------------------------------------------------

console.log('\nverdicts from a fresh run');

{
  const as = [
    assumption({ id: 'A1' }),
    assumption({ id: 'A2' }),
    assumption({ id: 'A3', testability: 'none' }),
    assumption({ id: 'A4', testability: 'event' }),
  ];
  const bs = breakerSetOf(
    [
      breaker({ id: 'B1', assumptionRef: 'A1' }),
      breaker({ id: 'B2', assumptionRef: 'A2' }),
      breaker({ id: 'B4', assumptionRef: 'A4', kind: 'event', cadence: 'event' } as never),
    ],
    as,
  );
  const evals = [
    evaluation({ breakerId: 'B1' }),
    evaluation({ breakerId: 'B2', status: 'fired', observed: 65, headroom: -5 }),
    evaluation({ breakerId: 'B4', status: 'undeterminable', observed: undefined, headroom: undefined }),
  ];
  const beliefs = deriveBeliefs({ decomposition: decompositionOf(as), breakerSet: bs, evaluations: evals });
  const status = (id: string) => beliefs.find((b) => b.assumption.id === id)?.status;

  check('a fired tripwire makes its belief broken', status('A2') === 'broken', status('A2'));
  check('a reading inside the line is holding', status('A1') === 'holding', status('A1'));
  check('an untestable belief is unknown, never holding', status('A3') === 'unknown', status('A3'));
  check('an unreadable event tripwire is unknown', status('A4') === 'unknown', status('A4'));
  check('broken first, then unknown, then holding', ids(beliefs) === 'A2,A3,A4,A1', ids(beliefs));
  check('each belief keeps its original number', beliefs.find((b) => b.assumption.id === 'A3')?.number === 3);
}

{
  const as = [assumption({ id: 'A1' }), assumption({ id: 'A2' })];
  const bs = breakerSetOf(
    [breaker({ id: 'B1', assumptionRef: 'A1' }), breaker({ id: 'B2', assumptionRef: 'A2' })],
    as,
  );
  const beliefs = deriveBeliefs({
    decomposition: decompositionOf(as),
    breakerSet: bs,
    evaluations: [
      evaluation({ breakerId: 'B1', status: 'fired', headroom: -1 }),
      evaluation({ breakerId: 'B2', status: 'holding', headroom: 2 }),
    ],
  });
  check('one fired tripwire is enough to break its belief', beliefs[0]?.status === 'broken');
}

console.log('\nwhile a run is still arriving');

{
  const as = [
    assumption({ id: 'A1' }),
    assumption({ id: 'A2', testability: 'none' }),
    assumption({ id: 'A3' }),
  ];
  const pending = deriveBeliefs({ decomposition: decompositionOf(as), breakersPending: true });
  check('before tripwires exist, every testable belief is pending', pending[0]?.status === 'pending');
  check(
    'and the list keeps the model order, so nothing jumps',
    ids(pending) === 'A1,A2,A3',
    ids(pending),
  );

  const bs = breakerSetOf(
    [breaker({ id: 'B1', assumptionRef: 'A1' }), breaker({ id: 'B3', assumptionRef: 'A3' })],
    as,
  );
  const partial = deriveBeliefs({
    decomposition: decompositionOf(as),
    breakerSet: bs,
    evaluations: [evaluation({ breakerId: 'B1', status: 'fired', headroom: -1 })],
  });
  check('a half-read run is still in model order', ids(partial) === 'A1,A2,A3', ids(partial));
}

console.log('\nordering within a verdict');

{
  const as = [
    assumption({ id: 'A1', loadBearing: 'low' }),
    assumption({ id: 'A2', loadBearing: 'high' }),
    assumption({ id: 'A3', loadBearing: 'high' }),
  ];
  const bs = breakerSetOf(
    [
      breaker({ id: 'B1', assumptionRef: 'A1' }),
      breaker({ id: 'B2', assumptionRef: 'A2' }),
      breaker({ id: 'B3', assumptionRef: 'A3' }),
    ],
    as,
  );
  const beliefs = deriveBeliefs({
    decomposition: decompositionOf(as),
    breakerSet: bs,
    evaluations: [
      evaluation({ breakerId: 'B1', headroom: 1, threshold: 70 }),
      evaluation({ breakerId: 'B2', headroom: 20, threshold: 70 }),
      evaluation({ breakerId: 'B3', headroom: 5, threshold: 70 }),
    ],
  });
  check('the holding belief nearest its line comes first', ids(beliefs) === 'A1,A3,A2', ids(beliefs));
  check('closeness is a share of the threshold', Math.abs((beliefs[0]?.closeness ?? 0) - 1 / 70) < 1e-9);
}

console.log('\na stored thesis uses its health verdict');

{
  const as = [assumption({ id: 'A1' }), assumption({ id: 'A2' })];
  const health: AssumptionHealth[] = [
    { assumptionId: 'A1', statement: '', loadBearing: 'high', health: 'healthy', basis: 'stable', directionUnknown: false, drivers: [] },
    { assumptionId: 'A2', statement: '', loadBearing: 'high', health: 'weakening', basis: 'narrowing', directionUnknown: false, drivers: [] },
  ];
  const bs = breakerSetOf(
    [breaker({ id: 'B1', assumptionRef: 'A1' }), breaker({ id: 'B2', assumptionRef: 'A2' })],
    as,
  );
  const beliefs = deriveBeliefs({
    decomposition: decompositionOf(as),
    breakerSet: bs,
    // Holding by status, but health knows it is narrowing. Health wins.
    evaluations: [evaluation({ breakerId: 'B1' }), evaluation({ breakerId: 'B2' })],
    health,
  });
  check('weakening health reads as at risk', beliefs[0]?.status === 'at-risk', beliefs[0]?.status);
  check('and outranks a healthy belief', ids(beliefs) === 'A2,A1', ids(beliefs));
}

console.log('\nnumbers a reader sees');

check('dollars get a sign and a scale', formatValue('exitDepthUsd', 73327.71) === '$73.3K', formatValue('exitDepthUsd', 73327.71));
check('billions stay billions', formatValue('revenue', 63_734_000_000) === '$63.73B', formatValue('revenue', 63_734_000_000));
check('a loss keeps its sign in front of the $', formatValue('netIncome', -1_500_000_000) === '-$1.50B', formatValue('netIncome', -1_500_000_000));
check('small dollar amounts keep cents', formatValue('price', 219.41) === '$219.41', formatValue('price', 219.41));
check('multiples read as times', formatValue('priceToSales', 25.4) === '25.4×', formatValue('priceToSales', 25.4));
check('basis points say so', formatValue('spreadBps', 12.4) === '12 bps', formatValue('spreadBps', 12.4));
check('percentages are unchanged', formatValue('grossMargin', 53.77) === '53.77%', formatValue('grossMargin', 53.77));
check('a percent gap is in points', formatGap('grossMargin', -1.23) === '1.23 points', formatGap('grossMargin', -1.23));
check('a multiple gap is in points, not times', formatGap('priceToSales', 10.4) === '10.4 points', formatGap('priceToSales', 10.4));
check('a dollar gap is in dollars', formatGap('exitDepthUsd', 48327.71) === '$48.3K', formatGap('exitDepthUsd', 48327.71));

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
