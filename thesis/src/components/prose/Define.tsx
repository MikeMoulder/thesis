'use client';

import { useId, useState } from 'react';

import type { Definition } from '@/lib/glossary';
import { cn } from '@/lib/utils';

/**
 * A term that explains itself.
 *
 * The page is full of words a reader may never have met — gross margin,
 * drawdown, load-bearing, headroom. Sending them to a glossary elsewhere is the
 * same as not explaining: nobody leaves the page mid-sentence. So the
 * explanation lives on the word.
 *
 * It opens on hover, on focus, and on tap, because a phone has no hover and a
 * keyboard has no pointer. It is a <button> rather than a styled span so it is
 * reachable by tab and announced as interactive.
 */
export function Define({
  definition,
  children,
  className,
}: {
  definition: Definition;
  /** Defaults to the definition's own label. */
  children?: React.ReactNode;
  className?: string;
}) {
  /*
    Two independent reasons to be open, because one boolean cannot serve both.

    A desktop click fires `mouseenter` BEFORE `click`, so a single `open` flag
    that hover sets and click toggles gets opened by the hover and immediately
    closed again by the click — the term looks broken to anyone using a mouse.

    So hovering and pinning are tracked separately: hover shows it while the
    pointer is there, clicking pins it open until clicked again. On a phone
    there is no hover, and the tap simply pins.
  */
  const [hovering, setHovering] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovering || pinned;
  const id = useId();

  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => {
          setHovering(false);
          setPinned(false);
        }}
        onClick={() => setPinned((v) => !v)}
        className={cn(
          'cursor-help underline decoration-dotted decoration-from-font underline-offset-[3px]',
          'decoration-faint transition-colors hover:decoration-muted',
          className,
        )}
      >
        {children ?? definition.label}
      </button>

      {open ? (
        <span
          id={id}
          role="tooltip"
          className={cn(
            'absolute left-0 top-full z-30 mt-1.5 block w-[min(22rem,calc(100vw-2.5rem))]',
            'rounded-[10px] border border-line-strong bg-raised p-3 text-left shadow-lg shadow-black/40',
          )}
        >
          <span className="block text-meta uppercase tracking-[0.12em] text-faint">
            {definition.label}
          </span>
          <span className="mt-1 block text-sm leading-snug text-text">{definition.short}</span>
          {definition.why ? (
            <span className="mt-1.5 block text-sm leading-snug text-muted">{definition.why}</span>
          ) : null}
          {definition.typical ? (
            <span className="mt-1.5 block text-sm leading-snug text-faint">
              {definition.typical}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
