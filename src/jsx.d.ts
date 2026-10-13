// JSX types for `jsxImportSource: "ren-core"`. Handwritten: a JavaScript module
// cannot declare a namespace, so scripts/types.mjs copies this file next to
// the generated declarations and re-exports `JSX` from the runtimes.

import type { Readable } from 'rrx-core/core';

/** A value, an accessor of it, or a reactive node holding it. */
export type Reactive<T> = T | (() => T) | Readable<T>;

/** Anything a component or element may render. */
export type Child = unknown;

/**
 * A pointer event on a primitive, with the DOM's field names: on the DOM the
 * browser's own event, on the canvases ren-canv's `Pointer`. `x` and `y` are
 * in the surface's space (the viewport on the DOM, the canvas's logical
 * pixels on a canvas) and cross to a worker; `offsetX` and `offsetY` are
 * from the target (not in a worker).
 */
export type PointerLike = {
  type: string;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  button: number;
  buttons: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  deltaX: number;
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages. */
  deltaMode: number;
  pointerId: number;
  target: unknown;
  currentTarget: unknown;
  preventDefault(): void;
  stopPropagation(): void;
};

/**
 * A drag over a primitive: where it is (`x`, `y`: the viewport's on the
 * DOM, the surface's on a canvas), and what it carries as far as a drag
 * tells before the drop: `files`, how many files, and `types`, their MIME
 * types ('' where the platform does not say).
 */
export type DragLike = {
  type: 'dragenter' | 'dragover' | 'dragleave';
  x: number;
  y: number;
  files: number;
  types: readonly string[];
  target: unknown;
  currentTarget: unknown;
  stopPropagation(): void;
};

/**
 * A focus that bubbles (focusin, focusout), as the DOM's FocusEvent:
 * `relatedTarget` is the item on the other side of the move (null: none;
 * in a worker, not carried).
 */
export type FocusLike = {
  type: 'focusin' | 'focusout';
  relatedTarget: unknown;
  target: unknown;
  currentTarget: unknown;
  stopPropagation(): void;
};

/** Portable events of the ren-core primitives. */
export type Events = {
  onPointerDown?: (event: PointerLike) => void;
  onPointerMove?: (event: PointerLike) => void;
  onPointerUp?: (event: PointerLike) => void;
  /** The browser took the pressed pointer back (a touch it pans or zooms with, as `touchAction` lets it; a native drag; the system): the press ends with no `pointerup`, at the item that held it (captured) or was pressed, bubbling. Its point is not reliable (the DOM's is the browser's; a canvas gives where the pointer last was). */
  onPointerCancel?: (event: PointerLike) => void;
  onWheel?: (event: PointerLike) => void;
  onPointerEnter?: (event: PointerLike) => void;
  onPointerLeave?: (event: PointerLike) => void;
  onScroll?: (event: { type: 'scroll'; target: unknown; currentTarget: unknown }) => void;
  onPress?: (event: unknown) => void;
  onChange?: (event: { value: string; event?: unknown }) => void;
  onSubmit?: (event: { value: string; event?: unknown }) => void;
  onKey?: (event: { key: string }) => void;
  onFocus?: (event: unknown) => void;
  onBlur?: (event: unknown) => void;
  /** Focus moved into it or a child (the DOM's focusin, after the new item's focus): it bubbles from the item focused; `relatedTarget` is the item that lost it (null: none). */
  onFocusIn?: (event: FocusLike) => void;
  /** Focus left it or a child (the DOM's focusout, after the old item's blur): it bubbles from the item that lost it; `relatedTarget` is the item that takes it (null: none). */
  onFocusOut?: (event: FocusLike) => void;
  /** A drag entered it or a child (the DOM's dragenter; a canvas's, hit-tested to its items): it bubbles from the item under the pointer; not in a worker. */
  onDragEnter?: (event: DragLike) => void;
  /** A drag moves over it (the DOM's dragover, repeated while it stays): it bubbles; not in a worker. */
  onDragOver?: (event: DragLike) => void;
  /** A drag left it or a child (the DOM's dragleave, after the next item's dragenter): it bubbles; not in a worker. */
  onDragLeave?: (event: DragLike) => void;
  /** Files dropped on it (the DOM's drop, a canvas's): it bubbles from the item under the pointer; not in a worker. */
  onDrop?: (event: { type: 'drop'; files: readonly any[]; x: number; y: number; target: unknown; currentTarget: unknown; stopPropagation(): void }) => void;
  /** Its border box changed size (and once when first laid out), as a ResizeObserver reports it. */
  onResize?: (event: { type: 'resize'; width: number; height: number; target: unknown; currentTarget: unknown }) => void;
};

