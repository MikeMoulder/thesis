import '../env';
/**
 * Snapshot real HistoricalEvidence to a fixture for chart work.
 *
 *   npm run snapshot:history
 *
 * The output is REAL engine output against real SEC and Yahoo data, written to
 * disk once so the chart can be iterated on without re-fetching ten years of
 * filings on every reload. It is fixture data in the sense that it is frozen,
 * not in the sense that it is made up.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getDataSource } from '../data/index';
import { evaluateHistorical, type HistoricalEvidence } from '../engine/breakers/evaluate';
import type { ThesisBreaker } from '../engine/breakers/types';

const BREAKERS: ThesisBreaker[] = [
  {
    id: 'B1',
    kind: 'threshold',
    assumptionRef: 'A3',
    statement: 'Gross margin falls below 70%.',
    metric: 'grossMargin',
    operator: '<',
    threshold: 70,
    severity: 'high',
    severityInherited: true,
    cadence: 'periodic',
  },
  {
    id: 'B3',
    kind: 'threshold',
    assumptionRef: 'A5',
    statement: 'The underlying falls 20% or more from its trailing high.',
    metric: 'drawdownFromHigh',
    operator: '<=',
    threshold: -20,
    severity: 'medium',
    severityInherited: true,
    cadence: 'continuous',
  },
];

async function main(): Promise<void> {
  const ds = getDataSource();
  const instrument = await ds.resolve('NVDA');

  const out: Record<string, HistoricalEvidence> = {};
  for (const breaker of BREAKERS) {
    const result = await evaluateHistorical(ds, instrument, breaker);
    if (!('occurrences' in result)) {
      console.log(`  ${breaker.id}  skipped: ${result.reason}`);
      continue;
    }
    out[breaker.id] = result;
    console.log(
      `  ${breaker.id}  ${result.occurrences.length} occurrences · ${result.series.length} charted points · ${result.windowDescription}`,
    );
  }

  const path = join(process.cwd(), 'src', 'lib', 'fixtures', 'history.json');
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote ${path}`);
}

main().catch((err) => {
  console.error('snapshot failed:', err);
  process.exit(1);
});
