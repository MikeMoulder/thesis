import type { TradingRules } from '../data/types';
import type { DerivedSignal } from './signal';

/**
 * The order a signal implies, written so somebody else's agent can run it.
 *
 * ## Why THESIS builds the order and does not send it
 *
 * Bitget hands an agent account's key to a program on the user's OWN machine.
 * The redirect target is 127.0.0.1, and the credential lands in a local file.
 * A deployed web app is not on that machine and never sees it. That is not a
 * limitation to work around, it is the shape of the thing: the Agent Hub is
 * built for an agent running where the user is.
 *
 * So the handoff is the product. THESIS holds no key, has no account, and
 * cannot trade. It produces an order that is correct down to the venue's own
 * decimal places, and the user runs it in the agent they already have
 * connected. The read-only posture survives completely intact, and the user
 * never hands their credentials to a hackathon project.
 *
 * ## Why there is no stop-loss field on the order
 *
 * PlaceOrderRequest carries `stopLoss`, and the obvious move is to fill it
 * with the nearest invalidation level. It is left out on purpose, for two
 * reasons and the second is the better one.
 *
 * The venue's own docs scope the stop-loss TRIGGER fields to the futures
 * business lines, and whether spot accepts a preset stop here has not been
 * verified. Emitting an untested field would produce an order that looks right
 * and gets rejected in front of whoever is watching.
 *
 * And the level is already being watched. The thesis has a tripwire on it, the
 * cron re-checks every fifteen minutes, and Telegram delivers the moment it
 * moves. A resting stop order is a worse version of that: it fires on a wick,
 * it cannot explain itself, and it does not know why the level mattered.
 */

export type OrderSide = 'buy' | 'sell';

/**
 * The exact request body for Bitget's placeOrder, and nothing else.
 *
 * Field names and types are the venue's, taken from the SDK's own openapi.yaml
 * rather than from memory. Every numeric field is a STRING because that is
 * what the API requires, and sending a number is a parameter error that names
 * no parameter.
 */
export interface PlaceOrderRequest {
  category: 'SPOT';
  symbol: string;
  side: OrderSide;
  orderType: 'limit';
  price: string;
  qty: string;
  timeInForce: 'gtc';
  clientOid: string;
}

export interface OrderTicket {
  /** Null when no valid order can be built. `blockers` says why. */
  request: PlaceOrderRequest | null;
  /** What the order is worth at the stated price, in quote coin. */
  notionalUsd: number;
  /** What a person would say to their agent to get the same thing. */
  instruction: string;
  /** The venue rules this was checked against. */
  rules: TradingRules;
  /** Reasons no order could be built. Empty when `request` is present. */
  blockers: string[];
  /** True facts that do not stop the order. */
  notes: string[];
}

/** Round DOWN to `dp` decimals. Never up: up can exceed the size cap. */
function floorTo(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.floor(value * factor) / factor;
}

function roundTo(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/**
 * A short, venue-legal client order id that says where it came from.
 *
 * Bitget requires `^[\.A-Z\:/a-z0-9_-]{1,32}$`. The thesis id is included so
 * a fill can be traced back to the reasoning that produced it, which is the
 * whole point of having written the thesis down.
 */
export function clientOid(thesisId: string, at: number): string {
  const stamp = at.toString(36);
  const slug = thesisId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20);
  return `thesis-${slug}-${stamp}`.slice(0, 32);
}

export interface TicketInput {
  signal: DerivedSignal;
  rules: TradingRules;
  thesisId: string;
  now?: () => number;
}

