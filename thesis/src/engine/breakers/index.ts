import { getLlm, type LlmClient } from '../../llm/index';
import { extractJson } from '../../llm/json';
import { MalformedOutputError, type Message } from '../../llm/types';
import type { Decomposition } from '../decomposer/types';
import { buildBreakerUser, BREAKER_SYSTEM } from './prompt';
import { validateBreakers } from './validate';
import { summariseBreakers, type BreakerSet } from './types';

export * from './types';
export * from './evaluate';
export { readMetric, computePriceMetric, type MetricReading } from './metrics';
export { BREAKER_SYSTEM } from './prompt';

export interface GenerateOptions {
  llm?: LlmClient;
  repairAttempts?: number;
}

/**
 * Turn a decomposition into evaluable thesis breakers.
 *
 * Runs on the decomposer seat rather than its own: this is structured
 * conversion, not analysis, and it keeps the per-run call budget at one model
 * family for the cheap work.
 */
export async function generateBreakers(
  decomposition: Decomposition,
  opts: GenerateOptions = {},
): Promise<BreakerSet> {
  const llm = opts.llm ?? getLlm('decomposer');
  const repairAttempts = opts.repairAttempts ?? 1;

  const testable = decomposition.assumptions.filter((a) => a.testability !== 'none');

  // Nothing to generate from. Returning an empty set is correct and not a
  // failure — it means every assumption in the thesis is unfalsifiable with the
  // data available, which is itself the finding.
  if (testable.length === 0) {
    return {
      ticker: decomposition.ticker,
      breakers: [],
      uncovered: decomposition.assumptions.map((a) => ({
        assumptionId: a.id,
        statement: a.statement,
        reason: 'no available data can test this assumption',
      })),
      summary: summariseBreakers([], [], decomposition.assumptions),
      meta: { model: 'none', latencyMs: 0, generatedAt: new Date().toISOString() },
    };
  }

  const messages: Message[] = [
    { role: 'system', content: BREAKER_SYSTEM },
    { role: 'user', content: buildBreakerUser(decomposition) },
  ];

  let totalLatency = 0;
  let lastError: MalformedOutputError | null = null;

  for (let attempt = 0; attempt <= repairAttempts; attempt++) {
    const result = await llm.complete(messages, {
      temperature: 0.2,
      json: true,
      maxTokens: 4000,
    });
    totalLatency += result.latencyMs;

    try {
      const parsed = extractJson(result.text);
      const { breakers, uncovered, softProblems } = validateBreakers(
        parsed,
        result.text,
        decomposition.assumptions,
      );

      // Under-coverage is recoverable: the model usually fills the gaps once
      // told exactly which assumptions it skipped and what shape is wanted.
      // If it still refuses, we keep what we have and report the gap — an
      // honest "no tripwire here" beats a fabricated one.
      if (softProblems.length > 0 && attempt < repairAttempts) {
        messages.push(
          { role: 'assistant', content: result.text },
          {
            role: 'user',
            content:
              `Those breakers leave testable assumptions uncovered:\n\n` +
              softProblems.map((p) => `- ${p}`).join('\n') +
              `\n\nReturn the COMPLETE corrected JSON object, keeping the breakers you already wrote and adding the missing ones. No prose, no fences.`,
          },
        );
        continue;
      }

      return {
        ticker: decomposition.ticker,
        breakers,
        uncovered,
        summary: summariseBreakers(breakers, uncovered, decomposition.assumptions),
        meta: {
          model: result.model,
          latencyMs: totalLatency,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      if (!(err instanceof MalformedOutputError)) throw err;
      lastError = err;
      if (attempt === repairAttempts) break;

      messages.push(
        { role: 'assistant', content: result.text },
        {
          role: 'user',
          content: `That response could not be used.\n\n${err.message}\n\nReturn the corrected JSON object only — no prose, no fences.`,
        },
      );
    }
  }

  throw lastError ?? new Error('Breaker generation failed for an unknown reason');
}
