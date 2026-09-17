import type { Health, HealthBasis } from '@/thesis/types';

/**
 * How health is spoken and coloured. One place, because the header, the tree
 * and the log all say it and any drift between them reads as a bug in the
 * verdict rather than in the CSS.
 *
 * ## There is deliberately no green
 *
 * `healthy` takes no colour at all. A green badge would congratulate the user
 * for a thesis that merely has not failed YET, which is the opposite of what
 * this product is for. Holding is the default state and earns nothing.
 *
 * The existing two-signal contract absorbs all four states, so no third hue was
 * invented: RED means a line was crossed or is within reach, AMBER means you
 * are carrying this on trust because nothing could read it.
 */

export const HEALTH_WORD: Record<Health, string> = {
  healthy: 'holding',
  weakening: 'at risk',
  broken: 'broken',
  uncheckable: 'cannot tell',
};

export const HEALTH_TEXT: Record<Health, string> = {
  healthy: 'text-muted',
  // 55%: the same fact approaching, and intensity is distance. A weakening
  // assumption is the same signal as a broken one, further away.
  weakening: 'text-fired/55',
  broken: 'text-fired',
  uncheckable: 'text-trust',
};

export const HEALTH_DOT: Record<Health, string> = {
  healthy: 'bg-line-strong',
  weakening: 'bg-fired/55',
  broken: 'bg-fired',
  uncheckable: 'bg-trust',
};

/**
 * Why the verdict is what it is, in a clause a reader can act on.
 *
 * `null` where the word already says everything — a reader who has been told
 * "holding" does not need "and it is not near its line" as well. Only speak
 * when there is something to say; the rest of this product follows the same
 * rule and it is the reason the screens stay quiet enough to read.
 */
export const BASIS_CLAUSE: Record<HealthBasis, string | null> = {
  fired: 'a tripwire crossed its line',
  unrecovered: 'it crossed recently and has not cleared the line yet',
  narrowing: 'close to its line, and moving toward it',
  // "within one typical move" is precise and quietly assumes the reader knows
  // what a typical move is. This says the same thing as a consequence.
  proximity: 'close enough that one ordinary move could cross it',
  approaching: null,
  stable: null,
  nodata: 'nothing here could read this',
};

/**
 * Direction of travel, for the one case where a snapshot cannot supply it.
 *
 * Only ever attached to a DISTANCE judgement. Saying "judged on distance alone"
 * about an assumption nothing could read at all is a contradiction — there was
 * no distance to judge — and it appeared on screen the first time this shipped.
 */
export const UNKNOWN_DIRECTION = 'no earlier check to compare against yet, so this is distance alone';
