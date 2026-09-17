import type { Brief, BriefReading } from '@/engine/brief';
import { cn } from '@/lib/utils';

/**
 * The closing brief: what the research established, in the order a reader wants it.
 *
 * The section this replaces opened with what could not be measured and closed
 * with what could not be read. Everything in it was a caveat, so a reader who
 * had just watched a full analysis run was handed a list of our failures and no
 * statement of what the work had found. There was nothing to take away.
 *
 * The order here is the argument: what you are betting on, what that rests on,
 * THE NUMBERS AS THEY STAND, the single thing most worth watching, and only then
 * what nobody can settle and what could not be read. Caveats last, because they
 * are caveats.
 *
 * The readings table is the part that matters. "Gross margin is 74.98% and
 * breaks this thesis below 70%, which is 4.98 points of room, and it cannot move
 * until the next filing" is a fact a person can carry around and act on. It is
 * the difference between a summary and a conclusion.
 */

const STATUS_WORD: Record<BriefReading['status'], string> = {
  fired: 'crossed',
  unreadable: 'could not read',
  holding: 'holding',
};

const STATUS_TONE: Record<BriefReading['status'], string> = {
  fired: 'text-fired',
  unreadable: 'text-trust',
  holding: 'text-muted',
};

function Part({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('border-t border-line/60 pt-4', className)}>
      <p className="text-meta uppercase tracking-[0.14em] text-faint">{title}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/**
 * One tripwire, as a row of facts.
 *
 * Deliberately NOT a table element. At phone width a four column table either
 * scrolls sideways or crushes every column, and the reading is the thing most
 * worth getting right on a small screen. Each row is a block that reflows.
 */
function Reading({ reading }: { reading: BriefReading }) {
  return (
    <li className="border-b border-line/40 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-base text-text">{reading.label}</span>
        <span className={cn('text-meta uppercase tracking-[0.12em]', STATUS_TONE[reading.status])}>
          {STATUS_WORD[reading.status]}
        </span>
      </div>

      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-base text-muted">
        {reading.now ? (
          <>
            <span>now</span>
            <span data-figure className={cn(reading.status === 'fired' ? 'text-fired' : 'text-text')}>
              {reading.now}
            </span>
          </>
        ) : null}
        {reading.breaksAt ? (
          <>
            <span>{reading.now ? '·' : ''}</span>
            <span>breaks at</span>
            <span data-figure className="text-text">
              {reading.breaksAt}
            </span>
          </>
        ) : null}
        {reading.room ? (
          <>
            <span aria-hidden>·</span>
            <span data-figure className="text-text">
              {reading.room}
            </span>
            <span>of room</span>
          </>
        ) : null}
      </p>

      <p className="mt-0.5 text-sm text-faint">moves {reading.movesWhen}</p>
      {reading.reason ? <p className="mt-1 max-w-prose text-sm text-trust">{reading.reason}</p> : null}
    </li>
  );
}

export function ResearchBrief({ brief, className }: { brief: Brief; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {/* The finding, before any of the working. */}
      <p className="max-w-prose text-lg leading-snug text-text">{brief.standing}</p>

      {brief.bet.length > 0 ? (
        <Part title="What you are betting on">
          <ul className="flex flex-col gap-1.5">
            {brief.bet.map((line) => (
              <li key={line} className="max-w-prose text-base leading-snug text-text">
                {line}
              </li>
            ))}
          </ul>
        </Part>
      ) : null}

      <Part title="What it rests on">
        <ul className="flex flex-col gap-1.5">
          {brief.foundation.map((line) => (
            <li key={line} className="max-w-prose text-base leading-snug text-muted">
              {line}
            </li>
          ))}
        </ul>
      </Part>

      {brief.readings.length > 0 ? (
        <Part title="Where the numbers stand">
          <ul className="flex flex-col">
            {brief.readings.map((reading) => (
              <Reading key={`${reading.label}-${reading.condition}`} reading={reading} />
            ))}
          </ul>
        </Part>
      ) : null}

      {brief.focus ? (
        <Part title="If you watch one thing">
          <p className="max-w-prose text-base leading-snug text-text">{brief.focus.line}</p>
          <p className="mt-1 max-w-prose text-base leading-relaxed text-muted">
            {brief.focus.detail}
          </p>
        </Part>
      ) : null}

      {brief.judgement.length > 0 ? (
        <Part title="What only you can settle">
          <ul className="flex flex-col gap-2">
            {brief.judgement.map((line) => (
              <li key={line} className="max-w-prose text-base leading-snug text-trust">
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-2 max-w-prose text-base text-trust/80">
            No filing, price or data feed here can settle{' '}
            {brief.judgement.length === 1 ? 'this' : 'these'}, so no tripwire will ever cover{' '}
            {brief.judgement.length === 1 ? 'it' : 'them'}. That judgement stays with you.
          </p>
        </Part>
      ) : null}

      {brief.limits.length > 0 ? (
        <Part title="What this analysis could not do">
          <ul className="flex flex-col gap-2">
            {brief.limits.map((line) => (
              <li key={line} className="max-w-prose text-base leading-snug text-muted">
                {line}
              </li>
            ))}
          </ul>
        </Part>
      ) : null}
    </div>
  );
}
