import Link from 'next/link';

import { BlockSection } from '@/components/thesis/AnalysisBlock';
import { AssumptionTree } from '@/components/thesis/AssumptionTree';
import { TickerMark } from '@/components/thesis/TickerMark';
import { TripwireRow } from '@/components/thesis/TripwireRow';
import { formatValue } from '@/engine/breakers/evaluate';
import { formatRelative, formatStamp, isStale } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  currentVersion,
  latestCheck,
  type Check,
  type HealthChange,
  type HealthDriver,
  type ThesisRecord,
} from '@/thesis/types';

import { HEALTH_DOT, HEALTH_TEXT, HEALTH_WORD } from './health-text';

/**
 * A thesis under observation.
 *
 * This is the screen the whole product exists to reach, and it is the one a
 * judge opens from a link — so it is SERVER-RENDERED from the store. No loading
 * flash, no client round trip, no spinner as the first thing anybody sees.
 *
 * It is the Desk's analysis rendering with a memory wrapped around it. Nothing
 * is re-invented: `AssumptionTree` and `TripwireRow` do the work they already
 * did, given two things they could not have on a first run — a verdict per
 * assumption, and where each tripwire stood last time. Exactly three things are
 * added on top: the health header, what moved, and the log.
 *
 * The lesson this follows was learned the expensive way earlier in this
 * project: when a new screen needs the old rendering, EXTEND it. Two parallel
 * renderings of the same data is always the wrong answer, and the plainer one
 * wins by default simply because it is the one wired to the new route.
 */

const DIRECTION_WORD = {
  bullish: 'betting it goes up',
  bearish: 'betting it goes down',
  neutral: 'no stated direction',
} as const;

/** How many log entries to print before folding the rest into a count. */
const LOG_WINDOW = 20;

/** The driver for one breaker, wherever in the assumption list it sits. */
function driverFor(check: Check | null, breakerId: string): HealthDriver | undefined {
  if (!check) return undefined;
  for (const assumption of check.assumptions) {
    const driver = assumption.drivers.find((d) => d.breakerId === breakerId);
    if (driver) return driver;
  }
  return undefined;
}

// ---------------------------------------------------------------------------

/**
 * What moved, with the evidence that moved it.
 *
 * Deliberately the most recent check that CHANGED something, not the most
 * recent check full stop. The loop runs four times an hour and nearly always
 * finds everything as it was, so keying this to the latest check would leave
 * the section empty almost permanently — and on TSLA it would hide a genuine
 * multi-assumption break forty entries down the log, which is the single most
 * important thing that page has to say.
 *
 * So it is dated, prominently. "Nothing has moved since 23 July" is a real and
 * useful statement; "here is what moved" with no date attached, when the move
 * was eight weeks ago, is not.
 *
 * Renders nothing at all when nothing has ever moved. The alternative — "no
 * change", four times an hour — teaches a reader to skip the one place on the
 * page that will matter on the day something does.
 */