/** A color: an ARGB number, or '#rgb', '#rgba', '#rrggbb', '#rrggbbaa', 'rgb(…)', 'rgba(…)' or 'transparent'. */
export type Color = number | string;

/**
 * A gradient: `linear` an angle in degrees as CSS's linear-gradient (0 to
 * the top, 90 to the right), or `radial: true`, a circle from the center to
 * the farthest corner; `stops` are [offset from 0 to 1, color] pairs.
 */
export type Gradient = { linear: number; radial?: false; stops: readonly (readonly [number, Color])[] } | { radial: true; linear?: undefined; stops: readonly (readonly [number, Color])[] };

/**
 * One record of a Shape's `shapes`: `kind` 'line', 'rect', 'round', 'oval'
 * or 'path', in the Shape's content box (see the README). `fill` fills a
 * rect, round, oval or closed path with a color or a gradient (as a
 * background takes, over the figure's bounds) in place of its `color`.
 */
export type Figure = {
  kind?: string;
  /** A color or a gradient over the figure's bounds, in place of `color` for a filled figure. */
  fill?: Color | Gradient | null;
  /** A line's thickness (1 by default); above 0, it outlines a rect, round, oval or closed path instead of filling it. */
  stroke?: number;
  [key: string]: unknown;
};

/** A length: a number (px) or a percent string ('50%'). */
export type Length = number | `${number}%`;

/** Four sides: all, [vertical, horizontal] or [top, right, bottom, left]. */
export type Sides = number | readonly [number, number] | readonly [number, number, number, number];

/** A touch-action: 'auto' (every pan and zoom), 'none', 'manipulation' (pans and pinch zoom), or pans and a pinch zoom combined. */
export type TouchAction = 'auto' | 'none' | 'manipulation' | 'pan-x' | 'pan-y' | 'pinch-zoom' | 'pan-x pan-y' | 'pan-x pinch-zoom' | 'pan-y pinch-zoom' | 'pan-x pan-y pinch-zoom';

