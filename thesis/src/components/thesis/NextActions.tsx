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
        Nothing outstanding. Every assumption this thesis rests on has a tripwire that can be read.
      </p>
    );
  }

  return (
    <ol className={cn('flex flex-col', className)}>
      {actions.map((action, index) => (
        <li
          key={`${action.kind}-${action.refs.join('-')}`}
          className="flex gap-3.5 border-b border-line/60 py-5 last:border-b-0"
        >
          <span data-figure className="shrink-0 text-sm text-faint">
            {index + 1}
          </span>
          <div className="min-w-0">
            <p className={cn('max-w-prose text-lg leading-snug', TONE[action.kind])}>
              <Reveal text={action.headline} delay={index * 260} step={26} />
            </p>
            <p className="mt-1.5 max-w-prose text-base leading-relaxed text-muted">
              <Reveal text={action.detail} delay={index * 260 + 240} step={13} maxDelay={1100} />
            </p>
            {/* The concrete items, in the user's own subject matter — an action
                that names A1 and A2 is not actionable unless you can see what
                A1 and A2 actually say. */}
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
