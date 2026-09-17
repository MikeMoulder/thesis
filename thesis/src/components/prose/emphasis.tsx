import { cn } from '@/lib/utils';

/**
 * Emphasis primitives for analysis prose.
 *
 * The problem these solve: THESIS output is dense — assumptions, conditions,
 * thresholds, dates — and set at one uniform weight it reads as a grey wall.
 * A reader scanning for "what actually matters here" finds nothing to land on.
 *
 * The fix is not to make key terms louder. It is to make everything else
 * QUIETER. `Prose` drops body copy to muted; the emphasis components sit at
 * full text colour, so they rise out of the paragraph without any highlight,
 * background, or colour trick. Contrast is made by the surroundings.
 *
 * Colour discipline is unchanged: `Warn` is the only one that takes amber, and
 * it means what amber always means — you are carrying this on trust.
 */

/** Analysis body copy. Sets the quiet baseline the emphasis components rise out of. */
export function Prose({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('max-w-prose text-base leading-relaxed text-muted', className)}>{children}</p>;
}

/** A load-bearing term — the noun the sentence is actually about. */
export function Term({ children, className }: { children: React.ReactNode; className?: string }) {
  return <strong className={cn('font-medium text-text', className)}>{children}</strong>;
}

/**
 * An identifier or condition the evaluator can act on — `grossMargin`,
 * `grossMargin < 70%`.
 *
 * The only component that takes a background, and it earns it: these tokens are
 * quoted machine vocabulary dropped into English, and a reader needs to see
 * where the sentence stops and the field name starts. Kept to identifiers and
 * conditions only — chipping every number would turn the page into confetti and
 * the chip would stop meaning anything.
 */
export function Code({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <code
      data-figure
      className={cn(
        'rounded-[4px] bg-code/10 px-[0.36em] py-[0.12em] text-[0.92em] text-code',
        className,
      )}
    >
      {children}
    </code>
  );
}

/** A metric identifier, e.g. grossMargin. */
export const Metric = Code;

/** An inline figure inside prose — keeps digits tabular so they match the tables. */
export function Value({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span data-figure className={cn('text-[0.92em] text-text', className)}>
      {children}
    </span>
  );
}

/** Something the reader is taking on trust. The only amber in prose. */
export function Warn({ children, className }: { children: React.ReactNode; className?: string }) {
  return <strong className={cn('font-medium text-trust', className)}>{children}</strong>;
}