/** The portable style of a primitive, drawn the same by every renderer (see ren-core's style.js for the box model). */
export type Style = {
  /** 'contents' (a View, Layout or Scroll; a leaf ignores it): no box; its children lay out as its parent's (a row with `role="row"` whose cells sit in the table's grid), its own box style is dropped, and text style and events still pass through it. */
  display?: 'flex' | 'grid' | 'contents';
  columns?: string | readonly (string | number)[];
  rows?: string | readonly (string | number)[];
  column?: string | number;
  row?: string | number;
  columnGap?: number;
  rowGap?: number;
  direction?: 'column' | 'row';
  wrap?: boolean;
  gap?: number;
  padding?: Sides;
  margin?: Sides;
  width?: Length;
  height?: Length;
  minWidth?: Length;
  maxWidth?: Length;
  minHeight?: Length;
  maxHeight?: Length;
  /** Width over height, as CSS's aspect-ratio: the size not set follows the one that is. */
  aspectRatio?: number;
  /** 'absolute' takes the item out of the flow, placed by its insets against its parent's padding box; 'relative' moves it by them; 'sticky' stays in the flow and is held in its nearest Scroll's view by its `top`, `right`, `bottom` and `left`, within its parent; 'fixed' is placed by its insets against the viewport. */
  position?: 'relative' | 'absolute' | 'sticky' | 'fixed';
  top?: Length;
  right?: Length;
  bottom?: Length;
  left?: Length;
  /** All four insets. */
  inset?: Length;
  /** An integer: a stacking context, painted (and hit) in this order within the enclosing one. */
  zIndex?: number;
  grow?: number;
  shrink?: number;
  align?: 'start' | 'center' | 'end' | 'stretch';
  self?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';
  overflow?: 'visible' | 'hidden';
  /** A color, or a gradient. */
  background?: Color | Gradient;
  color?: Color;
  opacity?: number;
  /** A border width, all four sides; a side's own width (`borderTop`, …) given after it overrides that side. */
  border?: number;
  borderTop?: number;
  borderRight?: number;
  borderBottom?: number;
  borderLeft?: number;
  /** All four sides' color; `borderTopColor`, … set one side's. */
  borderColor?: Color;
  borderTopColor?: Color;
  borderRightColor?: Color;
  borderBottomColor?: Color;
  borderLeftColor?: Color;
  /** 'solid' by default. */
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  /** The color of an Edit's placeholder (its `label` while empty); inherits, as text does. */
  placeholderColor?: Color;
  /** A corner radius: one for all four, or [top-left, top-right, bottom-right, bottom-left], as CSS's border-radius. */
  radius?: number | readonly [number, number, number, number];
  shadow?: { x?: number; y?: number; blur?: number; color?: Color } | null;
  fontSize?: number;
  /** 100 to 900 in hundreds ('normal' 400, 'bold' 700); a renderer draws the nearest face it has. */
  fontWeight?: 'normal' | 'bold' | number;
  /** A CSS font family list; the drawn renderers draw 'monospace' in their monospace face when given one, anything else in their typeface. Inherits. */
  fontFamily?: string;
  italic?: boolean;
  textAlign?: 'start' | 'center' | 'end';
  lineHeight?: number;
  underline?: boolean;
  /** A line through the text (CSS line-through); it reaches the text below. */
  strike?: boolean;
  select?: 'text' | 'none';
  /** The pans and zoom a touch pressed on it (or under it) leaves to the browser, as CSS's touch-action; the item's and each ancestor's that sets one allow it together. Set nowhere on the path: the renderer's default (a canvas keeps the page from panning under a touch its items took). */
  touchAction?: TouchAction;
  /** How text shows, as CSS's text-transform: inherited, but an Action and an Edit take only their own (a browser's form controls), and an Edit shows its value as typed. The text given stays the data (ren-json); a selection copies what shows, as Chrome does. */
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  /** 'none': no target of the pointer (presses, hover, pointer events, wheel and selection reach what is under it), as CSS's pointer-events; inherits, and 'auto' on a child takes the pointer again. */
  pointerEvents?: 'auto' | 'none';
  /** How an Image fits its box, as CSS's object-fit: 'fill' (default, stretched), 'contain', 'cover' or 'none'. */
  objectFit?: 'fill' | 'contain' | 'cover' | 'none';
  /** A scale, both axes or [x, y]; with `rotate` and `translate`, painted and hit but not laid out, as CSS's transforms. */
  scale?: number | readonly [number, number];
  /** Degrees clockwise. */
  rotate?: number;
  /** Degrees of slant along x (vertical edges lean), as CSS's skewX(); after the scale. */
  skewX?: number;
  /** Degrees of slant along y (horizontal edges lean), as CSS's skewY(). */
  skewY?: number;
  /** A move [x, y]: px, or a percent of its own size. */
  translate?: readonly [Length, Length];
  /** What it scales and rotates about [x, y] (px or percents of its size); the center by default. */
  transformOrigin?: readonly [Length, Length];
  /** The pointer's cursor over the item, a CSS cursor name. */
  cursor?: string;
  /** A Scroll's bars, as CSS's scrollbar-width: 'auto' the theme's bar (default), 'thin' half as wide, 'none' no bar and no room kept for one (it still scrolls). Not inherited. */
  scrollbarWidth?: 'auto' | 'thin' | 'none';
  /** A Scroll's bars' colors, [thumb, track], as CSS's scrollbar-color; inherited ('auto': the theme's). */
  scrollbarColor?: readonly [Color, Color] | 'auto';
  hover?: Style;
  press?: Style;
  focus?: Style;
};

/**
 * The style of a run of a Label's text: the text part of the vocabulary. Each
 * field it leaves out is the Label's (inherited, as a span's in CSS).
 */
export type RunStyle = {
  color?: Color;
  /** A color behind the run's text (a mark, a highlight): its font's ascent and descent high, as a span's background. */
  background?: Color;
  fontWeight?: 'normal' | 'bold' | number;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** A CSS font family list; the canvases draw one naming 'monospace' in their monospace face. */
  fontFamily?: string;
  fontSize?: number;
};

