/**
 * Prove the sponsor model actually answers, and measure how fast.
 *
 *   npm run qwen:check                 five live calls through challenge()
 *   npm run qwen:check -- 10           ten of them
 *   npm run qwen:check -- 3 --compare  also sends one call the OLD way
 *
 * Like tg:check and memory:check, this one hits the network on purpose. The
 * self-tests prove the logic against a stub; only a live call proves the
 * gateway. And this particular gateway failed in a way no self-test could
 * ever have caught.
 *
 * ## What --compare demonstrates
 *
 * qwen3.8-max is a reasoning model. It generates hidden reasoning tokens
 * before writing any content, and on a real analytical prompt that pass
 * consumes the whole budget before an answer exists. Sending
 * enable_thinking: false removes it.
 *
 * --compare sends the identical prompt WITHOUT the flag, which is what this
 * project shipped until 17 Sep 2026. Expect it to burn the full timeout and
 * return nothing. That is the point of the flag, shown rather than asserted.
 *
 * Prints latencies and what the model found. Never prints the key.
 */
import '../env';

import {
  CHALLENGE_SYSTEM,
  CHALLENGE_TIMEOUT_MS,
  buildChallengeUser,
  challenge,
} from '../engine/challenge';
import { summarise, type Decomposition } from '../engine/decomposer/types';
import { QWEN_MODEL, getLlm } from '../llm/index';

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(20)} ${value}`);
}

function rule(label = ''): void {
  console.log(label ? `\n-- ${label} ${'-'.repeat(Math.max(0, 56 - label.length))}` : '-'.repeat(60));
}

/**
 * A fixed thesis to ask about.
 *
 * Tooling input, not product output. It never reaches a user and nothing
 * downstream reads it. A live check needs the SAME prompt every time or the
 * latencies it reports are not comparable to each other.
 */
function sample(): Decomposition {
  const claims = [
    { id: 'C1', statement: 'Tesla rerates higher over the next six months.', origin: 'stated' as const },
  ];
  const assumptions = [
    {
      id: 'A1',
      statement: 'Tesla delivers a materially cheaper model within the horizon',
      origin: 'stated' as const,
      supports: ['C1'],
      loadBearing: 'high' as const,
      testability: 'event' as const,
      dataNeeded: 'A product announcement or delivery report naming the model and its price',
      rationale: 'The whole reacceleration case rests on this arriving inside the horizon',
    },
    {
      id: 'A2',
      statement: 'Energy storage gross margin continues expanding',
      origin: 'implicit' as const,
      supports: ['C1'],
      loadBearing: 'high' as const,
      testability: 'fundamental' as const,
      dataNeeded: 'Energy segment gross margin from the next filed quarter',
      rationale: 'Never stated, but the rerate does not happen if storage margin rolls over',
    },
  ];
  return {
    ticker: 'TSLA',
    thesis:
      'Tesla deliveries reaccelerate as the cheaper model lands and energy storage margins keep expanding, so the stock rerates higher.',
    horizon: '6 months',
    claims,
    assumptions,
    ambiguities: [],
    summary: summarise(claims, assumptions),
    meta: { model: 'qwen:check fixture', latencyMs: 0, decomposedAt: new Date().toISOString() },
  };
}

async function main(): Promise<void> {
  console.log('\nqwen');

  line('QWEN_API_KEY', process.env.QWEN_API_KEY ? 'set' : 'MISSING');
  line('model', QWEN_MODEL);
  line('timeout', `${CHALLENGE_TIMEOUT_MS}ms`);

  if (!process.env.QWEN_API_KEY) {
    console.log(
      '\n  x No key. The second opinion is optional by design, so the app still\n' +
        '    runs without it, but this check cannot. Put QWEN_API_KEY in .env.\n',
    );
    process.exit(1);
  }

  const runs = Number(process.argv[2] ?? 5);
  if (!Number.isFinite(runs) || runs < 1) {
    console.log(`\n  x "${process.argv[2]}" is not a run count.\n`);
    process.exit(1);
  }

  const d = sample();

  rule(`${runs} live calls, enable_thinking off`);
  const latencies: number[] = [];
  let answered = 0;

  for (let i = 1; i <= runs; i++) {
    const result = await challenge(d);
    const ok = !result.skipped;
    if (ok) answered++;
    latencies.push(result.latencyMs);

    console.log(
      `  ${String(i).padStart(2)}  ${ok ? 'OK  ' : 'SKIP'}  ${String(result.latencyMs).padStart(6)}ms  ` +
        `added ${result.added.length}` +
        (result.skipped ? `  :: ${result.skipped.slice(0, 60)}` : ''),
    );
    for (const a of result.added) console.log(`        + ${a.statement}`);
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  rule('result');
  line('answered', `${answered} of ${runs}`);
  line('min', `${sorted[0]}ms`);
  line('median', `${sorted[Math.floor(sorted.length / 2)]}ms`);
  line('max', `${sorted[sorted.length - 1]}ms`);

  if (process.argv.includes('--compare')) {
    rule('control: the same prompt WITHOUT the flag');
    console.log('  This is what shipped until 17 Sep. Expect it to burn the timeout.\n');
    const started = Date.now();
    try {
      const raw = await getLlm('bear').complete(
        [
          { role: 'system', content: CHALLENGE_SYSTEM },
          { role: 'user', content: buildChallengeUser(d) },
        ],
        { temperature: 0.4, json: false, maxTokens: 700, timeoutMs: CHALLENGE_TIMEOUT_MS },
      );
      line('answered', `${Date.now() - started}ms`);
      console.log(`        ${raw.text.slice(0, 120).replace(/\s+/g, ' ')}`);
    } catch (err) {
      line('failed', `${Date.now() - started}ms`);
      console.log(`        ${(err as Error).message.slice(0, 100)}`);
    }
  }

  if (answered === 0) {
    console.log(
      '\n  x The gateway answered nothing. The app degrades correctly without it,\n' +
        '    so this is not fatal, but the second opinion is not running.\n',
    );
    process.exit(1);
  }

  console.log(`\n  OK  ${QWEN_MODEL} is answering, and it is finding assumptions.\n`);
}

main().catch((error) => {
  console.error(`\nqwen:check failed: ${(error as Error).message}\n`);
  process.exit(1);
});
