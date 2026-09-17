import '../env.js';
/**
 * Reconstruct a thesis's past and write it to the store.
 *
 *   npm run backfill -- --id tsla-c5qqql
 *   npm run backfill -- --all --days 120 --dry-run
 *   npm run backfill -- --id tsla-c5qqql --replace
 *
 * Zero model calls — this is the evaluator reading history, not the generator
 * writing tripwires. The number is measured and printed, not claimed.
 *
 * The store it is about to write to is printed BEFORE anything happens. A
 * script that silently wrote to an in-memory store while the deployment talked
 * to Redis has cost this project an afternoon once already; the fix was
 * `.env.local` load order, and this line is how you can see it worked.
 */
import { getDataSource } from '../data/index';
import { backfilledCount, backfillThesis, DEFAULT_BACKFILL_DAYS } from '../thesis/backfill';
import { getStore, storeStatus } from '../thesis/store';
import { latestCheck, type ThesisRecord } from '../thesis/types';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const id = flag('id');
const days = Number(flag('days') ?? DEFAULT_BACKFILL_DAYS);
const stride = Number(flag('stride') ?? 1);
const replace = has('replace');
const dryRun = has('dry-run');

if (!id && !has('all')) {
  console.error('Give me --id <thesisId>, or --all.');
  process.exit(1);
}
if (!Number.isFinite(days) || days <= 0) {
  console.error(`--days must be a positive number, got ${flag('days')}`);
  process.exit(1);
}

const store = getStore();
const status = storeStatus();
console.log(`\nstore: ${status.kind} · persisted: ${status.persisted} — ${status.detail}`);
if (dryRun) console.log('DRY RUN — nothing will be written.\n');
else console.log('');

const all = await store.list();
const targets: ThesisRecord[] = id ? all.filter((t) => t.id === id) : all;

if (targets.length === 0) {
  console.error(id ? `No thesis with id ${id}. Have: ${all.map((t) => t.id).join(', ')}` : 'No theses.');
  process.exit(1);
}

const ds = getDataSource();
let failures = 0;

for (const thesis of targets) {
  const before = thesis.checks.length;
  console.log(`${thesis.ticker} ${thesis.id} — ${before} checks (${backfilledCount(thesis)} reconstructed)`);

  try {
    const instrument = await ds.resolve(thesis.ticker);
    const { thesis: updated, report } = await backfillThesis(ds, instrument, thesis, {
      days,
      stride,
      replace,
    });

    console.log(
      `  wrote ${report.written} checks  ${report.from?.slice(0, 10) ?? '-'} → ${report.to?.slice(0, 10) ?? '-'}` +
        `  · modelCalls: ${report.modelCalls}`,
    );

    if (report.transitions.length === 0) {
      console.log('  no health transition in the reconstructed span');
    } else {
      console.log(`  ${report.transitions.length} transition(s):`);
      for (const t of report.transitions) {
        const evidence =
          t.observed !== undefined && t.threshold !== undefined
            ? ` (${t.metric} ${t.observed.toFixed(2)} vs ${t.threshold})`
            : '';
        console.log(`    ${t.at.slice(0, 10)}  ${t.from} → ${t.to}  ${t.assumptionId}${evidence}`);
      }
    }

    for (const note of report.notes) console.log(`  note: ${note}`);

    if (report.modelCalls !== 0) {
      // Loud, because quota is the scarce resource and this path is meant to be
      // free. Something has been wired into the evaluator that should not be.
      console.error(`  WARN  a backfill spent ${report.modelCalls} model calls — it is meant to cost none`);
    }

    if (!dryRun) {
      await store.put(updated);
      const reread = await store.get(thesis.id);
      const written = reread?.checks.length ?? 0;
      const observed = reread?.checks.filter((c) => c.source !== 'backfill').length ?? 0;
      console.log(
        `  stored: ${written} checks (${backfilledCount(reread!)} reconstructed, ${observed} observed)` +
          `  · last ${latestCheck(reread!)?.at.slice(0, 16) ?? '-'}`,
      );
    }
  } catch (error) {
    failures++;
    console.error(`  FAILED  ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log('');
}

process.exit(failures === 0 ? 0 : 1);
