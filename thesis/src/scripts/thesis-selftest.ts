/**
 * Self-test for the thesis memory layer.
 *
 *   npm run thesis:selftest
 *
 * No model and no network. Health derivation is a pure function and the store
 * has an in-memory adapter, which is the whole reason both were built that way:
 * the screens are only a rendering of what is asserted here, so anything wrong
 * in this file is wrong everywhere.
 */
import type { Evaluation } from '../engine/breakers/evaluate';
import { summariseBreakers, type BreakerSet, type ThesisBreaker } from '../engine/breakers/types';
import { summarise, type Assumption, type Decomposition } from '../engine/decomposer/types';
import {
  deriveAssumptionHealth,
  deriveThesisHealth,
  diffChecks,
  RECOVERY_CHECKS,
  type MetricScales,
} from '../thesis/health';
import {
  appendCheck,
  createThesis,
  deriveDirection,
  reviseThesis,
} from '../thesis/record';
import { recheckAll } from '../thesis/recheck';
import { createMemoryStore } from '../thesis/store';
import {
  CHECK_LOG_LIMIT,
  HEALTH_FOR_BASIS,
  summariseThesis,
  worstHealth,
  type AssumptionHealth,
  type Check,
  type Health,
  type ThesisRecord,
} from '../thesis/types';

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

// ---- builders -------------------------------------------------------------

function assumption(over: Partial<Assumption> & { id: string }): Assumption {
  return {
    statement: `statement ${over.id}`,
    origin: 'implicit',
    supports: ['C1'],
    loadBearing: 'high',
    testability: 'fundamental',
    dataNeeded: 'quarterly gross margin',
    rationale: 'because',
    ...over,
  };
}

function breaker(over: Partial<ThesisBreaker> & { id: string; assumptionRef: string }): ThesisBreaker {
  return {
    kind: 'threshold',
    statement: `breaker ${over.id}`,
    metric: 'grossMargin',
    operator: '<',
    threshold: 70,
    severity: 'high',
    severityInherited: true,
    cadence: 'periodic',
    ...over,
  } as ThesisBreaker;
}

/**
 * Headroom follows the evaluator's own convention: distance REMAINING before
 * the condition trips. Positive is safe, zero or negative has fired.
 */
function evaluation(over: Partial<Evaluation> & { breakerId: string }): Evaluation {
  return {
    mode: 'live',
    status: 'holding',
    metric: 'grossMargin',
    observed: 75,
    threshold: 70,
    headroom: 5,
    ...over,
  };
}

function checkOf(evaluations: Evaluation[], assumptions: AssumptionHealth[] = []): Check {
  return {
    at: '2026-09-15T00:00:00.000Z',
    version: 1,
    evaluations,
    assumptions,
    health: 'healthy',
    changes: [],
    modelCalls: 0,
    source: 'live',
  };
}

/** One assumption, one breaker — the shape most cases need. */
function one(
  evalOver: Partial<Evaluation>,
  opts: { previous?: Check | null; scales?: MetricScales; loadBearing?: Assumption['loadBearing'] } = {},
): AssumptionHealth {
  const result = deriveAssumptionHealth({
    assumptions: [assumption({ id: 'A1', loadBearing: opts.loadBearing ?? 'high' })],
    breakers: [breaker({ id: 'B1', assumptionRef: 'A1' })],
    evaluations: [evaluation({ breakerId: 'B1', ...evalOver })],
    previous: opts.previous ?? null,
    scales: opts.scales ?? {},
  });
  return result[0]!;
}

// ---- 1. one breaker, one verdict ------------------------------------------

console.log('\nbreaker verdicts');

{
  // threshold 70, scale falls back to 10% of 70 = 7.
  const r = one({ status: 'fired', observed: 68, headroom: -2 });
  check('a fired breaker breaks its assumption', r.health === 'broken', r.health);
  check('and says why', r.basis === 'fired', r.basis);
  check(
    'a fired breaker never claims direction is unknown',
    r.directionUnknown === false,
    String(r.directionUnknown),
  );
}

{
  const r = one({ headroom: 40, observed: 110 });
  check('holding with room is healthy', r.health === 'healthy', r.health);
  check('basis is stable', r.basis === 'stable', r.basis);
}

{
  const r = one({ headroom: 3, observed: 73 });
  check('holding close to the line is weakening', r.health === 'weakening', r.health);
  check('on a first check the basis is proximity', r.basis === 'proximity', r.basis);
  check('and direction is admitted to be unknown', r.directionUnknown === true);
}

