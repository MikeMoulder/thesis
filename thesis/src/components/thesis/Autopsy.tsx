import { formatValue } from '@/engine/breakers/evaluate';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { AssumptionAutopsy, Autopsy as AutopsyData, Outcome } from '@/thesis/autopsy';

/**
 * What survived, what failed, and whether you could have known earlier.
 *
 * This is the only screen in the product that could not exist without the log.
 * Everything else works from a snapshot. The question it answers is the one a
 * person actually has after a trade goes wrong, and answering it honestly
 * requires having written down what things looked like BEFORE anyone knew the
 * answer.
 *
 * The gap between the first warning and the break is the headline, because that
 * number IS the product's claim, stated as a measurement rather than a promise.
 */

const OUTCOME_WORD: Record<Outcome, string> = {
  held: 'held',
  weakened: 'weakened',
  broke: 'broke',
  recovered: 'broke, then recovered',
  'never readable': 'never readable',
};

const OUTCOME_TONE: Record<Outcome, string> = {
  held: 'text-muted',
  weakened: 'text-fired/55',
  broke: 'text-fired',
  recovered: 'text-fired/55',
  'never readable': 'text-trust',
};

function Row({ row }: { row: AssumptionAutopsy }) {
  return (
    <li className="border-b border-line/40 py-3.5 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className={cn('text-meta uppercase tracking-[0.12em]', OUTCOME_TONE[row.outcome])}>
          {OUTCOME_WORD[row.outcome]}
        </span>
        {row.loadBearing === 'high' ? (
          <span className="text-meta uppercase tracking-[0.12em] text-faint">
            the whole trade rested on this
          </span>
        ) : null}
      </div>

      <p className="mt-1 max-w-prose text-base leading-snug text-text">{row.statement}</p>

      {row.firstBreakAt ? (
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-base text-muted">
          <span>broke</span>
          <span data-figure className="text-text">
            {formatDate(row.firstBreakAt)}
          </span>
          {row.metric && row.observed !== undefined && row.threshold !== undefined ? (
            <>
              <span aria-hidden>·</span>
              <span data-figure className="text-fired">
                {formatValue(row.metric, row.observed)}
              </span>
              <span>against</span>
              <span data-figure className="text-text">
                {formatValue(row.metric, row.threshold)}
              </span>
            </>
          ) : null}
        </p>
      ) : null}

      {/*
        Zero days is printed, not hidden. "The warning and the break arrived
        together" is the most useful thing this page can say about a tripwire
        that gave no notice, and silence would read as though it had.
      */}
      {row.warningDays !== undefined && row.firstWarningAt ? (
        <p className="mt-1 text-base text-muted">
          {row.warningDays === 0 ? (
            <>No warning first. It weakened and broke in the same check.</>
          ) : (
            <>
              First warning{' '}
              <span data-figure className="text-text">
                {formatDate(row.firstWarningAt)}
              </span>
              , which is{' '}
              <span data-figure className="text-text">
                {row.warningDays}
              </span>{' '}
              {row.warningDays === 1 ? 'day' : 'days'} of notice.
            </>
          )}
        </p>
      ) : null}

      {row.outcome === 'never readable' ? (
        <p className="mt-1 max-w-prose text-base text-trust">
          Nothing here could ever read this one, so it did not survive the period. It was never
          under observation.
        </p>
      ) : null}
    </li>
  );
}

export function Autopsy({ autopsy, className }: { autopsy: AutopsyData; className?: string }) {
  const { earliestWarning } = autopsy;

  return (
    <div className={cn('flex flex-col gap-5', className)}>
      {earliestWarning ? (
        <div>
          <p className="max-w-prose text-lg leading-snug text-text">
            The first warning came{' '}
            <span data-figure className="text-fired">
              {earliestWarning.days}
            </span>{' '}
            {earliestWarning.days === 1 ? 'day' : 'days'} before anything broke.
          </p>
          {/*
            The statement is the user's own sentence and usually ends in a full
            stop, so running our clause straight onto it printed
            "...above 50%. weakened on 23 Jun". Quote it and start a new
            sentence instead of trying to graft one onto theirs.
          */}
          <p className="mt-1.5 max-w-prose text-base text-muted">
            &ldquo;{earliestWarning.statement.replace(/[.\s]+$/, '')}&rdquo; weakened on{' '}
            <span data-figure>{formatDate(earliestWarning.warnedAt)}</span> and broke on{' '}
            <span data-figure>{formatDate(earliestWarning.brokeAt)}</span>.
          </p>
        </div>
      ) : (
        <p className="max-w-prose text-lg leading-snug text-text">
          Nothing has broken yet.{' '}
          <span className="text-muted">
            That is not the same as nothing being at risk, and it says nothing at all about the
            parts no tripwire covers.
          </span>
        </p>
      )}

      <p className="flex flex-wrap items-baseline gap-x-2 text-meta text-faint">
        <span data-figure>{autopsy.checks}</span>
        <span>checks</span>
        {autopsy.from && autopsy.to ? (
          <>
            <span aria-hidden>·</span>
            <span data-figure>{formatDate(autopsy.from)}</span>
            <span>to</span>
            <span data-figure>{formatDate(autopsy.to)}</span>
          </>
        ) : null}
        {autopsy.reconstructed > 0 ? (
          <>
            <span aria-hidden>·</span>
            <span className="text-trust">
              <span data-figure>{autopsy.reconstructed}</span> reconstructed
            </span>
          </>
        ) : null}
      </p>

      <ul className="flex list-none flex-col border-t border-line/60 pt-1">
        {autopsy.assumptions.map((row) => (
          <Row key={row.assumptionId} row={row} />
        ))}
      </ul>
    </div>
  );
}
