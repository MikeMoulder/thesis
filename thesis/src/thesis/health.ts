import type { Evaluation } from '../engine/breakers/evaluate';
import type { Metric, ThesisBreaker } from '../engine/breakers/types';
import type { Assumption } from '../engine/decomposer/types';
import {
  worstHealth,
  type AssumptionHealth,
  type Check,
  type Health,
  type HealthBasis,
  type HealthChange,
  type HealthDriver,
} from './types';

/**
 * Health derivation — pure, and therefore testable.
 *
 * Everything the UI shows about whether a thesis still stands is computed here
 * from evaluations plus the previous check. Nothing is generated. A model that
 * DECIDED a thesis was weakening could not be tested, could not be audited, and
 * would be free to change its mind between two identical inputs. A function
 * cannot.
 *
 * The one thing a single snapshot can never tell you is DIRECTION. That is what
 * the previous check is for, and it is the entire reason this product keeps a
 * log rather than re-running the engine each time.
 */

/**
 * How big a move in a metric has to be before it means anything.
 *
 * Ideally measured: one typical move of that metric, taken from its own
 * history. Where we have no measurement we fall back to a fraction of the
 * threshold and MARK it as assumed, following the same convention as
 * `severityInherited` — the UI may never present an assumed scale as a
 * measured one.
 */
export type MetricScales = Partial<Record<Metric, number>>;

/** Fallback when a metric has no measured typical move: a tenth of the limit. */
export const ASSUMED_SCALE_FRACTION = 0.1;

/** Ignore headroom wobble below this, in units of scale. Stops float noise. */
const NOISE = 0.02;

/**
 * How far past its line a breaker must clear before a raised flag comes down,
 * in units of scale.
 *
 * ## Why states are sticky here
 *
 * Without this, a metric sitting ON its threshold produces an alert every time
 * it wobbles across. The 90-day backfill made that concrete: TSLA's drawdown
 * hovered either side of -30% through late August and generated SIXTEEN
 * broken/weakening transitions in two weeks — none of them news, all of them
 * competing for the same space as the one transition that was.
 *
 * So entering a worse state happens AT the line, and leaving it requires
 * clearing the line by this much more. Standard alarm deadband, and the honest
 * reading of a value that keeps touching its limit is "this has been sitting on
 * its line for a fortnight", not sixteen separate breaks and recoveries.
 *
 * It only ever delays GOOD news. A breaker that fires is broken immediately and
 * unconditionally — nothing here can suppress or postpone a real break.
 */
export const HYSTERESIS = 0.5;

/**
 * Consecutive checks inside the line that lift a flag on their own, however
 * narrowly the line was cleared.
 *
 * Distance alone is not enough, and the TSLA replay showed why: revenue growth
 * crossed its 25% line the wrong way in April, came back to 25.52% when the Q2
 * filing landed in July, and then held above it for eight weeks. A deadband
 * measured only in distance called that broken the entire time, because 0.52
 * never reached half a typical move. Holding above your own line for two months
 * is a recovery in any language.
 *
 * So a flag comes down on distance OR on persistence. Flapping still cannot
 * satisfy this one, because a breaker that re-fires resets the count to zero —
 * which is exactly the difference between "recovered" and "oscillating".
 *
 * ⚠ This counts CHECKS, not time, so it means three days against the daily
 * backfill and forty-five minutes against the fifteen-minute cron. Both are
 * reasonable readings of "not a blip", but they are not the same interval.
 */
export const RECOVERY_CHECKS = 3;

function scaleFor(
  metric: Metric | undefined,
  threshold: number | undefined,
  scales: MetricScales,
): { scale: number; assumed: boolean } {
  const measured = metric ? scales[metric] : undefined;
  if (measured !== undefined && measured > 0) return { scale: measured, assumed: false };
  const magnitude = Math.abs(threshold ?? 0);
  // A zero threshold is legitimate (e.g. "operating income < 0"), and a zero
  // scale would make every reading look infinitely close to the line. Use one
  // unit of the metric instead, and say it was assumed.
  return { scale: magnitude > 0 ? magnitude * ASSUMED_SCALE_FRACTION : 1, assumed: true };
}

/** Headroom recorded for a breaker at the previous check, if it was readable. */
function previousHeadroomOf(
  previous: Check | null | undefined,
  breakerId: string,
): number | undefined {
  const prior = previous?.evaluations.find((e) => e.breakerId === breakerId);
  if (!prior) return undefined;
  return prior.status === 'holding' || prior.status === 'fired' ? prior.headroom : undefined;
}

/**
 * What this breaker was judged to be at the previous check.
 *
 * Read from the stored basis rather than recomputed, because recomputing would
 * need that check's own predecessor, and its predecessor's, all the way back.
 * The log already holds the answer; `HEALTH_FOR_BASIS` is what it means.
 */