{
  const previous = checkOf([evaluation({ breakerId: 'B1', headroom: 6 })]);
  const r = one({ headroom: 3, observed: 73 }, { previous });
  check('close AND closing is narrowing, not proximity', r.basis === 'narrowing', r.basis);
  check('direction is no longer unknown once there is a prior check', r.directionUnknown === false);
  check('previous headroom is carried for the UI', r.drivers[0]?.previousHeadroom === 6);
}

{
  // Far away (headroom 40 > scale 7) but it closed a full typical move.
  //
  // REVERSED after the backfill. This used to read `weakening` — "a big step is
  // news even from a long way out" — and ninety days of reconstructed log showed
  // what that costs: every one of NVDA's ten transitions was a one-day move out
  // and straight back, fourteen points clear of the line throughout. The move is
  // still reported, as `approaching` and via previousHeadroom; it no longer
  // changes the state. Health is a state, movement is an event.
  const previous = checkOf([evaluation({ breakerId: 'B1', headroom: 48 })]);
  const r = one({ headroom: 40, observed: 110 }, { previous });
  check('a full-scale step from far out does NOT flip health', r.health === 'healthy', r.health);
  check('but it is still reported, as approaching', r.basis === 'approaching', r.basis);
  check('and the movement is carried for the UI', r.drivers[0]?.previousHeadroom === 48);
}

// ---- 1b. hysteresis: states are sticky, so the feed does not chatter -------

console.log('\nhysteresis');

function drivenBy(basis: AssumptionHealth['basis'], headroom: number): Check {
  // A previous check carrying a stored basis, which is what the new rule reads.
  const prior = checkOf([evaluation({ breakerId: 'B1', headroom })]);
  return {
    ...prior,
    assumptions: [
      {
        assumptionId: 'A1',
        statement: 'statement A1',
        loadBearing: 'high',
        health: HEALTH_FOR_BASIS[basis],
        basis,
        directionUnknown: false,
        drivers: [{ breakerId: 'B1', basis, headroom }],
      },
    ],
  };
}

{
  // scale is 7. Enter at 7, leave only past 10.5.
  const r = one({ headroom: 9 }, { previous: drivenBy('proximity', 6) });
  check(
    'a breaker already flagged stays flagged inside the exit band',
    r.health === 'weakening',
    `${r.health}/${r.basis}`,
  );
}

{
  const r = one({ headroom: 11 }, { previous: drivenBy('proximity', 6) });
  check(
    'and is released once it clears the line by the margin',
    r.health === 'healthy',
    `${r.health}/${r.basis}`,
  );
}

{
  const r = one({ headroom: 9 }, { previous: null });
  check(
    'an UNflagged breaker at the same distance is healthy — entering is at the line',
    r.health === 'healthy',
    `${r.health}/${r.basis}`,
  );
}

{
  // Fired yesterday at -2, back inside the line today by a hair.
  const r = one({ headroom: 0.5 }, { previous: drivenBy('fired', -2) });
  check(
    'a break that barely un-fires is NOT called recovered',
    r.health === 'broken',
    `${r.health}/${r.basis}`,
  );
  check('and says why', r.basis === 'unrecovered', r.basis);
}

{
  const r = one({ headroom: 12 }, { previous: drivenBy('fired', -2) });
  check(
    'a break that clears its line decisively IS released',
    r.health === 'healthy',
    `${r.health}/${r.basis}`,
  );
}

{
  // Narrowly back inside the line, and it STAYS there. Distance alone would
  // call this broken forever; persistence lifts it. This is the TSLA revenue
  // case: 15.78% in April, 25.52% in July against a 25 line, held for weeks.
  let previous: Check | null = drivenBy('fired', -9);
  const seen: string[] = [];
  for (let i = 0; i < RECOVERY_CHECKS; i++) {
    const r = one({ headroom: 0.5, observed: 70.5 }, { previous });
    seen.push(`${r.health}/${r.basis}`);
    previous = { ...checkOf([evaluation({ breakerId: 'B1', headroom: 0.5 })]), assumptions: [{ ...r }] };
  }
  check(
    'a narrow recovery is not believed at once',
    seen[0] === 'broken/unrecovered',
    seen.join(' '),
  );
  check(
    `but holding inside the line for ${RECOVERY_CHECKS} checks lifts the flag`,
    seen[RECOVERY_CHECKS - 1]?.startsWith('weakening') === true,
    seen.join(' '),
  );
}

