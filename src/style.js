// The portable style of the ren-core primitives: one vocabulary every renderer
// draws the same way. A primitive's `style` is an object of the names below;
// `styled` normalizes it once into a fixed-shape `Style` record that the
// renderers read (ren-dom turns it into CSS, ren-canv lays it out and
// paints it for ren-skia and ren-three).
//
// The box model is CSS's flexbox and grid, with CSS's own defaults: the
// browser lays the DOM out itself, and the drawn renderers (ren-canv) lay out
// with Taffy, an implementation of the same CSS algorithms:
// - every container (View, Layout, Scroll) is a flex container, or a grid
//   with `display: 'grid'`; flex: `direction` 'column' (default) or 'row',
//   `wrap`; grid: `columns` and `rows` (track lists as CSS writes them:
//   '100px 1fr', 'repeat(3, 1fr)', 'minmax(80px, 1fr) auto'), and on an
//   item `column` and `row` (CSS lines: 2, '1 / 3', 'span 2'); both: `gap`
//   (or `columnGap` and `rowGap`), `align` (align-items: 'stretch'
//   default, 'start', 'center', 'end'), `justify` ('start' default,
//   'center', 'end', 'between', 'around', 'evenly');
// - `display: 'contents'` (a View's, Layout's or Scroll's; a leaf ignores
//   it) makes no box: its children lay out as its parent's (a table row
//   carrying `role="row"` while its cells sit in the table's grid); it paints and hits nothing of its own (its
//   box's style is dropped), while text style and events still pass
//   through it as an ancestor's;
// - an item's size is its `width` or `height`, else its content's; `grow`
//   and `shrink` (1 by default, as CSS) share free space and overflow;
//   `min…` and `max…` clamp it (CSS's automatic minimum by default); `self`
//   aligns one item;
// - sizes are border-box: `width` and `height` include `padding` and
//   `border`; `margin` keeps space around an item;
// - `overflow: 'hidden'` clips the children to the padding box;
// - `width`, `height`, their `min…` and `max…`, and the insets take a
//   number (px) or a percent string ('50%'), of the parent's content box as
//   CSS's (insets: of its padding box when absolute);
// - `position: 'absolute'` takes an item out of the flow and places it by its
//   insets (`top`, `right`, `bottom`, `left`, or `inset` for all four)
//   against its parent's padding box: the parent is always the containing
//   block (every primitive is positioned, as a relatively positioned
//   element); `position: 'relative'` (or unset: the normal flow) moves the
//   item by its insets from where the flow puts it;
// - `zIndex` (an integer) makes the item a stacking context, as CSS's
//   `z-index` on a positioned element (so does an `opacity` below 1, at 0):
//   the contexts inside one paint in `zIndex` order, negatives under its
//   children, the rest over them, equal ones in tree order, and the topmost
//   takes the pointer. Everything else paints in tree order.
//
// Colors are ARGB numbers (0xff336699) or '#rgb', '#rgba', '#rrggbb',
// '#rrggbbaa', 'rgb(r, g, b)', 'rgba(r, g, b, a)' and 'transparent'. Lengths
// are logical pixels. Names outside the vocabulary are not portable: ren-dom
// passes them through as CSS, and the drawn renderers ignore them
// (development mode reports them).

/**
 * Four sides, as a number (all), [vertical, horizontal] or [top, right, bottom, left].
 * @typedef {number | readonly [number, number] | readonly [number, number, number, number]} Sides
 */

/**
 * A length that may be a percentage: a number (px) or a percent string ('50%').
 * @typedef {number | string} Length
 */

/**
 * A drop shadow: offset, blur (as CSS box-shadow's) and color.
 * @typedef {object} Shadow
 * @property {number=} x
 * @property {number=} y
 * @property {number=} blur
 * @property {number | string=} color
 */

/**
 * A gradient background: `linear` an angle in degrees as CSS's
 * linear-gradient (0 to the top, 90 to the right), or `radial` true, a
 * circle from the center to the farthest corner (CSS's
 * `radial-gradient(circle farthest-corner)`); `stops` are [offset, color]
 * pairs, offsets from 0 to 1 in order.
 * @typedef {object} GradientInput
 * @property {number=} linear
 * @property {boolean=} radial
 * @property {readonly (readonly [number, number | string])[]} stops
 */

