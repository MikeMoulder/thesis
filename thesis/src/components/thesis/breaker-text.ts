import { PERCENT_METRICS, type ThesisBreaker } from '@/engine/breakers/types';

/**
 * Render a breaker's condition as the short, readable form used everywhere the
 * breaker is referenced: "grossMargin < 70%".
 *
 * Units come from PERCENT_METRICS rather than from a guess, because the sign
 * and unit conventions in METRIC_SEMANTICS are contractual. Printing a percent
 * metric without its "%" is how a reader ends up believing `drawdownFromHigh
 * <= -30` is dollars.
 */
export function breakerCondition(breaker: ThesisBreaker): string {
  if (breaker.kind === 'event') return breaker.watchFor;

  const unit = PERCENT_METRICS.has(breaker.metric) ? '%' : '';
  return `${breaker.metric} ${breaker.operator} ${breaker.threshold}${unit}`;
}
