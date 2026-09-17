import { getDataSource } from '@/data/index';

/**
 * Deployment diagnostic.
 *
 * Exists to answer one question that cannot be answered locally: can the host
 * region reach Bitget at all? Bitget geo-blocks, and Vercel defaults to US East
 * where it restricts access — so a live rToken quote can fail in production
 * while working perfectly on a developer machine behind a VPN.
 *
 * It probes through the real DataSource rather than with ad-hoc fetches, so a
 * pass here means the shipping code path works, not merely that the host has
 * internet.
 */

export const runtime = 'nodejs'; // the Bitget Agent Hub SDK is Node-only
export const dynamic = 'force-dynamic'; // never cache a reachability probe
export const maxDuration = 30;

type Probe = {
  name: string;
  ok: boolean;
  latencyMs: number | null;
  detail: string | null;
};

async function timed<T>(name: string, run: () => Promise<T>): Promise<[Probe, T | null]> {
  const started = Date.now();
  try {
    const value = await run();
    return [{ name, ok: true, latencyMs: Date.now() - started, detail: null }, value];
  } catch (error) {
    return [
      {
        name,
        ok: false,
        latencyMs: Date.now() - started,
        detail: error instanceof Error ? error.message : String(error),
      },
      null,
    ];
  }
}

export async function GET() {
  const source = getDataSource();
  const probes: Probe[] = [];

  // 1. Per-provider health, as the engine itself reports it.
  const [healthProbe, health] = await timed('healthCheck', () => source.healthCheck());
  probes.push(healthProbe);

  // 2. Instrument resolution — Bitget instrument list + SEC ticker map.
  const [resolveProbe, instrument] = await timed('resolve(NVDA)', () => source.resolve('NVDA'));
  probes.push(resolveProbe);

  // 3. The call that actually matters: a live rToken quote from Bitget.
  //    This is the one most likely to be geo-blocked.
  let quote: { last: number; symbol: string; changePct24h: number | null } | null = null;
  if (instrument) {
    const [quoteProbe, sourced] = await timed('getQuote(rNVDA)', () =>
      source.getQuote(instrument),
    );
    probes.push(quoteProbe);
    if (sourced) {
      quote = {
        last: sourced.value.last,
        symbol: sourced.value.symbol,
        changePct24h: sourced.value.changePct24h ?? null,
      };
    }
  }

  const allOk = probes.every((p) => p.ok);

  return Response.json(
    {
      ok: allOk,
      host: {
        // Populated by Vercel at runtime; undefined when running locally.
        region: process.env.VERCEL_REGION ?? 'local',
        env: process.env.VERCEL_ENV ?? 'development',
      },
      dataSource: source.name,
      probes,
      providers: health?.providers ?? null,
      quote,
      checkedAt: new Date().toISOString(),
    },
    {
      status: allOk ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
