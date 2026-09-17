/**
 * Who gets told, and how they said so.
 *
 * A binding links one Telegram chat to one browser session. The desk shows a
 * short code, the user hands that code to the bot, and the bot proves the
 * chat is theirs by presenting it. That is the whole handshake, and it exists
 * because the two sides have no other way to recognise each other: the browser
 * cannot see Telegram, and Telegram cannot see the browser.
 *
 * FOUR RULES, EACH ONE A FAILURE THIS WOULD OTHERWISE HAVE
 *
 * 1. Codes expire. A code that works forever is a permanent password to
 *    someone's alert feed, and it is printed on a screen in a demo.
 *
 * 2. Codes are single use, deleted the moment they are redeemed. A code
 *    read off a shoulder during a recording should already be spent.
 *
 * 3. One chat holds one binding. Re-binding replaces, never appends, or a
 *    user who pressed the button twice gets every alert twice and assumes
 *    the product is broken.
 *
 * 4. The alphabet has no O, 0, I, 1 or L. Someone reads this off a laptop
 *    and types it into a phone, and "was that an oh or a zero" is a support
 *    conversation that no product should have.
 */
import { command, redisConfig, type RedisConfig } from '../thesis/store';
import type { StoreKind } from '../thesis/store';

/** Long enough to walk to the phone, short enough to be worthless if seen. */
export const CODE_TTL_SEC = 10 * 60;

export const CODE_LENGTH = 6;

/** No O, 0, I, 1 or L. See rule 4. */
export const ALPHABET_SAFE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Consecutive fatal delivery failures before a binding is dropped.
 *
 * Fatal means 403, which is Telegram saying the user blocked the bot. One is
 * enough in principle, but a single 403 has been seen from a transient
 * account state, so this waits for a pattern before throwing away something
 * the user deliberately set up.
 */
export const MAX_FAILURES = 3;

export interface Binding {
  sessionId: string;
  chatId: number;
  /** What to show on the desk, for example "Mike" or "@mike". */
  chatName: string;
  boundAt: string;
  /** The user sent /stop. Kept rather than deleted so /start resumes it. */
  muted: boolean;
  /** Consecutive fatal send failures. Reset to zero by any success. */
  failures: number;
  lastNotifiedAt?: string;
  /** How many alerts this chat has been sent. Shown by /status. */
  notified: number;
}

export interface PendingCode {
  code: string;
  sessionId: string;
  expiresAt: string;
}

export interface BindingStore {
  kind: StoreKind;
  /** Mint a code for this browser session, replacing any it already has. */
  createCode(sessionId: string): Promise<PendingCode>;
  /** Spend a code and bind the chat. Null if the code is unknown or expired. */
  redeem(code: string, chatId: number, chatName: string): Promise<Binding | null>;
  bySession(sessionId: string): Promise<Binding | null>;
  byChat(chatId: number): Promise<Binding | null>;
  /** Everyone who should be told. The recheck reads this. */
  list(): Promise<Binding[]>;
  put(binding: Binding): Promise<void>;
  remove(chatId: number): Promise<void>;
}

const BIND_KEY = (chatId: number): string => `tg:v1:bind:${chatId}`;
const SESSION_KEY = (sessionId: string): string => `tg:v1:session:${sessionId}`;
const CODE_KEY = (code: string): string => `tg:v1:code:${code}`;
const INDEX_KEY = 'tg:v1:index';

/**
 * Bindings are keyed by chat id and the session is a secondary lookup, which
 * is the opposite of how the handshake reads. The reason is delivery: the
 * recheck needs every chat, and the chat id is the only thing Telegram gives
 * back on an incoming message. Sessions are the transient half.
 */

export function newCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = '';
  // Modulo bias across a 31-letter alphabet is about 1.6% on the first four
  // letters. For a single-use code that expires in ten minutes that is not
  // worth a rejection loop.
  for (const byte of bytes) out += ALPHABET_SAFE[byte % ALPHABET_SAFE.length];
  return out;
}

/**
 * Accept what a human actually sends.
 *
 * Three real shapes arrive here. The deep link produces "/start ABC234". A
 * user who already has the bot open types "/bind ABC234", or in a group
 * "/bind@thesis_stockbot ABC234". Someone copying off a screen sends
 * "abc 234" or "ABC234 thanks".
 *
 * Only the first token survives, so trailing words cannot silently extend a
 * code into a different one.
 */
