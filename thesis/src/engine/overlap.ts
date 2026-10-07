import { createHash } from 'node:crypto';

import { getLlm } from '../llm/index';
import { extractJson } from '../llm/json';
import { command, redisConfig } from '../thesis/store';
import {
  currentVersion,
  latestCheck,
  type Health,
  type ThesisRecord,
} from '../thesis/types';
import type { Metric } from './breakers/types';
import type { Assumption } from './decomposer/types';

/**
 * What a person's theses have in common, read across all of them at once.
 *
 * Every other screen looks at one thesis. That hides the most expensive kind of
 * mistake a person with several positions can make: two theses that quietly
 * rest on the same outside driver, so one surprise breaks both, or two that
 * need opposite things to happen, so at least one of them is wrong by
 * construction.
 *
 * The live data shows both. The TSLA thesis needs AI spending to roll off so
 * margins recover. The NVDA thesis needs the same spending to keep
 * accelerating. Nothing on either thesis page can see that.
 *
 * WHY A MODEL, AND WHY ONLY FOR THIS
 *
 * Whether two sentences depend on the same driver, and in which direction, is
 * comprehension. A keyword match would put "AI spending rolls off" and "AI
 * spending accelerates" in the same bucket and call them aligned, which is
 * exactly backwards. So a model groups the beliefs, and code then refuses
 * anything it cannot verify: every reference must exist, every group must span
 * at least two theses, and the model never sees or writes a number.
 *
 * When no model is available, plain rules still catch the overlaps that are
 * visible in the tripwires themselves, such as two theses that both break on a
 * market-wide sell-off.
 */

export type OverlapRelation = 'shared' | 'opposed';

export interface OverlapMember {
  thesisId: string;
  ticker: string;
  assumptionId: string;
  statement: string;
  loadBearing: Assumption['loadBearing'];
  /** From the thesis's latest check. Absent if it has never been checked. */
  health?: Health | undefined;
}

export interface OverlapGroup {
  /** A few plain words naming the driver, e.g. "AI infrastructure spending". */
  theme: string;
  relation: OverlapRelation;
  /** One sentence: what each position needs from that driver. */
  why: string;
  members: OverlapMember[];
}

export interface OverlapResult {
  groups: OverlapGroup[];
  /** Who grouped them. `none` when there were fewer than two theses. */
  source: 'model' | 'rules' | 'none';
  model?: string | undefined;
  thesisCount: number;
  /** Set when the model was asked and could not be used. */
  skipped?: string | undefined;
  computedAt: string;
}

/** One thesis, flattened to what the grouping needs. */
export interface OverlapThesis {
  id: string;
  ticker: string;
  direction: string;
  beliefs: Array<{
    id: string;
    statement: string;
    loadBearing: Assumption['loadBearing'];
    metrics: Metric[];
    health?: Health | undefined;
  }>;
}

const MAX_GROUPS = 5;
const OVERLAP_TIMEOUT_MS = 25_000;

export function toOverlapThesis(record: ThesisRecord): OverlapThesis {
  const version = currentVersion(record);
  const check = latestCheck(record);
  return {
    id: record.id,
    ticker: record.ticker,
    direction: record.direction,
    beliefs: version.decomposition.assumptions.map((a) => ({
      id: a.id,
      statement: a.statement,
      loadBearing: a.loadBearing,
      metrics: version.breakerSet.breakers
        .filter((b) => b.assumptionRef === a.id && b.kind === 'threshold')
        .map((b) => (b as { metric: Metric }).metric),
      health: check?.assumptions.find((h) => h.assumptionId === a.id)?.health,
    })),
  };
}

/**
 * Which theses, at which versions. A new version or a new thesis changes the
 * beliefs and so the answer; a new check does not, so a re-check every fifteen
 * minutes does not cost a model call.
 */
