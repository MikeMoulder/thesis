import type { ThesisStore } from './store';
import type { ThesisRecord } from './types';

/**
 * Who may see and change a thesis.
 *
 * Three rules, and every route that reads or writes theses goes through them:
 *
 *   A thesis with an owner is visible to that owner only.
 *   A thesis without one is a public EXAMPLE: visible to everyone, changeable
 *   by no one. These are the theses that predate identities, kept so a first
 *   visitor lands on something with real history instead of an empty desk.
 *   Only the owner can change or delete a thesis.
 *
 * A thesis that is not yours answers exactly like one that does not exist.
 * A 403 would confirm the id is real, which is information about somebody
 * else's positions.
 */

export function isExample(thesis: ThesisRecord): boolean {
  return !thesis.ownerId;
}

export function canView(thesis: ThesisRecord, viewer: string | null): boolean {
  return isExample(thesis) || (viewer !== null && thesis.ownerId === viewer);
}

export function canEdit(thesis: ThesisRecord, viewer: string | null): boolean {
  return viewer !== null && thesis.ownerId === viewer;
}

/** What one person sees: their own first, then the examples. */
export function visibleTo(
  theses: ThesisRecord[],
  viewer: string | null,
): { mine: ThesisRecord[]; examples: ThesisRecord[] } {
  return {
    mine: viewer ? theses.filter((t) => t.ownerId === viewer) : [],
    examples: theses.filter(isExample),
  };
}

/**
 * Move every thesis from one owner to another.
 *
 * Used when a browser signs in as an identity that already exists: whatever
 * it wrote while anonymous comes along, rather than being stranded under an
 * id nobody will ever present again. Returns how many moved.
 */
export async function transferTheses(store: ThesisStore, from: string, to: string): Promise<number> {
  if (from === to) return 0;
  const owned = (await store.list()).filter((t) => t.ownerId === from);
  for (const thesis of owned) await store.put({ ...thesis, ownerId: to });
  return owned.length;
}
