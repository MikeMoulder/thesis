/**
 * Self-test for the binding handshake.
 *
 *   npm run telegram:selftest
 *
 * No network and no bot. The Bot API call is the visible part and it fails
 * loudly; the dangerous code is the bookkeeping around it, because every
 * defect here renders as a perfectly normal screen.
 *
 * A code that survives redemption is a second person's subscription. A
 * re-bind that appends instead of replacing sends every alert twice, which
 * reads as a broken product. A session that changes chats without releasing
 * the old one leaves a stranger receiving someone else's positions. None of
 * those throw, and none of them look wrong from the desk.
 */
import {
  ALPHABET_SAFE,
  createMemoryBindingStore,
  newCode,
  normaliseCode,
  CODE_LENGTH,
  CODE_TTL_SEC,
} from '../telegram/bindings';
import { esc, redact } from '../telegram/client';
import { buildAlerts, worthTelling, type Change } from '../telegram/alerts';
import type { RecheckReport } from '../thesis/recheck';

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

// ---------------------------------------------------------------------------
console.log('\ncodes');
// ---------------------------------------------------------------------------

const codes = Array.from({ length: 500 }, () => newCode());

check('a code is the declared length', codes.every((c) => c.length === CODE_LENGTH));

check(
  'no code contains an ambiguous character',
  codes.every((c) => !/[O0I1L]/.test(c)),
  codes.find((c) => /[O0I1L]/.test(c)),
);

check(
  'every character comes from the safe alphabet',
  codes.every((c) => [...c].every((ch) => ALPHABET_SAFE.includes(ch))),
);

check(
  'codes are not repeating',
  new Set(codes).size > 495,
  `${new Set(codes).size} distinct out of ${codes.length}`,
);

check('a typed code survives lowercase', normaliseCode('abc234') === 'ABC234');
check('a typed code survives a hyphen', normaliseCode('ABC-234') === 'ABC234');
check('a typed code survives a trailing newline', normaliseCode('ABC234\n') === 'ABC234');
check('the deep link payload is accepted', normaliseCode('/start ABC234') === 'ABC234');
check('a typed command is accepted', normaliseCode('/bind ABC234') === 'ABC234');
check('a group-addressed command is accepted', normaliseCode('/bind@thesis_stockbot ABC234') === 'ABC234');
check('trailing words cannot extend a code', normaliseCode('ABC234 thanks') === 'ABC234');

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

