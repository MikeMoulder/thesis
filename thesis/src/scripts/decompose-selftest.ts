/**
 * Self-test for the decomposer pipeline, with no live model.
 *
 * Exercises everything between the model and the caller: JSON recovery from
 * messy output, schema validation, the repair round-trip, and the derived
 * counts. Run with: npm run decompose:selftest
 *
 * The live path is src/scripts/decompose.ts, which needs API keys.
 */
import { decompose, type Decomposition } from '../engine/decomposer/index';
import { extractJson } from '../llm/json';
import { checkDataNeeded } from '../engine/decomposer/capabilities';
import { MalformedOutputError, type CompletionOptions, type CompletionResult, type LlmClient, type Message } from '../llm/types';

/** A model that returns whatever script it was handed, one reply per turn. */
class StubLlm implements LlmClient {
  readonly model = 'stub-1';
  readonly label = 'stub';
  private turn = 0;
  readonly seen: Message[][] = [];

  constructor(private readonly replies: string[]) {}

  async complete(messages: Message[], _opts?: CompletionOptions): Promise<CompletionResult> {
    this.seen.push([...messages]);
    const text = this.replies[Math.min(this.turn, this.replies.length - 1)]!;
    this.turn++;
    return { text, model: this.model, latencyMs: 1 };
  }
}

const GOOD = JSON.stringify({
  claims: [{ id: 'C1', statement: 'NVDA is undervalued at the current price', direction: 'bullish' }],
  assumptions: [
    {
      id: 'A1',
      statement: 'AI infrastructure capex continues growing through the horizon',
      origin: 'stated',
      supports: ['C1'],
      loadBearing: 'high',
      testability: 'event',
      dataNeeded: 'hyperscaler capex guidance from quarterly calls and announcements',
      rationale: 'The user states this as the driver of the whole thesis',
    },
    {
      id: 'A2',
      statement: 'NVIDIA retains its share of AI accelerator spending',
      origin: 'implicit',
      supports: ['C1'],
      loadBearing: 'high',
      testability: 'fundamental',
      dataNeeded: 'quarterly revenue and growth rate from 10-Q filings, trailing 8 quarters',
      rationale: 'Sector growth does not reach NVDA unless it holds share against competitors',
    },
    {
      id: 'A3',
      statement: 'Gross margin remains above 70%',
      origin: 'implicit',
      supports: ['C1'],
      loadBearing: 'medium',
      testability: 'fundamental',
      dataNeeded: 'quarterly gross margin derived from 10-Q filings',
      rationale: 'Valuation support depends on profitability holding, not just revenue',
    },
    {
      id: 'A4',
      statement: 'The current price does not already discount expected AI capex growth',
      origin: 'implicit',
      supports: ['C1'],
      loadBearing: 'high',
      testability: 'none',
      dataNeeded: 'no available data establishes what the market has priced in',
      rationale:
        'The step from "demand grows" to "undervalued" requires the market to be wrong, which the user never states',
    },
  ],
  ambiguities: ['No horizon given; "undervalued" over 3 months and 3 years are different claims'],
});

const BAD_ENUM = JSON.stringify({
  claims: [{ id: 'C1', statement: 'NVDA goes up' }],
  assumptions: [
    {
      id: 'A1',
      statement: 'Revenue grows',
      origin: 'stated',
      supports: ['C1'],
      loadBearing: 'high',
      testability: 'earnings', // not a valid category
      dataNeeded: 'x',
      rationale: 'y',
    },
  ],
  ambiguities: [],
});

const CITES_UNAVAILABLE = JSON.stringify({
  claims: [{ id: 'C1', statement: 'NVDA outperforms', direction: 'bullish' }],
  assumptions: [
    {
      id: 'A1',
      statement: 'The market has not priced this in',
      origin: 'implicit',
      supports: ['C1'],
      loadBearing: 'high',
      testability: 'price',
      dataNeeded: 'consensus analyst price targets and forward earnings estimates',
      rationale: 'The step from growth to mispricing needs the market to be wrong',
    },
    {
      id: 'A2',
      statement: 'Automotive margins recover',
      origin: 'stated',
      supports: ['C1'],
      loadBearing: 'medium',
      testability: 'fundamental',
      dataNeeded: 'quarterly automotive gross profit divided by automotive revenue',
      rationale: 'Stated driver',
    },
  ],
  ambiguities: [],
});

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

