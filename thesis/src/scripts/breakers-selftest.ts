/**
 * Self-test for the breaker generator, with no live model.
 *
 *   npm run breakers:selftest
 */
import { generateBreakers } from '../engine/breakers/index';
import { summarise, type Assumption, type Decomposition } from '../engine/decomposer/types';
import type { CompletionOptions, CompletionResult, LlmClient, Message } from '../llm/types';

class StubLlm implements LlmClient {
  readonly model = 'stub-1';
  readonly label = 'stub';
  private turn = 0;
  readonly seen: Message[][] = [];
  constructor(private readonly replies: string[]) {}
  async complete(messages: Message[], _o?: CompletionOptions): Promise<CompletionResult> {
    this.seen.push([...messages]);
    const text = this.replies[Math.min(this.turn, this.replies.length - 1)]!;
    this.turn++;
    return { text, model: this.model, latencyMs: 1 };
  }
}

function assumption(over: Partial<Assumption> & { id: string }): Assumption {
  return {
    statement: `statement ${over.id}`,
    origin: 'stated',
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
    meta: { model: 'stub', latencyMs: 0, decomposedAt: new Date().toISOString() },
  };
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function throws(fn: () => unknown): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

const b = (over: Record<string, unknown>) => ({
  id: 'B1',
  assumptionRef: 'A1',
  kind: 'threshold',
  statement: 'margin falls',
  metric: 'grossMargin',
  operator: '<',
  threshold: 70,
  severity: 'high',
  cadence: 'periodic',
  ...over,
});

async function main(): Promise<void> {
  console.log('\n-- happy path ' + '-'.repeat(49));
  {
    const d = decomposition([assumption({ id: 'A1', loadBearing: 'high' })]);
    const set = await generateBreakers(d, {
      llm: new StubLlm([JSON.stringify({ breakers: [b({})] })]),
    });
    check('generates a breaker', set.breakers.length === 1);
    check('links to its assumption', set.breakers[0]!.assumptionRef === 'A1');
    check('cadence counted', set.summary.byCadence.periodic === 1);
  }

  console.log('\n-- cadence is derived, not trusted ' + '-'.repeat(28));
  {
    const d = decomposition([assumption({ id: 'A1' })]);
    // A fundamental metric mislabelled continuous would make the live monitor
    // promise updates that quarterly filings cannot deliver.
    const set = await generateBreakers(d, {
      llm: new StubLlm([JSON.stringify({ breakers: [b({ cadence: 'continuous' })] })]),
    });
    check(
      'forces fundamental metric to periodic',
      set.breakers[0]!.cadence === 'periodic',
      set.breakers[0]!.cadence,
    );
  }
  {
    const d = decomposition([assumption({ id: 'A1', testability: 'price' })]);
    const set = await generateBreakers(d, {
      llm: new StubLlm([
        JSON.stringify({
          breakers: [b({ metric: 'drawdownFromHigh', operator: '<=', threshold: -25, cadence: 'periodic' })],
        }),
      ]),
    });
    check('forces price metric to continuous', set.breakers[0]!.cadence === 'continuous');
  }

  console.log('\n-- severity is inherited ' + '-'.repeat(38));
  {
    const d = decomposition([assumption({ id: 'A1', loadBearing: 'low' })]);
    const set = await generateBreakers(d, {
      llm: new StubLlm([JSON.stringify({ breakers: [b({ severity: 'high' })] })]),
    });
    check(
      "decomposer's rating wins over the generator's",
      set.breakers[0]!.severity === 'low',
      set.breakers[0]!.severity,
    );
    check('flagged as inherited, not measured', set.breakers[0]!.severityInherited === true);
  }

  console.log('\n-- untestable assumptions get no breaker ' + '-'.repeat(22));
  {
    const d = decomposition([assumption({ id: 'A1', testability: 'none' })]);
    const set = await generateBreakers(d, { llm: new StubLlm(['unused']) });
    check('returns empty set without calling the model', set.breakers.length === 0);
    check('model was never called', set.meta.model === 'none');
    check('reports the assumption as uncovered', set.uncovered.length === 1);
  }
  {
    // A breaker targeting an untestable assumption is an invented observation.
    const d = decomposition([
      assumption({ id: 'A1' }),
      assumption({ id: 'A2', testability: 'none' }),
    ]);
    const bad = JSON.stringify({ breakers: [b({ assumptionRef: 'A2' })] });
    check(
      'rejects a breaker on an untestable assumption',
      await throws(() => generateBreakers(d, { llm: new StubLlm([bad]), repairAttempts: 0 })),
    );
  }

  console.log('\n-- coverage enforcement ' + '-'.repeat(39));
  {
    const d = decomposition([
      assumption({ id: 'A1', loadBearing: 'high' }),
      assumption({ id: 'A2', loadBearing: 'high', testability: 'event' }),
    ]);
    const under = JSON.stringify({ breakers: [b({})] });
    const full = JSON.stringify({
      breakers: [
        b({}),
        {
          id: 'B2',
          assumptionRef: 'A2',
          kind: 'event',
          statement: 'a customer cancels',
          watchFor: 'major order cancellation',
          keywords: ['cancellation', 'order cut'],
          severity: 'high',
          cadence: 'event',
        },
      ],
    });
    const llm = new StubLlm([under, full]);
    const set = await generateBreakers(d, { llm, repairAttempts: 1 });
    check('retries when an assumption is uncovered', llm.seen.length === 2, `${llm.seen.length} calls`);
    const msg = llm.seen[1]![llm.seen[1]!.length - 1]!.content;
    check('repair names the skipped assumption', msg.includes('A2'), msg.slice(0, 120));
    check('accepts the completed set', set.breakers.length === 2);
    check('event breaker kept its cadence', set.summary.byCadence.event === 1);
  }
  {
    // Model refuses to fill the gap: keep what we have and report it honestly
    // rather than failing the run or inventing a tripwire.
    const d = decomposition([
      assumption({ id: 'A1' }),
      assumption({ id: 'A2', loadBearing: 'high' }),
    ]);
    const under = JSON.stringify({ breakers: [b({})] });
    const set = await generateBreakers(d, {
      llm: new StubLlm([under]),
      repairAttempts: 1,
    });
    check('keeps partial coverage rather than failing', set.breakers.length === 1);
    check(
      'flags the high-load gap',
      set.summary.uncoveredHighLoad.includes('A2'),
      JSON.stringify(set.summary.uncoveredHighLoad),
    );
  }

  console.log('\n-- quiet-until-earnings detection ' + '-'.repeat(29));
  {
    const d = decomposition([assumption({ id: 'A1' })]);
    const set = await generateBreakers(d, {
      llm: new StubLlm([JSON.stringify({ breakers: [b({})] })]),
    });
    check('detects that nothing can fire before earnings', set.summary.quietUntilEarnings === true);
  }
  {
    const d = decomposition([assumption({ id: 'A1', testability: 'price' })]);
    const set = await generateBreakers(d, {
      llm: new StubLlm([
        JSON.stringify({ breakers: [b({ metric: 'return30d', operator: '<', threshold: -20 })] }),
      ]),
    });
    check('quiet flag clears when a continuous breaker exists', set.summary.quietUntilEarnings === false);
  }

  console.log('\n-- rejects unusable conditions ' + '-'.repeat(32));
  {
    const d = decomposition([assumption({ id: 'A1' })]);
    for (const [name, payload] of [
      ['unknown metric', b({ metric: 'vibes' })],
      ['bad operator', b({ operator: '~' })],
      ['non-numeric threshold', b({ threshold: 'quite low' })],
      ['dangling assumptionRef', b({ assumptionRef: 'A99' })],
      ['event breaker with no keywords', { ...b({ kind: 'event' }), watchFor: 'x', keywords: [] }],
    ] as const) {
      check(
        `rejects ${name}`,
        await throws(() =>
          generateBreakers(d, {
            llm: new StubLlm([JSON.stringify({ breakers: [payload] })]),
            repairAttempts: 0,
          }),
        ),
      );
    }
  }

  console.log('\n' + '-'.repeat(66));
  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('selftest crashed:', err);
  process.exit(1);
});
