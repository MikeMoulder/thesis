import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Rate limiting for free-tier model quotas.
 *
 * This exists because the binding constraint on this project is requests per
 * DAY, not tokens. A Gemini free-tier Flash model allows 20 RPD; one full
 * THESIS run costs 6-12 primary-model calls. Without accounting, you discover
 * you are out of quota in the middle of a demo.
 *
 * Two independent limits:
 *   RPM — enforced by spacing requests, since bursts are what trip it
 *   RPD — enforced by a counter persisted to disk, so restarting the process
 *         does not hand you a fresh (and false) allowance
 */

export interface Limits {
  /** Requests per minute. 0 disables the check. */
  rpm: number;
  /** Requests per day. 0 disables the check. */
  rpd: number;
}

export class QuotaExceededError extends Error {
  constructor(
    message: string,
    readonly key: string,
    readonly used: number,
    readonly limit: number,
  ) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

interface DayRecord {
  day: string;
  counts: Record<string, number>;
}

const STATE_DIR = process.env.THESIS_STATE_DIR ?? join(process.cwd(), '.thesis');
const STATE_FILE = join(STATE_DIR, 'quota.json');

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function load(): DayRecord {
  try {
    if (existsSync(STATE_FILE)) {
      const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as DayRecord;
      // A record from a previous day is stale; start the new day at zero.
      if (parsed.day === today()) return parsed;
    }
  } catch {
    // A corrupt counter should not stop the app. Worst case we under-count
    // for one day, which fails safe toward doing work rather than blocking it.
  }
  return { day: today(), counts: {} };
}

function save(record: DayRecord): void {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(record, null, 2));
  } catch {
    // Non-fatal: in-memory counting still applies for this process.
  }
}

export class RateLimiter {
  private record: DayRecord = load();
  private lastCallAt = new Map<string, number>();
  /** Serialises spacing per key so concurrent callers queue instead of racing. */
  private chain = new Map<string, Promise<void>>();

  constructor(private readonly limits: Map<string, Limits>) {}

  /** Requests used today for a key, and its ceiling. */
  usage(key: string): { used: number; limit: number } {
    this.rollDay();
    return { used: this.record.counts[key] ?? 0, limit: this.limits.get(key)?.rpd ?? 0 };
  }

  /** Every key's usage, for the health/preflight report. */
  allUsage(): Array<{ key: string; used: number; limit: number }> {
    this.rollDay();
    return [...this.limits.keys()].map((key) => ({ key, ...this.usage(key) }));
  }

  /**
   * Wait until it is safe to make a call on `key`, then record it.
   * Throws QuotaExceededError rather than sleeping when the daily cap is hit —
   * waiting hours is never the behaviour a caller wants.
   */
  async acquire(key: string): Promise<void> {
    const limits = this.limits.get(key);
    if (!limits) return;

    this.rollDay();

    if (limits.rpd > 0) {
      const used = this.record.counts[key] ?? 0;
      if (used >= limits.rpd) {
        throw new QuotaExceededError(
          `Daily quota exhausted for "${key}": ${used}/${limits.rpd} requests used today. ` +
            `Switch to a higher-RPD model or wait for the quota to reset.`,
          key,
          used,
          limits.rpd,
        );
      }
    }

    if (limits.rpm > 0) {
      await this.space(key, Math.ceil(60_000 / limits.rpm));
    }

    this.record.counts[key] = (this.record.counts[key] ?? 0) + 1;
    save(this.record);
  }

  /** Queue on `key` so N concurrent callers are spaced, not just delayed once. */
  private space(key: string, minGapMs: number): Promise<void> {
    const prior = this.chain.get(key) ?? Promise.resolve();
    const next = prior.then(async () => {
      const last = this.lastCallAt.get(key) ?? 0;
      const wait = last + minGapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCallAt.set(key, Date.now());
    });
    this.chain.set(key, next);
    return next;
  }

  private rollDay(): void {
    if (this.record.day !== today()) {
      this.record = { day: today(), counts: {} };
      save(this.record);
    }
  }
}
