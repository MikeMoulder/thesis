'use client';

import { Define } from '@/components/prose/Define';
import { CountUp, Reveal } from '@/components/prose/Reveal';
import { HeadroomBar } from '@/components/thesis/HeadroomBar';
import { PlainCondition } from '@/components/thesis/PlainCondition';
import { formatValue, type Evaluation, type EvalStatus } from '@/engine/breakers/evaluate';
import { PERCENT_METRICS, type Metric, type ThesisBreaker } from '@/engine/breakers/types';
import { CitationChip } from '@/components/evidence/CitationChip';
import { defineConcept } from '@/lib/glossary';
import { cn } from '@/lib/utils';
import { HEALTH_FOR_BASIS, type HealthDriver } from '@/thesis/types';

import { breakerCondition } from './breaker-text';

/**
 * One tripwire and where it stands.
 *
 * Rewritten to be readable by somebody who has never traded. The order is the
 * argument: what would have to happen, in a sentence — then where things stand
 * now, in a picture — then what that means, in plain words — and only then the
 * exact machine condition and its provenance, for the reader who wants it.
 *
 * The earlier version led with `grossMargin < 70%`, which is precise and tells
 * a newcomer nothing at all.
 */

const STATUS_WORD: Record<EvalStatus, string> = {
  fired: 'This has happened',
  holding: 'Not happened',
  undeterminable: 'Cannot tell',
  unaffected: 'Not part of this scenario',
};

const STATUS_TONE: Record<EvalStatus, string> = {
  fired: 'text-fired',
  holding: 'text-muted',
  undeterminable: 'text-trust',
  unaffected: 'text-faint',
};

const DOT_TONE: Record<EvalStatus, string> = {
  fired: 'bg-fired',
  holding: 'bg-line-strong',
  undeterminable: 'bg-trust',
  unaffected: 'bg-line',
};

/**
 * Where the health verdict and the raw status part company.
 *
 * The headline above comes from the EVALUATION, which answers "is this
 * condition true right now?". Health answers a different question — "should
 * the user still believe this?" — and the two disagree in exactly one place:
 * `unrecovered`, where the condition is false but the break has not been
 * cleared by enough to call it over. See HYSTERESIS in thesis/health.ts.
 *
 * Where they disagree, HEALTH wins the headline. A row reading "Not happened"
 * in muted grey, on a thesis the same screen marks broken, is the product
 * contradicting itself — and the reader will believe the quiet grey one.
 */
const UNRECOVERED_WORD = 'Happened recently';

/**
 * What the reading means, in a sentence. Derived in code, never generated — a
 * model writing this would eventually write something the numbers do not say.
 */
function meaning(breaker: ThesisBreaker, evaluation: Evaluation): string | null {
  if (breaker.kind !== 'threshold') return null;
  if (evaluation.observed === undefined || evaluation.headroom === undefined) return null;

  /*
    Format through the metric's own formatter. A raw toFixed(2) printed
    "63734000000.00" for an operating-income tripwire, which is not a number
    anybody reads — formatValue gives "63.73B", and appends "%" only where the
    metric is a percentage.
  */
  const magnitude = formatValue(breaker.metric, Math.abs(evaluation.headroom));
  const gap = PERCENT_METRICS.has(breaker.metric)
    ? `${magnitude.replace(/%$/, '')} points`
    : magnitude;
  const cadence =
    breaker.cadence === 'periodic'
      ? 'and it can only change when the next quarterly report is filed'
      : 'and it can change at any time';

  if (evaluation.status === 'fired') {
    return `It is already ${gap} past the line, ${cadence}.`;
  }

  // Relative closeness, using the threshold's own magnitude as the yardstick —
  // the same basis the "what to do now" ranking uses.
  const closeness = Math.abs(evaluation.headroom) / Math.max(1, Math.abs(evaluation.threshold ?? 1));
  const distance =
    closeness < 0.1 ? 'very close to it' : closeness < 0.3 ? 'not far from it' : 'a long way from it';

  return `It would have to move ${gap} before this fires, which is ${distance}, ${cadence}.`;
}