{
  // The same narrow recovery, interrupted by one re-fire, must NOT age into a
  // recovery. This is the difference between recovering and oscillating.
  let previous: Check | null = drivenBy('fired', -9);
  let last = '';
  const headrooms = [0.5, 0.5, -0.3, 0.5, 0.5];
  for (const headroom of headrooms) {
    const r = one(
      headroom < 0
        ? { status: 'fired', headroom, observed: 70 + headroom }
        : { status: 'holding', headroom, observed: 70 + headroom },
      { previous },
    );
    last = `${r.health}/${r.basis}`;
    previous = { ...checkOf([evaluation({ breakerId: 'B1', headroom })]), assumptions: [{ ...r }] };
  }
  check(
    'a re-fire resets the count, so oscillation never ages into recovery',
    last === 'broken/unrecovered',
    last,
  );
}

{
  // Nothing may delay BAD news. A first break is reported the instant it fires.
  const r = one({ status: 'fired', observed: 68, headroom: -2 }, { previous: drivenBy('stable', 40) });
  check(
    'hysteresis never postpones a real break',
    r.health === 'broken' && r.basis === 'fired',
    `${r.health}/${r.basis}`,
  );
}

{
  // The shape that produced sixteen transitions in the TSLA backfill: a value
  // oscillating either side of its threshold for a fortnight.
  const headrooms = [-0.8, 0.4, -0.5, 2.7, -0.1, 0.2, -0.6, 1.1, -0.9, 3.8];
  let previous: Check | null = null;
  let transitions = 0;
  let last: Health | null = null;
  for (const headroom of headrooms) {
    const r = one(
      headroom < 0
        ? { status: 'fired', headroom, observed: 70 + headroom }
        : { status: 'holding', headroom, observed: 70 + headroom },
      { previous },
    );
    if (last !== null && last !== r.health) transitions++;
    last = r.health;
    previous = {
      ...checkOf([evaluation({ breakerId: 'B1', headroom })]),
      assumptions: [{ ...r }],
    };
  }
  check(
    'THE FIX: a fortnight of oscillation across the line produces no chatter',
    transitions === 0,
    `${transitions} transitions`,
  );
  check('and it is held broken throughout, not flickering to recovered', last === 'broken', String(last));
}

{
  // Moved toward the line, but only a hair, and still far away.
  const previous = checkOf([evaluation({ breakerId: 'B1', headroom: 40.1 })]);
  const r = one({ headroom: 40 }, { previous });
  check('float-level wobble is not a trend', r.health === 'healthy', `${r.health}/${r.basis}`);
}

{
  const r = one({ status: 'undeterminable', headroom: undefined, observed: undefined, reason: 'no filing' });
  check('an unreadable breaker is uncheckable, not healthy', r.health === 'uncheckable', r.health);
  check('basis is nodata', r.basis === 'nodata', r.basis);
}

{
  const r = one({ status: 'holding', headroom: undefined });
  check(
    'holding by an unknown margin is uncheckable, not healthy',
    r.health === 'uncheckable',
    r.health,
  );
}

// ---- 2. measured scale beats the assumed one ------------------------------

console.log('\nscale');

{
  // headroom 3 is inside the assumed scale (7) but outside a measured one (1).
  const r = one({ headroom: 3 }, { scales: { grossMargin: 1 } });
  check(
    'a measured typical move overrides the assumed fraction',
    r.health === 'healthy',
    `${r.health}/${r.basis}`,
  );
}

{
  const r = one({ threshold: 0, observed: 5, headroom: 5, metric: 'operatingIncome' });
  check(
    'a zero threshold does not make everything look adjacent to the line',
    r.health === 'healthy',
    `${r.health}/${r.basis}`,
  );
}

// ---- 3. several breakers on one assumption --------------------------------

console.log('\nassumptions with more than one breaker');

{
  const result = deriveAssumptionHealth({
    assumptions: [assumption({ id: 'A1' })],
    breakers: [
      breaker({ id: 'B1', assumptionRef: 'A1' }),
      breaker({ id: 'B2', assumptionRef: 'A1' }),
    ],
    evaluations: [
      evaluation({ breakerId: 'B1', status: 'undeterminable', headroom: undefined }),
      evaluation({ breakerId: 'B2', headroom: 40 }),
    ],
  });
  const r = result[0]!;
  check(
    'one unreadable breaker does not sink a partly-checked assumption',
    r.health === 'healthy',
    r.health,
  );
  check('but the unreadable breaker is still shown', r.drivers.length === 2, String(r.drivers.length));
}

