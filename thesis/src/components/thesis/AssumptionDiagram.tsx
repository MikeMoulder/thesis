'use client';

import { useEffect, useRef, useState } from 'react';

import type { Assumption, Decomposition } from '@/engine/decomposer/types';
import { PERCENT_METRICS, type BreakerSet, type ThesisBreaker } from '@/engine/breakers/types';
import { cn } from '@/lib/utils';

/**
 * The thesis as an actual diagram.
 *
 * The list version could be read, but it could not be SEEN — and the finding
 * that matters here is shaped, not written: some branches carry the trade and
 * stop dead. So the drawing carries three things at once:
 *
 *   node SIZE      how much of the trade rests on that assumption
 *   node COLOUR    amber where nothing can ever check it
 *   the TERMINAL   a tripwire it flows into, or a struck-through dead end
 *
 * Which means "the two biggest nodes lead nowhere" is legible before a single
 * word is read. The statements still live in the list below; this is the map,
 * not the territory.
 */

const INK = '#a8b0b6';
const FAINT = '#7b848a';
const LINE = '#2b3135';
const TEXT = '#f2f4f5';
const TRUST = '#e0a43c';
const CODE = '#a79ae0';

const ROW = 52;
const CLAIM_H = 30;

/** Node radius by how much the trade leans on it. Size IS the load scale. */
const RADIUS: Record<Assumption['loadBearing'], number> = {
  high: 8.5,
  medium: 6,
  low: 4.5,
};

