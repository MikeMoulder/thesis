/**
 * Self-test for the closing "what to do now" derivation.
 *
 *   npm run actions:selftest
 *
 * No model and no network: deriveActions is a pure function, which is the whole
 * point of it. If these actions were generated we could not test them at all.
 */
import { deriveActions, type ActionKind } from '../engine/actions';
import type { Evaluation } from '../engine/breakers/evaluate';
import type { BreakerSet, ThesisBreaker } from '../engine/breakers/types';
import { summarise, type Assumption, type Decomposition } from '../engine/decomposer/types';

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

function assumption(over: Partial<Assumption> & { id: string }): Assumption {
  return {
    statement: `statement ${over.id}`,
    origin: 'implicit',
    supports: ['C1'],
    loadBearing: 'medium',
    testability: 'fundamental',
    dataNeeded: 'quarterly gross margin from 10-Q filings',
    rationale: 'because',
    ...over,
  };
}

function decomposition(assumptions: Assumption[]): Decomposition {
  const claims = [{ id: 'C1', statement: 'It goes up', direction: 'bullish' as const }];
  return {
    ticker: 'NVDA',
    thesis: 'test thesis',
    claims,
    assumptions,
    ambiguities: [],
    summary: summarise(claims, assumptions),
    meta: { model: 'stub', latencyMs: 1, decomposedAt: '2026-09-16T00:00:00.000Z' },
  };
}

function breaker(over: Partial<ThesisBreaker> & { id: string; assumptionRef: string }): ThesisBreaker {
  return {
    kind: 'threshold',
    statement: `statement ${over.id}`,
    metric: 'grossMargin',
    operator: '<',
    threshold: 70,
    severity: 'medium',
    severityInherited: true,
    cadence: 'periodic',
    ...over,
  } as ThesisBreaker;
}

function breakerSet(
  breakers: ThesisBreaker[],
  over: Partial<BreakerSet['summary']> = {},
): BreakerSet {
  return {
    ticker: 'NVDA',
    breakers,
    uncovered: [],
    summary: {
      total: breakers.length,
      byCadence: { continuous: 0, event: 0, periodic: breakers.length },
      quietUntilEarnings: false,
      uncoveredHighLoad: [],
      ...over,
    },
    meta: { model: 'stub', latencyMs: 1, generatedAt: '2026-09-16T00:00:00.000Z' },
  };
}

function kinds(actions: { kind: ActionKind }[]): ActionKind[] {
  return actions.map((a) => a.kind);
}

