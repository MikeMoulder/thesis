'use client';

import { useCallback, useRef, useState } from 'react';

import { AnalysisBlock, BlockSection, type BlockStage } from '@/components/thesis/AnalysisBlock';
import { AssumptionTree } from '@/components/thesis/AssumptionTree';
import { BaseRateDisclosure } from '@/components/thesis/BaseRateDisclosure';
import { NextActions } from '@/components/thesis/NextActions';
import { ResearchBrief } from '@/components/thesis/ResearchBrief';
import { TripwireRow } from '@/components/thesis/TripwireRow';
import { Prose, Term } from '@/components/prose/emphasis';
import type { Evaluation } from '@/engine/breakers/evaluate';
import type { BreakerSet } from '@/engine/breakers/types';
import type { Decomposition } from '@/engine/decomposer/types';
import { deriveActions } from '@/engine/actions';
import { deriveBrief } from '@/engine/brief';
import type { ErrorKind, RunEvent, RunStageId } from '@/engine/run';
import { cn } from '@/lib/utils';

/**
 * Drives one live run and renders it as it arrives.
 *
 * Streaming is not decoration here. The assumption tree - the most valuable
 * part - is ready after the first stage, so waiting for the whole pipeline
 * would replace most of the run with a spinner for no reason.
 *
 * Production runs land around 7-10s; the same code takes 24-58s on a developer
 * machine because the VPN needed to reach Bitget also routes every model call.
 * Never tune this against local timings.
 */

/*
  The second opinion sits LAST because that is when it now finishes.

  It starts immediately after decompose and runs alongside the tripwires, so
  the run no longer waits on it. Showing it third would put a step that
  completes after everything else in the middle of the row, and a progress
  indicator that finishes out of order reads as a bug.
*/
const STAGE_ORDER: RunStageId[] = ['resolve', 'decompose', 'breakers', 'evaluate', 'challenge'];

const STAGE_LABEL: Record<RunStageId, string> = {
  resolve: 'resolve',
  decompose: 'decompose',
  challenge: 'second opinion',
  breakers: 'tripwires',
  evaluate: 'evaluate',
};

/** What each step is doing, for a reader who has never seen a tool like this. */
const STAGE_NARRATION: Record<RunStageId, string> = {
  resolve: 'Finding the company, the token it trades as, and its filing history…',
  decompose:
    'Reading your thesis for everything it quietly assumes, including the parts you did not say out loud.',
  challenge:
    'A second model from a different family is reading the same thesis alongside this, looking for assumptions the first one missed. It does not hold anything up.',
  breakers:
    'Working out which of those assumptions can actually be checked, and what number would prove each one wrong.',
  evaluate: 'Reading the latest filings and live prices to see where each one stands right now.',
};

const ERROR_HEADING: Record<ErrorKind, string> = {
  quota: 'Daily model quota is used up',
  config: 'The model is not configured',
  data: 'Could not reach the data it needs',
  unknown: 'The run stopped',
};

interface RunState {
  running: boolean;
  stages: Record<RunStageId, BlockStage['state']>;
  ticker: string;
  decomposition?: Decomposition;
  breakerSet?: BreakerSet;
  evaluations?: Evaluation[];
  meta?: { modelCalls: number; latencyMs: number; models: string[] };
  error?: { message: string; kind: ErrorKind };
}

const IDLE: RunState = {
  running: false,
  stages: {
    resolve: 'pending',
    decompose: 'pending',
    challenge: 'pending',
    breakers: 'pending',
    evaluate: 'pending',
  },
  ticker: '',
};