export function signatureOf(records: ThesisRecord[]): string {
  const parts = records
    .map((r) => `${r.id}@${currentVersion(r).n}`)
    .sort()
    .join('|');
  return createHash('sha256').update(parts).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// MODEL
// ---------------------------------------------------------------------------

export const OVERLAP_SYSTEM = `You compare the beliefs behind several separate stock positions held by one person.

Find beliefs from DIFFERENT positions that depend on the same outside driver: a macro condition, a sector trend, a market regime, a shared supplier, customer or competitor, or a policy.

Do NOT group beliefs just because they are the same kind of company metric about different companies. Two companies each keeping their own margins is not a shared driver, unless one company's result directly drives the other's.

Name each driver as a neutral quantity that can go up or down, such as "AI infrastructure spending" or "interest rates". Never put a direction in the name: not "accelerating AI spending", not "falling rates".

Then, for every belief in the group, say what that position needs from the driver:
- "more": it needs the driver to rise, grow or continue.
- "less": it needs the driver to fall, slow or roll off.

Return json only, in exactly this shape:
{"groups":[{"theme":"...","why":"...","members":[{"ref":"T1.A3","needs":"more"},{"ref":"T2.A1","needs":"less"}]}]}

Rules:
- theme: at most 5 plain words, a neutral quantity. No tickers.
- why: one sentence, at most 35 words, saying what each position needs from the driver. Use the tickers. Never write a ref like T1.A3.
- members: only refs from the list you are given. At least two different positions per group.
- At most ${MAX_GROUPS} groups, most important first.
- If nothing is genuinely shared, return {"groups":[]}. Never invent a belief.`;

const LOAD_WORDS: Record<Assumption['loadBearing'], string> = {
  high: 'the whole trade rests on it',
  medium: 'matters',
  low: 'minor',
};

export function buildOverlapUser(theses: OverlapThesis[]): string {
  return theses
    .map((t, ti) => {
      const head = `T${ti + 1} = ${t.ticker}, ${t.direction === 'bearish' ? 'short' : 'long'}`;
      const lines = t.beliefs.map(
        (b, bi) => `  T${ti + 1}.A${bi + 1} [${LOAD_WORDS[b.loadBearing]}] ${b.statement}`,
      );
      return [head, ...lines].join('\n');
    })
    .join('\n\n');
}

/**
 * Keep only what can be verified. Never throws: a malformed group is dropped,
 * not repaired, because a repaired group is a claim nobody made.
 */
export function validateOverlap(raw: unknown, theses: OverlapThesis[]): OverlapGroup[] {
  const groups = (raw as { groups?: unknown })?.groups;
  if (!Array.isArray(groups)) return [];

  const kept: OverlapGroup[] = [];
  const seen = new Set<string>();

  for (const g of groups) {
    if (!g || typeof g !== 'object') continue;
    const { theme, why, members } = g as Record<string, unknown>;
    if (typeof theme !== 'string' || theme.trim().length < 2) continue;
    if (!Array.isArray(members)) continue;

    const resolved: OverlapMember[] = [];
    const needs: Array<'more' | 'less'> = [];
    const refs = new Set<string>();
    for (const member of members) {
      const ref = (member as { ref?: unknown })?.ref;
      const need = (member as { needs?: unknown })?.needs;
      if (typeof ref !== 'string' || refs.has(ref)) continue;
      // Without a direction the relation cannot be worked out, and guessing
      // it is how "opposed" got printed as "shared".
      if (need !== 'more' && need !== 'less') continue;
      const match = /^T(\d+)\.A(\d+)$/.exec(ref.trim());
      if (!match) continue;
      const thesis = theses[Number(match[1]) - 1];
      const belief = thesis?.beliefs[Number(match[2]) - 1];
      if (!thesis || !belief) continue;
      refs.add(ref);
      needs.push(need);
      resolved.push({
        thesisId: thesis.id,
        ticker: thesis.ticker,
        assumptionId: belief.id,
        statement: belief.statement,
        loadBearing: belief.loadBearing,
        health: belief.health,
      });
    }

    // A "shared" belief inside one thesis is just that thesis's own list.
    if (new Set(resolved.map((m) => m.thesisId)).size < 2) continue;

    const key = resolved
      .map((m) => `${m.thesisId}.${m.assumptionId}`)
      .sort()
      .join(',');
    if (seen.has(key)) continue;
    seen.add(key);

    /*
      The relation is DERIVED from the per-belief directions, never taken from
      the model. Asked for one label, a small model wrote "shared" above its own
      sentence explaining that TSLA needs AI spending to fall and NVDA needs it
      to rise. Asked for each belief's direction separately, it answers each
      correctly, and code can do the comparison it got wrong.
    */
    const relation: OverlapRelation = new Set(needs).size > 1 ? 'opposed' : 'shared';

    kept.push({
      theme: theme.trim().replace(/\.$/, '').slice(0, 60),
      relation,
      // Refs are the model's handles, not words. Strip any that leak through.
      why:
        typeof why === 'string'
          ? why
              .replace(/\s*\(?\bT\d+\.A\d+\b\)?/g, '')
              .replace(/\s+([,.;])/g, '$1')
              .trim()
              .slice(0, 280)
          : '',
      members: resolved,
    });
    if (kept.length === MAX_GROUPS) break;
  }

  return kept;
}

// ---------------------------------------------------------------------------
// RULES, for when no model can be asked
// ---------------------------------------------------------------------------

const RULES: Array<{ theme: string; why: string; metrics: ReadonlySet<Metric> }> = [
  {
    theme: 'Calm markets',
    why: 'Each of these has a tripwire on broad price swings, so one market-wide sell-off would trip them together.',
    metrics: new Set<Metric>(['volatility90d', 'drawdownFromHigh', 'return30d', 'return90d']),
  },
  {
    theme: 'Being able to sell when you need to',
    why: 'Each of these assumes there will be buyers at your exit, and thin books tend to empty out at the same moment.',
    metrics: new Set<Metric>(['exitDepthUsd', 'spreadBps', 'exitSlippageBps']),
  },
];

export function ruleOverlap(theses: OverlapThesis[]): OverlapGroup[] {
  const groups: OverlapGroup[] = [];
  for (const rule of RULES) {
    const members: OverlapMember[] = [];
    for (const t of theses) {
      for (const b of t.beliefs) {
        if (b.metrics.some((m) => rule.metrics.has(m))) {
          members.push({
            thesisId: t.id,
            ticker: t.ticker,
            assumptionId: b.id,
            statement: b.statement,
            loadBearing: b.loadBearing,
            health: b.health,
          });
        }
      }
    }
    if (new Set(members.map((m) => m.thesisId)).size >= 2) {
      groups.push({ theme: rule.theme, relation: 'shared', why: rule.why, members });
    }
  }
  return groups;
}

/**
 * The rule groups the model did not already find.
 *
 * The rules are certain where they apply: two tripwires on market volatility
 * ARE exposed to the same sell-off. The model, reading sentences, can miss
 * that when one of the beliefs is phrased as a minor caveat. So they are
 * added after the model's groups unless the model already covered the same
 * beliefs.
 */
function withRules(groups: OverlapGroup[], theses: OverlapThesis[]): OverlapGroup[] {
  const covered = new Set(groups.flatMap((g) => g.members.map((m) => `${m.thesisId}.${m.assumptionId}`)));
  const extra = ruleOverlap(theses).filter((g) =>
    g.members.some((m) => !covered.has(`${m.thesisId}.${m.assumptionId}`)),
  );
  return [...groups, ...extra].slice(0, MAX_GROUPS);
}

// ---------------------------------------------------------------------------
// ENTRY POINT
// ---------------------------------------------------------------------------

/** Never throws. A failed model call falls back to the rules and says so. */
export async function findOverlap(records: ThesisRecord[]): Promise<OverlapResult> {
  const computedAt = new Date().toISOString();
  const theses = records.map(toOverlapThesis);
  if (theses.length < 2) {
    return { groups: [], source: 'none', thesisCount: theses.length, computedAt };
  }

  let skipped: string;
  try {
    const llm = getLlm('decomposer');
    const result = await llm.complete(
      [
        { role: 'system', content: OVERLAP_SYSTEM },
        { role: 'user', content: buildOverlapUser(theses) },
      ],
      { temperature: 0.2, json: true, maxTokens: 1500, timeoutMs: OVERLAP_TIMEOUT_MS },
    );
    const groups = withRules(validateOverlap(extractJson(result.text), theses), theses);
    return { groups, source: 'model', model: llm.model, thesisCount: theses.length, computedAt };
  } catch (err) {
    skipped = err instanceof Error ? err.message : String(err);
  }

  return {
    groups: ruleOverlap(theses),
    source: 'rules',
    thesisCount: theses.length,
    skipped,
    computedAt,
  };
}

// ---------------------------------------------------------------------------
// CACHE
// ---------------------------------------------------------------------------

const CACHE_PREFIX = 'thesis:overlap:';
/** Long enough that page loads never pay for it, short enough to self-heal. */
const CACHE_TTL_S = 24 * 60 * 60;
const memory = new Map<string, OverlapResult>();

/**
 * The overlap for this exact set of theses, computed once.
 *
 * A rules result is NOT cached in Redis: it is what was available when the
 * model was not, and the next request should try the model again.
 */
export async function cachedOverlap(records: ThesisRecord[]): Promise<OverlapResult> {
  const key = CACHE_PREFIX + signatureOf(records);
  const local = memory.get(key);
  if (local) return local;

  const redis = redisConfig();
  if (redis) {
    try {
      const raw = await command<string | null>(redis, ['GET', key]);
      if (raw) {
        const parsed = JSON.parse(raw) as OverlapResult;
        memory.set(key, parsed);
        return parsed;
      }
    } catch {
      // A cache that cannot be read is a cache miss, not an outage.
    }
  }

  const result = await findOverlap(records);
  if (result.source !== 'rules') {
    memory.set(key, result);
    if (redis) {
      await command(redis, ['SET', key, JSON.stringify(result), 'EX', CACHE_TTL_S]).catch(() => {});
    }
  }
  return result;
}
