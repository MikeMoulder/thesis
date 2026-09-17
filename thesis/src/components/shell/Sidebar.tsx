'use client';

import { useEffect, useState } from 'react';
import { PanelLeftClose, Plus, Search } from 'lucide-react';

import type { WatchRow } from '@/app/api/watchlist/route';
import { TickerMark } from '@/components/thesis/TickerMark';
import { cn } from '@/lib/utils';

/**
 * The left panel, built on the Orion shell's rhythm.
 *
 * One shape for every row — a pill — so the column reads as a single list
 * whatever a given row does. Groups are separated by quiet sentence-case labels
 * rather than rules: the grouping does the work a divider used to, and a panel
 * without horizontal lines stays calm behind a page that is already dense.
 *
 * It carries NO right border and NO raised background. Orion's panel is the
 * same ground as the page beside it, so the shell reads as one surface with a
 * list ranged down its left edge — a rule there would announce a split the
 * interface does not actually have.
 *
 * Collapsed, it becomes a rail of marks and the logo becomes the way back.
 * Same as Orion: the brand is the only thing in the rail that is not already a
 * destination, so it is the one thing free to mean "open this".
 *
 * Two deliberate departures from Orion:
 *
 *   WORKSPACES → WATCHLIST. Orion's workspaces are saved views. Here the most
 *   useful standing surface is the tokenised US stocks themselves, live — a
 *   watchlist that is visibly moving at 3am makes the 24/7 argument without a
 *   paragraph about it, and every row is one click from a thesis.
 *
 *   NO WALLET. THESIS never places an order, so an account row would advertise
 *   a capability it deliberately does not have. That slot holds data-source
 *   health instead, which is the thing a user actually needs to trust.
 */

export interface SessionSummary {
  id: string;
  ticker: string;
  thesis: string;
  /** High-load assumptions with no tripwire. The number that matters. */
  untested: number;
}

/** How many watchlist rows survive the collapse. Six fills the rail without scrolling it. */
const RAIL_WATCH_LIMIT = 6;

function rowClass(active = false) {
  return cn(
    'flex w-full items-center gap-3 rounded-full px-3 py-2 text-left text-base',
    'transition-colors duration-150',
    active ? 'bg-raised text-text' : 'text-muted hover:bg-raised hover:text-text',
  );
}

/** The rail's equivalent of a pill: a square hit area that rounds on hover. */
function railClass(active = false) {
  return cn(
    'flex size-9 shrink-0 items-center justify-center rounded-full',
    'transition-colors duration-150',
    active ? 'bg-raised text-text' : 'text-muted hover:bg-raised hover:text-text',
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="px-3 pb-1 pt-5 text-sm text-faint">{children}</h3>;
}

/**
 * The mark. Identical in both states, so the collapse reads as one thing moving.
 *
 * It sits directly on the ground with no tile behind it — same as Orion. The
 * artwork is a single flat cream on transparency, so a rounded square under it
 * would only add a second shape competing with the one that is already the
 * logo. Rendered a touch larger than the old monogram because this silhouette
 * carries real negative space and a 24px box swallowed it.
 */
function BrandMark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/mark.png"
      alt=""
      aria-hidden
      width={26}
      height={26}
      className="size-[26px] shrink-0 select-none"
      draggable={false}
    />
  );
}

/**
 * The 24h change, in market colour.
 *
 * This is the one place the "no green" rule does not apply, because this is the
 * tape and not the analysis. Exactly flat stays neutral: 0.00% is not a gain,
 * and painting it green would claim a direction the number does not have.
 */
function Change({ pct }: { pct: number | undefined }) {
  if (pct === undefined) return <span className="text-meta text-faint">—</span>;

  const tone = pct > 0 ? 'text-up' : pct < 0 ? 'text-down' : 'text-muted';
  const title =
    pct > 0 ? 'up over 24 hours' : pct < 0 ? 'down over 24 hours' : 'flat over 24 hours';

  return (
    <span data-num className={cn('text-meta tabular-nums', tone)} title={title}>
      {pct > 0 ? '+' : ''}
      {pct.toFixed(2)}%
    </span>
  );
}

/**
 * Column headings for the watchlist.
 *
 * Shares a line with the section label rather than sitting on its own row: two
 * stacked rows of grey labels above six rows of data is more chrome than the
 * data deserves in a 272px column. The widths mirror `rowClass` exactly, so
 * each heading sits over the column it names.
 */
function WatchHeader() {
  return (
    <div className="flex w-full items-baseline gap-3 px-3 pb-1 pt-5">
      {/* 82px = the row's mark (22) + its gap (12) + its ticker column (48), so
          "Price" lands over the price column instead of near it. */}
      <span className="w-[82px] shrink-0 text-sm text-faint">Watchlist</span>
      <span className="flex-1 text-right text-meta text-faint">Price</span>
      <span className="w-14 shrink-0 text-right text-meta text-faint">24h</span>
    </div>
  );
}

/** Where Orion pins an account row. THESIS has no wallet, so this reports the sources. */
function healthDotClass(sourcesHealthy: boolean | null) {
  return cn(
    'block size-[6px] shrink-0 rounded-full',
    sourcesHealthy === null ? 'bg-line-strong' : sourcesHealthy ? 'bg-muted' : 'bg-fired',
  );
}

function healthLabel(sourcesHealthy: boolean | null) {
  if (sourcesHealthy === null) return 'checking sources…';
  return sourcesHealthy ? 'Bitget · SEC · Yahoo · live' : 'a data source is down';
}

/**
 * The live watchlist.
 *
 * Fetched once and shared by both states, so collapsing and expanding does not
 * re-request prices — the rail and the panel are two renderings of one list,
 * not two lists.
 */
