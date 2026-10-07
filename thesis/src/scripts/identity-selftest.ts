/**
 * Identity, ownership and Telegram sign-in.
 *
 * What this suite protects:
 *
 *   A cookie cannot be forged or edited into someone else's id.
 *   A thesis is visible to its owner and to nobody else, unless it is a public
 *   example, which nobody can change.
 *   An alert reaches its thesis's owner and nobody else.
 *   Relaying a code through a chat that already belongs to someone signs the
 *   new browser in as them, instead of stealing the chat.
 *
 * Offline. Memory stores only; no Redis, no Telegram, no network.
 */
import {
  isOwnerId,
  newOwnerId,
  ownerFromRequest,
  signOwnerId,
  verifyOwnerCookie,
} from '../lib/identity';
import { NVDA_BREAKERS, NVDA_DECOMPOSITION, NVDA_LIVE } from '../lib/fixtures/nvda';
import { shouldReceive } from '../telegram/alerts';
import { createMemoryBindingStore, newBinding } from '../telegram/bindings';
import { handleCommand } from '../telegram/commands';
import { canEdit, canView, transferTheses, visibleTo } from '../thesis/ownership';
import { createThesis } from '../thesis/record';
import { createMemoryStore } from '../thesis/store';
import { summariseThesis, type ThesisRecord } from '../thesis/types';

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

function thesis(id: string, ownerId?: string): ThesisRecord {
  return createThesis({
    id,
    ticker: 'NVDA',
    statement: 'fixture thesis for ownership',
    decomposition: NVDA_DECOMPOSITION,
    breakerSet: NVDA_BREAKERS,
    evaluations: NVDA_LIVE,
    modelCalls: 0,
    ...(ownerId ? { ownerId } : {}),
  });
}

const chat = (id: number, first_name: string) => ({ id, type: 'private', first_name }) as never;

// ---------------------------------------------------------------------------

console.log('\nthe cookie');

{
  const a = newOwnerId();
  const b = newOwnerId();
  check('a new id has the owner shape', isOwnerId(a), a);
  check('two ids differ', a !== b);

  const signed = await signOwnerId(a);
  check('a signed cookie verifies to its id', (await verifyOwnerCookie(signed)) === a);

  const sig = signed.slice(signed.lastIndexOf('.') + 1);
  check('someone else\'s id with your signature is rejected', (await verifyOwnerCookie(`${b}.${sig}`)) === null);
  const flipped = signed.slice(0, -1) + (signed.endsWith('A') ? 'B' : 'A');
  check('an edited signature is rejected', (await verifyOwnerCookie(flipped)) === null);
  check('an unsigned id is rejected', (await verifyOwnerCookie(a)) === null);
  check('a legacy browser id is not an owner id', !isOwnerId('3f2a9c0e8b7d4c1a9e6f5d4c3b2a1908'));
  check('nothing is nothing', (await verifyOwnerCookie(undefined)) === null && (await verifyOwnerCookie('')) === null);

  const request = new Request('https://x.test/', { headers: { cookie: `other=1; thesis_uid=${encodeURIComponent(signed)}; z=2` } });
  check('a route handler reads it from the Cookie header', (await ownerFromRequest(request)) === a);
  check('no cookie, no owner', (await ownerFromRequest(new Request('https://x.test/'))) === null);
}

console.log('\nwho sees what');

