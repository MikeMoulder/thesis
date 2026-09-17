import { REQUEST_TIMEOUT_MS, SEC_DATA_BASE, USER_AGENT } from '../config';
import {
  NoDataError,
  ProviderError,
  sourced,
  type DerivedMetric,
  type FundamentalPoint,
  type Instrument,
  type Sourced,
} from '../types';
import type { DerivedMetricName } from '../DataSource';

/**
 * SEC EDGAR XBRL — the fundamentals spine.
 *
 * Chosen over commercial APIs because it is the primary source. A claim here
 * resolves to an actual filing with an accession number a human can open, which
 * is the strongest citation THESIS can offer. Commercial feeds are a vendor's
 * copy of this data.
 *
 * What EDGAR does NOT provide: forward guidance (prose in 8-K exhibits) and
 * analyst consensus (proprietary). Those stay 'unverifiable' by design.
 */

interface CompanyFacts {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, XbrlConcept>>;
}

interface XbrlConcept {
  label?: string;
  description?: string;
  units: Record<string, XbrlFact[]>;
}

interface XbrlFact {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy?: number;
  fp?: string;
  form: string;
  filed: string;
  frame?: string;
}

const factsCache = new Map<string, CompanyFacts>();

function requireCik(instrument: Instrument): string {
  if (!instrument.cik) {
    throw new NoDataError(
      `${instrument.ticker} has no SEC CIK — likely a foreign issuer without US filings`,
      'edgar',
    );
  }
  return instrument.cik;
}

async function fetchCompanyFacts(cik: string): Promise<CompanyFacts> {
  const cached = factsCache.get(cik);
  if (cached) return cached;

  const url = `${SEC_DATA_BASE}/api/xbrl/companyfacts/CIK${cik}.json`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new ProviderError(`Could not reach SEC EDGAR (${url})`, 'edgar', cause);
  }
  if (res.status === 404) throw new NoDataError(`No XBRL facts filed for CIK ${cik}`, 'edgar');
  if (res.status === 403) {
    throw new ProviderError(
      'SEC returned 403 — set SEC_USER_AGENT to a descriptive string with contact details',
      'edgar',
    );
  }
  if (!res.ok) throw new ProviderError(`SEC EDGAR HTTP ${res.status}`, 'edgar');

  const facts = (await res.json()) as CompanyFacts;
  factsCache.set(cik, facts);
  return facts;
}

/** Filings report the same concept under different taxonomies; check both. */
function findConcept(facts: CompanyFacts, concept: string): XbrlConcept | undefined {
  for (const taxonomy of ['us-gaap', 'ifrs-full', 'dei']) {
    const hit = facts.facts[taxonomy]?.[concept];
    if (hit) return hit;
  }
  return undefined;
}

/**
 * A quarterly fact covers roughly 90 days. EDGAR mixes quarterly, annual and
 * year-to-date facts in the same array with no flag distinguishing them, so
 * duration is the only reliable filter.
 */
function isQuarterly(f: XbrlFact): boolean {
  if (!f.start) return false;
  const days = (Date.parse(f.end) - Date.parse(f.start)) / 86_400_000;
  return days >= 80 && days <= 100;
}

function isAnnual(f: XbrlFact): boolean {
  if (!f.start) return false;
  const days = (Date.parse(f.end) - Date.parse(f.start)) / 86_400_000;
  return days >= 350 && days <= 380;
}

/**
 * Keep the most recently filed version of each period — restatements supersede —
 * while remembering when the period was FIRST reported. See FundamentalPoint
 * for why both dates matter.
 */
interface PeriodRecord {
  /** The currently standing value — from the most recent filing. */
  fact: XbrlFact;
  /** When this period was first reported — the market's event date. */
  firstFiled: string;
}

function latestByPeriod(
  facts: XbrlFact[],
  filter: (f: XbrlFact) => boolean,
): Map<string, PeriodRecord> {
  const out = new Map<string, PeriodRecord>();
  for (const f of facts) {
    if (!filter(f)) continue;
    if (f.form !== '10-Q' && f.form !== '10-K') continue;

    const prev = out.get(f.end);
    if (!prev) {
      out.set(f.end, { fact: f, firstFiled: f.filed });
      continue;
    }
    out.set(f.end, {
      fact: Date.parse(f.filed) > Date.parse(prev.fact.filed) ? f : prev.fact,
      firstFiled:
        Date.parse(f.filed) < Date.parse(prev.firstFiled) ? f.filed : prev.firstFiled,
    });
  }
  return out;
}

