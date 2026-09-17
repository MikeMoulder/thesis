import type { Provenance } from '../data/types';
import type { Evaluation } from '../engine/breakers/evaluate';
import type { BreakerSet, Metric } from '../engine/breakers/types';
import type { Decomposition } from '../engine/decomposer/types';

/**
 * The Thesis — the noun the product was missing.
 *
 * Everything before this was a RUN: the engine fired once, produced a dossier,
 * and forgot. A run cannot answer the only question that makes this product
 * different from a research chatbot — "is what I believed still true?" — because
 * answering it requires two observations and a memory of the first.
 *
 * So a Thesis is not a result. It is a belief that is kept under observation:
 *
 *     VERSIONS   what the user believed, and every time they revised it
 *     CHECKS     an append-only log of every time reality was consulted
 *
 * Both are append-only on purpose. A thesis that quietly rewrites its own
 * history is worthless for the thing users actually want from it, which is to
 * find out whether they could have known earlier.
 */

/**
 * The health of a belief, not of a position.
 *
 * `uncheckable` is deliberately NOT folded into `healthy`. An assumption
 * nothing can test is the most dangerous kind, and calling it healthy would be
 * the single most dishonest thing this system could do.
 */
export type Health = 'healthy' | 'weakening' | 'broken' | 'uncheckable';

export const HEALTH_RANK: Record<Health, number> = {
  healthy: 0,
  uncheckable: 1,
  weakening: 2,
  broken: 3,
};

/** The worst health in a set, or `healthy` for an empty one. */
export function worstHealth(healths: Health[]): Health {
  return healths.reduce<Health>(
    (worst, h) => (HEALTH_RANK[h] > HEALTH_RANK[worst] ? h : worst),
    'healthy',
  );
}

/**
 * WHY a health was assigned. Surfaced in the UI, never hidden.
 *
 * The distinction between `narrowing` and `proximity` is the whole value of
 * having a memory: `proximity` says "this is close to its limit", which a
 * single snapshot can tell you. `narrowing` says "and it is moving toward it",
 * which only a log can.
 */
export type HealthBasis =
  /** A breaker's condition was met. The assumption failed. */
  | 'fired'
  /**
   * Fired recently, and has since come back inside its line — but by less than
   * the margin required to call it recovered. Still broken. See HYSTERESIS.
   */
  | 'unrecovered'
  /** Holding, but closer to its threshold than at the previous check. */
  | 'narrowing'
  /** Holding, but within one typical move of its threshold. Direction unknown. */
  | 'proximity'
  /**
   * Holding with room, but it closed a full typical move since the last check.
   * Healthy — a fast move from a long way out is worth SHOWING, and it is not
   * worth changing a state over. See the note on flapping in health.ts.
   */
  | 'approaching'
  /** Holding with room, and not moving toward the threshold. */
  | 'stable'
  /** Nothing could be read. */
  | 'nodata';

/**
 * The health each basis stands for. Total by construction — `driverFor` assigns
 * the pair together, and this is the only place the correspondence is written
 * down, so a reader of a stored check can recover one from the other.
 */
export const HEALTH_FOR_BASIS: Record<HealthBasis, Health> = {
  fired: 'broken',
  unrecovered: 'broken',
  narrowing: 'weakening',
  proximity: 'weakening',
  approaching: 'healthy',
  stable: 'healthy',
  nodata: 'uncheckable',
};

/** One breaker's contribution to an assumption's health. */
export interface HealthDriver {
  breakerId: string;
  metric?: Metric;
  observed?: number;
  threshold?: number;
  /** Signed distance to the threshold; negative means past it. */
  headroom?: number;
  /** Headroom at the previous check, when there was one. */
  previousHeadroom?: number;
  /**
   * Consecutive checks this breaker has been inside its line, including this
   * one. Zero on a check where it fired.
   *
   * Carried so a flag can be lifted by PERSISTENCE as well as by distance: a
   * metric that crossed back by a hair and then held there for days has
   * recovered, and a deadband alone would call it broken forever. See
   * RECOVERY_CHECKS.
   */
  holdingFor?: number;
  basis: HealthBasis;
  provenance?: Provenance;
}

export interface AssumptionHealth {
  assumptionId: string;
  statement: string;
  loadBearing: 'high' | 'medium' | 'low';
  health: Health;
  basis: HealthBasis;
  /**
   * True when health was judged on distance alone because no previous check
   * exists to compare against. The UI must say so rather than implying a trend
   * it cannot see. Resolves to false from the second check onward.
   */
  directionUnknown: boolean;
  drivers: HealthDriver[];
}