function useWatchlist(): WatchRow[] | null {
  const [watch, setWatch] = useState<WatchRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/watchlist')
      .then((r) => r.json())
      .then((d: { rows?: WatchRow[] }) => {
        if (!cancelled) setWatch(d.rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setWatch([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return watch;
}

export function Sidebar({
  sessions,
  activeId,
  sourcesHealthy,
  collapsed = false,
  onSelect,
  onNew,
  onPickTicker,
  onToggle,
  className,
}: {
  sessions: SessionSummary[];
  activeId: string | null;
  sourcesHealthy: boolean | null;
  collapsed?: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onPickTicker: (ticker: string) => void;
  onToggle?: () => void;
  className?: string;
}) {
  const watch = useWatchlist();

  // Collapsed: only what survives without a label — the marks.
  if (collapsed) {
    return (
      <nav
        aria-label="Theses and watchlist"
        className={cn('flex w-[68px] shrink-0 flex-col items-center gap-1 px-2 py-3', className)}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label="Expand panel"
          aria-expanded={false}
          title="Expand panel"
          className="mb-2 flex size-9 items-center justify-center rounded-full transition-opacity hover:opacity-75"
        >
          <BrandMark />
        </button>

        <button
          type="button"
          onClick={onNew}
          title="New thesis"
          aria-label="New thesis"
          className={cn(railClass(), 'bg-raised text-text')}
        >
          <Plus size={16} strokeWidth={1.5} aria-hidden />
        </button>
        <button
          type="button"
          onClick={onNew}
          title="Search theses"
          aria-label="Search theses"
          className={railClass()}
        >
          <Search size={16} strokeWidth={1.5} aria-hidden />
        </button>

        <div className="mt-3 flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
          {(watch ?? []).slice(0, RAIL_WATCH_LIMIT).map((row) => (
            <button
              key={row.ticker}
              type="button"
              onClick={() => onPickTicker(row.ticker)}
              className={railClass()}
              title={`${row.ticker}${row.last === undefined ? '' : ` · ${row.last.toFixed(2)}`}`}
              aria-label={`Start a thesis on ${row.ticker}`}
            >
              <TickerMark ticker={row.ticker} size="rail" />
            </button>
          ))}
        </div>

        {/* The dot alone is 6px of near-black while it is still checking, which
            leaves the bottom of the rail looking empty rather than quiet. A
            faint ring gives the slot presence without adding a second signal. */}
        <span
          className="mt-1 flex size-7 items-center justify-center rounded-full border border-line"
          title={healthLabel(sourcesHealthy)}
        >
          <span aria-hidden className={healthDotClass(sourcesHealthy)} />
          <span className="sr-only">{healthLabel(sourcesHealthy)}</span>
        </span>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Theses and watchlist"
      className={cn('flex w-[272px] shrink-0 flex-col gap-1 px-3 py-3', className)}
    >
      {/* brand row */}
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="flex items-center gap-2">
          <BrandMark />
          <span className="text-base font-medium tracking-[-0.01em] text-text">THESIS</span>
        </span>
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Collapse panel"
            aria-expanded
            title="Collapse panel"
            className="rounded-[7px] p-1 text-faint transition-colors hover:bg-raised hover:text-text"
          >
            <PanelLeftClose size={15} strokeWidth={1.5} />
          </button>
        ) : null}
      </div>

      <button type="button" onClick={onNew} className={cn(rowClass(), 'bg-raised text-text')}>
        <Plus size={15} strokeWidth={1.5} aria-hidden />
        New thesis
      </button>
      <button type="button" className={rowClass()} onClick={onNew}>
        <Search size={15} strokeWidth={1.5} aria-hidden />
        Search theses
      </button>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <WatchHeader />
        {watch === null ? (
          <p className="px-3 py-1 text-sm text-faint">Loading prices…</p>
        ) : (
          watch.map((row) => (
            <button
              key={row.ticker}
              type="button"
              onClick={() => onPickTicker(row.ticker)}
              className={rowClass()}
              title={row.name ?? row.ticker}
            >
              <TickerMark ticker={row.ticker} />
              <span data-figure className="w-12 shrink-0 text-sm text-text">
                {row.ticker}
              </span>
              <span data-num className="flex-1 text-right text-sm tabular-nums text-muted">
                {row.last === undefined ? '—' : row.last.toFixed(2)}
              </span>
              <span className="w-14 shrink-0 text-right">
                <Change pct={row.changePct24h} />
              </span>
            </button>
          ))
        )}

        {sessions.length > 0 ? (
          <>
            <SectionLabel>Your theses</SectionLabel>
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelect(session.id)}
                className={rowClass(session.id === activeId)}
              >
                <span data-figure className="shrink-0 text-sm">
                  {session.ticker}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-faint">
                  {session.thesis}
                </span>
                {session.untested > 0 ? (
                  <span
                    className="shrink-0 text-meta text-trust"
                    title={`${session.untested} thing${
                      session.untested === 1 ? '' : 's'
                    } holding this up that nothing can check`}
                  >
                    {session.untested}
                  </span>
                ) : null}
              </button>
            ))}
          </>
        ) : null}
      </div>

      {/* Where Orion pins an account row. THESIS has no wallet to show, so this
          holds the thing a user does need to trust: whether the sources are up. */}
      <div className="flex items-center gap-2.5 px-3 pt-2">
        <span aria-hidden className={healthDotClass(sourcesHealthy)} />
        <span className="text-meta leading-tight text-faint">{healthLabel(sourcesHealthy)}</span>
      </div>
    </nav>
  );
}