{
  const result = deriveAssumptionHealth({
    assumptions: [assumption({ id: 'A1' })],
    breakers: [
      breaker({ id: 'B1', assumptionRef: 'A1' }),
      breaker({ id: 'B2', assumptionRef: 'A1' }),
    ],
    evaluations: [
      evaluation({ breakerId: 'B1', headroom: 40 }),
      evaluation({ breakerId: 'B2', status: 'fired', headroom: -1 }),
    ],
  });
  const r = result[0]!;
  check('the worst readable breaker decides', r.health === 'broken', r.health);
  check('and the basis comes from that breaker', r.basis === 'fired', r.basis);
}

{
  const result = deriveAssumptionHealth({
    assumptions: [assumption({ id: 'A1' })],
    breakers: [],
    evaluations: [],
  });
  check(
    'an assumption nothing can test is uncheckable',
    result[0]?.health === 'uncheckable',
    result[0]?.health,
  );
}

// ---- 4. thesis health from its assumptions --------------------------------

console.log('\nthesis health');

function health(
  rows: Array<{ health: Health; loadBearing: 'high' | 'medium' | 'low' }>,
): Health {
  return deriveThesisHealth(
    rows.map((row, i) => ({
      assumptionId: `A${i}`,
      statement: 's',
      loadBearing: row.loadBearing,
      health: row.health,
      basis: 'stable',
      directionUnknown: false,
      drivers: [],
    })),
  );
}

check(
  'a broken load-bearing assumption breaks the thesis',
  health([{ health: 'broken', loadBearing: 'high' }, { health: 'healthy', loadBearing: 'high' }]) ===
    'broken',
);
check(
  'a broken medium assumption puts it at risk, not down',
  health([{ health: 'broken', loadBearing: 'medium' }, { health: 'healthy', loadBearing: 'high' }]) ===
    'weakening',
);
check(
  'a weakening load-bearing assumption puts it at risk',
  health([{ health: 'weakening', loadBearing: 'high' }]) === 'weakening',
);
check(
  'a weakening low-load assumption does not',
  health([{ health: 'weakening', loadBearing: 'low' }, { health: 'healthy', loadBearing: 'high' }]) ===
    'healthy',
);
check(
  'all healthy is healthy',
  health([{ health: 'healthy', loadBearing: 'high' }]) === 'healthy',
);
check(
  'a thesis nothing can check is uncheckable, never healthy',
  health([{ health: 'uncheckable', loadBearing: 'high' }]) === 'uncheckable',
);
check(
  'one uncheckable among healthy ones does not hide the healthy verdict',
  health([{ health: 'uncheckable', loadBearing: 'low' }, { health: 'healthy', loadBearing: 'high' }]) ===
    'healthy',
);
check('a thesis with no assumptions is uncheckable', deriveThesisHealth([]) === 'uncheckable');

check('worstHealth ranks broken above weakening', worstHealth(['weakening', 'broken']) === 'broken');
check(
  'worstHealth ranks uncheckable above healthy',
  worstHealth(['healthy', 'uncheckable']) === 'uncheckable',
);
check('worstHealth of nothing is healthy', worstHealth([]) === 'healthy');

// ---- 5. what changed since last time --------------------------------------

console.log('\nchange detection');

function row(id: string, h: Health): AssumptionHealth {
  return {
    assumptionId: id,
    statement: `statement ${id}`,
    loadBearing: 'high',
    health: h,
    basis: h === 'broken' ? 'fired' : 'stable',
    directionUnknown: false,
    drivers: [
      {
        breakerId: `B-${id}`,
        metric: 'grossMargin',
        observed: 68,
        threshold: 70,
        basis: h === 'broken' ? 'fired' : 'stable',
      },
    ],
  };
}

check('the first check reports no changes', diffChecks(null, [row('A1', 'healthy')]).length === 0);
check('an empty previous check reports no changes', diffChecks([], [row('A1', 'broken')]).length === 0);