export function buildTicket(input: TicketInput): OrderTicket {
  const { signal, rules } = input;
  const now = input.now ?? Date.now;

  const blockers: string[] = [];
  const notes: string[] = [];

  const side: OrderSide = signal.side === 'short' ? 'sell' : 'buy';

  if (signal.side === 'flat') {
    blockers.push('This thesis is neutral, so there is no side to take.');
  }
  if (!signal.rToken) {
    blockers.push(`${signal.ticker} has no rToken listed on Bitget, so there is nothing to trade.`);
  }
  if (signal.reference === null) {
    blockers.push('No live price could be read, so the order has nothing to price against.');
  }
  if (!signal.size) {
    blockers.push('The order book could not be read, so no size can be justified.');
  } else if (signal.size.maxNotionalUsd <= 0) {
    blockers.push(
      'Nothing is bid within one percent of the price. An order placed here could not be closed.',
    );
  }

  const price = signal.reference === null ? 0 : roundTo(signal.reference, rules.pricePrecision);
  const cap = signal.size?.maxNotionalUsd ?? 0;

  /*
    Quantity is in BASE coin because this is a limit order. That is not a
    detail: for a SPOT MARKET BUY the venue reads qty as QUOTE coin, so the
    same number means dollars in one case and tokens in the other. Using the
    market-buy convention on a limit order would size the position by a factor
    of the price, which for a $200 stock is 200x. The order would be accepted.
  */
  const rawQty = price > 0 ? cap / price : 0;
  const qty = floorTo(rawQty, rules.quantityPrecision);

  /*
    The notional is floored to the cent, not rounded.

    Rounding was the first version and it broke the one invariant this whole
    block exists to hold. A cap of 99.999 gives 0.4568 tokens at 218.91, worth
    99.996, which ROUNDS to 100.00 and is then printed directly beneath a size
    cap of 99.999. The order was correct; the number describing it claimed more
    than the cap allowed. Flooring understates by under a cent and never
    contradicts the line above it.
  */
  const notionalUsd = floorTo(qty * price, 2);

  if (blockers.length === 0) {
    if (qty < rules.minOrderQty) {
      blockers.push(
        `The size this thesis justifies is ${qty} ${rules.baseCoin}, below the venue minimum of ` +
          `${rules.minOrderQty}. There is no order here that is both small enough to exit and ` +
          'large enough to place.',
      );
    } else if (notionalUsd < rules.minOrderAmount) {
      blockers.push(
        `That is ${notionalUsd} ${rules.quoteCoin}, below the venue minimum of ` +
          `${rules.minOrderAmount}.`,
      );
    }
  }

  // Rounding down to the venue's precision always leaves a little on the
  // table. Said out loud, because a cap that silently shrinks is a cap the
  // user cannot check against the number shown above it.
  if (blockers.length === 0 && cap - notionalUsd > 0.01) {
    notes.push(
      `Rounded down to ${rules.quantityPrecision} decimals, which leaves ` +
        `${roundTo(cap - notionalUsd, 2)} ${rules.quoteCoin} of the cap unused. Rounding up would ` +
        'exceed the depth this size was derived from.',
    );
  }

  if (signal.nearest) {
    notes.push(
      `No stop is attached. The level at ${signal.nearest.level.price} already has a tripwire on ` +
        'it, re-checked every fifteen minutes, and Telegram delivers the moment it moves.',
    );
  } else {
    notes.push(
      'No stop is attached, and this thesis implies no price at which it is wrong. That is the ' +
        'finding, not an omission.',
    );
  }

  const request: PlaceOrderRequest | null =
    blockers.length > 0
      ? null
      : {
          category: 'SPOT',
          symbol: signal.rToken as string,
          side,
          orderType: 'limit',
          price: price.toFixed(rules.pricePrecision),
          qty: qty.toFixed(rules.quantityPrecision),
          timeInForce: 'gtc',
          clientOid: clientOid(input.thesisId, now()),
        };

  const instruction = request
    ? `On Bitget spot, place a good-til-cancelled limit ${side} of ${request.qty} ` +
      `${rules.baseCoin} (${signal.rToken}) at ${request.price} ${rules.quoteCoin}. ` +
      `That is ${notionalUsd} ${rules.quoteCoin}. Do not attach a stop.`
    : `No order can be built from this thesis. ${blockers[0]}`;

  return { request, notionalUsd, instruction, rules, blockers, notes };
}
