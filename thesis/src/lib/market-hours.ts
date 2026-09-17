/**
 * Whether the US equity market is open, and how long until that changes.
 *
 * ## Why this exists
 *
 * An rToken is an equity wrapper trading against USDT on a crypto venue, and
 * it trades around the clock. The underlying equity does not. For roughly two
 * thirds of every weekday and the whole weekend, the market that is supposed to
 * price NVDA is shut and rNVDA is still changing hands.
 *
 * That gap is the entire reason this hackathon has a theme, and it is the one
 * moment where crypto market context is genuinely information about an equity
 * position rather than a stretch. So the session strip is gated on this: it
 * appears when New York is shut and disappears when it opens.
 *
 * ## What it does not handle, deliberately
 *
 * Market holidays. There is no holiday calendar here, so on Thanksgiving this
 * reports the market as open and the strip stays hidden.
 *
 * That is the safe direction and it is why it was left out. A missing holiday
 * costs a strip nobody sees. A holiday calendar that goes stale would state
 * confidently that New York is trading when it is not, which is the kind of
 * plausible wrong claim this whole product exists to refuse. Half-days are
 * wrong in the same harmless direction.
 *
 * Nothing downstream is allowed to derive a tripwire from this, so being
 * conservative costs nothing anyone can measure.
 */

/** Regular session, New York wall clock, in minutes from midnight. */
const OPEN_MINUTE = 9 * 60 + 30; // 09:30
const CLOSE_MINUTE = 16 * 60; //    16:00

export interface MarketState {
  /** True only during the regular session on a weekday. */
  open: boolean;
  /** Day of week in New York, 0 Sunday through 6 Saturday. */
  weekday: number;
  /** Minutes from New York midnight, so a test can state a time plainly. */
  minute: number;
  /**
   * Minutes until the state flips: until the close when open, until the next
   * open when shut. Crosses weekends.
   */
  minutesUntilChange: number;
}

/**
 * New York wall clock for an instant, via Intl rather than an offset.
 *
 * The offset is not a constant. New York is UTC-5 for part of the year and
 * UTC-4 for the rest, the switch dates move, and they do not line up with any
 * other market's. Subtracting a hardcoded five hours is right for about half
 * the year, which is worse than being wrong all of it because the bug only
 * appears in March.
 */
function newYorkParts(at: Date): { weekday: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  // hour12:false can render midnight as "24" on some platforms.
  const hour = Number(get('hour')) % 24;
  return { weekday: days[get('weekday')] ?? 0, minute: hour * 60 + Number(get('minute')) };
}

/** Minutes from now until the next weekday open, counting whole days over. */
function minutesUntilNextOpen(weekday: number, minute: number): number {
  // Before the bell on a weekday: it opens later today.
  if (weekday >= 1 && weekday <= 5 && minute < OPEN_MINUTE) return OPEN_MINUTE - minute;

  // Otherwise the next open is on a following day. Walk forward to a weekday.
  let daysAhead = 1;
  while (((weekday + daysAhead) % 7 === 0) || ((weekday + daysAhead) % 7 === 6)) daysAhead++;

  const minutesLeftToday = 24 * 60 - minute;
  return minutesLeftToday + (daysAhead - 1) * 24 * 60 + OPEN_MINUTE;
}

export function usMarketState(at: Date = new Date()): MarketState {
  const { weekday, minute } = newYorkParts(at);
  const weekend = weekday === 0 || weekday === 6;
  const open = !weekend && minute >= OPEN_MINUTE && minute < CLOSE_MINUTE;

  return {
    open,
    weekday,
    minute,
    minutesUntilChange: open ? CLOSE_MINUTE - minute : minutesUntilNextOpen(weekday, minute),
  };
}

/**
 * "15 hours", "40 minutes", "2 days" — for a sentence, not a countdown.
 *
 * Rounded and deliberately coarse. The exact minute New York reopens is not
 * the point being made, and a ticking number would suggest a precision that
 * the holiday gap above does not support.
 */
export function describeGap(minutes: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

  if (minutes < 90) return plural(Math.max(1, Math.round(minutes)), 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 36) return plural(hours, 'hour');
  return plural(Math.round(hours / 24), 'day');
}
