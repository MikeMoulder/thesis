/**
 * Self-test for the second reader's merge logic.
 *
 *   npm run challenge:selftest
 *
 * No model and no network. The model call itself is not the risky part here:
 * it fails open, and a failure is visible. The dangerous code is what happens
 * when the challenge SUCCEEDS, because the additions arrive after the main
 * tripwires have already been generated, evaluated and put on screen.
 *
 * Two ways that goes wrong quietly. Ids can collide, because a second
 * generation pass starts counting at B1 again and every evaluation is keyed by
 * breaker id, so a duplicate silently attaches one breaker's reading to
 * another. And the challenger can restate an assumption the first pass already
 * found, which pads the report with a finding that is not one.
 *
 * Both produce output that renders perfectly and is wrong.
 */
import { mergeBreakers } from '../engine/challenge';
import type { Assumption } from '../engine/decomposer/types';
import type { BreakerSet, Cadence, Metric, ThesisBreaker } from '../engine/breakers/types';

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

function breaker(id: string, ref: string, metric: Metric, cadence: Cadence = 'continuous'): ThesisBreaker {
  return {
    id,
    assumptionRef: ref,
    statement: `${metric} moves`,
    severity: 'high',
    severityInherited: true,
    kind: 'threshold',
    metric,
    operator: '<',
    threshold: 1,
    cadence,
  } as ThesisBreaker;
}

function set(breakers: ThesisBreaker[], uncovered: BreakerSet['uncovered'] = []): BreakerSet {
  return {
    ticker: 'TEST',
    breakers,
    uncovered,
    summary: {
      total: breakers.length,
      byCadence: { continuous: 0, event: 0, periodic: 0 },
      quietUntilEarnings: false,
      uncoveredHighLoad: [],
    },
    meta: { model: 'stub', latencyMs: 100, generatedAt: '2026-09-17T00:00:00Z' },
  };
}

function assumption(id: string, loadBearing: Assumption['loadBearing'], testability: Assumption['testability']): Assumption {
  return {
    id,
    statement: `assumption ${id}`,
    origin: 'implicit',
    supports: ['C1'],
    loadBearing,
    testability,
  } as Assumption;
}

// ---------------------------------------------------------------------------
// Renumbering. The reason this function exists.
// ---------------------------------------------------------------------------

console.log('\nids must not collide');

const base = set([breaker('B1', 'A1', 'grossMargin'), breaker('B2', 'A2', 'exitDepthUsd')]);
// A fresh generation pass counts from B1 again. This is the real input shape.
const extra = set([breaker('B1', 'A3', 'trailingPE'), breaker('B2', 'A4', 'volatility90d')]);
const assumptions = [
  assumption('A1', 'high', 'fundamental'),
  assumption('A2', 'high', 'liquidity'),
  assumption('A3', 'medium', 'valuation'),
  assumption('A4', 'low', 'price'),
];

const merged = mergeBreakers(base, extra, assumptions);

check('every id in the merged set is unique', new Set(merged.breakers.map((b) => b.id)).size === merged.breakers.length, merged.breakers.map((b) => b.id).join(','));
check('the merged set holds every breaker from both', merged.breakers.length === 4, String(merged.breakers.length));
check(
  'the additions are renumbered to continue the sequence',
  merged.breakers.map((b) => b.id).join(',') === 'B1,B2,B3,B4',
  merged.breakers.map((b) => b.id).join(','),
);
check(
  'the ORIGINAL ids are untouched, because their evaluations are already on screen',
  merged.breakers[0]!.id === 'B1' && merged.breakers[1]!.id === 'B2',
);
check(
  'renumbering does not move a breaker onto a different assumption',
  merged.breakers[2]!.assumptionRef === 'A3' && merged.breakers[3]!.assumptionRef === 'A4',
  `${merged.breakers[2]!.assumptionRef}, ${merged.breakers[3]!.assumptionRef}`,
);
check(
  'and it does not change what a breaker measures',
  merged.breakers[2]!.kind === 'threshold' &&
    (merged.breakers[2] as { metric: Metric }).metric === 'trailingPE',
);

// ---------------------------------------------------------------------------
// The summary counts the WHOLE set, not just the first half
// ---------------------------------------------------------------------------

console.log('\nthe summary is recomputed, not carried over');

check('total reflects both sets', merged.summary.total === 4, String(merged.summary.total));
check(
  'cadences are counted across the merged list',
  merged.summary.byCadence.continuous === 4,
  JSON.stringify(merged.summary.byCadence),
);

const withUncovered = mergeBreakers(
  base,
  set([], [{ assumptionId: 'A5', statement: 'nothing can read this', reason: 'no data' }]),
  [...assumptions, assumption('A5', 'high', 'none')],
);
check(
  'an addition nothing can watch is carried into uncovered',
  withUncovered.uncovered.some((u) => u.assumptionId === 'A5'),
);
check(
  'and a high-load one nothing watches reaches the blind spot list',
  withUncovered.summary.uncoveredHighLoad.includes('A5'),
  withUncovered.summary.uncoveredHighLoad.join(','),
);

// ---------------------------------------------------------------------------
// Nothing to merge
// ---------------------------------------------------------------------------

console.log('\nan empty second pass changes nothing');

const untouched = mergeBreakers(base, set([]), assumptions);
check('the base set is returned as-is', untouched === base);
check('no id is rewritten when there is nothing to add', untouched.breakers.map((b) => b.id).join(',') === 'B1,B2');

// ---------------------------------------------------------------------------
// Latency is additive, because two calls really were made
// ---------------------------------------------------------------------------

console.log('\nmeta');

check(
  'latency adds up across both generation passes',
  merged.meta.latencyMs === 200,
  String(merged.meta.latencyMs),
);
check('the ticker survives the merge', merged.ticker === 'TEST');

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