/**
 * A run of a Label's text in a style of its own (a highlighted word, a code
 * token, a link in a sentence). The Label's text is its runs' texts joined:
 * wrapping, clamping, selection, copy and `offsetAt` read that plain text.
 */
export type Run = {
  text: string;
  style?: RunStyle | null;
  /** A press on the run (a Link in text), before the Label's own `onPress`; direct mode only (a function does not cross to a worker). */
  onPress?: (event: unknown) => void;
};

/**
 * The style of a run of an Edit's text: its paint (color, background,
 * decorations) and its face (weight, italic). Size and family stay the
 * Edit's: a field sets its text in one font on one line height, where its
 * caret, selection and the platform's IME sit.
 */
export type EditRunStyle = Omit<RunStyle, 'fontSize' | 'fontFamily'>;

/**
 * A run of an Edit's text in a style of its own (a code token, a search
 * match). The runs style the value only while their texts joined are the
 * value shown; the value stays plain text.
 */
export type EditRun = {
  text: string;
  style?: EditRunStyle | null;
};

/**
 * What a primitive means, apart from how it looks, for readers of the view's
 * data (ren-json, assistive technology, crawlers): an ARIA role with its
 * states as `aria-*` props (`aria-level`, `aria-checked`), and microdata
 * naming the values an item holds. No renderer paints them; the DOM writes
 * them as attributes.
 */
export type Meaning = {
  /** An ARIA role (`heading`, `paragraph`, `list`, `listitem`, `link`, `table`, `row`, `cell`, `button`, `img`, `navigation`…); `presentation` or `none` for a wrapper that means nothing. */
  role?: Reactive<string>;
  /** Where it links, with the role `link`. */
  href?: Reactive<string>;
  /** Starts an item (microdata): the `itemprop`s inside it are its fields. */
  itemscope?: Reactive<boolean>;
  /** The item's type, a schema.org name or URL (`Product`, `Person`). */
  itemtype?: Reactive<string>;
  /** The field of the enclosing item whose value it holds (`name`, `price`, `url`). */
  itemprop?: Reactive<string>;
  /** Ids (space separated) of elements outside the item whose `itemprop`s are its fields too (they still show where they are). */
  itemref?: Reactive<string>;
  /** The id `itemref`, `aria-labelledby` and a label's `for` name it by; the DOM writes it. */
  id?: Reactive<string>;
  /** The value its `itemprop` holds in place of its text: a price's number, a date's ISO string. */
  content?: Reactive<string | number | boolean>;
  /** A machine-readable date or time (ISO 8601, as HTML's `datetime`: '2026-09-27', '2026-09-27T10:00Z', 'PT2H'), whatever its text shows ('yesterday'). */
  datetime?: Reactive<string>;
};

/** Properties every ren-core primitive accepts. */
export type Primitive = Events & Meaning & {
  children?: Child;
  ref?: ((node: any) => void) | Readable<any>;
  /** The portable style: the same box, paint and text on every renderer. */
  style?: Reactive<Style | null>;
  gap?: Reactive<number>;
  pad?: Reactive<number>;
  fill?: Reactive<number | string>;
  color?: Reactive<number | string>;
  size?: Reactive<number>;
  height?: Reactive<number>;
  width?: Reactive<number>;
  min?: Reactive<number>;
  hidden?: Reactive<boolean>;
  /** A region that takes no part in input, as the DOM's `inert`: no focus, no pointer (it goes through to what is under it), no selection, and out of the accessibility tree, on every renderer; ren-json leaves its content out. */
  inert?: Reactive<boolean>;
  /**
   * Its text's base direction and its layout's inline direction, as HTML's `dir`, inherited:
   * 'rtl' sets each row of text as a right-to-left paragraph, aligns `textAlign` 'start' to the right,
   * moves an Edit's caret right to left with the arrow keys, starts a row's main axis and a grid's
   * columns at the right, and puts a Scroll's bar on its left; 'auto' takes the direction of the first
   * strong character of its text (left to right without one). Unset, its parent's.
   */
  dir?: Reactive<'ltr' | 'rtl' | 'auto'>;
  layout?: Reactive<'row' | 'column'>;
  wrap?: Reactive<boolean>;
  /** Default actions the DOM renderer cancels synchronously: ren-core event names, or true for press and submit. */
  prevent?: Reactive<boolean | string | readonly string[]>;
};

