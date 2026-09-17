'use client';

import { CitationChip } from '@/components/evidence/CitationChip';
import { Reveal } from '@/components/prose/Reveal';
import type { CaveatId, DerivedSignal, InvalidationLevel } from '@/engine/signal';
import { metricPhrase } from '@/lib/glossary';
import { cn } from '@/lib/utils';

/**
 * A signal, as a reader sees it.
 *
 * ## What this screen is arguing
 *
 * Not "here is a trade". The argument is that every number on it was already
 * on the thesis, and the panel is laid out to make that checkable: each level
 * carries the working that produced it, in full, in the same size type as the
 * number itself. A price with no derivation beside it is indistinguishable
 * from one a model made up, and that is the entire difference this feature
 * exists to show.
 *
 * ## Why the refusal is the headline when there is one
 *
 * A thesis whose tripwires are all fundamental has no price at which it is
 * wrong. The temptation is to render that as an empty section. It is stated as
 * the finding instead, because "your reasoning implies no stop" is the most
 * useful thing this panel can say and the thing no competing tool will print.
 *
 * ## Size sits beside risk, never alone
 *
 * A cap on its own reads as permission. Next to the dollars that cap puts at
 * risk before the thesis quits, it reads as what it is: an upper bound set by
 * the order book, not a recommendation.
 */

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('text-meta uppercase tracking-[0.14em] text-faint', className)}>
      {children}
    </span>
  );
}

