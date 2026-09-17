/**
 * Prove the memory layer is really wired to a real database.
 *
 *   npm run memory:check
 *
 * Unlike `thesis:selftest`, this one DOES hit the network. That is the point:
 * the self-test proves the logic, this proves the credentials. A cron that
 * silently writes nothing at 3am looks exactly like a cron that ran and found
 * nothing changed, so the connection gets verified deliberately rather than
 * discovered later.
 *
 * Writes one throwaway record under a reserved id and deletes it again.
 */
import '../env';

import { getStore, storeStatus } from '../thesis/store';
import type { ThesisRecord } from '../thesis/types';

const PROBE_ID = '__memory_check__';

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(18)} ${value}`);
}

const status = storeStatus();

console.log('\nmemory');
line('adapter', status.kind);
line('persisted', status.persisted ? 'yes' : 'NO');
line('detail', status.detail);

if (!status.persisted) {
  console.log(
    '\n  ✗ Running on the in-memory adapter. Nothing survives a restart, and\n' +
      '    "last checked" would be a number we drew rather than a fact we\n' +
      '    recorded. Set KV_REST_API_URL and KV_REST_API_TOKEN (or the\n' +
      '    UPSTASH_REDIS_REST_* pair) and run this again.\n',
  );
  process.exit(1);
}

const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? '';
line('endpoint', url.replace(/^https?:\/\//, '').split('.')[0] + '.…');

const store = getStore();

const probe: ThesisRecord = {
  id: PROBE_ID,
  ticker: 'PROBE',
  direction: 'neutral',
  createdAt: new Date().toISOString(),
  status: 'retired',
  versions: [],
  checks: [],
};

let failed = false;

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failed = true;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\nround trip');

try {
  const startedAt = Date.now();
  await store.put(probe);
  const writeMs = Date.now() - startedAt;

  const readAt = Date.now();
  const back = await store.get(PROBE_ID);
  const readMs = Date.now() - readAt;

  check('a record can be written', back !== null);
  check('and read back intact', back?.ticker === 'PROBE', back?.ticker);
  check('and appears in the index', (await store.list()).some((t) => t.id === PROBE_ID));

  await store.remove(PROBE_ID);
  check('and can be removed', (await store.get(PROBE_ID)) === null);
  check('and leaves the index clean', (await store.list()).every((t) => t.id !== PROBE_ID));

  console.log('\nlatency');
  line('write', `${writeMs}ms`);
  line('read', `${readMs}ms`);
  if (readMs > 150) {
    console.log(
      `\n  ⚠ ${readMs}ms per read is high. The app runs in sin1 (Singapore) —\n` +
        '    check the Upstash database region matches, or every page load pays\n' +
        '    this twice.',
    );
  }
} catch (error) {
  failed = true;
  console.log(`\n  ✗ ${error instanceof Error ? error.message : String(error)}`);
  // Best effort: do not leave a probe record behind on a partial failure.
  await store.remove(PROBE_ID).catch(() => {});
}

console.log(failed ? '\nmemory is NOT usable\n' : '\nmemory is live and persisted\n');
process.exit(failed ? 1 : 0);