/**
 * The place of a View, Layout, Scroll, Action or Edit in the focus, as the
 * DOM's `tabIndex`: set, a View, Layout or Scroll takes the focus (from
 * code, and by a press inside it); -1 keeps it out of the Tab order (a skip
 * link's target, an Action a group moves among with the arrow keys), 0
 * puts it in, in document order, and above 0 orders it first, ascending.
 */
export type Focusable = {
  tabIndex?: Reactive<number>;
};

/** Properties of any other (HTML or SVG) element, for the DOM renderer. */
export type HTMLAttributes = {
  children?: Child;
  ref?: ((node: any) => void) | Readable<any>;
  class?: Reactive<string>;
  style?: Reactive<string | Record<string, unknown> | null>;
  /** Default actions cancelled synchronously: event names, or true for press (click) and submit. */
  prevent?: Reactive<boolean | string | readonly string[]>;
  [name: string]: unknown;
};

export declare namespace JSX {
  /** A lazy element descriptor, built where it is inserted. */
  type Element = import('./core.js').Lazy;
  /** Components may return anything renderable. */
  type ElementType = string | ((props: any) => unknown);
  interface ElementChildrenAttribute {
    children: {};
  }
  interface IntrinsicAttributes {
    key?: unknown;
  }
  interface IntrinsicElements {
    View: Primitive & Focusable & {
      /** Tab and Shift+Tab cycle among the focusables inside it while the focus is inside it (a focus trap). */
      trap?: Reactive<boolean>;
    };
    Layout: Primitive & Focusable & { trap?: Reactive<boolean> };
    Scroll: Primitive & Focusable & {
      trap?: Reactive<boolean>;
      /** The axis it scrolls: 'y' (default), 'x' (a row wider than it) or 'both'. */
      axis?: Reactive<'x' | 'y' | 'both'>;
    };
    Label: Primitive & {
      text?: Reactive<string | number>;
      /** Its text as runs, each in a style of its own; in place of `text` (the text is the runs' texts joined). */
      runs?: Reactive<readonly Run[] | null>;
      /** At most this many wrapped lines; text past them is cut and the last line ends with an ellipsis (…). */
      lines?: Reactive<number>;
      /** One line that ends with an ellipsis (…) where the text does not fit its width. */
      ellipsis?: Reactive<boolean>;
    };
    Edit: Primitive & Focusable & {
      /** Controlled when bound: after a change the view does not adopt, the Edit shows this value again. */
      value?: Reactive<string>;
      /** The placeholder while empty, and the accessible name. */
      label?: Reactive<string>;
      /** More than 1: a multi-line Edit of this many rows (its minimum with `autosize`); read when it is made. */
      lines?: number;
      /** A multi-line Edit grows with its wrapped lines from `lines` rows up to this many (true: no limit). */
      autosize?: Reactive<boolean | number>;
      /** No focus, no editing, dimmed by the theme. */
      disabled?: Reactive<boolean>;
      /** Focusable and selectable, not editable. */
      readOnly?: Reactive<boolean>;
      /** A password: shown as bullets, never copied; the value stays real. */
      secret?: Reactive<boolean>;
      /** Its value shown in styled runs while their texts joined are the value (else plain, until the view gives matching ones); the value stays plain text. Not for a secret Edit. */
      runs?: Reactive<readonly EditRun[] | null>;
      invalid?: Reactive<boolean>;
    };
    Action: Primitive & Focusable & { text?: Reactive<string | number>; label?: Reactive<string>; selected?: Reactive<boolean>; tone?: Reactive<string> };
    Image: Primitive & {
      source?: Reactive<string>;
      label?: Reactive<string>;
      /** Its source failed to load (or decode). */
      onError?: (event: { type: 'error'; target: unknown; currentTarget: unknown }) => void;
    };
    Shape: Primitive & { shapes?: Reactive<readonly Figure[]> };
    [tag: string]: HTMLAttributes;
  }
}