function previousDriverOf(
  previous: Check | null | undefined,
  breakerId: string,
): HealthDriver | undefined {
  if (!previous) return undefined;
  for (const assumption of previous.assumptions) {
    const driver = assumption.drivers.find((d) => d.breakerId === breakerId);
    if (driver) return driver;
  }
  return undefined;
}

/**
 * One breaker's verdict.
 *
 *   fired                            -> broken       always, immediately
 *   was broken, back inside the line
 *     but not clear of it by HYSTERESIS -> broken    ('unrecovered')
 *   holding, close AND closing       -> weakening    (the log earns this one)
 *   holding, close but not closing   -> weakening    (a snapshot can see this)
 *   holding, far but moved a full    -> healthy      shown, not alarmed about
 *     typical move toward the line                   ('approaching')
 *   holding, far and steady          -> healthy
 *   unreadable                       -> uncheckable
 *
 * ## Health is a state; movement is an event
 *
 * A state that changes on every wobble is not a state, and the backfill proved
 * it: every one of NVDA's ten reconstructed transitions was a one-day move out
 * and straight back, fourteen points clear of the line the whole time. Nothing
 * had happened to the thesis.
 *
 * Movement is still recorded — `previousHeadroom` rides along on every driver,
 * and the tripwire row renders "moved 0.4 closer since last check" from it. It
 * simply no longer flips the health. Two signals, two jobs: one says where the
 * belief stands, the other says which way it is going, and collapsing them into
 * one field is what made the feed chatter.
 */
function driverFor(
  breaker: ThesisBreaker,
  evaluation: Evaluation | undefined,
  previous: Check | null | undefined,
  scales: MetricScales,
): { driver: HealthDriver; health: Health } {
  const base = {
    breakerId: breaker.id,
    metric: evaluation?.metric,
    observed: evaluation?.observed,
    threshold: evaluation?.threshold,
    headroom: evaluation?.headroom,
    provenance: evaluation?.provenance,
  };

  if (!evaluation || evaluation.status === 'undeterminable' || evaluation.status === 'unaffected') {
    return { driver: { ...base, basis: 'nodata' }, health: 'uncheckable' };
  }

  if (evaluation.status === 'fired') {
    // Reset: a breaker that re-fires has not been holding, whatever it did
    // before. This is what stops an oscillating metric from ever aging into a
    // recovery it has not earned.
    return { driver: { ...base, basis: 'fired', holdingFor: 0 }, health: 'broken' };
  }

  const headroom = evaluation.headroom;
  if (headroom === undefined) {
    // Holding, but we cannot say by how much. The honest answer is
    // "unreadable", not "healthy" — the latter claims comfort we never measured.
    return { driver: { ...base, basis: 'nodata' }, health: 'uncheckable' };
  }

  const { scale } = scaleFor(evaluation.metric, evaluation.threshold, scales);
  const previousHeadroom = previousHeadroomOf(previous, breaker.id);
  const previousDriver = previousDriverOf(previous, breaker.id);
  const previousBasis = previousDriver?.basis;

  const closed = previousHeadroom === undefined ? 0 : previousHeadroom - headroom;
  const narrowing = closed > scale * NOISE;

  const wasBroken = previousBasis === 'fired' || previousBasis === 'unrecovered';
  const wasWeak = previousBasis === 'narrowing' || previousBasis === 'proximity';
  /** Back outside its line by enough to mean it, not by a rounding error. */
  const cleared = headroom > scale * (1 + HYSTERESIS);
  /** Consecutive checks inside the line, this one included. Firing resets it. */
  const holdingFor = (previousDriver?.holdingFor ?? 0) + 1;
  const held = holdingFor >= RECOVERY_CHECKS;

  let basis: HealthBasis;
  let health: Health;

  if (wasBroken && !cleared && !held) {
    // It fired, and it is still hanging on its line. Calling this a recovery
    // and then breaking again tomorrow is the flapping this rule exists to
    // stop — and a user told "recovered" twice a week stops reading the alerts.
    basis = 'unrecovered';
    health = 'broken';
  } else {
    // Enter a flag at the line; leave it only once clear of the line. Anything
    // already flagged is held to the wider band.
    const near = headroom <= (wasBroken || wasWeak ? scale * (1 + HYSTERESIS) : scale);
    if (near && narrowing) {
      basis = 'narrowing';
      health = 'weakening';
    } else if (near) {
      basis = 'proximity';
      health = 'weakening';
    } else if (closed >= scale) {
      // A full typical move from a long way out. Worth putting on the screen,
      // not worth changing the verdict over — see the note above.
      basis = 'approaching';
      health = 'healthy';
    } else {
      basis = 'stable';
      health = 'healthy';
    }
  }

  return { driver: { ...base, basis, previousHeadroom, holdingFor }, health };
}

