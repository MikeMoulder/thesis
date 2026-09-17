'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';

import { BaseRateDisclosure } from '@/components/thesis/BaseRateDisclosure';
import { AnalysisBlock, BlockSection, type BlockStage } from '@/components/thesis/AnalysisBlock';
import { AssumptionDiagram } from '@/components/thesis/AssumptionDiagram';
import { RunHeadline } from '@/components/thesis/RunHeadline';
import { AssumptionTree } from '@/components/thesis/AssumptionTree';
import { NextActions } from '@/components/thesis/NextActions';
import { TripwireRow } from '@/components/thesis/TripwireRow';
import { Prose } from '@/components/prose/emphasis';
import { Sidebar, type SessionSummary } from '@/components/shell/Sidebar';
import { DotPattern } from '@/components/ui/DotPattern';
import { deriveActions } from '@/engine/actions';
import type { Evaluation } from '@/engine/breakers/evaluate';
import type { RunStageId } from '@/engine/run';
import { IDLE_RUN, applyEvent, detectTicker, readEvents, type RunState } from '@/lib/run-client';
import { cn } from '@/lib/utils';

/**
 * The research desk.
 *
 * Chat is the transport; the dossier is the payload. A thesis produces a full
 * analysis block, a scenario question produces a scenario block, and a question
 * about the analysis produces plain prose with no block at all. That last case
 * is deliberate — if every reply were framed, the frame would stop meaning
 * "this is structured analysis you can act on".
 */

const STAGE_ORDER: RunStageId[] = ['resolve', 'decompose', 'breakers', 'evaluate'];
const STAGE_LABEL: Record<RunStageId, string> = {
  resolve: 'resolve',
  decompose: 'decompose',
  breakers: 'tripwires',
  evaluate: 'evaluate',
};

/** What each step is doing, for a reader who has never seen a tool like this. */
const STAGE_NARRATION: Record<RunStageId, string> = {
  resolve: 'Finding the company, the token it trades as, and its filing history…',
  decompose:
    'Reading your thesis for everything it assumes, including the parts you did not say out loud.',
  breakers:
    'Working out which of those assumptions can actually be checked, and what number would prove each one wrong.',
  evaluate: 'Reading the latest filings and live prices to see where each one stands right now.',
};

const STORAGE_KEY = 'thesis.sessions.v1';
const PANEL_KEY = 'thesis.panel.collapsed.v1';
const MAX_SESSIONS = 8;

type Turn =
  | { kind: 'ask'; id: string; text: string }
  | { kind: 'run'; id: string; ticker: string; state: RunState }
  | { kind: 'scenario'; id: string; ticker: string; label: string; evaluations: Evaluation[] }
  | { kind: 'answer'; id: string; text: string }
  | { kind: 'note'; id: string; text: string; tone: 'trust' | 'faint' };

interface Session {
  id: string;
  ticker: string;
  thesis: string;
  turns: Turn[];
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------------------
// Persistence — per-viewer convenience only. Every access is guarded: storage
// throws in private windows and comes back empty with site data cleared, and the
// desk has to render correctly either way.
// ---------------------------------------------------------------------------

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Session[];
    if (!Array.isArray(parsed)) return [];
    // A run cannot still be in flight across a page load; anything that says so
    // was interrupted, and showing a permanent spinner would be a lie.
    return parsed.map((session) => ({
      ...session,
      turns: session.turns.map((turn) =>
        turn.kind === 'run' ? { ...turn, state: { ...turn.state, running: false } } : turn,
      ),
    }));
  } catch {
    return [];
  }
}

function saveSessions(sessions: Session[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch {
    // Quota or a blocked store: the desk keeps working for this session.
  }
}

/**
 * Whether the panel is collapsed.
 *
 * Read on mount rather than in the initial state, so the server and the first
 * client render agree — a panel that hydrates at one width and snaps to another
 * is the same lie as a spinner for a run that is not running.
 */
function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(PANEL_KEY) === '1';
  } catch {
    return false;
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(PANEL_KEY, collapsed ? '1' : '0');
  } catch {
    // Blocked storage: the preference lasts for this session only.
  }
}

function untestedCount(session: Session): number {
  const run = session.turns.find((t): t is Extract<Turn, { kind: 'run' }> => t.kind === 'run');
  return run?.state.decomposition?.summary.unfalsifiableLoadBearing.length ?? 0;
}

// ---------------------------------------------------------------------------

