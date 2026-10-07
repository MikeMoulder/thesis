import type { AssumptionHealth } from '../thesis/types';
import type { Evaluation } from './breakers/evaluate';
import type { BreakerSet, ThesisBreaker } from './breakers/types';
import type { Assumption, Decomposition } from './decomposer/types';

/**
 * Every belief a thesis rests on, with one verdict each, in reading order.
 *
 * Pure, so the server-rendered thesis page and the client-rendered desk build
 * the list the same way. The vocabulary matches the thesis list on the front
 * page: broken, at risk, can't check, holding.
 */

export type BeliefStatus = 'broken' | 'at-risk' | 'unknown' | 'holding' | 'pending';

/** Worst first. A crossed line outranks "we could not look", which outranks "fine". */
const STATUS_RANK: Record<BeliefStatus, number> = {
  broken: 0,
  'at-risk': 1,
  unknown: 2,
  holding: 3,
  pending: 4,
};

const LOAD_RANK: Record<Assumption['loadBearing'], number> = { high: 0, medium: 1, low: 2 };

const HEALTH_STATUS: Record<AssumptionHealth['health'], BeliefStatus> = {
  broken: 'broken',
  weakening: 'at-risk',
  uncheckable: 'unknown',
  healthy: 'holding',
};

export interface Belief {
  assumption: Assumption;
  /** Position in the model's original order, 1-based. Other screens refer to it. */
  number: number;
  status: BeliefStatus;
  breakers: ThesisBreaker[];
  health?: AssumptionHealth | undefined;
  /**
   * How near its closest line this belief is, as a share of the threshold:
   * 0.03 is three percent away. Lower is nearer. Absent when nothing was read.
   */
  closeness?: number | undefined;
}

/**
 * Every belief with its verdict, in reading order.
 *
 * A stored thesis has a health verdict per assumption and uses it, because
 * health knows about history (a line crossed recently and not yet cleared is
 * still broken). A fresh run has only this moment's evaluations, so the status
 * is read straight off them.
 */
export function deriveBeliefs({
  decomposition,
  breakerSet,
  evaluations,
  health,
  breakersPending = false,
}: {
  decomposition: Decomposition;
  breakerSet?: BreakerSet | undefined;
  evaluations?: Evaluation[] | undefined;
  health?: AssumptionHealth[] | undefined;
  breakersPending?: boolean;
}): Belief[] {
  const breakers = breakerSet?.breakers ?? [];

  const beliefs = decomposition.assumptions.map((assumption, i): Belief => {
    const covering = breakers.filter((b) => b.assumptionRef === assumption.id);
    const verdict = health?.find((h) => h.assumptionId === assumption.id);
    const closeness = nearest(covering, evaluations);
    return {
      assumption,
      number: i + 1,
      breakers: covering,
      health: verdict,
      ...(closeness === undefined ? {} : { closeness }),
      status: verdict
        ? HEALTH_STATUS[verdict.health]
        : statusFromEvaluations(assumption, covering, evaluations, breakersPending),
    };
  });

  // Sorting mid-run would reshuffle the list under the reader's eyes each time
  // a reading lands: an untestable belief is known at once and would jump to
  // the top, then get overtaken. Hold the model's order until every belief
  // has a verdict, then sort once.
  if (beliefs.some((b) => b.status === 'pending')) return beliefs;

  return [...beliefs].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      // Within a verdict, the one nearest its line first. Two beliefs both
      // "holding" are not equally safe when one is 3% from breaking.
      (a.closeness ?? Infinity) - (b.closeness ?? Infinity) ||
      LOAD_RANK[a.assumption.loadBearing] - LOAD_RANK[b.assumption.loadBearing] ||
      a.number - b.number,
  );
}

/**
 * The same yardstick "what to do now" ranks by: distance to the line as a
 * share of the line itself, so margin points and dollars of depth compare.
 */
function nearest(
  covering: ThesisBreaker[],
  evaluations: Evaluation[] | undefined,
): number | undefined {
  const shares = covering
    .map((b) => evaluations?.find((e) => e.breakerId === b.id))
    .filter((e): e is Evaluation => e?.headroom !== undefined && e.threshold !== undefined)
    .map((e) => Math.abs(e.headroom!) / Math.max(1, Math.abs(e.threshold!)));
  return shares.length > 0 ? Math.min(...shares) : undefined;
}

function statusFromEvaluations(
  assumption: Assumption,
  covering: ThesisBreaker[],
  evaluations: Evaluation[] | undefined,
  breakersPending: boolean,
): BeliefStatus {
  if (assumption.testability === 'none') return 'unknown';
  if (covering.length === 0) return breakersPending ? 'pending' : 'unknown';

  const readings = covering
    .map((b) => evaluations?.find((e) => e.breakerId === b.id))
    .filter((e): e is Evaluation => Boolean(e));
  if (readings.length === 0) return 'pending';
  if (readings.some((e) => e.status === 'fired')) return 'broken';
  if (readings.every((e) => e.status === 'undeterminable')) return 'unknown';
  return 'holding';
}

