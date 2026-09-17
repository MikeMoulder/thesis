'use client';

import { Define } from '@/components/prose/Define';
import { Reveal } from '@/components/prose/Reveal';
import { PlainCondition } from '@/components/thesis/PlainCondition';
import type { Assumption, Decomposition } from '@/engine/decomposer/types';
import type { BreakerSet, ThesisBreaker } from '@/engine/breakers/types';
import { defineConcept } from '@/lib/glossary';
import { cn } from '@/lib/utils';
import type { AssumptionHealth } from '@/thesis/types';

import { BASIS_CLAUSE, HEALTH_DOT, HEALTH_TEXT, HEALTH_WORD, UNKNOWN_DIRECTION } from './health-text';

/**
 * The thesis in pieces — the product's argument, made before anyone reads a word.
 *
 * Amber nodes are dead ends: things the thesis leans on that nothing here can
 * ever check. Seeing two of five branches stop dead, and those two being the
 * load-bearing ones, is the whole point, and it should land on a reader who has
 * never traded.
 *
 * So the labels are English, not vocabulary. "IMPLICIT / HIGH LOAD" told a
 * newcomer nothing; "you didn't say this — and the trade rests on it" tells them
 * exactly what it is. Load is still shown by BRIGHTNESS rather than colour, so
 * amber keeps its single meaning: you are carrying this on trust.
 */

const LOAD_TEXT: Record<Assumption['loadBearing'], string> = {
  high: 'text-text',
  medium: 'text-muted',
  low: 'text-faint',
};

const LOAD_LABEL: Record<Assumption['loadBearing'], string> = {
  high: 'the whole trade rests on this',
  medium: 'matters, but not fatal',
  low: 'minor',
};

/*
  These used to read "you didn't say this" and "your words", which a reader
  reasonably took as a prompt: had they forgotten to type something, was an
  answer being asked of them?

  Neither label is a request. They describe where the assumption CAME FROM, and
  the distinction is the most valuable thing on the page: an assumption you
  never stated is one you have never checked, because you did not know you were
  making it. So the label now says that outright, and the note above the tree
  explains why it matters before the first one appears.
*/
const ORIGIN_LABEL: Record<Assumption['origin'], string> = {
  implicit: 'you never said this, but it has to be true',
  stated: 'you said this yourself',
};

function Meta({ children, tone }: { children: React.ReactNode; tone?: 'trust' }) {
  return (
    <span
      className={cn(
        'text-meta uppercase tracking-[0.12em]',
        tone === 'trust' ? 'text-trust' : 'text-faint',
      )}
    >
      {children}
    </span>
  );
}

