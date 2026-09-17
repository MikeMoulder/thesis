import '../env.js';
/**
 * Breaker evaluator against real data, with breakers written by hand.
 *
 *   npm run evaluate
 *
 * No model calls — this exercises the evaluator, not the generator, so it costs
 * no quota and is deterministic.
 */
import { getDataSource } from '../data/index';
import {
  evaluateHistorical,
  evaluateLive,
  evaluateScenario,
  formatValue,
  type Evaluation,
  type HistoricalEvidence,
  type ThesisBreaker,
} from '../engine/breakers/index';

const BREAKERS: ThesisBreaker[] = [
  {
    id: 'B1',
    assumptionRef: 'A1',
    kind: 'threshold',
    statement: 'Gross margin falls below 70%',
    severity: 'high',
    severityInherited: true,
    cadence: 'periodic',
    metric: 'grossMargin',
    operator: '<',
    threshold: 70,
  },
  {
    id: 'B2',
    assumptionRef: 'A2',
    kind: 'threshold',
    statement: 'Year-over-year revenue growth drops below 30%',
    severity: 'medium',
    severityInherited: true,
    cadence: 'periodic',
    metric: 'revenueGrowthYoY',
    operator: '<',
    threshold: 30,
  },
  {
    id: 'B3',
    assumptionRef: 'A3',
    kind: 'threshold',
    statement: 'Drawdown from the trailing one-year high exceeds 20%',
    severity: 'low',
    severityInherited: true,
    cadence: 'continuous',
    metric: 'drawdownFromHigh',
    operator: '<=',
    threshold: -20,
  },
  {
    id: 'B4',
    assumptionRef: 'A4',
    kind: 'event',
    statement: 'A major customer announces competing in-house silicon',
    severity: 'high',
    severityInherited: true,
    cadence: 'event',
    watchFor: 'a top customer announcing its own AI accelerator',
    keywords: ['custom silicon', 'in-house chip', 'TPU'],
  },
];

function rule(label: string): void {
  console.log(`\n${'━'.repeat(70)}\n${label}\n${'━'.repeat(70)}`);
}

function statusTag(s: Evaluation['status']): string {
  return { fired: '🔴 FIRED  ', holding: '🟢 holding', undeterminable: '⚪ unknown', unaffected: '⚪ n/a    ' }[s];
}

function renderEval(e: Evaluation, b: ThesisBreaker): void {
  console.log(`\n  ${e.breakerId}  ${statusTag(e.status)}  ${b.statement}`);
  if (e.observed !== undefined && e.metric) {
    const obs = formatValue(e.metric, e.observed);
    const thr = formatValue(e.metric, e.threshold!);
    const head = formatValue(e.metric, Math.abs(e.headroom ?? 0));
    console.log(
      `      ${e.metric} = ${obs}  vs  ${b.kind === 'threshold' ? b.operator : ''} ${thr}` +
        `   (${(e.headroom ?? 0) >= 0 ? head + ' of headroom' : head + ' past it'})`,
    );
  }
  if (e.period) console.log(`      period ${e.period}, knowable ${e.asOf?.slice(0, 10)}`);
  else if (e.asOf) console.log(`      as of ${e.asOf.slice(0, 19).replace('T', ' ')}`);
  if (e.provenance) console.log(`      [${e.provenance.status}] ${e.provenance.source}`);
  if (e.reason) console.log(`      ${e.reason}`);
}

function renderHistorical(h: HistoricalEvidence, b: ThesisBreaker): void {
  console.log(`\n  ${h.breakerId}  ${b.statement}`);
  console.log(`      ${h.note}`);

  for (const o of h.occurrences) {
    const f30 = o.forward30d === null ? '  n/a ' : `${o.forward30d >= 0 ? '+' : ''}${o.forward30d.toFixed(1)}%`;
    const f90 = o.forward90d === null ? '  n/a ' : `${o.forward90d >= 0 ? '+' : ''}${o.forward90d.toFixed(1)}%`;
    console.log(
      `        ${o.date}  ${formatValue(h.metric, o.value).padStart(8)}` +
        `${o.period ? ` (${o.period})` : ''}   30d ${f30}   90d ${f90}`,
    );
  }

  if (h.occurrences.length) {
    const m30 = h.medianForward30d === null ? 'n/a' : `${h.medianForward30d.toFixed(1)}%`;
    const m90 = h.medianForward90d === null ? 'n/a' : `${h.medianForward90d.toFixed(1)}%`;
    console.log(`      median forward: 30d ${m30}   90d ${m90}`);
  }

  console.log(
    `      severity: ${b.severity} (inherited)` +
      (h.measuredSeverity
        ? `  →  ${h.measuredSeverity} (measured from ${h.occurrences.length} occurrences)`
        : '  →  not enough evidence to measure; stays inherited'),
  );
}

async function main(): Promise<void> {
  const ticker = process.argv[2] ?? 'NVDA';
  const ds = getDataSource();
  const inst = await ds.resolve(ticker);

  console.log(`\n${inst.name ?? ticker}  ·  rToken ${inst.rTokenSymbol ?? 'none'}  ·  CIK ${inst.cik ?? 'none'}`);

  rule('LIVE  — did it happen?');
  for (const b of BREAKERS) {
    renderEval(await evaluateLive(ds, inst, b), b);
  }

  rule('SCENARIO  — what if gross margin fell to 62% and growth to 15%?');
  const scenario = { grossMargin: 62, revenueGrowthYoY: 15 };
  for (const b of BREAKERS) {
    renderEval(evaluateScenario(b, scenario), b);
  }

  rule('HISTORICAL  — when it happened before, what followed?');
  for (const b of BREAKERS) {
    const r = await evaluateHistorical(ds, inst, b);
    if ('status' in r) renderEval(r, b);
    else renderHistorical(r, b);
  }

  console.log();
}

main().catch((err) => {
  console.error('evaluate failed:', err);
  process.exit(1);
});
