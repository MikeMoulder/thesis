import '../env.js';
/**
 * What can this engine actually measure, right now, for real companies?
 *
 *   npm run coverage
 *   npm run coverage -- AMD NVDA PLTR
 *
 * NOT part of `npm test`. The test suite is deterministic and network-free on
 * purpose; this hits SEC and the market and therefore cannot be. It exists
 * because the question it answers cannot be answered from fixtures: whether a
 * given filer tags its figures the way we expect is a fact about that filer, and
 * the only way to find out is to ask.
 *
 * Run it before a demo and before touching `edgar.ts`. Every "nothing can check
 * this" a user sees traces back to a gap this script would have shown.
 *
 * ## The failure this was written to catch
 *
 * A metric that reads a PLAUSIBLE BUT WRONG number is far more dangerous than
 * one that fails, because nothing on screen looks broken. AMD's revenue read
 * $1.58B against a real $11.54B, because it was tagged `Revenues` until 2018
 * and that abandoned node still resolves. So this prints the values, not just
 * pass or fail: a human scanning the table is the check.
 */
import { getDataSource, resolveInstrument } from '../data/index';
import { readMetric } from '../engine/breakers/metrics';
import {
  FUNDAMENTAL_METRICS,
  PRICE_METRICS,
  VALUATION_METRICS,
  type Metric,
} from '../engine/breakers/types';

const DEFAULT_TICKERS = ['AMD', 'NVDA', 'TSLA', 'AAPL', 'MSFT', 'META', 'AMZN', 'GOOGL', 'INTC'];

const tickers = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const universe = tickers.length > 0 ? tickers : DEFAULT_TICKERS;
const metrics: Metric[] = [...FUNDAMENTAL_METRICS, ...PRICE_METRICS, ...VALUATION_METRICS];

const ds = getDataSource();

function short(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(0)}M`;
  return value.toFixed(2);
}

let readable = 0;
let total = 0;
const failuresByMetric = new Map<string, string[]>();

console.log(`\nChecking ${metrics.length} metrics across ${universe.length} companies.\n`);

for (const ticker of universe) {
  const instrument = await resolveInstrument(ticker);
  const cells: string[] = [];

  for (const metric of metrics) {
    total++;
    try {
      const reading = await readMetric(ds, instrument, metric);
      readable++;
      cells.push(`${metric}=${short(reading.value)}`);
    } catch (error) {
      const list = failuresByMetric.get(metric) ?? [];
      list.push(`${ticker}: ${error instanceof Error ? error.message.slice(0, 70) : 'unknown'}`);
      failuresByMetric.set(metric, list);
      cells.push(`${metric}=FAIL`);
    }
  }

  console.log(`${ticker.padEnd(6)} ${cells.join('  ')}\n`);
}

console.log(`${readable}/${total} readable  (${total - readable} could not be measured)`);

if (failuresByMetric.size > 0) {
  console.log('\nWhat could not be read, and why:');
  for (const [metric, reasons] of failuresByMetric) {
    console.log(`\n  ${metric}`);
    for (const reason of reasons) console.log(`    ${reason}`);
  }
}

// A non-zero exit would make this unusable as a diagnostic, because gaps are
// the normal state of affairs and the point is to SEE them.
process.exit(0);
