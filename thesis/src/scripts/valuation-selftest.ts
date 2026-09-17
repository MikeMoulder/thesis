/**
 * Self-test for the valuation metrics.
 *
 *   npm run valuation:selftest
 *
 * No model and no network. The data source is a fixture, so the arithmetic can
 * be checked exactly rather than eyeballed against a live number that changes
 * every second.
 *
 * These metrics are the answer to the most common unstated assumption in any
 * thesis, "this is not already priced in", and they are built by combining
 * three sources that disagree about time: a price from this second, earnings
 * from months ago and a share count from a filing. Getting the combination
 * wrong produces a plausible number, which is the most dangerous kind.
 */
import type { DataSource } from '../data/DataSource';
import type { Instrument } from '../data/types';
import { readMetric } from '../engine/breakers/metrics';
import {
  METRIC_SEMANTICS,
  VALUATION_METRICS,
  type ValuationMetric,
} from '../engine/breakers/types';
import { TESTABILITY_CADENCE } from '../engine/decomposer/types';
import { defineMetric } from '../lib/glossary';

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

const INSTRUMENT = { ticker: 'TEST', yahooSymbol: 'TEST', cik: '0000000001' } as Instrument;

/** Quarterly points, oldest first, as the data layer returns them. */
function quarters(values: number[]) {
  return values.map((value, i) => ({
    concept: 'x',
    end: `2025-${String(3 * (i + 1)).padStart(2, '0')}-30`,
    value,
    unit: 'USD',
    form: '10-Q',
    accession: `acc-${i}`,
    filed: '2026-01-01',
    firstFiled: '2026-01-01',
  }));
}

function fakeSource(over: {
  price?: number | undefined;
  eps?: number[];
  revenue?: number[];
  shares?: number | undefined;
}) {
  return {
    name: 'fixture',
    async getQuote() {
      if (over.price === undefined) throw new Error('no quote');
      return {
        value: { last: over.price, ts: Date.parse('2026-06-30T00:00:00Z') },
        provenance: { status: 'sourced', source: 'fixture market' },
      };
    },
    async getFundamentalSeries(_i: Instrument, concept: string) {
      const series = concept === 'eps' ? over.eps : over.revenue;
      if (!series) throw new Error(`no ${concept}`);
      return { value: quarters(series), provenance: { status: 'sourced', source: 'fixture 10-Q' } };
    },
    async getSharesOutstanding() {
      if (over.shares === undefined) throw new Error('no share count');
      return { value: over.shares, provenance: { status: 'sourced', source: 'fixture cover page' } };
    },
  } as unknown as DataSource;
}

async function read(metric: ValuationMetric, ds: DataSource): Promise<number | string> {
  try {
    return (await readMetric(ds, INSTRUMENT, metric)).value;
  } catch (error) {
    return `THREW: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ---- the arithmetic -------------------------------------------------------

console.log('\ntrailing twelve months');

{
  // Five quarters filed. Only the LAST four count: 2+3+4+5 = 14.
  const ds = fakeSource({ price: 140, eps: [1, 2, 3, 4, 5] });
  const pe = await read('trailingPE', ds);
  check('price to earnings divides by the last four quarters', pe === 10, String(pe));
  check(
    'THE TRAP: an older fifth quarter is excluded, not averaged in',
    pe !== 140 / 15,
    String(pe),
  );
}

{
  const ds = fakeSource({ price: 140, eps: [1, 2, 3] });
  const pe = await read('trailingPE', ds);
  check(
    'fewer than four quarters refuses rather than summing a part year',
    typeof pe === 'string' && pe.includes('fewer than four quarters'),
    String(pe),
  );
}

{
  const ds = fakeSource({ price: 200, eps: [1, 2, 3, 4] });
  const yld = await read('earningsYield', ds);
  check('earnings yield is the inverse, as a percent', yld === 5, String(yld));
}

// ---- the refusal that matters --------------------------------------------

console.log('\nloss making');

{
  const ds = fakeSource({ price: 100, eps: [-1, -2, -3, -4] });
  const pe = await read('trailingPE', ds);
  check(
    'THE CLAIM: a loss making company gets no price to earnings ratio',
    typeof pe === 'string' && pe.includes('no meaningful price to earnings'),
    String(pe),
  );
  check(
    'and the refusal points at the metric that does work',
    typeof pe === 'string' && pe.includes('earnings yield'),
    String(pe),
  );
}

{
  // A negative multiple reads like a cheap stock and means the opposite. A
  // negative yield reads exactly as what it is.
  const ds = fakeSource({ price: 100, eps: [-1, -2, -3, -4] });
  const yld = await read('earningsYield', ds);
  check('but earnings yield still reports, and reports negative', yld === -10, String(yld));
}

{
  const ds = fakeSource({ price: 100, eps: [5, 5, -6, -6] });
  const pe = await read('trailingPE', ds);
  check(
    'a company that lost money across the YEAR is refused even with profitable quarters',
    typeof pe === 'string' && pe.includes('no meaningful price to earnings'),
    String(pe),
  );
}

// ---- market value and sales ----------------------------------------------

console.log('\nmarket value');

{
  const ds = fakeSource({ price: 50, shares: 1_000_000_000 });
  const cap = await read('marketCap', ds);
  check('market value is price times shares', cap === 50_000_000_000, String(cap));
}

{
  const ds = fakeSource({ price: 50, shares: 1_000_000_000, revenue: [1e9, 1e9, 1e9, 2e9] });
  const ps = await read('priceToSales', ds);
  check('price to sales divides market value by a full year of revenue', ps === 10, String(ps));
}

{
  const ds = fakeSource({ price: 50, revenue: [1e9, 1e9, 1e9, 2e9] });
  const ps = await read('priceToSales', ds);
  check(
    'without a share count there is no market value and so no price to sales',
    typeof ps === 'string' && ps.includes('share count'),
    String(ps),
  );
}

{
  const ds = fakeSource({ eps: [1, 2, 3, 4], shares: 1e9 });
  const cap = await read('marketCap', ds);
  check(
    'no price means no valuation at all, rather than a stale one',
    typeof cap === 'string' && cap.includes('No current price'),
    String(cap),
  );
}

// ---- the vocabulary is complete ------------------------------------------

console.log('\nvocabulary');

for (const metric of VALUATION_METRICS) {
  check(`${metric} declares its units and sign convention`, Boolean(METRIC_SEMANTICS[metric]));
  check(`${metric} has a plain English definition`, Boolean(defineMetric(metric)?.short));
}

check(
  'valuation moves continuously, because the price underneath it does',
  TESTABILITY_CADENCE.valuation === 'continuous',
  String(TESTABILITY_CADENCE.valuation),
);

check(
  'the price to earnings convention warns that it is never negative',
  METRIC_SEMANTICS.trailingPE.includes('NEVER NEGATIVE'),
);

// ---- provenance is honest about the mixture ------------------------------

console.log('\nprovenance');

{
  const ds = fakeSource({ price: 140, eps: [1, 2, 3, 4] });
  const reading = await readMetric(ds, INSTRUMENT, 'trailingPE');
  check(
    'a figure built from a live price and an old filing is marked inferred',
    reading.provenance.status === 'inferred',
    reading.provenance.status,
  );
  check(
    'and names both sources rather than claiming one',
    reading.provenance.source.includes('market') && reading.provenance.source.includes('SEC'),
    reading.provenance.source,
  );
  check(
    'and shows the arithmetic',
    reading.provenance.derivation?.includes('divided by') === true,
    reading.provenance.derivation,
  );
}

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
