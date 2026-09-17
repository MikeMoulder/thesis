import type { Evaluation } from './breakers/evaluate';
import { PERCENT_METRICS, type BreakerSet, type ThesisBreaker } from './breakers/types';
import type { Decomposition } from './decomposer/types';
import { humaniseMetrics } from '../lib/glossary';

/**
 * What to do now — the closing section of a run.
 *
 * Track 3 asks for a research task that reaches "actionable insight". THESIS
 * deliberately refuses to produce a verdict, so the actionable half cannot be
 * "buy" or "size down"; it is the set of things the analysis says a person must
 * go and settle for themselves. Findings are not actions: "A1 is untestable" is
 * a diagnosis, "nothing here will ever tell you A1 broke, so you have to judge
 * it yourself" is something to do.
 *
 * THIS IS A PURE FUNCTION OVER DATA THE RUN ALREADY PRODUCED. No model call, by
 * design — an LLM asked to write recommendations would produce fluent advice
 * that does not follow from the evidence, which is precisely the failure this
 * product exists to expose. Everything below is derived and therefore checkable.
 */

export type ActionKind =
  /** High-load assumptions nothing can test. The headline finding. */
  | 'unfalsifiable'
  /** Testable, but the generator produced no tripwire. A coverage gap. */
  | 'uncovered'
  /** A tripwire exists but could not be evaluated. */
  | 'blind'
  /** The tripwire sitting closest to its threshold. */
  | 'nearest'
  /** Nothing can change until the next filing. */
  | 'quiet';

export interface NextAction {
  kind: ActionKind;
  /** The thing to do, in one line a stranger could follow. */
  headline: string;
  /** Why — written to be read aloud, not decoded. */
  detail: string;
  /** The concrete items this is about, in the user's own subject matter. */
  bullets?: string[];
  /** Assumption or breaker ids this refers to. */
  refs: string[];
}

/**
 * Distance to the threshold as a fraction of the threshold's own magnitude.
 *
 * Raw headroom is not comparable across metrics — 4.98 points of gross margin
 * and 29.07 points of annualised volatility are not the same kind of gap, and
 * ranking them directly would invent a comparison. Dividing by the threshold at
 * least asks one question of every metric in the same terms: how far is the
 * observation from its own trigger, relative to where that trigger sits.
 *
 * It is a heuristic, and the UI says so rather than presenting the ordering as
 * measured fact. A real answer needs each metric's historical range, which
 * arrives with historical mode.
 */
function relativeProximity(evaluation: Evaluation): number | null {
  if (evaluation.headroom === undefined || evaluation.threshold === undefined) return null;
  const scale = Math.abs(evaluation.threshold);
  if (scale === 0) return null;
  return Math.abs(evaluation.headroom) / scale;
}

function label(breaker: ThesisBreaker): string {
  if (breaker.kind === 'event') return breaker.watchFor;
  const unit = PERCENT_METRICS.has(breaker.metric) ? '%' : '';
  return `${breaker.metric} ${breaker.operator} ${breaker.threshold}${unit}`;
}

/**
 * Model-written statements do not reliably end in a full stop, and these get
 * concatenated with our own sentences. Without this the reader gets
 * "…loss of pricing power It is currently 4.98 points away".
 */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function formatPoints(evaluation: Evaluation, breaker: ThesisBreaker): string {
  if (evaluation.headroom === undefined) return '';
  const magnitude = Math.abs(evaluation.headroom).toFixed(2);
  const unit =
    breaker.kind === 'threshold' && PERCENT_METRICS.has(breaker.metric) ? ' points' : '';
  return `${magnitude}${unit}`;
}

