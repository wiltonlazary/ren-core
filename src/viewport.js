// The viewport of an application root, readable reactively on every
// renderer: its width and height (CSS pixels) and the user's preferences a
// media query reads (a dark color scheme, reduced motion), as the root's
// host reports them (its `viewport`): ren-dom from the window, ren-canv
// from its Document's size, and in worker mode through the connection. A
// region of a root may have its own (the Host's `viewportOf`: ren-three's
// panel), which the components built in it read.
// `$media` evaluates a CSS media query over them, so rui-core's
// breakpoints (Shell, Carousel, `$fits`) read the same on each.

import { $signal, $read, $write, $batch, $memo, $cleanup, $owner, $unowned, $writable } from 'rrx-core';
import { $active, placeOf, placing } from './core.js';

/** Bits of a viewport's flags: the user prefers a dark color scheme, reduced motion. */
export const DARK = 1;
export const REDUCED = 2;

/**
 * An application root's viewport, as reactive nodes: `width` and `height`
 * in CSS pixels (0 on a host that reports none: a server render), `dark`
 * (prefers-color-scheme: dark) and `reduced` (prefers-reduced-motion:
 * reduce).
 */
export class Viewport {
  /** @param {import('rrx-core/core').Graph} R */
  constructor(R) {
    /** @type {import('rrx-core/core').Node<number>} */
    this.width = $unowned(R, () => $writable($signal(R, 0)));
    /** @type {import('rrx-core/core').Node<number>} */
    this.height = $unowned(R, () => $writable($signal(R, 0)));
    /** @type {import('rrx-core/core').Node<boolean>} */
    this.dark = $unowned(R, () => $writable($signal(R, false)));
    /** @type {import('rrx-core/core').Node<boolean>} */
    this.reduced = $unowned(R, () => $writable($signal(R, false)));
  }
}

/** A viewport (a root's or a region's), the readers holding it, and its source's stop. */
class Watch {
  /** @param {import('rrx-core/core').Graph} R */
  constructor(R) {
    this.R = R;
    this.view = new Viewport(R);
    this.users = 0;
    /** @type {(() => void) | null} */
    this.stop = null;
  }

  /** The host's report. @param {number} width @param {number} height @param {number} flags */
  report(width, height, flags) {
    const R = this.R;
    if (R.closed) return;
    const v = this.view;
    $batch(R, () => {
      $write(/** @type {any} */ (v.width), width);
      $write(/** @type {any} */ (v.height), height);
      $write(/** @type {any} */ (v.dark), (flags & DARK) !== 0);
      $write(/** @type {any} */ (v.reduced), (flags & REDUCED) !== 0);
    });
  }
}

/**
 * Each root's viewport, and each region's (by the source its Host gave),
 * made on the first read and kept for the root's or the source's life (its
 * four signals live on the root): the source follows it only while a reader
 * lives, and again on the next one. The WeakMap lets it go with its key.
 * @type {WeakMap<object, Watch>}
 */
const watches = new WeakMap();

/**
 * The viewport of where the running component is (call it in a component):
 * its application root's, or the region's it is built in when the root's
 * Host gives that region one of its own (`viewportOf`: ren-three's panel),
 * as reactive nodes, followed while any reader's owner lives (the source
 * stops reporting after the last one, and reports again for the next; the
 * nodes are the root's, one set per root or region for its life).
 * @returns {Viewport}
 */
export function $viewport() {
  const R = $active();
  const H = placeOf(R)?.H;
  const node = placing();
  const source = node !== null && H?.viewportOf !== undefined ? H.viewportOf(node) : null;
  const key = source ?? R;
  let watch = watches.get(key);
  if (watch === undefined) {
    watch = new Watch(R);
    watches.set(key, watch);
  }
  const w = watch;
  if (w.users++ === 0) {
    const report = w.report.bind(w);
    w.stop = (source ?? H)?.viewport?.((width, height, flags) => report(width, height, flags)) ?? null;
  }
  const owner = $owner(R);
  if (owner !== null)
    $cleanup(owner, () => {
      if (--w.users > 0) return;
      const stop = w.stop;
      w.stop = null;
      if (stop !== null) stop();
    });
  return w.view;
}

