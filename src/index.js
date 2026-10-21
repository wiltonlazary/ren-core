// ren-core: the renderer-neutral component layer. Renderers are packages of
// their own: ren-dom (`$dom`, `$shadow`), ren-skia (`$skia`), ren-three
// (`$three`) and ren-json (`$tree`); each implements the Host contract of
// `ren-core/host`.
//
// It re-exports rrx-core, so an application imports one module: the concepts are
// rrx-core's (roots, contexts, scopes), and ren-core extends them rather than
// wrapping them under new names. `$root(id)` is rrx-core's graph; ren-core's
// `Root('id')` returns exactly that graph, and `Root(options)`/`<Root>` extend
// it. `For by="position"` is the positional list (rrx-core's `$positions`
// operation stays available).
export * from 'rrx-core';
export {
  jsx, jsxs, Fragment, Lazy, $active, $surface, $keys, $scrolls, $presses, $moves, $resizes, $parts, read,
  Show, When, Choose, For, Times, Render, Portal, Pending, Recover, Sequence,
  View, Layout, Scroll, Label, Edit, Action, Image, Shape,
} from './core.js';
export { Root, $roots } from './root.js';
export { Id, Storage, Locks, Runtime, Props, Send, $name, Shelf, Locker, Memory } from './context.js';
export { $settle } from './settle.js';
export { $focus } from './focus.js';
export { editOf, textAt, selectText, selectedText } from './text.js';
export { $viewport, $media } from './viewport.js';
