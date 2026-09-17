'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * The company's mark, wherever its ticker appears.
 *
 * Lifted out of the sidebar so one component serves the watchlist, the analysis
 * header, the thesis list and the thesis screen. A logo that appears in the
 * sidebar and then vanishes the moment you open the analysis makes the two feel
 * like different products.
 *
 * A real logo where we have one, a monogram where we do not, and never a fake.
 * Inventing a mark for a company whose file is missing would put something on
 * screen that does not exist anywhere else in the world.
 *
 * Sizes are written out in full because a Tailwind class built from a variable
 * never reaches the stylesheet.
 */

/*
  `title` and `hero` are 30% down from where they started (28 and 36).

  At 28px the mark in the analysis header stood taller than the THESIS ATTACKED
  label beside it, so the logo read as the headline and the words read as a
  caption. It is an identifier, not the subject.

  `rail` and `row` are the sidebar's original sizes and are deliberately NOT
  scaled. They were tuned against the watchlist rows they sit in, where a mark
  shares its line with a ticker, a price and a change and has to hold its own
  against three columns of text.
*/
const MARK_SIZE = {
  rail: { px: 19, box: 'size-[19px]', text: 'text-[9px]' },
  row: { px: 22, box: 'size-[22px]', text: 'text-[9px]' },
  title: { px: 20, box: 'size-[20px]', text: 'text-[9px]' },
  hero: { px: 25, box: 'size-[25px]', text: 'text-[10px]' },
} as const;

export type MarkSize = keyof typeof MARK_SIZE;

/**
 * Does this look like a ticker at all?
 *
 * Callers do not always hold a bare symbol. An analysis block's `subject` is a
 * DISPLAY string, and for a scenario it reads "NVDA . grossMargin 62%,
 * revenueGrowthYoY 15%". Passed through unchecked, that produced a request for
 * `/logos/NVDA · GROSSMARGIN 62%, REVENUEGROWTHYOY 15%.webp` and a 404 on every
 * scenario block.
 *
 * Guarded here rather than only at the call site, because this component builds
 * the URL and is the last place that can stop a nonsense one being requested.
 */
function looksLikeTicker(value: string): boolean {
  return /^[A-Za-z][A-Za-z.\-]{0,9}$/.test(value);
}

export function TickerMark({
  ticker,
  size = 'row',
  className,
}: {
  ticker: string;
  size?: MarkSize;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const { px, box, text } = MARK_SIZE[size];

  // Nothing at all, rather than a monogram of the first two characters of a
  // sentence. A mark that is not a mark is worse than no mark.
  if (!looksLikeTicker(ticker)) return null;

  if (failed || !ticker) {
    return (
      <span
        aria-hidden
        className={cn(
          box,
          text,
          'flex shrink-0 items-center justify-center rounded-[5px] bg-line-strong font-medium text-muted',
          className,
        )}
      >
        {ticker.slice(0, 2)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/logos/${ticker.toUpperCase()}.webp`}
      alt=""
      width={px}
      height={px}
      onError={() => setFailed(true)}
      className={cn(box, 'shrink-0 rounded-[5px] bg-white/5 object-contain', className)}
    />
  );
}