/** Never "10000.00". A size is read at a glance or it is not read. */
function money(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(2)}`;
}

const STABILITY_WORD: Record<InvalidationLevel['stability'], string> = {
  fixed: 'stays where it is',
  'moves-with-high': 'rises with a new high',
  'moves-daily': 'moves every day',
};

function LevelRow({ level, reference }: { level: InvalidationLevel; reference: number | null }) {
  const below = level.distancePct < 0;

  return (
    <li className="border-t border-line py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span data-num className="text-lg tabular-nums text-text">
          {level.price}
        </span>
        <span data-num className={cn('text-sm tabular-nums', below ? 'text-fired' : 'text-muted')}>
          {level.distancePct > 0 ? '+' : ''}
          {level.distancePct}%
        </span>
        <span className="text-meta text-faint">{metricPhrase(level.metric)}</span>
        {/* The stability word is not a footnote. A level from a rolling window
            is only true today, and a reader who writes it down without seeing
            this is working from a number that expires overnight. */}
        <span
          className={cn(
            'text-meta',
            level.stability === 'fixed' ? 'text-faint' : 'text-trust',
          )}
        >
          {STABILITY_WORD[level.stability]}
        </span>
      </div>

      <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted">{level.statement}</p>

      {/* The working, shown at full size rather than hidden behind a toggle.
          This sentence is the reason to believe the number above it. */}
      <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-faint">
        {level.derivation}
        {reference === null ? null : '.'}
      </p>
    </li>
  );
}

/**
 * Caveats whose point this panel makes elsewhere, in full, in its own section.
 * Listing them again in the closing summary is repetition, not emphasis.
 */
const ALREADY_SHOWN = new Set<CaveatId>(['no-price-level', 'empty-book', 'nothing-continuous']);

/**
 * Caveats worth printing here, tolerant of what is already in localStorage.
 *
 * Signal turns persist in the browser, so a panel can be handed a turn saved
 * before the caveat shape changed. Those arrive as bare strings: `c.id` is
 * undefined, every key collides, and each row renders as an empty bullet under
 * a heading. React reported the duplicate keys; the screen just showed a
 * heading with nothing under it, which is the worse of the two symptoms
 * because nothing looks broken.
 *
 * Old entries are carried rather than dropped. A caveat is a stated limit, and
 * silently discarding one to tidy up a migration is the wrong direction to
 * fail in.
 */
function visibleCaveats(caveats: DerivedSignal['caveats']): Array<{ id: string; text: string }> {
  return caveats
    .map((c, i) =>
      typeof c === 'string'
        ? { id: `legacy-${i}`, text: c as string }
        : { id: c?.id ?? `unknown-${i}`, text: c?.text ?? '' },
    )
    .filter((c) => c.text.length > 0 && !ALREADY_SHOWN.has(c.id as CaveatId));
}

export function SignalPanel({ signal }: { signal: DerivedSignal }) {
  const { levels, nearest, size, monitorability } = signal;
  const shown = visibleCaveats(signal.caveats);

  return (
    <section className="mt-2">
      {/* No heading: the block frame above already names this and the
          instrument, and repeating it reads as a bug. */}
      <header className="pb-4">
        <p className="max-w-prose text-base leading-relaxed text-text">
          {!signal.tradable && signal.rToken === null ? (
            <>
              <Reveal className="text-fired" text={signal.ticker} /> has no rToken listed on
              Bitget, so none of this could be traded on this venue.
            </>
          ) : size?.maxNotionalUsd === 0 ? (
            <>
              Nothing is bid on <Reveal className="text-fired" text={signal.ticker} />. A position
              of any size could be opened here and could not be closed.
            </>
          ) : levels.length === 0 ? (
            <>
              Not one tripwire on this thesis implies a price, so{' '}
              <Reveal className="text-fired" text="there is no level at which it says you are wrong." />
            </>
          ) : (
            <>
              {signal.side === 'long' ? 'Long' : signal.side === 'short' ? 'Short' : 'Flat'}{' '}
              {signal.ticker}
              {size ? <> up to {money(size.maxNotionalUsd)}</> : null}, wrong below{' '}
              <Reveal className="text-fired" text={String(nearest?.level.price)} />
              {nearest ? <>, which is {nearest.riskPct}% away.</> : '.'}
            </>
          )}
        </p>

        <p className="mt-2 max-w-prose text-sm text-faint">
          Every number here was already on this thesis. Nothing was generated, and no model was
          called to produce it.
          {signal.reference === null
            ? ' No live price could be read, so nothing below is anchored.'
            : ` Measured against ${signal.reference}.`}
        </p>
      </header>

      {/* --------------------------------------------------------------- */}

      <div className="border-t border-line-strong pt-3">
        <Label>Where this thesis says you are wrong</Label>
        {levels.length === 0 ? (
          <p className="mt-2 max-w-prose text-base leading-relaxed text-text">
            No price level can be derived. Every tripwire on this thesis is fundamental or
            valuation based, and those move when a filing lands rather than when the price does.
            Any stop placed here would be a number you invented, not one this thesis implies.
          </p>
        ) : (
          <ul className="mt-1 list-none">
            {levels.map((level) => (
              <LevelRow key={level.breakerId} level={level} reference={signal.reference} />
            ))}
          </ul>
        )}
      </div>

      {/* --------------------------------------------------------------- */}

      {size ? (
        <div className="mt-5 border-t border-line-strong pt-3">
          <Label>How much of it you could actually close</Label>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <span>
              <span data-num className="text-lg tabular-nums text-text">
                {money(size.maxNotionalUsd)}
              </span>{' '}
              <span className="text-meta text-faint">position cap</span>
            </span>
            {nearest?.riskUsdAtMaxSize !== undefined ? (
              <span>
                <span data-num className="text-lg tabular-nums text-fired">
                  {money(nearest.riskUsdAtMaxSize)}
                </span>{' '}
                <span className="text-meta text-faint">
                  at risk to {nearest.level.price}
                </span>
              </span>
            ) : null}
            {size.slippageBps !== undefined ? (
              <span>
                <span data-num className="text-lg tabular-nums text-muted">
                  {size.slippageBps}
                </span>{' '}
                <span className="text-meta text-faint">bps to exit</span>
              </span>
            ) : null}
          </div>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-faint">{size.note}</p>
        </div>
      ) : (
        <div className="mt-5 border-t border-line-strong pt-3">
          <Label>How much of it you could actually close</Label>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-trust">
            The order book could not be read, so no size cap can be set. Absence of a number here
            is not a large number.
          </p>
        </div>
      )}

      {/* --------------------------------------------------------------- */}

      <div className="mt-5 border-t border-line-strong pt-3">
        <Label>What would tell you</Label>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-text">
          {monitorability.note}
        </p>
      </div>

      {/* --------------------------------------------------------------- */}

      {/*
        Caveats this panel has already made in full are dropped rather than
        repeated. The no-price-level case has a section of its own above and
        the headline states it, so printing it a third time here read as
        padding and made the first two look less certain rather than more.
        The engine still carries every caveat for anything reading the API.
      */}
      {shown.length > 0 ? (
        <div className="mt-5 border-t border-line pt-3">
          <Label>What this does not know</Label>
          <ul className="mt-2 list-none space-y-1.5">
            {shown.map((caveat) => (
              <li key={caveat.id} className="max-w-prose text-sm leading-relaxed text-faint">
                {caveat.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <CitationChip
          provenance={{
            status: 'inferred',
            source: 'Stored tripwires and the live order book',
            confidence: 'high',
            derivation:
              'no model calls; levels solved from the tripwires, size from resting bid depth',
          }}
        />
      </div>
    </section>
  );
}