async function main(): Promise<void> {
  const input = {
    ticker: 'NVDA',
    thesis:
      "I'm bullish on NVDA after earnings. AI infrastructure demand will keep accelerating, and NVIDIA's earnings growth justifies the valuation.",
  };

  console.log('\n── json recovery ' + '─'.repeat(46));
  check('parses bare json', (extractJson<{ a: number }>('{"a":1}')).a === 1);
  check(
    'parses fenced json',
    (extractJson<{ a: number }>('```json\n{"a":2}\n```')).a === 2,
  );
  check(
    'parses json wrapped in prose',
    (extractJson<{ a: number }>('Sure! Here you go:\n{"a":3}\nHope that helps.')).a === 3,
  );
  check(
    'brace inside a string does not truncate',
    (extractJson<{ a: string }>('{"a":"} not the end {"}')).a === '} not the end {',
  );
  check('throws on non-json', await throws(() => extractJson('no json at all')));

  console.log('\n── happy path ' + '─'.repeat(49));
  const llm = new StubLlm([GOOD]);
  const d = await decompose(input, { llm });

  check('claims extracted', d.claims.length === 1, `got ${d.claims.length}`);
  check('assumptions extracted', d.assumptions.length === 4, `got ${d.assumptions.length}`);
  check('counts claims', d.summary.claimCount === 1);
  check('counts assumptions', d.summary.assumptionCount === 4);
  check('counts verifiable (3 of 4)', d.summary.verifiableCount === 3, `got ${d.summary.verifiableCount}`);
  check('counts implicit (3 of 4)', d.summary.implicitCount === 3, `got ${d.summary.implicitCount}`);
  check(
    'flags unfalsifiable load-bearing assumption A4',
    d.summary.unfalsifiableLoadBearing.length === 1 && d.summary.unfalsifiableLoadBearing[0] === 'A4',
    JSON.stringify(d.summary.unfalsifiableLoadBearing),
  );
  check('records ambiguity', d.ambiguities.length === 1);
  check('records model', d.meta.model === 'stub-1');

  console.log('\n── repair round-trip ' + '─'.repeat(42));
  const repairLlm = new StubLlm([BAD_ENUM, GOOD]);
  const repaired = await decompose(input, { llm: repairLlm, repairAttempts: 1 });
  check('recovers after invalid enum', repaired.assumptions.length === 4);
  check('made exactly two calls', repairLlm.seen.length === 2, `got ${repairLlm.seen.length}`);
  const repairTurn = repairLlm.seen[1]!;
  const complaint = repairTurn[repairTurn.length - 1]!.content;
  check(
    'repair prompt names the offending field',
    complaint.includes('testability') && complaint.includes('earnings'),
    complaint.slice(0, 120),
  );

  console.log('\n-- capability enforcement ' + '-'.repeat(37));
  check('catches consensus estimates', checkDataNeeded('consensus analyst price targets').length > 0);
  check('catches forward multiples', checkDataNeeded('forward P/E ratio trends').length > 0);
  check('catches market share', checkDataNeeded('data center market share estimates').length > 0);
  check(
    'catches segment breakout without the word "segment"',
    checkDataNeeded('quarterly automotive gross profit divided by automotive revenue').length > 0,
  );
  check(
    'catches segment qualifier split by another word (automotive GROSS margin)',
    checkDataNeeded('quarterly automotive gross margin derived from 10-Q filings').length > 0,
  );
  check(
    'catches data center operating income',
    checkDataNeeded('data center operating income, trailing 8 quarters').length > 0,
  );
  check('catches explicit segment wording', checkDataNeeded('segment revenue breakdown').length > 0);
  check('catches backlog', checkDataNeeded('order book and backlog trends').length > 0);

  // False positives would be worse than the leak: they would strip real
  // breakers off genuinely testable assumptions.
  check(
    'allows a STATED proxy for segment data',
    checkDataNeeded(
      'company-wide quarterly gross margin from 10-Q filings as a proxy for automotive margin',
    ).length === 0,
  );
  check(
    'still blocks consensus even when called a proxy',
    checkDataNeeded('analyst consensus estimates as a proxy for market expectations').length > 0,
  );
  check(
    'allows company-total revenue',
    checkDataNeeded('quarterly total revenue from 10-Q filings, trailing 8 quarters').length === 0,
  );
  check(
    'allows gross margin',
    checkDataNeeded('quarterly gross margin derived from 10-Q filings').length === 0,
  );
  check(
    'allows forward GUIDANCE (announceable event, unlike a third-party estimate)',
    checkDataNeeded('management forward guidance announced on the earnings call').length === 0,
  );
  check(
    'allows volatility',
    checkDataNeeded('90-day realised volatility versus the trailing 2-year distribution').length === 0,
  );

  console.log('\n-- soft-problem repair ' + '-'.repeat(40));
  const softLlm = new StubLlm([CITES_UNAVAILABLE, GOOD]);
  const softFixed = await decompose(input, { llm: softLlm, repairAttempts: 1 });
  check('retries when data is unavailable', softLlm.seen.length === 2, `got ${softLlm.seen.length}`);
  const softTurn = softLlm.seen[1]!;
  const softMsg = softTurn[softTurn.length - 1]!.content;
  check(
    'repair names the offending phrase',
    softMsg.includes('consensus') && softMsg.includes('A1'),
    softMsg.slice(0, 140),
  );
  check('accepts the corrected version', softFixed.summary.verifiableCount === 3);

  console.log('\n-- fail-safe downgrade ' + '-'.repeat(40));
  const stubborn = new StubLlm([CITES_UNAVAILABLE]);
  const downgraded = await decompose(input, { llm: stubborn, repairAttempts: 1 });
  check('keeps the decomposition rather than discarding it', downgraded.assumptions.length === 2);
  check(
    'marks both offenders untestable',
    downgraded.assumptions.every((a) => a.testability === 'none'),
    JSON.stringify(downgraded.assumptions.map((a) => a.testability)),
  );
  check('verifiable count drops to 0', downgraded.summary.verifiableCount === 0);
  check(
    'A1 now surfaces in the untestable warning',
    downgraded.summary.unfalsifiableLoadBearing.includes('A1'),
  );

  console.log('\n── gives up cleanly ' + '─'.repeat(43));
  const hopeless = new StubLlm([BAD_ENUM]);
  check(
    'throws MalformedOutputError when repair fails',
    await throws(() => decompose(input, { llm: hopeless, repairAttempts: 1 }), MalformedOutputError),
  );

  console.log('\n── sample output ' + '─'.repeat(46));
  console.log(render(d));

  console.log('─'.repeat(64));
  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

async function throws(fn: () => unknown, type?: new (...a: never[]) => Error): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (err) {
    return type ? err instanceof type : true;
  }
}

/** Roughly how the terminal UI will present this. */
function render(d: Decomposition): string {
  const s = d.summary;
  const lines = [
    `  ${s.claimCount} core claim${s.claimCount === 1 ? '' : 's'}`,
    `  ${s.assumptionCount} assumptions (${s.implicitCount} you did not state)`,
    `  ${s.verifiableCount} externally verifiable`,
    '',
  ];
  for (const a of d.assumptions) {
    const tag = a.origin === 'implicit' ? 'IMPLICIT' : 'stated  ';
    const test = a.testability === 'none' ? 'UNTESTABLE' : a.testability;
    lines.push(`  ${a.id}  [${tag}] [${a.loadBearing.toUpperCase().padEnd(6)}] [${test}]`);
    lines.push(`      ${a.statement}`);
  }
  if (s.unfalsifiableLoadBearing.length) {
    lines.push('', `  ⚠ load-bearing but untestable: ${s.unfalsifiableLoadBearing.join(', ')}`);
  }
  return lines.join('\n');
}

main().catch((err) => {
  console.error('selftest crashed:', err);
  process.exit(1);
});
