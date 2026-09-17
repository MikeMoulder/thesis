/**
 * Prove the 24/7 cron is actually running.
 *
 *   npm run cron:check
 *   npm run cron:check -- https://some-other-deployment.vercel.app
 *
 * WHY THIS READS THE DEPLOYMENT AND NOT THE VPS LOG
 *
 * /var/log/thesis/recheck.log on the box answers "did curl send a request".
 * That is not the claim the product makes. The screen says "last checked 18
 * minutes ago", and the only thing that can back that up is a check actually
 * landing in the append-only log on the deployment. A cron firing perfectly
 * into a 401, a 503, or a deployment that has since been replaced produces a
 * log full of green on the VPS and a thesis nobody has looked at since
 * Tuesday. So this asks the deployment, from outside, with no credentials.
 *
 * WHY ONLY source 'live' COUNTS
 *
 * Checks carry a source. 'backfill' is replayed history and 'initial' is the
 * one written at creation, and counting either would flatter the cadence with
 * work the cron never did. 'live' is written in exactly one place,
 * recheckAll, which in production is reachable only through the
 * secret-guarded /api/recheck. So a live check is a cron check by
 * construction.
 *
 * WHY IT MEASURES GAPS AND NOT JUST RECENCY
 *
 * "Last checked 4 minutes ago" is true of a cron that has run for a week and
 * equally true of one that died on Sunday and came back ninety seconds ago.
 * Only the spacing between checks tells those two apart, so the gaps are the
 * measurement and recency is a single row in it.
 */
import '../env';

/** Where production lives, when nothing overrides it. */
const DEFAULT_URL = 'https://thesis-stocks.vercel.app';

/** Treat a gap this many times the normal spacing as a skipped tick. */
const MISS_FACTOR = 1.5;

/** Past this many normal spacings with no check, the cron has stopped. */
const STALE_FACTOR = 2.5;

/** How far back to judge. Older checks are reported but not scored. */
const WINDOW_HOURS = 24;

interface Check {
  at: string;
  source: 'live' | 'backfill' | 'initial';
}

interface Summary {
  id: string;
  ticker: string;
  status: string;
  checkCount: number;
  lastCheckedAt?: string;
}

const MINUTE = 60_000;

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(20)} ${value}`);
}

function rule(label = ''): void {
  console.log(label ? `\n-- ${label} ${'-'.repeat(Math.max(0, 56 - label.length))}` : '-'.repeat(60));
}

/**
 * Durations, not timestamps, because the question here is always "how long
 * ago" and never "at what o'clock".
 */
function ago(ms: number): string {
  const mins = Math.round(ms / MINUTE);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${String(mins % 60).padStart(2, '0')}m`;
  return `${Math.floor(hours / 24)}d ${String(hours % 24).padStart(2, '0')}h`;
}

