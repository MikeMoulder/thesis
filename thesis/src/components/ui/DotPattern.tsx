import { useId, type SVGProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * A tiled dot field, used as a background wash.
 *
 * Same approach as the Orion shell this interface is modelled on: absolutely
 * positioned and pointer-transparent, so it fills its nearest positioned
 * ancestor and never intercepts a click, and faded with a radial mask rather
 * than by lowering the fill. An even, dim field across a whole screen reads as
 * noise; a fading one reads as depth.
 */
export function DotPattern({
  width = 16,
  height = 16,
  cx = 1,
  cy = 1,
  cr = 1,
  className,
  ...props
}: SVGProps<SVGSVGElement> & {
  width?: number;
  height?: number;
  cx?: number;
  cy?: number;
  cr?: number;
}) {
  // The pattern is referenced by id, so two instances on a page must not share
  // one. useId is stable across server and client render.
  const id = useId();

  return (
    <svg
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 h-full w-full fill-line-strong',
        '[mask-image:radial-gradient(60%_55%_at_50%_45%,black,transparent)]',
        className,
      )}
      {...props}
    >
      <defs>
        <pattern
          id={id}
          width={width}
          height={height}
          patternUnits="userSpaceOnUse"
          patternContentUnits="userSpaceOnUse"
        >
          <circle cx={cx} cy={cy} r={cr} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" strokeWidth={0} fill={`url(#${id})`} />
    </svg>
  );
}
