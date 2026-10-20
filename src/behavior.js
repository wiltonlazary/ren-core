// How a root behaves under the user's hands, the same on every renderer: as an
// application (the default) or as a page. `like` sets every switch's default;
// each switch then overrides its own part.

/**
 * A root's behavior: 'app' (the default) or 'page', or `like` one of them
 * with switches of its own over it.
 * - `select`: loose text can be selected (else only an Edit, and what sets
 *   the style `select: 'text'`).
 * - `selectAll`: Ctrl or Cmd+A selects all the page's text (else only inside
 *   an Edit or a `select: 'text'` element, and nothing elsewhere).
 * - `textCursor`: the I-beam over any selectable text (else only over an Edit
 *   or a `select: 'text'` element's text).
 * - `menu`: the browser's context menu outside Edits.
 * - `editMenu`: the browser's context menu in an Edit (paste, spelling).
 * - `callout`: the browser's long-press callout and tap highlight on touch.
 * @typedef {'app' | 'page' | { like?: 'app' | 'page', select?: boolean, selectAll?: boolean, textCursor?: boolean, menu?: boolean, editMenu?: boolean, callout?: boolean }} Behavior
 */

/** @typedef {{ select: boolean, selectAll: boolean, textCursor: boolean, menu: boolean, editMenu: boolean, callout: boolean }} Switches */

/** Each `like`'s switches: an app keeps the browser's menu only in an Edit. */
const LIKE = /** @type {Record<'app' | 'page', Switches>} */ ({
  app: { select: false, selectAll: false, textCursor: false, menu: false, editMenu: true, callout: false },
  page: { select: true, selectAll: true, textCursor: true, menu: true, editMenu: true, callout: true },
});

/**
 * Every switch of a behavior: its `like`'s defaults ('app' when none), each
 * set one over them.
 * @param {Behavior | null | undefined} behavior @returns {Switches}
 */
export function behaviorOf(behavior) {
  if (behavior == null) return { ...LIKE.app };
  if (typeof behavior === 'string') return { ...(LIKE[behavior] ?? LIKE.app) };
  const out = { ...(LIKE[behavior.like ?? 'app'] ?? LIKE.app) };
  for (const key of /** @type {(keyof Switches)[]} */ (Object.keys(out))) if (typeof behavior[key] === 'boolean') out[key] = /** @type {boolean} */ (behavior[key]);
  return out;
}
