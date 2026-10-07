import { getDataSource } from '@/data/index';
import { probe as probeSignalSkills } from '@/data/providers/signal';

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
export const maxDuration = 30; // the Skills probe is bounded well inside this

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

export async function GET(request: Request) {
  const source = getDataSource();
  const probes: Probe[] = [];

  /*
    ?quick=1 answers the only question the sidebar asks: are the sources the
    engine reads up. `ok` never depended on the Skills probe, but every page
    still waited up to six seconds for it, so the health dot sat on
    "checking sources…" for about seven. Quick mode leaves it out; the full
    report is unchanged for anyone diagnosing a deployment.
  */
  const quick = new URL(request.url).searchParams.get('quick') === '1';
  const skillsPending = quick ? Promise.resolve(null) : probeSignalSkills().catch(() => null);

  // 1 and 2 are independent, so they run together rather than in turn.
  //   1. Per-provider health, as the engine itself reports it.
  //   2. Instrument resolution — Bitget instrument list + SEC ticker map.
  const [[healthProbe, health], [resolveProbe, instrument]] = await Promise.all([
    timed('healthCheck', () => source.healthCheck()),
    timed('resolve(NVDA)', () => source.resolve('NVDA')),
  ]);
  probes.push(healthProbe, resolveProbe);

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

  // 4. The bitget-signal Skills, called for real over MCP.
  //
  //    Reported separately from `ok` on purpose. These are Bitget's own
  //    research Skills and most of their upstreams are down at their end, so
  //    folding them into the overall status would mark this deployment
  //    unhealthy for something no change here can fix. What belongs here is
  //    the evidence: which Skills answered, how fast, and which upstream is
  //    responsible when one did not.
  //
  //    Bounded at six seconds per tool and run in parallel, because the
  //    failing ones take 17 to 32 seconds to return nothing. Started at the
  //    top, alongside everything else, and skipped in quick mode.
  const skills = await skillsPending;

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
      signalSkills: quick
        ? { transport: 'mcp', skipped: 'quick check' }
        : skills
          ? {
              transport: 'mcp',
              answering: skills.filter((s) => s.ok).length,
              total: skills.length,
              tools: skills,
            }
          : { transport: 'mcp', answering: 0, total: 0, tools: [], detail: 'MCP handshake failed' },
      checkedAt: new Date().toISOString(),
    },
    {
      status: allOk ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
