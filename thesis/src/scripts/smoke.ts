/**
 * End-to-end smoke test for the data layer.
 *
 * Exercises the real path an agent seat would take: resolve a ticker, read the
 * live rToken quote, pull underlying history, and derive a fundamentals series
 * with citations attached. Run with: npm run smoke
 */
import '../env.js';
import { getDataSource, NoDataError, ProviderError } from '../data/index';

const TICKERS = (process.argv[2] ?? 'NVDA,TSLA').split(',');

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function rule(label = ''): void {
  console.log(label ? `\n── ${label} ${'─'.repeat(Math.max(0, 60 - label.length))}` : '─'.repeat(64));
}

async function attempt(label: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    if (err instanceof NoDataError) {
      console.log(`  ${label}: UNVERIFIABLE — ${err.message}`);
    } else if (err instanceof ProviderError) {
      console.log(`  ${label}: PROVIDER ERROR — ${err.message}`);
    } else {
      console.log(`  ${label}: FAILED — ${(err as Error).message}`);
    }
    return false;
  }
}

async function main(): Promise<void> {
  const ds = getDataSource();
  console.log(`data source: ${ds.name}`);

  rule('health');
  const health = await ds.healthCheck();
  for (const p of health.providers) {
    console.log(
      `  ${p.ok ? 'OK  ' : 'DOWN'} ${p.name.padEnd(8)} ${String(p.latencyMs ?? '').padStart(5)}ms  ${p.detail ?? ''}`,
    );
  }
  console.log(`  overall: ${health.healthy ? 'healthy' : 'DEGRADED'}`);

  let passed = 0;
  let total = 0;

  for (const ticker of TICKERS) {
    rule(ticker);
    const inst = await ds.resolve(ticker);
    console.log(
      `  resolved: ${inst.name ?? '(no SEC name)'}\n` +
        `    rToken: ${inst.rTokenSymbol ?? 'not listed'}   CIK: ${inst.cik ?? 'none'}`,
    );

    total += 4;

    passed += (await attempt('quote', async () => {
      const q = await ds.getQuote(inst);
      console.log(
        `  quote: ${q.value.last} (${pct(q.value.changePct24h ?? 0)} 24h)  ` +
          `bid ${q.value.bid} / ask ${q.value.ask}`,
      );
      console.log(`    [${q.provenance.status}] ${q.provenance.source}`);
    }))
      ? 1
      : 0;

    passed += (await attempt('rToken candles', async () => {
      const c = await ds.getCandles(inst, '1D', 400);
      const first = c.value[0];
      const last = c.value[c.value.length - 1];
      if (!first || !last) throw new Error('empty candle series');
      const days = (last.ts - first.ts) / 86_400_000;
      console.log(
        `  rToken daily bars: ${c.value.length} spanning ${days.toFixed(0)}d ` +
          `(${new Date(first.ts).toISOString().slice(0, 10)} → ${new Date(last.ts).toISOString().slice(0, 10)})`,
      );
      if (days < 365) {
        console.log(
          `    note: only ${days.toFixed(0)}d of token history — base rates must come from the underlying`,
        );
      }
    }))
      ? 1
      : 0;

    passed += (await attempt('underlying history', async () => {
      const h = await ds.getUnderlyingHistory(inst, '5y');
      const first = h.value[0];
      const last = h.value[h.value.length - 1];
      if (!first || !last) throw new Error('empty history');
      const years = (last.ts - first.ts) / (365.25 * 86_400_000);
      console.log(
        `  underlying bars: ${h.value.length} spanning ${years.toFixed(1)}y  ` +
          `(close ${first.close.toFixed(2)} → ${last.close.toFixed(2)})`,
      );
      console.log(`    [${h.provenance.status}] ${h.provenance.source}`);
    }))
      ? 1
      : 0;

    passed += (await attempt('gross margin', async () => {
      const m = await ds.getDerivedMetric(inst, 'grossMargin', { limit: 8 });
      console.log('  gross margin, last 8 quarters:');
      for (const p of m.value) {
        const rev = p.inputs.find((i) => i.concept !== 'GrossProfit');
        const isQ4 = p.inputs.some((i) => i.derived);
        console.log(
          `    ${p.end}  ${p.value.toFixed(1).padStart(5)}%   ` +
            `${p.inputs[0]!.form} ${p.inputs[0]!.accession}` +
            (rev ? `  (rev ${(rev.value / 1e9).toFixed(1)}B)` : '') +
            (isQ4 ? '  ← Q4 reconstructed' : ''),
        );
      }
      console.log(`    [${m.provenance.status}/${m.provenance.confidence}] ${m.provenance.derivation}`);
      console.log(`    cite: ${m.provenance.url}`);
    }))
      ? 1
      : 0;
  }

  rule();
  console.log(`${passed}/${total} checks passed`);
  if (passed < total) process.exitCode = 1;
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exit(1);
});