/** Parse an SSE byte stream into events, tolerating frames split across chunks. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<RunEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split = buffer.indexOf('\n\n');
    while (split !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (line) {
        try {
          yield JSON.parse(line.slice(6)) as RunEvent;
        } catch {
          // A frame we cannot parse is dropped rather than killing the stream -
          // the remaining stages are still worth delivering.
        }
      }
      split = buffer.indexOf('\n\n');
    }
  }
}

export function AttackRunner() {
  const [ticker, setTicker] = useState('NVDA');
  const [thesis, setThesis] = useState(
    'I am long NVDA because AI infrastructure spending keeps accelerating and NVIDIA is the main beneficiary.',
  );
  const [state, setState] = useState<RunState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const upper = ticker.trim().toUpperCase();
    setState({ ...IDLE, running: true, ticker: upper });

    try {
      const response = await fetch('/api/attack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticker: upper, thesis }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string };
        setState((s) => ({
          ...s,
          running: false,
          error: { kind: 'unknown', message: detail.error ?? response.statusText },
        }));
        return;
      }

      for await (const event of readEvents(response.body)) {
        setState((s) => {
          switch (event.type) {
            case 'stage':
              return { ...s, stages: { ...s.stages, [event.id]: event.state } };
            case 'decomposition':
              return { ...s, decomposition: event.decomposition };
            case 'breakers':
              return { ...s, breakerSet: event.breakerSet };
            case 'evaluations':
              return { ...s, evaluations: event.evaluations };
            case 'done':
              return {
                ...s,
                running: false,
                meta: {
                  modelCalls: event.modelCalls,
                  latencyMs: event.latencyMs,
                  models: event.models,
                },
              };
            case 'error':
              return { ...s, running: false, error: { kind: event.kind, message: event.message } };
            default:
              return s;
          }
        });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setState((s) => ({
        ...s,
        running: false,
        error: { kind: 'unknown', message: error instanceof Error ? error.message : String(error) },
      }));
    } finally {
      setState((s) => (s.running ? { ...s, running: false } : s));
    }
  }, [ticker, thesis]);

  const stages: BlockStage[] = STAGE_ORDER.map((id) => ({
    id,
    label: STAGE_LABEL[id],
    state: state.stages[id],
    narration: STAGE_NARRATION[id],
  }));

  const started = state.running || Boolean(state.decomposition) || Boolean(state.error);
  const breakersPending = state.stages.breakers !== 'done' && state.stages.breakers !== 'failed';
  const tooShort = thesis.trim().length < 20;

  return (
    <div className="flex flex-col gap-10">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        className="flex flex-col gap-3"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-meta uppercase tracking-[0.14em] text-faint">Ticker</span>
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            spellCheck={false}
            className="w-28 rounded-[6px] border border-line bg-surface px-2.5 py-1.5 font-mono text-base uppercase text-text outline-none focus:border-line-strong"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-meta uppercase tracking-[0.14em] text-faint">Your thesis</span>
          <textarea
            value={thesis}
            onChange={(e) => setThesis(e.target.value)}
            rows={3}
            className="w-full resize-y rounded-[6px] border border-line bg-surface px-3 py-2 text-base leading-relaxed text-text outline-none focus:border-line-strong"
          />
        </label>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="submit"
            disabled={state.running || tooShort}
            className={cn(
              'rounded-full border px-4 py-1.5 text-sm transition-colors',
              state.running || tooShort
                ? 'cursor-not-allowed border-line text-faint'
                : 'border-line-strong text-text hover:bg-raised',
            )}
          >
            {state.running ? 'Attacking…' : 'Attack my thesis'}
          </button>
          <span className="text-meta text-faint">
            Live run &middot; usually under 15 seconds &middot; costs real model quota
          </span>
        </div>
      </form>

      {started ? (
        <AnalysisBlock
          kind="thesis-attacked"
          subject={state.ticker}
          {...(state.meta ? { meta: state.meta } : { stages })}
        >
          {state.error ? (
            <div className="mb-6">
              <p className="text-base text-trust">{ERROR_HEADING[state.error.kind]}</p>
              <Prose className="mt-1.5 text-sm">{state.error.message}</Prose>
              {state.decomposition ? (
                <Prose className="mt-3 text-sm">
                  <Term>What arrived before it stopped is still shown below</Term> &mdash; a partial
                  run, not a fabricated one.
                </Prose>
              ) : null}
            </div>
          ) : null}

          {state.decomposition ? (
            <BlockSection title="What the thesis rests on">
              <AssumptionTree
                decomposition={state.decomposition}
                breakerSet={state.breakerSet}
                breakersPending={breakersPending}
              />
            </BlockSection>
          ) : null}

          {state.breakerSet && state.breakerSet.breakers.length > 0 ? (
            <BlockSection title="Tripwires &middot; live">
              {state.breakerSet.breakers.map((breaker) => (
                <TripwireRow
                  key={breaker.id}
                  breaker={breaker}
                  evaluation={state.evaluations?.find((e) => e.breakerId === breaker.id)}
                />
              ))}
            </BlockSection>
          ) : null}

          {/*
            Base rates are fetched per tripwire on demand. See
            BaseRateDisclosure for why they are not part of the main run.
            Threshold breakers only: an event breaker has no numeric record.
          */}
          {state.breakerSet && !state.running
            ? (() => {
                const testable = state.breakerSet.breakers.filter((b) => b.kind === 'threshold');
                if (testable.length === 0) return null;
                return (
                  <BlockSection title="Base rates">
                    <div className="flex flex-col gap-3">
                      {testable.map((breaker) => (
                        <BaseRateDisclosure
                          key={breaker.id}
                          ticker={state.ticker}
                          breaker={breaker}
                        />
                      ))}
                    </div>
                  </BlockSection>
                );
              })()
            : null}

          {/*
            The closing section. Rendered once the run has settled, because an
            action list that reshuffles while stages land would read as the
            system changing its mind rather than finishing its work.
          */}
          {state.decomposition && !state.running ? (
            <>
              <BlockSection title="The brief" tone="lead">
                <ResearchBrief
                  brief={deriveBrief(state.decomposition, state.breakerSet, state.evaluations)}
                />
              </BlockSection>
              <BlockSection title="What to do now">
                <NextActions
                  actions={deriveActions(
                    state.decomposition,
                    state.breakerSet,
                    state.evaluations,
                  )}
                />
              </BlockSection>
            </>
          ) : null}
        </AnalysisBlock>
      ) : null}
    </div>
  );
}
