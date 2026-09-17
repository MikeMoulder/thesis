import type { Evaluation } from '@/engine/breakers/evaluate';
import type { BreakerSet } from '@/engine/breakers/types';
import type { Decomposition } from '@/engine/decomposer/types';
import type { ErrorKind, RunEvent, RunStageId } from '@/engine/run';

/** Client-side view of one run in flight. */
export interface RunState {
  running: boolean;
  stages: Record<RunStageId, 'pending' | 'running' | 'done' | 'failed'>;
  decomposition?: Decomposition;
  breakerSet?: BreakerSet;
  evaluations?: Evaluation[];
  meta?: { modelCalls: number; latencyMs: number; models: string[] };
  error?: { message: string; kind: ErrorKind };
}

export const IDLE_RUN: RunState = {
  running: false,
  stages: { resolve: 'pending', decompose: 'pending', breakers: 'pending', evaluate: 'pending' },
};

/** Parse an SSE byte stream into events, tolerating frames split across chunks. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<RunEvent> {
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
          // A frame we cannot parse is dropped rather than killing the stream —
          // the remaining stages are still worth delivering.
        }
      }
      split = buffer.indexOf('\n\n');
    }
  }
}

/** Fold one event into run state. Pure, so the caller owns how it is stored. */
export function applyEvent(state: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case 'stage':
      return { ...state, stages: { ...state.stages, [event.id]: event.state } };
    case 'decomposition':
      return { ...state, decomposition: event.decomposition };
    case 'breakers':
      return { ...state, breakerSet: event.breakerSet };
    case 'evaluations':
      return { ...state, evaluations: event.evaluations };
    case 'done':
      return {
        ...state,
        running: false,
        meta: {
          modelCalls: event.modelCalls,
          latencyMs: event.latencyMs,
          models: event.models,
        },
      };
    case 'error':
      return { ...state, running: false, error: { kind: event.kind, message: event.message } };
    default:
      return state;
  }
}

/**
 * Pull a ticker out of the user's own sentence.
 *
 * Deliberately conservative: an uppercase 2-5 letter token, skipping words that
 * are commonly capitalised in a sentence about a trade. When nothing matches we
 * ask rather than guess — resolving the wrong company would produce a complete,
 * confident, entirely wrong analysis.
 */
const NOT_TICKERS = new Set([
  'I', 'AI', 'THE', 'A', 'AND', 'OR', 'IT', 'IS', 'MY', 'FSD', 'CEO', 'CFO', 'IPO',
  'ETF', 'GDP', 'CPI', 'FED', 'USD', 'EPS', 'YOY', 'USA', 'US', 'Q1', 'Q2', 'Q3', 'Q4',
]);

export function detectTicker(text: string): string | null {
  const matches = text.match(/\b[A-Z]{2,5}\b/g);
  if (!matches) return null;
  for (const candidate of matches) {
    if (!NOT_TICKERS.has(candidate)) return candidate;
  }
  return null;
}