/**
 * A normalized gradient: `stops` holds offset, ARGB color pairs, flat.
 */
export class Gradient {
  /** @param {boolean} radial @param {number} angle @param {number[]} stops */
  constructor(radial, angle, stops) {
    this.radial = radial;
    /** Degrees, for a linear one. */
    this.angle = angle;
    this.stops = stops;
  }
}

/**
 * A gradient from its portable form, or null when it is not one (at least
 * two stops, each an offset and a portable color).
 * @param {any} value
 * @returns {Gradient | null}
 */
function gradient(value) {
  const radial = value.radial === true;
  const angle = typeof value.linear === 'number' && Number.isFinite(value.linear) ? value.linear : radial ? 0 : NaN;
  if (angle !== angle || !Array.isArray(value.stops) || value.stops.length < 2) return null;
  /** @type {number[]} */
  const stops = [];
  for (const stop of value.stops) {
    const color = Array.isArray(stop) ? argb(stop[1]) : null;
    if (color === null || typeof stop[0] !== 'number' || !Number.isFinite(stop[0])) return null;
    stops.push(Math.max(0, Math.min(1, stop[0])), color);
  }
  return new Gradient(radial, angle, stops);
}

/**
 * The portable style vocabulary: what a primitive's `style` holds.
 * @typedef {object} StyleInput
 * @property {'flex' | 'grid' | 'contents'=} display 'contents' (a View, Layout or Scroll; a leaf ignores it): no box; its children lay out as its parent's, and text style and events pass through it.
 * @property {'column' | 'row'=} direction
 * @property {boolean=} wrap Rows of children in a container; lines of words in a Label.
 * @property {number=} gap
 * @property {number=} columnGap
 * @property {number=} rowGap
 * @property {string | readonly (string | number)[]=} columns A grid's column tracks, as CSS's grid-template-columns (an array joins with spaces; numbers are px).
 * @property {string | readonly (string | number)[]=} rows A grid's row tracks.
 * @property {string | number=} column A grid item's column lines, as CSS's grid-column (2, '1 / 3', 'span 2').
 * @property {string | number=} row A grid item's row lines.
 * @property {Sides=} padding
 * @property {Sides=} margin
 * @property {Length=} width
 * @property {Length=} height
 * @property {Length=} minWidth
 * @property {Length=} maxWidth
 * @property {Length=} minHeight
 * @property {Length=} maxHeight
 * @property {number=} aspectRatio Width over height, as CSS's aspect-ratio: the size not set follows the one that is.
 * @property {'relative' | 'absolute' | 'sticky' | 'fixed'=} position 'sticky': in the flow, held within its nearest Scroll's view (the page's without one) by its `top`, `right`, `bottom` and `left` (px or a percent of the view), inside its parent; 'fixed': out of the flow, placed by its insets against the viewport, over the page's scroll and clips.
 * @property {Length=} top An inset: from the containing block's top (absolute), or a move down (relative).
 * @property {Length=} right
 * @property {Length=} bottom
 * @property {Length=} left
 * @property {Length=} inset All four insets.
 * @property {number=} zIndex An integer: a stacking context, painted in this order among its siblings in the enclosing one.
 * @property {number=} grow
 * @property {number=} shrink
 * @property {'start' | 'center' | 'end' | 'stretch'=} align
 * @property {'start' | 'center' | 'end' | 'stretch'=} self
 * @property {'start' | 'center' | 'end' | 'between' | 'around' | 'evenly'=} justify
 * @property {'visible' | 'hidden'=} overflow
 * @property {number | string | GradientInput=} background A color, or a gradient.
 * @property {number | string=} color
 * @property {number=} opacity
 * @property {number=} border A border width, all four sides.
 * @property {number=} borderTop A side's border width (after `border`, it overrides that side).
 * @property {number=} borderRight
 * @property {number=} borderBottom
 * @property {number=} borderLeft
 * @property {number | string=} borderColor All four sides' border color.
 * @property {number | string=} borderTopColor A side's border color.
 * @property {number | string=} borderRightColor
 * @property {number | string=} borderBottomColor
 * @property {number | string=} borderLeftColor
 * @property {'solid' | 'dashed' | 'dotted'=} borderStyle
 * @property {number | string=} placeholderColor The color of an Edit's placeholder (its `label` while empty); inherits, as text does.
 * @property {number | readonly [number, number, number, number]=} radius A corner radius: one for all four, or [top-left, top-right, bottom-right, bottom-left], as CSS's border-radius.
 * @property {Shadow | null=} shadow
 * @property {number=} fontSize
 * @property {'normal' | 'bold' | number=} fontWeight 100 to 900 in hundreds ('normal' 400, 'bold' 700), as CSS's; a renderer draws the nearest face it has.
 * @property {string=} fontFamily A CSS font family list; the drawn renderers read 'monospace' in it (their monospace face, when given one) and draw anything else in their typeface.
 * @property {boolean=} italic
 * @property {'start' | 'center' | 'end'=} textAlign
 * @property {number=} lineHeight A multiple of the font size.
 * @property {boolean=} underline
 * @property {boolean=} strike A line through the text (CSS's line-through); it reaches the text below, as a decoration.
 * @property {'text' | 'none'=} select Whether a Label's text can be selected.
 * @property {'fill' | 'contain' | 'cover' | 'none'=} objectFit How an Image fits its box, as CSS's object-fit ('fill' by default: stretched).
 * @property {TouchAction=} touchAction The pans and zoom a touch pressed on the item (or under it) leaves to the browser, as CSS's touch-action: the item's and each ancestor's that sets one allow it together ('auto' all, 'none' nothing, 'manipulation' all three of 'pan-x', 'pan-y', 'pinch-zoom'). Set nowhere on the path, the renderer's default holds (a canvas keeps the page from panning under a touch its items took).
 * @property {'none' | 'uppercase' | 'lowercase' | 'capitalize'=} textTransform How text shows, as CSS's text-transform; it inherits, but an Action and an Edit take only their own, as a browser's form controls do, and an Edit shows its value as typed. The text given stays the data (ren-json reads it); a selection copies what shows, as Chrome copies it.
 * @property {'auto' | 'none'=} pointerEvents 'none': the item is no target of the pointer (presses, hover, pointer events, wheel, selection reach what is under it), as CSS's pointer-events; it inherits, and a child's 'auto' takes the pointer again.
 * @property {number | readonly [number, number]=} scale A scale, both axes or [x, y], as CSS's `scale`: painted and hit, not laid out.
 * @property {number=} rotate Degrees clockwise, as CSS's `rotate`.
 * @property {number=} skewX Degrees the item slants along x (its vertical edges lean), as CSS's `skewX()`: after the translate, rotate and scale, as CSS's `transform` follows them.
 * @property {number=} skewY Degrees the item slants along y (its horizontal edges lean), as CSS's `skewY()`.
 * @property {readonly [Length, Length]=} translate A move [x, y] (px, or a percent of its own size), as CSS's `translate`.
 * @property {readonly [Length, Length]=} transformOrigin What it scales and rotates about [x, y] (px, or a percent of its size; the center by default).
 * @property {string=} cursor The pointer's cursor over the item, a CSS cursor name ('pointer', 'text', 'grab', 'ns-resize', …).
 * @property {boolean | 'inner' | 'outer'=} ring Its keyboard focus ring: drawn on itself by default; `false` hands it on, to the items inside it marked `'outer'` (a check's box inside its pressable row) or, with none, to the nearest item around it marked `'inner'` (a field's box around its entry), each drawing it along its own corners.
 * @property {'auto' | 'thin' | 'none'=} scrollbarWidth A Scroll's bars, as CSS's scrollbar-width: 'auto' the theme's bar (default), 'thin' half as wide, 'none' no bar and no room kept for one (it still scrolls). Not inherited.
 * @property {readonly [number | string, number | string] | 'auto'=} scrollbarColor A Scroll's bars' colors, [thumb, track], as CSS's scrollbar-color; inherited, as CSS's ('auto': the theme's muted thumb on its soft track).
 * @property {StyleInput=} hover The style while the pointer is over the item.
 * @property {StyleInput=} press The style while the item is pressed.
 * @property {StyleInput=} focus The style while the item has keyboard focus.
 */