{
  const changes = diffChecks([row('A1', 'healthy')], [row('A1', 'broken')]);
  check('a break is detected', changes.length === 1, String(changes.length));
  check('with both ends of the transition', changes[0]?.from === 'healthy' && changes[0]?.to === 'broken');
  check('and the evidence attached', changes[0]?.observed === 68 && changes[0]?.threshold === 70);
  check('and the breaker that caused it', changes[0]?.breakerId === 'B-A1', changes[0]?.breakerId);
}

check(
  'an unchanged assumption is not reported',
  diffChecks([row('A1', 'weakening')], [row('A1', 'weakening')]).length === 0,
);

check(
  'a recovery is reported too, not just bad news',
  diffChecks([row('A1', 'broken')], [row('A1', 'healthy')])[0]?.to === 'healthy',
);

{
  const changes = diffChecks(
    [row('A1', 'healthy'), row('A2', 'broken')],
    [row('A1', 'broken'), row('A2', 'healthy')],
  );
  check('worst news sorts first', changes[0]?.assumptionId === 'A1', changes[0]?.assumptionId);
}

check(
  'an assumption that did not exist before is not a change',
  diffChecks([row('A1', 'healthy')], [row('A1', 'healthy'), row('A2', 'broken')]).length === 0,
);

// ---- 6. the store ---------------------------------------------------------

console.log('\nstore');

function thesis(over: Partial<ThesisRecord> = {}): ThesisRecord {
  return {
    id: 'T1',
    ticker: 'NVDA',
    direction: 'bullish',
    createdAt: '2026-09-16T00:00:00.000Z',
    status: 'live',
    versions: [],
    checks: [],
    ...over,
  };
}

const store = createMemoryStore();

await store.put(thesis());
check('a stored thesis can be read back', (await store.get('T1'))?.ticker === 'NVDA');
check('a missing thesis is null, not a throw', (await store.get('nope')) === null);

await store.put(thesis({ id: 'T2', createdAt: '2026-09-17T00:00:00.000Z' }));
const listed = await store.list();
check('the list returns everything stored', listed.length === 2, String(listed.length));
check('newest first', listed[0]?.id === 'T2', listed[0]?.id);

{
  const mine = thesis({ id: 'T3' });
  await store.put(mine);
  mine.status = 'broken';
  check(
    'mutating your copy cannot rewrite what was stored',
    (await store.get('T3'))?.status === 'live',
  );
}

{
  // 50 over the cap, numbered in order, so it is obvious which end survived.
  const overflow = 50;
  const overflowing = thesis({
    id: 'T4',
    checks: Array.from({ length: CHECK_LOG_LIMIT + overflow }, (_, i) => ({
      ...checkOf([]),
      version: i,
    })),
  });
  await store.put(overflowing);
  const back = await store.get('T4');

  check(
    'the check log is capped on write',
    back?.checks.length === CHECK_LOG_LIMIT,
    String(back?.checks.length),
  );
  check(
    'it is the OLDEST checks that get dropped',
    back?.checks[0]?.version === overflow,
    String(back?.checks[0]?.version),
  );
  check(
    'and the most recent check survives',
    back?.checks.at(-1)?.version === CHECK_LOG_LIMIT + overflow - 1,
    String(back?.checks.at(-1)?.version),
  );
}

await store.remove('T1');
check('a removed thesis is gone', (await store.get('T1')) === null);
check('and drops out of the list', (await store.list()).every((t) => t.id !== 'T1'));

// ---- 7. building and extending a record -----------------------------------

console.log('\nrecord');

function decompositionOf(
  assumptions: Assumption[],
  direction?: 'bullish' | 'bearish' | 'neutral',
): Decomposition {
  const claims = [{ id: 'C1', statement: 'It goes up', ...(direction ? { direction } : {}) }];
  return {
    ticker: 'NVDA',
    thesis: 'AI capex keeps accelerating and NVDA stays dominant.',
    claims,
    assumptions,
    ambiguities: [],
    summary: summarise(claims, assumptions),
    meta: { model: 'stub', latencyMs: 1, decomposedAt: '2026-09-16T00:00:00.000Z' },
  };
}

function breakerSetOf(breakers: ThesisBreaker[], assumptions: Assumption[]): BreakerSet {
  return {
    ticker: 'NVDA',
    breakers,
    uncovered: [],
    summary: summariseBreakers(breakers, [], assumptions),
    meta: { model: 'stub', latencyMs: 1, generatedAt: '2026-09-16T00:00:00.000Z' },
  };
}