/** A length of a media query in CSS pixels (em and rem are 16px, as a media query reads them), or NaN. @param {string} text */
function pixels(text) {
  // A CSS number: a sign, digits with a fraction, an exponent.
  const m = /^([+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?)(px|em|rem)?$/.exec(text.trim());
  if (m === null) return NaN;
  const n = Number(m[1]);
  return m[2] === 'em' || m[2] === 'rem' ? n * 16 : m[2] === undefined && n !== 0 ? NaN : n;
}

/** A test of one query over a viewport: width, height, flags. @typedef {(width: number, height: number, flags: number) => boolean} Test */

/** Never true: a media type other than `all` and `screen`. @type {Test} */
const NEVER = () => false;
/**
 * Never true, even under `not`: an unknown feature or an invalid value, as a
 * browser reads one (unknown stays unknown, and a malformed query is `not all`).
 * @type {Test}
 */
const UNKNOWN = () => false;
/** @type {Test} */
const ALWAYS = () => true;

/** Compares a size with a length. @param {string} op @param {number} length @returns {(v: number) => boolean} */
function compare(op, length) {
  switch (op) {
    case '>=':
    case 'min':
      return v => v >= length;
    case '<=':
    case 'max':
      return v => v <= length;
    case '>':
      return v => v > length;
    case '<':
      return v => v < length;
    default:
      return v => v === length;
  }
}

/**
 * One media feature in parentheses: `min-width: 48em`, `orientation:
 * portrait`, `prefers-color-scheme: dark`, `prefers-reduced-motion`, a
 * range with the feature first, `width >= 600px`, or a feature alone
 * (boolean context: `orientation`).
 * @param {string} text
 * @returns {Test}
 */
function feature(text) {
  const range = /^(width|height)\s*(>=|<=|>|<|=)\s*(.+)$/.exec(text);
  if (range !== null) {
    const length = pixels(range[3]);
    if (length !== length) return UNKNOWN;
    const test = compare(range[2], length);
    return range[1] === 'width' ? w => test(w) : (_w, h) => test(h);
  }
  const at = text.indexOf(':');
  const name = (at < 0 ? text : text.slice(0, at)).trim();
  const value = at < 0 ? null : text.slice(at + 1).trim();
  const sized = /^(min-|max-)?(width|height)$/.exec(name);
  if (sized !== null) {
    if (value === null) return sized[1] === undefined ? (sized[2] === 'width' ? w => w > 0 : (_w, h) => h > 0) : UNKNOWN;
    const length = pixels(value);
    if (length !== length) return UNKNOWN;
    const test = compare(sized[1] === undefined ? '=' : sized[1].slice(0, 3), length);
    return sized[2] === 'width' ? w => test(w) : (_w, h) => test(h);
  }
  switch (name) {
    // Without a value, boolean context: true when the feature has a value
    // other than none (orientation and a color scheme always do).
    case 'orientation':
      return value === null ? ALWAYS : value === 'portrait' ? (w, h) => h >= w : value === 'landscape' ? (w, h) => w > h : UNKNOWN;
    case 'prefers-color-scheme':
      return value === null ? ALWAYS : value === 'dark' ? (_w, _h, f) => (f & DARK) !== 0 : value === 'light' ? (_w, _h, f) => (f & DARK) === 0 : UNKNOWN;
    case 'prefers-reduced-motion':
      return value === null || value === 'reduce' ? (_w, _h, f) => (f & REDUCED) !== 0 : value === 'no-preference' ? (_w, _h, f) => (f & REDUCED) === 0 : UNKNOWN;
    default:
      return UNKNOWN;
  }
}

// A media query list, as Media Queries Level 4 reads it, parsed once:
//   list      = query [, query]*      an empty or all-whitespace list is true
//   query     = [not | only] type [and condition] | condition
//   condition = not (feature) | (feature) [and (feature)]*
//   type      = an ident (-?[a-z_][a-z0-9_-]*, any case) other than only,
//               not, and, or, layer, valid only first; all and screen
//               match, any other type does not (so `not print` is true)
// Whitespace is any CSS whitespace (space, tab, newline), case folds in
// ASCII only, and a block still open at the end closes there. A malformed
// query is `not all`: false, whatever its not says. An unknown feature or an
// invalid value is unknown, and `and` is three-valued: a term known false
// makes the query false (so its `not` true, `not print and (hover: hover)`);
// otherwise an unknown term makes the query false, under not too. A feature
// without a value is boolean context: `(orientation)` is true. `or` and
// nested parentheses are not read: they are unknown terms.

/** Words that are never a media type. */
const RESERVED = new Set(['only', 'not', 'and', 'or', 'layer']);
/** An ident at a position. */
const IDENT = /-?[a-z_][a-z0-9_-]*/y;

/** Whether a character code is CSS whitespace. @param {number} c */
function space(c) {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
}

/**
 * A query's tokens: idents, and parenthesized blocks with their
 * parentheses; null when it holds anything else (a number, a function, an
 * unclosed block).
 * @param {string} text lower case
 * @returns {string[] | null}
 */
function tokens(text) {
  /** @type {string[]} */
  const out = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (space(c)) {
      i++;
    } else if (c === 40) {
      let depth = 1;
      let j = i + 1;
      for (; j < n && depth > 0; j++) {
        const d = text.charCodeAt(j);
        if (d === 40) depth++;
        else if (d === 41) depth--;
      }
      // A block still open at the end of the query closes there.
      out.push(depth === 0 ? text.slice(i, j) : text.slice(i) + ')'.repeat(depth));
      i = j;
    } else {
      IDENT.lastIndex = i;
      if (!IDENT.test(text)) return null;
      // An ident right before `(` is a function: not a word of a query.
      if (text.charCodeAt(IDENT.lastIndex) === 40) return null;
      out.push(text.slice(i, IDENT.lastIndex));
      i = IDENT.lastIndex;
    }
  }
  return out;
}