/**
 * A touch-action value: 'auto', 'none', 'manipulation', or pans and a pinch
 * zoom combined, in CSS's order.
 * @typedef {'auto' | 'none' | 'manipulation' | 'pan-x' | 'pan-y' | 'pinch-zoom' | 'pan-x pan-y' | 'pan-x pinch-zoom' | 'pan-y pinch-zoom' | 'pan-x pan-y pinch-zoom'} TouchAction
 */

/**
 * A touch-action value as bits (1 a pan along x, 2 along y, 4 a pinch
 * zoom; 'auto' and 'manipulation' all three, 'none' 0), or -1 when it is
 * not one.
 * @param {unknown} value
 */
function touchAction(value) {
  if (typeof value !== 'string') return -1;
  const words = value.trim().split(/\s+/);
  if (words.length === 1 && (words[0] === 'auto' || words[0] === 'manipulation')) return 7;
  if (words.length === 1 && words[0] === 'none') return 0;
  let bits = 0;
  for (const w of words) {
    const bit = w === 'pan-x' ? 1 : w === 'pan-y' ? 2 : w === 'pinch-zoom' ? 4 : 0;
    if (bit === 0 || (bits & bit) !== 0) return -1;
    bits |= bit;
  }
  return bits;
}

/** Enumerations: a string's index, -1 unset. */
const DIRECTIONS = ['column', 'row'];
const ALIGNS = ['start', 'center', 'end', 'stretch'];
const JUSTIFIES = ['start', 'center', 'end', 'between', 'around', 'evenly'];
const OVERFLOWS = ['visible', 'hidden'];
const TEXT_ALIGNS = ['start', 'center', 'end'];
const SELECTS = ['none', 'text'];
const POINTER_EVENTS = ['none', 'auto'];
const FITS = ['fill', 'contain', 'cover', 'none'];
const POSITIONS = ['relative', 'absolute', 'sticky', 'fixed'];
const BORDER_STYLES = ['solid', 'dashed', 'dotted'];
const TEXT_TRANSFORMS = ['none', 'uppercase', 'lowercase', 'capitalize'];
const DISPLAYS = ['flex', 'grid', 'contents'];
const SCROLLBARS = ['auto', 'thin', 'none'];