/** A health transition between two consecutive checks. This is the news. */
export interface HealthChange {
  assumptionId: string;
  statement: string;
  from: Health;
  to: Health;
  /** The breaker whose movement caused the transition. */
  breakerId?: string;
  metric?: Metric;
  observed?: number;
  threshold?: number;
  /** Where the number came from. A change without evidence is an opinion. */
  provenance?: Provenance;
}

/**
 * One consultation of reality. Appended, never edited.
 *
 * `modelCalls` is recorded because it is the argument for the whole cadence:
 * a recheck costs ZERO model calls — it is the evaluator reading data — which
 * is what makes checking every fifteen minutes affordable rather than a claim.
 */
export interface Check {
  at: string;
  /** Which thesis version was being checked. Versions change; checks do not. */
  version: number;
  evaluations: Evaluation[];
  assumptions: AssumptionHealth[];
  health: Health;
  /** Transitions versus the previous check. Empty on the first check. */
  changes: HealthChange[];
  modelCalls: number;
  /** 'live' for the cron and page loads, 'backfill' for replayed history. */
  source: 'live' | 'backfill' | 'initial';
}

/**
 * What the user believed, at one point in time.
 *
 * A revision creates a new version rather than mutating the old one, so the
 * autopsy can show what was believed WHEN the evidence arrived — not what the
 * user retreated to afterwards.
 */
export interface ThesisVersion {
  n: number;
  /** The user's own words. */
  statement: string;
  createdAt: string;
  /** Why they revised. Absent on v1. */
  reason?: string;
  /** The evidence that prompted the revision, when there was any. */
  promptedBy?: HealthChange;
  decomposition: Decomposition;
  breakerSet: BreakerSet;
}

export type ThesisStatus =
  /** Under observation. */
  | 'live'
  /** A high load-bearing assumption failed and the user accepted it. */
  | 'broken'
  /** The user closed it out deliberately. */
  | 'retired';

export interface ThesisRecord {
  id: string;
  ticker: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  createdAt: string;
  status: ThesisStatus;
  /** v1 first. The current version is the last element. */
  versions: ThesisVersion[];
  /** Oldest first. Capped — see CHECK_LOG_LIMIT. */
  checks: Check[];
}

/**
 * Checks accumulate at four an hour. The log is the product, so it is trimmed
 * rather than dropped — but an unbounded array in a single Redis value would
 * eventually fail to write, and a silent write failure would look exactly like
 * "nothing happened", which is the one lie this system must not tell.
 */
export const CHECK_LOG_LIMIT = 500;

export function currentVersion(thesis: ThesisRecord): ThesisVersion {
  const version = thesis.versions[thesis.versions.length - 1];
  if (!version) throw new Error(`thesis ${thesis.id} has no versions`);
  return version;
}

export function latestCheck(thesis: ThesisRecord): Check | null {
  return thesis.checks[thesis.checks.length - 1] ?? null;
}

/** Health of the thesis as a whole, or `uncheckable` before the first check. */
export function thesisHealth(thesis: ThesisRecord): Health {
  return latestCheck(thesis)?.health ?? 'uncheckable';
}

/**
 * What one card on the My Theses screen needs, and nothing else.
 *
 * A full record carries two complete decompositions and breaker sets — tens of
 * kilobytes each. Sending eight of those to render a list of eight cards would
 * make the first screen the slowest one in the app.
 */
export interface ThesisSummary {
  id: string;
  ticker: string;
  direction: ThesisRecord['direction'];
  status: ThesisStatus;
  health: Health;
  /** The current version's statement, in the user's own words. */
  statement: string;
  version: number;
  assumptionCount: number;
  broken: number;
  weakening: number;
  uncheckable: number;
  /** ISO time of the most recent check, or null if none has run. */
  lastCheckedAt: string | null;
  checkCount: number;
  createdAt: string;
}

export function summariseThesis(thesis: ThesisRecord): ThesisSummary {
  const version = currentVersion(thesis);
  const check = latestCheck(thesis);
  const rows = check?.assumptions ?? [];
  const count = (health: Health) => rows.filter((a) => a.health === health).length;

  return {
    id: thesis.id,
    ticker: thesis.ticker,
    direction: thesis.direction,
    status: thesis.status,
    health: check?.health ?? 'uncheckable',
    statement: version.statement,
    version: version.n,
    assumptionCount: rows.length,
    broken: count('broken'),
    weakening: count('weakening'),
    uncheckable: count('uncheckable'),
    lastCheckedAt: check?.at ?? null,
    checkCount: thesis.checks.length,
    createdAt: thesis.createdAt,
  };
}
