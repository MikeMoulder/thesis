/**
 * Self-test for the order ticket.
 *
 *   npm run ticket:selftest
 *
 * No network. This file exists for one failure in particular.
 *
 * On Bitget SPOT, `qty` means BASE coin for a limit order and QUOTE coin for a
 * market buy. The same field, the same endpoint, two different units decided
 * by another field. Send a dollar amount where tokens were expected on a $200
 * stock and the venue accepts a position two hundred times the intended size.
 * Nothing errors. The order fills.
 *
 * Everything else here is the cheaper kind of wrong: a quantity with one
 * decimal too many, or a notional a cent under the venue floor. Those get
 * rejected with a parameter error that names no parameter, which costs a demo
 * rather than an account.
 */
import { buildTicket, clientOid, type TicketInput } from '../engine/ticket';
import type { DerivedSignal } from '../engine/signal';
import type { TradingRules } from '../data/types';

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

/** The real RNVDAUSDT rules, read from Bitget on 17 Sep 2026. */
const NVDA_RULES: TradingRules = {
  pricePrecision: 2,
  quantityPrecision: 4,
  minOrderQty: 0.0001,
  minOrderAmount: 10,
  baseCoin: 'rNVDA',
  quoteCoin: 'USDT',
};

function signal(over: Partial<DerivedSignal> = {}): DerivedSignal {
  return {
    ticker: 'NVDA',
    rToken: 'RNVDAUSDT',
    side: 'long',
    reference: 218.91,
    tradable: true,
    headline: 'x',
    levels: [],
    nearest: {
      level: {
        breakerId: 'B1',
        metric: 'drawdownFromHigh',
        statement: 'x',
        price: 165.59,
        distancePct: -24.4,
        stability: 'moves-with-high',
        derivation: 'x',
      },
      riskPct: 24.4,
    },
    size: {
      exitDepthUsd: 854187.11,
      participation: 0.2,
      maxNotionalUsd: 170837.42,
      note: 'x',
    },
    monitorability: { continuous: 2, periodic: 3, event: 0, uncoveredHighLoad: 0, note: 'x' },
    caveats: [{ id: 'not-advice', text: 'x' }],
    meta: { modelCalls: 0, derivedAt: '2026-09-17T14:00:00.000Z' },
    ...over,
  } as DerivedSignal;
}

function input(over: Partial<TicketInput> = {}): TicketInput {
  return {
    signal: signal(),
    rules: NVDA_RULES,
    thesisId: 'nvda-4sjmtx',
    now: () => 1_789_000_000_000,
    ...over,
  };
}

// ---------------------------------------------------------------------------

function units(): void {
  console.log('\nthe unit trap');

  const ticket = buildTicket(input());
  const req = ticket.request;

  check('an order is built', req !== null);

  /*
    THE assertion. qty must be TOKENS, which is cap / price. If it were ever
    the dollar figure the venue would accept a position 218x too large on this
    symbol, fill it, and report success.
  */
  const expectedTokens = Math.floor((170837.42 / 218.91) * 1e4) / 1e4;
  check(
    'qty is in base coin, not dollars',
    Number(req?.qty) === expectedTokens,
    `got ${req?.qty}, expected ${expectedTokens}`,
  );
  check(
    'qty is NOT the dollar cap',
    Number(req?.qty) !== 170837.42,
    'qty must never equal the notional',
  );
  check(
    'qty times price returns the cap',
    Math.abs(Number(req?.qty) * Number(req?.price) - 170837.42) < 1,
    `${Number(req?.qty) * Number(req?.price)}`,
  );
  check('the notional is reported in quote coin', Math.abs(ticket.notionalUsd - 170837.42) < 1);
}

function precision(): void {
  console.log('\nvenue precision');

  const req = buildTicket(input()).request;

  check(
    'price carries exactly the allowed decimals',
    (req?.price.split('.')[1] ?? '').length === NVDA_RULES.pricePrecision,
    req?.price,
  );
  check(
    'qty carries exactly the allowed decimals',
    (req?.qty.split('.')[1] ?? '').length === NVDA_RULES.quantityPrecision,
    req?.qty,
  );
  check('price is a string', typeof req?.price === 'string');
  check('qty is a string', typeof req?.qty === 'string');

  /*
    THE INVARIANT: the notional printed must never exceed the cap printed
    directly above it. A cap of 99.999 gives 0.4568 tokens at 218.91, worth
    99.996 — which ROUNDS to 100.00 and contradicts the line above. The order
    was right; the number describing it was not.
  */
  const tight = buildTicket(
    input({ signal: signal({ size: { exitDepthUsd: 500, participation: 0.2, maxNotionalUsd: 99.999, note: 'x' } }) }),
  );
  check(
    'the notional never exceeds the cap it came from',
    tight.notionalUsd <= 99.999,
    `${tight.notionalUsd} must not exceed 99.999`,
  );
  check('quantity rounds down', Number(tight.request?.qty) * 218.91 <= 99.999);

  /*
    On a coarser quantity precision the rounding leaves real money behind.
    rNVDA allows four decimals, so its remainder is never more than about two
    cents; a symbol allowing two decimals can strand a couple of dollars, and
    a cap that silently shrinks is one the user cannot check.
  */
  const coarse = buildTicket(
    input({
      rules: { ...NVDA_RULES, quantityPrecision: 2 },
      signal: signal({ size: { exitDepthUsd: 5000, participation: 0.2, maxNotionalUsd: 1000, note: 'x' } }),
    }),
  );
  check(
    'a coarse precision still respects the cap',
    coarse.notionalUsd <= 1000,
    `${coarse.notionalUsd}`,
  );
  check(
    'and the unused remainder is stated',
    coarse.notes.some((n) => n.includes('unused')),
    coarse.notes.join(' | '),
  );
}