/** The names of the vocabulary, for development diagnostics. */
export const PORTABLE = new Set([
  'display', 'columnGap', 'rowGap', 'columns', 'rows', 'column', 'row', 'direction', 'wrap', 'gap', 'padding', 'margin', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'aspectRatio',
  'position', 'top', 'right', 'bottom', 'left', 'inset', 'zIndex', 'grow', 'shrink', 'align', 'self', 'justify', 'overflow', 'background', 'color', 'opacity', 'border', 'borderColor',
  'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'borderStyle',
  'placeholderColor', 'radius', 'shadow', 'fontSize', 'fontWeight', 'fontFamily', 'italic', 'textAlign', 'lineHeight', 'underline', 'strike', 'select', 'textTransform', 'touchAction', 'pointerEvents', 'objectFit', 'cursor', 'ring', 'hover', 'press', 'focus',
  'scrollbarWidth', 'scrollbarColor', 'scale', 'rotate', 'skewX', 'skewY', 'translate', 'transformOrigin',
]);

/**
 * A normalized style. Every field exists on every record (one shape): an
 * unset number is NaN, an unset enumeration or flag -1, an unset color
 * null. Enumerations are indexes: direction (column, row), align and self
 * (start, center, end, stretch), justify (start, center, end, between,
 * around, evenly), overflow (visible, hidden), textAlign (start, center,
 * end), select (none, text), position (relative, absolute, sticky, fixed). Sides are top,
 * right, bottom, left. A size or an inset is a number (px) or a percent
 * string as CSS writes it ('50%').
 */