function LatestChallenge({ check, now }: { check: Check; now: number }) {
  if (check.changes.length === 0) return null;

  return (
    <BlockSection title="The last time anything moved" tone="lead">
      <p className="mb-4 max-w-prose text-base text-muted">
        <span data-figure>{formatStamp(check.at)}</span> · {formatRelative(check.at, now)}
        {check.source === 'backfill' ? (
          <span className="text-trust">
            {' '}
            · reconstructed, so this is what you would have been told, not a warning you were
            given
          </span>
        ) : null}
      </p>
      <ul className="flex flex-col gap-4">
        {check.changes.map((change) => (
          <li key={`${change.assumptionId}-${change.to}`}>
            <div className="flex flex-wrap items-baseline gap-x-2.5">
              <span data-figure className="text-sm text-faint">
                {change.assumptionId}
              </span>
              <span className={cn('text-meta uppercase tracking-[0.12em]', HEALTH_TEXT[change.from])}>
                {HEALTH_WORD[change.from]}
              </span>
              <span aria-hidden className="text-faint">
                →
              </span>
              <span className={cn('text-meta uppercase tracking-[0.12em]', HEALTH_TEXT[change.to])}>
                {HEALTH_WORD[change.to]}
              </span>
            </div>
            <p className="mt-1 max-w-prose text-base leading-snug text-text">{change.statement}</p>
            {change.metric && change.observed !== undefined && change.threshold !== undefined ? (
              <p className="mt-1 text-base text-muted">
                <span data-figure>{formatValue(change.metric, change.observed)}</span>{' '}
                against a line at{' '}
                <span data-figure>{formatValue(change.metric, change.threshold)}</span>
                {change.provenance?.source ? (
                  <span className="text-faint"> · {change.provenance.source}</span>
                ) : null}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </BlockSection>
  );
}

// ---------------------------------------------------------------------------

/**
 * Every time reality was consulted.
 *
 * Reconstructed entries are marked, and the note above the log says plainly
 * what they are. They are a COUNTERFACTUAL — what these tripwires would have
 * said had the thesis existed then — and not a warning anybody received. The
 * data carries that distinction in `source`; the words have to carry it too, or
 * the screen is quietly claiming credit for a warning it never gave.
 */
function CheckLog({ thesis }: { thesis: ThesisRecord }) {
  const reconstructed = thesis.checks.filter((c) => c.source === 'backfill').length;
  const observed = thesis.checks.length - reconstructed;
  const newestFirst = [...thesis.checks].reverse();
  const shown = newestFirst.slice(0, LOG_WINDOW);
  const hidden = newestFirst.length - shown.length;

  return (
    <BlockSection title="Every time this was checked" tone="quiet">
      <p className="mb-4 max-w-prose text-base text-muted">
        <span data-figure>{thesis.checks.length}</span> checks ·{' '}
        <span data-figure>{observed}</span> observed
        {reconstructed > 0 ? (
          <>
            , <span data-figure>{reconstructed}</span> reconstructed
          </>
        ) : null}
        .
      </p>

      {reconstructed > 0 ? (
        <p className="mb-5 max-w-prose border-l-2 border-trust/40 pl-3 text-base text-trust">
          Reconstructed checks replay these same tripwires over data from before this thesis
          existed. They show what you WOULD have been told, had you held this belief then. Nobody
          was warned at the time, and the thresholds were written later, so the early verdicts judge
          the past by a standard set after it.
        </p>
      ) : null}

      <ol className="flex flex-col">
        {shown.map((check) => (
          <li
            key={check.at}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line/60 py-2 last:border-b-0"
          >
            <span aria-hidden className={cn('size-[6px] shrink-0 rounded-full', HEALTH_DOT[check.health])} />
            <span data-figure className="text-sm text-faint">
              {formatStamp(check.at)}
            </span>
            <span className={cn('text-sm', HEALTH_TEXT[check.health])}>
              {HEALTH_WORD[check.health]}
            </span>
            {check.changes.length > 0 ? (
              <span className="text-sm text-text">
                {check.changes.length} change{check.changes.length === 1 ? '' : 's'}
              </span>
            ) : null}
            <span className="ml-auto text-meta uppercase tracking-[0.12em] text-faint">
              {check.source === 'backfill' ? 'reconstructed' : check.source}
            </span>
          </li>
        ))}
      </ol>

      {hidden > 0 ? (
        <p className="mt-3 text-base text-faint">
          <span data-figure>{hidden}</span> earlier check{hidden === 1 ? '' : 's'} not shown.
        </p>
      ) : null}
    </BlockSection>
  );
}

// ---------------------------------------------------------------------------

export function ThesisDetail({ thesis }: { thesis: ThesisRecord }) {
  // Read once. Two calls to Date.now() while rendering can straddle a minute
  // boundary and print two different ages for the same moment on one page.
  const now = Date.now();
  const version = currentVersion(thesis);
  const check = latestCheck(thesis);
  const health = check?.health ?? 'uncheckable';
  const breakers = version.breakerSet.breakers;
  const stale = isStale(check?.at ?? null, now);

  /*
    `directionUnknown` was TRUE when this check ran, and the page knows better.

    A check records whether it had a predecessor at the moment it was computed.
    The historical backfill then splices reconstructed checks in FRONT of the
    observed ones, so a check that was genuinely first when it ran now has
    sixty entries behind it — and the page was printing "no earlier check to
    compare against yet" directly under a header reading "61 checks".

    Corrected here rather than in the stored check, because rewriting a stored
    observation to agree with a later reconstruction is the one thing the whole
    append-only design exists to prevent. The check is right about what it knew;
    the page is right about what exists now.
  */
  const hasEarlier = thesis.checks.length > 1;
  /*
    The last check that actually changed something. Walked from the newest end,
    so the first hit is the most recent one.
  */
  const lastMovement = [...thesis.checks].reverse().find((c) => c.changes.length > 0) ?? null;
  const assumptionHealth = check?.assumptions.map((a) => ({
    ...a,
    directionUnknown: a.directionUnknown && !hasEarlier,
  }));

  return (
    <article className="mx-auto w-full max-w-2xl px-6 py-12">
      {/*
        Says where it actually goes. `/` is the research desk — the sidebar,
        watchlist and composer — not a list of theses, because the "My Theses"
        screen has not been built yet. Labelling this "All theses" would promise
        a screen that does not exist, and a link that lies about its destination
        is worse than a plain one.
      */}
      <Link
        href="/"
        className="text-meta uppercase tracking-[0.14em] text-faint transition-colors hover:text-muted"
      >
        ← The desk
      </Link>

      {/* ---- the header is the verdict, and it leads with the BELIEF ---- */}
      <header className="mt-6 border-b border-line-strong pb-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <TickerMark ticker={thesis.ticker} size="title" />
          <span data-figure className="text-sm text-text">
            {thesis.ticker}
          </span>
          <span className="text-meta uppercase tracking-[0.12em] text-faint">
            {DIRECTION_WORD[thesis.direction]}
          </span>
          <span
            className={cn(
              'ml-auto flex items-baseline gap-2 text-meta uppercase tracking-[0.14em]',
              HEALTH_TEXT[health],
            )}
          >
            <span
              aria-hidden
              className={cn('relative top-[-1px] size-[7px] rounded-full', HEALTH_DOT[health])}
            />
            {HEALTH_WORD[health]}
          </span>
        </div>

        {/*
          The STATEMENT leads, not the ticker. A page that leads with "NVDA" is
          a watchlist row wearing a different hat; a page that leads with what
          you claimed is a promise you made and are now on the hook for.
        */}
        <p className="mt-3 max-w-[38ch] text-[1.45rem] font-medium leading-[1.3] tracking-[-0.01em] text-text">
          {version.statement}
        </p>

        <p className="mt-4 flex flex-wrap items-baseline gap-x-2 text-meta text-faint">
          <span data-figure>v{version.n}</span>
          <span aria-hidden>·</span>
          <span data-figure>{thesis.checks.length}</span>
          <span>checks</span>
          {check ? (
            <>
              <span aria-hidden>·</span>
              {/*
                The one number on this page that has to be beyond reproach. It
                rounds DOWN, and when it goes stale it says so in amber rather
                than being styled away — a "last checked" that has quietly
                stopped moving is the single failure this product cannot hide.
              */}
              <span className={cn(stale && 'text-trust')}>
                {stale ? 'stale · ' : ''}
                last checked {formatRelative(check.at, now)}
              </span>
            </>
          ) : (
            <>
              <span aria-hidden>·</span>
              <span className="text-trust">never checked</span>
            </>
          )}
        </p>
      </header>

      <div className="pt-8">
        {lastMovement ? <LatestChallenge check={lastMovement} now={now} /> : null}

        <BlockSection title="What this trade is standing on">
          <AssumptionTree
            decomposition={version.decomposition}
            breakerSet={version.breakerSet}
            {...(assumptionHealth ? { health: assumptionHealth } : {})}
          />
        </BlockSection>

        {breakers.length > 0 ? (
          <BlockSection title="Where each tripwire stands">
            {breakers.map((breaker) => {
              // Point back at the numbered line in the tree above rather than
              // printing the engine's id for this breaker.
              const watches =
                version.decomposition.assumptions.findIndex((a) => a.id === breaker.assumptionRef) +
                1;
              return (
                <TripwireRow
                  key={breaker.id}
                  breaker={breaker}
                  evaluation={check?.evaluations.find((e) => e.breakerId === breaker.id)}
                  {...(watches > 0 ? { watches } : {})}
                  {...(driverFor(check, breaker.id) ? { trend: driverFor(check, breaker.id) } : {})}
                />
              );
            })}
          </BlockSection>
        ) : null}

        <CheckLog thesis={thesis} />

        <p className="mt-10 border-t border-line pt-3 text-meta text-faint">
          Research, not advice. You decide.
        </p>
      </div>
    </article>
  );
}

export type { HealthChange };
