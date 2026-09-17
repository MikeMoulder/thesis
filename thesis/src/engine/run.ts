import { getDataSource } from '../data/index';
import type { Instrument } from '../data/types';
import { getRateLimiter, LlmError, QuotaExceededError } from '../llm/index';
import { challenge, merge, mergeBreakers, type ChallengeResult } from './challenge';
import { decompose } from './decomposer/index';
import type { Decomposition, ThesisInput } from './decomposer/types';
import { generateBreakers } from './breakers/index';
import type { BreakerSet } from './breakers/types';
import { evaluateLive, type Evaluation } from './breakers/evaluate';

/**
 * One run of ATTACK MY THESIS, as a stream of events.
 *
 * An async generator rather than a function returning a result, because the
 * pipeline takes the better part of ten seconds and the UI has something worth
 * showing at every step: the assumption tree is meaningful before a single
 * tripwire exists. Waiting for the whole run to finish would throw that away
 * and leave a spinner in its place.
 *
 * The generator is transport-agnostic — the SSE route serialises it, and a CLI
 * could consume the same events.
 */

export type RunStageId = 'resolve' | 'decompose' | 'challenge' | 'breakers' | 'evaluate';

export type RunEvent =
  | {
      type: 'stage';
      id: RunStageId;
      state: 'running' | 'done' | 'failed';
      /** Wall time for the stage, set on 'done' and 'failed'. */
      ms?: number;
      detail?: string;
    }
  | { type: 'instrument'; instrument: Instrument }
  | { type: 'decomposition'; decomposition: Decomposition }
  | { type: 'challenge'; challenge: ChallengeResult }
  | { type: 'breakers'; breakerSet: BreakerSet }
  | { type: 'evaluations'; evaluations: Evaluation[] }
  | { type: 'done'; modelCalls: number; latencyMs: number; models: string[] }
  | { type: 'error'; message: string; kind: ErrorKind };

/** Why a run stopped. The UI says something different for each. */
export type ErrorKind = 'quota' | 'config' | 'data' | 'unknown';

/** Total model calls recorded across every seat, for an honest before/after diff. */
function totalModelCalls(): number {
  return getRateLimiter()
    .allUsage()
    .reduce((sum, row) => sum + row.used, 0);
}

function classify(error: unknown): { message: string; kind: ErrorKind } {
  if (error instanceof QuotaExceededError) {
    return { message: error.message, kind: 'quota' };
  }
  if (error instanceof LlmError && error.model === 'unconfigured') {
    return { message: error.message, kind: 'config' };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    kind: 'unknown',
  };
}

