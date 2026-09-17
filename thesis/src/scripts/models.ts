import '../env.js';
/**
 * Preflight: what models can this key reach, how are the seats wired, and how
 * much daily quota is left.
 *
 * AI Studio model ids do not match the display names in the console — the
 * dashboard says "Gemini 3.1 Flash Lite", the API wants something else. Run
 * this to get the ids to put in .env.
 *
 *   npm run models
 */
import { describeSeats, GEMINI_BASE_URL, getRateLimiter } from '../llm/index';

interface ModelsResponse {
  data?: Array<{ id: string; object?: string; owned_by?: string }>;
  error?: { message?: string };
}

async function listGeminiModels(apiKey: string): Promise<string[]> {
  const url = `${GEMINI_BASE_URL.replace(/\/$/, '')}/models`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} from ${url}\n${body.slice(0, 400)}`);
  }

  const payload = (await res.json()) as ModelsResponse;
  if (payload.error) throw new Error(payload.error.message ?? 'unknown error');
  return (payload.data ?? []).map((m) => m.id.replace(/^models\//, '')).sort();
}

function rule(label: string): void {
  console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 58 - label.length))}`);
}

async function main(): Promise<void> {
  rule('seat wiring');
  console.log(
    `  ${'seat'.padEnd(13)} ${'model'.padEnd(30)} ${'RPM'.padStart(4)} ${'RPD'.padStart(5)}  key`,
  );
  for (const s of describeSeats()) {
    const rpm = s.limits.rpm || '∞';
    const rpd = s.limits.rpd || '∞';
    console.log(
      `  ${s.seat.padEnd(13)} ${s.model.padEnd(30)} ${String(rpm).padStart(4)} ${String(rpd).padStart(5)}  ${s.keySet ? 'set' : 'MISSING'}`,
    );
  }

  rule('daily quota used');

  // Seats per model, so "runs left" reflects what each model actually costs
  // per run. Gemini carries the decomposer, which is two calls, and Qwen
  // carries one.
  const callsPerRun = new Map<string, number>();
  for (const s of describeSeats()) {
    callsPerRun.set(s.model, (callsPerRun.get(s.model) ?? 0) + 1);
  }

  const usage = getRateLimiter().allUsage();
  let bottleneck = { model: '', runs: Infinity };

  for (const u of usage) {
    if (u.limit === 0) {
      console.log(`  ${u.key.padEnd(30)} ${u.used} used (no limit configured)`);
      continue;
    }
    const perRun = callsPerRun.get(u.key) ?? 1;
    const runsLeft = Math.floor((u.limit - u.used) / perRun);
    const bar = '█'.repeat(Math.round((u.used / u.limit) * 20)).padEnd(20, '░');
    console.log(
      `  ${u.key.padEnd(30)} ${bar} ${u.used}/${u.limit}` +
        `   ${perRun} call${perRun === 1 ? '' : 's'}/run → ≈${runsLeft} runs left`,
    );
    if (runsLeft < bottleneck.runs) bottleneck = { model: u.key, runs: runsLeft };
  }

  if (bottleneck.model) {
    console.log(`\n  Bottleneck: ${bottleneck.model} — ≈${bottleneck.runs} complete runs left today.`);
  }

  rule('models this key can reach');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('  GEMINI_API_KEY not set — skipping. Add it to .env to list models.');
  } else {
    try {
      const models = await listGeminiModels(apiKey);
      const interesting = models.filter((m) => m.includes('gemini'));
      console.log(`  ${models.length} models total, ${interesting.length} gemini:\n`);
      for (const m of interesting) {
        const tag = m.includes('lite') ? '  ← high RPD, use for volume seats' : '';
        console.log(`    ${m}${tag}`);
      }
      console.log('\n  Put the id you want in .env as GEMINI_VOLUME_MODEL.');
    } catch (err) {
      console.log(`  Could not list models: ${(err as Error).message}`);
    }
  }
  console.log();
}

main().catch((err) => {
  console.error('models failed:', err);
  process.exit(1);
});