/** One high-load assumption with one threshold breaker. The minimal thesis. */
function freshThesis(evalOver: Partial<Evaluation> = {}): ThesisRecord {
  const assumptions = [assumption({ id: 'A1', loadBearing: 'high' })];
  const breakers = [breaker({ id: 'B1', assumptionRef: 'A1' })];
  return createThesis({
    id: 'T-rec',
    ticker: 'nvda',
    statement: 'AI capex keeps accelerating and NVDA stays dominant.',
    decomposition: decompositionOf(assumptions, 'bullish'),
    breakerSet: breakerSetOf(breakers, assumptions),
    evaluations: [evaluation({ breakerId: 'B1', ...evalOver })],
    modelCalls: 6,
    at: '2026-09-16T00:00:00.000Z',
  });
}

{
  const t = freshThesis({ headroom: 40 });
  check('a new thesis has exactly one version', t.versions.length === 1, String(t.versions.length));
  check('numbered 1', t.versions[0]?.n === 1);
  check(
    'holding the words the user actually wrote',
    t.versions[0]?.statement.startsWith('AI capex') === true,
  );
  check('the ticker is normalised to upper case', t.ticker === 'NVDA', t.ticker);
  check('direction is read from the claims', t.direction === 'bullish', t.direction);
  check('and it starts live', t.status === 'live', t.status);

  check('creation records a baseline check', t.checks.length === 1, String(t.checks.length));
  check('marked as the initial one', t.checks[0]?.source === 'initial', t.checks[0]?.source);
  check('with no changes, because there is nothing to compare to', t.checks[0]?.changes.length === 0);
  check('the run model cost is recorded', t.checks[0]?.modelCalls === 6);
  check('and the thesis reads healthy', t.checks[0]?.health === 'healthy', t.checks[0]?.health);
}

check(
  'a bearish thesis is not called bullish',
  deriveDirection(decompositionOf([], 'bearish')) === 'bearish',
);
check(
  'a thesis with no stated direction stays neutral rather than being guessed',
  deriveDirection(decompositionOf([])) === 'neutral',
);

{
  const t = appendCheck(freshThesis({ headroom: 40 }), {
    evaluations: [evaluation({ breakerId: 'B1', status: 'fired', observed: 68, headroom: -2 })],
    modelCalls: 0,
    source: 'live',
    at: '2026-09-17T00:00:00.000Z',
  });

  check('a recheck appends rather than replaces', t.checks.length === 2, String(t.checks.length));
  check('the earlier check is untouched', t.checks[0]?.health === 'healthy', t.checks[0]?.health);
  check('the new one sees the break', t.checks[1]?.health === 'broken', t.checks[1]?.health);
  check('and reports it as a change', t.checks[1]?.changes.length === 1, String(t.checks[1]?.changes.length));
  check(
    'naming both ends of the transition',
    t.checks[1]?.changes[0]?.from === 'healthy' && t.checks[1]?.changes[0]?.to === 'broken',
  );
  check('a recheck costs no model calls', t.checks[1]?.modelCalls === 0);
  check(
    'a broken thesis is NOT auto-retired — only its holder can do that',
    t.status === 'live',
    t.status,
  );
}

{
  // The user revises after the break. v1 must survive exactly as written.
  const broken = appendCheck(freshThesis({ headroom: 40 }), {
    evaluations: [evaluation({ breakerId: 'B1', status: 'fired', headroom: -2 })],
    modelCalls: 0,
    source: 'live',
    at: '2026-09-17T00:00:00.000Z',
  });

  const assumptions = [assumption({ id: 'A1', statement: 'softened claim', loadBearing: 'high' })];
  const breakers = [breaker({ id: 'B1', assumptionRef: 'A1', threshold: 60 })];
  const revised = reviseThesis(broken, {
    statement: 'AI capex is still strong, but the acceleration is slowing.',
    reason: 'The growth-rate assumption failed.',
    decomposition: decompositionOf(assumptions, 'bullish'),
    breakerSet: breakerSetOf(breakers, assumptions),
    evaluations: [evaluation({ breakerId: 'B1', threshold: 60, observed: 75, headroom: 15 })],
    modelCalls: 6,
    at: '2026-09-18T00:00:00.000Z',
  });

  check('revising adds a version', revised.versions.length === 2, String(revised.versions.length));
  check('numbered 2', revised.versions[1]?.n === 2);
  check('the reason is kept', Boolean(revised.versions[1]?.reason));
  check(
    'and version 1 still says what it originally said',
    revised.versions[0]?.statement.startsWith('AI capex keeps accelerating') === true,
    revised.versions[0]?.statement,
  );
  check('revising puts it back under observation', revised.status === 'live', revised.status);
  check('the check log keeps every earlier check', revised.checks.length === 3, String(revised.checks.length));
  check(
    'the new check is tagged with the new version',
    revised.checks[2]?.version === 2,
    String(revised.checks[2]?.version),
  );
  check(
    'and reports no changes across the version boundary — different assumptions',
    revised.checks[2]?.changes.length === 0,
    String(revised.checks[2]?.changes.length),
  );
}

