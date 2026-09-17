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

const MARK_SIZE = {
  rail: { px: 19, box: 'size-[19px]', text: 'text-[9px]' },
  row: { px: 22, box: 'size-[22px]', text: 'text-[9px]' },
  title: { px: 28, box: 'size-[28px]', text: 'text-[11px]' },
  hero: { px: 36, box: 'size-[36px]', text: 'text-[13px]' },
} as const;

export type MarkSize = keyof typeof MARK_SIZE;

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
