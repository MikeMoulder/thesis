'use client';

import { ChevronRight } from 'lucide-react';

import { Reveal } from '@/components/prose/Reveal';
import { TripwireRow } from '@/components/thesis/TripwireRow';
import type { Belief, BeliefStatus } from '@/engine/beliefs';
import type { Evaluation } from '@/engine/breakers/evaluate';
import type { BreakerSet } from '@/engine/breakers/types';
import type { Assumption } from '@/engine/decomposer/types';
import { cn } from '@/lib/utils';
import type { HealthDriver } from '@/thesis/types';

import { BASIS_CLAUSE, UNKNOWN_DIRECTION } from './health-text';

/**
 * What the trade stands on, one belief at a time, worst first.
 *
 * This replaces four sections that each listed the same beliefs: a diagram
 * numbered A1 to A6, the same list in words, the tripwires as a separate list
 * ("watches 3"), and a brief that listed the readings a fourth time. A reader
 * had to carry a number from one section to the next to learn whether one
 * belief was in trouble, and the answer to the whole run sat at the bottom.
 *
 * Now each belief carries its own verdict, its own gauge and its own source,
 * and the list is ordered by how much trouble each one is in. The first row is
 * the one to read.
 *
 * The vocabulary matches the thesis list on the front page: broken, at risk,
 * can't check, holding. One word means one thing everywhere in the product.
 */

const STATUS_WORD: Record<BeliefStatus, string> = {
  broken: 'Broken',
  'at-risk': 'At risk',
  unknown: "Can't check",
  holding: 'Holding',
  pending: 'Checking',
};

const STATUS_TEXT: Record<BeliefStatus, string> = {
  broken: 'text-fired',
  'at-risk': 'text-fired/70',
  unknown: 'text-trust',
  holding: 'text-muted',
  pending: 'text-faint',
};

const STATUS_DOT: Record<BeliefStatus, string> = {
  broken: 'bg-fired',
  'at-risk': 'bg-fired/55',
  unknown: 'bg-trust',
  holding: 'bg-line-strong',
  pending: 'bg-line',
};

const ORIGIN_LABEL: Record<Assumption['origin'], string> = {
  stated: 'You said this',
  implicit: "You never said this, but it has to be true",
};

const LOAD_LABEL: Record<Assumption['loadBearing'], string> = {
  high: 'the whole trade rests on it',
  medium: 'matters, but not fatal',
  low: 'minor',
};

/**
 * The answer, first and large, with the count of each verdict under it.
 *
 * Counted from the same beliefs the list renders, so the strip cannot
 * disagree with the rows below it. The old figures counted tripwires in one
 * place and assumptions in another, and printed "0 uncheckable" above a row
 * that said nothing could check it.
 */
