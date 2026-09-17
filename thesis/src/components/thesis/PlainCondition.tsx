'use client';

import { Define } from '@/components/prose/Define';
import { PERCENT_METRICS, type Operator, type ThesisBreaker } from '@/engine/breakers/types';
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
function phrase(metric: string, operator: Operator, threshold: number): string {
  if (metric === 'drawdownFromHigh') {
    return operator === '<' || operator === '<='
      ? `falls more than ${Math.abs(threshold)}% below its high`
      : `recovers to within ${Math.abs(threshold)}% of its high`;
  }

  const unit = PERCENT_METRICS.has(metric as never) ? '%' : '';
  const level = `${threshold}${unit}`;

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
