import type { Provenance } from '../data/types';
import type { Metric } from '../engine/breakers/types';
import { currentVersion, type Health, type ThesisRecord } from './types';

/**
 * The autopsy: what survived, what failed, and whether you could have known
 * earlier.
 *
 * ## Why this is the point of keeping a log at all
 *
 * Everything else in this product can be done with a snapshot. Decomposing a
 * thesis, writing tripwires, reading them against today's data: none of that
 * needs memory. This does. The only question a person really has after a trade
 * goes wrong is "was there a sign, and did I miss it?", and answering it
 * requires having written down what things looked like BEFORE anyone knew the
 * answer.
 *
 * So the headline is the GAP: the number of days between the first time an
 * assumption weakened and the day it actually broke. That gap is the whole
 * value proposition expressed as a single number, and it is measured from the
 * record rather than claimed.
 *
 * ## It is derived, never generated
 *
 * A model asked to write a post-mortem will produce a confident narrative that
 * drifts from the log, and this is the section most likely to be believed
 * because it reads like a conclusion. Every date here is a timestamp from a
 * stored check.
 */

export type Outcome =
  /** Never left healthy across the whole log. */
  | 'held'
  /** Reached broken at some point and is still broken. */
  | 'broke'
  /** Reached broken and came back. The log is explicit about this. */
  | 'recovered'
  /** Weakened but never broke. */
  | 'weakened'
  /** Nothing could ever read it. The most dangerous outcome, not the mildest. */
  | 'never readable';

export interface AssumptionAutopsy {
  assumptionId: string;
  statement: string;
  loadBearing: 'high' | 'medium' | 'low';
  outcome: Outcome;
  currentHealth: Health;
  /** First time it left healthy. The warning, if there was one. */
  firstWarningAt?: string;
  /** First time it reached broken. */
  firstBreakAt?: string;
  /**
   * Whole days between the first warning and the first break.
   *
   * Zero is a real and important answer: it means the warning and the break
   * arrived in the same check, so there was nothing to act on. Absent means it
   * never broke at all.
   */
  warningDays?: number;
  /** The reading at the moment it broke. */
  metric?: Metric;
  observed?: number;
  threshold?: number;
  provenance?: Provenance;
}

export interface Autopsy {
  thesisId: string;
  ticker: string;
  statement: string;
  checks: number;
  from: string | null;
  to: string | null;
  /** How many of those checks were reconstructed rather than observed. */
  reconstructed: number;
  assumptions: AssumptionAutopsy[];
  held: number;
  broke: number;
  unreadable: number;
  /**
   * The longest warning the log actually gave, across every assumption that
   * broke. Null when nothing broke, which must not be rendered as good news:
   * a thesis can be perfectly intact and still be carrying an untestable
   * assumption that nothing would ever have warned about.
   */
  earliestWarning: {
    statement: string;
    warnedAt: string;
    brokeAt: string;
    days: number;
  } | null;
}

const DAY = 86_400_000;

function wholeDaysBetween(from: string, to: string): number {
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.floor(ms / DAY));
}

/**
 * Walk the log once per assumption, in order, recording firsts.
 *
 * Reads the CHANGES rather than the per-check health, because a change carries
 * the evidence that caused it. Health alone would tell us an assumption broke
 * and leave us unable to say what broke it.
 */
export function deriveAutopsy(thesis: ThesisRecord): Autopsy {
  const version = currentVersion(thesis);
  const checks = thesis.checks;
  const rows: AssumptionAutopsy[] = [];

  for (const assumption of version.decomposition.assumptions) {
    const row: AssumptionAutopsy = {
      assumptionId: assumption.id,
      statement: assumption.statement,
      loadBearing: assumption.loadBearing,
      outcome: 'held',
      currentHealth: 'uncheckable',
    };

    for (const check of checks) {
      const state = check.assumptions.find((a) => a.assumptionId === assumption.id);
      if (state) row.currentHealth = state.health;

      for (const change of check.changes) {
        if (change.assumptionId !== assumption.id) continue;

        if (row.firstWarningAt === undefined && change.to !== 'healthy') {
          row.firstWarningAt = check.at;
        }
        if (row.firstBreakAt === undefined && change.to === 'broken') {
          row.firstBreakAt = check.at;
          if (change.metric) row.metric = change.metric;
          if (change.observed !== undefined) row.observed = change.observed;
          if (change.threshold !== undefined) row.threshold = change.threshold;
          if (change.provenance) row.provenance = change.provenance;
        }
      }
    }

    if (row.firstWarningAt !== undefined && row.firstBreakAt !== undefined) {
      row.warningDays = wholeDaysBetween(row.firstWarningAt, row.firstBreakAt);
    }

    row.outcome = outcomeOf(row, assumption.testability === 'none');
    rows.push(row);
  }

  const broken = rows.filter((r) => r.firstBreakAt !== undefined && r.warningDays !== undefined);
  const earliest = broken.sort((a, b) => (b.warningDays ?? 0) - (a.warningDays ?? 0))[0];

  return {
    thesisId: thesis.id,
    ticker: thesis.ticker,
    statement: version.statement,
    checks: checks.length,
    from: checks[0]?.at ?? null,
    to: checks[checks.length - 1]?.at ?? null,
    reconstructed: checks.filter((c) => c.source === 'backfill').length,
    assumptions: rows,
    held: rows.filter((r) => r.outcome === 'held').length,
    broke: rows.filter((r) => r.outcome === 'broke' || r.outcome === 'recovered').length,
    unreadable: rows.filter((r) => r.outcome === 'never readable').length,
    earliestWarning:
      earliest && earliest.firstWarningAt && earliest.firstBreakAt
        ? {
            statement: earliest.statement,
            warnedAt: earliest.firstWarningAt,
            brokeAt: earliest.firstBreakAt,
            days: earliest.warningDays ?? 0,
          }
        : null,
  };
}

function outcomeOf(row: AssumptionAutopsy, untestable: boolean): Outcome {
  /*
    Untestable comes FIRST, ahead of "held".

    An assumption nothing could ever read did not survive the observation
    period; it was never under observation. Reporting it as held would be the
    single most dishonest line this function could produce, because the whole
    autopsy exists to show what the record does and does not support.
  */
  if (untestable || row.currentHealth === 'uncheckable') return 'never readable';
  if (row.firstBreakAt !== undefined) {
    return row.currentHealth === 'broken' ? 'broke' : 'recovered';
  }
  if (row.firstWarningAt !== undefined) return 'weakened';
  return 'held';
}