function Node({
  assumption,
  breakers,
  pending,
  index,
  health,
}: {
  assumption: Assumption;
  breakers: ThesisBreaker[];
  pending: boolean;
  index: number;
  /** The verdict from the latest check. Absent mid-run, and that is correct. */
  health?: AssumptionHealth | undefined;
}) {
  const untestable = assumption.testability === 'none';
  const covering = breakers.filter((b) => b.assumptionRef === assumption.id);
  const danger = untestable && assumption.loadBearing === 'high';
  const implicitDef = defineConcept(assumption.origin);
  const loadDef = defineConcept('loadBearing');

  return (
    <li
      // Staggered so the branches arrive one after another rather than all at
      // once — the reader follows the structure being built instead of being
      // handed a finished wall of text.
      style={{ animationDelay: `${Math.min(index, 8) * 70}ms` }}
      className={cn(
        'animate-rise relative pb-6 pl-6 last:pb-0',
        'before:absolute before:left-0 before:top-0 before:h-full before:w-px before:bg-line-strong',
        'last:before:h-[0.62rem]',
        'after:absolute after:left-0 after:top-[0.62rem] after:h-px after:w-4 after:bg-line-strong',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-[0.62rem] z-10 block size-[7px] -translate-x-[3px] -translate-y-[3px] rounded-full',
          // A measured verdict outranks the structural one. Before anything has
          // been checked the dot can only say "nothing can test this", which is
          // a fact about the ASSUMPTION; once there is a check it can say how
          // the assumption is actually doing, which is a fact about the WORLD.
          health ? HEALTH_DOT[health.health] : untestable ? 'bg-trust' : 'bg-line-strong',
        )}
      />

      {/*
        CONTENT FIRST, CLASSIFICATION SECOND.

        The two labels together run to eleven words, and with them above the
        statement a reader met "you never said this, but it has to be true, the
        whole trade rests on this" before learning what THIS was. The metadata
        outweighed the thing it described.

        So the row now reads: which one, what it claims, then how it was
        classified. The verdict stays at the top right, because that is the one
        piece of metadata worth seeing before the sentence.
      */}
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span data-figure className={cn('text-sm', untestable ? 'text-trust' : 'text-faint')}>
          {index + 1}
        </span>
        <p
          className={cn(
            'min-w-0 flex-1 max-w-prose text-base leading-snug',
            LOAD_TEXT[assumption.loadBearing],
          )}
        >
          <Reveal text={assumption.statement} delay={Math.min(index, 8) * 70 + 120} />
        </p>
        {health ? (
          <span
            className={cn(
              'shrink-0 text-meta uppercase tracking-[0.12em]',
              HEALTH_TEXT[health.health],
            )}
          >
            {HEALTH_WORD[health.health]}
          </span>
        ) : null}
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <Meta>
          {implicitDef ? (
            <Define definition={implicitDef}>{ORIGIN_LABEL[assumption.origin]}</Define>
          ) : (
            ORIGIN_LABEL[assumption.origin]
          )}
        </Meta>
        <Meta>
          {loadDef ? (
            <Define definition={loadDef}>{LOAD_LABEL[assumption.loadBearing]}</Define>
          ) : (
            LOAD_LABEL[assumption.loadBearing]
          )}
        </Meta>
      </div>

      {/*
        WHY the verdict, never just the verdict. A badge on its own is an
        opinion the reader has to take on faith; the clause underneath is what
        makes it a reading. Silent where the word already says it all.
      */}
      {/*
        Suppressed where the node already explains itself. An untestable
        assumption prints "Nothing here can check this" in full below, and
        "nothing could read this" directly above it is the same sentence twice
        in the same colour — which reads as emphasis and is actually repetition.
      */}
      {health && !untestable && BASIS_CLAUSE[health.basis] ? (
        <p className={cn('mt-1 max-w-prose text-sm', HEALTH_TEXT[health.health])}>
          {BASIS_CLAUSE[health.basis]}
          {/* Only a distance judgement can be missing its direction. */}
          {health.directionUnknown && health.basis === 'proximity'
            ? ` (${UNKNOWN_DIRECTION})`
            : ''}
        </p>
      ) : null}

      {untestable ? (
        <p className="mt-2 max-w-prose text-base leading-snug text-trust">
          Nothing here can check this.{' '}
          <span className="text-trust/75">
            <Reveal
              delay={Math.min(index, 8) * 70 + 260}
              text={
                danger
                  ? 'There is no filing, no price and no feed in this desk that could tell you if it stopped being true, and the whole trade leans on it. That does not make it wrong. It means you are trusting it, and only you can settle it.'
                  : 'There is no filing, no price and no feed in this desk that could tell you if it stopped being true.'
              }
            />
          </span>
        </p>
      ) : covering.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {covering.map((breaker) => (
            <li key={breaker.id} className="flex flex-wrap items-baseline gap-x-2 text-base">
              <span aria-hidden className="text-faint">
                ↳
              </span>
              {/* No breaker id. The condition beside it says what it watches
                  far better than "B4" ever did. */}
              <span className="text-muted">we will tell you</span>
              <PlainCondition breaker={breaker} />
            </li>
          ))}
        </ul>
      ) : pending ? (
        <p className="mt-2 text-base text-faint">Working out how to check this…</p>
      ) : (
        <p className="mt-2 max-w-prose text-base text-faint">
          This one could be measured, but no tripwire was built for it, so nothing will warn you
          either way.
        </p>
      )}
    </li>
  );
}

