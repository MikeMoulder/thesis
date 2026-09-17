import '../env.js';
/**
 * ATTACK MY THESIS — decomposition + thesis breakers.
 *
 *   npm run attack -- NVDA "I'm bullish because AI demand keeps accelerating"
 *
 * Research seats and the judge are not wired yet; this is the spine of the run.
 */
import { decompose, type Decomposition } from '../engine/decomposer/index';
import { generateBreakers, type BreakerSet, type ThesisBreaker } from '../engine/breakers/index';
import { PERCENT_METRICS } from '../engine/breakers/types';
import { LlmError, QuotaExceededError } from '../llm/index';

function rule(label = ''): string {
  return label
    ? `\n${'━'.repeat(66)}\n${label}\n${'━'.repeat(66)}`
    : '─'.repeat(66);
}

function renderDecomposition(d: Decomposition): string {
  const s = d.summary;
  const out: string[] = [];

  out.push(rule('DECOMPOSITION'));
  out.push(
    `${s.claimCount} core claim${s.claimCount === 1 ? '' : 's'} · ` +
      `${s.assumptionCount} assumptions (${s.implicitCount} you did not state) · ` +
      `${s.verifiableCount} externally verifiable`,
  );

  for (const a of d.assumptions) {
    const origin = a.origin === 'implicit' ? 'IMPLICIT' : 'stated';
    const test = a.testability === 'none' ? 'UNTESTABLE' : a.testability;
    out.push('', `  ${a.id}  [${origin}] [${a.loadBearing} load] [${test}]`);
    out.push(`      ${a.statement}`);
  }

  if (s.unfalsifiableLoadBearing.length) {
    out.push('', '⚠  LOAD-BEARING BUT UNTESTABLE');
    for (const id of s.unfalsifiableLoadBearing) {
      const a = d.assumptions.find((x) => x.id === id);
      out.push(`   ${id}  ${a?.statement ?? ''}`);
      if (a?.dataNeeded) out.push(`       ${a.dataNeeded}`);
    }
  }

  return out.join('\n');
}

function describeCondition(b: ThesisBreaker): string {
  if (b.kind === 'event') return `watch: ${b.watchFor}  [${b.keywords.join(', ')}]`;
  const unit = PERCENT_METRICS.has(b.metric) ? '%' : '';
  return `${b.metric} ${b.operator} ${b.threshold}${unit}`;
}

function renderBreakers(bs: BreakerSet): string {
  const out: string[] = [];
  const s = bs.summary;

  out.push(rule('THESIS BREAKERS'));
  out.push(
    `${s.total} breaker${s.total === 1 ? '' : 's'} · ` +
      `${s.byCadence.continuous} continuous · ${s.byCadence.event} event · ${s.byCadence.periodic} periodic`,
  );

  const order = { high: 0, medium: 1, low: 2 } as const;
  const sorted = [...bs.breakers].sort((a, b) => order[a.severity] - order[b.severity]);

  for (const b of sorted) {
    out.push('', `  ${b.id}  [${b.severity.toUpperCase()}] [${b.cadence}]  ← ${b.assumptionRef}`);
    out.push(`      ${b.statement}`);
    out.push(`      ${describeCondition(b)}`);
  }

  if (s.quietUntilEarnings && s.total > 0) {
    out.push(
      '',
      '⚠  NOTHING CAN FIRE UNTIL THE NEXT EARNINGS REPORT',
      '   Every breaker depends on quarterly filings. Your thesis cannot be',
      '   retested before then, however much the price moves.',
    );
  }

  const realGaps = bs.uncovered.filter((u) => !u.reason.startsWith('no available data'));
  if (realGaps.length) {
    out.push('', 'UNCOVERED ASSUMPTIONS');
    for (const u of realGaps) out.push(`   ${u.assumptionId}  ${u.reason}`);
  }

  if (s.uncoveredHighLoad.length) {
    out.push(
      '',
      s.uncoveredHighLoad.length === 1
        ? `⚠  ${s.uncoveredHighLoad[0]} carries high load and has no breaker.`
        : `⚠  ${s.uncoveredHighLoad.join(', ')} carry high load and have no breakers.`,
      '   You will not get a signal if these fail.',
    );
  }

  if (bs.breakers.some((b) => b.severityInherited)) {
    out.push(
      '',
      'Severity is inherited from how much the thesis leans on each assumption,',
      'not measured from history. Historical base rates are not wired yet.',
    );
  }

  return out.join('\n');
}

async function main(): Promise<void> {
  const [ticker, ...rest] = process.argv.slice(2);
  const thesis = rest.join(' ');
  if (!ticker || !thesis) {
    console.error('usage: npm run attack -- <TICKER> "<thesis>"');
    process.exit(2);
  }

  console.log(rule('YOUR THESIS'));
  console.log(`${ticker.toUpperCase()}\n${thesis}`);

  const d = await decompose({ ticker: ticker.toUpperCase(), thesis });
  console.log(renderDecomposition(d));

  const bs = await generateBreakers(d);
  console.log(renderBreakers(bs));

  console.log(
    `\n${rule()}\n${d.meta.model} · ${d.meta.latencyMs + bs.meta.latencyMs}ms total\n`,
  );
}

main().catch((err) => {
  if (err instanceof QuotaExceededError) {
    console.error(`\n${err.message}\n`);
    console.error('Run `npm run models` to see remaining quota across seats.');
    process.exit(4);
  }
  if (err instanceof LlmError && err.model === 'unconfigured') {
    console.error(`\n${err.message}\n`);
    process.exit(3);
  }
  console.error('attack failed:', err);
  process.exit(1);
});