function main(): void {
  console.log('\n-- untestable high-load assumptions ---------------------------');
  {
    const d = decomposition([
      assumption({ id: 'A1', loadBearing: 'high', testability: 'none' }),
      assumption({ id: 'A2', loadBearing: 'high', testability: 'none' }),
      assumption({ id: 'A3' }),
    ]);
    const actions = deriveActions(d);
    check('leads with the unfalsifiable action', kinds(actions)[0] === 'unfalsifiable');
    check('names both assumptions', actions[0]!.refs.join(',') === 'A1,A2');
    // The headline is plain English and deliberately does NOT carry ids — an
    // identifier is not readable by someone meeting this for the first time.
    // The concrete statements are surfaced as bullets instead.
    check(
      'headline is readable without knowing what A1 means',
      !/\bA[0-9]\b/.test(actions[0]!.headline),
      actions[0]!.headline,
    );
    check(
      'the actual statements are surfaced',
      actions[0]!.bullets?.length === 2,
      JSON.stringify(actions[0]!.bullets),
    );
  }

  console.log('\n-- nothing outstanding ----------------------------------------');
  {
    const d = decomposition([assumption({ id: 'A1' })]);
    const actions = deriveActions(d, breakerSet([breaker({ id: 'B1', assumptionRef: 'A1' })]), []);
    check('no unfalsifiable action when everything is testable', !kinds(actions).includes('unfalsifiable'));
  }

  console.log('\n-- uncovered vs untestable are different ----------------------');
  {
    // A1 is high-load and TESTABLE but got no breaker: a coverage gap.
    const d = decomposition([assumption({ id: 'A1', loadBearing: 'high' })]);
    const actions = deriveActions(d, breakerSet([], { uncoveredHighLoad: ['A1'] }), []);
    check('reports the coverage gap', kinds(actions).includes('uncovered'));
    check('does not call it unfalsifiable', !kinds(actions).includes('unfalsifiable'));
  }
  {
    // A1 is high-load and UNTESTABLE: not a coverage gap, nothing to re-run.
    const d = decomposition([assumption({ id: 'A1', loadBearing: 'high', testability: 'none' })]);
    const actions = deriveActions(d, breakerSet([], { uncoveredHighLoad: ['A1'] }), []);
    check('untestable is not reported as a coverage gap', !kinds(actions).includes('uncovered'));
    check('untestable still reported', kinds(actions).includes('unfalsifiable'));
  }

  console.log('\n-- nearest tripwire ------------------------------------------');
  {
    const d = decomposition([assumption({ id: 'A1' }), assumption({ id: 'A2' })]);
    const bs = breakerSet([
      breaker({ id: 'B1', assumptionRef: 'A1', metric: 'grossMargin', threshold: 70 }),
      breaker({
        id: 'B2',
        assumptionRef: 'A2',
        metric: 'volatility90d',
        operator: '>',
        threshold: 60,
      }),
    ]);
    const evaluations: Evaluation[] = [
      // 4.98 / 70 = 7.1% — closer in relative terms
      { breakerId: 'B1', mode: 'live', status: 'holding', threshold: 70, headroom: 4.98 },
      // 29.07 / 60 = 48.5%
      { breakerId: 'B2', mode: 'live', status: 'holding', threshold: 60, headroom: 29.07 },
    ];
    const nearest = deriveActions(d, bs, evaluations).find((a) => a.kind === 'nearest');
    check('picks a nearest tripwire', Boolean(nearest));
    check(
      'ranks by distance relative to the threshold, not raw points',
      nearest?.refs[0] === 'B1',
      `got ${nearest?.refs[0]}`,
    );
  }
  {
    // A fired breaker is not "nearest to firing" — it already did.
    const d = decomposition([assumption({ id: 'A1' })]);
    const bs = breakerSet([breaker({ id: 'B1', assumptionRef: 'A1' })]);
    const actions = deriveActions(d, bs, [
      { breakerId: 'B1', mode: 'live', status: 'fired', threshold: 70, headroom: -8 },
    ]);
    check('a fired breaker is not offered as "nearest"', !kinds(actions).includes('nearest'));
  }

  console.log('\n-- unevaluable tripwires are never treated as safe ------------');
  {
    const d = decomposition([assumption({ id: 'A1' })]);
    const bs = breakerSet([breaker({ id: 'B1', assumptionRef: 'A1' })]);
    const actions = deriveActions(d, bs, [
      {
        breakerId: 'B1',
        mode: 'live',
        status: 'undeterminable',
        reason: 'event breakers need a news feed; none is wired',
      },
    ]);
    const blind = actions.find((a) => a.kind === 'blind');
    check('reports it as blind', Boolean(blind));
    check('carries the reason through', blind?.detail.includes('news feed') === true);
    check('is not counted as nearest', !kinds(actions).includes('nearest'));
  }

  console.log('\n-- quiet until earnings --------------------------------------');
  {
    const d = decomposition([assumption({ id: 'A1' })]);
    const bs = breakerSet([breaker({ id: 'B1', assumptionRef: 'A1' })], {
      quietUntilEarnings: true,
    });
    check('reported when tripwires exist', kinds(deriveActions(d, bs, [])).includes('quiet'));
    const empty = breakerSet([], { quietUntilEarnings: true });
    check(
      'not reported when there are no tripwires at all',
      !kinds(deriveActions(d, empty, [])).includes('quiet'),
    );
  }

  console.log('\n-- degrades before breakers exist ----------------------------');
  {
    const d = decomposition([assumption({ id: 'A1', loadBearing: 'high', testability: 'none' })]);
    const actions = deriveActions(d);
    check('works with decomposition alone', actions.length === 1 && actions[0]!.kind === 'unfalsifiable');
  }

  console.log('\n' + '-'.repeat(66));
  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main();
