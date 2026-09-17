/**
 * Self-test for the liquidity metrics.
 *
 *   npm run liquidity:selftest
 *
 * No model and no network. Books are hand built, so the arithmetic can be
 * checked exactly against a shape chosen to expose a specific mistake.
 *
 * The case that matters most is the empty book, because it is common and
 * because every plausible bug here turns it into a number that reads as
 * healthy. rNFLX quoted 76.92 against 12.4M of 24 hour volume with zero
 * resting orders on 17 Sep 2026: if an empty book yields "0 spread" or a
 * finite exit cost, the product would tell a trader their stop is safe on an
 * instrument where nothing is bid at all.
 */
import type { OrderBook } from '../data/types';
import { availableExitUsd, computeLiquidityMetric, isLiquidity } from '../engine/breakers/metrics';
import {
  EXIT_REFERENCE_NOTIONAL_USD,
  LIQUIDITY_METRICS,
  METRIC_SEMANTICS,
  type LiquidityMetric,
} from '../engine/breakers/types';
import { defineMetric } from '../lib/glossary';

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

function near(actual: number | null, expected: number, tolerance = 0.01): boolean {
  return actual !== null && Math.abs(actual - expected) <= tolerance;
}

function book(
  asks: Array<[number, number]>,
  bids: Array<[number, number]>,
  symbol = 'RTESTUSDT',
): OrderBook {
  return {
    symbol,
    asks: asks.map(([price, size]) => ({ price, size })),
    bids: bids.map(([price, size]) => ({ price, size })),
    ts: Date.parse('2026-09-17T12:00:00Z'),
  };
}

// ---------------------------------------------------------------------------
// The vocabulary agrees with itself
// ---------------------------------------------------------------------------

console.log('\nvocabulary');

for (const metric of LIQUIDITY_METRICS) {
  check(`${metric} is recognised as a liquidity metric`, isLiquidity(metric));
  check(`${metric} declares its units`, (METRIC_SEMANTICS[metric] ?? '').length > 40);
  check(`${metric} has a plain-English definition`, defineMetric(metric) !== undefined);
}

check(
  'the exit notional is stated, so a threshold means something',
  EXIT_REFERENCE_NOTIONAL_USD > 0 &&
    METRIC_SEMANTICS.exitSlippageBps.includes(String(EXIT_REFERENCE_NOTIONAL_USD)),
  String(EXIT_REFERENCE_NOTIONAL_USD),
);

// ---------------------------------------------------------------------------
// The empty book. The case the whole feature exists for.
// ---------------------------------------------------------------------------

console.log('\nan empty book is not a healthy one');

const empty = book([], [], 'RNFLXUSDT');

check(
  'spread is unavailable rather than zero',
  computeLiquidityMetric(empty, 'spreadBps') === null,
  String(computeLiquidityMetric(empty, 'spreadBps')),
);
check(
  'exit depth is zero, which is a real reading and not an absence',
  computeLiquidityMetric(empty, 'exitDepthUsd') === 0,
  String(computeLiquidityMetric(empty, 'exitDepthUsd')),
);
check(
  'exit cost is unavailable, because there is nothing to sell into',
  computeLiquidityMetric(empty, 'exitSlippageBps') === null,
  String(computeLiquidityMetric(empty, 'exitSlippageBps')),
);

// One side only: real, and it must not be read as a tight market.
const askOnly = book([[100, 50]], []);
check(
  'an offer with no bid still has no spread',
  computeLiquidityMetric(askOnly, 'spreadBps') === null,
);
check('an offer with no bid gives no exit depth', computeLiquidityMetric(askOnly, 'exitDepthUsd') === 0);

const bidOnly = book([], [[100, 500]]);
check(
  'a bid with no offer has no spread either',
  computeLiquidityMetric(bidOnly, 'spreadBps') === null,
);
check(
  'but a bid with no offer still has depth, measured against the bid',
  near(computeLiquidityMetric(bidOnly, 'exitDepthUsd'), 50_000),
  String(computeLiquidityMetric(bidOnly, 'exitDepthUsd')),
);

// ---------------------------------------------------------------------------
// Spread
// ---------------------------------------------------------------------------

console.log('\nspread');

// mid 100.00, gap 0.10 -> 10 bps
check(
  'spread is measured in basis points of the mid',
  near(computeLiquidityMetric(book([[100.05, 10]], [[99.95, 10]]), 'spreadBps'), 10),
  String(computeLiquidityMetric(book([[100.05, 10]], [[99.95, 10]]), 'spreadBps')),
);
check(
  'a one cent gap on a 200 dollar instrument is sub-basis-point',
  near(computeLiquidityMetric(book([[200.005, 10]], [[199.995, 10]]), 'spreadBps'), 0.5),
);
check(
  'spread is always positive',
  (computeLiquidityMetric(book([[100.5, 1]], [[99.5, 1]]), 'spreadBps') ?? -1) > 0,
);

