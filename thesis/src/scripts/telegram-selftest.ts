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

async function main(): Promise<void> {
  await redemption();
  await expiry();
  await rebinding();
  safety();

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
