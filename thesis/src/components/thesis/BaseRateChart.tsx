'use client';

import { useEffect, useRef, useState } from 'react';

import type { HistoricalEvidence } from '@/engine/breakers/evaluate';
import { PERCENT_METRICS, type ThesisBreaker } from '@/engine/breakers/types';
import { cn } from '@/lib/utils';

/**
 * What happened the other times this condition was true.
 *
 * This is the strongest evidence the project produces, and it exists because a
 * count cannot make the point on its own. "26 prior occurrences" sounds like a
 * warning; seeing the threshold line sitting in the middle of ten years of
 * normal readings shows that the tripwire was never unusual at all. The picture
 * is the argument.
 *
 * Two panels, two different jobs:
 *   1. the metric over time against its threshold  — was this ever abnormal?
 *   2. forward returns after each occurrence       — did it matter?
 *
 * Colour follows the job, not decoration. The series is ink. The threshold is
 * violet, the same colour the condition wears everywhere else in the product.
 * Forward returns are a diverging pair around zero — the existing red and blue
 * tokens, which pass CVD separation (ΔE 24.7 protan, 30.5 normal-vision) so the
 * sign is legible without colour vision, and is labelled anyway.
 */

const INK = '#a8b0b6';
const FAINT = '#7b848a';
const LINE = '#2b3135';
const CODE = '#a79ae0';
const NEG = '#e5484d';
const POS = '#5b8def';

interface Box {
  width: number;
  height: number;
}

/**
 * Render the SVG at true pixel size rather than scaling a fixed viewBox.
 *
 * A scaled viewBox shrinks the labels with it — at phone width an 11px label
 * becomes 6px and the chart stops being readable exactly where it is hardest to
 * read already.
 */
