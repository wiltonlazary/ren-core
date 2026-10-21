// Text actions, the same on every renderer: what an application's own menus
// do to a field (cut, copy, paste, undo, select all) and to static text
// (copy it, select it). Each renderer gives them: an Edit's ref holds its
// field's actions under EDIT, and the root a node belongs to (the DOM's
// document or shadow root, a canvas's document) holds its text's under
// TEXT. A worker's Handle holds neither: there each helper gives null.

/** Where an Edit's ref keeps its field's actions. */
export const EDIT = Symbol.for('ren.edit');
/** Where a root keeps its text's actions. */
export const TEXT = Symbol.for('ren.text');

/**
 * A field's actions. `replace` puts text over the selection as a user's
 * edit (its onChange hears it, its undo history keeps it); `undo` and
 * `redo` step that history, each firing onChange too.
 * @typedef {object} EditActions
 * @property {() => string} value the field's text
 * @property {() => { start: number, end: number, direction: 'forward' | 'backward' | 'none' }} selection
 * @property {(start: number, end: number, direction?: 'forward' | 'backward' | 'none') => void} setSelection
 * @property {(text: string) => void} replace
 * @property {() => void} selectAll
 * @property {() => boolean} undo whether it stepped back
 * @property {() => boolean} redo whether it stepped forward
 * @property {() => boolean} canUndo
 * @property {() => boolean} canRedo
 * @property {() => void} focus
 * @property {() => boolean} secret a secret field (nothing of it is copied)
 * @property {() => boolean} readOnly
 * @property {() => boolean} disabled
 */

/**
 * A root's text actions. `at` finds the static text under a pointer event
 * (null over none, over a field or over a press target); `select` opens
 * selection on one text and selects all of it, until a press elsewhere or
 * Escape, or the release it gives; `selected` is the text selected now
 * (in a field too; '' when none, or a secret field's).
 * @typedef {object} TextActions
 * @property {(event: any) => { node: any, text: string } | null} at
 * @property {(node: any) => () => void} select
 * @property {() => string} selected
 */

/** The root a node belongs to, where its renderer keeps TEXT. @param {any} node */
const rootOf = node => {
  if (node == null || typeof node !== 'object' || typeof node.getRootNode !== 'function') return null;
  const root = node.getRootNode();
  return root?.[TEXT] != null ? root : (root?.host?.ownerDocument ?? root?.ownerDocument ?? null);
};

/** A root's text actions, or null (a worker's Handle, a renderer without them). @param {any} node @returns {TextActions | null} */
const textOf = node => rootOf(node)?.[TEXT] ?? null;

/**
 * An Edit's actions, from its ref: null for a worker's Handle (the main
 * thread holds the field) or anything else.
 * @param {any} ref an Edit's ref
 * @returns {EditActions | null}
 */
export const editOf = ref => (ref != null && typeof ref === 'object' && ref[EDIT] != null ? ref[EDIT] : null);

/**
 * The static text under a pointer event, as `{ node, text }`: null over
 * none (or where the renderer has no text actions).
 * @param {any} event a pointer handler's event
 */
export const textAt = event => textOf(event?.target)?.at(event) ?? null;

/**
 * Opens selection on one text (a node `textAt` gave) and selects all of
 * it; a press elsewhere or Escape ends it, or the release it gives. Null
 * where the renderer has no text actions.
 * @param {any} node
 * @returns {(() => void) | null}
 */
export const selectText = node => textOf(node)?.select(node) ?? null;

/**
 * The text selected now in the root `node` belongs to ('' when none).
 * @param {any} node any node of the root
 */
export const selectedText = node => textOf(node)?.selected() ?? '';