/**
 * The median, not the mean. One eight-hour outage drags an average far enough
 * to make a healthy fifteen-minute cadence look like a twenty-minute one, and
 * every gap then gets scored against a baseline the outage invented.
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return (await response.json()) as T;
}

interface Verdict {
  state: 'alive' | 'gaps' | 'stale' | 'dead';
  cadenceMin: number;
  lastAgoMs: number;
  liveChecks: number;
  missed: number;
  longestGapMin: number;
  longestGapAt?: string;
}

function judge(checks: Check[], now: number): Verdict {
  const live = checks
    .filter((c) => c.source === 'live')
    .map((c) => Date.parse(c.at))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  if (live.length < 2) {
    return {
      state: 'dead',
      cadenceMin: 0,
      lastAgoMs: live.length ? now - live[0]! : Infinity,
      liveChecks: live.length,
      missed: 0,
      longestGapMin: 0,
    };
  }

  const gaps: number[] = [];
  for (let i = 1; i < live.length; i += 1) gaps.push(live[i]! - live[i - 1]!);

  const cadence = median(gaps);
  const lastAgo = now - live[live.length - 1]!;

  // Score only the recent window. A gap from three days ago is history, and
  // failing a live cron for it would make this tool cry wolf for a week.
  const cutoff = now - WINDOW_HOURS * 60 * MINUTE;
  let missed = 0;
  let longest = 0;
  let longestAt: string | undefined;

  for (let i = 1; i < live.length; i += 1) {
    if (live[i]! < cutoff) continue;
    const gap = live[i]! - live[i - 1]!;
    if (gap > longest) {
      longest = gap;
      longestAt = new Date(live[i - 1]!).toISOString();
    }
    if (gap > cadence * MISS_FACTOR) missed += Math.round(gap / cadence) - 1;
  }

  const state: Verdict['state'] =
    lastAgo > cadence * STALE_FACTOR ? 'stale' : missed > 0 ? 'gaps' : 'alive';

  return {
    state,
    cadenceMin: cadence / MINUTE,
    lastAgoMs: lastAgo,
    liveChecks: live.length,
    missed,
    longestGapMin: longest / MINUTE,
    ...(longestAt ? { longestGapAt: longestAt } : {}),
  };
}

async function main(): Promise<void> {
  const base = (process.argv[2] ?? process.env.THESIS_URL ?? DEFAULT_URL).replace(/\/$/, '');
  const now = Date.now();

  console.log('\ncron heartbeat');
  line('deployment', base.replace(/^https?:\/\//, ''));
  line('checked at', new Date(now).toISOString());

  let list: { theses: Summary[]; store: { kind: string; persisted: boolean } };
  try {
    list = await getJson(`${base}/api/thesis`);
  } catch (error) {
    console.log(`\n  x Could not reach the deployment: ${(error as Error).message}`);
    console.log('    Nothing below can be measured. Check the URL first.\n');
    process.exit(1);
  }

  line('store', `${list.store.kind}${list.store.persisted ? '' : ' (NOT PERSISTED)'}`);

  if (!list.store.persisted) {
    console.log(
      '\n  x The deployment is running an in-memory store, so checks die with\n' +
        '    the instance. A cron writing into it is doing nothing durable.\n',
    );
    process.exit(1);
  }

  const observed = list.theses.filter((t) => t.status !== 'retired');
  line('under observation', String(observed.length));

  if (observed.length === 0) {
    console.log(
      '\n  ! No live theses, so the cron has nothing to check and its silence\n' +
        '    proves nothing either way. Create a thesis and run this again.\n',
    );
    process.exit(1);
  }

  const verdicts: Array<{ summary: Summary; verdict: Verdict }> = [];

  for (const summary of observed) {
    const detail = await getJson<{ thesis: { checks: Check[] } }>(
      `${base}/api/thesis/${summary.id}`,
    );
    verdicts.push({ summary, verdict: judge(detail.thesis.checks ?? [], now) });
  }

  rule('per thesis');
  console.log(
    `  ${'TICKER'.padEnd(8)}${'CADENCE'.padEnd(10)}${'LAST'.padEnd(10)}` +
      `${'CRON CHECKS'.padEnd(13)}${'MISSED 24H'.padEnd(12)}LONGEST GAP`,
  );

  for (const { summary, verdict } of verdicts) {
    const cadence = verdict.cadenceMin ? `${verdict.cadenceMin.toFixed(0)}m` : 'n/a';
    const last = Number.isFinite(verdict.lastAgoMs) ? ago(verdict.lastAgoMs) : 'never';
    const longest = verdict.longestGapMin ? `${verdict.longestGapMin.toFixed(0)}m` : '-';
    console.log(
      `  ${summary.ticker.padEnd(8)}${cadence.padEnd(10)}${last.padEnd(10)}` +
        `${String(verdict.liveChecks).padEnd(13)}${String(verdict.missed).padEnd(12)}${longest}`,
    );
  }

  // The fleet is only as healthy as its worst thesis. One stale row means the
  // cron is not covering everything, and averaging that away would hide it.
  const rank = { alive: 0, gaps: 1, stale: 2, dead: 3 } as const;
  const worst = verdicts.reduce((w, v) => (rank[v.verdict.state] > rank[w.verdict.state] ? v : w));
  const v = worst.verdict;

  rule('verdict');

  if (v.state === 'alive') {
    console.log(
      `  OK  The cron is running. Every thesis was checked on a ${v.cadenceMin.toFixed(0)}-minute\n` +
        `      cadence with no missed ticks in the last ${WINDOW_HOURS} hours, most recently\n` +
        `      ${ago(v.lastAgoMs)} ago. "Last checked" on screen is a recorded fact.\n`,
    );
    process.exit(0);
  }

  if (v.state === 'gaps') {
    console.log(
      `  !   The cron is running but it skipped ${v.missed} tick(s) on ${worst.summary.ticker} in\n` +
        `      the last ${WINDOW_HOURS} hours. Longest silence was ${v.longestGapMin.toFixed(0)} minutes` +
        `${v.longestGapAt ? ` from ${v.longestGapAt}` : ''}.\n` +
        '      Usually the VPS rebooted, or a run overran its 120s curl timeout.\n' +
        '      Look at: tail -n 100 /var/log/thesis/recheck.log\n',
    );
    process.exit(1);
  }

  if (v.state === 'stale') {
    console.log(
      `  x   The cron has STOPPED. ${worst.summary.ticker} was last checked ${ago(v.lastAgoMs)} ago\n` +
        `      against a normal cadence of ${v.cadenceMin.toFixed(0)} minutes.\n` +
        '      Check in this order, because each one looks the same from here:\n' +
        '        1. crontab -l                           is the entry still installed\n' +
        '        2. tail /var/log/thesis/recheck.log     AUTH means the secret rotated\n' +
        '        3. RECHECK_SECRET on the deployment matches /etc/thesis.env\n',
    );
    process.exit(1);
  }

  console.log(
    `  x   No cron checks exist at all on ${worst.summary.ticker}. Every check it has was\n` +
      '      written at creation or by a backfill, so nothing outside this app has\n' +
      '      ever called /api/recheck successfully. The schedule is not installed,\n' +
      '      or every call it has made was rejected.\n',
  );
  process.exit(1);
}

main().catch((error) => {
  console.error(`\ncron:check failed: ${(error as Error).message}\n`);
  process.exit(1);
});
