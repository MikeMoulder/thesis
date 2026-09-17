/**
 * Self-test for signal derivation.
 *
 *   npm run derive:selftest
 *
 * No model and no network, because there is no model to mock: nothing in this
 * path calls one. What needs proving is the arithmetic, and arithmetic is
 * exactly the kind of wrong that renders beautifully.
 *
 * The dangerous cases, all of which produce a plausible number:
 *
 *   A drawdown level recovered from the wrong anchor. The high is derived
 *   backwards out of the current reading, and inverting that the wrong way
 *   gives a stop that is off by the square of the drawdown and still looks
 *   like a price.
 *
 *   A size cap computed from a book that cannot fill. exitDepthUsd of zero is
 *   a real measurement, not missing data, and multiplying it by a
 *   participation rate gives zero, which is correct and must be SAID rather
 *   than rendered as a quiet dash.
 *
 *   A thesis with no price tripwire at all. The honest output is a refusal,
 *   and the failure mode is silently returning an empty list that the screen
 *   renders as though nothing were wrong.
 */
import { deriveSignal, MAX_DEPTH_PARTICIPATION, type SignalInput } from '../engine/signal';
import type { Evaluation } from '../engine/breakers/evaluate';
import type { BreakerSet, Metric, Operator, ThesisBreaker } from '../engine/breakers/types';

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

/**
 * Within a cent. Floating point should not fail an arithmetic assertion.
 *
 * Both sides accept undefined and a missing one fails, because a check that
 * silently passes on absent data is worse than no check: every assertion here
 * exists to catch a number that is present and wrong.
 */
function near(a: number | undefined, b: number | undefined, tolerance = 0.01): boolean {
  if (a === undefined || b === undefined) return false;
  return Math.abs(a - b) <= tolerance;
}

function breaker(
  id: string,
  metric: Metric,
  operator: Operator,
  threshold: number,
  cadence: ThesisBreaker['cadence'] = 'continuous',
): ThesisBreaker {
  return {
    id,
    assumptionRef: 'A1',
    statement: `${metric} ${operator} ${threshold}`,
    severity: 'high',
    severityInherited: true,
    kind: 'threshold',
    metric,
    operator,
    threshold,
    cadence,
  } as ThesisBreaker;
}

function evaluation(breakerId: string, metric: Metric, observed: number): Evaluation {
  return { breakerId, mode: 'live', status: 'holding', metric, observed } as Evaluation;
}

function set(breakers: ThesisBreaker[], uncoveredHighLoad: string[] = []): BreakerSet {
  return {
    ticker: 'NVDA',
    breakers,
    uncovered: [],
    summary: {
      total: breakers.length,
      byCadence: { continuous: 0, event: 0, periodic: 0 },
      quietUntilEarnings: false,
      uncoveredHighLoad,
    },
    meta: { model: 'test', latencyMs: 0, generatedAt: '2026-09-17T00:00:00.000Z' },
  } as BreakerSet;
}

function input(over: Partial<SignalInput> = {}): SignalInput {
  return {
    ticker: 'NVDA',
    direction: 'bullish',
    breakerSet: set([]),
    evaluations: [],
    price: 216.85,
    rTokenSymbol: 'RNVDAUSDT',
    ...over,
  };
}

// ---------------------------------------------------------------------------

function absolutePrice(): void {
  console.log('\nlevels: an absolute price tripwire');

  const b = breaker('B1', 'price', '<', 180);
  const signal = deriveSignal(input({ breakerSet: set([b]) }));

  check('a price tripwire produces a level', signal.levels.length === 1);
  check('the level is the threshold itself', near(signal.levels[0]?.price, 180));
  check('a price level is fixed', signal.levels[0]?.stability === 'fixed');
  check(
    'the distance is measured from the live price',
    near(signal.levels[0]?.distancePct, ((180 - 216.85) / 216.85) * 100, 0.01),
    String(signal.levels[0]?.distancePct),
  );
}

