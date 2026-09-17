'use client';

import { CountUp, Reveal } from '@/components/prose/Reveal';
import type { Evaluation } from '@/engine/breakers/evaluate';
import type { BreakerSet } from '@/engine/breakers/types';
import type { Decomposition } from '@/engine/decomposer/types';
import { cn } from '@/lib/utils';

/**
 * The finding, first and large.
 *
 * The earlier layout put the tree, then the tripwires, then the base rates, and
 * only then what any of it meant — every section the same weight, the answer
 * last. A reader had to assemble the conclusion themselves from four sections of
 * evidence, which is the opposite of what a research tool is for.
 *
 * So: the headline says what was found, a row of figures gives it scale, and the
 * evidence sits underneath for anyone who wants to check the working.
 *
 * It is DERIVED, never generated. A model writing the headline would eventually
 * write something the numbers do not support, and this is the one line on the
 * page most likely to be read and repeated.
 */

interface Headline {
  text: string;
  tone: 'trust' | 'fired' | 'plain';
}

function headlineFor(
  decomposition: Decomposition,
  breakerSet?: BreakerSet,
  evaluations?: Evaluation[],
): Headline {
  const fired = (evaluations ?? []).filter((e) => e.status === 'fired');
  if (fired.length > 0) {
    return {
      tone: 'fired',
      text:
        fired.length === 1
          ? 'One of your tripwires has already been crossed. Something you are counting on is no longer true.'
          : `${fired.length} of your tripwires have already been crossed. Things you are counting on are no longer true.`,
    };
  }

  const blind = decomposition.summary.unfalsifiableLoadBearing.length;
  const total = decomposition.summary.assumptionCount;
  if (blind > 0) {
    /*
      This used to read "One of the 5 things this trade rests on cannot be
      checked by anything here", which states a fact and leaves the reader to
      work out the consequence. The consequence IS the finding: if it breaks,
      nobody tells you. Say that instead.
    */
    return {
      tone: 'trust',
      text:
        blind === 1
          ? `Your reasoning rests on ${total} things. One of them could break without anything here noticing.`
          : `Your reasoning rests on ${total} things. ${blind} of them could break without anything here noticing.`,
    };
  }

  if (breakerSet && breakerSet.breakers.length > 0) {
    return {
      tone: 'plain',
      text: `Everything this trade rests on now has a number watching it. None have been crossed.`,
    };
  }

  return { tone: 'plain', text: 'Your thesis has been taken apart.' };
}

function Stat({
  value,
  label,
  tone,
}: {
  value: number | string;
  label: string;
  tone?: 'trust';
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className={cn('text-xl leading-none', tone === 'trust' ? 'text-trust' : 'text-text')}>
        {typeof value === 'number' ? <CountUp value={value} decimals={0} duration={520} /> : value}
      </span>
      <span
        className={cn(
          'text-meta uppercase leading-tight tracking-[0.1em]',
          tone === 'trust' ? 'text-trust/75' : 'text-faint',
        )}
      >
        {label}
      </span>
    </div>
  );
}

export function RunHeadline({
  decomposition,
  breakerSet,
  evaluations,
  className,
}: {
  decomposition: Decomposition;
  breakerSet?: BreakerSet | undefined;
  evaluations?: Evaluation[] | undefined;
  className?: string;
}) {
  const headline = headlineFor(decomposition, breakerSet, evaluations);
  const summary = decomposition.summary;
  const blind = summary.unfalsifiableLoadBearing.length;

  return (
    <div className={cn('animate-rise flex flex-col gap-5', className)}>
      <p
        className={cn(
          'max-w-[34ch] text-[1.55rem] font-medium leading-[1.25] tracking-[-0.01em]',
          headline.tone === 'trust'
            ? 'text-trust'
            : headline.tone === 'fired'
              ? 'text-fired'
              : 'text-text',
        )}
      >
        <Reveal text={headline.text} step={30} />
      </p>

      {/*
        Four bare numbers with four-word labels read as a scoreboard whose rules
        nobody explained. The labels now say what each number is a count OF, and
        the line underneath states how they relate, because the unanswered
        question was whether these were four separate groups or slices of one.
      */}
      <div className="flex flex-wrap gap-x-9 gap-y-4">
        <Stat value={summary.assumptionCount} label="things it rests on" />
        <Stat value={summary.implicitCount} label="of those, unspoken" />
        <Stat
          value={blind}
          label="of those, uncheckable"
          {...(blind > 0 ? { tone: 'trust' as const } : {})}
        />
        {breakerSet ? (
          <Stat value={breakerSet.breakers.length} label="numbers now watching" />
        ) : null}
      </div>

      <p className="max-w-prose text-base text-muted">
        Read that as: your reasoning depends on{' '}
        <span data-figure>{summary.assumptionCount}</span> separate things being true.{' '}
        <span data-figure>{summary.implicitCount}</span> of them you never actually wrote down,{' '}
        {blind > 0 ? (
          <>
            and <span data-figure>{blind}</span> of them cannot be measured by any data this desk
            can reach.
          </>
        ) : (
          <>and every one of them can be measured.</>
        )}{' '}
        {breakerSet
          ? `The rest now have a specific number attached, so you find out from the data instead of from the price.`
          : ''}
      </p>
    </div>
  );
}