export function TripwireRow({
  breaker,
  evaluation,
  trend,
  className,
}: {
  breaker: ThesisBreaker;
  evaluation?: Evaluation | undefined;
  /**
   * The same breaker as it stood at the PREVIOUS check.
   *
   * This is the one thing a snapshot cannot supply, and the one thing that
   * separates this product from a tool that re-runs an analysis on demand.
   * Absent on a first run, where saying anything about direction would be a
   * guess dressed as a reading.
   */
  trend?: HealthDriver | undefined;
  className?: string;
}) {
  const status = evaluation?.status;
  const explain = evaluation ? meaning(breaker, evaluation) : null;
  // Broken by health while holding by status — the one case the row must not
  // take at face value.
  const unrecovered = trend?.basis === 'unrecovered';
  const inherited = defineConcept(breaker.severityInherited ? 'inherited' : 'measured');
  const cadence = defineConcept(breaker.cadence);

  return (
    <div className={cn('border-b border-line/60 py-4 last:border-b-0', className)}>
      {/* 1. what would have to happen */}
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span
          aria-hidden
          className={cn(
            'relative top-[-1px] size-[7px] shrink-0 rounded-full',
            unrecovered ? 'bg-fired' : status ? DOT_TONE[status] : 'bg-line',
          )}
        />
        <span data-figure className="text-sm text-faint">
          {breaker.id}
        </span>
        <PlainCondition breaker={breaker} className="min-w-0 flex-1" />
        <span
          className={cn(
            'text-sm',
            unrecovered ? 'text-fired' : status ? STATUS_TONE[status] : 'text-faint',
          )}
        >
          {unrecovered ? UNRECOVERED_WORD : status ? STATUS_WORD[status] : 'not checked yet'}
        </span>
      </div>

      {/* 2. where it stands, as a picture */}
      {evaluation?.observed !== undefined &&
      evaluation.threshold !== undefined &&
      breaker.kind === 'threshold' ? (
        <div className="mt-3 pl-[18px]">
          <p className="flex flex-wrap items-baseline gap-x-2 text-base">
            <span className="text-muted">Right now it is</span>
            {/*
              Counted up rather than printed. These readings are the point of
              the row, and a figure settling into place pulls the eye where the
              same figure merely being present does not. Large non-percent
              values (revenue in the billions) keep their formatter instead —
              counting through ten digits reads as a glitch, not an arrival.
            */}
            {PERCENT_METRICS.has(breaker.metric) ? (
              <CountUp
                value={evaluation.observed}
                suffix="%"
                className={cn(status === 'fired' ? 'text-fired' : 'text-text')}
              />
            ) : (
              <span data-figure className={cn(status === 'fired' ? 'text-fired' : 'text-text')}>
                {formatValue(breaker.metric, evaluation.observed)}
              </span>
            )}
          </p>
          <HeadroomBar
            className="mt-2"
            metric={breaker.metric}
            observed={evaluation.observed}
            threshold={evaluation.threshold}
            fired={status === 'fired'}
          />
          <Movement metric={breaker.metric} trend={trend} />
        </div>
      ) : null}

      {/* 3. what that means */}
      {explain ? (
        <p className="mt-2.5 max-w-prose pl-[18px] text-base text-muted">
          <Reveal text={explain} step={14} delay={220} />
        </p>
      ) : null}

      {unrecovered ? (
        <p className="mt-2.5 max-w-prose pl-[18px] text-base text-fired/85">
          This fired recently and has come back inside the line — but not far enough to call it
          recovered. It stays broken until it clears the line properly, or holds inside it for
          three checks running.
        </p>
      ) : null}

      {evaluation?.reason ? (
        <p className="mt-2.5 max-w-prose pl-[18px] text-sm text-trust">{evaluation.reason}</p>
      ) : null}

      {/* 4. the exact test and where the number came from */}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1.5 pl-[18px]">
        <span data-figure className="rounded-[4px] bg-code/10 px-[0.36em] py-[0.12em] text-meta text-code">
          {breakerCondition(breaker)}
        </span>
        {evaluation?.provenance ? <CitationChip provenance={evaluation.provenance} /> : null}
        {cadence ? (
          <span className="text-meta uppercase tracking-[0.12em] text-faint">
            <Define definition={cadence} />
          </span>
        ) : null}
        {inherited ? (
          <span className="text-meta uppercase tracking-[0.12em] text-faint">
            {breaker.severity} · <Define definition={inherited} />
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * How far this moved since the last time anyone looked.
 *
 * Deliberately says nothing at all when there is no previous reading. The
 * temptation is to fill the space with "no change", but on a first run there is
 * genuinely no information here, and "no change" would assert stability that
 * was never observed.
 */
function Movement({
  metric,
  trend,
}: {
  metric: Metric;
  trend?: HealthDriver | undefined;
}) {
  if (!trend || trend.previousHeadroom === undefined || trend.headroom === undefined) return null;

  const closed = trend.previousHeadroom - trend.headroom;
  /*
    Sub-noise wobble is not movement, and NOTHING is the right thing to render.

    This printed "Unchanged since the last check." until the thesis screen
    became the first caller to pass a trend at all — and put five identical
    reassurances down a single page. Five of anything teaches a reader to skip
    the line, and this is the one line that will matter on the day something
    does move. The check log at the foot of the page already proves the looking
    happened; this line exists only to report a change.

    Same rule as the activity feed and the no-green badge: speak only when
    there is something to say.
  */
  if (Math.abs(closed) < 0.005) return null;

  const closing = closed > 0;
  /*
    `approaching` is the biggest kind of move there is — a full typical move for
    this metric in a single check — and it is the one the health verdict
    deliberately does NOT react to, because it happened from a long way out.

    Saying so is the whole point of having the basis here. Without the clause
    the row shows a large number moving and a verdict of healthy beside it, and
    a reader is entitled to think one of them is broken. With it, the row says
    what the system actually decided: a big step, still clear of the line.
  */
  const fullMove = trend.basis === 'approaching';

  /*
    A closing move normally takes the alarm tint. It must not when the verdict
    is HEALTHY — which is exactly the `approaching` case, and the row lower down
    says "nothing has changed" in so many words. A red sentence saying nothing
    has changed is the screen arguing with itself, and it breaks the standing
    rule that holding takes no colour: colour every routine move and the reader
    stops seeing the one that is not routine.
  */
  const alarming = closing && HEALTH_FOR_BASIS[trend.basis] !== 'healthy';

  return (
    <p className={cn('mt-2 text-sm', alarming ? 'text-fired/85' : 'text-muted')}>
      {closing ? 'Moved' : 'Backed off'}{' '}
      <span data-figure>{formatValue(metric, Math.abs(closed))}</span>{' '}
      {closing ? 'closer to this line' : 'away from this line'} since the last check.
      {fullMove ? ' A full typical move — but it is still clear of the line, so nothing has changed.' : ''}
    </p>
  );
}
