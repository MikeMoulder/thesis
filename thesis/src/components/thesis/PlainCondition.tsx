'use client';

import { Define } from '@/components/prose/Define';
import { formatValue } from '@/engine/breakers/evaluate';
import { PERCENT_METRICS, type Metric, type Operator, type ThesisBreaker } from '@/engine/breakers/types';
import { defineMetric } from '@/lib/glossary';
import { cn } from '@/lib/utils';

/**
 * A tripwire condition, written the way a person would say it.
 *
 * `grossMargin < 70%` is precise and unreadable. "if gross margin falls below
 * 70%" is the same fact in a sentence, with the unfamiliar term carrying its own
 * explanation. The machine form still exists — it is what the evaluator runs —
 * but it belongs beside the sentence, not instead of it.
 */

/**
 * Operator to English, in the direction that trips the wire.
 *
 * `drawdownFromHigh` is the awkward case: it is defined as zero-or-negative, so
 * "drawdown <= -30" reads naturally as "falls MORE than 30% below its high",
 * where a literal "is less than -30%" would send most readers the wrong way.
 */
function phrase(metric: Metric, operator: Operator, threshold: number): string {
  if (metric === 'drawdownFromHigh') {
    return operator === '<' || operator === '<='
      ? `falls more than ${Math.abs(threshold)}% below its high`
      : `recovers to within ${Math.abs(threshold)}% of its high`;
  }

  // Percentages as written ("55%", not "55.00%"). Everything else through
  // the shared formatter, so a depth line reads "$25.0K" and not "25000".
  const level = PERCENT_METRICS.has(metric) ? `${threshold}%` : formatValue(metric, threshold);

  switch (operator) {
    case '<':
      return `falls below ${level}`;
    case '<=':
      return `falls to ${level} or lower`;
    case '>':
      return `rises above ${level}`;
    case '>=':
      return `reaches ${level} or higher`;
  }
}

/** The same condition as plain text, for places that cannot hold a definition. */
export function plainConditionText(breaker: ThesisBreaker): string {
  if (breaker.kind === 'event') return breaker.watchFor;
  return `${defineMetric(breaker.metric).label} ${phrase(breaker.metric, breaker.operator, breaker.threshold)}`;
}

export function PlainCondition({
  breaker,
  className,
}: {
  breaker: ThesisBreaker;
  className?: string;
}) {
  if (breaker.kind === 'event') {
    return (
      <span className={cn('text-base text-text', className)}>
        if this is reported: {breaker.watchFor}
      </span>
    );
  }

  const definition = defineMetric(breaker.metric);

  return (
    <span className={cn('text-base text-text', className)}>
      if <Define definition={definition} />{' '}
      {phrase(breaker.metric, breaker.operator, breaker.threshold)}
    </span>
  );
}
