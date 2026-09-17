import { evaluateScenario, type Evaluation } from '@/engine/breakers/evaluate';
import type { BreakerSet } from '@/engine/breakers/types';
import type { Decomposition } from '@/engine/decomposer/types';
import { answerFollowup } from '@/engine/followup';
import { describeScenario, parseScenario } from '@/engine/scenario-parse';
import { LlmError, QuotaExceededError } from '@/llm/index';

/**
 * A follow-up turn in the conversation.
 *
 * Two routes, and which one runs is decided deterministically:
 *
 *   scenario  the message names metrics we can evaluate AND gives numbers for
 *             them → the evaluator answers it, with ZERO model calls
 *   answer    anything else → the follow-up seat, grounded in the run's output
 *
 * A model deciding the route would cost a call to classify a question the
 * evaluator could have answered for free, and a misroute in a live demo means a
 * judge types a scenario and gets a paragraph.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface Body {
  question?: unknown;
  decomposition?: unknown;
  breakerSet?: unknown;
  evaluations?: unknown;
}

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

export async function POST(request: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad('Body must be JSON.');
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (question.length < 2) return bad('Ask a question.');
  if (question.length > 1000) return bad('Question is too long.');

  const decomposition = body.decomposition as Decomposition | undefined;
  if (!decomposition?.assumptions) return bad('No analysis to answer about yet.');

  const breakerSet = body.breakerSet as BreakerSet | undefined;
  const evaluations = body.evaluations as Evaluation[] | undefined;

  // ---- scenario: free, deterministic ---------------------------------------
  const parsed = parseScenario(question);
  if (parsed && breakerSet) {
    const results = breakerSet.breakers.map((breaker) =>
      evaluateScenario(breaker, parsed.scenario),
    );
    return Response.json(
      {
        kind: 'scenario',
        label: describeScenario(parsed),
        evaluations: results,
        modelCalls: 0,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  }

  // ---- answer: one grounded model call -------------------------------------
  try {
    const answer = await answerFollowup(question, decomposition, breakerSet, evaluations);
    return Response.json(
      { kind: 'answer', ...answer, modelCalls: 1 },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return Response.json({ error: error.message, kind: 'quota' }, { status: 429 });
    }
    if (error instanceof LlmError && error.model === 'unconfigured') {
      return Response.json({ error: error.message, kind: 'config' }, { status: 503 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
