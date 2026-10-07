'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PanelLeftClose, Plus, Search } from 'lucide-react';

import type { WatchRow } from '@/app/api/watchlist/route';
import { TelegramBind } from '@/components/shell/TelegramBind';
import { TickerMark } from '@/components/thesis/TickerMark';
import { readCollapsed, writeCollapsed } from '@/lib/panel';
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

/**
 * Anything that is not a mark: gone when collapsed.
 *
 * It fades out at once on the way in, and back a beat after the width starts
 * opening on the way out, so text is never seen squeezed against the edge.
 */
const FADE =
  'transition-opacity duration-150 delay-75 collapsed:opacity-0 collapsed:delay-0 collapsed:duration-100';

/** A one-line label that rides along with its row instead of wrapping as the width moves. */
const LABEL = cn(FADE, 'whitespace-nowrap');

/**
 * Every row is one pill in both states.
 *
 * Collapsed, it narrows to the 46px the rail leaves it, and its icon sits
 * exactly in the middle: 12px of padding either side of a 22px mark. The
 * labels after it are clipped rather than removed, so the row a reader
 * clicks on is the same element whichever way the panel is set.
 */
function rowClass(active = false) {
  return cn(
    'flex w-full items-center gap-3 overflow-hidden rounded-full px-3 py-2 text-left text-base',
    'transition-colors duration-150',
    active ? 'bg-raised text-text' : 'text-muted hover:bg-raised hover:text-text',
  );
}

