'use client';

import { useEffect, useState } from 'react';

import { CitationChip } from '@/components/evidence/CitationChip';
import { Prose, Term, Value } from '@/components/prose/emphasis';
import type { Provenance } from '@/data/types';
import { describeGap } from '@/lib/market-hours';

/**
 * Who is setting this token's price while New York is shut.
 *
 * ## The one hour of the day this is not a stretch
 *
 * Crypto indicators on an equity thesis are usually decoration. This is the
 * exception, and the exception is narrow enough to state exactly.
 *
 * rNVDA trades against USDT on a crypto venue, 7x24. NVDA does not. From the
 * closing bell until the next open — sixteen hours on a weekday, sixty-five
 * over a weekend — the only people transacting in rNVDA are crypto market
 * participants, and the price a thesis is marked against overnight is a price
 * they set. During those hours their risk appetite is a fact about the holder's
 * position rather than an analogy.
 *
 * So the strip appears only then, and vanishes when the market opens. A panel
 * that showed the same number at 11am would be making a claim about equity
 * pricing that nothing here supports.
 *
 * ## What it is forbidden from becoming
 *
 * No tripwire is ever derived from this, and it is labelled context rather
 * than signal everywhere it appears. The honest version of the claim is "these
 * are the people trading it right now". The dishonest version one step away is
 * "so the token will follow", which would need a measured correlation this
 * project does not have and has not claimed.
 *
 * ## Why it can render nothing and that is fine
 *
 * Four of the five bitget-signal Skills have no working upstream on Bitget's
 * host, and the fifth is one outage from joining them. An absent strip is the
 * correct rendering of an absent Skill: there is no error state, no retry and
 * no empty box, because a research screen should not grow a broken panel
 * because an optional indicator did not load.
 */

interface SessionRisk {
  symbol: string;
  timeframe: string;
  rsi: number;
  signal: string;
  checkedAt: string;
}

interface SessionResponse {
  marketOpen: boolean;
  minutesUntilChange: number;
  risk: SessionRisk | null;
}

/** RSI in one clause, for a reader who has never seen the acronym. */
function readingOf(rsi: number): string {
  if (rsi >= 70) return 'buyers have been pushing hard enough that a pause is common from here';
  if (rsi <= 30) return 'sellers have been pushing hard enough that a bounce is common from here';
  if (rsi >= 55) return 'buyers have had the better of it lately, but not to an extreme';
  if (rsi <= 45) return 'sellers have had the better of it lately, but not to an extreme';
  return 'neither side has had the better of it lately';
}

export function SessionContext({ ticker, rToken }: { ticker: string; rToken?: string | undefined }) {
  const [data, setData] = useState<SessionResponse | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/session')
      .then((r) => (r.ok ? (r.json() as Promise<SessionResponse>) : null))
      .then((body) => {
        if (live) setData(body);
      })
      .catch(() => {
        // Nothing to show and nothing to say. See the note above.
      });
    return () => {
      live = false;
    };
  }, []);

  // Three different reasons to draw nothing, and all three draw nothing: still
  // loading, the market is open, or the Skill did not answer.
  if (!data || data.marketOpen || !data.risk) return null;

  const { risk } = data;
  const token = rToken ? rToken.replace(/USDT$/, '') : `r${ticker}`;

  const provenance: Provenance = {
    status: 'sourced',
    source: `Bitget Skills · technical_analysis ${risk.symbol} ${risk.timeframe}`,
    asOf: risk.checkedAt,
    confidence: 'moderate',
  };

  return (
    <section className="border-t border-line pt-5">
      <p className="text-meta uppercase tracking-[0.14em] text-faint">While New York is shut</p>

      <Prose className="mt-2.5 max-w-prose text-base">
        <Term>{token} keeps trading for another {describeGap(data.minutesUntilChange)}.</Term> Until
        the bell, the people setting its price are crypto market participants rather than equity
        ones, so this is the risk appetite your position is marked against overnight.
      </Prose>

      <div className="mt-3.5 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
        <span className="text-meta uppercase tracking-[0.12em] text-muted">
          {risk.symbol} · {risk.timeframe} · RSI
        </span>
        <Value>{risk.rsi.toFixed(1)}</Value>
        <span className="text-meta uppercase tracking-[0.12em] text-muted">{risk.signal}</span>
        <CitationChip provenance={provenance} />
      </div>

      <Prose className="mt-2 max-w-prose text-sm text-muted">
        On a 0 to 100 scale, {readingOf(risk.rsi)}.
      </Prose>

      <Prose className="mt-3 max-w-prose text-sm text-faint">
        Context, not a signal. <Term>No tripwire is derived from this</Term>, because the
        relationship between crypto risk appetite and a tokenized equity is not something this desk
        has measured.
      </Prose>
    </section>
  );
}