/**
 * Reconstruct fiscal Q4.
 *
 * Issuers file 10-Qs for Q1–Q3 only; Q4 appears nowhere as a standalone
 * quarterly fact, because the 10-K reports the full year instead. Without this,
 * every quarterly series silently loses one quarter a year — which would make a
 * `periodic` thesis breaker skip an entire reporting period without saying so.
 *
 * Q4 = FY total − (Q1 + Q2 + Q3), derived only when all three quarters fall
 * inside the annual window. The result is flagged `derived` so nothing
 * downstream can present it as a filed number.
 */
function deriveQ4(
  annuals: Map<string, PeriodRecord>,
  quarters: Map<string, PeriodRecord>,
  concept: string,
  unit: string,
): FundamentalPoint[] {
  const derived: FundamentalPoint[] = [];
  const quarterList = [...quarters.values()].map((r) => r.fact);

  for (const record of annuals.values()) {
    const fy = record.fact;
    if (!fy.start) continue;
    if (quarters.has(fy.end)) continue; // Q4 already reported outright.

    const fyStart = Date.parse(fy.start);
    const fyEnd = Date.parse(fy.end);

    const inside = quarterList.filter((q) => {
      if (!q.start) return false;
      return Date.parse(q.start) >= fyStart && Date.parse(q.end) <= fyEnd;
    });

    // Anything other than exactly three means we cannot trust the subtraction:
    // a missing quarter would inflate Q4, a duplicate would deflate it.
    if (inside.length !== 3) continue;

    const sum = inside.reduce((acc, q) => acc + q.val, 0);
    const q4Start = inside
      .map((q) => q.end)
      .sort()
      .at(-1)!;

    derived.push({
      concept,
      start: q4Start,
      end: fy.end,
      value: fy.val - sum,
      unit,
      form: fy.form,
      accession: fy.accn,
      filed: fy.filed,
      // A reconstructed Q4 became knowable when the annual report landed, so
      // that is its event date even if the 10-K itself was later restated.
      firstFiled: record.firstFiled,
      fy: fy.fy,
      fp: 'Q4',
      derived: true,
      derivation: `FY total (${fy.form} ${fy.accn}) minus the three filed quarters ending ${inside
        .map((q) => q.end)
        .sort()
        .join(', ')}`,
    });
  }

  return derived;
}

export async function getFundamentalSeries(
  instrument: Instrument,
  concept: string,
  opts: { periodType?: 'quarterly' | 'annual'; limit?: number } = {},
): Promise<Sourced<FundamentalPoint[]>> {
  const cik = requireCik(instrument);
  const facts = await fetchCompanyFacts(cik);
  const node = findConcept(facts, concept);

  if (!node) {
    throw new NoDataError(
      `${instrument.ticker} does not report XBRL concept "${concept}"`,
      'edgar',
    );
  }

  const { periodType = 'quarterly', limit = 12 } = opts;
  const unit = Object.keys(node.units)[0]!;
  const unitFacts = node.units[unit]!;

  const reported = latestByPeriod(unitFacts, periodType === 'annual' ? isAnnual : isQuarterly);

  const asPoints = ({ fact: f, firstFiled }: PeriodRecord): FundamentalPoint => ({
    concept,
    start: f.start,
    end: f.end,
    value: f.val,
    unit,
    form: f.form,
    accession: f.accn,
    filed: f.filed,
    firstFiled,
    fy: f.fy,
    fp: f.fp,
  });

  let all: FundamentalPoint[] = [...reported.values()].map(asPoints);

  // Quarterly series are incomplete without a reconstructed Q4.
  if (periodType === 'quarterly') {
    const annuals = latestByPeriod(unitFacts, isAnnual);
    all = all.concat(deriveQ4(annuals, reported, concept, unit));
  }

  const points: FundamentalPoint[] = all
    .sort((a, b) => Date.parse(a.end) - Date.parse(b.end))
    .slice(-limit);

  if (points.length === 0) {
    throw new NoDataError(
      `${instrument.ticker} reports "${concept}" but no ${periodType} periods matched`,
      'edgar',
    );
  }

  const latest = points[points.length - 1]!;
  const derivedCount = points.filter((p) => p.derived).length;

  return sourced(points, {
    // If the most recent point is a reconstructed Q4, the series as a whole is
    // no longer purely 'sourced' and must not be presented as such.
    status: latest.derived ? 'inferred' : 'sourced',
    source: `SEC ${latest.form} ${latest.accession}`,
    url: filingUrl(cik, latest.accession),
    asOf: latest.filed,
    confidence: 'high',
    ...(derivedCount > 0 && {
      derivation: `${derivedCount} of ${points.length} periods are reconstructed fiscal Q4 (FY minus Q1-Q3); the rest are as filed`,
    }),
  });
}