export class Style {
  constructor() {
    /** 0 flex, 1 grid, 2 contents (no box), -1 unset. */
    this.display = -1;
    this.columnGap = NaN;
    this.rowGap = NaN;
    /** Grid tracks and lines as given, CSS syntax (arrays joined). @type {string | null} */
    this.columns = null;
    /** @type {string | null} */
    this.rows = null;
    /** @type {string | null} */
    this.column = null;
    /** @type {string | null} */
    this.row = null;
    this.direction = -1;
    this.wrap = -1;
    this.gap = NaN;
    this.paddingTop = NaN;
    this.paddingRight = NaN;
    this.paddingBottom = NaN;
    this.paddingLeft = NaN;
    this.marginTop = NaN;
    this.marginRight = NaN;
    this.marginBottom = NaN;
    this.marginLeft = NaN;
    /** @type {number | string} */
    this.width = NaN;
    /** @type {number | string} */
    this.height = NaN;
    /** @type {number | string} */
    this.minWidth = NaN;
    /** @type {number | string} */
    this.maxWidth = NaN;
    /** @type {number | string} */
    this.minHeight = NaN;
    /** @type {number | string} */
    this.maxHeight = NaN;
    /** Width over height; NaN unset. */
    this.aspectRatio = NaN;
    /** 0 relative, 1 absolute, 2 sticky, 3 fixed, -1 unset (the normal flow). */
    this.position = -1;
    /** @type {number | string} */
    this.top = NaN;
    /** @type {number | string} */
    this.right = NaN;
    /** @type {number | string} */
    this.bottom = NaN;
    /** @type {number | string} */
    this.left = NaN;
    /** An integer; NaN unset (auto). */
    this.zIndex = NaN;
    this.grow = NaN;
    this.shrink = NaN;
    this.align = -1;
    this.self = -1;
    this.justify = -1;
    this.overflow = -1;
    /** A color, or a gradient. @type {number | Gradient | null} */
    this.background = null;
    /** @type {number | null} */
    this.color = null;
    this.opacity = NaN;
    /** Each side's border width. */
    this.borderTop = NaN;
    this.borderRight = NaN;
    this.borderBottom = NaN;
    this.borderLeft = NaN;
    /** @type {number | null} */
    this.borderTopColor = null;
    /** @type {number | null} */
    this.borderRightColor = null;
    /** @type {number | null} */
    this.borderBottomColor = null;
    /** @type {number | null} */
    this.borderLeftColor = null;
    /** 0 solid, 1 dashed, 2 dotted; -1 unset. */
    this.borderStyle = -1;
    /** @type {number | null} */
    this.placeholderColor = null;
    /** The corner radii, as CSS's border-radius: top-left, top-right, bottom-right, bottom-left. */
    this.radiusTopLeft = NaN;
    this.radiusTopRight = NaN;
    this.radiusBottomRight = NaN;
    this.radiusBottomLeft = NaN;
    this.shadowX = NaN;
    this.shadowY = NaN;
    this.shadowBlur = NaN;
    /** @type {number | null} */
    this.shadowColor = null;
    this.fontSize = NaN;
    /** 100 to 900, in hundreds; -1 unset. */
    this.fontWeight = -1;
    this.italic = -1;
    /** A CSS font family list; null unset (inherited). @type {string | null} */
    this.fontFamily = null;
    this.textAlign = -1;
    this.lineHeight = NaN;
    this.underline = -1;
    this.strike = -1;
    this.select = -1;
    /** 0 none, 1 uppercase, 2 lowercase, 3 capitalize; -1 unset (inherited). */
    this.textTransform = -1;
    /** The pans and zoom a touch leaves to the browser, as bits (1 pan-x, 2 pan-y, 4 pinch-zoom; 7 auto, 0 none); -1 unset. */
    this.touchAction = -1;
    /** 0 none, 1 auto, -1 unset (inherited). */
    this.pointerEvents = -1;
    /** An Image's fit: 0 fill, 1 contain, 2 cover, 3 none; -1 unset. */
    this.objectFit = -1;
    /** A CSS cursor name; null unset. @type {string | null} */
    this.cursor = null;
    /** Its focus ring: 0 handed on (false), 1 its own (true), 2 inner (an inner item's), 3 outer (the focused item's around it); -1 unset (its own). */
    this.ring = -1;
    /** A Scroll's bars: 0 auto, 1 thin, 2 none; -1 unset. */
    this.scrollbarWidth = -1;
    /** Its bars' thumb and track colors (ARGB); null unset (inherited). @type {number | null} */
    this.scrollbarThumb = null;
    /** @type {number | null} */
    this.scrollbarTrack = null;
    /** The transform (none while unset): scale per axis, rotation and skews in degrees, a move and the origin (px or percent strings). */
    this.scaleX = NaN;
    this.scaleY = NaN;
    this.rotate = NaN;
    /** Degrees of slant along x and along y (CSS's skew), applied after the scale. */
    this.skewX = NaN;
    this.skewY = NaN;
    /** @type {number | string} */
    this.translateX = NaN;
    /** @type {number | string} */
    this.translateY = NaN;
    /** @type {number | string} */
    this.originX = NaN;
    /** @type {number | string} */
    this.originY = NaN;
    /** @type {Style | null} */
    this.hover = null;
    /** @type {Style | null} */
    this.press = null;
    /** @type {Style | null} */
    this.focus = null;
    /** Names outside the vocabulary, as given (ren-dom writes them as CSS). @type {Record<string, unknown> | null} */
    this.other = null;
  }
}

