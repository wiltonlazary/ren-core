// The first or last focusable inside a primitive, on every renderer: a
// canvas item focuses it itself (ren-canv's `focusFirst`/`focusLast`, the
// items Tab reaches below it in document order), a DOM element through the
// elements Tab reaches below it. A FocusTrap focuses one inside first
// without a hidden stop of its own.

/** What Tab reaches in the DOM, in document order. */
const TABBABLE = 'input:not([type=hidden]), textarea, select, button, a[href], [tabindex]';

/**
 * The elements Tab reaches below a DOM element, in document order: not
 * disabled, not taken out of the order (a negative tabindex), not hidden
 * below it (`display: none` or `hidden`) and not in an inert region.
 * ren-dom's focus trap cycles among them.
 * @param {any} element a DOM element
 * @returns {any[]}
 */
export function focusables(element) {
  if (element == null || typeof element.querySelectorAll !== 'function') return [];
  /** @param {any} el */
  const shown = el => {
    for (let n = el; n != null && n !== element; n = n.parentElement) if (n.style?.display === 'none' || n.hidden === true) return false;
    return true;
  };
  return [...element.querySelectorAll(TABBABLE)].filter(el => !el.disabled && el.tabIndex >= 0 && shown(el) && el.closest?.('[inert]') == null);
}

/**
 * Focuses the first focusable inside `node` (its last with `last`), as a
 * focus trap does when it opens: on a canvas the item's own `focusFirst()`
 * or `focusLast()`, on the DOM the first (or last) element Tab reaches
 * below it. Returns whether one took the focus; false for a worker's
 * Handle (the main thread holds the elements) or when none is inside.
 * @param {any} node a primitive's ref
 * @param {boolean} [last]
 */
export function $focus(node, last = false) {
  if (node == null || typeof node !== 'object') return false;
  if (typeof node.focusFirst === 'function') return (last ? node.focusLast() : node.focusFirst()) === true;
  const list = focusables(node);
  if (list.length === 0) return false;
  const target = list[last ? list.length - 1 : 0];
  target.focus();
  const root = typeof target.getRootNode === 'function' ? target.getRootNode() : target.ownerDocument;
  return (root?.activeElement ?? target.ownerDocument?.activeElement) === target;
}