function drawdownLevel(): void {
  console.log('\nlevels: a drawdown tripwire, derived backwards');

  // Price 216.85 sitting 7.8% below its high puts the high at 235.20.
  // Thirty percent below THAT high is 164.64.
  const b = breaker('B1', 'drawdownFromHigh', '<', -30);
  const signal = deriveSignal(
    input({
      breakerSet: set([b]),
      evaluations: [evaluation('B1', 'drawdownFromHigh', -7.8)],
    }),
  );

  const high = 216.85 / (1 - 0.078);
  const expected = high * 0.7;

  check('a drawdown tripwire produces a level', signal.levels.length === 1);
  check(
    'the high is recovered from the current reading',
    near(signal.levels[0]?.price, expected, 0.02),
    `got ${signal.levels[0]?.price}, expected ${expected.toFixed(2)}`,
  );

  // The specific wrong answer this guards: applying the threshold to the
  // CURRENT price instead of to the recovered high. It is off by 12 dollars
  // and looks entirely reasonable.
  check(
    'the threshold is NOT applied to the live price',
    !near(signal.levels[0]?.price, 216.85 * 0.7, 0.02),
    `${signal.levels[0]?.price} must not equal ${(216.85 * 0.7).toFixed(2)}`,
  );

  check('a drawdown level moves with the high', signal.levels[0]?.stability === 'moves-with-high');
  check('the derivation shows the high it used', signal.levels[0]?.derivation.includes('235.2') === true, signal.levels[0]?.derivation);

  // A thesis already at its high has a drawdown of zero, and the maths must
  // not divide by anything that makes that explode.
  const atHigh = deriveSignal(
    input({ breakerSet: set([b]), evaluations: [evaluation('B1', 'drawdownFromHigh', 0)] }),
  );
  check('a stock at its high still derives a level', near(atHigh.levels[0]?.price, 216.85 * 0.7, 0.02));
}

function rollingLevel(): void {
  console.log('\nlevels: a rolling return tripwire');

  const b = breaker('B1', 'return30d', '<', -20);
  const signal = deriveSignal(
    input({ breakerSet: set([b]), evaluations: [evaluation('B1', 'return30d', 10)] }),
  );

  const anchor = 216.85 / 1.1;
  check('a rolling return produces a level', signal.levels.length === 1);
  check('the anchor is the price at the start of the window', near(signal.levels[0]?.price, anchor * 0.8, 0.02));
  check('a rolling level is marked as moving daily', signal.levels[0]?.stability === 'moves-daily');
  check(
    'the derivation warns it is only true today',
    signal.levels[0]?.derivation.includes('only true today') === true,
  );
}

function noLevel(): void {
  console.log('\nlevels: what has no price, and the refusal');

  // Volatility, valuation and fundamentals imply no price whatsoever.
  const signal = deriveSignal(
    input({
      breakerSet: set([
        breaker('B1', 'volatility90d', '>', 50),
        breaker('B2', 'grossMargin', '<', 50, 'periodic'),
        breaker('B3', 'trailingPE', '>', 150),
      ]),
      evaluations: [
        evaluation('B1', 'volatility90d', 39.7),
        evaluation('B2', 'grossMargin', 74.98),
        evaluation('B3', 'trailingPE', 27.6),
      ],
    }),
  );

  check('no price level is invented for volatility', signal.levels.length === 0);
  check('there is no nearest level', signal.nearest === null);
  check(
    'the refusal is stated as a caveat',
    signal.caveats.some((c) => c.includes('no level at which your own reasoning says')),
    signal.caveats.join(' | '),
  );
  check(
    'the headline says so rather than printing a number',
    signal.headline.includes('no price-based invalidation'),
    signal.headline,
  );

  const missing = deriveSignal(input({ breakerSet: set([breaker('B1', 'drawdownFromHigh', '<', -30)]), evaluations: [] }));
  check('a tripwire with no reading produces no level', missing.levels.length === 0);
}

function ordering(): void {
  console.log('\nlevels: ordering and nearest');

  const signal = deriveSignal(
    input({
      breakerSet: set([
        breaker('B1', 'price', '<', 120),
        breaker('B2', 'price', '<', 200),
        breaker('B3', 'price', '<', 60),
      ]),
    }),
  );

  check('every price tripwire produces a level', signal.levels.length === 3);
  check('the closest level is first', near(signal.levels[0]?.price, 200), String(signal.levels[0]?.price));
  check('the furthest level is last', near(signal.levels[2]?.price, 60));
  check('nearest is the closest one', near(signal.nearest?.level.price, 200));
  check(
    'risk is the distance to the nearest, not the furthest',
    near(signal.nearest?.riskPct, ((216.85 - 200) / 216.85) * 100, 0.01),
    String(signal.nearest?.riskPct),
  );
}