function conditionLabel(breaker: ThesisBreaker): string {
  if (breaker.kind === 'event') return breaker.watchFor;
  const unit = PERCENT_METRICS.has(breaker.metric) ? '%' : '';
  return `${breaker.metric} ${breaker.operator} ${breaker.threshold}${unit}`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function AssumptionDiagram({
  decomposition,
  breakerSet,
  /** True while the tripwire pass is still running. See the outcome branch. */
  breakersPending = false,
  className,
}: {
  decomposition: Decomposition;
  breakerSet?: BreakerSet | undefined;
  breakersPending?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<string | null>(null);

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

  const assumptions = decomposition.assumptions;
  const breakers = breakerSet?.breakers ?? [];
  const height = CLAIM_H + 18 + assumptions.length * ROW;

  // Three columns: the spine, the assumption node, the outcome.
  const spineX = 16;
  const nodeX = 44;
  const outcomeX = Math.min(width * 0.46, 250);
  const narrow = width < 430;

  return (
    <div ref={ref} className={cn('w-full', className)}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${assumptions.length} assumptions supporting the claim. ${
          assumptions.filter((a) => a.testability === 'none').length
        } of them cannot be checked by any available data.`}
      >
        {/* the claim everything hangs from */}
        <rect
          x={0}
          y={0}
          width={Math.max(160, Math.min(width, 430))}
          height={CLAIM_H}
          rx={7}
          fill="#14171a"
          stroke={LINE}
        />
        <text x={12} y={12.5} fontSize={9} fill={FAINT} letterSpacing="0.12em">
          YOUR BET
        </text>
        <text x={12} y={24} fontSize={11.5} fill={TEXT}>
          {truncate(
            decomposition.claims[0]?.statement ?? decomposition.thesis,
            Math.max(18, Math.floor(Math.min(width, 430) / 6.6)),
          )}
        </text>

        {/* spine */}
        <path
          d={`M${spineX},${CLAIM_H} V${CLAIM_H + 18 + (assumptions.length - 1) * ROW + ROW / 2}`}
          stroke={LINE}
          strokeWidth={1.5}
          fill="none"
          pathLength={1}
          className="animate-draw"
          style={{ animationDelay: '60ms', animationDuration: '620ms' }}
        />

        {assumptions.map((assumption, i) => {
          const y = CLAIM_H + 18 + i * ROW + ROW / 2 - 12;
          const untestable = assumption.testability === 'none';
          const covering = breakers.filter((b) => b.assumptionRef === assumption.id);
          const dim = hover !== null && hover !== assumption.id;
          const accent = untestable ? TRUST : INK;

          return (
            <g
              key={assumption.id}
              opacity={dim ? 0.3 : 1}
              style={{ transition: 'opacity .18s ease' }}
              onPointerEnter={() => setHover(assumption.id)}
              onPointerLeave={() => setHover(null)}
            >
              {/* branch out of the spine, curved so it reads as a flow */}
              <path
                d={`M${spineX},${y - 12} q0,12 12,12 H${nodeX - RADIUS[assumption.loadBearing]}`}
                stroke={LINE}
                strokeWidth={1.5}
                fill="none"
                pathLength={1}
                className="animate-draw"
                style={{ animationDelay: `${420 + i * 130}ms` }}
              />

              {/* the assumption: size is load, colour is whether it can be checked */}
              <circle
                cx={nodeX}
                cy={y}
                r={RADIUS[assumption.loadBearing]}
                fill={untestable ? TRUST : '#14171a'}
                stroke={untestable ? TRUST : INK}
                strokeWidth={1.5}
                className="animate-fade"
                style={{ animationDelay: `${560 + i * 130}ms`, animationDuration: '320ms' }}
              />
              <text
                x={nodeX + RADIUS[assumption.loadBearing] + 7}
                y={y + 4}
                fontSize={11}
                fill={accent}
                fontFamily="var(--font-mono)"
              >
                {assumption.id}
              </text>

              {/* the run to its outcome */}
              {/*
                The run to the outcome draws AFTER its node appears, so the eye
                follows the branch out to whatever it reaches — or to the point
                where it stops. An untestable one keeps its dashed styling, so it
                fades in rather than drawing (the dash pattern is already doing
                work and cannot also carry the draw).
              */}
              <path
                d={`M${nodeX + RADIUS[assumption.loadBearing] + 26},${y} H${outcomeX - 10}`}
                stroke={untestable ? TRUST : LINE}
                strokeWidth={1.5}
                strokeDasharray={untestable ? '3 3' : undefined}
                opacity={untestable ? 0.5 : 1}
                fill="none"
                {...(untestable
                  ? {}
                  : { pathLength: 1, className: 'animate-draw' })}
                style={{
                  animationDelay: `${660 + i * 130}ms`,
                  animationDuration: untestable ? '320ms' : '420ms',
                  ...(untestable ? { animation: `thesis-fade 320ms ease ${660 + i * 130}ms both` } : {}),
                }}
              />

              {untestable ? (
                <>
                  {/* a dead end, drawn as one — the line is cut, not merely absent */}
                  <line
                    x1={outcomeX - 6}
                    y1={y - 7}
                    x2={outcomeX + 6}
                    y2={y + 7}
                    stroke={TRUST}
                    strokeWidth={2}
                    strokeLinecap="round"
                    pathLength={1}
                    className="animate-draw"
                    style={{ animationDelay: `${980 + i * 130}ms`, animationDuration: '260ms' }}
                  />
                  <line
                    x1={outcomeX - 6}
                    y1={y + 7}
                    x2={outcomeX + 6}
                    y2={y - 7}
                    stroke={TRUST}
                    strokeWidth={2}
                    strokeLinecap="round"
                    pathLength={1}
                    className="animate-draw"
                    style={{ animationDelay: `${1080 + i * 130}ms`, animationDuration: '260ms' }}
                  />
                  {!narrow ? (
                    <text
                      x={outcomeX + 16}
                      y={y + 4}
                      fontSize={12}
                      fill={TRUST}
                      className="animate-fade"
                      style={{ animationDelay: `${1240 + i * 130}ms` }}
                    >
                      nothing can check this
                    </text>
                  ) : null}
                </>
              ) : covering.length > 0 ? (
                <g className="animate-fade" style={{ animationDelay: `${1020 + i * 130}ms` }}>
                  <circle cx={outcomeX} cy={y} r={4} fill={CODE} />
                  <text
                    x={outcomeX + 12}
                    y={y + 4}
                    fontSize={11}
                    fill={CODE}
                    fontFamily="var(--font-mono)"
                  >
                    {truncate(conditionLabel(covering[0]!), narrow ? 16 : 28)}
                  </text>
                  {/* An assumption can carry more than one tripwire. Saying so
                      keeps this picture consistent with the count above it. */}
                  {covering.length > 1 ? (
                    <text
                      x={outcomeX + 12}
                      y={y + 16}
                      fontSize={10}
                      fill={FAINT}
                    >
                      + {covering.length - 1} more on this one
                    </text>
                  ) : null}
                </g>
              ) : (
                <>
                  {/*
                    "Still working it out" and "we tried and produced nothing"
                    are different facts. Printing the second while the tripwire
                    pass is still running claims a negative result before it has
                    been reached.
                  */}
                  <circle cx={outcomeX} cy={y} r={4} fill="none" stroke={LINE} strokeWidth={1.5} />
                  {!narrow ? (
                    <text
                      x={outcomeX + 12}
                      y={y + 4}
                      fontSize={12}
                      fill={FAINT}
                      className={breakersPending ? 'animate-breathe' : undefined}
                    >
                      {breakersPending ? 'working out how to check this…' : 'no tripwire built'}
                    </text>
                  ) : null}
                </>
              )}
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-faint">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="block size-[9px] rounded-full border border-muted" />
          bigger circle = more of the trade rests on it
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="text-trust">
            ✕
          </span>
          nothing can check it
        </span>
      </div>
    </div>
  );
}
