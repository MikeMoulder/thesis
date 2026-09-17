import { OpenAICompatibleClient } from './openai-compatible';
import { RateLimiter, type Limits } from './ratelimit';
import {
  LlmError,
  type CompletionOptions,
  type CompletionResult,
  type LlmClient,
  type Message,
} from './types';

export * from './types';
export { OpenAICompatibleClient } from './openai-compatible';
export { extractJson } from './json';
export { QuotaExceededError, RateLimiter, type Limits } from './ratelimit';

/** Seats in the research committee. */
export type Seat =
  | 'decomposer'
  | 'fundamentals'
  | 'market'
  | 'news'
  | 'bull'
  | 'bear'
  | 'judge'
  /** Answers follow-up questions from a completed run's own output. */
  | 'followup';

export const SEATS: readonly Seat[] = [
  'decomposer',
  'fundamentals',
  'market',
  'news',
  'bull',
  'bear',
  'judge',
  'followup',
];

/**
 * Google AI Studio speaks OpenAI's wire format at this path, so Gemini needs no
 * separate client — the same OpenAICompatibleClient handles it, with the AI
 * Studio API key as the bearer token.
 */
export const GEMINI_BASE_URL =
  process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai';

/** Qwen via Bitget's hackathon gateway (S2 developer handbook, section V). */
export const QWEN_BASE_URL = process.env.QWEN_BASE_URL ?? 'https://hackathon.bitgetops.com/v1';
export const QWEN_MODEL = process.env.QWEN_MODEL ?? 'qwen3.8-max';

interface ModelSpec {
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  limits: Limits;
}

/**
 * Model assignment, tuned to free-tier quotas rather than to preference.
 *
 * The binding constraint is requests per DAY. One full run costs six
 * primary-model calls, so a 20-RPD model allows barely three runs — unusable
 * for development.
 *
 * Hence the split:
 *   - the five per-run seats go on a Flash Lite tier (500 RPD, 15 RPM)
 *   - the judge, called exactly once per run, goes on the stronger Flash tier
 *     where 20 RPD still buys 20 full runs a day
 *   - the bear goes on Qwen, which is both the sponsor model and a different
 *     family from the bull
 *
 * Every id is env-overridable because AI Studio model ids change; run
 * `npm run models` to list what your key can actually reach.
 */
/**
 * Pinned, not `-latest`. The floating aliases move to a different underlying
 * model without notice, and quota is metered per underlying model — so an alias
 * can silently relocate the budget. It also means a judge re-running this weeks
 * from now would get behaviour we never tested.
 *
 * Note `gemini-3-flash` is deliberately unused: that bucket was already
 * exhausted (43/20 RPD) before this was wired.
 */
const VOLUME_MODEL = process.env.GEMINI_VOLUME_MODEL ?? 'gemini-3.5-flash-lite';
const JUDGE_MODEL = process.env.GEMINI_JUDGE_MODEL ?? 'gemini-3.8-flash';

const VOLUME_LIMITS: Limits = {
  rpm: Number(process.env.GEMINI_VOLUME_RPM ?? 15),
  rpd: Number(process.env.GEMINI_VOLUME_RPD ?? 500),
};
const JUDGE_LIMITS: Limits = {
  rpm: Number(process.env.GEMINI_JUDGE_RPM ?? 5),
  rpd: Number(process.env.GEMINI_JUDGE_RPD ?? 20),
};
const QWEN_LIMITS: Limits = {
  rpm: Number(process.env.QWEN_RPM ?? 0),
  rpd: Number(process.env.QWEN_RPD ?? 0),
};

function gemini(model: string, limits: Limits): ModelSpec {
  return { baseUrl: GEMINI_BASE_URL, model, apiKeyEnv: 'GEMINI_API_KEY', limits };
}

const SEAT_MODEL: Record<Seat, ModelSpec> = {
  decomposer: gemini(VOLUME_MODEL, VOLUME_LIMITS),
  fundamentals: gemini(VOLUME_MODEL, VOLUME_LIMITS),
  market: gemini(VOLUME_MODEL, VOLUME_LIMITS),
  news: gemini(VOLUME_MODEL, VOLUME_LIMITS),
  bull: gemini(VOLUME_MODEL, VOLUME_LIMITS),
  // A volume seat: follow-ups are the most frequent call in a session, and the
  // question is answered from context that is already on the page rather than
  // from reasoning the model has to do itself.
  followup: gemini(VOLUME_MODEL, VOLUME_LIMITS),
  judge: gemini(JUDGE_MODEL, JUDGE_LIMITS),
  bear: {
    baseUrl: QWEN_BASE_URL,
    model: QWEN_MODEL,
    apiKeyEnv: 'QWEN_API_KEY',
    limits: QWEN_LIMITS,
  },
};

/** One limiter shared process-wide, keyed by model — quotas are per model. */
const limiter = new RateLimiter(
  new Map(Object.values(SEAT_MODEL).map((spec) => [spec.model, spec.limits])),
);

export function getRateLimiter(): RateLimiter {
  return limiter;
}

/** Wraps a client so every call is spaced and counted against the daily cap. */
class LimitedClient implements LlmClient {
  constructor(
    private readonly inner: LlmClient,
    private readonly key: string,
  ) {}

  get model(): string {
    return this.inner.model;
  }
  get label(): string {
    return this.inner.label;
  }

  async complete(messages: Message[], opts?: CompletionOptions): Promise<CompletionResult> {
    await limiter.acquire(this.key);
    return this.inner.complete(messages, opts);
  }
}

const clients = new Map<Seat, LlmClient>();

export function getLlm(seat: Seat): LlmClient {
  const cached = clients.get(seat);
  if (cached) return cached;

  const spec = SEAT_MODEL[seat];
  const apiKey = process.env[spec.apiKeyEnv];
  if (!apiKey) {
    throw new LlmError(
      `${spec.apiKeyEnv} is not set — required for the "${seat}" seat. See .env.example.`,
      'unconfigured',
    );
  }

  const client = new LimitedClient(
    new OpenAICompatibleClient({
      baseUrl: spec.baseUrl,
      apiKey,
      model: spec.model,
      label: `${seat}/${spec.model}`,
    }),
    spec.model,
  );

  clients.set(seat, client);
  return client;
}

/** What each seat is wired to, for the preflight report. */
export function describeSeats(): Array<{
  seat: Seat;
  model: string;
  limits: Limits;
  keySet: boolean;
}> {
  return SEATS.map((seat) => {
    const spec = SEAT_MODEL[seat];
    return {
      seat,
      model: spec.model,
      limits: spec.limits,
      keySet: Boolean(process.env[spec.apiKeyEnv]),
    };
  });
}

/** Test seam. */
export function __setLlm(seat: Seat, client: LlmClient | null): void {
  if (client) clients.set(seat, client);
  else clients.delete(seat);
}
