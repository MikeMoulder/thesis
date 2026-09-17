import { getLlm, type LlmClient } from '../../llm/index';
import { extractJson } from '../../llm/json';
import { MalformedOutputError, type Message } from '../../llm/types';
import { buildDecomposerUser, DECOMPOSER_SYSTEM } from './prompt';
import { downgradeUntestable, validateDecomposition } from './validate';
import { summarise, type Decomposition, type ThesisInput } from './types';

export * from './types';
export { DECOMPOSER_SYSTEM } from './prompt';

export interface DecomposeOptions {
  /** Inject a client for tests or to run the decomposer on a different seat. */
  llm?: LlmClient;
  /** How many times to ask the model to fix malformed output. */
  repairAttempts?: number;
}

/**
 * Turn a free-text thesis into claims and assumptions.
 *
 * Runs at low temperature: this is extraction, and we want the same thesis to
 * decompose the same way twice. A stress test whose starting structure shifts
 * between runs is not a test of anything.
 */
export async function decompose(
  input: ThesisInput,
  opts: DecomposeOptions = {},
): Promise<Decomposition> {
  const llm = opts.llm ?? getLlm('decomposer');
  const repairAttempts = opts.repairAttempts ?? 1;

  const messages: Message[] = [
    { role: 'system', content: DECOMPOSER_SYSTEM },
    { role: 'user', content: buildDecomposerUser(input) },
  ];

  let totalLatency = 0;
  let lastError: MalformedOutputError | null = null;

  for (let attempt = 0; attempt <= repairAttempts; attempt++) {
    const result = await llm.complete(messages, {
      temperature: 0.1,
      json: true,
      maxTokens: 4000,
    });
    totalLatency += result.latencyMs;

    try {
      const parsed = extractJson(result.text);
      const { claims, assumptions, ambiguities, softProblems } = validateDecomposition(
        parsed,
        result.text,
      );

      // The structure is sound but something claims to be testable with data we
      // do not have. Worth one more attempt — the model usually reclassifies
      // correctly once told exactly which phrase was the problem.
      if (softProblems.length > 0 && attempt < repairAttempts) {
        messages.push(
          { role: 'assistant', content: result.text },
          {
            role: 'user',
            content:
              `Those assumptions cite data this system does not have:\n\n` +
              softProblems.map((p) => `- ${p.message}`).join('\n') +
              `\n\nReturn the corrected JSON object only — no prose, no fences.`,
          },
        );
        continue;
      }

      // Out of attempts: keep the decomposition but mark the offenders
      // untestable rather than letting a false "verified" through.
      const finalAssumptions =
        softProblems.length > 0 ? downgradeUntestable(assumptions, softProblems) : assumptions;

      return {
        ticker: input.ticker,
        thesis: input.thesis,
        ...(input.horizon ? { horizon: input.horizon } : {}),
        ...(input.proposedTrade ? { proposedTrade: input.proposedTrade } : {}),
        claims,
        assumptions: finalAssumptions,
        ambiguities,
        // Counted here rather than taken from the model — see summarise().
        summary: summarise(claims, finalAssumptions),
        meta: {
          model: result.model,
          latencyMs: totalLatency,
          decomposedAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      if (!(err instanceof MalformedOutputError)) throw err;
      lastError = err;

      if (attempt === repairAttempts) break;

      // Hand the model its own output and the specific complaint. Naming the
      // exact field is what makes this recoverable rather than a coin flip.
      messages.push(
        { role: 'assistant', content: result.text },
        {
          role: 'user',
          content: `That response could not be used.\n\n${err.message}\n\nReturn the corrected JSON object only — no prose, no fences.`,
        },
      );
    }
  }

  throw lastError ?? new Error('Decomposition failed for an unknown reason');
}