export function normaliseCode(input: string): string {
  const withoutCommand = input.trim().replace(/^\/(?:bind|start)(?:@\w+)?\s*/i, '');
  const firstToken = withoutCommand.split(/\s+/)[0] ?? '';
  return firstToken.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function newBinding(sessionId: string, chatId: number, chatName: string): Binding {
  return {
    sessionId,
    chatId,
    chatName,
    boundAt: new Date().toISOString(),
    muted: false,
    failures: 0,
    notified: 0,
  };
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------

class RedisBindingStore implements BindingStore {
  readonly kind = 'redis' as const;

  constructor(private readonly config: RedisConfig) {}

  async createCode(sessionId: string): Promise<PendingCode> {
    const code = newCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_SEC * 1000).toISOString();
    // EX rather than a stored timestamp we check ourselves. Redis expiring the
    // key means an abandoned code cannot be redeemed even if the check is ever
    // wrong, and nothing accumulates.
    await command(this.config, [
      'SET',
      CODE_KEY(code),
      JSON.stringify({ sessionId, expiresAt }),
      'EX',
      CODE_TTL_SEC,
    ]);
    return { code, sessionId, expiresAt };
  }

  async redeem(code: string, chatId: number, chatName: string): Promise<Binding | null> {
    const key = CODE_KEY(code);
    const raw = await command<string | null>(this.config, ['GET', key]);
    const pending = parse<{ sessionId: string }>(raw);
    if (!pending) return null;

    // Spend it before doing anything else. If the bind below fails the user
    // asks for a new code, which is cheap; a code that survives a partial
    // failure is a code two people can use.
    await command(this.config, ['DEL', key]);

    const binding = newBinding(pending.sessionId, chatId, chatName);
    await this.put(binding);
    return binding;
  }

  async bySession(sessionId: string): Promise<Binding | null> {
    const chatId = await command<string | null>(this.config, ['GET', SESSION_KEY(sessionId)]);
    if (!chatId) return null;
    return this.byChat(Number(chatId));
  }

  async byChat(chatId: number): Promise<Binding | null> {
    return parse<Binding>(await command<string | null>(this.config, ['GET', BIND_KEY(chatId)]));
  }

  async list(): Promise<Binding[]> {
    const ids = await command<string[]>(this.config, ['SMEMBERS', INDEX_KEY]);
    if (!ids || ids.length === 0) return [];
    const raw = await command<Array<string | null>>(this.config, [
      'MGET',
      ...ids.map((id) => BIND_KEY(Number(id))),
    ]);
    return raw.map((r) => parse<Binding>(r)).filter((b): b is Binding => b !== null);
  }

  async put(binding: Binding): Promise<void> {
    // A session that was bound to a different chat must release it, or the
    // old chat keeps receiving alerts for a desk that has moved on.
    const previous = await command<string | null>(this.config, [
      'GET',
      SESSION_KEY(binding.sessionId),
    ]);
    if (previous && Number(previous) !== binding.chatId) {
      await this.remove(Number(previous));
    }

    await command(this.config, ['SET', BIND_KEY(binding.chatId), JSON.stringify(binding)]);
    await command(this.config, ['SET', SESSION_KEY(binding.sessionId), String(binding.chatId)]);
    await command(this.config, ['SADD', INDEX_KEY, String(binding.chatId)]);
  }

  async remove(chatId: number): Promise<void> {
    const existing = await this.byChat(chatId);
    if (existing) await command(this.config, ['DEL', SESSION_KEY(existing.sessionId)]);
    await command(this.config, ['DEL', BIND_KEY(chatId)]);
    await command(this.config, ['SREM', INDEX_KEY, String(chatId)]);
  }
}

// ---------------------------------------------------------------------------
// In-memory, for local development and the self-test. Expiry is checked on
// read rather than swept, because nothing here runs long enough to accumulate.
// ---------------------------------------------------------------------------

class MemoryBindingStore implements BindingStore {
  readonly kind = 'memory' as const;
  private readonly bindings = new Map<number, Binding>();
  private readonly sessions = new Map<string, number>();
  private readonly codes = new Map<string, { sessionId: string; expiresAtMs: number }>();

  /** Overridable so the self-test can prove expiry without waiting ten minutes. */
  constructor(private readonly now: () => number = Date.now) {}

  async createCode(sessionId: string): Promise<PendingCode> {
    const code = newCode();
    const expiresAtMs = this.now() + CODE_TTL_SEC * 1000;
    this.codes.set(code, { sessionId, expiresAtMs });
    return { code, sessionId, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  async redeem(code: string, chatId: number, chatName: string): Promise<Binding | null> {
    const pending = this.codes.get(code);
    if (!pending) return null;
    if (pending.expiresAtMs <= this.now()) {
      this.codes.delete(code);
      return null;
    }
    this.codes.delete(code);
    const binding = newBinding(pending.sessionId, chatId, chatName);
    await this.put(binding);
    return binding;
  }

  async bySession(sessionId: string): Promise<Binding | null> {
    const chatId = this.sessions.get(sessionId);
    return chatId === undefined ? null : (this.bindings.get(chatId) ?? null);
  }

  async byChat(chatId: number): Promise<Binding | null> {
    return this.bindings.get(chatId) ?? null;
  }

  async list(): Promise<Binding[]> {
    return [...this.bindings.values()].map((b) => structuredClone(b));
  }

  async put(binding: Binding): Promise<void> {
    const previous = this.sessions.get(binding.sessionId);
    if (previous !== undefined && previous !== binding.chatId) await this.remove(previous);
    this.bindings.set(binding.chatId, structuredClone(binding));
    this.sessions.set(binding.sessionId, binding.chatId);
  }

  async remove(chatId: number): Promise<void> {
    const existing = this.bindings.get(chatId);
    if (existing) this.sessions.delete(existing.sessionId);
    this.bindings.delete(chatId);
  }
}

// ---------------------------------------------------------------------------

let cached: BindingStore | null = null;

export function getBindingStore(): BindingStore {
  if (cached) return cached;
  const config = redisConfig();
  cached = config ? new RedisBindingStore(config) : new MemoryBindingStore();
  return cached;
}

/** For the self-test: a fresh store with no shared state and a fake clock. */
export function createMemoryBindingStore(now?: () => number): BindingStore {
  return new MemoryBindingStore(now);
}
