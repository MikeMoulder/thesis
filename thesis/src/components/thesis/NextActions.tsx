import { Reveal } from '@/components/prose/Reveal';
import type { ActionKind, NextAction } from '@/engine/actions';
import { cn } from '@/lib/utils';

/**
 * The closing section: what the analysis says you have to go and settle.
 *
 * It never tells anyone what to trade. Every line here is something the run
 * established that a person must now act on themselves — which is the only kind
 * of "actionable" this product is willing to produce.
 *
 * Only `unfalsifiable` takes amber, and it takes it for the same reason amber
 * is used everywhere else: that is the part being carried on trust. Colouring
 * all five would flatten the ordering that makes the list useful.
 */

const TONE: Record<ActionKind, string> = {
  unfalsifiable: 'text-trust',
  uncovered: 'text-text',
  blind: 'text-text',
  nearest: 'text-text',
  quiet: 'text-text',
};

/*
  What KIND of thing each item is, in three words, above the headline.

  Without it every entry arrives as an undifferentiated paragraph and a reader
  has to finish the sentence before knowing whether it is a warning, a gap in
  our coverage, or simply the thing most worth watching. The label lets the list
  be scanned rather than read.
*/
const KIND_LABEL: Record<ActionKind, string> = {
  unfalsifiable: 'nothing can measure this',
  uncovered: 'measurable, but not covered',
  blind: 'could not be read today',
  nearest: 'closest to tripping',
  quiet: 'nothing moves until earnings',
};

const KIND_TONE: Record<ActionKind, string> = {
  unfalsifiable: 'text-trust/80',
  uncovered: 'text-faint',
  blind: 'text-faint',
  nearest: 'text-faint',
  quiet: 'text-faint',
};

export function NextActions({
  actions,
  className,
}: {
  actions: NextAction[];
  className?: string;
}) {
  if (actions.length === 0) {
    return (
      <p className={cn('max-w-prose text-base text-muted', className)}>
        Nothing outstanding. Every single thing this thesis rests on has a number watching it, and
        all of them could be read today.
      </p>
    );
  }

  return (
    // list-none explicitly: a browser that renders its own markers puts "1." in
    // front of a number this component already prints, and the row reads "1. 1".
    <ol className={cn('flex list-none flex-col', className)}>
      {actions.map((action, index) => (
        <li
          key={`${action.kind}-${action.refs.join('-')}`}
          className="flex gap-3.5 border-b border-line/60 py-5 last:border-b-0"
        >
          <span data-figure className="shrink-0 text-sm text-faint">
            {index + 1}
          </span>
          <div className="min-w-0">
            <p
              className={cn(
                'text-meta uppercase tracking-[0.12em]',
                KIND_TONE[action.kind],
              )}
            >
              {KIND_LABEL[action.kind]}
            </p>
            <p className={cn('mt-1 max-w-prose text-lg font-medium leading-snug', TONE[action.kind])}>
              <Reveal text={action.headline} delay={index * 260} step={26} />
            </p>
            <p className="mt-1.5 max-w-prose text-base leading-relaxed text-muted">
              <Reveal text={action.detail} delay={index * 260 + 240} step={13} maxDelay={1100} />
            </p>
            {/* The concrete items, in the user's own subject matter. An action
                that names an internal id is not actionable unless the reader
                can see what that id actually says. */}
            {action.bullets?.length ? (
              <ul className="mt-3 flex flex-col gap-2 border-l border-line pl-4">
                {action.bullets.map((bullet, i) => (
                  <li key={i} className="max-w-prose text-base leading-snug text-text">
                    <Reveal text={bullet} delay={index * 260 + 700 + i * 120} step={11} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
