// Theme tokens for every renderer: the colors and metrics of the ren-core theme,
// resolved once into a fixed record so layout and drawing never look tokens
// up per node.

/**
 * Theme overrides: any subset of the theme's colors (ARGB) and metrics.
 * @typedef {Partial<Theme>} Tokens
 */

export class Theme {
  /** @param {Tokens} [tokens] */
  constructor(tokens = {}) {
    this.paper = 0xffffffff;
    this.ink = 0xff263e34;
    this.muted = 0xff637460;
    this.soft = 0xffe6ebdd;
    this.accent = 0xff325842;
    this.danger = 0xff9c3027;
    this.canvas = 0xfff5f5ef;
    this.rule = 0xffdce4d7;
    this.label = 0xff4b5367;
    this.border = 0xffcbd4c3;
    this.raised = 0xfff1fcef;
    this.selection = 0xffaae4f5;
    this.caret = 0xff1e4191;
    // Text: the default font size (px) and line height (a multiple of it).
    this.text = 17;
    this.leading = 1.4;
    /** The width an Edit takes when nothing sets one (in a row, or not stretched). */
    this.entry = 200;
    // Primitive metrics, in logical pixels.
    this.line = 34;
    this.edit = 74;
    this.action = 50;
    this.field = 38;
    this.inset = 10;
    this.margin = 24;
    this.top = 20;
    this.tail = 40;
    this.media = 120;
    this.region = 240;
    this.radius = 6;
    /** The width of scrollbars. */
    this.bar = 8;
    const self = /** @type {Record<string, number>} */ (/** @type {unknown} */ (this));
    for (const key in tokens) {
      const value = /** @type {Record<string, unknown>} */ (tokens)[key];
      // Every token is an own field, set above: an inherited name is none.
      if (!Object.hasOwn(this, key)) throw new Error(`REN: unknown theme token ${key}`);
      if (typeof value !== 'number') throw new Error(`REN: theme token ${key} must be a number`);
      self[key] = value;
    }
  }
}

/** The color tokens (ARGB); every other token is a metric in logical pixels. */
export const COLORS = new Set(['paper', 'ink', 'muted', 'soft', 'accent', 'danger', 'canvas', 'rule', 'label', 'border', 'raised', 'selection', 'caret']);

/** The tokens without a unit (a line height is a multiple of the font size); every other non-color token is in logical pixels. */
export const UNITLESS = new Set(['leading']);