export interface DeriveHealthInput {
  assumptions: Assumption[];
  breakers: ThesisBreaker[];
  evaluations: Evaluation[];
  /** The previous check, for direction of travel. Null on the first check. */
  previous?: Check | null;
  /** Measured typical moves per metric. Anything missing is assumed. */
  scales?: MetricScales;
}

/**
 * Health per assumption.
 *
 * An assumption's health is the worst of its READABLE breakers. Unreadable
 * breakers are kept as drivers so the UI can show them, but they do not drag a
 * partially-checked assumption down to `uncheckable` — that verdict is reserved
 * for assumptions nothing at all could test, which is a much stronger and much
 * more useful statement.
 */
export function deriveAssumptionHealth(input: DeriveHealthInput): AssumptionHealth[] {
  const { assumptions, breakers, evaluations, previous = null, scales = {} } = input;
  const hasPrevious = Boolean(previous);

  return assumptions.map((assumption) => {
    const mine = breakers.filter((b) => b.assumptionRef === assumption.id);

    const results = mine.map((breaker) =>
      driverFor(
        breaker,
        evaluations.find((e) => e.breakerId === breaker.id),
        previous,
        scales,
      ),
    );

    const drivers = results.map((r) => r.driver);
    const readable = results.filter((r) => r.health !== 'uncheckable');

    if (readable.length === 0) {
      return {
        assumptionId: assumption.id,
        statement: assumption.statement,
        loadBearing: assumption.loadBearing,
        health: 'uncheckable' as const,
        basis: 'nodata' as const,
        directionUnknown: !hasPrevious,
        drivers,
      };
    }

    const health = worstHealth(readable.map((r) => r.health));
    const decisive = readable.find((r) => r.health === health) ?? readable[0]!;

    return {
      assumptionId: assumption.id,
      statement: assumption.statement,
      loadBearing: assumption.loadBearing,
      health,
      basis: decisive.driver.basis,
      // Only 'proximity' and 'stable' are distance-only judgements. Once a
      // breaker has actually fired, or once we have a prior reading to compare
      // against, direction is no longer a mystery.
      directionUnknown:
        !hasPrevious &&
        (decisive.driver.basis === 'proximity' || decisive.driver.basis === 'stable'),
      drivers,
    };
  });
}

/**
 * Thesis health from its assumptions.
 *
 * Weighted by what the thesis actually rests on. A broken HIGH load-bearing
 * assumption breaks the thesis — that is what "load-bearing" means. A broken
 * medium or low one puts it at risk without felling it, which is exactly the
 * situation the user needs a word for.
 */
export function deriveThesisHealth(assumptions: AssumptionHealth[]): Health {
  if (assumptions.length === 0) return 'uncheckable';

  const broken = assumptions.filter((a) => a.health === 'broken');
  if (broken.some((a) => a.loadBearing === 'high')) return 'broken';
  if (broken.length > 0) return 'weakening';

  if (assumptions.some((a) => a.health === 'weakening' && a.loadBearing !== 'low')) {
    return 'weakening';
  }

  if (assumptions.every((a) => a.health === 'uncheckable')) return 'uncheckable';
  return 'healthy';
}

/**
 * What moved since last time. This is the news, and the only thing worth
 * pushing a notification about.
 *
 * Reported in both directions: an assumption recovering is as much a fact as
 * one failing, and a system that only ever reported bad news would be a fear
 * machine rather than an instrument.
 */
export function diffChecks(
  previous: AssumptionHealth[] | null | undefined,
  current: AssumptionHealth[],
): HealthChange[] {
  if (!previous || previous.length === 0) return [];

  const before = new Map(previous.map((a) => [a.assumptionId, a]));
  const changes: HealthChange[] = [];

  for (const now of current) {
    const then = before.get(now.assumptionId);
    if (!then || then.health === now.health) continue;

    const decisive = now.drivers.find((d) => d.basis === now.basis) ?? now.drivers[0];
    changes.push({
      assumptionId: now.assumptionId,
      statement: now.statement,
      from: then.health,
      to: now.health,
      breakerId: decisive?.breakerId,
      metric: decisive?.metric,
      observed: decisive?.observed,
      threshold: decisive?.threshold,
      provenance: decisive?.provenance,
    });
  }

  // Worst news first — a break outranks a recovery.
  return changes.sort((a, b) => severityOf(b) - severityOf(a));
}

function severityOf(change: HealthChange): number {
  const rank: Record<Health, number> = { healthy: 0, uncheckable: 1, weakening: 2, broken: 3 };
  return rank[change.to] - rank[change.from];
}
