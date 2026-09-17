/**
 * The Telegram Bot API, in the small slice this product needs.
 *
 * Plain fetch rather than a bot framework. The frameworks in this space bring
 * a long-polling loop, a middleware stack and a session store, all of which
 * are for a bot that holds a conversation. This one sends notifications and
 * accepts four commands, so the wire format is cheaper than the dependency,
 * and one fewer thing can break a deploy the night before a deadline.
 *
 * THREE THINGS THIS FILE EXISTS TO GET RIGHT
 *
 * 1. The token lives in the URL. `https://api.telegram.org/bot<TOKEN>/send...`
 *    means any error that quotes the URL leaks the credential into a log, a
 *    stack trace, or an API response a stranger can read. Everything that
 *    could carry a URL outward goes through `redact` first.
 *
 * 2. Sending must never break the recheck. The 15-minute loop is the product.
 *    If Telegram is down, rate-limiting us, or the token was revoked, the
 *    check still has to be recorded. So every send returns a result object
 *    and throws nothing.
 *
 * 3. HTML, not MarkdownV2. MarkdownV2 requires escaping eighteen characters,
 *    and exactly one missed underscore in a company name makes Telegram
 *    reject the whole message with a 400. HTML mode needs three escapes and
 *    the failure surface shrinks with it.
 */

const API = 'https://api.telegram.org';

/** Telegram is fast or it is broken. A slow send must not hold the cron open. */
const TIMEOUT_MS = 10_000;

export function botToken(): string | null {
  const token = process.env.TG_BOT_TOKEN?.trim();
  return token ? token : null;
}

/**
 * Strip the bot token out of any string before it leaves this module.
 *
 * Applied to error messages rather than to the places that build URLs,
 * because the leak is not in the URL we wrote, it is in the ones fetch,
 * undici and Node's error paths write for us.
 */
export function redact(text: string): string {
  const token = botToken();
  let out = text.replace(/\/bot\d{6,}:[A-Za-z0-9_-]+/g, '/bot<redacted>');
  if (token) out = out.split(token).join('<redacted>');
  return out;
}

/** Escape the three characters that can break an HTML-mode message. */
export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status?: number; retryAfterSec?: number; fatal: boolean };

interface ApiEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

/**
 * One call. Returns an outcome instead of throwing, so callers in the cron
 * path cannot accidentally take the loop down with an unhandled rejection.
 *
 * `fatal` separates "this will fail again in fifteen minutes" from "try later".
 * A 401 means the token is wrong and retrying is pointless; a 429 or a socket
 * hang-up means the next tick may well succeed. Callers use it to decide
 * whether to drop a binding or leave it alone.
 */
async function call<T>(method: string, body?: unknown): Promise<Outcome<T>> {
  const token = botToken();
  if (!token) {
    return { ok: false, error: 'TG_BOT_TOKEN is not set on this deployment.', fatal: true };
  }

  let response: Response;
  try {
    response = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    // Network failures are transient by default. A DNS blip should not cost a
    // user their alerts subscription.
    return { ok: false, error: redact((error as Error).message), fatal: false };
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    return {
      ok: false,
      error: `Telegram returned ${response.status} with a body that is not JSON.`,
      status: response.status,
      fatal: false,
    };
  }

  if (envelope.ok && envelope.result !== undefined) {
    return { ok: true, value: envelope.result };
  }

  const status = envelope.error_code ?? response.status;
  // 401 revoked or wrong token, 403 the user blocked the bot, 400 a malformed
  // request or a chat that no longer exists. None of those improve with time.
  const fatal = status === 401 || status === 403 || status === 400;

  return {
    ok: false,
    error: redact(envelope.description ?? `Telegram returned ${status}.`),
    status,
    ...(envelope.parameters?.retry_after !== undefined
      ? { retryAfterSec: envelope.parameters.retry_after }
      : {}),
    fatal,
  };
}

/** Who this token belongs to. The cheapest proof that a token is real. */
export function getMe(): Promise<Outcome<TelegramUser>> {
  return call<TelegramUser>('getMe');
}

export interface SendOptions {
  /** Deliver without a sound. Used for routine confirmations, never alerts. */
  silent?: boolean;
}

export function sendMessage(
  chatId: number,
  html: string,
  options: SendOptions = {},
): Promise<Outcome<TelegramMessage>> {
  return call<TelegramMessage>('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    // A tripwire alert that renders a link card for some news site pushes the
    // number that fired below the fold on a phone.
    link_preview_options: { is_disabled: true },
    ...(options.silent ? { disable_notification: true } : {}),
  });
}

export interface WebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
}

export function getWebhookInfo(): Promise<Outcome<WebhookInfo>> {
  return call<WebhookInfo>('getWebhookInfo');
}

/**
 * Point Telegram at this deployment.
 *
 * `secret_token` is the whole security model for the webhook. Telegram sends
 * it back in the X-Telegram-Bot-Api-Secret-Token header on every update, and
 * the route rejects anything without it. Without one, the webhook URL is a
 * public endpoint that anyone can post a forged "/bind ABC123" to.
 *
 * `drop_pending_updates` clears the backlog. A bot that has been unreachable
 * for an hour otherwise wakes up and replays every stale bind code at once.
 */
export function setWebhook(url: string, secret: string): Promise<Outcome<boolean>> {
  return call<boolean>('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  });
}

export function deleteWebhook(): Promise<Outcome<boolean>> {
  return call<boolean>('deleteWebhook', { drop_pending_updates: true });
}