/** The index of `value` in `names`, or -1. @param {readonly string[]} names @param {unknown} value */
const pick = (names, value) => (typeof value === 'string' ? names.indexOf(value) : -1);
/** A finite number, or NaN. @param {unknown} value */
const length = value => (typeof value === 'number' && Number.isFinite(value) ? value : NaN);
/** A length or a percent string ('50%', '-12.5%'), else NaN. @param {unknown} value @returns {number | string} */
const extent = value => {
  if (typeof value !== 'string') return length(value);
  const v = value.trim();
  return /^[-+]?(\d+\.?\d*|\.\d+)%$/.test(v) ? `${Number(v.slice(0, -1))}%` : NaN;
};
/** A flag: 1, 0, or -1 unset. @param {unknown} value */
const flag = value => (value === true ? 1 : value === false ? 0 : -1);

/** A color channel from a hex digit run. @param {string} hex @param {number} at @param {number} size */
const channel = (hex, at, size) => {
  const n = parseInt(hex.slice(at, at + size), 16);
  return size === 1 ? n * 17 : n;
};

/**
 * A portable color as an ARGB number, or null (unset or not portable).
 * @param {unknown} value
 * @returns {number | null}
 */
export function argb(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value >>> 0 : null;
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'transparent') return 0;
  if (v[0] === '#') {
    const hex = v.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    const size = hex.length === 3 || hex.length === 4 ? 1 : hex.length === 6 || hex.length === 8 ? 2 : 0;
    if (size === 0) return null;
    const r = channel(hex, 0, size);
    const g = channel(hex, size, size);
    const b = channel(hex, size * 2, size);
    const a = hex.length === 4 || hex.length === 8 ? channel(hex, size * 3, size) : 255;
    return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
  }
  // Each channel a number: digits with an optional fraction, or a fraction alone (not `.` or `1.2.3`).
  const m = /^rgba?\(\s*(\d+(?:\.\d*)?|\.\d+)\s*,\s*(\d+(?:\.\d*)?|\.\d+)\s*,\s*(\d+(?:\.\d*)?|\.\d+)\s*(?:,\s*(\d+(?:\.\d*)?|\.\d+)\s*)?\)$/.exec(v);
  if (m === null) return null;
  const clamp = (/** @type {string} */ s) => Math.max(0, Math.min(255, Math.round(Number(s))));
  const a = m[4] === undefined ? 255 : Math.max(0, Math.min(255, Math.round(Number(m[4]) * 255)));
  return ((a << 24) | (clamp(m[1]) << 16) | (clamp(m[2]) << 8) | clamp(m[3])) >>> 0;
}

/**
 * Four sides from a number or an array; NaN where unset.
 * @param {unknown} value
 * @returns {[number, number, number, number]}
 */
function sides(value) {
  if (typeof value === 'number') {
    const n = length(value);
    return [n, n, n, n];
  }
  if (Array.isArray(value)) {
    if (value.length === 2) return [length(value[0]), length(value[1]), length(value[0]), length(value[1])];
    if (value.length === 4) return [length(value[0]), length(value[1]), length(value[2]), length(value[3])];
  }
  return [NaN, NaN, NaN, NaN];
}

