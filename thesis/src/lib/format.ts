/**
 * How the product talks about time.
 *
 * This is a trust surface, not a formatting detail. The whole claim of the
 * product is that something looked at your thesis while you were asleep, and
 * the only evidence a reader has of that is a number on a screen saying when.
 * A number that flatters itself here discredits everything above it.
 */

/** Anything older than this is called out rather than shown as current. */
export const STALE_AFTER_MS = 45 * 60 * 1000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "12 min ago". Always ROUNDED DOWN, never up.
 *
 * 59 minutes reads "59 min ago" and never "an hour ago". Somebody deciding
 * whether this data is current must not be handed a number that is older than
 * the truth — and rounding up is precisely the direction that flatters us,
 * which is the direction to refuse.
 */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'at an unknown time';

  const ms = now - then;
  // A clock skew between the server and the browser can put a stored timestamp
  // slightly in the future. "in 3 seconds" would look broken; "just now" is
  // both true enough and not a claim about the past.
  if (ms < MINUTE) return 'just now';

  if (ms < HOUR) {
    const mins = Math.floor(ms / MINUTE);
    return `${mins} min ago`;
  }
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(ms / DAY);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Has the loop stopped?
 *
 * 45 minutes is three missed cycles at the 15-minute cadence — long enough not
 * to fire on one slow run, short enough that a dead cron is caught within the
 * hour. A "last checked" time that has quietly gone stale is the one failure
 * this product cannot afford to hide, so the card says so in amber rather than
 * styling the problem away.
 */
export function isStale(iso: string | null, now: number = Date.now()): boolean {
  if (!iso) return false;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return false;
  return now - then > STALE_AFTER_MS;
}

/** "16 Sept 2026". Written out, because 09/16 and 16/09 are different dates. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown date';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "16 Sept, 23:37 UTC" — for a log, where the time of day is the point. */
export function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown time';
  const day = date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const time = date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  return `${day}, ${time} UTC`;
}