async function redemption(): Promise<void> {
  console.log('\nredemption');
  const store = createMemoryBindingStore();

  const issued = await store.createCode('session-a');
  const bound = await store.redeem(issued.code, 111, 'Mike');

  check('a valid code binds the chat', bound !== null);
  check('the binding carries the session that asked for it', bound?.sessionId === 'session-a');
  check('the binding carries the chat id', bound?.chatId === 111);
  check('a new binding starts unmuted', bound?.muted === false);
  check('a new binding starts with no failures', bound?.failures === 0);

  const second = await store.redeem(issued.code, 222, 'Someone Else');
  check('a code cannot be redeemed twice', second === null);

  const stranger = await store.redeem('ZZZZZZ', 333, 'Stranger');
  check('an unknown code binds nothing', stranger === null);

  check('the chat is findable by chat id', (await store.byChat(111))?.sessionId === 'session-a');
  check('the chat is findable by session', (await store.bySession('session-a'))?.chatId === 111);
  check('an unbound session finds nothing', (await store.bySession('session-zz')) === null);
  check('the second chat was never created', (await store.byChat(222)) === null);
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

async function expiry(): Promise<void> {
  console.log('\nexpiry');
  let clock = 1_000_000;
  const store = createMemoryBindingStore(() => clock);

  const issued = await store.createCode('session-slow');
  clock += (CODE_TTL_SEC - 1) * 1000;
  const justInTime = await store.redeem(issued.code, 444, 'Quick');
  check('a code still works one second before it expires', justInTime !== null);

  const late = await store.createCode('session-late');
  clock += (CODE_TTL_SEC + 1) * 1000;
  const tooLate = await store.redeem(late.code, 555, 'Slow');
  check('an expired code binds nothing', tooLate === null);
  check('an expired redemption creates no chat', (await store.byChat(555)) === null);
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

async function rebinding(): Promise<void> {
  console.log('\nre-binding');
  const store = createMemoryBindingStore();

  // The same person, binding a second time from the same browser. This is the
  // duplicate-alert defect: the fleet list must not grow.
  const first = await store.createCode('session-b');
  await store.redeem(first.code, 777, 'Mike');
  const again = await store.createCode('session-b');
  await store.redeem(again.code, 777, 'Mike');

  check('re-binding the same chat does not duplicate it', (await store.list()).length === 1);

  // The same browser, a different Telegram account. The old chat must stop.
  const moved = await store.createCode('session-b');
  await store.redeem(moved.code, 888, 'Mike on his phone');

  const all = await store.list();
  check('moving a session to a new chat leaves one binding', all.length === 1, `${all.length}`);
  check('the surviving binding is the new chat', all[0]?.chatId === 888);
  check('the abandoned chat stops receiving', (await store.byChat(777)) === null);
  check('the session now points at the new chat', (await store.bySession('session-b'))?.chatId === 888);

  // Two different people. Both must survive, because the fleet is the
  // delivery list and losing one is a silent unsubscribe.
  const other = await store.createCode('session-c');
  await store.redeem(other.code, 999, 'Someone else');
  check('two sessions hold two bindings', (await store.list()).length === 2);

  await store.remove(999);
  check('removing one leaves the other', (await store.list()).length === 1);
  check('the removed session no longer resolves', (await store.bySession('session-c')) === null);
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

function safety(): void {
  console.log('\nsafety');
  const fake ='8720394366:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  const leaked = `request to https://api.telegram.org/bot${fake}/sendMessage failed`;

  check('a leaked url is redacted', !redact(leaked).includes(fake), redact(leaked));
  check('the redaction says what it removed', redact(leaked).includes('<redacted>'));
  check('text with no token is untouched', redact('plain error') === 'plain error');

  // One unescaped angle bracket makes Telegram reject the whole message with
  // a 400, which means the alert is simply never delivered.
  check('angle brackets are escaped', esc('gross margin <70%') === 'gross margin &lt;70%');
  check('ampersands are escaped', esc('AT&T') === 'AT&amp;T');
  check('escaping is not double applied to plain text', esc('NVDA holding') === 'NVDA holding');
}


// ---------------------------------------------------------------------------

function change(over: Partial<Change> = {}): Change {
  return {
    thesisId: 'nvda-1',
    ticker: 'NVDA',
    at: '2026-09-17T14:00:00.000Z',
    assumptionId: 'A1',
    statement: 'AI infrastructure spending keeps accelerating.',
    from: 'healthy',
    to: 'broken',
    breakerId: 'B1',
    metric: 'grossMargin',
    observed: 65,
    threshold: 70,
    provenance: { status: 'filed', source: 'SEC 0001045810-26-000075' },
    ...over,
  } as Change;
}

function report(changes: Change[]): RecheckReport {
  return {
    startedAt: '2026-09-17T14:00:00.000Z',
    ms: 1200,
    considered: 2,
    checked: 2,
    skipped: 0,
    deferred: 0,
    failed: 0,
    modelCalls: 0,
    changes,
    outcomes: [],
  } as RecheckReport;
}

function alertsFilter(): void {
  console.log('\nalerts: what is worth telling');

  check('a break is told', worthTelling(change({ from: 'healthy', to: 'broken' })));
  check('an early warning is told', worthTelling(change({ from: 'healthy', to: 'weakening' })));
  check('a worsening is told', worthTelling(change({ from: 'weakening', to: 'broken' })));
  check('a recovery is told', worthTelling(change({ from: 'broken', to: 'healthy' })));

  // Rule 3. A provider blip flips this on and off every fifteen minutes, and
  // from here that is indistinguishable from a real loss of testability.
  check('going uncheckable is NOT told', !worthTelling(change({ from: 'healthy', to: 'uncheckable' })));
  check('coming back from uncheckable is NOT told', !worthTelling(change({ from: 'uncheckable', to: 'healthy' })));
  check('a non-transition is not told', !worthTelling(change({ from: 'broken', to: 'broken' })));
}

function alertsGrouping(): void {
  console.log('\nalerts: grouping and order');

  check('a quiet tick builds nothing', buildAlerts(report([])).length === 0);

  check(
    'a tick of only uncheckable moves builds nothing',
    buildAlerts(report([change({ to: 'uncheckable' })])).length === 0,
  );

  // Rule 1. Three pushes thirty seconds apart is how a user mutes a bot.
  const three = buildAlerts(
    report([
      change({ assumptionId: 'A1' }),
      change({ assumptionId: 'A2' }),
      change({ assumptionId: 'A3' }),
    ]),
  );
  check('three breaks on one thesis make ONE message', three.length === 1, `${three.length}`);
  check('that message counts all three', three[0]?.changes.length === 3);
  check('the headline counts them', three[0]?.html.includes('3 broken') === true, three[0]?.html);

  // The headline and the body must agree. A reader trusts the headline and
  // stops there, so a mixed message that says only "1 broken" undercounts.
  const mixed = buildAlerts(
    report([
      change({ assumptionId: 'A1', to: 'broken', from: 'weakening' }),
      change({ assumptionId: 'A2', to: 'weakening', from: 'healthy' }),
    ]),
  );
  check('a mixed message counts both states', mixed[0]?.html.includes('1 broken, 1 weakening') === true, mixed[0]?.html);

  const two = buildAlerts(
    report([
      change({ thesisId: 'tsla-1', ticker: 'TSLA', to: 'weakening' }),
      change({ thesisId: 'nvda-1', ticker: 'NVDA', to: 'broken' }),
    ]),
  );
  check('two theses make two messages', two.length === 2);
  check('the broken thesis is first', two[0]?.ticker === 'NVDA', two[0]?.ticker);
}

function alertsContent(): void {
  console.log('\nalerts: what the message carries');

  const [alert] = buildAlerts(report([change()]), 'https://thesis.example.com');
  const html = alert?.html ?? '';

  check('the ticker is in the headline', html.includes('<b>NVDA</b>'));
  check('the verdict is stated', html.includes('BROKEN'));
  check('the previous state is stated', html.includes('was healthy'));

  // Rule 4. An alarm without a number cannot be acted on at 3am.
  check('the observed value travels with it', html.includes('65.00%'), html);
  check('the threshold travels with it', html.includes('70.00%'));
  check('the filing is cited', html.includes('SEC 0001045810-26-000075'));

  // The desk translates metric identifiers into words, and a notification is
  // no place to start leaking property names at someone.
  check('the metric reads as words', html.includes('gross margin'), html);
  check('the raw identifier is not shown', !html.includes('grossMargin'), html);
  check('the thesis is linked', html.includes('https://thesis.example.com/thesis/nvda-1'));
  check('the check time is stated', html.includes('17 Sep 14:00 UTC'), html);

  // An event breaker carries no metric. "undefined crossed undefined" is a
  // worse explanation of a broken belief than no explanation.
  const bare = buildAlerts(
    report([change({ metric: undefined, observed: undefined, threshold: undefined })]),
  );
  check('a change with no numbers prints no undefined', !bare[0]?.html.includes('undefined'), bare[0]?.html);
  check('a change with no numbers still names the verdict', bare[0]?.html.includes('BROKEN') === true);

  // A statement is the user's own prose and can contain anything.
  const hostile = buildAlerts(
    report([change({ statement: 'margin < 70% & falling' })]),
  );
  check('a statement is HTML escaped', hostile[0]?.html.includes('&lt; 70% &amp; falling') === true, hostile[0]?.html);

  const long = 'x'.repeat(400);
  const clipped = buildAlerts(report([change({ statement: long })]));
  check('a very long statement is clipped', (clipped[0]?.html.length ?? 0) < 600);
  check('a clipped statement says so', clipped[0]?.html.includes('...') === true);

  const recovery = buildAlerts(report([change({ from: 'broken', to: 'healthy', observed: 72 })]));
  check('a recovery is labelled RECOVERED', recovery[0]?.html.includes('RECOVERED') === true);
  check('a recovery reads "back inside"', recovery[0]?.html.includes('back inside') === true, recovery[0]?.html);

  /*
    Only a break has crossed its line. A weakening reading is closer to the
    threshold than it was and has NOT reached it, so "crossed" there states
    something that did not happen. This shipped wrong once: a drawdown of
    -27.4% against a -30% line printed as "crossed", which a user would act on.
  */
  const nearMiss = buildAlerts(
    report([
      change({
        from: 'healthy',
        to: 'weakening',
        metric: 'drawdownFromHigh',
        observed: -27.4,
        threshold: -30,
      }),
    ]),
  );
  check('a weakening reading has NOT crossed', !nearMiss[0]?.html.includes('crossed'), nearMiss[0]?.html);
  check('a weakening reading is "closing on" its line', nearMiss[0]?.html.includes('closing on') === true);
  check('a break still reads "crossed"', buildAlerts(report([change()]))[0]?.html.includes('crossed') === true);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await redemption();
  await expiry();
  await rebinding();
  safety();
  alertsFilter();
  alertsGrouping();
  alertsContent();

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
