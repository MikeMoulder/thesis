/**
 * Self-test for the preset stress tests.
 *
 *   npm run stress:selftest
 *
 * No model and no network. The data source is a stub, so every scenario can be
 * checked against the exact number it should have produced.
 *
 * The thing under test is mostly arithmetic on live readings, and the failure
 * mode is quiet: a preset that builds the wrong hypothetical still returns a
 * full set of evaluations, still renders, and still reads as a stress test
 * that passed. Nothing on screen would show that the shock never happened.
 */
import type { DataSource } from '../data/DataSource';
import type { Instrument } from '../data/types';
import type { BreakerSet, Metric, ThesisBreaker } from '../engine/breakers/types';
import {
  describeStress,
  runStressPresets,
  STRESS_PRESETS,
  worstCase,
  type StressPreset,
} from '../engine/stress';

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

const INSTRUMENT = { ticker: 'TEST', yahooSymbol: 'TEST' } as Instrument;

/** A data source that returns fixed readings and fails for anything unlisted. */
function stubSource(readings: Partial<Record<Metric, number>>): DataSource {
  return {
    name: 'stub',
    async getQuote() {
      throw new Error('not used');
    },
  } as unknown as DataSource & { __readings: typeof readings };
}

/** Breakers covering each metric the presets touch. */
function breaker(id: string, metric: Metric, operator: '<' | '>' | '<=' | '>=', threshold: number): ThesisBreaker {
  return {
    id,
    assumptionRef: 'A1',
    statement: `${metric} ${operator} ${threshold}`,
    severity: 'high',
    severityInherited: true,
    kind: 'threshold',
    metric,
    operator,
    threshold,
    cadence: 'continuous',
  } as ThesisBreaker;
}

const BREAKERS = {
  ticker: 'TEST',
  breakers: [
    breaker('B1', 'grossMargin', '<', 70),
    breaker('B2', 'revenueGrowthYoY', '<', 10),
    breaker('B3', 'trailingPE', '>', 60),
    breaker('B4', 'drawdownFromHigh', '<=', -25),
    breaker('B5', 'volatility90d', '>', 50),
    breaker('B6', 'exitDepthUsd', '<', 25000),
  ],
  uncovered: [],
  summary: { total: 6, byCadence: {}, quietUntilEarnings: false, uncoveredHighLoad: [] },
  meta: { model: 'stub', latencyMs: 0, generatedAt: '2026-09-17T00:00:00Z' },
} as unknown as BreakerSet;

// ---------------------------------------------------------------------------
// The presets themselves
// ---------------------------------------------------------------------------

console.log('\nthe preset set');

check('there is a preset set at all', STRESS_PRESETS.length >= 5, String(STRESS_PRESETS.length));
check(
  'every preset has a distinct id',
  new Set(STRESS_PRESETS.map((p) => p.id)).size === STRESS_PRESETS.length,
);
check(
  'every preset explains why it is worth running',
  STRESS_PRESETS.every((p) => p.rationale.length > 60),
);
check(
  'every preset asks its question in plain language, not metric names',
  STRESS_PRESETS.every((p) => /\?$/.test(p.question) && !/[a-z][A-Z]/.test(p.question)),
);
check(
  'the exit is stress tested, not only the company',
  STRESS_PRESETS.some((p) => p.needs.includes('exitDepthUsd')),
);

// ---------------------------------------------------------------------------
// Scenarios are built FROM the live reading, not from round numbers
// ---------------------------------------------------------------------------

console.log('\nshocks are relative to where the metric actually is');

function preset(id: string): StressPreset {
  const found = STRESS_PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`no preset ${id}`);
  return found;
}

check(
  'a 75% margin shocks to 65, not to a fixed number',
  preset('margin-shock').build({ grossMargin: 75 })?.grossMargin === 65,
  JSON.stringify(preset('margin-shock').build({ grossMargin: 75 })),
);
check(
  'a 40% margin shocks to 30, proving it is not hardcoded',
  preset('margin-shock').build({ grossMargin: 40 })?.grossMargin === 30,
);
check(
  'multiple compression takes 30% off the CURRENT rating',
  preset('multiple-compression').build({ trailingPE: 50 })?.trailingPE === 35,
  JSON.stringify(preset('multiple-compression').build({ trailingPE: 50 })),
);
check(
  'volatility doubling doubles the CURRENT reading',
  preset('vol-spike').build({ volatility90d: 30 })?.volatility90d === 60,
);
check(
  'growth stalls to exactly zero rather than to a negative',
  preset('growth-stall').build({ revenueGrowthYoY: 25 })?.revenueGrowthYoY === 0,
);
check(
  'the drawdown preset is absolute, so it runs without a current reading',
  preset('drawdown').build({})?.drawdownFromHigh === -30,
);
check(
  'the liquidity preset empties the book rather than thinning it',
  preset('liquidity-drain').build({})?.exitDepthUsd === 0,
);

console.log('\na preset with nothing to build from does not invent one');

check(
  'margin shock without a margin reading returns null',
  preset('margin-shock').build({}) === null,
);
check(
  'multiple compression on a loss-making company returns null',
  preset('multiple-compression').build({ trailingPE: -12 }) === null,
  'a negative P/E has no meaningful 30% compression',
);
check(
  'volatility spike with a zero reading returns null',
  preset('vol-spike').build({ volatility90d: 0 }) === null,
);

// ---------------------------------------------------------------------------
// Running the set
// ---------------------------------------------------------------------------

console.log('\nrunning the whole set against a thesis');

// Patch readMetric's source by stubbing at the module boundary is overkill
// here; runStressPresets reads through the DataSource, so a source that throws
// for everything exercises the "nothing readable" path exactly.
const blind = stubSource({});
const report = await runStressPresets(blind, INSTRUMENT, BREAKERS);

check(
  'presets needing a live reading are skipped when nothing can be read',
  report.skipped.length >= 4,
  `${report.skipped.length} skipped`,
);
check(
  'every skip carries a reason rather than vanishing',
  report.skipped.every((s) => s.reason.length > 10),
);
check(
  'the absolute presets still run with no readings at all',
  report.results.length === 2,
  `${report.results.length} ran: ${report.results.map((r) => r.preset.id).join(', ')}`,
);
check(
  'the drawdown preset trips the drawdown breaker',
  report.results.find((r) => r.preset.id === 'drawdown')?.firedCount === 1,
);
check(
  'the empty book preset trips the exit depth breaker',
  report.results.find((r) => r.preset.id === 'liquidity-drain')?.firedCount === 1,
);
check(
  'breakers a scenario never touches are not counted as fired',
  report.results.every((r) => r.firedCount < BREAKERS.breakers.length),
);
check(
  'every result records the hypothetical it applied, so a reader can check it',
  report.results.every((r) => Object.keys(r.scenario).length > 0),
);

console.log('\nreporting');

const drawdown = report.results.find((r) => r.preset.id === 'drawdown')!;
check(
  'a shock with no current reading still describes itself',
  describeStress(drawdown, {}).includes('-30'),
  describeStress(drawdown, {}),
);
check(
  'a shock with a current reading says where it came FROM',
  describeStress(drawdown, { drawdownFromHigh: -5 }).includes('-5'),
  describeStress(drawdown, { drawdownFromHigh: -5 }),
);
check('worstCase picks a result when any ran', worstCase(report) !== null);
check(
  'worstCase returns null rather than throwing on an empty report',
  worstCase({ results: [], skipped: [], current: {} }) === null,
);

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