{
  const alice = newOwnerId();
  const bob = newOwnerId();
  const hers = thesis('t-alice', alice);
  const his = thesis('t-bob', bob);
  const example = thesis('t-example');

  check('an owner sees their own thesis', canView(hers, alice));
  check('nobody else does', !canView(hers, bob) && !canView(hers, null));
  check('everyone sees an example', canView(example, alice) && canView(example, null));
  check('only the owner can change a thesis', canEdit(hers, alice) && !canEdit(hers, bob));
  check('nobody can change an example', !canEdit(example, alice) && !canEdit(example, null));

  const seen = visibleTo([hers, his, example], alice);
  check('a viewer gets their own, then the examples', seen.mine.map((t) => t.id).join() === 't-alice' && seen.examples.map((t) => t.id).join() === 't-example');
  check('an anonymous caller gets examples only', visibleTo([hers, his, example], null).mine.length === 0);
  check('a summary says whether it is an example', summariseThesis(example).example && !summariseThesis(hers).example);
  check('a new thesis records its owner', hers.ownerId === alice);
  check('a seeded one has none', example.ownerId === undefined);

  const store = createMemoryStore();
  for (const t of [hers, his, example, thesis('t-alice-2', alice)]) await store.put(t);
  const moved = await transferTheses(store, alice, bob);
  const after = await store.list();
  check('signing in moves every anonymous thesis to the account', moved === 2 && after.filter((t) => t.ownerId === bob).length === 3, String(moved));
  check('and touches nothing else', after.find((t) => t.id === 't-example')?.ownerId === undefined);
  check('moving to yourself is a no-op', (await transferTheses(store, bob, bob)) === 0);
}

console.log('\nwho gets an alert');

{
  const owner = newOwnerId();
  const mine = newBinding(owner, 1, 'Owner');
  const someoneElse = newBinding(newOwnerId(), 2, 'Stranger');
  const legacy = newBinding('3f2a9c0e8b7d4c1a9e6f5d4c3b2a1908', 3, 'Before identities');

  check("an owned thesis's alert goes to its owner", shouldReceive(mine, owner));
  check('and to nobody else', !shouldReceive(someoneElse, owner) && !shouldReceive(legacy, owner));
  check('a pre-identity chat keeps getting the examples', shouldReceive(legacy, null));
  check('a new chat does not, unless it follows them', !shouldReceive(mine, null) && shouldReceive({ ...mine, followsExamples: true }, null));
}

console.log('\nsigning in through Telegram');

await (async () => {
  const bindings = createMemoryBindingStore();
  const theses = createMemoryStore();
  const laptop = newOwnerId();
  const phone = newOwnerId();
  await theses.put(thesis('t-laptop', laptop));
  await theses.put(thesis('t-example'));

  // First device connects.
  const first = await bindings.createCode(laptop);
  const connected = await handleCommand(`/bind ${first.code}`, chat(42, 'Mike'), bindings, theses);
  check('a first connection binds the chat', connected.action === 'bound' && (await bindings.byChat(42))?.sessionId === laptop);
  check('a brand new chat does not follow the examples', (await bindings.byChat(42))?.followsExamples === false);
  check('and the welcome lists only its own theses', connected.reply.includes('Watching 1 thesis'), connected.reply.split('\n')[2]);

  // Second device, same Telegram.
  const second = await bindings.createCode(phone);
  const signedIn = await handleCommand(`/start ${second.code}`, chat(42, 'Mike'), bindings, theses);
  check('the same chat from a second device signs in', signedIn.action === 'signedin', signedIn.action);
  check('without stealing the chat', (await bindings.byChat(42))?.sessionId === laptop);
  check('and leaves a grant for the second device', (await bindings.takeSignIn(phone)) === laptop);
  check('a grant is collected once', (await bindings.takeSignIn(phone)) === null);
  check('the code cannot be replayed', (await handleCommand(`/bind ${second.code}`, chat(42, 'Mike'), bindings, theses)).action === 'rejected');

  // A chat bound before identities existed moves to a real identity.
  await bindings.put(newBinding('3f2a9c0e8b7d4c1a9e6f5d4c3b2a1908', 77, 'Old chat'));
  const upgrade = await bindings.createCode(phone);
  const moved = await handleCommand(`/bind ${upgrade.code}`, chat(77, 'Old chat'), bindings, theses);
  const now77 = await bindings.byChat(77);
  check('a pre-identity chat is rebound, not treated as a sign-in', moved.action === 'bound' && now77?.sessionId === phone);
  check('and keeps following the examples it was getting', now77?.followsExamples === true);

  const status = await handleCommand('/status', chat(42, 'Mike'), bindings, theses);
  check("/status counts only the chat's own theses", status.action === 'status' && !status.reply.includes('2 theses'), status.reply.split('\n').slice(0, 4).join(' | '));
})();

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