function floors(): void {
  console.log('\nvenue minimums');

  // Below the $10 notional floor.
  const tiny = buildTicket(
    input({ signal: signal({ size: { exitDepthUsd: 20, participation: 0.2, maxNotionalUsd: 4, note: 'x' } }) }),
  );
  check('an order under the notional floor is refused', tiny.request === null);
  check(
    'and says which floor it missed',
    tiny.blockers.some((b) => b.includes('10')),
    tiny.blockers.join(' | '),
  );

  // Right at the floor should pass.
  const atFloor = buildTicket(
    input({ signal: signal({ size: { exitDepthUsd: 60, participation: 0.2, maxNotionalUsd: 12, note: 'x' } }) }),
  );
  check('an order at the floor is built', atFloor.request !== null, atFloor.blockers.join(' | '));
}

function refusals(): void {
  console.log('\nwhen no order should exist');

  const unlisted = buildTicket(input({ signal: signal({ rToken: null }) }));
  check('an unlisted ticker builds no order', unlisted.request === null);
  check('and says why', unlisted.blockers.some((b) => b.includes('no rToken')));

  const noPrice = buildTicket(input({ signal: signal({ reference: null }) }));
  check('no price builds no order', noPrice.request === null);

  const emptyBook = buildTicket(
    input({ signal: signal({ size: { exitDepthUsd: 0, participation: 0.2, maxNotionalUsd: 0, note: 'x' } }) }),
  );
  check('an empty book builds no order', emptyBook.request === null);
  check(
    'and says it could not be closed',
    emptyBook.blockers.some((b) => b.includes('could not be closed')),
    emptyBook.blockers.join(' | '),
  );

  const noBook = buildTicket(input({ signal: signal({ size: null }) }));
  check('an unreadable book builds no order', noBook.request === null);

  const flat = buildTicket(input({ signal: signal({ side: 'flat' }) }));
  check('a neutral thesis builds no order', flat.request === null);
  check('and says there is no side', flat.blockers.some((b) => b.includes('no side')));

  check('a refused ticket still explains itself', unlisted.instruction.length > 20);
}

function sides(): void {
  console.log('\nside');

  check('a long buys', buildTicket(input()).request?.side === 'buy');
  check(
    'a short sells',
    buildTicket(input({ signal: signal({ side: 'short' }) })).request?.side === 'sell',
  );
}

function stops(): void {
  console.log('\nno stop is attached, on purpose');

  const req = buildTicket(input()).request;

  /*
    The venue scopes its stop-loss trigger fields to the futures business
    lines, and whether spot accepts a preset stop here is unverified. Emitting
    an untested field produces an order that looks right and is rejected in
    front of whoever is watching. The level is watched by a tripwire anyway.
  */
  check('the request carries no stopLoss field', !('stopLoss' in (req ?? {})));
  check('nor a takeProfit', !('takeProfit' in (req ?? {})));
  check(
    'and the ticket says the tripwire covers it',
    buildTicket(input()).notes.some((n) => n.includes('tripwire')),
  );

  const noLevel = buildTicket(input({ signal: signal({ nearest: null }) }));
  check(
    'with no level at all, that is stated as the finding',
    noLevel.notes.some((n) => n.includes('the finding')),
    noLevel.notes.join(' | '),
  );
}

function ids(): void {
  console.log('\nclient order id');

  const oid = clientOid('nvda-4sjmtx', 1_789_000_000_000);
  check('it is within the venue length limit', oid.length <= 32, `${oid.length}: ${oid}`);
  check(
    'it matches the venue pattern',
    /^[.A-Z:/a-z0-9_-]{1,32}$/.test(oid),
    oid,
  );
  check('it names the thesis it came from', oid.includes('nvda-4sjmtx'), oid);

  // A thesis id with characters the venue rejects must not produce an id the
  // venue rejects.
  const dirty = clientOid('nvda/../;DROP TABLE#4sjmtx', 1_789_000_000_000);
  check('a hostile thesis id is scrubbed', /^[.A-Z:/a-z0-9_-]{1,32}$/.test(dirty), dirty);
  check('and still fits', dirty.length <= 32, `${dirty.length}`);
}

function instruction(): void {
  console.log('\nthe plain-English handoff');

  const ticket = buildTicket(input());
  const text = ticket.instruction;

  check('it names the venue', text.includes('Bitget spot'), text);
  check('it names the symbol', text.includes('RNVDAUSDT'));
  check('it names the base coin', text.includes('rNVDA'));
  check('it carries the quantity', text.includes(ticket.request?.qty ?? 'x'));
  check('it carries the price', text.includes(ticket.request?.price ?? 'x'));
  check('it says gtc in words', text.includes('good-til-cancelled'));
  check('it says not to attach a stop', text.includes('Do not attach a stop'));
}

// ---------------------------------------------------------------------------

units();
precision();
floors();
refusals();
sides();
stops();
ids();
instruction();

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
