/**
 * The sidebar's collapsed state, shared by the two places that touch it.
 *
 * The root layout restores it in the head, before the first paint, and the
 * Sidebar flips it afterwards. Both write the same attribute on <html> and the
 * same storage key, so they live in one module rather than as two string
 * literals that only agree until somebody renames one.
 *
 * Every collapsed style keys off `data-panel` through the `collapsed:` variant
 * in globals.css. React state only follows along, for what CSS cannot do:
 * deciding what is focusable and what the toggle announces.
 */

export const PANEL_KEY = 'thesis.panel.collapsed.v1';

/**
 * Inlined into the head. Storage throws in a private window, and then the
 * panel simply opens.
 */
export const PANEL_SCRIPT = `try{if(localStorage.getItem('${PANEL_KEY}')==='1')document.documentElement.dataset.panel='collapsed'}catch(e){}`;

export function readCollapsed(): boolean {
  return document.documentElement.dataset.panel === 'collapsed';
}

export function writeCollapsed(collapsed: boolean): void {
  if (collapsed) document.documentElement.dataset.panel = 'collapsed';
  else delete document.documentElement.dataset.panel;

  try {
    localStorage.setItem(PANEL_KEY, collapsed ? '1' : '0');
  } catch {
    // Blocked storage: the preference lasts for this page only.
  }
}