function useWidth(fallback: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

function fmt(value: number, percent: boolean): string {
  return `${value.toFixed(percent ? 1 : 2)}${percent ? '%' : ''}`;
}

function year(iso: string): string {
  return iso.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Panel 1 — the metric against its threshold
// ---------------------------------------------------------------------------

function SeriesPanel({
  evidence,
  breaker,
  box,
}: {
  evidence: HistoricalEvidence;
  breaker: ThesisBreaker;
  box: Box;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const percent = PERCENT_METRICS.has(evidence.metric);
  const threshold = breaker.kind === 'threshold' ? breaker.threshold : 0;
  const points = evidence.series;

  const pad = { top: 14, right: 58, bottom: 20, left: 8 };
  const plotW = Math.max(40, box.width - pad.left - pad.right);
  const plotH = Math.max(40, box.height - pad.top - pad.bottom);

  const values = points.map((p) => p.value).concat(threshold);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  // A little headroom so the threshold line never sits on the frame edge.
  const lo = min - span * 0.08;
  const hi = max + span * 0.08;

  const x = (i: number) => pad.left + (i / Math.max(1, points.length - 1)) * plotW;
  const y = (v: number) => pad.top + (1 - (v - lo) / (hi - lo)) * plotH;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`).join(' ');
  const thresholdY = y(threshold);
  const active = hover === null ? null : points[hover];

  return (
    <svg
      width={box.width}
      height={box.height}
      role="img"
      aria-label={`${evidence.metric} across ${evidence.windowDescription}, against a threshold of ${threshold}. ${evidence.occurrences.length} occurrences.`}
      onPointerLeave={() => setHover(null)}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const px = event.clientX - rect.left - pad.left;
        const index = Math.round((px / plotW) * (points.length - 1));
        setHover(index >= 0 && index < points.length ? index : null);
      }}
    >
      {/* the region in which the condition is true */}
      <rect
        x={pad.left}
        y={breaker.kind === 'threshold' && breaker.operator.startsWith('<') ? thresholdY : pad.top}
        width={plotW}
        height={
          breaker.kind === 'threshold' && breaker.operator.startsWith('<')
            ? Math.max(0, pad.top + plotH - thresholdY)
            : Math.max(0, thresholdY - pad.top)
        }
        fill={NEG}
        opacity={0.035}
      />

      <line
        x1={pad.left}
        x2={pad.left + plotW}
        y1={thresholdY}
        y2={thresholdY}
        stroke={CODE}
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <text
        x={pad.left + plotW + 6}
        y={thresholdY + 3.5}
        fill={CODE}
        fontSize={10}
        fontFamily="var(--font-mono)"
      >
        {fmt(threshold, percent)}
      </text>

      <path d={path} fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" />

      {/*
        Keyed by index, not date. Several reported periods can become knowable on
        the same day — a 10-K restates prior years — so dates are NOT unique in
        the series. They are unique in `occurrences`, which is collapsed; the
        series deliberately is not, because each point is a real distinct period.
      */}
      {points.map((p, i) =>
        p.fired ? (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={3} fill={NEG} />
        ) : null,
      )}

      {active ? (
        <>
          <line
            x1={x(hover!)}
            x2={x(hover!)}
            y1={pad.top}
            y2={pad.top + plotH}
            stroke={LINE}
            strokeWidth={1}
          />
          <circle
            cx={x(hover!)}
            cy={y(active.value)}
            r={4.5}
            fill={active.fired ? NEG : INK}
            stroke="#08090a"
            strokeWidth={2}
          />
          <text
            x={Math.min(x(hover!) + 8, pad.left + plotW - 60)}
            y={pad.top + 9}
            fill="#f2f4f5"
            fontSize={11}
            fontFamily="var(--font-mono)"
          >
            {fmt(active.value, percent)}
            <tspan fill={FAINT}> {active.date}</tspan>
          </text>
        </>
      ) : null}

      <text x={pad.left} y={box.height - 6} fill={FAINT} fontSize={10}>
        {year(points[0]?.date ?? '')}
      </text>
      <text x={pad.left + plotW} y={box.height - 6} fill={FAINT} fontSize={10} textAnchor="end">
        {year(points[points.length - 1]?.date ?? '')}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Panel 2 — what followed
// ---------------------------------------------------------------------------

function ForwardPanel({ evidence, box }: { evidence: HistoricalEvidence; box: Box }) {
  const [hover, setHover] = useState<number | null>(null);

  const rows = evidence.occurrences
    .map((o) => ({ date: o.date, value: o.forward90d }))
    .filter((r): r is { date: string; value: number } => r.value !== null);

  if (rows.length === 0) return null;

  // Top padding has to clear the median label drawn above the strip; at 16 it
  // was rendering off the top of the SVG and being clipped.
  const pad = { top: 28, right: 8, bottom: 18, left: 8 };
  const plotW = Math.max(40, box.width - pad.left - pad.right);
  const magnitude = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  const x = (v: number) => pad.left + ((v + magnitude) / (2 * magnitude)) * plotW;
  const mid = pad.top + 6;
  const median = evidence.medianForward90d;
  const active = hover === null ? null : rows[hover];

  return (
    <svg
      width={box.width}
      height={box.height}
      role="img"
      aria-label={`90-day forward return after each of the ${rows.length} occurrences. Median ${median?.toFixed(1) ?? 'unavailable'} percent.`}
      onPointerLeave={() => setHover(null)}
    >
      <line x1={pad.left} x2={pad.left + plotW} y1={mid} y2={mid} stroke={LINE} strokeWidth={1} />
      <line x1={x(0)} x2={x(0)} y1={mid - 11} y2={mid + 11} stroke={FAINT} strokeWidth={1} />
      <text x={x(0)} y={box.height - 5} fill={FAINT} fontSize={10} textAnchor="middle">
        0%
      </text>

      {rows.map((row, i) => (
        <circle
          key={`${row.date}-${i}`}
          cx={x(row.value)}
          cy={mid}
          r={hover === i ? 6 : 4.5}
          fill={row.value < 0 ? NEG : POS}
          stroke="#08090a"
          strokeWidth={2}
          opacity={0.9}
          onPointerEnter={() => setHover(i)}
          style={{ cursor: 'pointer' }}
        />
      ))}

      {median !== null ? (
        <>
          <line
            x1={x(median)}
            x2={x(median)}
            y1={mid - 15}
            y2={mid + 15}
            stroke={median < 0 ? NEG : POS}
            strokeWidth={2}
          />
          <text
            x={x(median)}
            y={mid - 20}
            fill={median < 0 ? NEG : POS}
            fontSize={11}
            fontFamily="var(--font-mono)"
            textAnchor="middle"
          >
            median {median > 0 ? '+' : ''}
            {median.toFixed(1)}%
          </text>
        </>
      ) : null}

      {active ? (
        <text
          x={Math.min(Math.max(x(active.value), 44), pad.left + plotW - 44)}
          y={box.height - 5}
          fill="#f2f4f5"
          fontSize={11}
          fontFamily="var(--font-mono)"
          textAnchor="middle"
        >
          {active.value > 0 ? '+' : ''}
          {active.value.toFixed(1)}% <tspan fill={FAINT}>{active.date}</tspan>
        </text>
      ) : null}
    </svg>
  );
}

// ---------------------------------------------------------------------------

export function BaseRateChart({
  evidence,
  breaker,
  className,
}: {
  evidence: HistoricalEvidence;
  breaker: ThesisBreaker;
  className?: string;
}) {
  const [ref, width] = useWidth(620);
  const percent = PERCENT_METRICS.has(evidence.metric);
  const demoted =
    evidence.measuredSeverity !== null && evidence.measuredSeverity !== breaker.severity;

  return (
    <div ref={ref} className={cn('flex flex-col gap-1', className)}>
      <p className="text-meta uppercase tracking-[0.12em] text-faint">
        {evidence.metric} · {evidence.windowDescription}
      </p>

      {evidence.series.length > 1 ? (
        <SeriesPanel evidence={evidence} breaker={breaker} box={{ width, height: 150 }} />
      ) : null}

      {evidence.occurrences.length > 0 ? (
        <>
          <p className="mt-3 text-meta uppercase tracking-[0.12em] text-faint">
            90 days after each occurrence
          </p>
          <ForwardPanel evidence={evidence} box={{ width, height: 74 }} />
        </>
      ) : null}

      <p className="mt-2 max-w-prose text-sm text-muted">{evidence.note}</p>

      {demoted ? (
        <p className="max-w-prose text-sm text-text">
          Severity was <span className="text-faint">{breaker.severity} (inherited)</span> and the
          record makes it <span data-figure>{evidence.measuredSeverity}</span>, measured from{' '}
          <span data-figure>{evidence.occurrences.length}</span> occurrences rather than assumed.
        </p>
      ) : null}

      {/* The table is the accessible reading of both panels, not a duplicate. */}
      {evidence.occurrences.length > 0 ? (
        <details className="group mt-2">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-sm text-muted marker:content-none hover:text-text">
            <span aria-hidden className="text-faint transition-transform group-open:rotate-90">
              ›
            </span>
            Every occurrence
          </summary>
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr className="text-meta uppercase tracking-[0.12em] text-faint">
                <th className="py-1 font-normal">Knowable</th>
                <th className="py-1 font-normal">Value</th>
                <th className="py-1 text-right font-normal">30d</th>
                <th className="py-1 text-right font-normal">90d</th>
              </tr>
            </thead>
            <tbody>
              {evidence.occurrences.map((o, i) => (
                <tr key={`${o.date}-${i}`} className="border-t border-line/60 text-muted">
                  <td data-figure className="py-1">
                    {o.date}
                  </td>
                  <td data-figure className="py-1">
                    {fmt(o.value, percent)}
                  </td>
                  <td data-figure className="py-1 text-right">
                    {o.forward30d === null ? '—' : `${o.forward30d > 0 ? '+' : ''}${o.forward30d.toFixed(1)}%`}
                  </td>
                  <td data-figure className="py-1 text-right">
                    {o.forward90d === null ? '—' : `${o.forward90d > 0 ? '+' : ''}${o.forward90d.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </div>
  );
}
