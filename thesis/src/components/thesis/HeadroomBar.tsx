'use client';

import { formatValue } from '@/engine/breakers/evaluate';
import { PERCENT_METRICS, type Metric } from '@/engine/breakers/types';
import { cn } from '@/lib/utils';

/**
 * How close the current reading is to tripping, as something you can see.
 *
 * "4.98 points of headroom" is a number the reader has to hold in their head and
 * compare against a threshold they also have to hold in their head. The gap
 * between two marks on a track is the same fact, understood at a glance.
 *
 * THE SCALE IS THE HONEST PART. The track spans zero to twice the threshold, so
 * the threshold always sits at the midpoint and the reading lands wherever it
 * truly falls relative to it. That keeps bars comparable between tripwires —
 * a scale that zoomed to fit each gap would make every one look identical, which
 * is precisely the information the bar exists to carry.
 */
export function HeadroomBar({
  metric,
  observed,
  threshold,
  fired,
  className,
}: {
  metric: Metric;
  observed: number;
  threshold: number;
  fired: boolean;
  className?: string;
}) {
  const negative = threshold < 0 || observed < 0;
  /*
    Scale from whichever of the two is further from zero, not from the threshold
    alone. A threshold of 0 — "if operating income falls below 0" is a perfectly
    ordinary tripwire — made `|threshold| * 2` collapse to nothing, and both ends
    of the axis printed "0". Taking the observation into account always leaves a
    real range to draw on.
  */
  const span = Math.max(Math.abs(threshold), Math.abs(observed)) * 2 || 1;

  // Domain runs toward zero for negative metrics (drawdown), away from it
  // otherwise. Either way the threshold lands at the middle.
  const toPercent = (value: number): number => {
    const position = negative ? (value + span) / span : value / span;
    return Math.min(100, Math.max(0, position * 100));
  };

  const thresholdPos = toPercent(threshold);
  const observedPos = toPercent(observed);
  const unit = PERCENT_METRICS.has(metric) ? '%' : '';
  // Axis ends are context, not readings — whole numbers. The threshold keeps its
  // precision, because that one is an actual figure the reader may check.
  const edge = (value: number) =>
    unit ? `${Math.round(value)}${unit}` : formatValue(metric, value);

  const from = Math.min(thresholdPos, observedPos);
  const width = Math.abs(thresholdPos - observedPos);

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="relative h-[22px] w-full max-w-sm">
        {/* track */}
        <div className="absolute inset-x-0 top-[10px] h-px bg-line-strong" />

        {/* the gap that still has to be crossed */}
        <div
          className={cn(
            'animate-grow absolute top-[8px] h-[5px] rounded-full',
            fired ? 'bg-fired/40' : 'bg-muted/30',
          )}
          style={{ left: `${from}%`, width: `${width}%` }}
        />

        {/* the line that would trip it */}
        <div
          className="absolute top-[3px] h-[15px] w-[2px] -translate-x-1/2 rounded-full bg-code"
          style={{ left: `${thresholdPos}%` }}
          aria-hidden
        />

        {/* where it actually is */}
        <div
          className={cn(
            'animate-settle absolute top-[5px] size-[11px] -translate-x-1/2 rounded-full border-2 border-ground',
            fired ? 'bg-fired' : 'bg-text',
          )}
          style={{ left: `${observedPos}%` }}
          aria-hidden
        />
      </div>

      <div className="flex max-w-sm justify-between text-meta text-faint">
        <span data-num>{negative ? edge(-span) : edge(0)}</span>
        <span className="text-code" data-num>
          trips at {formatValue(metric, threshold)}
        </span>
        <span data-num>{negative ? edge(0) : edge(span)}</span>
      </div>
    </div>
  );
}
