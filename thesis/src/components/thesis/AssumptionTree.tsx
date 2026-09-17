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
  high: 'the trade rests on this',
  medium: 'matters, but not fatal',
  low: 'minor',
};

const ORIGIN_LABEL: Record<Assumption['origin'], string> = {
  implicit: "you didn't say this",
  stated: 'your words',
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

      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span data-figure className={cn('text-sm', untestable ? 'text-trust' : 'text-faint')}>
          {assumption.id}
        </span>
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
        {health ? (
          <span
            className={cn(
              'ml-auto text-meta uppercase tracking-[0.12em]',
              HEALTH_TEXT[health.health],
            )}
          >
            {HEALTH_WORD[health.health]}
          </span>
        ) : null}
      </div>

      <p className={cn('mt-1.5 max-w-prose text-base leading-snug', LOAD_TEXT[assumption.loadBearing])}>
        <Reveal text={assumption.statement} delay={Math.min(index, 8) * 70 + 120} />
      </p>

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
                  ? 'The trade leans on it, and no data this system can reach would tell you if it stopped being true. You have to judge it yourself.'
                  : 'No data this system can reach would tell you if it stopped being true.'
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
              <span className="text-muted">watched by</span>
              <span data-figure className="text-sm text-faint">
                {breaker.id}
              </span>
              <PlainCondition breaker={breaker} />
            </li>
          ))}
        </ul>
      ) : pending ? (
        <p className="mt-2 text-base text-faint">Working out how to check this…</p>
      ) : (
        <p className="mt-2 max-w-prose text-base text-faint">
          This could be checked, but no tripwire was built for it — so you will not get a signal
          either.
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
  const tripwireDef = defineConcept('tripwire');
  const assumptionDef = defineConcept('assumption');

  return (
    <div className={cn('flex flex-col gap-7', className)}>
      <p className="max-w-prose text-base text-muted">
        Your thesis, pulled apart. Each line is an{' '}
        {assumptionDef ? <Define definition={assumptionDef} /> : 'assumption'} — something that has
        to be true for the trade to work. Where one can be checked, it gets a{' '}
        {tripwireDef ? <Define definition={tripwireDef} /> : 'tripwire'}.
      </p>

      {claims.map((claim) => {
        const supporting = assumptions.filter((a) => a.supports.includes(claim.id));

        return (
          <section key={claim.id}>
            <div className="flex flex-wrap items-baseline gap-x-2.5">
              <span data-figure className="text-sm text-faint">
                {claim.id}
              </span>
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

      {summary.unfalsifiableLoadBearing.length > 0 ? (
        <p className="max-w-prose border-t border-line pt-4 text-base text-trust">
          {summary.unfalsifiableLoadBearing.join(' and ')}{' '}
          {summary.unfalsifiableLoadBearing.length === 1 ? 'is' : 'are'} holding up this trade, and
          nothing here can check{' '}
          {summary.unfalsifiableLoadBearing.length === 1 ? 'it' : 'them'}. If{' '}
          {summary.unfalsifiableLoadBearing.length === 1 ? 'it stops' : 'they stop'} being true, you
          will not be told.
        </p>
      ) : null}
    </div>
  );
}