/**
 * Normalizes a portable style object (null or undefined: all unset).
 * @param {StyleInput | null | undefined} value
 * @returns {Style}
 */
export function styled(value) {
  const s = new Style();
  if (value == null || typeof value !== 'object') return s;
  const v = /** @type {Record<string, any>} */ (value);
  for (const name in v) {
    const x = v[name];
    if (x === undefined) continue;
    switch (name) {
      case 'display':
        s.display = pick(DISPLAYS, x);
        break;
      case 'columnGap':
      case 'rowGap':
        s[name] = length(x);
        break;
      case 'columns':
      case 'rows':
        s[name] = Array.isArray(x) ? x.map(t => (typeof t === 'number' ? `${t}px` : String(t))).join(' ') : String(x);
        break;
      case 'column':
      case 'row':
        s[name] = String(x);
        break;
      case 'direction':
        s.direction = pick(DIRECTIONS, x);
        break;
      case 'wrap':
        s.wrap = flag(x);
        break;
      case 'gap':
        s.gap = length(x);
        break;
      case 'padding': {
        const [t, r, b, l] = sides(x);
        s.paddingTop = t;
        s.paddingRight = r;
        s.paddingBottom = b;
        s.paddingLeft = l;
        break;
      }
      case 'margin': {
        const [t, r, b, l] = sides(x);
        s.marginTop = t;
        s.marginRight = r;
        s.marginBottom = b;
        s.marginLeft = l;
        break;
      }
      case 'width':
      case 'height':
      case 'minWidth':
      case 'maxWidth':
      case 'minHeight':
      case 'maxHeight':
      case 'top':
      case 'right':
      case 'bottom':
      case 'left':
        /** @type {any} */ (s)[name] = extent(x);
        break;
      case 'inset':
        s.top = s.right = s.bottom = s.left = extent(x);
        break;
      case 'position':
        s.position = pick(POSITIONS, x);
        break;
      case 'aspectRatio':
        s.aspectRatio = typeof x === 'number' && x > 0 && Number.isFinite(x) ? x : NaN;
        break;
      case 'zIndex':
        s.zIndex = Number.isInteger(x) ? x : NaN;
        break;
      case 'grow':
      case 'shrink':
      case 'opacity':
      case 'borderTop':
      case 'borderRight':
      case 'borderBottom':
      case 'borderLeft':
      case 'fontSize':
      case 'lineHeight':
        /** @type {any} */ (s)[name] = length(x);
        break;
      case 'border':
        s.borderTop = s.borderRight = s.borderBottom = s.borderLeft = length(x);
        break;
      case 'borderColor':
        s.borderTopColor = s.borderRightColor = s.borderBottomColor = s.borderLeftColor = argb(x);
        break;
      case 'borderStyle':
        s.borderStyle = pick(BORDER_STYLES, x);
        break;
      case 'radius': {
        const [tl, tr, br, bl] = typeof x === 'number' || (Array.isArray(x) && x.length === 4) ? sides(x) : [NaN, NaN, NaN, NaN];
        s.radiusTopLeft = tl;
        s.radiusTopRight = tr;
        s.radiusBottomRight = br;
        s.radiusBottomLeft = bl;
        break;
      }
      case 'align':
        s.align = pick(ALIGNS, x);
        break;
      case 'self':
        s.self = pick(ALIGNS, x);
        break;
      case 'justify':
        s.justify = pick(JUSTIFIES, x);
        break;
      case 'overflow':
        s.overflow = pick(OVERFLOWS, x);
        break;
      case 'background':
        s.background = x !== null && typeof x === 'object' ? gradient(x) : argb(x);
        break;
      case 'color':
      case 'borderTopColor':
      case 'borderRightColor':
      case 'borderBottomColor':
      case 'borderLeftColor':
      case 'placeholderColor':
        /** @type {any} */ (s)[name] = argb(x);
        break;
      case 'shadow':
        if (x !== null && typeof x === 'object') {
          s.shadowX = length(x.x ?? 0);
          s.shadowY = length(x.y ?? 0);
          s.shadowBlur = length(x.blur ?? 0);
          s.shadowColor = argb(x.color ?? 0x40000000);
        }
        break;
      case 'fontWeight':
        s.fontWeight = x === 'bold' ? 700 : x === 'normal' ? 400 : typeof x === 'number' && Number.isFinite(x) ? Math.max(100, Math.min(900, Math.round(x / 100) * 100)) : -1;
        break;
      case 'fontFamily':
        s.fontFamily = typeof x === 'string' && x.trim() !== '' ? x.trim() : null;
        break;
      case 'italic':
        s.italic = flag(x);
        break;
      case 'textAlign':
        s.textAlign = pick(TEXT_ALIGNS, x);
        break;
      case 'strike':
        s.strike = flag(x);
        break;
      case 'underline':
        s.underline = flag(x);
        break;
      case 'objectFit':
        s.objectFit = pick(FITS, x);
        break;
      case 'pointerEvents':
        s.pointerEvents = pick(POINTER_EVENTS, x);
        break;
      case 'select':
        s.select = pick(SELECTS, x);
        break;
      case 'textTransform':
        s.textTransform = pick(TEXT_TRANSFORMS, x);
        break;
      case 'touchAction':
        s.touchAction = touchAction(x);
        break;
      case 'scale':
        if (Array.isArray(x) && x.length === 2) {
          s.scaleX = length(x[0]);
          s.scaleY = length(x[1]);
        } else s.scaleX = s.scaleY = length(x);
        break;
      case 'rotate':
      case 'skewX':
      case 'skewY':
        s[name] = length(x);
        break;
      case 'translate':
      case 'transformOrigin': {
        const [a, b] = Array.isArray(x) && x.length === 2 ? [extent(x[0]), extent(x[1])] : [NaN, NaN];
        if (name === 'translate') {
          s.translateX = a;
          s.translateY = b;
        } else {
          s.originX = a;
          s.originY = b;
        }
        break;
      }
      case 'cursor':
        s.cursor = typeof x === 'string' && x !== '' ? x : null;
        break;
      case 'ring':
        s.ring = x === false ? 0 : x === true ? 1 : x === 'inner' ? 2 : x === 'outer' ? 3 : -1;
        break;
      case 'scrollbarWidth':
        s.scrollbarWidth = pick(SCROLLBARS, x);
        break;
      case 'scrollbarColor': {
        // Both colors or neither, as CSS's (a pair it cannot read is unset).
        const thumb = Array.isArray(x) && x.length === 2 ? argb(x[0]) : null;
        const track = thumb === null ? null : argb(x[1]);
        s.scrollbarThumb = track === null ? null : thumb;
        s.scrollbarTrack = track;
        break;
      }
      case 'hover':
      case 'press':
      case 'focus':
        s[name] = x !== null && typeof x === 'object' ? styled(x) : null;
        break;
      default:
        if (s.other === null) s.other = {};
        s.other[name] = x;
    }
  }
  return s;
}

/**
 * `base` with every field `over` sets in place of its own: the style of an
 * item in a state (hover, press, focus). Writes into `into` (a fresh record
 * by default) and returns it; the states of the result are `base`'s.
 * @param {Style} base @param {Style | null} over @param {Style} [into]
 * @returns {Style}
 */
export function overlay(base, over, into = new Style()) {
  const b = /** @type {Record<string, any>} */ (/** @type {unknown} */ (base));
  const o = /** @type {Record<string, any> | null} */ (/** @type {unknown} */ (over));
  const r = /** @type {Record<string, any>} */ (/** @type {unknown} */ (into));
  const unset = /** @type {Record<string, any>} */ (/** @type {unknown} */ ((UNSET ??= new Style())));
  for (const key in b) {
    const own = b[key];
    if (o === null || key === 'hover' || key === 'press' || key === 'focus' || key === 'other') {
      r[key] = own;
      continue;
    }
    // Unset is the field's own default (NaN for a length, -1 for a keyword), never a value such as a -1 px shift.
    const next = o[key];
    r[key] = next === null || Object.is(next, unset[key]) ? own : next;
  }
  return into;
}

/** A style with nothing set: each field's unset value, for overlay. @type {Style | null} */
let UNSET = null;
