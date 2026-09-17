import { Check, LoaderCircle } from 'lucide-react';

import { TickerMark } from '@/components/thesis/TickerMark';

import { cn } from '@/lib/utils';

/**
 * The frame that holds an analysis inside the conversation.
 *
 * It is NOT a card. Cards were the first instinct and the wrong one: most of
 * the thread will be blocks, and a stack of bordered, filled, rounded boxes
 * reads as a settings page rather than a research document. So the structure
 * here comes from rules and labels — the way a printed report separates
 * sections — with no side borders, no fill and no radius.
 *
 * What it still has to do is make a block unmistakably different from a plain
 * chat reply, because the product deliberately answers some questions in prose
 * with no block at all. If every reply were framed, the frame would stop
 * meaning "this is a piece of structured analysis you can act on".
 */

export type BlockKind = 'thesis-attacked' | 'scenario' | 'historical' | 'recheck';

const KIND_LABEL: Record<BlockKind, string> = {
  'thesis-attacked': 'Thesis attacked',
  scenario: 'Scenario',
  historical: 'When this happened before',
  recheck: 'Re-check',
};

export interface BlockStage {
  id: string;
  label: string;
  state: 'pending' | 'running' | 'done' | 'failed';
  /**
   * What this step is actually doing, in plain words.
   *
   * The wait is several seconds of blank space otherwise, and a reader who has
   * never used a tool like this learns nothing from watching a label pulse.
   * Saying what the machine is doing turns dead time into the explanation of
   * how the thing works.
   */
  narration?: string;
}

export interface BlockMeta {
  /** Number of model calls the run actually made. */
  modelCalls: number;
  latencyMs: number;
  /** Models used, e.g. ["gemini-3.5-flash-lite", "qwen3.8-max"]. */
  models?: string[];
  /** ISO timestamp of completion. */
  at?: string;
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('text-meta uppercase tracking-[0.14em] text-faint', className)}>
      {children}
    </span>
  );
}

function Stages({ stages }: { stages: BlockStage[] }) {
  const active = stages.find((s) => s.state === 'running');

  return (
    <>
    <ol className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-3">
      {stages.map((stage) => (
        <li key={stage.id} className="flex items-center gap-1.5">
          {stage.state === 'done' ? (
            <Check size={12} strokeWidth={2} aria-hidden className="text-muted" />
          ) : stage.state === 'running' ? (
            <LoaderCircle
              size={12}
              strokeWidth={2}
              aria-hidden
              className="animate-spin text-text"
            />
          ) : stage.state === 'failed' ? (
            <span aria-hidden className="block size-[6px] rounded-full bg-fired" />
          ) : (
            <span aria-hidden className="block size-[6px] rounded-full bg-line-strong" />
          )}
          <span
            className={cn(
              'text-meta uppercase tracking-[0.12em]',
              stage.state === 'running' && 'animate-breathe text-text',
              stage.state === 'done' && 'text-muted',
              stage.state === 'failed' && 'text-fired',
              stage.state === 'pending' && 'text-faint',
            )}
          >
            {stage.label}
          </span>
        </li>
      ))}
    </ol>
    {active?.narration ? (
      <p className="animate-fade mt-2.5 max-w-prose text-base text-muted">{active.narration}</p>
    ) : null}
    </>
  );
}

function footerText(meta: BlockMeta): string {
  const seconds = (meta.latencyMs / 1000).toFixed(1);
  const calls = `${meta.modelCalls} model call${meta.modelCalls === 1 ? '' : 's'}`;
  return `${calls} · ${seconds}s`;
}

export function AnalysisBlock({
  kind,
  subject,
  stages,
  meta,
  children,
  className,
}: {
  kind: BlockKind;
  /** The ticker or scenario this block is about. */
  subject: string;
  /** Present while the run is in flight. Omitted once complete. */
  stages?: BlockStage[] | undefined;
  /** Present once the run finishes. Omitted while running. */
  meta?: BlockMeta | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  const running = Boolean(stages && !meta);

  return (
    <section
      className={cn('w-full', className)}
      aria-busy={running || undefined}
      aria-label={`${KIND_LABEL[kind]}: ${subject}`}
    >
      <header className={cn('border-b pb-3', running ? 'border-line' : 'border-line-strong')}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Label className="text-muted">{KIND_LABEL[kind]}</Label>
          {/* The company's mark travels with its ticker. A logo in the sidebar
              that disappears the moment the analysis opens makes the two read
              as different products.

              `subject` is a DISPLAY string, not always a bare symbol: a
              scenario's reads "NVDA . grossMargin 62%, revenueGrowthYoY 15%".
              Only the leading token is the ticker. */}
          <TickerMark ticker={subject.split(/[\s·]/)[0] ?? ''} size="title" />
          <span data-figure className="text-sm text-text">
            {subject}
          </span>
        </div>
        {stages ? <Stages stages={stages} /> : null}
      </header>

      <div className="pt-5">{children}</div>

      {meta ? (
        <footer className="animate-fade mt-7 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line pt-3">
          {/*
            Latency and call count are shown, not hidden. Six real model calls
            reads as an engine; an instant answer reads as a single prompt. It
            also keeps us honest about what the run actually cost.
          */}
          <span data-figure className="text-meta text-faint">
            {footerText(meta)}
          </span>
          {meta.models?.length ? (
            <>
              <span aria-hidden className="text-line-strong">
                ·
              </span>
              <span data-figure className="text-meta text-faint">
                {meta.models.join(' + ')}
              </span>
            </>
          ) : null}
          <span className="ml-auto text-meta text-faint">
            Research, not advice. You decide.
          </span>
        </footer>
      ) : null}
    </section>
  );
}

/**
 * A titled section inside a block. Rules and labels, never nested boxes.
 *
 * `tone` sets where it sits in the hierarchy. Everything used to be the same
 * weight, which meant the conclusion looked exactly like the working and the
 * reader had to assemble the answer themselves.
 *
 *   lead   the answer — raised surface, accent rule, more air around it
 *   plain  ordinary section
 *   quiet  supporting evidence, deliberately recessive
 */
export function BlockSection({
  title,
  tone = 'plain',
  children,
  className,
}: {
  title: string;
  tone?: 'lead' | 'plain' | 'quiet';
  children: React.ReactNode;
  className?: string;
}) {
  if (tone === 'lead') {
    return (
      <section
        className={cn(
          'animate-rise mt-10 border-l-2 border-trust/50 bg-surface/60 py-5 pl-5 pr-4 first:mt-0',
          'rounded-r-[10px]',
          className,
        )}
      >
        <span className="text-meta uppercase tracking-[0.14em] text-trust/80">{title}</span>
        <div className="mt-3.5">{children}</div>
      </section>
    );
  }

  return (
    <section className={cn('animate-rise mt-9 first:mt-0', tone === 'quiet' && 'mt-7', className)}>
      <Label>{title}</Label>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Collapsed detail — the base-rate chart lives behind one of these.
 *
 * Native <details>, so it works with no JavaScript and no hydration, and the
 * keyboard and screen-reader behaviour is the browser's rather than ours.
 */
export function Disclosure({
  summary,
  children,
  className,
}: {
  summary: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details className={cn('group', className)}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-sm text-muted transition-colors marker:content-none hover:text-text">
        <span
          aria-hidden
          className="inline-block transition-transform group-open:rotate-90 text-faint"
        >
          ›
        </span>
        {summary}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