/** Human-openable link to the filing index. This is what makes a claim checkable. */
export function filingUrl(cik: string, accession: string): string {
  const bare = accession.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${bare}/${accession}-index.htm`;
}

/** Concepts differ by filer; try each in order and use the first that resolves. */
const CONCEPT_CANDIDATES: Record<string, string[]> = {
  revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'],
  grossProfit: ['GrossProfit'],
  operatingIncome: ['OperatingIncomeLoss'],
  netIncome: ['NetIncomeLoss'],
};

async function firstAvailable(
  instrument: Instrument,
  keys: string[],
  limit: number,
): Promise<FundamentalPoint[]> {
  let lastErr: unknown;
  for (const concept of keys) {
    try {
      const r = await getFundamentalSeries(instrument, concept, { limit });
      return r.value;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new NoDataError(`No concept matched ${keys.join(', ')}`, 'edgar');
}

const RATIO_INPUTS: Record<DerivedMetricName, [string, string] | null> = {
  grossMargin: ['grossProfit', 'revenue'],
  operatingMargin: ['operatingIncome', 'revenue'],
  netMargin: ['netIncome', 'revenue'],
  revenueGrowthYoY: null,
};

/**
 * Derived ratios are always 'inferred': the filing reported the inputs, we did
 * the arithmetic. The inputs stay attached so the UI can show the workings.
 */
export async function getDerivedMetric(
  instrument: Instrument,
  metric: DerivedMetricName,
  opts: { limit?: number } = {},
): Promise<Sourced<DerivedMetric[]>> {
  const limit = opts.limit ?? 12;

  if (metric === 'revenueGrowthYoY') {
    // Needs 4 extra quarters to compare against.
    const rev = await firstAvailable(instrument, CONCEPT_CANDIDATES.revenue!, limit + 4);
    const out: DerivedMetric[] = [];
    for (let i = 4; i < rev.length; i++) {
      const cur = rev[i]!;
      const prior = rev[i - 4]!;
      if (prior.value === 0) continue;
      out.push({
        name: metric,
        end: cur.end,
        value: ((cur.value - prior.value) / Math.abs(prior.value)) * 100,
        unit: 'percent',
        inputs: [prior, cur],
      });
    }
    return finishDerived(out.slice(-limit), instrument, metric, 'year-over-year change in reported revenue');
  }

  const pair = RATIO_INPUTS[metric]!;
  const [numeratorKey, denominatorKey] = pair;
  const [numerator, denominator] = await Promise.all([
    firstAvailable(instrument, CONCEPT_CANDIDATES[numeratorKey]!, limit + 4),
    firstAvailable(instrument, CONCEPT_CANDIDATES[denominatorKey]!, limit + 4),
  ]);

  const denomByEnd = new Map(denominator.map((d) => [d.end, d]));
  const out: DerivedMetric[] = [];
  for (const n of numerator) {
    const d = denomByEnd.get(n.end);
    if (!d || d.value === 0) continue;
    out.push({
      name: metric,
      end: n.end,
      value: (n.value / d.value) * 100,
      unit: 'percent',
      inputs: [n, d],
    });
  }

  return finishDerived(
    out.slice(-limit),
    instrument,
    metric,
    `${numeratorKey} / ${denominatorKey} from the same filed period`,
  );
}

function finishDerived(
  points: DerivedMetric[],
  instrument: Instrument,
  metric: string,
  derivation: string,
): Sourced<DerivedMetric[]> {
  if (points.length === 0) {
    throw new NoDataError(`Could not derive ${metric} for ${instrument.ticker}`, 'edgar');
  }
  const latest = points[points.length - 1]!;
  const cite = latest.inputs[0]!;
  // A ratio built on a reconstructed Q4 inherits that uncertainty.
  const usesDerivedQ4 = points.some((p) => p.inputs.some((i) => i.derived));

  return sourced(points, {
    status: 'inferred',
    source: `Computed from SEC ${cite.form} ${cite.accession}`,
    url: instrument.cik ? filingUrl(instrument.cik, cite.accession) : undefined,
    asOf: cite.filed,
    confidence: usesDerivedQ4 ? 'moderate' : 'high',
    derivation: usesDerivedQ4
      ? `${derivation}; some periods use a reconstructed fiscal Q4`
      : derivation,
  });
}

export async function ping(): Promise<{ ok: boolean; detail?: string; latencyMs: number }> {
  const t0 = Date.now();
  try {
    // NVDA — a filer guaranteed to have current XBRL facts.
    await fetchCompanyFacts('0001045810');
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, detail: (err as Error).message, latencyMs: Date.now() - t0 };
  }
}
