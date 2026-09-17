/**
 * LLM seam.
 *
 * THESIS deliberately runs different seats on different model families — the
 * bull on the primary model, the bear on Qwen. The claim we make about that is
 * narrow and defensible: it reduces dependence on a single model's reasoning
 * path. It does NOT make the two sides independent; models share training data
 * and make correlated errors, and nothing here should imply otherwise.
 */

export type Role = 'system' | 'user' | 'assistant';

export interface Message {
  role: Role;
  content: string;
}

export interface CompletionOptions {
  /** Lower for extraction tasks, higher for argumentative ones. */
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider to constrain output to JSON where supported. */
  json?: boolean;
  /** Abort if the provider has not responded within this many ms. */
  timeoutMs?: number;
  /**
   * Provider-specific request fields, merged into the body verbatim.
   *
   * An escape hatch, not a feature. The seats run on different gateways and
   * some of them need a flag that exists nowhere else, so the alternative is
   * either a union of every provider's quirks on this interface or a second
   * client class per provider. Both are worse.
   *
   * Core fields win: whatever is passed here cannot overwrite model, messages,
   * temperature or max_tokens. A caller that could silently redirect a seat to
   * a different model through an untyped bag would be a bug waiting to happen.
   */
  extra?: Record<string, unknown>;
}

export interface CompletionResult {
  text: string;
  model: string;
  /** Present when the provider reports usage. Useful for cost accounting. */
  usage?: { promptTokens?: number; completionTokens?: number };
  /** Wall-clock latency, for the run timeline in the UI. */
  latencyMs: number;
}

export interface LlmClient {
  /** Identifier used in provenance and the run log, e.g. "qwen3.8-max". */
  readonly model: string;
  /** Which seat this client is configured for, for logging. */
  readonly label: string;
  complete(messages: Message[], opts?: CompletionOptions): Promise<CompletionResult>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly model: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/**
 * Raised when a model returns something that is not the requested structure.
 * Carries the raw text so a repair pass can attempt a fix rather than
 * discarding a response that is nearly right.
 */
export class MalformedOutputError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = 'MalformedOutputError';
  }
}