{
  const t = freshThesis({ headroom: 3 });
  const s = summariseThesis(t);
  check('a summary carries the current statement', s.statement.startsWith('AI capex'));
  check('and the current version number', s.version === 1);
  check('and the health', s.health === 'weakening', s.health);
  check('and counts the weakening assumptions', s.weakening === 1, String(s.weakening));
  check('and the time of the last check', s.lastCheckedAt === '2026-09-16T00:00:00.000Z');
  check('and how many checks have run', s.checkCount === 1, String(s.checkCount));
}

{
  const never = thesis({ id: 'T-never', versions: [freshThesis().versions[0]!], checks: [] });
  const s = summariseThesis(never);
  check(
    'a thesis that has never been checked is uncheckable, not healthy',
    s.health === 'uncheckable',
    s.health,
  );
  check('and says it has never been checked', s.lastCheckedAt === null);
}

// ---- 8. the recheck loop --------------------------------------------------

console.log('\nrecheck');

/**
 * A DataSource that only does what a recheck asks of it: resolve a ticker and
 * hand back one derived metric. Counts its own calls so the test can assert
 * that a ticker held by several theses is resolved ONCE.
 */
function fakeDataSource(over: { grossMargin?: number; failResolve?: boolean } = {}) {
  const calls = { resolve: 0, metric: 0 };
  const ds = {
    name: 'fake',
    async healthCheck() {
      return { ok: true, checks: [] };
    },
    async resolve(ticker: string) {
      calls.resolve++;
      if (over.failResolve) throw new Error('no such ticker');
      return { ticker, name: `${ticker} INC` };
    },
    async getDerivedMetric() {
      calls.metric++;
      return {
        value: [
          {
            metric: 'grossMargin',
            value: over.grossMargin ?? 75,
            asOf: '2026-08-01',
            period: 'Q2 2026',
            inputs: [],
          },
        ],
        provenance: { status: 'inferred', source: 'fake 10-Q', asOf: '2026-08-01' },
      };
    },
    async getQuote() {
      throw new Error('not used');
    },
    async getCandles() {
      throw new Error('not used');
    },
    async getUnderlyingHistory() {
      throw new Error('not used');
    },
    async getFundamentalSeries() {
      throw new Error('not used');
    },
    async getNews() {
      throw new Error('not used');
    },
  } as unknown as Parameters<typeof recheckAll>[1];
  return { ds, calls };
}

/** A store preloaded with theses, isolated per test. */
async function storeWith(theses: ThesisRecord[]) {
  const s = createMemoryStore();
  for (const t of theses) await s.put(t);
  return s;
}

{
  const t = freshThesis({ headroom: 40 });
  const s = await storeWith([t]);
  const { ds } = fakeDataSource();

  const report = await recheckAll(s, ds, { force: true });

  check('a live thesis gets checked', report.checked === 1, String(report.checked));
  check('and the check is written to the store', (await s.get(t.id))?.checks.length === 2);
  check(
    'THE CLAIM: a recheck costs zero model calls',
    report.modelCalls === 0,
    String(report.modelCalls),
  );
  check(
    'and the stored check records that too',
    (await s.get(t.id))?.checks[1]?.modelCalls === 0,
  );
  check('tagged as a live check', (await s.get(t.id))?.checks[1]?.source === 'live');
}

