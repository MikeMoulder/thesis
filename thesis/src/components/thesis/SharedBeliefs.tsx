'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, Link2 } from 'lucide-react';

import type { OverlapGroup, OverlapResult } from '@/engine/overlap';
import { cn } from '@/lib/utils';

import { TickerMark } from './TickerMark';
import { HEALTH_TEXT, HEALTH_WORD } from './health-text';

/**
 * What the theses on file have in common, under the list of them.
 *
 * Each thesis page looks at one position. This is the only view that reads
 * them side by side, and it exists for two findings a single thesis cannot
 * show: two positions resting on the same outside driver, so one surprise
 * breaks both, and two positions needing opposite things, so at least one of
 * them is wrong.
 *
 * Fetched after the page renders. The first request for a new set of theses
 * waits on a model; every one after that is a cache read.
 */

const RELATION: Record<
  OverlapGroup['relation'],
  { label: string; lead: string; Icon: typeof Link2 }
> = {
  opposed: {
    label: 'Pulling against each other',
    lead: 'These need opposite things. They cannot both be right.',
    Icon: ArrowLeftRight,
  },
  shared: {
    label: 'Exposed together',
    lead: 'These need the same thing. If it turns, they are hit at once.',
    Icon: Link2,
  },
};

type State = { phase: 'loading' } | { phase: 'done'; result: OverlapResult } | { phase: 'failed' };

function Group({ group }: { group: OverlapGroup }) {
  const relation = RELATION[group.relation];
  const tickers = [...new Set(group.members.map((m) => m.ticker))];

  return (
    <li className="border-b border-line/60 py-5 last:border-b-0">
      <p className="flex items-center gap-2 text-meta uppercase tracking-[0.14em] text-muted">
        <relation.Icon size={13} strokeWidth={1.75} aria-hidden />
        {relation.label}
        <span className="text-faint">· {tickers.join(', ')}</span>
      </p>
      <p className="mt-1.5 text-[1.05rem] text-text">{group.theme}</p>
      <p className="mt-1 max-w-prose text-base text-muted">
        {group.why || relation.lead}
      </p>

      <ul className="mt-3 flex flex-col gap-2 border-l border-line pl-4">
        {group.members.map((m) => (
          <li key={`${m.thesisId}.${m.assumptionId}`}>
            <Link
              href={`/thesis/${m.thesisId}`}
              className="group flex items-start gap-2.5 rounded-md text-sm transition-colors"
            >
              <TickerMark ticker={m.ticker} size="title" />
              <span className="min-w-0 flex-1 leading-snug text-muted transition-colors group-hover:text-text">
                {m.statement}
              </span>
              {m.health ? (
                <span
                  className={cn(
                    'shrink-0 pt-px text-meta uppercase tracking-[0.12em]',
                    HEALTH_TEXT[m.health],
                  )}
                >
                  {HEALTH_WORD[m.health]}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function SharedBeliefs({ className }: { className?: string }) {
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    let live = true;
    fetch('/api/overlap')
      .then((r) => (r.ok ? (r.json() as Promise<OverlapResult>) : Promise.reject(r.status)))
      .then((result) => live && setState({ phase: 'done', result }))
      .catch(() => live && setState({ phase: 'failed' }));
    return () => {
      live = false;
    };
  }, []);

  // Nothing to say is said by saying nothing. A failed fetch is not the
  // reader's problem on a page that is about their theses, not this section.
  if (state.phase === 'failed') return null;
  if (state.phase === 'done' && state.result.groups.length === 0) return null;

  return (
    <section className={className} aria-label="What your theses have in common">
      <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-strong pb-3">
        <span className="text-meta uppercase tracking-[0.14em] text-muted">
          What your theses have in common
        </span>
        {state.phase === 'done' ? (
          <span data-figure className="text-sm text-faint">
            {state.result.groups.length}
          </span>
        ) : null}
      </div>

      {state.phase === 'loading' ? (
        <p className="mt-4 text-sm text-faint">Reading your theses side by side…</p>
      ) : (
        <>
          <ul className="mt-1">
            {state.result.groups.map((group) => (
              <Group key={group.theme + group.members.length} group={group} />
            ))}
          </ul>
          <p className="mt-4 max-w-prose text-sm text-faint">
            {state.result.source === 'model'
              ? 'Grouped by a model reading every belief across your theses. Which way each position needs a driver to move is read per belief, and whether they pull together or apart is worked out from that, not guessed.'
              : 'Grouped from the tripwires alone; the model that reads across theses was unavailable.'}
          </p>
        </>
      )}
    </section>
  );
}