function sizing(): void {
  console.log('\nsize: the cap comes from the book');

  const withDepth = deriveSignal(
    input({
      breakerSet: set([breaker('B1', 'exitDepthUsd', '<', 25000)]),
      evaluations: [
        evaluation('B1', 'exitDepthUsd', 57355.08),
        { breakerId: 'B2', mode: 'live', status: 'holding', metric: 'exitSlippageBps', observed: 3.26 } as Evaluation,
      ],
    }),
  );

  check('the measured depth is carried through', near(withDepth.size?.exitDepthUsd, 57355.08));
  check(
    'the cap is the stated share of it',
    near(withDepth.size?.maxNotionalUsd, 57355.08 * MAX_DEPTH_PARTICIPATION, 0.02),
    String(withDepth.size?.maxNotionalUsd),
  );
  check('the slippage reading travels with it', near(withDepth.size?.slippageBps, 3.26));

  // An empty book is a real measurement and the single most important one.
  const empty = deriveSignal(
    input({
      breakerSet: set([breaker('B1', 'exitDepthUsd', '<', 25000)]),
      evaluations: [evaluation('B1', 'exitDepthUsd', 0)],
    }),
  );
  check('an empty book caps size at zero', empty.size?.maxNotionalUsd === 0);
  check('an empty book is not tradable', empty.tradable === false);
  check(
    'an empty book says no size is safe',
    empty.size?.note.includes('No size is safe') === true,
    empty.size?.note,
  );
  check(
    'the headline leads with the missing bid',
    empty.headline.includes('no bid'),
    empty.headline,
  );

  const unread = deriveSignal(input({ breakerSet: set([breaker('B1', 'price', '<', 180)]) }));
  check('an unreadable book produces no size at all', unread.size === null);
  check('an unreadable book is not reported as zero', unread.size !== undefined ? unread.size === null : true);

  /*
    The regression this guards shipped and reached real data. Depth used to be
    scanned out of the breaker evaluations, so a thesis with no liquidity
    tripwire got no size cap. Both live theses are exactly that shape, so the
    single most valuable number in a signal was absent from every real case
    while every test here passed. Whether a position can be closed is a fact
    about the instrument, not about what the user wrote down.
  */
  const noLiquidityBreaker = deriveSignal(
    input({
      breakerSet: set([breaker('B1', 'price', '<', 180)]),
      exitDepthUsd: 88000,
      exitSlippageBps: 4.1,
    }),
  );
  check(
    'depth is used even with no liquidity tripwire on the thesis',
    near(noLiquidityBreaker.size?.exitDepthUsd, 88000),
    String(noLiquidityBreaker.size?.exitDepthUsd),
  );
  check(
    'and it still produces a cap',
    near(noLiquidityBreaker.size?.maxNotionalUsd, 88000 * MAX_DEPTH_PARTICIPATION, 0.02),
  );
  check('and carries the exit cost', near(noLiquidityBreaker.size?.slippageBps, 4.1));

  const unreadableBook = deriveSignal(
    input({ breakerSet: set([breaker('B1', 'price', '<', 180)]), exitDepthUsd: null }),
  );
  check('a null depth reading means no size, not zero size', unreadableBook.size === null);
}

function arithmeticCloses(): void {
  console.log('\ndiscipline: the working shown must close');

  /*
    A derivation prints its own inputs. A reader who runs those numbers has to
    land on the published answer. Deriving from full precision while printing
    a rounded reading puts a high of 498.89 on screen beside a calculation
    that yields 498.92, and that gap is exactly where someone decides whether
    to trust the rest of the page.
  */
  const signal = deriveSignal(
    input({
      price: 369.68,
      breakerSet: set([breaker('B1', 'drawdownFromHigh', '<', -30)]),
      evaluations: [evaluation('B1', 'drawdownFromHigh', -25.9437)],
    }),
  );

  const level = signal.levels[0];
  const derivation = level?.derivation ?? '';

  // Pull the numbers back out of the sentence the user reads.
  const numbers = derivation.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const printedDrawdown = numbers.find((n) => n < 0 && n > -100);
  const printedHigh = numbers.find((n) => n > 400);

  check('the derivation names the reading it used', printedDrawdown !== undefined, derivation);
  check('the derivation names the high it recovered', printedHigh !== undefined, derivation);

  check(
    'the printed drawdown reproduces the printed high',
    printedHigh !== undefined &&
      printedDrawdown !== undefined &&
      near(369.68 / (1 + printedDrawdown / 100), printedHigh, 0.01),
    `369.68 / (1 + ${printedDrawdown}/100) = ${printedDrawdown !== undefined ? (369.68 / (1 + printedDrawdown / 100)).toFixed(2) : '?'} vs printed ${printedHigh}`,
  );

  check(
    'the printed high reproduces the published level',
    printedHigh !== undefined && near(printedHigh * 0.7, level?.price, 0.01),
    `${printedHigh} * 0.7 = ${printedHigh !== undefined ? (printedHigh * 0.7).toFixed(2) : '?'} vs level ${level?.price}`,
  );
}