{
  // grossMargin 65 is below the breaker threshold of 70 — it should fire.
  const t = freshThesis({ headroom: 40 });
  const s = await storeWith([t]);
  const { ds } = fakeDataSource({ grossMargin: 65 });

  const report = await recheckAll(s, ds, { force: true });

  check('a broken assumption shows up in the report', report.changes.length === 1, String(report.changes.length));
  check(
    'as a transition to broken',
    report.changes[0]?.to === 'broken',
    report.changes[0]?.to,
  );
  check('carrying the ticker, for the activity feed', report.changes[0]?.ticker === 'NVDA');
  check('and the thesis id', report.changes[0]?.thesisId === t.id);
  check('the outcome reports the new health', report.outcomes[0]?.health === 'broken');
  check(
    'but the thesis is NOT auto-retired by the cron',
    (await s.get(t.id))?.status === 'live',
  );
}

{
  const t = { ...freshThesis({ headroom: 40 }), status: 'retired' as const };
  const s = await storeWith([t]);
  const { ds } = fakeDataSource();

  const report = await recheckAll(s, ds, { force: true });
  check('a retired thesis is left alone', report.considered === 0, String(report.considered));
  check('and nothing is written to it', (await s.get(t.id))?.checks.length === 1);
}

{
  const t = { ...freshThesis({ headroom: 40 }), status: 'broken' as const };
  const s = await storeWith([t]);
  const { ds } = fakeDataSource();

  const report = await recheckAll(s, ds, { force: true });
  check(
    'a broken thesis IS still watched — it can recover',
    report.checked === 1,
    String(report.checked),
  );
}

{
  // Last check was at 2026-09-16T00:00:00Z; pretend it is five minutes later.
  const t = freshThesis({ headroom: 40 });
  const s = await storeWith([t]);
  const { ds } = fakeDataSource();
  const now = () => Date.parse('2026-09-16T00:05:00.000Z');

  const report = await recheckAll(s, ds, { now });
  check(
    'a thesis checked minutes ago is skipped, not rechecked',
    report.skipped === 1 && report.checked === 0,
    `skipped=${report.skipped} checked=${report.checked}`,
  );
  check('and the data source is never touched', ds !== null && report.considered === 1);

  const forced = await recheckAll(s, ds, { now, force: true });
  check('unless forced', forced.checked === 1, String(forced.checked));
}

{
  const t = freshThesis({ headroom: 40 });
  const s = await storeWith([t]);
  const { ds } = fakeDataSource();
  const now = () => Date.parse('2026-09-16T04:00:00.000Z');

  const report = await recheckAll(s, ds, { now, minIntervalMs: 60 * 60 * 1000 });
  check(
    'four hours later, with a one-hour interval, it is due',
    report.checked === 1,
    String(report.checked),
  );
}

{
  const a = { ...freshThesis({ headroom: 40 }), id: 'T-a' };
  const b = { ...freshThesis({ headroom: 40 }), id: 'T-b' };
  const s = await storeWith([a, b]);
  const { ds, calls } = fakeDataSource();

  const report = await recheckAll(s, ds, { force: true });
  check('two theses on one ticker are both checked', report.checked === 2, String(report.checked));
  check(
    'but the ticker is resolved only once',
    calls.resolve === 1,
    `${calls.resolve} resolve calls`,
  );
}

{
  const t = freshThesis({ headroom: 40 });
  const s = await storeWith([t]);
  const { ds } = fakeDataSource({ failResolve: true });

  const report = await recheckAll(s, ds, { force: true });
  check('an unresolvable ticker is a failure, not a crash', report.failed === 1, String(report.failed));
  check('with the reason kept', Boolean(report.outcomes[0]?.reason));
  check('and nothing written to the log', (await s.get(t.id))?.checks.length === 1);
}

{
  const t = freshThesis({ headroom: 40 });
  const s = await storeWith([t]);
  const { ds, calls } = fakeDataSource();
  // A deadline already in the past: nothing should be started.
  const report = await recheckAll(s, ds, { force: true, deadline: Date.now() - 1000 });

  check('work past the deadline is deferred', report.deferred === 1, String(report.deferred));
  check('not marked failed', report.failed === 0, String(report.failed));
  check('and no data is fetched', calls.resolve === 0, String(calls.resolve));
}

{
  const a = { ...freshThesis({ headroom: 40 }), id: 'T-only-a' };
  const b = { ...freshThesis({ headroom: 40 }), id: 'T-only-b' };
  const s = await storeWith([a, b]);
  const { ds } = fakeDataSource();

  const report = await recheckAll(s, ds, { force: true, only: 'T-only-a' });
  check('a single thesis can be targeted', report.considered === 1, String(report.considered));
  check('and only that one is written', (await s.get('T-only-b'))?.checks.length === 1);
}

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