/** Whether a token is a parenthesized block. @param {string} token */
const isBlock = token => token.charCodeAt(0) === 40;

/** One parenthesized feature as a test (UNKNOWN when not read). @param {string} block @returns {Test} */
function inParens(block) {
  const inner = block.slice(1, -1);
  // Nested parentheses (a nested condition) are not read.
  return inner.indexOf('(') >= 0 ? UNKNOWN : feature(inner.trim());
}

/**
 * One query as a test.
 * @param {string[] | null} t its tokens
 * @returns {Test}
 */
function queryTest(t) {
  if (t === null || t.length === 0) return UNKNOWN;
  /** The terms known: a query is their `and`. @type {Test[]} */
  const all = [];
  // A term not read (an unknown feature, an invalid value) is unknown.
  let unknown = false;
  let i = 0;
  let negate = false;
  const first = t[0];
  if (!isBlock(first) && !(first === 'not' && t.length > 1 && isBlock(t[1]))) {
    // [not | only] type [and condition]
    if (first === 'not' || first === 'only') {
      negate = first === 'not';
      i = 1;
    }
    if (i >= t.length || RESERVED.has(t[i])) return UNKNOWN;
    all.push(t[i] === 'all' || t[i] === 'screen' ? ALWAYS : NEVER);
    i++;
    if (i < t.length) {
      if (t[i] !== 'and' || i + 1 === t.length) return UNKNOWN;
      i++;
    }
  }
  // condition = not (feature) | (feature) [and (feature)]*
  if (i < t.length && t[i] === 'not') {
    if (i + 2 !== t.length || !isBlock(t[i + 1])) return UNKNOWN;
    const test = inParens(t[i + 1]);
    if (test === UNKNOWN) unknown = true;
    else all.push((w, h, f) => !test(w, h, f));
  } else if (i < t.length) {
    for (;;) {
      if (!isBlock(t[i])) return UNKNOWN;
      const test = inParens(t[i]);
      if (test === UNKNOWN) unknown = true;
      else all.push(test);
      if (++i === t.length) break;
      if (t[i] !== 'and' || i + 1 === t.length) return UNKNOWN;
      i++;
    }
  }
  // Three-valued `and`: a term known false makes the query false (its `not`
  // true); otherwise an unknown term makes it unknown, false either way.
  if (unknown) {
    if (!negate || all.length === 0) return UNKNOWN;
    return (w, h, f) => {
      for (let k = 0; k < all.length; k++) if (!all[k](w, h, f)) return true;
      return false;
    };
  }
  /** @type {Test} */
  const one =
    all.length === 1
      ? all[0]
      : (w, h, f) => {
          for (let k = 0; k < all.length; k++) if (!all[k](w, h, f)) return false;
          return true;
        };
  return negate ? (w, h, f) => !one(w, h, f) : one;
}

