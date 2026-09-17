'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { CitationChip } from '@/components/evidence/CitationChip';
import { Reveal } from '@/components/prose/Reveal';
import { formatValue, type Evaluation } from '@/engine/breakers/evaluate';
import type { Metric } from '@/engine/breakers/types';
import { defineMetric } from '@/lib/glossary';
import { cn } from '@/lib/utils';

/**
 * The preset stress tests, as a reader sees them.
 *
 * ## What this screen is arguing
 *
 * Not "here are six scenarios". The finding is which shocks this particular
 * thesis does not survive, so the rows are ordered by damage and the ones that
 * broke something come first. A panel in preset order would bury the answer in
 * the middle of a list.
 *
 * ## Why survivals are still shown
 *
 * A stress test that changes nothing is evidence, and hiding it would make the
 * panel a list of bad news rather than a test. "Volatility doubling does not
 * touch any of your tripwires" is worth knowing, and it is also the honest
 * context that makes the two that DID fire mean something.
 *
 * ## No green, as everywhere else
 *
 * Surviving a shock earns no colour. A thesis that has not broken yet is the
 * default state, and congratulating it is the opposite of the point.
 */

export interface StressRow {
  id: string;
  label: string;
  question: string;
  rationale: string;
  scenario: Partial<Record<Metric, number>>;
  summary: string;
  firedCount: number;
  evaluations: Evaluation[];
}

export interface StressSkip {
  id: string;
  label: string;
  reason: string;
}

export interface StressPanelProps {
  rows: StressRow[];
  skipped: StressSkip[];
  current: Partial<Record<Metric, number>>;
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('text-meta uppercase tracking-[0.14em] text-faint', className)}>
      {children}
    </span>
  );
}

/**
 * "gross margin 75 to 65" rather than "grossMargin 75 to 65".
 *
 * The API sends the machine summary, which is correct for a log and wrong for
 * a person. Names come from the glossary so the panel says what the rest of
 * the product says, and the FROM value is kept because a number only alarms
 * you when you can see how far it moved.
 */
function describeMove(
  scenario: Partial<Record<Metric, number>>,
  current: Partial<Record<Metric, number>>,
): string {
  return (Object.entries(scenario) as Array<[Metric, number]>)
    .map(([metric, to]) => {
      const name = defineMetric(metric)?.label ?? metric;
      const from = current[metric];
      return from === undefined
        ? `${name} to ${formatValue(metric, to)}`
        : `${name} ${formatValue(metric, from)} to ${formatValue(metric, to)}`;
    })
    .join(', ');
}

function StressRowView({
  row,
  current,
}: {
  row: StressRow;
  current: Partial<Record<Metric, number>>;
}) {
  const [open, setOpen] = useState(row.firedCount > 0);
  const fired = row.evaluations.filter((e) => e.status === 'fired');
  const broke = row.firedCount > 0;

  return (
    <div className="border-t border-line py-4 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full items-baseline gap-3 text-left"
        aria-expanded={open}
      >
        <ChevronRight
          className={cn(
            'mt-1 size-3.5 shrink-0 text-faint transition-transform',
            open && 'rotate-90',
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block text-base text-text">{row.question}</span>
          <span className="mt-1 block font-mono text-meta text-faint">
            {describeMove(row.scenario, current)}
          </span>
        </span>
        <span
          className={cn(
            'shrink-0 text-sm tabular-nums',
            broke ? 'text-fired' : 'text-muted',
          )}
        >
          {broke
            ? `trips ${row.firedCount} ${row.firedCount === 1 ? 'tripwire' : 'tripwires'}`
            : 'nothing trips'}
        </span>
      </button>

      {open && (
        <div className="mt-3 pl-6">
          <p className="max-w-prose text-sm leading-relaxed text-muted">{row.rationale}</p>

          {fired.length > 0 && (
            <ul className="mt-3 space-y-2">
              {fired.map((evaluation) => (
                <li key={evaluation.breakerId} className="flex items-baseline gap-2 text-sm">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-fired" aria-hidden />
                  <span className="text-text">
                    {evaluation.metric ? (
                      <>
                        <span className="text-muted">
                          {defineMetric(evaluation.metric)?.label ?? evaluation.metric}
                        </span>{' '}
                        would read{' '}
                        <span className="font-mono text-fired">
                          {formatValue(evaluation.metric, evaluation.observed ?? 0)}
                        </span>{' '}
                        against a line at{' '}
                        <span className="font-mono">
                          {formatValue(evaluation.metric, evaluation.threshold ?? 0)}
                        </span>
                      </>
                    ) : (
                      evaluation.breakerId
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {!broke && (
            <p className="mt-3 text-sm text-faint">
              None of this thesis&rsquo;s tripwires respond to that shock. That is not the same as
              being safe from it, only that nothing here was set to watch for it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function StressPanel({ rows, skipped, current }: StressPanelProps) {
  // Damage first. The ordering IS the finding.
  const ordered = [...rows].sort((a, b) => b.firedCount - a.firedCount);
  const broke = ordered.filter((r) => r.firedCount > 0);

  return (
    <section className="mt-2">
      {/* No heading here: the block frame above already names this and says
          which instrument it is about, and repeating it reads as a bug. */}
      <header className="pb-3">
        <p className="max-w-prose text-base leading-relaxed text-text">
          {broke.length === 0 ? (
            <>
              None of {ordered.length} preset shocks trips a tripwire on this thesis. Every shock
              was measured from where the numbers actually sit today, not from round numbers.
            </>
          ) : (
            <>
              <Reveal
                className="text-fired"
                text={`${broke.length} of ${ordered.length}`}
              />{' '}
              preset shocks break something here. The worst is{' '}
              <span className="text-text">{broke[0]!.label.toLowerCase()}</span>.
            </>
          )}
        </p>
        <p className="mt-2 max-w-prose text-sm text-faint">
          These run against the tripwires already on this thesis, so they cost no model calls. A
          shock that trips nothing may simply mean nothing here was set to watch for it.
        </p>
      </header>

      <div>
        {ordered.map((row) => (
          <StressRowView key={row.id} row={row} current={current} />
        ))}
      </div>

      {skipped.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <Label>Could not run</Label>
          <ul className="mt-2 space-y-1">
            {skipped.map((s) => (
              <li key={s.id} className="text-sm text-trust">
                <span className="text-muted">{s.label}</span> &mdash; {s.reason}
              </li>
            ))}
          </ul>
          <p className="mt-2 max-w-prose text-sm text-faint">
            Listed rather than dropped. A panel quietly showing fewer rows would tell you this
            thesis survived a shock nobody applied.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <CitationChip
          provenance={{
            status: 'inferred',
            source: 'Stored tripwires evaluated against preset hypotheticals',
            confidence: 'high',
            derivation: 'no model calls; the live evaluator pointed at hypothetical values',
          }}
        />
      </div>
    </section>
  );
}
