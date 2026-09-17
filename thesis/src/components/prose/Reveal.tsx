'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * Analysis text arriving a word at a time.
 *
 * The engine streams, and the writing should look like it is being produced
 * rather than pasted in finished. Every word is in the DOM from the first frame
 * and only its opacity is animated, on a staggered CSS delay — so the paragraph
 * stays selectable, searchable and correctly read aloud while it is still
 * appearing. A typewriter that rebuilds a growing string on every tick is none
 * of those things, and it thrashes React besides.
 *
 * `prefers-reduced-motion` is handled globally: the animation collapses to
 * nothing and the text is simply there.
 */
export function Reveal({
  text,
  /** Milliseconds between words. */
  step = 22,
  /** Delay before the first word, for sequencing against a parent. */
  delay = 0,
  /** Long passages should not take a minute to land. */
  maxDelay = 900,
  className,
}: {
  text: string;
  step?: number;
  delay?: number;
  maxDelay?: number;
  className?: string;
}) {
  // Split on spaces but keep the spacing, so wrapping behaves normally.
  const words = text.split(/(\s+)/);

  return (
    <span className={className}>
      {words.map((word, i) =>
        /^\s+$/.test(word) ? (
          word
        ) : (
          <span
            key={i}
            className="animate-word inline-block whitespace-pre-wrap"
            style={{ animationDelay: `${Math.min(delay + i * step, delay + maxDelay)}ms` }}
          >
            {word}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * A figure counting to its value.
 *
 * Only worth it because these numbers are the point of the page — a reading
 * settling into place draws the eye to it, where the same number simply being
 * there does not. Short, and it always ends exactly on the real value rather
 * than on a rounded interpolation.
 */
export function CountUp({
  value,
  decimals = 2,
  suffix = '',
  duration = 650,
  className,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    // Honour the user's motion preference: jump straight to the value.
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setDisplay(value);
      return;
    }

    const from = 0;
    const started = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      // Ease out, so it decelerates into the figure rather than stopping dead.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        // Land on the exact value, never on the interpolated one.
        setDisplay(value);
      }
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [value, duration]);

  return (
    <span data-figure className={cn(className)}>
      {display.toFixed(decimals)}
      {suffix}
    </span>
  );
}
