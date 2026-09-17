import Link from 'next/link';

import { formatRelative, isStale } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ThesisSummary } from '@/thesis/types';

import { TickerMark } from './TickerMark';
import { HEALTH_DOT, HEALTH_TEXT, HEALTH_WORD } from './health-text';

/**
 * The beliefs you are already on the hook for.
 *
 * This is the front door, and it is deliberately NOT a watchlist. A watchlist
 * says "this app shows you prices", which is what every competitor says, and it
 * invites the user to start from a TICKER. What stands here instead is the list
 * of things they have claimed and can be held to.
 *
 * So every card LEADS WITH THE STATEMENT. A row that leads with "NVDA" is a
 * watchlist row wearing a different hat; a row that leads with what you claimed
 * is a promise you made. The ticker is still there, in the corner, where an
 * identifier belongs.
 */

/** Counts worth printing. Zeroes are omitted, not shown as "0 broken". */
function tally(summary: ThesisSummary): string[] {
  const parts: string[] = [];
  if (summary.broken > 0) parts.push(`${summary.broken} broken`);
  if (summary.weakening > 0) parts.push(`${summary.weakening} at risk`);
  if (summary.uncheckable > 0) parts.push(`${summary.uncheckable} cannot be checked`);
  return parts;
}

function ThesisCard({ summary, now }: { summary: ThesisSummary; now: number }) {
  const stale = isStale(summary.lastCheckedAt, now);
  const counts = tally(summary);

  return (
    <Link
      href={`/thesis/${summary.id}`}
      className={cn(
        'group block border-b border-line/60 py-5 transition-colors last:border-b-0',
        'hover:bg-surface/40 focus-visible:bg-surface/40 focus-visible:outline-none',
        '-mx-3 px-3 rounded-[8px]',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span
          aria-hidden
          className={cn(
            'relative top-[-1px] size-[7px] shrink-0 rounded-full',
            HEALTH_DOT[summary.health],
          )}
        />
        <span className={cn('text-meta uppercase tracking-[0.14em]', HEALTH_TEXT[summary.health])}>
          {HEALTH_WORD[summary.health]}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <TickerMark ticker={summary.ticker} size="row" />
          <span data-figure className="text-sm text-faint">
            {summary.ticker}
          </span>
        </span>
      </div>

      {/*
        Clamped, because this is a LIST and a list exists to be scanned. A
        well-written thesis runs to a paragraph, and three of them at full
        length is a page of prose with no shape. The whole statement is on the
        thesis's own screen, one click away, which is where reading belongs.
      */}
      <p className="mt-2 line-clamp-3 max-w-prose text-base leading-snug text-text">
        {summary.statement}
      </p>

      <p className="mt-2.5 flex flex-wrap items-baseline gap-x-2 text-meta text-faint">
        <span data-figure>v{summary.version}</span>
        {counts.length > 0 ? (
          <>
            <span aria-hidden>·</span>
            <span>{counts.join(' · ')}</span>
          </>
        ) : null}
        <span aria-hidden>·</span>
        <span data-figure>{summary.checkCount}</span>
        <span>checks</span>
        <span aria-hidden>·</span>
        {/*
          The number that carries the whole 24/7 claim. When it goes stale it
          says so in amber rather than being quietly styled away: a last checked
          time that has stopped moving is the one failure this product cannot
          hide, and hiding it would discredit every other number on the page.
        */}
        {summary.lastCheckedAt ? (
          <span className={cn(stale && 'text-trust')}>
            {stale ? 'stale · ' : ''}
            checked {formatRelative(summary.lastCheckedAt, now)}
          </span>
        ) : (
          <span className="text-trust">never checked</span>
        )}
      </p>
    </Link>
  );
}

export function MyTheses({
  theses,
  now,
  className,
}: {
  theses: ThesisSummary[];
  /**
   * Taken on the server and passed down, so the relative times in the markup
   * match the ones the browser renders. Two independent clock reads across a
   * minute boundary produce two different strings and a hydration mismatch.
   */
  now: number;
  className?: string;
}) {
  if (theses.length === 0) return null;

  // Worst first. A page that sorts by date buries the thing that needs
  // attention under whatever happened to be created most recently.
  const order = { broken: 0, weakening: 1, uncheckable: 2, healthy: 3 } as const;
  const sorted = [...theses].sort((a, b) => {
    const byHealth = order[a.health] - order[b.health];
    return byHealth !== 0 ? byHealth : b.createdAt.localeCompare(a.createdAt);
  });

  return (
    <section className={cn('w-full', className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-strong pb-3">
        <span className="text-meta uppercase tracking-[0.14em] text-muted">Under observation</span>
        <span data-figure className="text-sm text-faint">
          {theses.length}
        </span>
      </div>

      <div className="mt-1">
        {sorted.map((summary) => (
          <ThesisCard key={summary.id} summary={summary} now={now} />
        ))}
      </div>

      <p className="mt-5 max-w-prose text-base text-muted">
        Each of these is re-checked against live filings and prices every fifteen minutes, whether
        or not anyone is looking. Open one to see what its tripwires are doing.
      </p>
    </section>
  );
}