export function deriveActions(
  decomposition: Decomposition,
  breakerSet?: BreakerSet,
  evaluations?: Evaluation[],
): NextAction[] {
  const actions: NextAction[] = [];
  const assumptions = decomposition.assumptions;
  const byId = (id: string) => assumptions.find((a) => a.id === id);

  // 1. High-load assumptions nothing can test. Always first — it is the finding
  //    the rest of the product exists to surface.
  const unfalsifiable = decomposition.summary.unfalsifiableLoadBearing;
  if (unfalsifiable.length > 0) {
    const plural = unfalsifiable.length > 1;
    actions.push({
      kind: 'unfalsifiable',
      /*
        This said "pure faith", which reads as a judgement on the user's
        thinking rather than a statement about our data coverage. The
        assumption may well be correct. What is true is narrower and more
        useful: no number exists anywhere in this desk that could settle it,
        so no alert will ever arrive about it.
      */
      headline: plural
        ? `${unfalsifiable.length} things here cannot be measured. You will never be alerted about them.`
        : 'One thing here cannot be measured. You will never be alerted about it.',
      detail:
        `${plural ? 'These are' : 'This is'} holding the whole trade up, and there is no filing, ` +
        `no price and no data feed in this desk that could tell you if ` +
        `${plural ? 'they stopped' : 'it stopped'} being true. That does not mean ` +
        `${plural ? 'they are' : 'it is'} wrong. It means no tripwire can ever cover ` +
        `${plural ? 'them' : 'it'}, so this is a judgement that stays with you. ` +
        `Before you put money behind this, satisfy yourself about ` +
        `${plural ? 'these' : 'this'} by hand.`,
      bullets: unfalsifiable.map((id) => byId(id)?.statement ?? id),
      refs: unfalsifiable,
    });
  }

  if (breakerSet) {
    // 2. Testable but uncovered — a different problem from untestable, and one
    //    the generator could in principle fix.
    const uncoveredTestable = breakerSet.summary.uncoveredHighLoad.filter(
      (id) => byId(id)?.testability !== 'none',
    );
    if (uncoveredTestable.length > 0) {
      const plural = uncoveredTestable.length > 1;
      actions.push({
        kind: 'uncovered',
        headline: plural
          ? 'These could have been checked, but nothing was built to check them.'
          : 'This could have been checked, but nothing was built to check it.',
        detail:
          `The data for ${plural ? 'these' : 'this'} does exist, so ${plural ? 'they are' : 'it is'} ` +
          'not hopeless the way the ones above are. Running the analysis again may well produce a ' +
          `tripwire. Until it does, you are just as much in the dark about ` +
          `${plural ? 'them' : 'it'} as if nothing could measure ${plural ? 'them' : 'it'} at all.`,
        bullets: uncoveredTestable.map((id) => byId(id)?.statement ?? id),
        refs: uncoveredTestable,
      });
    }

    // 3. Tripwires that exist but could not be read.
    const blind = (evaluations ?? []).filter((e) => e.status === 'undeterminable');
    if (blind.length > 0) {
      actions.push({
        kind: 'blind',
        headline:
          blind.length > 1
            ? 'Some tripwires could not be read. Treat them as unknown, not as fine.'
            : 'One tripwire could not be read. Treat it as unknown, not as fine.',
        detail:
          `${humaniseMetrics(blind[0]?.reason ?? 'No data source is wired for this one.')} ` +
          'An unread tripwire is not a quiet one. You simply do not know either way, ' +
          'and you would have to check this by hand.',
        refs: blind.map((b) => b.breakerId),
      });
    }

    // 4. The tripwire closest to firing.
    const holding = (evaluations ?? [])
      .filter((e) => e.status === 'holding')
      .map((e) => ({ evaluation: e, proximity: relativeProximity(e) }))
      .filter((row): row is { evaluation: Evaluation; proximity: number } => row.proximity !== null)
      .sort((a, b) => a.proximity - b.proximity);

    const closest = holding[0];
    const closestBreaker = closest
      ? breakerSet.breakers.find((b) => b.id === closest.evaluation.breakerId)
      : undefined;

    if (closest && closestBreaker) {
      const others = holding.length - 1;
      actions.push({
        kind: 'nearest',
        headline: `If you only keep an eye on one thing, make it this one.`,
        detail:
          `${sentence(closestBreaker.statement)} It is currently ` +
          `${formatPoints(closest.evaluation, closestBreaker)} away from tripping` +
          `${others > 0 ? `, the nearest of the ${holding.length} that can be read` : ''}. ` +
          `${
            closestBreaker.cadence === 'periodic'
              ? 'It cannot move until the company files its next quarterly report, so there is ' +
                'nothing to watch for day to day. Put the filing date in your diary instead.'
              : 'It is based on the live price, so it can move at any moment.'
          }`,
        refs: [closestBreaker.id],
      });
    }

    // 5. Nothing can move until earnings. Only worth saying when tripwires exist.
    if (breakerSet.summary.quietUntilEarnings && breakerSet.breakers.length > 0) {
      actions.push({
        kind: 'quiet',
        headline: 'Nothing here can change until the next earnings report.',
        detail:
          'Every tripwire depends on numbers that only appear in a quarterly filing. However ' +
          'far the price moves between now and then, none of this gets retested, so there is ' +
          'no point checking back daily.',
        refs: breakerSet.breakers.map((b) => b.id),
      });
    }
  }

  return actions;
}