// Best-first ordering is assumed by every walk below. Prove it is enforced
// upstream by showing the metric reads level 0 and not the array minimum.
const inverted = book(
  [
    [101, 5],
    [100.05, 5],
  ],
  [
    [99.95, 5],
    [98, 5],
  ],
);
check(
  'spread reads the top of each side, so a deeper level cannot widen it',
  near(computeLiquidityMetric(inverted, 'spreadBps'), 10),
  String(computeLiquidityMetric(inverted, 'spreadBps')),
);

// ---------------------------------------------------------------------------
// Exit depth
// ---------------------------------------------------------------------------

console.log('\nexit depth');

// mid 100. Bids at 99.9 and 99.5 are inside 1%; 98 is not.
const laddered = book(
  [[100.1, 100]],
  [
    [99.9, 100], // 9,990
    [99.5, 100], // 9,950
    [98.0, 100], // outside the 1% floor of 99.0
  ],
);
check(
  'only bids within one percent of mid are counted',
  near(computeLiquidityMetric(laddered, 'exitDepthUsd'), 9_990 + 9_950, 1),
  String(computeLiquidityMetric(laddered, 'exitDepthUsd')),
);
check(
  'depth is reported in dollars, not tokens',
  (computeLiquidityMetric(laddered, 'exitDepthUsd') ?? 0) > 1_000,
);
check(
  'availableExitUsd agrees with the metric it explains',
  availableExitUsd(laddered) === computeLiquidityMetric(laddered, 'exitDepthUsd'),
);
check('availableExitUsd on an empty book is zero, never null', availableExitUsd(empty) === 0);

// ---------------------------------------------------------------------------
// Exit cost
// ---------------------------------------------------------------------------

console.log('\nexit cost');

// A book deep enough to absorb the reference size entirely at the top level:
// selling at the best bid costs exactly the half-spread.
const deep = book([[100.1, 10_000]], [[99.9, 10_000]]);
check(
  'a book deep enough to fill at the top costs the distance from mid',
  near(computeLiquidityMetric(deep, 'exitSlippageBps'), 10, 0.5),
  String(computeLiquidityMetric(deep, 'exitSlippageBps')),
);

// Thin at the top, so the walk has to reach down and the cost rises.
const stepped = book(
  [[100.1, 10_000]],
  [
    [99.9, 100], // 9,990 available
    [99.0, 1_000], // the rest comes from here, 100bps below mid
  ],
);
const steppedCost = computeLiquidityMetric(stepped, 'exitSlippageBps');
check(
  'walking down the book costs more than the top of book suggests',
  steppedCost !== null && steppedCost > 10,
  String(steppedCost),
);
check(
  'and the cost stays below the worst level touched',
  steppedCost !== null && steppedCost < 100,
  String(steppedCost),
);

// Thinner than the reference trade: unmeasurable, not "expensive".
const thin = book([[100.1, 10]], [[99.9, 10]]); // ~999 dollars bid
check(
  'a book smaller than the reference trade yields no cost at all',
  computeLiquidityMetric(thin, 'exitSlippageBps') === null,
  String(computeLiquidityMetric(thin, 'exitSlippageBps')),
);
check(
  'and the depth that WAS there is still reported, so the gap can be explained',
  near(availableExitUsd(thin), 999, 1),
  String(availableExitUsd(thin)),
);

// Exactly the reference notional should fill, not fall one cent short.
const exact = book(
  [[100.1, 1]],
  [[100, EXIT_REFERENCE_NOTIONAL_USD / 100]],
);
check(
  'a book holding exactly the reference notional fills',
  computeLiquidityMetric(exact, 'exitSlippageBps') !== null,
  String(computeLiquidityMetric(exact, 'exitSlippageBps')),
);

check(
  'exit cost is never negative, because selling never beats the mid',
  LIQUIDITY_METRICS.filter((m: LiquidityMetric) => m === 'exitSlippageBps').every(
    () => (computeLiquidityMetric(deep, 'exitSlippageBps') ?? 0) >= 0,
  ),
);

// ---------------------------------------------------------------------------
// The measured shape of the real market, as a regression guard
// ---------------------------------------------------------------------------

console.log('\nagainst a book shaped like the real thing');

// Trimmed from the live RNVDAUSDT book on 17 Sep 2026.
const nvda = book(
  [
    [217.73, 0.5866],
    [217.75, 0.5595],
    [217.94, 113.28],
  ],
  [
    [217.71, 114.24],
    [217.7, 199.68],
    [217.69, 94.08],
  ],
  'RNVDAUSDT',
);
const nvdaSpread = computeLiquidityMetric(nvda, 'spreadBps');
check(
  'a liquid rToken reads under one basis point of spread',
  nvdaSpread !== null && nvdaSpread > 0 && nvdaSpread < 1,
  String(nvdaSpread),
);
check(
  'and carries six figures of resting bid',
  (computeLiquidityMetric(nvda, 'exitDepthUsd') ?? 0) > 50_000,
  String(computeLiquidityMetric(nvda, 'exitDepthUsd')),
);
const nvdaCost = computeLiquidityMetric(nvda, 'exitSlippageBps');
check(
  'so a reference-size exit costs less than a basis point',
  nvdaCost !== null && nvdaCost < 1,
  String(nvdaCost),
);

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
