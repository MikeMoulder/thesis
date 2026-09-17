import type { DataSource } from '../data/DataSource';
import type { Instrument } from '../data/types';
import { evaluateLive, type Evaluation } from '../engine/breakers/evaluate';
import { getRateLimiter } from '../llm/index';
import { appendCheck } from './record';
import type { ThesisStore } from './store';
import {
  currentVersion,
  latestCheck,
  type Health,
  type HealthChange,
  type ThesisRecord,
} from './types';

/**
 * The recheck loop — the part that makes "last checked 18 minutes ago" a fact.
 *
 * This is the whole 24/7 argument, and it is affordable for one specific
 * reason: **a recheck costs zero model calls.** Decomposing a thesis and
 * generating its tripwires needs a model; asking whether a stored numeric
 * condition is currently true does not. The tripwires were written once and are
 * simply re-read against fresh data.
 *
 * That claim is measured rather than asserted — `modelCalls` in the report is
 * read from the rate limiter's own counters before and after, so if a future
 * change ever sneaks a model call into this path, the number stops being zero
 * and the self-test fails.
 */

/** Skip anything checked more recently than this, unless forced. */
export const DEFAULT_MIN_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Stop starting new work this long before the platform kills the function.
 *
 * A recheck that is killed mid-write is worse than one that stops early and
 * says so: the next run picks up the remainder, whereas a truncated report
 * would quietly under-report what was checked.
 */
export const DEADLINE_MARGIN_MS = 5000;

export interface RecheckOptions {
  /** Ignore `minIntervalMs`. Used by the test harness and manual triggers. */
  force?: boolean;
  minIntervalMs?: number;
  /** Epoch ms after which no new thesis is started. */
  deadline?: number;
  /** Check only this thesis. */
  only?: string;
  now?: () => number;
}

export interface RecheckOutcome {
  id: string;
  ticker: string;
  result: 'checked' | 'skipped' | 'failed' | 'deferred';
  health?: Health;
  changes?: HealthChange[];
  /** Why it was skipped, deferred, or failed. */
  reason?: string;
  ms?: number;
}

export interface RecheckReport {
  startedAt: string;
  ms: number;
  considered: number;
  checked: number;
  skipped: number;
  deferred: number;
  failed: number;
  /** Measured, not assumed. Must be 0 — see the note at the top of this file. */
  modelCalls: number;
  /** Every transition across every thesis, newest work first. The feed. */
  changes: Array<HealthChange & { thesisId: string; ticker: string; at: string }>;
  outcomes: RecheckOutcome[];
}

function totalModelCalls(): number {
  return getRateLimiter()
    .allUsage()
    .reduce((sum, row) => sum + row.used, 0);
}

/**
 * Re-evaluate every live thesis and append one check to each.
 *
 * Theses are grouped by ticker so an instrument is resolved once per ticker
 * rather than once per thesis. With several theses on the same name — which is
 * the normal case for one user — that is the difference between one SEC lookup
 * and five.
 */
export async function recheckAll(
  store: ThesisStore,
  ds: DataSource,
  options: RecheckOptions = {},
): Promise<RecheckReport> {
  const now = options.now ?? Date.now;
  const startedAtMs = now();
  const startedAt = new Date(startedAtMs).toISOString();
  const callsBefore = totalModelCalls();
  const minInterval = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;

  const all = await store.list();
  const candidates = all.filter((t) => {
    if (options.only) return t.id === options.only;
    // Retired theses are not under observation. A broken one still is — the
    // user has not accepted the break yet, and it can recover.
    return t.status !== 'retired';
  });

  const outcomes: RecheckOutcome[] = [];
  const changes: RecheckReport['changes'] = [];

  // Group by ticker to share one instrument resolution.
  const byTicker = new Map<string, ThesisRecord[]>();
  for (const thesis of candidates) {
    const list = byTicker.get(thesis.ticker);
    if (list) list.push(thesis);
    else byTicker.set(thesis.ticker, [thesis]);
  }

  for (const [ticker, theses] of byTicker) {
    // Everything still unprocessed when the clock runs out is deferred, not
    // failed: the next run will pick it up, and calling it a failure would put
    // a red mark on a thesis that is perfectly healthy.
    if (options.deadline !== undefined && now() > options.deadline - DEADLINE_MARGIN_MS) {
      for (const thesis of theses) {
        outcomes.push({
          id: thesis.id,
          ticker,
          result: 'deferred',
          reason: 'ran out of time this cycle; will be picked up next run',
        });
      }
      continue;
    }

    const due = theses.filter((thesis) => {
      if (options.force) return true;
      const last = latestCheck(thesis);
      if (!last) return true;
      const age = now() - Date.parse(last.at);
      if (Number.isNaN(age)) return true;
      return age >= minInterval;
    });

    for (const thesis of theses) {
      if (!due.includes(thesis)) {
        outcomes.push({
          id: thesis.id,
          ticker,
          result: 'skipped',
          reason: `checked less than ${Math.round(minInterval / 60000)} minutes ago`,
        });
      }
    }
    if (due.length === 0) continue;

    let instrument: Instrument;
    try {
      instrument = await ds.resolve(ticker);
    } catch (error) {
      // One unresolvable ticker must not sink the rest of the run.
      for (const thesis of due) {
        outcomes.push({
          id: thesis.id,
          ticker,
          result: 'failed',
          reason: `could not resolve ${ticker}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
      continue;
    }

    for (const thesis of due) {
      const startedThesisAt = now();
      try {
        const version = currentVersion(thesis);
        const evaluations: Evaluation[] = [];

        for (const breaker of version.breakerSet.breakers) {
          // evaluateLive already converts its own failures into
          // `undeterminable`, so a dead provider produces an honest gap rather
          // than a thrown run or a false "holding".
          evaluations.push(await evaluateLive(ds, instrument, breaker));
        }

        const updated = appendCheck(thesis, {
          evaluations,
          modelCalls: 0,
          source: 'live',
          at: new Date(now()).toISOString(),
        });

        await store.put(updated);

        const check = latestCheck(updated)!;
        outcomes.push({
          id: thesis.id,
          ticker,
          result: 'checked',
          health: check.health,
          changes: check.changes,
          ms: now() - startedThesisAt,
        });

        for (const change of check.changes) {
          changes.push({ ...change, thesisId: thesis.id, ticker, at: check.at });
        }
      } catch (error) {
        outcomes.push({
          id: thesis.id,
          ticker,
          result: 'failed',
          reason: error instanceof Error ? error.message : String(error),
          ms: now() - startedThesisAt,
        });
      }
    }
  }

  const tally = (result: RecheckOutcome['result']) =>
    outcomes.filter((o) => o.result === result).length;

  return {
    startedAt,
    ms: now() - startedAtMs,
    considered: candidates.length,
    checked: tally('checked'),
    skipped: tally('skipped'),
    deferred: tally('deferred'),
    failed: tally('failed'),
    modelCalls: totalModelCalls() - callsBefore,
    changes,
    outcomes,
  };
}
