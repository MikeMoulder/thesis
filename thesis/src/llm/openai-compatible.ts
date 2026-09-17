import {
  LlmError,
  type CompletionOptions,
  type CompletionResult,
  type LlmClient,
  type Message,
} from './types';

/**
 * Client for any OpenAI-compatible /chat/completions endpoint.
 *
 * Covers Qwen through Bitget's hackathon gateway, and most other hosted
 * providers, with one implementation. Keeping the transport generic is what
 * lets seats be reassigned to different models by config alone.
 */
export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  label: string;
  defaultTimeoutMs?: number;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string };
}

export class OpenAICompatibleClient implements LlmClient {
  readonly model: string;
  readonly label: string;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.model = config.model;
    this.label = config.label;
  }

  async complete(messages: Message[], opts: CompletionOptions = {}): Promise<CompletionResult> {
    const t0 = Date.now();
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: opts.temperature ?? 0.2,
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    // Not every gateway supports response_format; harmless where ignored, and
    // the caller validates the structure regardless.
    if (opts.json) body.response_format = { type: 'json_object' };

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? this.config.defaultTimeoutMs ?? 120_000),
      });
    } catch (cause) {
      throw new LlmError(`Could not reach ${this.label} at ${url}`, this.model, cause);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new LlmError(
        `${this.label} returned HTTP ${res.status}: ${detail.slice(0, 300)}`,
        this.model,
      );
    }

    const payload = (await res.json()) as ChatResponse;
    if (payload.error) {
      throw new LlmError(`${this.label}: ${payload.error.message ?? 'unknown error'}`, this.model);
    }

    const text = payload.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.length === 0) {
      throw new LlmError(`${this.label} returned an empty completion`, this.model);
    }

    return {
      text,
      model: this.model,
      usage: {
        promptTokens: payload.usage?.prompt_tokens,
        completionTokens: payload.usage?.completion_tokens,
      },
      latencyMs: Date.now() - t0,
    };
  }
}
