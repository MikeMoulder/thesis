'use client';

import { useCallback, useState } from 'react';

import { BaseRateChart } from '@/components/thesis/BaseRateChart';
import type { Evaluation, HistoricalEvidence } from '@/engine/breakers/evaluate';
import type { ThesisBreaker } from '@/engine/breakers/types';

import { breakerCondition } from './breaker-text';

/**
 * Base rates, fetched the first time someone opens them.
 *
 * Lazy because the request reads ten years of filings and the full price
 * history for one tripwire. Paying that on every run would slow the thing
 * everyone sees to fund the thing most people never open — and there is one of
 * these per breaker.
 */

type State =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'evidence'; evidence: HistoricalEvidence }
  | { phase: 'none'; reason: string }
  | { phase: 'error'; message: string };

export function BaseRateDisclosure({ ticker, breaker }: { ticker: string; breaker: ThesisBreaker }) {
  const [state, setState] = useState<State>({ phase: 'idle' });

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const response = await fetch('/api/history', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticker, breaker }),
      });
      const data = (await response.json()) as
        | HistoricalEvidence
        | Evaluation
        | { error?: string };

      if (!response.ok) {
        setState({
          phase: 'error',
          message: 'error' in data && data.error ? data.error : response.statusText,
        });
        return;
      }
      if ('occurrences' in data) {
        setState({ phase: 'evidence', evidence: data });
        return;
      }
      // An Evaluation came back instead of evidence: no base rate is possible.
      // That is an answer, so say what it is rather than showing an error.
      setState({
        phase: 'none',
        reason:
          'reason' in data && data.reason
            ? data.reason
            : 'No base rate could be built for this tripwire.',
      });
    } catch (error) {
      setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }, [ticker, breaker]);

  return (
    <details
      className="group"
      onToggle={(event) => {
        if (event.currentTarget.open && state.phase === 'idle') void load();
      }}
    >
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-sm text-muted transition-colors marker:content-none hover:text-text">
        <span aria-hidden className="text-faint transition-transform group-open:rotate-90">
          ›
        </span>
        When <span data-figure>{breakerCondition(breaker)}</span> happened before
      </summary>

      <div className="mt-3">
        {state.phase === 'loading' ? (
          <p className="text-sm text-faint">
            Reading the full record — filings and price history…
          </p>
        ) : null}
        {state.phase === 'evidence' ? (
          <BaseRateChart evidence={state.evidence} breaker={breaker} />
        ) : null}
        {state.phase === 'none' ? <p className="text-sm text-trust">{state.reason}</p> : null}
        {state.phase === 'error' ? (
          <p className="text-sm text-trust">Could not build a base rate: {state.message}</p>
        ) : null}
      </div>
    </details>
  );
}
