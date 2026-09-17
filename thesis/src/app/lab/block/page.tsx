import {
  AnalysisBlock,
  BlockSection,
  Disclosure,
  type BlockStage,
} from '@/components/thesis/AnalysisBlock';
import { AssumptionTree } from '@/components/thesis/AssumptionTree';
import { TripwireRow } from '@/components/thesis/TripwireRow';
import { Code, Prose, Term, Value, Warn } from '@/components/prose/emphasis';
import {
  NVDA_BREAKERS,
  NVDA_DECOMPOSITION,
  NVDA_LIVE,
  NVDA_SCENARIO,
} from '@/lib/fixtures/nvda';

const RUNNING_STAGES: BlockStage[] = [
  { id: 'decompose', label: 'decompose', state: 'done' },
  { id: 'research', label: 'research', state: 'done' },
  { id: 'breakers', label: 'tripwires', state: 'running' },
  { id: 'evaluate', label: 'evaluate', state: 'pending' },
  { id: 'judge', label: 'judge', state: 'pending' },
];

/** A user turn in the thread — plain, so the block reads as the heavier thing. */
function Ask({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-prose border-l-2 border-line-strong py-0.5 pl-4 text-base text-text">
      {children}
    </p>
  );
}

export default function BlockLabPage() {
  const byId = (id: string) => NVDA_BREAKERS.breakers.find((b) => b.id === id)!;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-meta uppercase tracking-[0.14em] text-faint">Component lab</p>
      <h1 className="mt-1 text-xl font-medium">Analysis block</h1>
      <Prose className="mt-2 text-sm">
        Three turns of a thread. The third is the point:{' '}
        <Term>not every reply gets a block</Term>. If everything were framed, the frame would stop
        meaning &ldquo;this is structured analysis you can act on&rdquo;.
      </Prose>

      <div className="mt-12 flex flex-col gap-12">
        {/* ---------------- turn 1: thesis in, block out ---------------- */}
        <Ask>
          I&rsquo;m long NVDA because AI infrastructure spending keeps accelerating. What would make
          me wrong?
        </Ask>

        <AnalysisBlock
          kind="thesis-attacked"
          subject="NVDA"
          meta={{
            modelCalls: 6,
            latencyMs: 8400,
            models: ['gemini-3.5-flash-lite', 'qwen3.8-max'],
            at: '2026-09-16T14:02:19.000Z',
          }}
        >
          <BlockSection title="What the thesis rests on">
            <AssumptionTree decomposition={NVDA_DECOMPOSITION} breakerSet={NVDA_BREAKERS} />
          </BlockSection>

          <BlockSection title="Tripwires · live">
            {NVDA_LIVE.map((evaluation) => (
              <TripwireRow
                key={evaluation.breakerId}
                breaker={byId(evaluation.breakerId)}
                evaluation={evaluation}
              />
            ))}
          </BlockSection>

          <BlockSection title="Base rates">
            <Disclosure summary="When gross margin fell below 70% before">
              <Prose className="text-sm">
                <Value>26</Value> prior occurrences in <Value>40</Value> reported quarters. Median
                forward move <Value>+3.6%</Value> at 30 days, <Value>+15.1%</Value> at 90 days.{' '}
                <Term>This tripwire is close to meaningless</Term> — NVIDIA ran 55–65% margins for
                years before the AI build-out, so <Code>gross margin &lt; 70%</Code> was normal and
                was followed by gains.
              </Prose>
            </Disclosure>
          </BlockSection>
        </AnalysisBlock>

        {/* ---------------- turn 2: scenario, same engine ---------------- */}
        <Ask>What if gross margin falls to 62%?</Ask>

        <AnalysisBlock
          kind="scenario"
          subject="NVDA · gross margin 62%, revenue growth 15%"
          meta={{ modelCalls: 0, latencyMs: 310, at: '2026-09-16T14:03:02.000Z' }}
        >
          <BlockSection title="Tripwires · scenario">
            {NVDA_SCENARIO.map((evaluation) => (
              <TripwireRow
                key={evaluation.breakerId}
                breaker={byId(evaluation.breakerId)}
                evaluation={evaluation}
              />
            ))}
          </BlockSection>
          <BlockSection title="Note">
            <Prose className="text-sm">
              <Term>Both fundamental tripwires trip together</Term> because they read the same
              filing. That is one event, not two independent confirmations.
            </Prose>
          </BlockSection>
        </AnalysisBlock>

        {/* ---------------- turn 3: no block, on purpose ---------------- */}
        <Ask>Why can&rsquo;t you test A2?</Ask>

        <Prose>
          A2 assumes NVIDIA keeps its share of accelerator spending. Testing that needs segment
          revenue or market-share data — neither appears in the filings this system reads, and it
          has no licensed research feed. So the honest answer is{' '}
          <Warn>no tripwire is possible</Warn>, and A2 stays on the list as something you have to
          judge yourself.
        </Prose>

        {/* ---------------- running state ---------------- */}
        <div className="border-t border-line pt-12">
          <p className="text-meta uppercase tracking-[0.14em] text-faint">While it runs</p>
          <div className="mt-6">
            <AnalysisBlock kind="thesis-attacked" subject="TSLA" stages={RUNNING_STAGES}>
              <AssumptionTree decomposition={NVDA_DECOMPOSITION} breakersPending />
            </AnalysisBlock>
          </div>
        </div>
      </div>
    </main>
  );
}