export function AssumptionTree({
  decomposition,
  breakerSet,
  breakersPending = false,
  health,
  className,
}: {
  decomposition: Decomposition;
  breakerSet?: BreakerSet | undefined;
  breakersPending?: boolean;
  /**
   * Per-assumption verdicts from the latest check.
   *
   * Optional ON PURPOSE. This tree is also rendered mid-run, and at that point
   * nothing has been measured — a verdict shown then would be invented, which
   * is the one thing this component must never do.
   */
  health?: AssumptionHealth[] | undefined;
  className?: string;
}) {
  const breakers = breakerSet?.breakers ?? [];
  const { claims, assumptions, summary } = decomposition;
  /** The load bearing assumptions nothing can test, as objects rather than ids. */
  const blind = summary.unfalsifiableLoadBearing
    .map((id) => assumptions.find((a) => a.id === id))
    .filter((a): a is Assumption => Boolean(a));
  const tripwireDef = defineConcept('tripwire');
  const assumptionDef = defineConcept('assumption');

  return (
    <div className={cn('flex flex-col gap-7', className)}>
      {/*
        The teaching happens HERE, once, before the first row. Labels on
        individual rows have room for three or four words, and three or four
        words cannot explain why an unstated assumption is worth more attention
        than a stated one. A reader who has read this paragraph can read every
        row below without a tooltip.
      */}
      <div className="flex max-w-prose flex-col gap-3 text-base text-muted">
        <p>
          Every line below is something that has to be true for this trade to work. This is your
          reasoning, taken apart into the pieces it stands on.
        </p>
        <p>
          Some of them you wrote yourself. Others you never said out loud, but your reasoning does
          not hold without them. Those unstated ones are worth the most attention, because you
          cannot check a belief you did not know you had.
        </p>
        <p>
          Where a line can be measured, we put a{' '}
          {tripwireDef ? <Define definition={tripwireDef} /> : 'tripwire'} under it: an exact number
          that would tell you it has stopped being true. Where nothing can measure it, we say so
          rather than pretend.
        </p>
      </div>

      {claims.map((claim, claimIndex) => {
        const supporting = assumptions.filter((a) => a.supports.includes(claim.id));

        return (
          <section key={claim.id}>
            <div className="flex flex-wrap items-baseline gap-x-2.5">
              {/* Engine ids are not shown. "C1" told the reader nothing, and a
                  single-claim thesis does not need a number at all. */}
              {claims.length > 1 ? (
                <span data-figure className="text-sm text-faint">
                  {claimIndex + 1}
                </span>
              ) : null}
              <Meta>what you are betting on</Meta>
            </div>
            <p className="mt-1.5 max-w-prose text-lg leading-snug text-text">{claim.statement}</p>

            <ul className="mt-5 ml-1">
              {supporting.map((assumption, index) => (
                <Node
                  key={assumption.id}
                  assumption={assumption}
                  breakers={breakers}
                  pending={breakersPending}
                  index={index}
                  {...(health?.find((h) => h.assumptionId === assumption.id)
                    ? { health: health.find((h) => h.assumptionId === assumption.id) }
                    : {})}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {/*
        This printed the raw engine ids: "A3 is holding up this trade". A reader
        has no idea what A3 is, and hunting for it defeats the purpose of a
        summary. It now quotes the assumption itself.
      */}
      {blind.length > 0 ? (
        <div className="max-w-prose border-t border-line pt-4">
          <p className="text-base text-trust">
            {blind.length === 1
              ? 'One of these is holding up the whole trade, and nothing in this desk can check it:'
              : `${blind.length} of these are holding up the whole trade, and nothing in this desk can check them:`}
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {blind.map((assumption) => (
              <li key={assumption.id} className="text-base leading-snug text-trust/85">
                &ldquo;{assumption.statement}&rdquo;
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-base text-trust/85">
            If {blind.length === 1 ? 'it stops' : 'they stop'} being true, nothing here will tell
            you. That judgement stays with you.
          </p>
        </div>
      ) : null}
    </div>
  );
}
