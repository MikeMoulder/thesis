/**
 * Run the decomposer against a live model.
 *
 *   npm run decompose -- NVDA "I'm bullish because AI demand keeps accelerating"
 *
 * Needs GEMINI_API_KEY (see .env.example). Run `npm run models` first to
 * confirm model ids and remaining daily quota.
 *
 * For the pipeline without a model, use: npm run decompose:selftest
 */
import '../env.js';
import { decompose, type Decomposition } from '../engine/decomposer/index';
import { LlmError } from '../llm/types';

function render(d: Decomposition): string {
  const s = d.summary;
  const out: string[] = [];

  out.push('', `THESIS — ${d.ticker}`, '─'.repeat(64), d.thesis, '');
  out.push('DECOMPOSITION');
  out.push(`  ${s.claimCount} core claim${s.claimCount === 1 ? '' : 's'}`);
  out.push(`  ${s.assumptionCount} assumptions (${s.implicitCount} you did not state)`);
  out.push(`  ${s.verifiableCount} externally verifiable`);

  out.push('', 'CLAIMS');
  for (const c of d.claims) {
    out.push(`  ${c.id}  ${c.statement}${c.direction ? `  [${c.direction}]` : ''}`);
  }

  out.push('', 'ASSUMPTIONS');
  for (const a of d.assumptions) {
    const origin = a.origin === 'implicit' ? 'IMPLICIT' : 'stated';
    const test = a.testability === 'none' ? 'UNTESTABLE' : a.testability;
    out.push('');
    out.push(`  ${a.id}  [${origin}] [${a.loadBearing} load] [${test}]`);
    out.push(`      ${a.statement}`);
    out.push(`      why: ${a.rationale}`);
    if (!a.dataNeeded) {
      // nothing to say
    } else if (a.testability === 'none') {
      // For untestable assumptions this explains what WOULD settle it and why
      // that is out of reach — the most informative line on the whole card.
      out.push(`      gap: ${a.dataNeeded}`);
    } else {
      out.push(`      test: ${a.dataNeeded}`);
    }
  }

  if (s.unfalsifiableLoadBearing.length) {
    out.push('', '⚠  LOAD-BEARING BUT UNTESTABLE');
    for (const id of s.unfalsifiableLoadBearing) {
      const a = d.assumptions.find((x) => x.id === id);
      out.push(`  ${id}  ${a?.statement ?? ''}`);
    }
    out.push('  No available data can confirm or refute these. You are carrying them on trust.');
  }

  if (d.ambiguities.length) {
    out.push('', 'AMBIGUITIES');
    for (const a of d.ambiguities) out.push(`  • ${a}`);
  }

  out.push('', `${d.meta.model} · ${d.meta.latencyMs}ms`);
  return out.join('\n');
}

async function main(): Promise<void> {
  const [ticker, ...rest] = process.argv.slice(2);
  const thesis = rest.join(' ');

  if (!ticker || !thesis) {
    console.error('usage: npm run decompose -- <TICKER> "<thesis>"');
    process.exit(2);
  }

  try {
    const d = await decompose({ ticker: ticker.toUpperCase(), thesis });
    console.log(render(d));
  } catch (err) {
    if (err instanceof LlmError && err.model === 'unconfigured') {
      console.error(`\n${err.message}\n`);
      console.error('Run `npm run decompose:selftest` to exercise the pipeline without a model.');
      process.exit(3);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error('decompose failed:', err);
  process.exit(1);
});
