'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { TickerMark } from '@/components/thesis/TickerMark';
import { HEALTH_TEXT, HEALTH_WORD } from '@/components/thesis/health-text';
import { cn } from '@/lib/utils';
import type { ThesisSummary } from '@/thesis/types';

import type { SessionSummary } from './Sidebar';

/**
 * Search across every thesis a person can reach from the sidebar.
 *
 * Two kinds, because there are two places a thesis lives: the ones under
 * observation, stored on the server and re-checked every fifteen minutes,
 * and the runs on this desk, kept in this browser. A person searching for
 * "NVDA" means both, and should not have to know which is which.
 *
 * The watched list is fetched the first time search opens, not with the
 * sidebar: most page loads never search.
 *
 * Every word typed has to appear somewhere in the ticker or the sentence, so
 * "nvda margin" narrows rather than widens.
 */

function matches(query: string, ...fields: string[]): boolean {
  const haystack = fields.join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function Label({ children }: { children: React.ReactNode }) {
  return <h3 className="px-3 pb-1 pt-4 text-sm text-faint">{children}</h3>;
}

/**
 * The watched list, kept for the life of the page. Search opens and closes
 * often, and each reopening used to refetch it and show "Looking…" again.
 */
let watchedCache: ThesisSummary[] | null = null;

const ROW =
  'flex w-full items-start gap-3 rounded-[14px] px-3 py-2 text-left transition-colors hover:bg-raised';

export function ThesisSearch({
  query,
  sessions,
  onSelectSession,
  onDone,
}: {
  query: string;
  sessions: SessionSummary[];
  onSelectSession: (id: string) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [watched, setWatched] = useState<ThesisSummary[] | null>(watchedCache);

  useEffect(() => {
    if (watchedCache) return;
    let live = true;
    fetch('/api/thesis')
      .then((r) => r.json())
      .then((d: { theses?: ThesisSummary[] }) => {
        watchedCache = d.theses ?? [];
        if (live) setWatched(watchedCache);
      })
      .catch(() => live && setWatched([]));
    return () => {
      live = false;
    };
  }, []);

  const watchedHits = (watched ?? []).filter((t) => matches(query, t.ticker, t.statement));
  const sessionHits = sessions.filter((s) => matches(query, s.ticker, s.thesis));
  const nothing = watched !== null && watchedHits.length === 0 && sessionHits.length === 0;

  return (
    <div className="w-[248px] shrink-0" role="region" aria-label="Search results">
      {watched === null ? (
        <p className="px-3 pt-4 text-sm text-faint">Looking…</p>
      ) : null}

      {watchedHits.length > 0 ? (
        <>
          <Label>Under observation</Label>
          {watchedHits.map((t) => (
            <button
              key={t.id}
              type="button"
              className={ROW}
              onClick={() => {
                onDone();
                router.push(`/thesis/${t.id}`);
              }}
            >
              <TickerMark ticker={t.ticker} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span data-figure className="text-sm text-text">
                    {t.ticker}
                  </span>
                  <span
                    className={cn('text-meta uppercase tracking-[0.12em]', HEALTH_TEXT[t.health])}
                  >
                    {HEALTH_WORD[t.health]}
                  </span>
                </span>
                <span className="mt-0.5 line-clamp-2 text-sm leading-snug text-muted">
                  {t.statement}
                </span>
              </span>
            </button>
          ))}
        </>
      ) : null}

      {sessionHits.length > 0 ? (
        <>
          <Label>On this desk</Label>
          {sessionHits.map((s) => (
            <button
              key={s.id}
              type="button"
              className={ROW}
              onClick={() => {
                onDone();
                onSelectSession(s.id);
              }}
            >
              <TickerMark ticker={s.ticker} />
              <span className="min-w-0 flex-1">
                <span data-figure className="text-sm text-text">
                  {s.ticker}
                </span>
                <span className="mt-0.5 line-clamp-2 text-sm leading-snug text-muted">
                  {s.thesis}
                </span>
              </span>
            </button>
          ))}
        </>
      ) : null}

      {nothing ? (
        <p className="px-3 pt-4 text-sm text-faint">
          {query.trim()
            ? `No thesis mentions “${query.trim()}”.`
            : 'No theses yet. Write one in the box on the desk.'}
        </p>
      ) : null}
    </div>
  );
}