function grammar(): void {
  console.log('\ncopy: it has to read like a sentence');

  const one = deriveSignal(input({ breakerSet: set([breaker('B1', 'price', '<', 180)], ['A4']) }));
  const singular = one.caveats.find((c) => c.includes('load-bearing')) ?? '';
  check('one unwatched assumption reads as singular', singular.includes('has no tripwire'), singular);
  check('and refers to it, not them', singular.includes('cannot see it.'), singular);

  const two = deriveSignal(input({ breakerSet: set([breaker('B1', 'price', '<', 180)], ['A4', 'A5']) }));
  const plural = two.caveats.find((c) => c.includes('load-bearing')) ?? '';
  check('two unwatched assumptions read as plural', plural.includes('have no tripwire'), plural);
  check('and refer to them', plural.includes('cannot see them.'), plural);
}

function riskMath(): void {
  console.log('\nrisk: what a position loses before the thesis quits');

  const signal = deriveSignal(
    input({
      breakerSet: set([
        breaker('B1', 'price', '<', 180),
        breaker('B2', 'exitDepthUsd', '<', 25000),
      ]),
      evaluations: [evaluation('B2', 'exitDepthUsd', 50000)],
    }),
  );

  const cap = 50000 * MAX_DEPTH_PARTICIPATION; // 10000
  const riskPct = ((216.85 - 180) / 216.85) * 100; // ~16.9932

  check('risk is stated as a percent', near(signal.nearest?.riskPct, riskPct, 0.01));

  /*
    The dollar figure must close against the PUBLISHED percentage, not against
    full precision. Both appear on screen together, and a reader who multiplies
    one by the other has to land on the third. Asserting against the unrounded
    value would lock in an on-screen arithmetic that does not add up.
  */
  const shown = signal.nearest?.riskPct ?? 0;
  check(
    'risk in dollars closes against the percentage shown',
    near(signal.nearest?.riskUsdAtMaxSize, (cap * shown) / 100, 0.01),
    `${signal.nearest?.riskUsdAtMaxSize} vs ${((cap * shown) / 100).toFixed(2)}`,
  );
  check(
    'the headline carries size, level and distance',
    signal.headline.includes('LONG') &&
      signal.headline.includes('180') &&
      signal.headline.includes('$10k'),
    signal.headline,
  );
}

function sides(): void {
  console.log('\nside and tradability');

  check('bullish is long', deriveSignal(input()).side === 'long');
  check('bearish is short', deriveSignal(input({ direction: 'bearish' })).side === 'short');
  check('neutral is flat', deriveSignal(input({ direction: 'neutral' })).side === 'flat');

  const unlisted = deriveSignal(input({ rTokenSymbol: null }));
  check('an unlisted ticker is not tradable', unlisted.tradable === false);
  check(
    'an unlisted ticker says so first',
    unlisted.headline.includes('not listed as an rToken'),
    unlisted.headline,
  );

  const noPrice = deriveSignal(input({ price: null, breakerSet: set([breaker('B1', 'price', '<', 180)]) }));
  check('no price means no levels', noPrice.levels.length === 0);
  check('no price is called out', noPrice.caveats.some((c) => c.includes('No live price')));
}

function monitoring(): void {
  console.log('\nmonitorability');

  const quiet = deriveSignal(
    input({ breakerSet: set([breaker('B1', 'grossMargin', '<', 50, 'periodic')]) }),
  );
  check('a filing-only thesis reports zero continuous', quiet.monitorability.continuous === 0);
  check(
    'it warns nothing can change between filings',
    quiet.caveats.some((c) => c.includes('between filings')),
    quiet.caveats.join(' | '),
  );

  const blind = deriveSignal(input({ breakerSet: set([breaker('B1', 'price', '<', 180)], ['A4', 'A5']) }));
  check(
    'unwatched load-bearing assumptions are counted',
    blind.monitorability.uncoveredHighLoad === 2,
  );
  check(
    'and the signal admits it cannot see them',
    blind.caveats.some((c) => c.includes('cannot see them')),
  );
}

function discipline(): void {
  console.log('\ndiscipline');

  const signal = deriveSignal(input({ breakerSet: set([breaker('B1', 'price', '<', 180)]) }));

  check('no model call is ever made', signal.meta.modelCalls === 0);
  check('the caveat list is never empty', signal.caveats.length > 0);
  check(
    'it always says it is not advice',
    signal.caveats.some((c) => c.includes('Research, not advice')),
  );

  // Every level must show its working. A price with no derivation beside it is
  // indistinguishable from one a model made up, which is the thing this whole
  // file exists to avoid.
  check(
    'every level shows its derivation',
    signal.levels.every((l) => l.derivation.length > 10),
  );
}

// ---------------------------------------------------------------------------

absolutePrice();
drawdownLevel();
rollingLevel();
noLevel();
ordering();
sizing();
riskMath();
sides();
monitoring();
discipline();
arithmeticCloses();
grammar();

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