/** Lucide icons are 15px. A 22px box puts their centre where a ticker mark's is. */
function RowIcon({ children }: { children: React.ReactNode }) {
  return <span className="flex w-[22px] shrink-0 justify-center">{children}</span>;
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

/**
 * The shell, and it works with or without a Desk around it.
 *
 * Every prop below is optional now. It used to require four callbacks and three
 * pieces of state, all owned by `Desk`, which meant the sidebar could only exist
 * on the one route that rendered a Desk. Clicking into a thesis made the whole
 * shell vanish, and the app read as two different products either side of a
 * link.
 *
 * Given handlers it behaves exactly as it always did. Given none it falls back
 * to plain navigation and fetches its own source health. The collapsed state
 * is always its own. A component that can only live inside one parent is not a
 * shell.
 */
export function Sidebar({
  sessions = [],
  activeId = null,
  sourcesHealthy,
  onSelect,
  onNew,
  onPickTicker,
  forceOpen = false,
  className,
}: {
  sessions?: SessionSummary[];
  activeId?: string | null;
  /** Omit to let the sidebar check the sources itself. */
  sourcesHealthy?: boolean | null | undefined;
  onSelect?: ((id: string) => void) | undefined;
  /** Omit to make "New thesis" navigate to the desk instead. */
  onNew?: (() => void) | undefined;
  /** Omit to make a watchlist row navigate to the desk instead. */
  onPickTicker?: ((ticker: string) => void) | undefined;
  /**
   * Always open, whatever the desktop preference. For the phone menu, where a
   * 70px rail inside a drawer would be a menu with nothing in it. It also
   * drops the collapse control, which would change the DESKTOP setting from a
   * phone.
   */
  forceOpen?: boolean;
  className?: string;
} = {}) {
  const router = useRouter();

  /*
    Own the health check only when nobody else does. `undefined` means "not
    supplied", which is different from `null` (checked, and the answer is
    unknown) and from `false`.
  */
  const [ownHealthy, setOwnHealthy] = useState<boolean | null>(null);
  const uncontrolledHealth = sourcesHealthy === undefined;

  /*
    What the panel LOOKS like is already settled by the time this runs: the
    head script set data-panel before the first paint. This only catches React
    up, so focus and the toggle's label match what is on screen.
  */
  const [storedCollapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(readCollapsed()), []);
  const collapsed = forceOpen ? false : storedCollapsed;

  const toggle = () => {
    writeCollapsed(!collapsed);
    setCollapsed(!collapsed);
  };

  useEffect(() => {
    if (!uncontrolledHealth) return;
    let live = true;
    fetch('/api/diag?quick=1')
      .then((r) => r.json())
      .then((d: { ok?: boolean }) => live && setOwnHealthy(Boolean(d.ok)))
      .catch(() => live && setOwnHealthy(false));
    return () => {
      live = false;
    };
  }, [uncontrolledHealth]);

  const health = uncontrolledHealth ? ownHealthy : sourcesHealthy;

  /*
    Without handlers these become navigation. A watchlist row on the activity
    screen cannot seed a draft in a Desk that is not mounted, so it carries the
    ticker to the desk in the URL and the desk picks it up there.
  */
  const startNew = onNew ?? (() => router.push('/'));
  const pickTicker =
    onPickTicker ?? ((ticker: string) => router.push(`/?ticker=${encodeURIComponent(ticker)}`));
  const select = onSelect ?? ((id: string) => router.push(`/?session=${encodeURIComponent(id)}`));
  const watch = useWatchlist();

  /*
    ONE tree for both states, and only the width moves.

    It used to be two separate trees swapped on a boolean, so collapsing was a
    cut from 272px to 68px with nothing in between. Now every mark keeps its
    place and the panel slides shut over the labels beside it. Collapsed is
    70px, not 68: that is what puts a 22px mark exactly in the middle of a row.

    Anything hidden by the collapse is also `inert`, so a keyboard cannot tab
    into a label nobody can see.
  */
  return (
    <nav
      aria-label="Theses and watchlist"
      {...(forceOpen ? { 'data-panel-open': '' } : {})}
      className={cn(
        'flex w-[272px] shrink-0 flex-col gap-1 overflow-hidden px-3 py-3',
        'transition-[width] duration-200 ease-[cubic-bezier(0.2,0,0,1)] collapsed:w-[70px]',
        className,
      )}
    >
      {/* Brand row. The mark sits over the column of row icons, so collapsing
          leaves it exactly where it was, and in the rail it is the way back:
          the one thing there that is not already a destination. */}
      <div className="flex items-center gap-2 pb-2 pl-[10px]">
        <button
          type="button"
          onClick={toggle}
          inert={!collapsed}
          aria-label="Expand panel"
          aria-expanded={false}
          title="Expand panel"
          className="shrink-0 rounded-full transition-opacity hover:opacity-75"
        >
          <BrandMark />
        </button>
        <span className={cn(LABEL, 'text-base font-medium tracking-[-0.01em] text-text')}>
          THESIS
        </span>
        {forceOpen ? null : (
          <button
            type="button"
            onClick={toggle}
            inert={collapsed}
            aria-label="Collapse panel"
            aria-expanded
            title="Collapse panel"
            className={cn(
              FADE,
              'ml-auto shrink-0 rounded-[7px] p-1 text-faint hover:bg-raised hover:text-text',
            )}
          >
            <PanelLeftClose size={15} strokeWidth={1.5} />
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={startNew}
        title={collapsed ? 'New thesis' : undefined}
        className={cn(rowClass(), 'bg-raised text-text')}
      >
        <RowIcon>
          <Plus size={15} strokeWidth={1.5} aria-hidden />
        </RowIcon>
        <span className={LABEL}>New thesis</span>
      </button>
      <button
        type="button"
        onClick={startNew}
        title={collapsed ? 'Search theses' : undefined}
        className={rowClass()}
      >
        <RowIcon>
          <Search size={15} strokeWidth={1.5} aria-hidden />
        </RowIcon>
        <span className={LABEL}>Search theses</span>
      </button>

      {/* overflow-x stays hidden in both states. Mid-animation the content is
          wider than the column, and a scrollbar would flash across the rail. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto collapsed:overflow-y-hidden">
        <div className={cn(FADE, 'w-[248px] shrink-0')} aria-hidden={collapsed}>
          <WatchHeader />
        </div>
        {watch === null ? (
          <p className={cn(LABEL, 'px-3 py-1 text-sm text-faint')}>Loading prices…</p>
        ) : (
          watch.map((row, i) => {
            const offRail = i >= RAIL_WATCH_LIMIT;
            return (
              <button
                key={row.ticker}
                type="button"
                onClick={() => pickTicker(row.ticker)}
                inert={collapsed && offRail}
                className={cn(rowClass(), 'shrink-0', offRail && FADE)}
                title={
                  collapsed
                    ? `${row.ticker}${row.last === undefined ? '' : ` · ${row.last.toFixed(2)}`}`
                    : (row.name ?? row.ticker)
                }
              >
                <TickerMark ticker={row.ticker} />
                {/* Fixed at the expanded width so the columns never reflow
                    while the panel moves. 190 = 248 - 24 padding - 22 mark - 12 gap. */}
                <span className={cn(FADE, 'flex w-[190px] shrink-0 items-center gap-3')}>
                  <span data-figure className="w-12 shrink-0 text-sm text-text">
                    {row.ticker}
                  </span>
                  <span data-num className="flex-1 text-right text-sm tabular-nums text-muted">
                    {row.last === undefined ? '—' : row.last.toFixed(2)}
                  </span>
                  <span className="w-14 shrink-0 text-right">
                    <Change pct={row.changePct24h} />
                  </span>
                </span>
              </button>
            );
          })
        )}

        {sessions.length > 0 ? (
          <div className={cn(FADE, 'w-[248px] shrink-0')} inert={collapsed}>
            <SectionLabel>Your theses</SectionLabel>
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => select(session.id)}
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
          </div>
        ) : null}
      </div>

      {/* Where Orion pins an account row. THESIS has no wallet to show, so this
          holds the two things a user does need to trust: that the sources are
          up, and that the answer can actually reach them. They are the same
          question asked from opposite ends, which is why they sit together. */}
      <div className={cn(FADE, 'w-[248px] shrink-0')} inert={collapsed}>
        <TelegramBind />
      </div>
      <div
        className="flex items-center gap-2.5 px-3 pt-2"
        title={collapsed ? healthLabel(health) : undefined}
      >
        {/* Slides 8px right as the panel closes, onto the rail's centre line.
            The ring only shows in the rail: alone there, a 6px dot that is
            still checking reads as an empty slot rather than a quiet one. */}
        <span
          className={cn(
            'relative shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] collapsed:translate-x-2',
            'after:absolute after:-inset-2 after:rounded-full after:border after:border-line',
            'after:opacity-0 after:transition-opacity collapsed:after:opacity-100',
          )}
        >
          <span aria-hidden className={healthDotClass(health)} />
        </span>
        <span className={cn(LABEL, 'text-meta leading-tight text-faint')}>
          {healthLabel(health)}
        </span>
      </div>
    </nav>
  );
}
