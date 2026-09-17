/**
 * Self-test for the market-hours gate.
 *
 *   npm run session:selftest
 *
 * No network. The Skill call itself fails open and a failure is visible as an
 * absent strip, so it is not the risky part. The gate is.
 *
 * Get it wrong in one direction and a panel saying "while New York is shut"
 * sits on screen at 11am on a Tuesday, which is a statement about the market
 * that is simply false. Get it wrong in the other and the one feature that
 * uses a Bitget Skill never appears.
 *
 * The trap underneath it is the offset. New York is UTC-5 for part of the year
 * and UTC-4 for the rest, so anything built on a fixed offset is correct for
 * about half the year and wrong in a way nobody notices until March. Both
 * sides of the DST boundary are tested below with real instants.
 */
import { describeGap, usMarketState } from '../lib/market-hours';

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** An instant, stated in UTC, so no test depends on the machine's zone. */
function utc(iso: string): Date {
  return new Date(iso);
}

// ---------------------------------------------------------------------------
// Winter, when New York is UTC-5
// ---------------------------------------------------------------------------

console.log('\nwinter, EST, New York is UTC-5');

// 2026-01-14 is a Wednesday.
check('09:29 ET is still shut', !usMarketState(utc('2026-01-14T14:29:00Z')).open);
check('09:30 ET is open', usMarketState(utc('2026-01-14T14:30:00Z')).open);
check('12:00 ET is open', usMarketState(utc('2026-01-14T17:00:00Z')).open);
check('15:59 ET is open', usMarketState(utc('2026-01-14T20:59:00Z')).open);
check('16:00 ET is shut', !usMarketState(utc('2026-01-14T21:00:00Z')).open);
check('20:00 ET is shut', !usMarketState(utc('2026-01-15T01:00:00Z')).open);

// ---------------------------------------------------------------------------
// Summer, when New York is UTC-4
//
// THE POINT OF THIS SECTION: 13:30Z is the open in July and is half an hour
// BEFORE the open in January. A fixed offset cannot produce both.
// ---------------------------------------------------------------------------

console.log('\nsummer, EDT, New York is UTC-4');

// 2026-07-15 is a Wednesday.
check('13:29Z is still shut', !usMarketState(utc('2026-07-15T13:29:00Z')).open);
check('13:30Z is open', usMarketState(utc('2026-07-15T13:30:00Z')).open);
check('19:59Z is open', usMarketState(utc('2026-07-15T19:59:00Z')).open);
check('20:00Z is shut', !usMarketState(utc('2026-07-15T20:00:00Z')).open);

check(
  'the same UTC instant differs by season, which a fixed offset cannot do',
  usMarketState(utc('2026-07-15T13:45:00Z')).open && !usMarketState(utc('2026-01-14T13:45:00Z')).open,
);

// ---------------------------------------------------------------------------
// The weekend, which is the longest stretch the strip has to describe
// ---------------------------------------------------------------------------

console.log('\nthe weekend');

// 2026-09-19 is a Saturday, 2026-09-20 a Sunday, 2026-09-18 a Friday.
check('Saturday midday is shut', !usMarketState(utc('2026-09-19T16:00:00Z')).open);
check('Sunday midday is shut', !usMarketState(utc('2026-09-20T16:00:00Z')).open);
check('Sunday 13:30Z is shut, not treated as an open', !usMarketState(utc('2026-09-20T13:30:00Z')).open);

// ---------------------------------------------------------------------------
// How long until it changes
// ---------------------------------------------------------------------------

console.log('\nminutes until the state flips');

const midSession = usMarketState(utc('2026-09-16T17:00:00Z')); // Wed 13:00 ET
check('while open, it counts down to the close', midSession.open && midSession.minutesUntilChange === 180, String(midSession.minutesUntilChange));

const afterBell = usMarketState(utc('2026-09-16T21:00:00Z')); // Wed 17:00 ET
check(
  'after the bell, it counts to the next morning',
  !afterBell.open && afterBell.minutesUntilChange === 16 * 60 + 30,
  String(afterBell.minutesUntilChange),
);

const preMarket = usMarketState(utc('2026-09-16T12:00:00Z')); // Wed 08:00 ET
check(
  'before the bell, it counts to the same day',
  !preMarket.open && preMarket.minutesUntilChange === 90,
  String(preMarket.minutesUntilChange),
);

const fridayNight = usMarketState(utc('2026-09-18T21:00:00Z')); // Fri 17:00 ET
check(
  'Friday evening skips the weekend entirely',
  fridayNight.minutesUntilChange === 16 * 60 + 30 + 2 * 24 * 60,
  String(fridayNight.minutesUntilChange),
);

const saturday = usMarketState(utc('2026-09-19T16:00:00Z')); // Sat 12:00 ET
check(
  'Saturday counts through Sunday to Monday',
  saturday.minutesUntilChange === 12 * 60 + 24 * 60 + 9 * 60 + 30,
  String(saturday.minutesUntilChange),
);

check('the gap is never negative', [
  '2026-01-14T14:30:00Z',
  '2026-09-18T21:00:00Z',
  '2026-09-19T16:00:00Z',
  '2026-09-20T13:30:00Z',
  '2026-07-15T19:59:00Z',
].every((iso) => usMarketState(utc(iso)).minutesUntilChange >= 0));

// ---------------------------------------------------------------------------
// The sentence it produces
// ---------------------------------------------------------------------------

console.log('\nhow the gap reads');

check('under 90 minutes stays in minutes', describeGap(40) === '40 minutes', describeGap(40));
check('a couple of hours reads as hours', describeGap(180) === '3 hours', describeGap(180));
check('overnight reads as hours', describeGap(16 * 60 + 30) === '17 hours', describeGap(16 * 60 + 30));
check('a weekend reads as days', describeGap(2 * 24 * 60 + 990) === '3 days', describeGap(2 * 24 * 60 + 990));
check('it never says zero minutes', describeGap(0) === '1 minute', describeGap(0));
check('one minute is singular', describeGap(1) === '1 minute', describeGap(1));

/*
  An hour still reads in minutes, because the switch is at 90 rather than 60.
  Deliberate: "90 minutes" is a more useful thing to read than "2 hours" when
  the bell is what you are waiting for, and rounding 90 up to 2 hours overstates
  the wait by a third.

  A consequence worth writing down: the singular branch is only ever reachable
  for minutes. 1 hour needs round(minutes/60) to be 1 with minutes at least 90,
  and 1 day needs round(hours/24) to be 1 with hours at least 36. Neither is
  possible, so "1 hours" cannot appear however hard this is poked.
*/
check('an hour still reads in minutes', describeGap(60) === '60 minutes', describeGap(60));
check('the switch to hours is at 90 minutes', describeGap(90) === '2 hours', describeGap(90));
check('no gap can produce a singular hour or day', [90, 91, 120, 2160, 2161, 3000].every((m) => !/1 (hour|day)/.test(describeGap(m))));

// ---------------------------------------------------------------------------
// Holidays are NOT handled, and that is recorded rather than hidden
// ---------------------------------------------------------------------------

console.log('\nthe known gap');

// 2026-11-26 is Thanksgiving, a Thursday. The market is shut; this says open.
const holiday = usMarketState(utc('2026-11-26T17:00:00Z'));
check(
  'a market holiday is reported as open, which HIDES the strip rather than lying in it',
  holiday.open,
  'if this ever fails, a holiday calendar was added and this test should be rewritten',
);

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