/**
 * Three, ranged left off the composer's edge, so the row reads as a lead-in to
 * the input rather than a second centred element competing with the greeting.
 * Each one is a real thesis, not a topic — the product needs something to argue
 * with, and a chip that just says "NVDA" gives it nothing.
 */
const THESIS_EXAMPLES: Array<{ label: string; prompt: string }> = [
  {
    label: 'Long NVDA',
    prompt:
      "I'm long NVDA because AI infrastructure spending keeps accelerating and NVIDIA is the main beneficiary.",
  },
  {
    label: 'Long TSLA',
    prompt:
      "I'm long TSLA because energy storage and FSD licensing will re-rate it well beyond autos.",
  },
  {
    label: 'Short AMD',
    prompt:
      "I'm short AMD because it cannot close the software gap and its margins will compress as it discounts to win share.",
  },
];

const FOLLOWUP_CHIPS = [
  'What if gross margin falls to 62%?',
  'Why is that untestable?',
  'Which tripwire is closest to firing?',
];

export function Desk() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [pendingThesis, setPendingThesis] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const restored = loadSessions();
    setSessions(restored);
    setActiveId(restored[0]?.id ?? null);
    setCollapsed(loadCollapsed());
  }, []);

  useEffect(() => {
    fetch('/api/diag')
      .then((r) => r.json())
      .then((d: { ok?: boolean }) => setHealthy(Boolean(d.ok)))
      .catch(() => setHealthy(false));
  }, []);

  const active = sessions.find((s) => s.id === activeId) ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [active?.turns.length, busy]);

  const patchSession = useCallback((id: string, fn: (session: Session) => Session) => {
    setSessions((current) => {
      const next = current.map((session) => (session.id === id ? fn(session) : session));
      saveSessions(next);
      return next;
    });
  }, []);

  const addTurn = useCallback(
    (id: string, turn: Turn) => patchSession(id, (s) => ({ ...s, turns: [...s.turns, turn] })),
    [patchSession],
  );

  // ---- start a new thesis --------------------------------------------------

  const startRun = useCallback(
    async (ticker: string, thesis: string) => {
      const sessionId = uid();
      const runId = uid();
      const session: Session = {
        id: sessionId,
        ticker,
        thesis,
        turns: [
          { kind: 'ask', id: uid(), text: thesis },
          { kind: 'run', id: runId, ticker, state: { ...IDLE_RUN, running: true } },
        ],
      };

      setSessions((current) => {
        const next = [session, ...current];
        saveSessions(next);
        return next;
      });
      setActiveId(sessionId);
      setBusy(true);

      const patchRun = (fn: (state: RunState) => RunState) =>
        patchSession(sessionId, (s) => ({
          ...s,
          turns: s.turns.map((t) => (t.id === runId && t.kind === 'run' ? { ...t, state: fn(t.state) } : t)),
        }));

      try {
        const response = await fetch('/api/attack', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ticker, thesis }),
        });
        if (!response.ok || !response.body) {
          const detail = (await response.json().catch(() => ({}))) as { error?: string };
          patchRun((state) => ({
            ...state,
            running: false,
            error: { kind: 'unknown', message: detail.error ?? response.statusText },
          }));
          return;
        }
        for await (const event of readEvents(response.body)) {
          patchRun((state) => applyEvent(state, event));
        }
      } catch (error) {
        patchRun((state) => ({
          ...state,
          running: false,
          error: {
            kind: 'unknown',
            message: error instanceof Error ? error.message : String(error),
          },
        }));
      } finally {
        patchRun((state) => ({ ...state, running: false }));
        setBusy(false);
      }
    },
    [patchSession],
  );

  // ---- follow up on the active session ------------------------------------

  const followUp = useCallback(
    async (session: Session, question: string) => {
      const run = session.turns.find((t): t is Extract<Turn, { kind: 'run' }> => t.kind === 'run');
      if (!run?.state.decomposition) return;

      addTurn(session.id, { kind: 'ask', id: uid(), text: question });
      setBusy(true);

      try {
        const response = await fetch('/api/followup', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            question,
            decomposition: run.state.decomposition,
            breakerSet: run.state.breakerSet,
            evaluations: run.state.evaluations,
          }),
        });
        const data = (await response.json()) as {
          kind?: string;
          label?: string;
          evaluations?: Evaluation[];
          text?: string;
          error?: string;
        };

        if (!response.ok) {
          addTurn(session.id, {
            kind: 'note',
            id: uid(),
            tone: 'trust',
            text: data.error ?? 'That could not be answered.',
          });
          return;
        }
        if (data.kind === 'scenario' && data.evaluations) {
          addTurn(session.id, {
            kind: 'scenario',
            id: uid(),
            ticker: session.ticker,
            label: data.label ?? '',
            evaluations: data.evaluations,
          });
          return;
        }
        addTurn(session.id, { kind: 'answer', id: uid(), text: data.text ?? '' });
      } catch (error) {
        addTurn(session.id, {
          kind: 'note',
          id: uid(),
          tone: 'trust',
          text: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setBusy(false);
      }
    },
    [addTurn],
  );

  // ---- composer ------------------------------------------------------------

  const submit = useCallback(
    (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setDraft('');

      // Waiting on a ticker we could not read from the sentence.
      if (pendingThesis) {
        const ticker = message.toUpperCase().replace(/[^A-Z.\-]/g, '').slice(0, 10);
        if (!ticker) return;
        const thesis = pendingThesis;
        setPendingThesis(null);
        void startRun(ticker, thesis);
        return;
      }

      if (active) {
        void followUp(active, message);
        return;
      }

      if (message.length < 20) {
        // Too short to decompose. Say so rather than running and returning a
        // thin analysis the user would reasonably blame on the engine.
        return;
      }

      const ticker = detectTicker(message);
      if (!ticker) {
        setPendingThesis(message);
        setSessions((current) => current);
        return;
      }
      void startRun(ticker, message);
    },
    [active, busy, followUp, pendingThesis, startRun],
  );

  const summaries: SessionSummary[] = sessions.map((s) => ({
    id: s.id,
    ticker: s.ticker,
    thesis: s.thesis,
    untested: untestedCount(s),
  }));

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        sessions={summaries}
        activeId={activeId}
        sourcesHealthy={healthy}
        collapsed={collapsed}
        onToggle={() =>
          setCollapsed((current) => {
            saveCollapsed(!current);
            return !current;
          })
        }
        onSelect={setActiveId}
        onNew={() => {
          setActiveId(null);
          setPendingThesis(null);
          setDraft('');
        }}
        onPickTicker={(ticker) => {
          // A watchlist row is a starting point, not a query: it seeds the
          // sentence and leaves the reasoning — the part that gets attacked —
          // for the person to write.
          setActiveId(null);
          setPendingThesis(null);
          setDraft(`I'm long ${ticker} because `);
        }}
        className="hidden md:flex"
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          {!active ? <DotPattern /> : null}
          <div
            className={cn(
              'relative mx-auto flex max-w-2xl flex-col gap-10 px-6',
              active ? 'py-10' : 'min-h-full py-10',
            )}
          >
            {active ? (
              active.turns.map((turn) => <TurnView key={turn.id} turn={turn} />)
            ) : (
              <EmptyState pendingThesis={pendingThesis} />
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <Composer
          value={draft}
          busy={busy}
          placeholder={
            pendingThesis
              ? 'Which ticker? e.g. NVDA'
              : active
                ? 'Ask about this analysis, or try a what-if…'
                : 'Type your trade and why you think it works'
          }
          chips={
            busy
              ? []
              : active
                ? FOLLOWUP_CHIPS
                : pendingThesis
                  ? []
                  : THESIS_EXAMPLES.map((e) => e.label)
          }
          onChip={(label) => {
            const example = THESIS_EXAMPLES.find((e) => e.label === label);
            setDraft(example ? example.prompt : label);
          }}
          onChange={setDraft}
          onSubmit={submit}
        />
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The landing. A question, not a dashboard.
 *
 * "Hi there, what's on your mind?" is the right greeting for a general
 * assistant and the wrong one here: it invites a topic, and a topic cannot be
 * attacked. THESIS needs a POSITION and the REASON behind it, because the
 * reason is the part that gets taken apart.
 *
 * So the copy states the two things the user has to supply, in the words they
 * would use themselves. No em dashes, no "quietly assumes", nothing that reads
 * like it is admiring its own phrasing. The screen has one job: make it obvious
 * what to type.
 */
function EmptyState({ pendingThesis }: { pendingThesis: string | null }) {
  if (pendingThesis) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <h2 className="text-[2rem] font-normal leading-[1.2] tracking-[-0.02em] text-text">
          Which stock is this?
        </h2>
        <Prose className="mt-3 text-center text-sm">
          I could not find a ticker in what you wrote. Type one, like NVDA, so I look at the right
          company.
        </Prose>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <h2 className="max-w-[22ch] text-[2rem] font-normal leading-[1.2] tracking-[-0.02em] text-text">
        What&rsquo;s your trade, and why?
      </h2>
      <Prose className="mt-3.5 max-w-[46ch] text-center text-sm">
        Type the position and the reason behind it. I will list what your reasoning depends on,
        then show you which parts real data can check and which parts it cannot.
      </Prose>
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  if (turn.kind === 'ask') {
    return (
      <p className="max-w-prose border-l-2 border-line-strong py-0.5 pl-4 text-base text-text">
        {turn.text}
      </p>
    );
  }

  if (turn.kind === 'answer') {
    // Plain prose, no block. The product has to be willing to just answer.
    return (
      <div className="flex flex-col gap-3">
        {turn.text.split(/\n{2,}/).map((paragraph, i) => (
          <Prose key={i}>{paragraph}</Prose>
        ))}
      </div>
    );
  }

  if (turn.kind === 'note') {
    return (
      <p className={cn('max-w-prose text-sm', turn.tone === 'trust' ? 'text-trust' : 'text-faint')}>
        {turn.text}
      </p>
    );
  }

  if (turn.kind === 'scenario') {
    return (
      <AnalysisBlock
        kind="scenario"
        subject={`${turn.ticker} · ${turn.label}`}
        meta={{ modelCalls: 0, latencyMs: 0 }}
      >
        <BlockSection title="Tripwires &middot; scenario">
          {turn.evaluations.map((evaluation) => (
            <ScenarioRow key={evaluation.breakerId} evaluation={evaluation} />
          ))}
        </BlockSection>
      </AnalysisBlock>
    );
  }

  return <RunView turn={turn} />;
}

/**
 * A scenario result without its breaker to hand.
 *
 * The evaluation carries everything the row needs, and reconstructing a full
 * breaker just to render one line would invent fields the scenario never had.
 */
function ScenarioRow({ evaluation }: { evaluation: Evaluation }) {
  const fired = evaluation.status === 'fired';
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line/60 py-3 last:border-b-0">
      <span
        aria-hidden
        className={cn(
          'relative top-[-1px] size-[7px] shrink-0 rounded-full',
          fired ? 'bg-fired' : evaluation.status === 'holding' ? 'bg-line-strong' : 'bg-line',
        )}
      />
      <span data-figure className="text-sm text-muted">
        {evaluation.breakerId}
      </span>
      {evaluation.metric ? (
        <span data-figure className="text-sm text-code">
          {evaluation.metric}
        </span>
      ) : null}
      {evaluation.observed !== undefined ? (
        <span data-figure className="text-base text-text">
          {evaluation.observed}
        </span>
      ) : null}
      <span
        className={cn(
          'ml-auto text-sm',
          fired ? 'text-fired' : evaluation.status === 'holding' ? 'text-muted' : 'text-faint',
        )}
      >
        {fired
          ? 'fired'
          : evaluation.status === 'holding'
            ? 'holding'
            : 'not in scenario'}
      </span>
    </div>
  );
}

/**
 * One run, told in order.
 *
 * The structure is a narrative, not an inverted pyramid: you watch it take the
 * thesis apart, see what it found, and the conclusion arrives at the end as the
 * payoff. Each section appears only once its own data has landed, so the page
 * BUILDS while the engine works rather than sitting empty and then snapping into
 * existence complete.
 *
 * Nothing is collapsed. Hiding the working behind disclosures made the run look
 * like a summary with footnotes; the working IS the product, and it is what
 * earns the conclusion underneath it.
 */
function RunView({ turn }: { turn: Extract<Turn, { kind: 'run' }> }) {
  const { state, ticker } = turn;
  const stages: BlockStage[] = STAGE_ORDER.map((id) => ({
    id,
    label: STAGE_LABEL[id],
    state: state.stages[id],
    narration: STAGE_NARRATION[id],
  }));
  const breakersPending = state.stages.breakers !== 'done' && state.stages.breakers !== 'failed';
  const settled = !state.running;
  const thresholdBreakers = state.breakerSet?.breakers.filter((b) => b.kind === 'threshold') ?? [];

  return (
    <AnalysisBlock
      kind="thesis-attacked"
      subject={ticker}
      {...(state.meta ? { meta: state.meta } : { stages })}
    >
      {state.error ? (
        <p className="mb-5 max-w-prose text-base text-trust">{state.error.message}</p>
      ) : null}

      {/* ---- 1. the shape of the bet, as soon as it is known ---- */}
      {state.decomposition ? (
        <BlockSection title="What this trade is standing on">
          <AssumptionDiagram
            decomposition={state.decomposition}
            breakerSet={state.breakerSet}
            breakersPending={breakersPending}
          />
        </BlockSection>
      ) : null}

      {/* ---- 2. the same thing in words ---- */}
      {state.decomposition ? (
        <BlockSection title="Each one, in full">
          <AssumptionTree
            decomposition={state.decomposition}
            breakerSet={state.breakerSet}
            breakersPending={breakersPending}
          />
        </BlockSection>
      ) : null}

      {/* ---- 3. where each tripwire stands ---- */}
      {state.breakerSet && state.breakerSet.breakers.length > 0 ? (
        <BlockSection title="Where each tripwire stands right now">
          {state.breakerSet.breakers.map((breaker, i) => (
            <div
              key={breaker.id}
              className="animate-rise"
              style={{ animationDelay: `${Math.min(i, 6) * 90}ms` }}
            >
              <TripwireRow
                breaker={breaker}
                evaluation={state.evaluations?.find((e) => e.breakerId === breaker.id)}
              />
            </div>
          ))}
        </BlockSection>
      ) : null}

      {/* ---- 4. the historical record, fetched on demand ---- */}
      {settled && thresholdBreakers.length > 0 ? (
        <BlockSection title="What happened the other times these were true" tone="quiet">
          <p className="mb-4 max-w-prose text-base text-muted">
            A tripwire is only worth watching if crossing it has meant something before. Open one to
            see every previous occurrence and what the share price did afterwards.
          </p>
          <div className="flex flex-col gap-3.5">
            {thresholdBreakers.map((breaker) => (
              <BaseRateDisclosure key={breaker.id} ticker={ticker} breaker={breaker} />
            ))}
          </div>
        </BlockSection>
      ) : null}

      {/* ---- 5. and therefore. the conclusion the working earned ---- */}
      {settled && state.decomposition ? (
        <div className="animate-rise mt-12 border-t border-line-strong pt-8">
          <RunHeadline
            decomposition={state.decomposition}
            breakerSet={state.breakerSet}
            evaluations={state.evaluations}
          />
          <BlockSection title="What to do now" tone="lead" className="mt-8">
            <NextActions
              actions={deriveActions(state.decomposition, state.breakerSet, state.evaluations)}
            />
          </BlockSection>
        </div>
      ) : null}
    </AnalysisBlock>
  );
}

function Composer({
  value,
  busy,
  placeholder,
  chips,
  onChange,
  onChip,
  onSubmit,
}: {
  value: string;
  busy: boolean;
  placeholder: string;
  chips: string[];
  onChange: (value: string) => void;
  onChip: (label: string) => void;
  onSubmit: (value: string) => void;
}) {
  return (
    // No rule above the composer. The input is already a bordered object on the
    // same ground as the transcript; a second line under the last turn would
    // read as the end of the document rather than the start of the control.
    <div className="bg-ground">
      <div className="mx-auto flex max-w-2xl flex-col gap-2.5 px-6 py-4">
        {chips.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => onChip(chip)}
                className="rounded-full border border-line px-3 py-1 text-sm text-muted transition-colors hover:border-line-strong hover:text-text"
              >
                {chip}
              </button>
            ))}
          </div>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(value);
          }}
          className="flex items-end gap-2 rounded-[22px] border border-line bg-surface px-4 py-2.5 focus-within:border-line-strong"
        >
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSubmit(value);
              }
            }}
            rows={1}
            placeholder={placeholder}
            className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-base leading-relaxed text-text outline-none placeholder:text-faint"
          />
          <button
            type="submit"
            disabled={busy || value.trim().length === 0}
            aria-label="Send"
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-full transition-colors',
              busy || value.trim().length === 0
                ? 'cursor-not-allowed bg-raised text-faint'
                : 'bg-text text-ground hover:opacity-90',
            )}
          >
            <ArrowUp size={15} strokeWidth={2} aria-hidden />
          </button>
        </form>

        {/* Centred under the composer, not ranged left with the chips. The chips
            are controls and belong on the input's left edge; this is a standing
            disclaimer about the whole product, so it is centred on the column
            rather than reading as one more thing you could click. */}
        <p className="text-center text-meta text-faint">
          Research, not advice. THESIS does not tell you what to trade. You decide.
        </p>
      </div>
    </div>
  );
}
