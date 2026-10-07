/**
 * Shared beliefs across theses.
 *
 * The model groups beliefs; this suite pins down everything code decides
 * afterwards, because that is the part that makes the finding trustworthy:
 * a reference that does not exist is dropped, a group inside one thesis is
 * dropped, a belief with no direction is dropped, and "opposed" or "shared"
 * is worked out from the directions rather than taken from the model.
 *
 * Offline. The model is replaced through the test seam.
 */
import { __setLlm, type LlmClient } from '../llm/index';
import {
  findOverlap,
  ruleOverlap,
  signatureOf,
  validateOverlap,
  type OverlapThesis,
} from '../engine/overlap';
import type { ThesisRecord } from '../thesis/types';

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---- fixtures ---------------------------------------------------------------

const THESES: OverlapThesis[] = [
  {
    id: 'tsla-1',
    ticker: 'TSLA',
    direction: 'bullish',
    beliefs: [
      { id: 'A1', statement: 'Margins recover as AI spending rolls off.', loadBearing: 'medium', metrics: ['operatingMargin'], health: 'healthy' },
      { id: 'A2', statement: 'Volatility stays under 50%.', loadBearing: 'medium', metrics: ['volatility90d'], health: 'weakening' },
    ],
  },
  {
    id: 'nvda-1',
    ticker: 'NVDA',
    direction: 'bullish',
    beliefs: [
      { id: 'A1', statement: 'AI infrastructure spending keeps accelerating.', loadBearing: 'high', metrics: [] },
      { id: 'A2', statement: 'Market drawdowns do not dominate.', loadBearing: 'low', metrics: ['drawdownFromHigh'] },
      { id: 'A3', statement: 'Buyers are there at the stop.', loadBearing: 'high', metrics: ['exitDepthUsd'] },
    ],
  },
];

const group = (members: Array<{ ref: string; needs?: string }>, extra: Record<string, unknown> = {}) => ({
  theme: 'AI infrastructure spending',
  why: 'TSLA needs less, NVDA needs more.',
  members,
  ...extra,
});

// ---------------------------------------------------------------------------

console.log('\nthe relation is derived, not taken');

{
  const [g] = validateOverlap(
    { groups: [group([{ ref: 'T1.A1', needs: 'less' }, { ref: 'T2.A1', needs: 'more' }], { relation: 'shared' })] },
    THESES,
  );
  check('opposite needs make it opposed, whatever label the model wrote', g?.relation === 'opposed', g?.relation);
  check('members resolve to the real thesis and belief', g?.members[1]?.thesisId === 'nvda-1' && g.members[1].assumptionId === 'A1');
  check('and carry the belief text, not the ref', g?.members[0]?.statement.startsWith('Margins recover') === true);
  check('and its latest health', g?.members[0]?.health === 'healthy');
}

{
  const [g] = validateOverlap(
    { groups: [group([{ ref: 'T1.A2', needs: 'less' }, { ref: 'T2.A2', needs: 'less' }], { relation: 'opposed' })] },
    THESES,
  );
  check('matching needs make it shared', g?.relation === 'shared', g?.relation);
}

console.log('\nwhat gets dropped');

{
  const out = validateOverlap(
    {
      groups: [
        group([{ ref: 'T1.A1', needs: 'less' }, { ref: 'T1.A2', needs: 'less' }]),
        group([{ ref: 'T1.A1', needs: 'less' }, { ref: 'T9.A1', needs: 'more' }]),
        group([{ ref: 'T1.A1', needs: 'less' }, { ref: 'T2.A1' }]),
        group([{ ref: 'T1.A1', needs: 'sideways' }, { ref: 'T2.A1', needs: 'more' }]),
        { theme: '', members: [{ ref: 'T1.A1', needs: 'less' }, { ref: 'T2.A1', needs: 'more' }] },
        'not a group',
      ],
    },
    THESES,
  );
  check('a group inside one thesis, an unknown ref, a missing or invalid direction and an empty theme are all dropped', out.length === 0, String(out.length));
}

{
  const one = group([{ ref: 'T1.A1', needs: 'less' }, { ref: 'T2.A1', needs: 'more' }]);
  const out = validateOverlap({ groups: [one, { ...one, theme: 'Same beliefs again' }] }, THESES);
  check('two groups over the same beliefs collapse to one', out.length === 1, String(out.length));
}

