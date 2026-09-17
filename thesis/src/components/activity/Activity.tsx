import Link from 'next/link';

import { CitationChip } from '@/components/evidence/CitationChip';
import { HEALTH_DOT, HEALTH_TEXT, HEALTH_WORD } from '@/components/thesis/health-text';
import { TickerMark } from '@/components/thesis/TickerMark';
import { formatValue } from '@/engine/breakers/evaluate';
import { formatRelative, formatStamp } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ActivityEntry, ActivitySummary } from '@/thesis/activity';

/**
 * Everything that has actually changed, across every thesis, newest first.
 *
 * This screen deliberately does NOT list routine checks. The loop runs four
 * times an hour and nearly always finds everything exactly as it was, which is
 * reassuring and is not news. A feed showing every check would bury the handful
 * of entries that matter under several hundred that do not, and a reader who
 * learns to scroll past this screen will scroll past it on the day it finally
 * says something.
 *
 * Nothing is computed here. Every entry is a `HealthChange` that `appendCheck`
 * already recorded, complete with the number that caused it and where that
 * number came from. Keeping a separate activity table would be a second copy of
 * the truth, and the moment the two disagreed there would be no way to tell
 * which one was lying.
 */

function Entry({ entry, now }: { entry: ActivityEntry; now: number }) {
  const reconstructed = entry.source === 'backfill';

  return (
    <li className="border-b border-line/60 py-5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span aria-hidden className={cn('size-[7px] shrink-0 rounded-full', HEALTH_DOT[entry.to])} />
        <TickerMark ticker={entry.ticker} size="row" />
        <Link
          href={`/thesis/${entry.thesisId}`}
          data-figure
          className="text-sm text-text transition-colors hover:text-muted"
        >
          {entry.ticker}
        </Link>

        <span className={cn('text-meta uppercase tracking-[0.12em]', HEALTH_TEXT[entry.from])}>
          {HEALTH_WORD[entry.from]}
        </span>
        <span aria-hidden className="text-faint">
          →
        </span>
        <span className={cn('text-meta uppercase tracking-[0.12em]', HEALTH_TEXT[entry.to])}>
          {HEALTH_WORD[entry.to]}
        </span>

        <span className="ml-auto text-meta text-faint">{formatRelative(entry.at, now)}</span>
      </div>

      <p className="mt-2 max-w-prose text-base leading-snug text-text">{entry.statement}</p>

      {entry.metric && entry.observed !== undefined && entry.threshold !== undefined ? (
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-base text-muted">
          <span data-figure className={cn(entry.to === 'broken' ? 'text-fired' : 'text-text')}>
            {formatValue(entry.metric, entry.observed)}
          </span>
          <span>against a line at</span>
          <span data-figure className="text-text">
            {formatValue(entry.metric, entry.threshold)}
          </span>
          {entry.provenance ? <CitationChip provenance={entry.provenance} /> : null}
        </p>
      ) : null}

      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-meta text-faint">
        <span data-figure>{formatStamp(entry.at)}</span>
        <span aria-hidden>·</span>
        {/*
          Said on every reconstructed row, not once at the top. A reader lands
          mid-feed from a link and sees one entry; the label has to travel with
          the row it describes.
        */}
        <span className={cn(reconstructed && 'text-trust')}>
          {reconstructed ? 'reconstructed, not a warning you were given' : 'observed live'}
        </span>
      </p>
    </li>
  );
}

export function Activity({
  entries,
  summary,
  now,
}: {
  entries: ActivityEntry[];
  summary: ActivitySummary;
  now: number;
}) {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <Link
        href="/"
        className="text-meta uppercase tracking-[0.14em] text-faint transition-colors hover:text-muted"
      >
        ← The desk
      </Link>

      <header className="mt-6 border-b border-line-strong pb-5">
        <h1 className="text-[1.75rem] font-normal leading-[1.2] tracking-[-0.02em] text-text">
          Everything that has moved.
        </h1>
        <p className="mt-2.5 max-w-prose text-base text-muted">
          Only the moments a belief changed state. The loop checks every fifteen minutes and almost
          always finds things exactly as they were, and a feed that said so four times an hour would
          bury the entries that matter.
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="mt-8 max-w-prose text-base text-muted">
          Nothing has changed state yet. That is not the same as nothing being watched: the loop is
          running, and this page fills the moment a tripwire moves.
        </p>
      ) : (
        <>
          <p className="mt-5 flex flex-wrap items-baseline gap-x-2 text-meta text-faint">
            <span data-figure>{summary.total}</span>
            <span>{summary.total === 1 ? 'change' : 'changes'}</span>
            <span aria-hidden>·</span>
            <span data-figure>{summary.observed}</span>
            <span>observed</span>
            {summary.reconstructed > 0 ? (
              <>
                <span aria-hidden>·</span>
                <span data-figure>{summary.reconstructed}</span>
                <span>reconstructed</span>
              </>
            ) : null}
          </p>

          <ol className="mt-2 flex list-none flex-col">
            {entries.map((entry) => (
              <Entry key={`${entry.thesisId}-${entry.at}-${entry.statement}`} entry={entry} now={now} />
            ))}
          </ol>
        </>
      )}

      <p className="mt-10 border-t border-line pt-3 text-meta text-faint">
        Research, not advice. You decide.
      </p>
    </main>
  );
}
