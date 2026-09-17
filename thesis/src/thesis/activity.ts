import type { Provenance } from '../data/types';
import type { Metric } from '../engine/breakers/types';
import type { Check, Health, ThesisRecord } from './types';

/**
 * The activity feed: everything that has actually CHANGED, across every thesis.
 *
 * ## Why this walks the check logs instead of keeping its own list
 *
 * A separate activity table would be a second copy of the truth, and the moment
 * the two disagreed there would be no way to tell which one was lying. Every
 * transition is already recorded by `appendCheck` as a `HealthChange`, complete
 * with the assumption, both ends of the move, the number that caused it and its
 * provenance. Nothing here is computed; this is a rendering of the log.
 *
 * ## Why routine checks are deliberately excluded
 *
 * The loop runs four times an hour and nearly always finds everything exactly as
 * it was. That is reassuring, and it is not news. A feed listing every check
 * would bury the handful of entries that matter under several hundred that do
 * not, and a reader who learns to scroll past this screen will scroll past it on
 * the day it finally says something.
 */

export interface ActivityEntry {
  at: string;
  thesisId: string;
  ticker: string;
  /** Which thesis version was in force. A revision resets the baseline. */
  version: number;
  /** The assumption that moved, in the user's own decomposed words. */
  statement: string;
  from: Health;
  to: Health;
  metric?: Metric;
  observed?: number;
  threshold?: number;
  provenance?: Provenance;
  /**
   * Whether this was OBSERVED or RECONSTRUCTED.
   *
   * Carried all the way to the screen. A backfilled transition is what the
   * tripwires WOULD have said had the thesis existed then, and presenting it
   * beside a live one without saying so would claim credit for a warning nobody
   * ever received.
   */
  source: Check['source'];
}

/** Is this something that happened while the thesis was actually being watched? */
export function isObserved(entry: ActivityEntry): boolean {
  return entry.source !== 'backfill';
}

/**
 * Every transition across every thesis, newest first.
 *
 * Retired theses are included on purpose. A thesis the user closed out still
 * has a history worth reading, and dropping it would quietly rewrite what the
 * feed had already shown.
 */
export function buildActivityFeed(theses: ThesisRecord[], limit?: number): ActivityEntry[] {
  const entries: ActivityEntry[] = [];

  for (const thesis of theses) {
    for (const check of thesis.checks) {
      for (const change of check.changes) {
        entries.push({
          at: check.at,
          thesisId: thesis.id,
          ticker: thesis.ticker,
          version: check.version,
          statement: change.statement,
          from: change.from,
          to: change.to,
          source: check.source,
          ...(change.metric ? { metric: change.metric } : {}),
          ...(change.observed !== undefined ? { observed: change.observed } : {}),
          ...(change.threshold !== undefined ? { threshold: change.threshold } : {}),
          ...(change.provenance ? { provenance: change.provenance } : {}),
        });
      }
    }
  }

  entries.sort((a, b) => {
    const byTime = b.at.localeCompare(a.at);
    if (byTime !== 0) return byTime;
    // Same instant: worst news first, so a break is never listed under a
    // recovery that happened in the same check.
    return severity(b) - severity(a);
  });

  return limit === undefined ? entries : entries.slice(0, limit);
}

const RANK: Record<Health, number> = { healthy: 0, uncheckable: 1, weakening: 2, broken: 3 };

function severity(entry: ActivityEntry): number {
  return RANK[entry.to] - RANK[entry.from];
}

export interface ActivitySummary {
  total: number;
  observed: number;
  reconstructed: number;
  /** ISO time of the most recent transition, or null when nothing has moved. */
  latestAt: string | null;
}

export function summariseActivity(entries: ActivityEntry[]): ActivitySummary {
  const observed = entries.filter(isObserved).length;
  return {
    total: entries.length,
    observed,
    reconstructed: entries.length - observed,
    latestAt: entries[0]?.at ?? null,
  };
}