/**
 * A media query list as a test, parsed once (the contract above): queries
 * separated by commas (any matches; an empty list matches), each an
 * optional `not` or `only` with a media type (`all` and `screen` match,
 * others not) and features joined by `and`, or features alone. A malformed
 * query never matches, `not` or not; an unknown term matches neither way
 * unless a term known false decides the query.
 * @param {string} query
 * @returns {Test}
 */
export function media(query) {
  // ASCII case folds; other letters (U+212A, the Kelvin sign) stay as they are.
  const text = query.replace(/[A-Z]+/g, upper => upper.toLowerCase());
  const n = text.length;
  let blank = true;
  for (let i = 0; i < n && blank; i++) blank = space(text.charCodeAt(i));
  if (blank) return ALWAYS;
  /** @type {Test[]} */
  const list = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i <= n; i++) {
    const c = i < n ? text.charCodeAt(i) : 44;
    if (c === 40) depth++;
    // A stray `)` closes nothing: a block after it still keeps its commas.
    else if (c === 41) {
      if (depth > 0) depth--;
    } else if (c === 44 && (depth === 0 || i === n)) {
      const test = queryTest(tokens(text.slice(from, i)));
      if (test !== UNKNOWN && test !== NEVER) list.push(test);
      from = i + 1;
    }
  }
  if (list.length === 0) return NEVER;
  if (list.length === 1) return list[0];
  return (w, h, f) => {
    for (let i = 0; i < list.length; i++) if (list[i](w, h, f)) return true;
    return false;
  };
}

/**
 * Whether a CSS media query matches the viewport `$viewport` reads there
 * (the root's, or its region's), as a reactive node (call it in a
 * component): `$media('(min-width: 48em)')`.
 * It reads width and height (`min-`, `max-`, or a range: `width >= 600px`;
 * px, em and rem, an em 16px as media queries read it), `orientation`,
 * `prefers-color-scheme` and `prefers-reduced-motion`, a feature alone in
 * boolean context, joined by `and`, `not`, `only`, a first media type
 * (`all`, `screen` match) and commas, as Media Queries Level 4 reads them;
 * an empty query matches. A malformed query never matches, under `not`
 * too; an unknown feature or an invalid value is unknown, and `and` is
 * three-valued: a term known false decides the query, otherwise an unknown
 * term keeps it from matching, under `not` too. `or` and nested
 * parentheses are not read (unknown). Parsed once per call.
 * @param {string} query
 * @returns {import('rrx-core/core').Readable<boolean>}
 */
export function $media(query) {
  const R = $active();
  const test = media(query);
  const v = $viewport();
  return $memo(R, () => test($read(v.width), $read(v.height), ($read(v.dark) ? DARK : 0) | ($read(v.reduced) ? REDUCED : 0)));
}
