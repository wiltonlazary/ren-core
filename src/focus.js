// The first or last focusable inside a primitive, on every renderer: a
// canvas item focuses it itself (ren-canv's `focusFirst`/`focusLast`, the
// items Tab reaches below it in document order), a DOM element through the
// elements Tab reaches below it. A FocusTrap focuses one inside first
// without a hidden stop of its own.

/** What Tab reaches in the DOM, in document order: the candidates `focusables` filters. */
const TABBABLE = 'input:not([type=hidden]), textarea, select, button, a[href], [tabindex], [contenteditable], summary';

/** The controls a disabled fieldset disables. */
const CONTROLS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);

/**
 * True when a disabled fieldset around a control disables it: any but one
 * whose first legend holds the control.
 * @param {any} el a form control
 */
function fenced(el) {
  for (let set = el.parentElement?.closest?.('fieldset[disabled]'); set != null; set = set.parentElement?.closest?.('fieldset[disabled]')) {
    let legend = set.firstElementChild;
    while (legend != null && legend.tagName !== 'LEGEND') legend = legend.nextElementSibling;
    if (legend == null || !legend.contains(el)) return true;
  }
  return false;
}

/**
 * True when Tab stops at a candidate: by its `tabindex` when it has one;
 * else a control, a link, an editable element (`contenteditable` not
 * "false") and a `details`' first `summary` are stops of their own.
 * @param {any} el
 */
function stops(el) {
  if (el.getAttribute('tabindex') !== null) return el.tabIndex >= 0;
  if (el.tagName === 'SUMMARY') {
    const details = el.parentElement;
    if (details == null || details.tagName !== 'DETAILS') return false;
    let first = details.firstElementChild;
    while (first != null && first.tagName !== 'SUMMARY') first = first.nextElementSibling;
    return first === el;
  }
  const editable = el.getAttribute('contenteditable');
  if (editable !== null && !CONTROLS.has(el.tagName) && el.tagName !== 'A') return editable.toLowerCase() !== 'false';
  return true;
}

/**
 * The elements Tab reaches below a DOM element, in document order: not
 * disabled (by themselves or by a disabled fieldset around them, its first
 * legend's controls aside), not taken out of the order (a negative
 * tabindex), not hidden below it (`display: none` or `hidden`), not of
 * hidden visibility (computed: `hidden` or `collapse`) and not in an inert
 * region. An editable element and a `details`' first `summary` are among
 * them. ren-dom's focus trap cycles among them.
 * @param {any} element a DOM element
 * @returns {any[]}
 */
export function focusables(element) {
  if (element == null || typeof element.querySelectorAll !== 'function') return [];
  const view = element.ownerDocument?.defaultView;
  /** @param {any} el */
  const shown = el => {
    for (let n = el; n != null && n !== element; n = n.parentElement) if (n.style?.display === 'none' || n.hidden === true) return false;
    const visibility = typeof view?.getComputedStyle === 'function' ? view.getComputedStyle(el).visibility : '';
    return visibility !== 'hidden' && visibility !== 'collapse';
  };
  return [...element.querySelectorAll(TABBABLE)].filter(el => !el.disabled && !(CONTROLS.has(el.tagName) && fenced(el)) && stops(el) && shown(el) && el.closest?.('[inert]') == null);
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