{
  const g = (i: number) => group([{ ref: 'T1.A1', needs: 'less' }, { ref: `T2.A${(i % 3) + 1}`, needs: 'more' }, { ref: 'T1.A2', needs: i % 2 ? 'less' : 'more' }], { theme: `theme ${i}` });
  const out = validateOverlap({ groups: [0, 1, 2, 3, 4, 5, 6, 7].map(g) }, THESES);
  check('no more than five groups survive', out.length <= 5, String(out.length));
}

check('garbage input yields nothing, never a throw', validateOverlap(null, THESES).length === 0 && validateOverlap({ groups: 'x' }, THESES).length === 0);

console.log('\nwording');

{
  const [g] = validateOverlap(
    { groups: [group([{ ref: 'T1.A1', needs: 'less' }, { ref: 'T2.A1', needs: 'more' }], { why: 'TSLA needs it to fall (T1.A1), while NVDA needs it to rise in T2.A1.', theme: 'AI spending.' })] },
    THESES,
  );
  check('model refs are stripped from the sentence', !/T\d+\.A\d+/.test(g?.why ?? ''), g?.why);
  check('without leaving a space before punctuation', !/\s[,.]/.test(g?.why ?? ''), g?.why);
  check('a trailing full stop is dropped from the theme', g?.theme === 'AI spending', g?.theme);
}

console.log('\nrules');

{
  const groups = ruleOverlap(THESES);
  const calm = groups.find((g) => g.theme === 'Calm markets');
  check('volatility and drawdown tripwires in two theses form a market group', calm?.members.length === 2, String(calm?.members.length));
  check('rule groups are always shared', groups.every((g) => g.relation === 'shared'));
  check('a liquidity tripwire in only one thesis forms no group', !groups.some((g) => g.theme.startsWith('Being able to sell')));
}

// ---- records, for the entry point ----------------------------------------------

function record(t: OverlapThesis, n = 1): ThesisRecord {
  return {
    id: t.id,
    ticker: t.ticker,
    direction: t.direction,
    versions: [
      {
        n,
        statement: 'fixture',
        createdAt: '2026-01-01T00:00:00.000Z',
        decomposition: {
          assumptions: t.beliefs.map((b) => ({ id: b.id, statement: b.statement, loadBearing: b.loadBearing })),
        },
        breakerSet: {
          breakers: t.beliefs.flatMap((b) =>
            b.metrics.map((metric, i) => ({ id: `${b.id}-${i}`, assumptionRef: b.id, kind: 'threshold', metric })),
          ),
        },
      },
    ],
    checks: [],
  } as unknown as ThesisRecord;
}

function fakeLlm(reply: string | Error): LlmClient {
  return {
    model: 'fake',
    label: 'decomposer/fake',
    async complete() {
      if (reply instanceof Error) throw reply;
      return { text: reply, model: 'fake', latencyMs: 1 };
    },
  };
}

console.log('\nentry point');

await (async () => {
  const records = THESES.map((t) => record(t));

  const single = await findOverlap([records[0]!]);
  check('one thesis has nothing to compare with', single.source === 'none' && single.groups.length === 0);

  __setLlm(
    'decomposer',
    fakeLlm(JSON.stringify({ groups: [group([{ ref: 'T1.A1', needs: 'less' }, { ref: 'T2.A1', needs: 'more' }])] })),
  );
  const modelled = await findOverlap(records);
  check('a model answer is used', modelled.source === 'model' && modelled.model === 'fake');
  check('and rule groups it missed are added after it', modelled.groups.map((g) => g.theme).join('|') === 'AI infrastructure spending|Calm markets', modelled.groups.map((g) => g.theme).join('|'));

  __setLlm('decomposer', fakeLlm(new Error('gateway down')));
  const fallback = await findOverlap(records);
  check('a failed model falls back to the rules', fallback.source === 'rules' && fallback.groups.length === 1);
  check('and says why', fallback.skipped === 'gateway down', fallback.skipped);
  __setLlm('decomposer', null);

  const a = signatureOf(records);
  const withCheck = records.map((r) => ({ ...r, checks: [{} as never] }));
  check('a new check does not change the cache key', signatureOf(withCheck) === a);
  check('a new version does', signatureOf([record(THESES[0]!, 2), records[1]!]) !== a);
  check('order does not matter', signatureOf([...records].reverse()) === a);
})();

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