export async function* runAttack(input: ThesisInput): AsyncGenerator<RunEvent> {
  const startedAt = Date.now();
  const callsBefore = totalModelCalls();
  const models = new Set<string>();

  const ds = getDataSource();
  let instrument: Instrument;

  // ---- resolve ------------------------------------------------------------
  let mark = Date.now();
  const since = () => {
    const elapsed = Date.now() - mark;
    mark = Date.now();
    return elapsed;
  };

  yield { type: 'stage', id: 'resolve', state: 'running' };
  try {
    instrument = await ds.resolve(input.ticker);
  } catch (error) {
    yield { type: 'stage', id: 'resolve', state: 'failed', ms: since() };
    yield {
      type: 'error',
      kind: 'data',
      message: `Could not resolve ${input.ticker}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
    return;
  }
  yield { type: 'instrument', instrument };
  yield { type: 'stage', id: 'resolve', state: 'done', ms: since() };

  // ---- decompose ----------------------------------------------------------
  yield { type: 'stage', id: 'decompose', state: 'running' };
  let decomposition: Decomposition;
  try {
    decomposition = await decompose(input);
  } catch (error) {
    yield { type: 'stage', id: 'decompose', state: 'failed', ms: since() };
    yield { type: 'error', ...classify(error) };
    return;
  }
  models.add(decomposition.meta.model);
  yield { type: 'decomposition', decomposition };
  yield { type: 'stage', id: 'decompose', state: 'done', ms: since() };

  // ---- second opinion, started now and collected at the end ---------------
  /*
    Started here and deliberately NOT awaited.

    It used to block the tripwires, which put the slowest and least reliable
    dependency in the project directly in front of the result. The sponsor
    gateway answers in 15 to 42 seconds when it answers at all, and succeeds
    roughly one run in three, so a full analysis that takes about ten seconds
    was waiting up to forty-five more for something that usually never arrived.

    So the main path no longer depends on it. Tripwires are generated and
    evaluated against the first pass, the user has a complete answer at the
    usual speed, and the second reader lands afterwards as an enrichment. Total
    wall time becomes the LONGER of the two rather than their sum.

    Anything it adds still gets watched: the additions go through their own
    small generation pass below, so they arrive with tripwires like every other
    assumption rather than as commentary.
  */
  yield { type: 'stage', id: 'challenge', state: 'running' };
  const secondOpinion = challenge(decomposition);

  // ---- breakers -----------------------------------------------------------
  yield { type: 'stage', id: 'breakers', state: 'running' };
  let breakerSet: BreakerSet;
  try {
    breakerSet = await generateBreakers(decomposition);
  } catch (error) {
    yield { type: 'stage', id: 'breakers', state: 'failed', ms: since() };
    yield { type: 'error', ...classify(error) };
    // The decomposition is already delivered and still useful on its own, so
    // this is a partial result rather than a failed run. `secondOpinion` is
    // abandoned here; it never rejects, so nothing is left unhandled.
    return;
  }
  models.add(breakerSet.meta.model);
  yield { type: 'breakers', breakerSet };
  yield { type: 'stage', id: 'breakers', state: 'done', ms: since() };

  // ---- evaluate -----------------------------------------------------------
  // No model calls here at all: this is the evaluator reading real data. It is
  // also why scenario mode is free.
  yield { type: 'stage', id: 'evaluate', state: 'running' };
  const evaluations: Evaluation[] = [];
  for (const breaker of breakerSet.breakers) {
    try {
      evaluations.push(await evaluateLive(ds, instrument, breaker));
    } catch (error) {
      // One unreadable metric must not sink the others; record it as
      // undeterminable, which the UI already renders honestly.
      evaluations.push({
        breakerId: breaker.id,
        mode: 'live',
        status: 'undeterminable',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  yield { type: 'evaluations', evaluations };
  yield { type: 'stage', id: 'evaluate', state: 'done', ms: since() };

  // ---- collect the second opinion -----------------------------------------
  /*
    The run is already complete and on screen by this point. Everything below
    can only ADD, and every failure path leaves what is already delivered
    untouched.
  */
  const challenged = await secondOpinion;
  if (challenged.model) models.add(challenged.model);

  if (challenged.added.length > 0) {
    decomposition = merge(decomposition, challenged);
    yield { type: 'decomposition', decomposition };

    try {
      // A second, small generation pass over the additions ALONE. Passing the
      // whole merged list would rewrite tripwires the user is already reading
      // and renumber the ids their evaluations are keyed by.
      const before = breakerSet.breakers.length;
      const extra = await generateBreakers({ ...decomposition, assumptions: challenged.added });
      breakerSet = mergeBreakers(breakerSet, extra, decomposition.assumptions);
      if (extra.meta.model !== 'none') models.add(extra.meta.model);
      yield { type: 'breakers', breakerSet };

      for (const breaker of breakerSet.breakers.slice(before)) {
        try {
          evaluations.push(await evaluateLive(ds, instrument, breaker));
        } catch (error) {
          evaluations.push({
            breakerId: breaker.id,
            mode: 'live',
            status: 'undeterminable',
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      yield { type: 'evaluations', evaluations };
    } catch {
      // The additions stay on the assumption tree without tripwires, which is
      // the same honest state as any assumption nothing can watch. Failing here
      // must not retract work already delivered.
    }
  }

  yield { type: 'challenge', challenge: challenged };
  yield {
    type: 'stage',
    id: 'challenge',
    state: 'done',
    ms: since(),
    ...(challenged.skipped ? { detail: `skipped: ${challenged.skipped}` } : {}),
  };

  yield {
    type: 'done',
    modelCalls: totalModelCalls() - callsBefore,
    latencyMs: Date.now() - startedAt,
    models: [...models],
  };
}