export function BeliefVerdict({ beliefs, className }: { beliefs: Belief[]; className?: string }) {
  const total = beliefs.length;
  const count = (s: BeliefStatus) => beliefs.filter((b) => b.status === s).length;
  const broken = count('broken');
  const atRisk = count('at-risk');
  const unknown = count('unknown');
  const holding = count('holding');
  const unspoken = beliefs.filter((b) => b.assumption.origin === 'implicit').length;
  const blindAndLoadBearing = beliefs.filter(
    (b) => b.status === 'unknown' && b.assumption.loadBearing === 'high',
  ).length;

  const headline =
    broken > 0
      ? {
          tone: 'text-fired',
          text:
            broken === 1
              ? `One of the ${total} things this trade rests on has already broken.`
              : `${broken} of the ${total} things this trade rests on have already broken.`,
        }
      : atRisk > 0
        ? {
            tone: 'text-fired/80',
            text:
              atRisk === 1
                ? `Nothing has broken yet, but one of the ${total} things this trade rests on is close.`
                : `Nothing has broken yet, but ${atRisk} of the ${total} things this trade rests on are close.`,
          }
        : blindAndLoadBearing > 0
          ? {
              tone: 'text-trust',
              text:
                blindAndLoadBearing === 1
                  ? `Nothing has broken, but one belief the whole trade rests on cannot be checked by anything here.`
                  : `Nothing has broken, but ${blindAndLoadBearing} beliefs the whole trade rests on cannot be checked by anything here.`,
            }
          : {
              tone: 'text-text',
              text: `Nothing has broken. Every belief that can be measured has a number watching it.`,
            };

  const parts: Array<{ n: number; status: BeliefStatus; label: string }> = [
    { n: broken, status: 'broken', label: 'broken' },
    { n: atRisk, status: 'at-risk', label: 'at risk' },
    { n: unknown, status: 'unknown', label: "can't be checked" },
    { n: holding, status: 'holding', label: 'holding' },
  ];

  return (
    <div className={cn('animate-rise flex flex-col gap-4', className)}>
      <p
        className={cn(
          'max-w-[34ch] text-[1.55rem] font-medium leading-[1.25] tracking-[-0.01em]',
          headline.tone,
        )}
      >
        <Reveal text={headline.text} step={30} />
      </p>
      <div className="flex flex-col gap-1.5">
        <p className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-base">
          {parts
            .filter((p) => p.n > 0)
            .map((p) => (
              <span key={p.status} className="flex items-center gap-2">
                <span aria-hidden className={cn('size-[7px] rounded-full', STATUS_DOT[p.status])} />
                <span data-figure className={STATUS_TEXT[p.status]}>
                  {p.n}
                </span>
                <span className="text-muted">{p.label}</span>
              </span>
            ))}
        </p>
        {unspoken > 0 ? (
          <p className="text-sm text-faint">
            <span data-figure>{unspoken}</span> of the {total} are things you never wrote down. Your
            reasoning needs them anyway.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function BeliefRow({
  belief,
  evaluations,
  trends,
  uncoveredReason,
  index,
}: {
  belief: Belief;
  evaluations?: Evaluation[] | undefined;
  /** Each tripwire's movement since the previous check, by breaker id. Stored theses only. */
  trends?: Record<string, HealthDriver> | undefined;
  uncoveredReason?: string | undefined;
  index: number;
}) {
  const { assumption, status, breakers, health } = belief;
  const untestable = assumption.testability === 'none';
  const clause = health && !untestable ? BASIS_CLAUSE[health.basis] : null;

  return (
    <li
      className="animate-rise border-b border-line/60 py-5 first:pt-1 last:border-b-0"
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
    >
      <p className="flex items-center gap-2">
        <span aria-hidden className={cn('size-[7px] shrink-0 rounded-full', STATUS_DOT[status])} />
        <span
          className={cn('text-meta font-medium uppercase tracking-[0.14em]', STATUS_TEXT[status])}
        >
          {STATUS_WORD[status]}
          {status === 'pending' ? '…' : ''}
        </span>
      </p>

      <p
        className={cn(
          'mt-1.5 max-w-prose text-[1.05rem] leading-snug',
          status === 'holding' ? 'text-text/85' : 'text-text',
        )}
      >
        {assumption.statement}
      </p>
      <p className="mt-1 text-sm text-faint">
        {ORIGIN_LABEL[assumption.origin]} · {LOAD_LABEL[assumption.loadBearing]}
      </p>

      {clause ? (
        <p className={cn('mt-1.5 text-sm', STATUS_TEXT[status])}>
          {clause}
          {health?.directionUnknown && health.basis === 'proximity' ? ` (${UNKNOWN_DIRECTION})` : ''}
        </p>
      ) : null}

      <div className="mt-3 flex flex-col gap-3 border-l border-line pl-4">
        {untestable ? (
          <p className="max-w-prose text-base text-trust">
            Nothing this desk can read measures this.{' '}
            <span className="text-trust/75">
              {assumption.loadBearing === 'high'
                ? 'The whole trade leans on it, so you are carrying it on trust. Only you can settle it.'
                : 'It is yours to keep an eye on.'}
            </span>
          </p>
        ) : breakers.length > 0 ? (
          breakers.map((breaker) => (
            <TripwireRow
              key={breaker.id}
              inline
              breaker={breaker}
              evaluation={evaluations?.find((e) => e.breakerId === breaker.id)}
              {...(trends?.[breaker.id] ? { trend: trends[breaker.id] } : {})}
            />
          ))
        ) : status === 'pending' ? (
          <p className="text-base text-faint">Working out how to check this…</p>
        ) : (
          <p className="max-w-prose text-base text-trust/85">
            {uncoveredReason ??
              'This could be measured, but no tripwire was built for it, so nothing will warn you either way.'}
          </p>
        )}
      </div>
    </li>
  );
}

export function BeliefList({
  beliefs,
  breakerSet,
  evaluations,
  trends,
  className,
}: {
  beliefs: Belief[];
  breakerSet?: BreakerSet | undefined;
  evaluations?: Evaluation[] | undefined;
  /** Each tripwire's movement since the previous check, by breaker id. Stored theses only. */
  trends?: Record<string, HealthDriver> | undefined;
  className?: string;
}) {
  return (
    <div className={className}>
      <ol className="flex flex-col">
        {beliefs.map((belief, i) => (
          <BeliefRow
            key={belief.assumption.id}
            belief={belief}
            index={i}
            evaluations={evaluations}
            trends={trends}
            uncoveredReason={
              breakerSet?.uncovered.find((u) => u.assumptionId === belief.assumption.id)?.reason
            }
          />
        ))}
      </ol>
      <HowToRead />
    </div>
  );
}

/**
 * The teaching, folded away.
 *
 * It used to open every run as three paragraphs, which a first-time reader
 * needs once and a returning one skips forever. Folded, it costs one line.
 */
function HowToRead() {
  return (
    <details className="group mt-6 max-w-prose text-base text-muted">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm text-faint hover:text-muted [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={14}
          strokeWidth={1.5}
          aria-hidden
          className="transition-transform group-open:rotate-90"
        />
        How to read this
      </summary>
      <div className="mt-3 flex flex-col gap-3 pl-5">
        <p>
          Each line is something that has to be true for this trade to work: your reasoning, taken
          apart into the pieces it stands on.
        </p>
        <p>
          Some you wrote yourself. Others you never said, but the reasoning does not hold without
          them. Those deserve the most attention, because you cannot check a belief you did not know
          you had.
        </p>
        <p>
          Where a belief can be measured, it gets a tripwire: an exact number, read from a filing or
          a live price, that would tell you it has stopped being true. Where nothing can measure it,
          it says so rather than pretend.
        </p>
      </div>
    </details>
  );
}
