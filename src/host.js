// ren-core/host: what a renderer package builds on. A renderer is a Host (the
// contract in core.js): ren-dom, ren-canv, ren-skia, ren-three and ren-json each implement one,
// and `mount` renders a view into it. `skeleton` builds a compiled
// template's nodes through the Host calls (for a host that clones, its
// shared template); `Theme` and `COLORS` are the tokens every renderer
// resolves, and `styled` normalizes the portable style every renderer
// draws. An application imports `ren-core` and a renderer package, not this.

export { mount, skeleton, Plan, $surface, $active } from './core.js';
export { Theme, COLORS, UNITLESS } from './theme.js';
export { Style, styled, overlay, argb, PORTABLE } from './style.js';
// What Tab reaches inside a DOM element (ren-dom's focus trap cycles among them).
export { focusables } from './focus.js';
/** @typedef {import('./style.js').Gradient} Gradient */
// Development mode's switch and report, for a renderer's own diagnostics.
export { development, diagnose } from 'rrx-core/core';

/** @typedef {import('./core.js').Host} Host */
/** @typedef {import('./core.js').Options} Options */
/** @typedef {import('./theme.js').Tokens} Tokens */
/** @typedef {import('./style.js').StyleInput} StyleInput */
