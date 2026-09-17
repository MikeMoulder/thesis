import { CHECK_LOG_LIMIT, type ThesisRecord } from './types';

/**
 * Where theses live between visits.
 *
 * This is the piece the old app never had. Without it the engine could only
 * answer "what did I find?"; with it the product can answer "is that still
 * true?", which is the entire difference.
 *
 * The interface is deliberately tiny — four methods, whole records in and out.
 * A thesis is small (kilobytes) and is always read in full to render either
 * screen, so a richer query surface would buy nothing and cost portability.
 */
export interface ThesisStore {
  kind: StoreKind;
  list(): Promise<ThesisRecord[]>;
  get(id: string): Promise<ThesisRecord | null>;
  put(thesis: ThesisRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

export type StoreKind = 'redis' | 'memory';

const KEY_PREFIX = 'thesis:v1:';
const INDEX_KEY = 'thesis:v1:index';

/** Trim the log on write. See CHECK_LOG_LIMIT for why this is not optional. */
function trim(thesis: ThesisRecord): ThesisRecord {
  if (thesis.checks.length <= CHECK_LOG_LIMIT) return thesis;
  return { ...thesis, checks: thesis.checks.slice(-CHECK_LOG_LIMIT) };
}

// ---------------------------------------------------------------------------
// Upstash Redis over its REST API.
//
// Plain fetch rather than a client library: the wire format is two lines of
// code, and every dependency in a Next.js server bundle is another thing that
// can break a deploy the night before a deadline.
// ---------------------------------------------------------------------------

export interface RedisConfig {
  url: string;
  token: string;
}

/**
 * Accepts both naming conventions. Vercel's Upstash integration sets
 * `KV_REST_API_*`; installing Upstash directly sets `UPSTASH_REDIS_REST_*`.
 * Reading only one of them is a reliable way to lose an afternoon.
 */
export function redisConfig(): RedisConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}

export class RedisStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedisStoreError';
  }
}

export async function command<T>(config: RedisConfig, cmd: Array<string | number>): Promise<T> {
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(cmd),
    cache: 'no-store',
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new RedisStoreError(
      `redis ${cmd[0]} failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`,
    );
  }

  const body = (await response.json()) as { result?: T; error?: string };
  if (body.error) throw new RedisStoreError(`redis ${cmd[0]} failed: ${body.error}`);
  return body.result as T;
}

function parse(raw: string | null): ThesisRecord | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ThesisRecord;
  } catch {
    // A corrupt value must not take down the whole list. Skipping it loses one
    // thesis; throwing would lose every thesis the user has.
    return null;
  }
}

class RedisStore implements ThesisStore {
  readonly kind = 'redis' as const;

  constructor(private readonly config: RedisConfig) {}

  async list(): Promise<ThesisRecord[]> {
    const ids = await command<string[]>(this.config, ['SMEMBERS', INDEX_KEY]);
    if (!ids || ids.length === 0) return [];

    const raw = await command<Array<string | null>>(this.config, [
      'MGET',
      ...ids.map((id) => KEY_PREFIX + id),
    ]);

    const found = raw.map(parse).filter((t): t is ThesisRecord => t !== null);
    // Newest first — the list screen shows most-recent work at the top.
    return found.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<ThesisRecord | null> {
    return parse(await command<string | null>(this.config, ['GET', KEY_PREFIX + id]));
  }

  async put(thesis: ThesisRecord): Promise<void> {
    const record = trim(thesis);
    await command(this.config, ['SET', KEY_PREFIX + record.id, JSON.stringify(record)]);
    await command(this.config, ['SADD', INDEX_KEY, record.id]);
  }

  async remove(id: string): Promise<void> {
    await command(this.config, ['DEL', KEY_PREFIX + id]);
    await command(this.config, ['SREM', INDEX_KEY, id]);
  }
}

// ---------------------------------------------------------------------------
// In-memory, for local development and the self-test.
//
// On a serverless deploy this survives exactly as long as one warm instance,
// which is why `storeStatus()` reports it loudly rather than letting the app
// pretend it has a memory it does not have.
// ---------------------------------------------------------------------------

class MemoryStore implements ThesisStore {
  readonly kind = 'memory' as const;
  private readonly records = new Map<string, ThesisRecord>();

  async list(): Promise<ThesisRecord[]> {
    return [...this.records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<ThesisRecord | null> {
    return this.records.get(id) ?? null;
  }

  async put(thesis: ThesisRecord): Promise<void> {
    // Clone on write so a caller mutating its copy cannot silently rewrite
    // history that is meant to be append-only.
    this.records.set(thesis.id, structuredClone(trim(thesis)));
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id);
  }
}

// ---------------------------------------------------------------------------

let cached: ThesisStore | null = null;

export function getStore(): ThesisStore {
  if (cached) return cached;
  const config = redisConfig();
  cached = config ? new RedisStore(config) : new MemoryStore();
  return cached;
}

/** For the self-test: a fresh store with no shared state. */
export function createMemoryStore(): ThesisStore {
  return new MemoryStore();
}

/**
 * What the diagnostics route reports.
 *
 * `persisted: false` is a real warning, not a detail. It means the 24/7 claim
 * is not true on this deployment, and the app should say so rather than show a
 * "last checked" time that will vanish with the next cold start.
 */
export function storeStatus(): { kind: StoreKind; persisted: boolean; detail: string } {
  const kind = getStore().kind;
  return kind === 'redis'
    ? { kind, persisted: true, detail: 'Upstash Redis — theses and check history survive restarts' }
    : {
        kind,
        persisted: false,
        detail:
          'in-memory only — set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to keep theses between restarts',
      };
}
