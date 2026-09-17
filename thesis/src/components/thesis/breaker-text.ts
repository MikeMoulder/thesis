import { PERCENT_METRICS, type ThesisBreaker } from '@/engine/breakers/types';
import { metricPhrase } from '@/lib/glossary';

/**
 * A breaker's condition in its short form: "gross margin < 70%".
 *
 * The METRIC NAME is the glossary's, not the engine's. This used to print
 * `grossMargin < 70%`, and it was the last camel case left on the screen after
 * the identifiers went. The exact test is still exact: same operator, same
 * threshold, same unit. Only the property name becomes the words a person would
 * use for it, which costs the reader nothing and stops the line reading like
 * somebody else's source code.
 *
 * Units come from PERCENT_METRICS rather than from a guess, because the sign
 * and unit conventions in METRIC_SEMANTICS are contractual. Printing a percent
 * metric without its "%" is how a reader ends up believing a drawdown of -30 is
 * dollars.
 */
export function breakerCondition(breaker: ThesisBreaker): string {
  if (breaker.kind === 'event') return breaker.watchFor;

  const unit = PERCENT_METRICS.has(breaker.metric) ? '%' : '';
  return `${metricPhrase(breaker.metric)} ${breaker.operator} ${breaker.threshold}${unit}`;
}
