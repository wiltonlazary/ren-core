# ren-core

A renderer-neutral JSX component layer over [rrx-core](https://github.com/wiltonlazary/rrx-core):
components, control flow, portable primitives, application roots, contexts,
background disposal, a worker runtime (the application in a Worker, the
renderer on the main thread) and a build-time template compiler. Plain
JavaScript with JSDoc types, strict `tsc` checking and generated declarations.

Renderers are packages of their own, each a `Host` (`ren-core/host`), so an
application loads only the ones it uses, and any of them can live together on
one page (one per application root):

| Package | Renderer |
| --- | --- |
| [ren-dom](https://github.com/wiltonlazary/ren-dom) | `$dom` (light DOM) and `$shadow` (a shadow root): fine-grained DOM, event delegation, cloned templates |
| [ren-canv](https://github.com/wiltonlazary/ren-canv) | the drawn renderers' engine: a retained scene of the portable primitives with its own layout, text, paint commands, damage, hit testing, input, editing, native text entry and accessibility mirror; ren-skia and ren-three replay its frames |
| [ren-skia](https://github.com/wiltonlazary/ren-skia) | `$skia`: ren-canv's engine replayed on a CanvasKit canvas |
| [ren-three](https://github.com/wiltonlazary/ren-three) | `$three`: a three.js scene graph, raycast events, on-demand frames and `$animate`, and the portable primitives through ren-canv |
| [ren-html](https://github.com/wiltonlazary/ren-html) | `$html`: a view rendered once to HTML, ren-dom's markup, for servers and static pages |
| [ren-json](https://github.com/wiltonlazary/ren-json) | `$json`: a view rendered once to what it means, as data (nodes by ARIA role, microdata items; the visual hierarchy dissolved) |

The package is published on npm as `@maxenve/ren-core` under the MIT license;
install it under its import name: `npm install ren-core@npm:@maxenve/ren-core`.
Its one runtime dependency is rrx-core. `esbuild` is an optional peer
of `ren-core/esbuild`, `ren-core/loader` and `ren-core/compiled`.

| Entry | Contents |
| --- | --- |
| `ren-core` | rrx-core re-exported, plus the component layer: application roots, JSX, control flow, primitives |
| `ren-core/host` | what a renderer package builds on: the `Host` contract's types, `mount`, `skeleton` (a compiled template built through the Host calls), `$active` and `$surface`, `Theme` and `COLORS` |
| `ren-core/worker`, `ren-core/remote` | worker mode: the worker side (`serve`) and the main-thread side (`connect`, over any Host) |
| `ren-core/jsx-runtime`, `ren-core/jsx-dev-runtime` | the automatic JSX runtime (and the helpers compiled code imports) |
| `ren-core/esbuild` | the JSX compiler: an esbuild plugin that turns intrinsic element trees into templates |
| `ren-core/loader`, `ren-core/compiled` | `node --import` hooks that compile `.jsx` with the automatic runtime, or with ren-core/esbuild: the two JSX passes of every package's tests |

**The rrx-core dependency.** `package.json` links the sibling checkout:
`"rrx-core": "file:../../../rrx-core/wtree/_repo_"` (npm makes `node_modules/rrx-core` a
symlink, so both projects are worked on together). ren-core imports `rrx-core`,
`rrx-core/core` and `rrx-core/context`; the core operations reach applications through
`ren-core`, which re-exports `rrx-core`, or from `rrx-core` directly (the same module).
Install rrx-core first: its `prepare` script generates the declarations that
ren-core's `tsc` checks read. To use a published rrx-core instead, replace the link with
a version (`npm install rrx-core@npm:@maxenve/rrx-core@0.1.10 --save-exact`, or edit the
dependency to `"rrx-core": "npm:@maxenve/rrx-core@0.1.10"` and run `npm install`); nothing else changes, since the
imports use the package name.

## Components and JSX

Configure JSX with the automatic runtime and `jsxImportSource: "ren-core"`:

```jsonc
// tsconfig.json
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "ren-core" } }
```

```sh
esbuild app.jsx --jsx=automatic --jsx-import-source=ren-core --bundle
```

Under the automatic runtime, write `key` before a spread (or leave it
out): after a spread the compiler emits a `createElement` import, which
ren-core does not have. Attributes apply in the order written, so a
spread that carries a `key` sets it over one written before it, compiled
or not; a component receives the key as a prop, and a host element never
sees it.

or, for compiled templates, the library's esbuild plugin (esbuild is an
optional peer dependency):

```js
import { build } from 'esbuild';
import { ren } from 'ren-core/esbuild';

await build({ entryPoints: ['app.jsx'], bundle: true, plugins: [ren()] });
```

The plugin lets esbuild parse the module (JSX, TSX) into classic factory
calls and rewrites every tree of intrinsic (lowercase) elements into a
template: the static structure (tags, text, and literal values the DOM keeps
as attributes: `class`, `style`, `id`, `title`, `role`, `href`, `src`, `alt`,
`for`, `type`, `name`, `lang`, `dir`, `rel`, `target`, `placeholder`, and any
dashed name, when it comes ahead of every dynamic prop of its element, `key`
and `ref` aside; one
after a dynamic prop stays dynamic, so props apply in source order either
way) becomes a plan hoisted once per module; each evaluation only
collects the values of the dynamic parts, in source order. A DOM host clones
its copy of the plan's nodes (`cloneNode(true)`, one copy per document, never
shared across documents or roots) and walks precomputed child paths to the
dynamic parts; other hosts (Skia, the worker) build the same nodes through
their Host calls. Every dynamic part then applies exactly as the runtime
`jsx` path applies it, so the two paths render the same view (`npm test`
runs the JSX suites under both). Two differences remain, both from when a
nested element's props apply: the runtime sets them before it joins its
parent, a template after its clone is in place. A property whose setter
needs the node's place (`outerText`, `outerHTML`) throws on the runtime path
and replaces the node in a template; do not set those as props. And a
property that acts on a group in the same tree, when more than one member
claims it (two radios of one `name` both `checked`, two `details` of one
`name` both `open`), resolves differently: at runtime each member is set
while still apart, so all keep it; in a template the last one set wins. An element with JSX children and
a prop whose effect depends on whether the children are in place yet is left
out of the template, so both paths set the prop first and then append the
children: `textContent`, `innerText`, `innerHTML`; `text` on `a`, `option`,
`title`, `script`; `value`, `defaultValue` on `textarea`, `output`; and
`value` and `selectedIndex` on `select` (they pick among its options). Components, fragments, spreads and
`children` props stay factory calls with `jsx` semantics. `compile(source,
options)` and `transform(code)` expose the same compiler without a build.
Source maps: when the build makes them (esbuild's `sourcemap`), the plugin
emits an inline map from the compiled module back to the JSX source, which
esbuild composes into the bundle's; `compile(source, { sourcemap: true })`
and `transform(code, { map })` (with esbuild's map of `code`) append the
same. The rewrite scans esbuild's output and tells blocks from object
literals, so a `/` after `}` divides after a value and starts a regular
expression after a block.

```jsx
import { $root, $signal, $read, $write } from 'rrx-core';
import { Show, For, View, Label, Action } from 'ren-core';
import { render } from 'ren-dom';

const root = $root('app');
const items = $signal(root, [{ id: 1, title: 'milk' }]);

const App = () => (
  <View gap={8}>
    <Label text={() => `${$read(items).length} items`} />
    <Action text="Add" onPress={() => $write(items, [...$read(items), { id: Date.now(), title: 'new' }])} />
    <Show when={() => $read(items).length > 0} fallback={<i>empty</i>}>
      <ul>
        <For each={items} by={item => item.id}>{item => <li>{() => item().title}</li>}</For>
      </ul>
    </Show>
  </View>
);

const dispose = render(() => <App />, document.getElementById('app'), { root });
```

- Every JSX element is a lazy descriptor, built where it is inserted.
  Intrinsic tags become host nodes, and components run untracked in their own
  scope. A branch that is never shown is never built, and everything is owned
  by the region, boundary and context it renders in.
- A property whose value is a function or an rrx-core node becomes a `$render`
  binding, which writes the renderer's node directly. A dynamic child (a
  function or a node) becomes a region. While its value is text (a string or
  a number) inside an element, the region is one Text node whose `data` it
  writes, with no markers and no scope per run; when a value needs structure
  it adds two markers inside that element and rebuilds its content in a
  fresh scope between them. There is no virtual DOM. A region's or list's
  update is built detached when its source changes and placed in the Render
  phase by its gate (a Render of its own), where a transition can hold it;
  the old content stops when the new one takes its place, so it stays live
  until then. A nested `<Root>` in content being replaced hands its id to
  the new content's.
- `read(value)` reads a prop that may be reactive: it calls an accessor,
  reads an rrx-core node with `$read`, and returns any other value as is.
  Inside a computation (a binding, a memo) the read is tracked.
- Lists (`For`, keyed or by position) reconcile by row identity with the fewest host
  moves: common prefix and suffix stay, swapped
  ends move twice, a window of only new rows is inserted and one of only old
  rows removed at once, and otherwise only the rows off a longest increasing
  subsequence of old positions move. A list that is its element's only child
  owns the element: no marker, and clearing it is one host call
  (`textContent = ''` in the DOM, a Range deletion when siblings remain). A
  row of one node is that node (no range object), and a `For` child that
  takes one parameter gets no index signal. A row is its own scope (one
  record carrying the row's value and signals), and `For` builds rows with
  rrx-core `$rows`: the row's item accessor makes its signal only on its first
  tracked read, so a row that reads its item while it builds (untracked, as
  components do) carries none, and a new item under the same key still
  reaches every tracked reader.
- Bindings cost one rrx-core node and one record, no closures: a property (or a
  text child that is a signal or memo) binds through rrx-core `$bind`, whose read
  and apply are shared functions over the record's fields. Its first value
  applies as the node is built (as a static property does), later ones in the
  Render phase. A dynamic child that is its element's only child fills the
  element (the host's `fill`: `textContent` for a text) instead of a slot node
  in the template.
- `on<Name>` properties (`on` and a capital letter) are event handlers; any
  other name, `on-state` too, is a property, compiled or not. Each one runs as a `$batch`, so it
  flushes once. What a handler throws goes to the boundary around its element
  (the nearest `$catch` of its owner, such as a `Recover`, then the root's),
  and what it wrote before throwing still flushes; only a failure nothing
  handles reaches the host's dispatch. The DOM renderers delegate bubbling events (`click`,
  `input`, `keydown`, `keyup`, pointer, mouse and touch events,
  `focusin`/`focusout`, `beforeinput`, `dblclick`, `contextmenu`): one
  listener per type at each delegation root (the container a view mounts
  into, its shadow root for `$shadow`, a portal's target), the handler kept on
  its node under the host's own key, dispatched along `composedPath()` from
  the target up to that root, with `currentTarget` set to the handler's node
  and `stopPropagation` honoured. A nested root has its own host and keys, so
  it runs only its own handlers. Other events (`focus`, `blur`, `scroll`,
  …) listen on their node. `$dispose` removes the root's listeners; a delegated
  handler goes with its node and runs only while its owner lives; the
  handlers of one row share one runner (owner and context), kept on the node
  beside the handler, so binding a handler allocates nothing. A delegated handler runs after native listeners on its ancestors
  below the root, and an event dispatched on a node outside the root (or
  that does not bubble) does not reach it. `render` turns on `$auto` unless `auto: false` is passed, so
  asynchronous writes flush too.
- Control flow: `Show`, `Choose` with `When` (the first `When` whose
  condition holds, or `fallback`), `For` (keyed: `by` extracts the identity,
  the item itself by default; rows move instead of being rebuilt;
  `by="position"` keeps each position's row, its item accessor following
  the value there and its index a plain number; a row is built as a thunk
  child's content is, so it may write state: a `ref` that writes a signal,
  a component's own signals), `Times` (`count` rows,
  `children(i)` with a plain number; rows added and removed at the end, no
  diffing), `Render` (the component `of` names, chosen at run time),
  `Portal` (into `into` or the host's portal layer), `Pending` (shows its
  fallback until every pending read below it has a first value; later
  reruns keep the content; with `again`, a change of that key shows the
  fallback again), `Sequence` (the order in which the Pendings below it show
  their content: `in-turn` by default, `at-once` or `as-ready`; `nextOnly`
  shows nothing past the first not ready) and `Recover`
  (`fallback(error, reset)`). `ref` takes a function or a signal.
- **Children as rendered.** `$parts(child)`, called in a component, gives
  the parts a child shows now as a reactive list, for a component that
  lays its children out one by one (a separator between two, each in a
  cell): `<For each={$parts(props.children)}>{(part, i) => [() => (i() > 0
  ? <Line /> : null), part]}</For>`. A part is a host node, or several
  kept together, which a row renders as its child (keyed by the part, the
  row keeps it and its place; its accessor, read where it is placed, never
  changes). The child is opened as written: arrays and fragments,
  an accessor or a reactive node (what it holds now, followed through a
  memo of its own), `Show`, `Choose` and `Render` (what they show now:
  nothing when they show nothing), and `For` and `Times` (each row a part,
  or the fallback's parts); nothing, null and booleans give none. Any
  other component, element or text is one part, built once while it stays
  in the child (a component that shows nothing when built is none); a
  part that leaves stops. The parts are built when the list is first read
  (a `For` over it reads it in its element), for the element it is read in:
  the Host's `element` hears that parent, so an `a` or a `title` part of a
  list in an `svg` is made in the SVG namespace. A large `For` among them
  retires as it does in a list of its own: a clear, a replace or a large
  removal closes what its rows hold outside them (portals, nested roots)
  at once. Every renderer, worker mode too: the parts are the host's own
  nodes.
- **Development mode** (rrx-core's `$development`, or the `development`
  export condition): a reactive read in a component body or in a `For`,
  `Times`, `Show` or `When` callback runs once where nothing
  tracks it, so it is reported (read it in JSX, an accessor or a memo; wrap
  a read meant once in `$untrack`).
- **A pending read where nothing tracks it.** A component body, or a
  `For`, `Times`, `Show` or `When` callback, that reads a pending value
  (a task, an async memo) runs again, tracked, in a region of its own:
  it waits there as a reactive read does (the nearest `Pending` shows its
  fallback; a failure reaches its `Recover`), and it runs again once what
  it read changes. What a component body made before the read stops.
- **No tearing (transitions).** A binding, region or list whose
  value is on screen and whose read goes pending (an async memo or task
  with a new input) keeps its value and suspends: rrx-core holds every host
  change of that update until the reads are ready, then applies them
  together, so the screen never mixes the new state with the old. Content
  an update builds that waits, under a `Pending` that shows its content,
  keeps the old content in place (and live) until it is ready; a new
  `Pending` inside it shows its own fallback instead, and without any
  `Pending` new content shows at once with its empty places. Readers of
  `$pending`, `$behind`, `$lastReady` and `$outcome` (and a `Pending`'s own
  fallback switch) are indicators and apply at once; unrelated updates are
  not held, and a failure ends the hold (its `Recover` shows). Reads in
  code see the newest state at once. Pending reads report to their boundary
  when they first wait, so a binding that never waits costs nothing more.
- Portable primitives, identical on every renderer: `View`, `Layout`,
  `Scroll`, `Label`, `Edit`, `Action`, `Image` and `Shape`, with the ren-core view
  protocol's properties (`text`, `value`, `label`, `layout`, `gap`, `pad`,
  `fill`, `color`, `size`, `height`, `width`, `min`, `hidden`, `inert`, `dir`,
  `tabIndex`, `selected`, `wrap`, `lines`, `source`, `shapes`) and events (`onPress`, `onChange`
  receiving `{ value }`, `onSubmit`, `onKey`, `onFocus`, `onBlur`,
  `onFocusIn` and `onFocusOut` (focus moving into or out of the item or a
  child, bubbling after the item's own focus or blur, with `relatedTarget`
  the item on the other side, as the DOM's focusin and focusout), the
  pointer's `onPointerDown`, `onPointerMove`, `onPointerUp`, `onWheel`,
  `onPointerEnter`, `onPointerLeave` and `onPointerCancel` (the browser
  took the pressed pointer back: a touch it pans or zooms with, as
  `touchAction` lets it, a native drag, the system; the press ends there
  with no `pointerup`, the event bubbling from the item that held the
  pointer; ren-dom delivers the DOM's own, a canvas its element's, with
  where the pointer last was), and
  `onResize` with the item's new border box `{ width, height }` once it is
  laid out and whenever its size changes: a ResizeObserver's on the DOM,
  after layout on the canvases, across a worker too), and `onDrop` with the
  `files` dropped on the item (and `x`, `y`), bubbling from the item under
  the pointer, on the main thread (files do not cross to a worker), and
  the drag before it: `onDragEnter`, `onDragOver` and `onDragLeave`
  (`DragLike`: `x`, `y`, `files`, how many files the drag carries, and
  `types`, their MIME types, as far as the platform tells before the drop),
  bubbling as the DOM's (the next item's enter comes before the last one's
  leave; a drop ends the drag without a leave), on the main thread only:
  ren-dom maps the DOM's own, a canvas hit-tests its element's to its
  items. The platform's file dialog is the browser's `<input type="file">`, which a
  component opens itself the same way on every renderer. What a primitive
  means, apart from how it looks, is marked with standard vocabularies:
  an ARIA `role` and its states as `aria-*` (`aria-level`, `aria-checked`),
  `href` for a link, microdata (`itemscope`, `itemtype`, `itemprop`,
  `content`, and `itemref`, the `id`s of elements outside the item whose
  `itemprop`s are its fields too) naming the values an item holds, and `datetime`, a
  machine-readable date or time (ISO 8601, as HTML's) for whatever its text
  shows. No renderer paints them; the
  DOM writes them as attributes, and ren-json reads them to give a view's
  data without its visual hierarchy. The DOM
  renderer also accepts any HTML or SVG tag, with DOM properties, attributes,
  `class`, `style` (a string or an object) and DOM events.
- **Edit.** A bound `value` makes it controlled: after an `onChange`, when that flush applies no new value to the
  binding and the typed text differs from it, the Edit shows its bound
  value again (a rejected keystroke, a filter); a value the view rewrites (a
  mask) shows as written. A static `value` is only the first one. The rule
  lives here, so it holds on every renderer and in worker mode. When the
  view rewrites a focused Edit's value, the caret goes to the end, as the
  DOM puts it; a ref sets it with `setSelectionRange(start, end,
  direction)` and reads `selectionStart`/`selectionEnd` (the DOM's own; a
  canvas item's in ren-canv; not a worker's `Handle`), and `caretRow()`
  gives the drawn row its caret is in and how many rows it draws, `{ row,
  rows }` from 0, as it wraps its value (a one-line Edit's is row 0 of 1;
  the caret where a row wraps is on the next row): an editor moves to the
  line above or below, or leaves the field, from the first or last row
  (ren-dom measures a copy of its field, a canvas item reads its rows;
  not a worker's `Handle`). `disabled`: no
  focus, no editing, dimmed by the theme (its `soft` fill and `muted`
  text). `readOnly`: focusable and selectable, not editable. `secret` (a
  one-line Edit): a password; shown as bullets (one per UTF-16 unit on
  the canvases), the value stays real, copy and cut are refused, and the native text entry
  and the DOM element are password inputs. `lines` above 1 (read when the
  Edit is made) makes it multi-line, that many rows high; `autosize` makes
  a multi-line Edit grow with its wrapped lines from `lines` rows up to
  `autosize` rows (true: no limit). The placeholder (`label`
  while empty) takes the style's `placeholderColor`, else the theme's
  `muted`.
- **Focus order and inert.** `tabIndex` on a View, Layout, Scroll, Action
  or Edit places it in the focus as the DOM's: set, a View, Layout or
  Scroll takes the focus from code (`ref.focus()`) and from a press inside
  it; -1 keeps it out of the Tab order (a skip link's target; an Action a
  group moves among with the arrow keys), 0 puts it in, in document order,
  and above 0 orders it first, ascending. Tab from an item out of the order
  goes on from its place in the document. ren-dom writes `tabindex`; the
  canvases follow it in their Tab order, `focus()` and `focusFirst`. `inert`
  on any primitive makes a region that takes no part in input, as the
  DOM's `inert` attribute: nothing in it takes the focus (one made inert
  while it holds the focus gives it up), the pointer goes through it to
  what is under it, its text is not selected, and it leaves the
  accessibility tree. ren-dom and ren-html write `inert`, the canvases
  skip it for focus, pointer and selection and mark it in their mirror, and
  ren-json leaves its content out, as Chrome's accessibility tree does.
  Both cross a worker as props.
- **Direction.** `dir` on any primitive ('ltr', 'rtl' or 'auto') is HTML's
  `dir`: it is inherited, and 'auto' takes the direction of the first
  strong character of the item's text (its value for an Edit; a
  container's descendants' text, skipping those with a `dir` of their own),
  left to right without one. Right to left, each row of text is a
  right-to-left paragraph, `textAlign` 'start' is the right, an Edit's
  caret moves right to left with the arrow keys, a row's main axis and a
  grid's columns start at the right (`justify`, `align` and `self` start
  there too), and a Scroll keeps its bar on its left and scrolls across
  from the right. Insets and margins stay physical, as CSS's. ren-dom and
  ren-html write the `dir` attribute, the canvases lay out and draw it,
  and it crosses a worker as a prop; ren-json leaves it out (Chrome's
  accessibility tree does not carry it).
- **Focus trap.** `trap` on a View, Layout or Scroll: while the focus is
  inside it, Tab and Shift+Tab cycle among the focusables inside it (the
  last to the first and back), on every renderer; when the focused element
  inside it is removed, the trap, still there, takes the focus back (its
  first focusable, else itself when it has a `tabIndex`); a component (a Modal, a
  FocusTrap) focuses one inside first with `$focus(ref)` (`$focus(ref,
  true)`: the last), which returns whether one took the focus: a canvas
  item's own `focusFirst()`/`focusLast()` (the items Tab reaches inside it,
  in document order), on the DOM the first or last element Tab reaches below
  it, not in an inert region (`focusables(element)` in `ren-core/host`, which ren-dom's trap cycles
  among); a worker's `Handle` has none (false). `ref.getRootNode().activeElement`
  is the focused element on every renderer (the DOM's document or shadow
  root; a canvas item's Document), for giving the focus back.
- **Root-wide keys.** `$keys(handler)`, called in a component (or a
  handler), hears every key pressed anywhere in its application root, not
  only in focused descendants: a launcher's Ctrl+K while nothing inside it
  has focus. The order is the DOM's for a document's keydown listener: the
  focused item and its ancestors first (`onKey`; a `stopPropagation` there
  keeps the key from the root's handlers), then the root's handlers, in the
  order they were added; with nothing focused in the root, the root's
  handlers alone. `preventDefault` in one keeps the key's own action (a
  field's typing; not from a worker). ren-dom listens on the document and
  takes the keys whose target is inside the root's host element (its
  portals by default) or the document's body (nothing focused); a canvas
  routes its Document's keys; in worker mode they cross as events. It
  returns its removal; the owner's cleanup removes it too. The Host hears
  it as `listen(container, 'keys', handler)` on the view's container. The
  event's `editable` is true when the key's target is a text field (an
  Edit; on the DOM an `input`, `textarea`, `select` or contenteditable
  element), across a worker too, so a root-wide shortcut can leave keys
  typed in fields alone.
- **Root-wide scrolls.** `$scrolls(handler)`, called in a component, hears
  every scroll that can move its application root's items, as a document's
  capture-phase scroll listener hears scrolls that do not bubble: a Scroll
  in the root, the page (a canvas Document's own scroll), and on the DOM
  any element around the root's container. The event is `{ type: 'scroll',
  target }`. A popup placed against its target re-measures on it instead
  of every frame. It is removed as `$keys`'s handler is; in worker mode
  scrolls cross as events, merged within a burst. The Host hears it as
  `listen(container, 'scrolls', handler)`.
- **Moves.** `$moves(node, handler)`, called in a component with a
  primitive's node (a ref) of its root's host, hears that node's border box
  change place in its surface, whatever moved it: a scroll, a layout shift
  (the content above it growing), a transform, an animation. The event is
  `{ type: 'move', x, y, target }`, the new place as
  `getBoundingClientRect()` gives it, after each change of `x` or `y` from
  where it was when the listening started (a change of size alone is
  `onResize`'s). Nothing is measured every frame:
  ren-dom watches the box with an IntersectionObserver whose root margin is
  the box itself (any move changes its ratio) and a ResizeObserver; a
  canvas compares the box after each frame it paints. A popup follows its
  target through it and `$scrolls` (which answers a scroll in its own
  frame). It is removed as `$keys`'s handler is; in worker mode moves cross
  as events, merged within a burst. The Host hears it as
  `listen(node, 'move', handler)`.
- **Sizes.** `$resizes(node, handler)`, called in a component with a
  primitive's node (a ref) of its root's host, or an accessor of one
  (listened to again as it changes; null: none), hears that node's border
  box change size, as `onResize` does for a node the component makes and as
  a ResizeObserver: `{ type: 'resize', width, height, target }`, after each
  change from its size when the listening started. A Glider
  follows its target through it (a font loading widens the target). It is
  removed as `$keys`'s handler is; in worker mode sizes cross as events,
  merged within a burst. The Host hears it as `listen(node, 'resize',
  handler)`.
- **Viewport and media queries.** `$viewport()`, called in a component,
  gives the application root's viewport as reactive nodes: `width` and
  `height` in CSS pixels, `dark` (the user prefers a dark color scheme) and
  `reduced` (reduced motion). The root's host reports it (the Host's
  `viewport`): ren-dom the window's inner size and its media preferences,
  a canvas its Document's size (and the window's preferences where there
  is one); in worker mode the main thread's host reports it through the
  connection (in place when the view builds, then each change). A host
  that reports none leaves it 0 × 0 and light: a server render. A region
  of a root can have a viewport of its own (ren-three's panel: its size):
  the root's Host gives it (`viewportOf(node)`, for the element a
  component is built in), and `$viewport()` and `$media()` called while
  that region builds read it instead of the root's, one set of nodes per
  region; in worker mode the connection follows it on the main thread and
  carries its reports. The host
  follows it only while a reader's owner lives (directly; in worker mode
  the connection follows the root's for its whole life, see below, and a
  region's while it has readers). `$media(query)` is a
  reactive boolean of a CSS media query over it: `$media('(min-width:
  48em)')`, with `min-`/`max-` `width` and `height` or a range (`width >=
  600px`; px, em and rem, an em 16px as media queries read it),
  `orientation`, `prefers-color-scheme` and `prefers-reduced-motion` (a
  feature alone is boolean context: `(orientation)` matches), joined by
  `and`, `not`, `only`, a media type first (`all` and `screen` match, any
  other does not) and commas, as Media Queries Level 4 reads them; an
  empty query matches. A malformed query never matches, under `not` too.
  An unknown feature or an invalid value is unknown and `and` is
  three-valued: a term known false decides the query (`not print and
  (hover: hover)` matches); otherwise an unknown term keeps it from
  matching, under `not` too, as in a browser. `or` and nested parentheses
  are not read (unknown). The query is parsed once per `$media` call.
- **Image.** `source` and `label`; the style's `objectFit` (`'fill'` by
  default, `'contain'`, `'cover'`, `'none'`, as CSS's) fits it in its
  box; `onError` hears a source that fails to load.
- **Scroll.** `axis`: the axis it scrolls, `'y'` (default), `'x'` or
  `'both'`, with a bar along each; `scrollTop`, `scrollLeft`,
  `scrollHeight`, `scrollWidth`, `clientHeight` and `clientWidth` on its
  ref; the wheel's `deltaX` (and Shift with the wheel) scrolls across.
  Its bars follow the style's `scrollbarWidth` (CSS's scrollbar-width,
  the Scroll's own: `'auto'` the theme's `bar` wide, `'thin'` half of it,
  `'none'` no bar and no room kept for one, while the wheel, touch and
  `scrollTop` still scroll it) and `scrollbarColor` (`[thumb, track]`,
  inherited as CSS's scrollbar-color; `'auto'` the theme's muted thumb on
  its soft track): ren-dom writes them for its sheet's bars, the canvases
  draw them so.
- **Shape.** `shapes` is a list of records drawn in the Shape's content
  box: `line` (`x`, `y`, `right`, `bottom`, `stroke`: its thickness, 1 by
  default), `rect` and `round` (`radius`), `oval` and `path` (`points`,
  `closed`), each with a `color`; `stroke` above 0 outlines a rect, round, oval or closed path
  (centered on its edge, as SVG) instead of filling it, and `dash` (lengths
  on and off, as `stroke-dasharray`) dashes a stroke. `fill` fills a rect,
  round, oval or closed path with a color or a gradient in place of its
  `color`: `{ linear, stops }` or `{ radial: true, stops }` as `background`
  takes them, laid over the figure's bounds (a path's points' box) as a
  background over its box.
- **A point in a Label's text.** A canvas Label ref's `offsetAt(x, y)`
  gives the offset in its text nearest a point (a pointer event's `x`,
  `y`); on the DOM, `document.caretPositionFromPoint(x, y)` (or
  `caretRangeFromPoint`) does, so a component asks the ref first:
  `ref.offsetAt?.(x, y) ?? caret(x, y)`.
- **Label.** `lines`: at most that many wrapped lines; the text past them
  is cut and the last line ends with an ellipsis (…). `ellipsis`: one line
  that ends with … where the text does not fit its width (a Label may then
  shrink below its text).
- **Styled runs.** A Label's `runs` (in place of `text`) is its text as a
  list of `{ text, style, onPress }`: each run's style holds the text part
  of the vocabulary (`color`, `background`, `fontWeight`, `italic`,
  `underline`, `strike`, `fontFamily`, `fontSize`), and what it leaves out
  is the Label's, as a span inherits in CSS (rui-core's Highlight, Mark,
  Code tokens, a Link in text). The Label's text is the runs' texts
  joined: it wraps across runs (a word may span two), `lines` and
  `ellipsis` clip it, and selection, copy and `offsetAt` read that plain
  text's offsets. A line is as high as its tallest run (CSS's line box: each
  run's own leading, on one baseline); a run's `background` fills its
  text's height behind it (its font's ascent and descent, as a span's
  background in CSS). `onPress` hears a press on the run, before
  the Label's own, and runs as the view's handlers do (a `$batch` in the
  context it was bound in, failures to the boundary around the Label):
  ren-core hands the host each run with its `onPress` already wrapped
  (direct mode only: a function does not cross to a worker; `runs` cross
  as structured-clone data). ren-dom writes a span per
  run (the Label's `white-space` and wrapping stay its own); ren-canv
  measures, wraps and paints each piece in its run's face, size and color.
- **Runs over an Edit.** An Edit's `runs` (`{ text, style }`, no
  `onPress`: a press places the caret) show its value styled while it is
  edited (a code editor's tokens, a search match), and its value stays
  plain text: `onChange` gives `{ value }` as typed, the controlled value,
  caret, selection, IME, copy, paste and (on the DOM) native undo are the
  field's. The runs style what the Edit shows only while their texts
  joined are its value: the view answers each change with runs of the new
  value (a highlighter over it), and until it does (a keystroke, a worker's
  round trip, a composition on the DOM) the Edit shows the value plain, so
  it never shows stale marks. A run's style is the text part of the
  vocabulary but `fontSize` and `fontFamily`, which stay the Edit's: a
  field sets its text in one font on one line height, where its caret,
  selection and the platform's IME sit (and a native field cannot mix
  sizes). A secret Edit shows its bullets plain. ren-canv measures, wraps,
  places the caret and selects through the runs' faces and paints each
  piece; ren-dom draws a mirror of spans over its native field, whose own
  text turns transparent; in a font whose bold would widen the text it
  draws a weight as a stroke around the regular glyphs, and an italic only
  in a font whose italic keeps its advances (a monospace one, a code
  editor's), so the text never leaves the field's caret; a run's
  `background` is a layer of the field's own background, under its caret
  and selection. In a worker the runs cross as data.
- **Portable style.** A primitive's `style` is one vocabulary every renderer
  draws the same way (`src/style.js`): CSS flexbox and grid with CSS's
  defaults (`display`, `direction`, `wrap`, `gap`, `columnGap`, `rowGap`,
  `columns`, `rows`, `column`, `row`, `padding`, `margin`, `width`/`height`
  with their `min`/`max`, `aspectRatio` (width over height), `grow`, `shrink`, `align`, `self`, `justify`,
  `overflow`; border-box sizes; sizes and insets take a number or a percent
  string, `'50%'`), placement (`position` `'relative'`, `'absolute'` or
  `'sticky'` (in the flow, held within its nearest Scroll's view, or the
  page's, by its `top`, `right`, `bottom` and `left` (px or a percent of the view), never past its parent's content
  box, as CSS's; every primitive paints in tree order, so a sticky header
  that later rows scroll under wants a `zIndex`, on the DOM too) or
  `'fixed'` (out of the flow, placed by its insets against the viewport,
  over the page's scroll and its ancestors' clips; its percent sizes are
  of its parent's on the canvases), the
  insets `top`, `right`, `bottom`, `left` and `inset` for all four, and
  `zIndex`), paint
  (`background`, `color`, `opacity`, `border`, `borderColor`, `radius`,
  `shadow`, `placeholderColor`; `radius` is one number or the four corners
  `[topLeft, topRight, bottomRight, bottomLeft]`, as CSS's
  `border-radius`; a side's own border width and color, `borderTop`,
  `borderRight`, `borderBottom`, `borderLeft` and `borderTopColor`, …,
  given after `border` and `borderColor` override that side; `borderStyle`
  `'solid'` (default), `'dashed'` or `'dotted'`; `background` a color or a
  gradient, `{ linear: 90, stops: [[0, '#fff'], [1, '#000']] }` (an angle in
  degrees as CSS's `linear-gradient`: 0 to the top, 90 to the right) or
  `{ radial: true, stops }` (a circle from the center to the farthest
  corner), stops as [offset from 0 to 1, color]), transforms (`scale`, a
  number or [x, y]; `rotate` in degrees; `skewX` and `skewY` in degrees;
  `translate` [x, y]; and `transformOrigin` [x, y], the center by default;
  lengths in px or percents of the item's own size; applied as CSS's
  `translate`, `rotate` and `scale`, then the skews as CSS's `transform:
  skew()` (which follows them): painted and hit-tested, not laid out, and a
  stacking context), text (`fontSize`, `fontWeight` 100 to 900, `fontFamily`, `italic`, `textAlign`,
  `lineHeight`, `underline`, `strike` (a line through), `select`,
  `textTransform` (`'none'`, `'uppercase'`, `'lowercase'`, `'capitalize'`, as
  CSS's: inherited, but an Action and an Edit take only their own, as a
  browser's form controls, and an Edit shows its value as typed; the text
  given stays the data, so ren-json reads it as given, and a selection
  copies the text as shown, as Chrome copies it; on the canvases a
  character whose case takes more or fewer UTF-16 units, as `ß` in
  uppercase, keeps its own so offsets stay the text's), and
  `pointerEvents` `'none'` or `'auto'`
  (CSS's: 'none' lets the pointer through to what is under the item, its
  children with 'auto' excepted; inherited); color and text inherit as in
  CSS), `touchAction` (CSS's touch-action: `'auto'`, `'none'`,
  `'manipulation'`, or `'pan-x'`, `'pan-y'` and `'pinch-zoom'` combined in
  that order; a touch pressed on the item or under it leaves the browser
  only the pans and zoom the item and every ancestor that sets one allow;
  ren-dom writes CSS's, and a canvas cancels its element's `touchstart` (or
  its first `touchmove`, once the pan's direction is known) when the
  touch would make a pan or zoom they forbid; set nowhere on the path, a
  canvas keeps its default: a touch its items took does not pan the page),
  `display: 'contents'` on a View, Layout or Scroll (a leaf ignores it;
  it makes no box: its children lay out as its parent's, as a table row with `role="row"` whose
  cells sit in the table's grid; its box's own style (background, border,
  padding, sizes, placement, transforms, opacity, clip) does nothing, while
  text style, its meaning and events pass through it as an ancestor's; on
  the canvases its `getBoundingClientRect()` is empty, at its parent's
  corner), `ring` (its keyboard focus ring, drawn along its corners: its
  own by default; `false` hands it on, to the items inside it marked
  `'outer'`, as a check's box inside its pressable row, or, with none, to
  the nearest item around it marked `'inner'`, as a field's box around its
  entry;
  an Edit's ring shows whenever it has the focus, an Action's or a
  region's when the keyboard gave it, as the DOM's `:focus-visible`)
  and the states `hover`, `press` and `focus`. Every primitive is
  positioned, so an absolute item is placed against its parent's padding
  box, and everything paints in tree order except stacking contexts: an
  item with `zIndex` (or `opacity` below 1, at 0) is one, and the contexts
  inside one paint in `zIndex` order (negatives under its children, equal
  ones in tree order); the topmost takes the pointer, as in CSS. Colors
  are ARGB numbers or CSS hex and `rgb()`. It overrides the shorthand props that set the same
  thing. ren-dom writes it as CSS and the browser lays it out; ren-canv
  (for ren-skia and ren-three) lays it out with Taffy, the same CSS
  algorithms, and paints it, with text selection. Weights reach the DOM as
  given; the canvases draw the nearest face they have (a regular and a
  bold: 100 to 500 regular, 600 to 900 bold). `fontFamily` is CSS's
  family list on the DOM; the canvases draw a list naming `monospace` in
  their monospace face (ren-skia's and ren-three's `mono` option), and
  everything else in their one typeface. Names outside the
  vocabulary reach the DOM as CSS only. `ren-core/host` exports `styled`, the
  normalized record the drawn renderers read, and the theme's `text`,
  `leading` and `entry` tokens.

### Background disposal

Removing a large part of a view never stalls a frame on freeing it. When a
list update removes at least `retire` rows (1000 by default; a clear, a
replace, or a partial removal such as 9,000 of 10,000 rows, decided per
update by rrx-core's `{ retire: n }`), or a content swap (`Show`, `Choose`, any
region) drops a list of at least that many rows, ren-core removes the host nodes at once (an owned list empties its
element in one call) and **retires** the dropped scopes with rrx-core `$retire`:
they are inert at once (no binding, effect, handler or `$commit` hook of theirs
runs again; `$alive` is false) at the cost of one mark, and the root's
Sweeper frees them later with rrx-core `$sweep`, in the order `$stop` uses.
Every cleanup still runs exactly once, and a cleanup that throws still
reaches the nearest boundary (`$catch`, `Recover`), during the sweep.
Smaller drops stop at once, and so does everything under a
`Pending` boundary (a retired pending read would hold its count until
swept). What must not wait for the sweep closes when its owner is retired:
a `Portal`'s nodes leave their container and a nested `<Root>` is
disposed (its id is free again). `$dispose` of a root, or of a view, finishes
every retired teardown synchronously.

Each application root (`mount`, `render`, `Root(options)`, `serve`)
installs its Sweeper, which paces the sweep by the environment:

| `sweep` | where | how |
| --- | --- | --- |
| `idle` | a main thread with `requestIdleCallback` (default there) | slices inside idle periods, each at most the budget and what the deadline leaves; the callback ends when `navigator.scheduling.isInputPending()` reports input; a starved idle queue still gets a 1 ms slice every 250 ms |
| `frame` | `requestAnimationFrame` without idle callbacks (default there) | one slice after each frame's work, in a task posted from the frame |
| `task` | a worker, or no frames (default there) | slices in macrotasks, so messages and events run between them |

The budget starts at 4 ms, halves after a late frame (one more than 1.5
periods after the previous, seen by a frame probe that runs only while work
remains; at least 0.5 ms) and grows back by an eighth per frame on time.
Each slice ends with a `$flush`, so what cleanups changed shows (and, in
worker mode, crosses). Options of `mount`, `render`, `Root` and
`serve`: `retire` (rows; `false` never retires), `sweep` (a mode
above, or `false` to leave sweeping to rrx-core's default or to a Sweeper the
root already has), `swept(drain)` (each drain's report: `slices`,
`longest` slice, `busy` and total `time` in ms, `late` frames).

Measured (see Design choices and Benchmarks): retiring 10,000 market rows
blocks the clear 2.2 ms less than stopping them (node, 10 ABBA pairs), and
the drain frees them in one idle slice about 2 ms after the paint with no
late frame; with heavier rows (10 memo, effect and cleanup triples each) the
clear blocks 19.6 ms instead of 30.7 on the DOM, and the drain takes 4
slices of at most 4.5 ms.

### Rendering once: `$settle`

`$settle(root, { timeout })` resolves once no task of the root, or of a live
nested `<Root>` under it (direct runtime, at any depth), is pending and
nothing is queued (Pending and Recover show their final content). It rejects
with a failure raised while it waits, when the root is disposed, or after
`timeout` ms (10,000; 0, or more than 2**31-1 such as Infinity, waits
forever).

- **While it waits** it is the root's error boundary. A failure no scope
  handled goes first to the handler the root had (`$catch`): if that handler
  handles it, the wait goes on; otherwise the settle rejects with what it
  left unhandled. Overlapping settles with no `$catch` set between them
  share one boundary, and such a failure rejects them all.
- **The root's handler.** When the last overlapping settle ends, in whatever
  order, the root's handler is again the one it had before the first.
- **A `$catch` set while settles wait** ends their boundary role: that
  handler stays and takes the failures from then on, and one it leaves
  unhandled is raised by the flush that met it. A settle started after the
  `$catch` has a boundary of its own, over that handler.
- **After it is done** a failure is never swallowed: it reaches the handler
  then current or, left unhandled, is raised by the flush that met it; when
  that is the flush `$settle` starts, `$settle` throws it. Called inside a
  flush, the flush it starts runs in a microtask, where such a failure is
  uncaught, as any auto flush's.
- **Inside a flush** (from a `$settled` callback, say) it checks once in a
  microtask after that flush ends, and flushes the root if the wait is still
  live and no task is pending.
- **Nested roots.** The settle is the error boundary of each root of the
  tree, from when it meets that root until the whole settle ends: a failure
  in any of them, even one whose tasks are already done, rejects it as the
  root's own would. A nested root that appears while it waits (rendered by
  a completion) joins at once. It settles in passes, each root settling its
  part, repeated while a root has a pending task again or joined after the
  pass began. One deadline covers the tree. A worker-runtime nested root
  runs elsewhere and is not waited for.
- **Disposal.** A root disposed before the call or while it waits rejects at
  once with a "disposed" error; a nested root disposed while it waits (it
  left the view) no longer counts.
- **Nothing left behind.** Whatever the end (settled, failed, disposed or the
  deadline), no timer and no handler of the settle remains; a root keeps one
  dispose cleanup for all its settles.

It needs the root to flush automatically (`$auto`, the default of a Root
mounted from options); a root that only flushes by hand never settles while a
task is pending. With nothing pending it resolves. The
server renders use it: ren-html (`$html`, HTML) and ren-json (`$json`, the
view's data only). There is no hydration.

### Renderers: the Host contract

A renderer is a `Host` (`ren-core/host`; the contract is documented in
`src/core.js`): element (with the parent it goes into, null where none
is known yet, so a markup host gives it that parent's namespace: SVG or
MathML, for content built later as for what is written in place), text, content (replaces a text node's text), set,
listen, insert (which moves an existing
child), remove, marker, parent, next, owns, layer, and the optional
`clear(parent, first, last)` (remove a run of siblings at once),
`clone(plan, values, parent)` (a compiled template's nodes; `values` the instance's dynamic values, `parent` as `element`'s), `attach(target)`,
`unlisten(node, name)` and `delegate(node, name, handler, runner)`
(delegation: `listen` returns null when the node holds the handler),
`fill(element, text, keep)`, `present`, `setTheme(tokens)` (takes a new
theme at once, keeping the view and its state), `kind` (the renderer's name),
`open(element, id)`/`close()` (an application root prepares and releases
its host element), `construct` (the props `element` needs at creation: a
compiled template built through the Host calls passes the instance's values
of these, as ren-three's constructor `params`) and `nest()` (the renderer of a
`<Root>` nested without one; a host without it cannot hold nested roots).
`listen(container, 'keys', handler)` on the container a view renders into
hears every key of the application root (`$keys`), after the focused
item's own handlers, with `editable` set for a text field's key;
`listen(container, 'scrolls', handler)` every scroll that can move the
root's items (`$scrolls`); the optional `viewport(report)` reports the root's
viewport (`$viewport`, `$media`): width, height and flags (1 dark, 2
reduced motion), now and on each change, and returns its stop; the
optional `viewportOf(node)` gives the region `node` is in (an element
being built, maybe not placed yet) a viewport of its own: an object whose
`viewport(report)` reports the same way (the root's until it knows the
region), or null for the root's.
`mount(host, view, container, options)` renders any host; a view that
throws while it builds undoes the mount (its scope, the container's
delegation, the root's place and pacing, a root it made) and rethrows, as
a `Portal` whose children throw closes. The host's `present` runs from a rrx-core `$commit` hook after each flush round, which is
ren-core's Present/Commit publication.

`$active()` returns the rrx-core graph of the view being built (its
application root, where a component makes its signals), and `$surface()`
the Host that view renders into. Both are callable only while a view is
being built (a component runs, under `mount` or a `Root`) or one of its
event handlers runs; anywhere else they throw `REN: no view is being built`.
`ren-core/host` exports them for renderers, and the `ren-core` entry has
them too.

ren-core itself imports no renderer: `test/core.test.jsx` renders views, roots,
nested roots, background disposal and the worker runtime into an in-memory
Host (`test/fixtures/tree.js`) with no document. The renderers live in
ren-dom, ren-canv, ren-skia, ren-three, ren-html and ren-json, each with
its own README and tests.

### Worker mode

By default a view renders direct: components, the rrx-core graph, ren-core and the
renderer share the main thread. In worker mode the components, the graph and
ren-core run in a dedicated Worker, and only the renderer stays on the main
thread: the DOM host (ren-dom), the Skia renderer (ren-skia) with its
layout, painting, CanvasKit and input routing, or the three.js renderer
(ren-three) with three.js and its scene. The worker holds only the
application and its components: no DOM and no renderer code. Build a worker
bundle on its own, never sharing chunks with the page, so it carries none. The same component code runs in both modes.

```js
// worker.js (bundled as a module worker)
import { serve } from 'ren-core/worker';
import { App } from './app.jsx';
serve(() => <App />);

// main.js
import { connect } from 'ren-core/remote';
import { $dom } from 'ren-dom';
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const connection = connect(worker, $dom(document), document.getElementById('app'));
// $skia: connect(worker, renderer, renderer.root) with attach(renderer, canvas) as usual.
```

| Entry | API |
| --- | --- |
| `ren-core/worker` | `serve(view, options)` returns a `Session` (`dispose()`, `close()`, `post(data)`, `counters`); `Input` (a forwarded event), `Handle` (a remote node), `Remote` (the recording host); the `Lane` type |
| `ren-core/remote` | `connect(port, host, container, options)` returns a `Connection` (`post(data, lane)`, `idle()`, `close()`, `totals`, `seq`, `acked`); `Applied` (what each message held and cost) |

A port is anything with `postMessage` and `addEventListener` or `on`: a
Worker, a MessagePort, the worker's global scope (the default for `serve`),
or node's worker_threads `Worker` and `parentPort`. ren-core's tests run both
ends in one process over a `MessageChannel`; ren-dom's also run once in a real
worker thread.

`serve` options: `port`, `root`, `auto` (as `mount`); `lanes`, `coalesce`,
`backpressure` (all true); `budget` (8, milliseconds of main-thread apply time
one message may spend on deferred work; `Infinity` sends everything);
`message(data, lane)` receives `Connection.post`; `construct` (the property
names the main thread's renderer needs when it makes an element, its Host's
`construct`: ren-three's `CONSTRUCT`; their values travel with the element
and with each compiled template instance, as structured-clone data).
`connect` options: `schedule`
(`'frame'` where requestAnimationFrame exists, else `'now'`), `coalesce`
(true), `applied(info)`, `message(data)`, `error(error)`, `mailbox` (on
where the page is cross-origin isolated; `true`, `false`, or a size in
bytes).

**Shared mailbox.** Chrome runs a worker's reply after the frame that
follows an input, so an answer carried by a message shows a frame later than
direct mode would show it. Where the page is cross-origin isolated (served
with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`), `connect` shares a
SharedArrayBuffer slot with the worker (`src/mailbox.js`): the worker writes
a message's op words, numbers and strings there, marks the slot with
`Atomics` and rings a small bell message; after forwarding input the main
thread reads the slot in its next animation frames and applies from views
over the shared memory, so the answer shows in that frame. The bell applies
it otherwise, and a message with structured values (style objects, template
plans) or one that does not fit (4 MB) goes by message. Measured in
[ren-bench UI](https://github.com/wiltonlazary/ren-bench/blob/main/bench/ui/README.md) (idle typing, Chrome 153, load 5–6.5, two runs): keystroke to the
frame that shows it, p50 / p95, DOM 26.4 / 33.0 and 26.5 / 33.3 ms by message
against 9.5 / 17.4 and 10.9 / 17.6 ms with the mailbox (direct DOM: 9.7 /
16.6 and 7.7 / 14.9); Skia 24.5 / 32.9 and 25.0 / 32.8 against 12.0 / 18.4 and
11.3 / 17.6. Under a background burst the slot usually holds the frame's
deferred message, so answers still go by message (no change).

**Wire format.** `src/worker.js` documents it exactly. One message per
flush: an array of an Int32 op buffer, a Float64 number column (only when a
number is not an int32), a string table for the values of that message, the
names (tags, properties, events) new to the persistent name table, and a side
slot for structured values (style objects, shapes). The header is `acked`,
`flags`, `split` and the message number; each record is an opcode with fixed
operands, such as `SET_STR id name index`. Compiled templates cross as
`PLAN plan side` (the plan's tree, once per connection, in the urgent stream)
and one `CLONE plan first` record per instance: the main thread clones its
per-document template and the instance's held nodes take the ids `first`,
`first + 1`, …, which the worker's handles mirror. The typed buffers are transferred
and come back in the acknowledgement, so steady state allocates none.
Events travel as one flat array per task: 11 scalars per event (sequence,
listener, generation, modifier flags and a wheel's `deltaMode`, button, x,
y, deltas, value, key).
No JSON, no string-keyed records and no per-operation objects cross; nothing
waits for a reply.

**Protocol version.** The wire has a version, the same in `serve` and
`connect` of one ren-core: the main thread sends its own in its first
message and the worker answers with its own, so a page and a worker built
from different ren-core versions refuse each other. The worker builds no
view and throws `REN worker: the main thread speaks worker protocol …`;
the connection closes and throws `REN remote: the worker speaks worker
protocol …` (to `connect`'s `error` when given).

**Batching, lanes and QoS.** The lanes, promotion, coalescing and budget run
on rrx-core's own scheduling:

- Operations recorded while `$deferred(root)` holds (inside `$defer`, and the
  low-lane effects and applications it queues) wait in a low stream. An
  urgent operation that changes structure, or addresses a node a deferred one
  touched, promotes them first, so every message applies in a valid order.
  Mark background work with `$defer`, or post it with
  `connection.post(data, 'background')`.
- Property and text updates coalesce per node and property within a lane: a
  later value overwrites the earlier record in place, so a dead value is never
  sent.
- One message is in flight. Until the main thread has applied it, new flushes
  merge into the pending buffers (and coalesce there).
- On the main thread, a message that answers input applies on arrival; others
  apply at the next animation frame, at most one per frame, and always whole.
  A message is the published state of a flush, and the browser renders
  between tasks, so applying part of one would show a state no flush produced.
  The frame budget is kept at the source instead: deferred records go out in
  slices sized from the apply time the main thread reports per record, and a
  record limit halves whenever the main thread reports a late frame (one
  more than 1.5 periods after the previous), which takes rendering cost into
  account, and grows by an eighth per on-time message.
- Input preempts on both sides. The events of one task go in one message and
  run in one rrx-core `$batch` (one flush). Superseded pointer motion, scroll,
  resize and wheel events merge whole dispatch by whole dispatch: a dispatch
  whose records reach the same listeners, in the same order, as the
  dispatch queued right before it (nothing queued after that one) replaces
  it. Each record takes the latest values, modifier keys, button and key
  (the latest wins); a wheel's deltas add up, and wheels merge only with the
  same modifier keys, button and `deltaMode`. Dispatches with other listeners or of other
  kinds stay apart, and a dispatch whose first records already went in an
  earlier message is not replaced. So a burst of moves queues one dispatch
  however long it is, and a stop in the worker skips exactly what it skips
  in direct mode for every dispatch delivered. An answer to
  input carries no deferred records; if the message in flight is one the main
  thread holds for its frame and the answer touches nothing that message
  touched, it overtakes it and applies at once; otherwise it is posted at
  once too, and the main thread applies the held message first (no request
  and acknowledgement in between, which at saturation would queue behind the
  worker's long tasks).
- No starvation: every message that carries deferred work carries at least 256
  records, and an answer to input carries them too once the backlog has waited
  100 ms.

**Differences from direct mode.**

- A `ref` receives a `Handle`, not a DOM node or scene item; it works as a
  `Portal` `into` and for identity, but has no DOM API: no
  `getBoundingClientRect()` (the main thread measures; a DOM element and a
  canvas item have one in direct mode). `Portal` without
  `into` renders into the host's layer as in direct mode.
- Handlers receive an `Input`: `type`, `value`, `key`, `x`, `y`, `deltaX`,
  `deltaY`, `deltaMode` (a wheel's unit, as the DOM's: 0 pixels, 1 lines,
  2 pages), `button`, the modifier keys, `checked`, and `target` (itself, so
  `event.target.value` reads the same). `stopPropagation()` works as in direct
  mode: the handlers that heard the same main-thread dispatch after this one
  (its ancestors', a root's `$keys`) do not run. A default action cannot be cancelled
  from the worker, because the decision is due before the event leaves the
  main thread; `preventDefault()` does nothing. Use the `prevent` property
  instead (DOM renderer, both modes): event names (`prevent="submit"`), a list,
  or true for press and submit. It cancels on the main thread, synchronously.
  The Skia `attach` already cancels what the renderer handles.
- With coalescing (on by default), a burst's superseded dispatches are not
  delivered: the worker hears the burst's dispatches as direct mode would,
  with each run of same-path dispatches of pointer motion, scroll, resize or
  wheel reduced to its latest (wheel deltas added up). A listener may miss
  moves superseded within one burst, ancestors' records included (a stop by
  the latest dispatch is not undone by an earlier, unstopped one).
  `coalesce: false` delivers every dispatch.
- A burst (the events of one main-thread task) runs in one `$batch`, so its
  changes reach the main thread after the whole burst: a later dispatch of
  the same task still reaches the listeners of a node an earlier handler
  removed (direct mode removes the node, and its listeners, at once).
- Edit echo: every event has a sequence number and every message carries the
  last number the worker had handled, so a `value` update for a field the user
  has edited since is stale and skipped; the answer to the newer edit follows.
- A host's `set` receives `previous` for object values only (style objects).
  `element` receives `lines` as its only property, and its parent.
- Values that cannot be cloned (functions) cannot be properties; they throw in
  the worker. A host failure is thrown on the main thread, or passed to
  `connect`'s `error`.
- Main-thread nodes are released when the worker's garbage collector frees
  their handles (a FinalizationRegistry), so later than removal.
- `Session.post` and `Connection.post` messages are not ordered with view
  messages; `connection.idle()` resolves once everything sent before it has
  been published and applied (deferred work queued after it, a steady
  stream of it too, does not hold it back). `close()` settles every waiting `idle()` at
  once, and an `idle()` called after `close()` resolves at once.
- Chrome runs a worker's reply after the frame that follows an input event,
  so with an idle main thread the application's reaction shows one frame later
  than direct (the typed text itself shows at once: the field is on the main
  thread), unless the page is cross-origin isolated and the shared mailbox
  carries the answer (above). Under load the worker mode keeps the frame rate
  and the latency tail; see the results.
- The worker keeps a mirror of the tree for `parent` and `next`; a custom host
  must change its tree only through `insert` and `remove`.
- The connection follows the host's viewport (`viewport(report)`, on ren-dom
  the window's `resize` and media preference listeners) from `connect` to
  `close`, whether or not a view reads `$viewport` or `$media`, so the
  worker has it in place when the view builds and when a reader appears.

### Application roots

An application lives in a root, and one id confines it. `ren-core` re-exports
rrx-core, so there is one concept and one import: `$root(id)` is rrx-core's
graph; ren-core's `Root('id')` returns exactly that graph, and
`Root(options)`/`<Root>` extend it. `Root(options)` starts an application in
a graph of its own and returns that graph, usable with every rrx-core
operation; `<Root>` is the same thing nested in another application.

```jsx
import { Root, $signal, $dispose, $lookup, Id, Storage, Locks, Props, Send, $name, View, Label } from 'ren-core';
import { $dom, $shadow } from 'ren-dom';
import { $skia } from 'ren-skia';

const App = () => {
  const store = $lookup(Storage);                 // keys ren:main:*
  return (
    <View>
      <label for={$name('title')}>Title</label>   {/* id "main-title" */}
      <input id={$name('title')} />
      <Root id="side" renderer={$shadow({ mode: 'open', theme: { accent: 0xff445566 } })}
            props={() => store.get('filter')} onMessage={data => console.log(data)}>
        {() => <Side />}
      </Root>
      <Root id="chart" renderer={$skia(kit, { font, width: 320, height: 200, scale: 2 })}>
        <Chart />
      </Root>
    </View>
  );
};

const main = Root({ id: 'main', target: document.body, renderer: $dom(document, { theme: { ink: 0xff111111 } }), children: <App /> });
const tally = $signal(main, 0);  // the same graph
$dispose(main);                  // ends it, its nested roots, their renderers and workers
```

| Option | Meaning |
| --- | --- |
| `id` | `[a-z][a-z0-9-]{0,31}`; unique among the live roots of a document (a duplicate throws; the id is free again after `$dispose`) |
| `children` | the view: an element or component, or a function returning it (direct runtime) |
| `renderer` | a renderer package's Host: `$dom(document, options)` or `$shadow(options)` (ren-dom), `$skia(kit, options)` (ren-skia), `$three(THREE, options)` (ren-three), `$tree(options)` (ren-json). Required at top level; a nested root defaults to its parent host's `nest()` (the DOM renderers: light DOM; ren-json: `$tree`). One renderer per root |
| `target` | top level: the element the root's host element (`<div data-ren-root="<id>">`) is appended to; none for a document-less root |
| `runtime`, `worker` | `'direct'` (default), or `'worker'` with `worker`: a port, or `id => port` (a worker it makes is terminated with the root) |
| `storage`, `locks` | the Web Storage and Web Locks behind the root's views (the window's `localStorage` and `navigator.locks` by default; null for none) |
| `props`, `onMessage` | the parent-to-child value (`$lookup(Props)`) and the child-to-parent channel (`$lookup(Send)(data)`) |
| `provide` | `[[$context, value], …]` passed explicitly into the root, as providers around its view (direct runtime) |
| `auto`, `tag`, `connect` | as `mount`; the host element's tag; worker runtime connection options |

**Built-in contexts.** Every application root provides, as read-only base
layers read with `$lookup`: `Id` (the id), `Storage` (a `Shelf`: `get`,
`set`, `remove`, `keys`, `clear` over `ren:<id>:<key>`; reads track the
root's storage version, so views follow writes from this root, other tabs
and the other thread; every change dispatches `ren:storage` with `detail`
`{ id, key, value }` on the host element), `Locks` (a `Locker`: `request(name,
options?, callback)` and `query()` over `ren:<id>:<name>`), `Runtime`
(`{ runtime, renderer, element, connection }`), `Props` and `Send`.
`$name(name)` (or `$name(root, name)`) returns `<id>-<name>` for element ids, so labels and aria
references never collide across roots for a name without `-` (with one,
`a` + `b-c` and `a-b` + `c` both give `a-b-c`). `$roots(document)` lists the live ids.
A plain `mount`/`render` root gets `Id` only.
`Memory` is an in-memory `Backing` (the Web Storage calls `length`, `key`,
`getItem`, `setItem`, `removeItem` over a Map): the worker's mirror of its root's keys.
A worker view of a root with `storage: null` reads no `Storage` either.
The main thread's storage is the one that counts: writes to one key made on
both threads at once end, on both, with the value the main thread applied last.

**Renderer options.** Each renderer is configured by its own options and
serves one root; two roots never share one, so their themes, fonts, scale
and styles cannot interfere. Each package's README lists its options:
ren-dom (`$dom`, `$shadow`), ren-skia (`$skia`), ren-three (`$three`) and
ren-json (`$tree`).

**App or page.** Every renderer takes a `behavior` option (`behaviorOf` in
`ren-core/host` resolves it, so all read the same switches). `'app'`, the
default, behaves as an application: loose text is not selectable and shows
no I-beam, Ctrl or Cmd+A selects only inside an Edit or an element with the
style `select: 'text'`, the browser's context menu shows only in an Edit, and
touch shows no long-press callout or tap highlight. `'page'` behaves as a web
page. `{ like, …switches }` sets one of them as the default and overrides a
part: `select`, `selectAll`, `textCursor`, `menu`, `editMenu`, `callout`
(`{ like: 'app', select: true }`: an app whose text can be selected). On one
element, the style `select` and `prevent="contextmenu"` still decide.

**Isolation guarantees.**

- Graphs: each root is its own rrx-core graph; a write in one never marks, runs
  or flushes another's nodes. A pending read (`WAITING`) in one never holds
  another's `Pending`; the pending-state register is consumed by the catch
  it was thrown to.
- Contexts: a root's chain starts at its own base layers. A nested root sees
  none of its parent's contexts (not its providers, storage, locks or id);
  pass values with `props` or `provide`. `$update` never crosses a root.
- DOM: a root renders only inside its host element (or its shadow root);
  portals default to that host, not `document.body`. Nothing is added to the
  document head, `:root` or `window`/`globalThis`. The window listeners
  are the root's `storage` listener, removed on dispose, and while a view
  reads its viewport (`$viewport`, `$media`) its `resize` listener and
  the media preferences' `change` listeners, removed with the last reader.
  Root-wide keys (`$keys`) and scrolls (`$scrolls`) listen on the document
  (scrolls in capture, and on a shadow root too) while a view hears them.
- Storage and locks: keys and lock names carry the `ren:<id>:` prefix; a root
  sees, lists and clears only its own keys, and follows only their `storage`
  events.
- Dispose (`$dispose(root)`, or the parent's scope stopping for `<Root>`):
  the view stops, the container is emptied (a shadow root's children and its
  adopted sheet removed; a Skia page and overlay unlinked, its canvas removed
  and its CanvasKit resources freed; a three.js scene emptied, its GPU
  resources and WebGL renderer disposed), theme properties and `data-ren-root`
  are removed, the connection closes and a worker the root made is
  terminated, the storage listener goes, the id is released, and a top-level
  host element leaves its target.

**The boundary between a parent and a nested root.** Only `props` (read in
the parent: a value, or an accessor or node the parent tracks) and
`onMessage` (run in the parent's context, in one batch) cross. A nested
root's view must not read the parent's nodes: rrx-core does not guard cross-root
reads on the hot path, and such a read would tie two graphs together. A
nested root needs a parent renderer whose elements hold a root (a Host with
`nest`: ren-dom's `$dom` and `$shadow`, ren-json's `$tree`) in the direct runtime; its own
renderer can be any.

**What is shared.** Only immutable library code: functions, classes and
module-level constants. The module-level mutable slots that remain are
registers, never state: ren-core's `active`/`host` (saved and restored around
every build, so a nested root's build restores its parent's), rrx-core's `waited`
(set by a pending read and taken by the catch it is thrown to) and `running`
(the root whose code is on the stack, restored after), plus `WeakMap`s from
each document to its live ids and from each root to its disposal pacing
(its Sweeper state, `src/sweep.js`). Renderer state (a Skia scene's item
ids, a three.js scene) is per renderer.

**Worker runtime.** Each worker-runtime root has its own port and its own
worker: `Root({ id: 'side', runtime: 'worker', worker: id => new Worker(url,
{ type: 'module' }), target, renderer })` on the main thread; in the worker,
`serve(view, { root: Root('side') })` (or `serve(view, { id: 'side' })`).
The main thread sends `[ROOT, id, entries, props, view]` first; the worker throws if its
root has another id. Contexts, providers and `$update` live with the graph in
the worker; the main thread sees only its own root handle and its
`Runtime`/`Storage`. Storage lives on the main thread: the worker's
`$lookup(Storage)` is a mirror filled from `entries`; its writes cross as one
`[SAVED, pairs]` message per task, and main-thread or other-tab writes to the
root's keys cross back as `[STORE, pairs]`: no request and reply, and
nothing on the view path. `props` cross as `[PROPS, value]` and
`$lookup(Send)` posts to `onMessage`; both carry structured-clone data only.
Locks in the worker use its own `navigator.locks` (`serve`'s `locks`
option), under the same names.

## Tests

```sh
(cd ../../../rrx-core/wtree/_repo_ && npm install)   # rrx-core first: its install generates the types ren-core checks against
npm install        # rrx-core (linked), pinned devDependencies: esbuild, happy-dom, typescript
npm test           # declarations, tsc --checkJs --strict, the TypeScript consumers, node:test
```

- `test/core.test.jsx` runs the component layer on an in-memory Host
  (`test/fixtures/tree.js`), no document: components, control flow and
  reactive text, children as rendered (`$parts`), events, construct props,
  application roots without a
  document and the renderer they need, nested roots through `nest()`,
  background disposal of a large list, and the worker runtime over a
  MessageChannel. Its `$settle` suite covers rendering once: boundary,
  overlap, disposal, deadline.
- `test/compiler.test.js` covers the compiler: output shape, scanning,
  blocks against object literals, source maps, TSX and the development
  runtime's key.
- `test/focus.test.js` covers `$focus` and `focusables`: the first or last
  focusable inside a primitive, a canvas item's or a DOM element's.
- `test/keys.test.jsx` covers `$keys` and `$scrolls` (every key and scroll
  of the root, directly and in worker mode), `$moves` and `$resizes`.
- `test/style.test.js` covers the portable style: one vocabulary normalized
  once, the same for every renderer.
- `test/viewport.test.jsx` covers `$viewport` and `$media`: the host's
  viewport and a region's (`viewportOf`) report as reactive nodes,
  directly and in worker mode.
- `test/settle.fuzz.test.js` runs `$settle` over generated trees of nested
  roots (fixed seeds), each step checked against a small model of which
  failure reaches which settle.
- `test/decoder.fuzz.test.js` feeds the worker wire's decoders (remote.js,
  worker.js, through messages and the shared mailbox) malformed messages
  (fixed seeds), in a worker thread a watchdog ends on a hang: every
  message ends, every batch hands its buffers back.
- `test/timers.test.js` guards the timer calls in the sources, tests and
  scripts: each says why it is one (a `timer: <kind>` comment), and no sleep
  helper stands in for the event that reports work done.
- `test/exports.test.js` locks the public contract: every entry's export
  names and kinds must equal `test/exports.lock.json`.
- `npm test` runs the `.jsx` suites twice: with the automatic runtime
  (`ren-core/loader`) and compiled by ren-core/esbuild (`ren-core/compiled`).
- `test/types/` are TypeScript consumers compiled with `tsc --noEmit` (a
  Host and roots through `ren-core/host`, the compiler API).
- The renderers' suites live in their packages: ren-dom (components on the
  DOM, list mutations, delegation, compiled templates, application roots,
  retirement, the worker runtime and its mailbox), ren-canv (the drawn
  engine), ren-skia (the canvas, text entry, the mirror, damage repaint,
  worker mode, Skia roots beside DOM roots), ren-three, ren-html and
  ren-json. A change to ren-core is finished once `npm test` passes in its
  seven dependents too: ren-dom, ren-canv, ren-skia, ren-three, ren-html,
  ren-json and rui-core.
- The `.d.ts` files in `types/` are generated from the JSDoc by
  `scripts/types.mjs`; the JSX namespace (`src/jsx.d.ts`) is the one
  handwritten declaration.
- The reactive core's own suites (core, tasks, stores, lists) live in rrx-core.

## Benchmarks

Benchmark harnesses and recorded measurements live in
[ren-bench](https://github.com/wiltonlazary/ren-bench). Its
[UI suite](https://github.com/wiltonlazary/ren-bench/blob/main/bench/ui/README.md) measures the worker
runtime, scheduling, disposal and row cost through this package's public entries.
The [market suite](https://github.com/wiltonlazary/ren-bench/blob/main/bench/market/README.md) compares
the DOM renderer against other UI libraries. Run benchmark commands from ren-bench.

## Design choices

Deliberate choices, their alternatives, and their measured effect.

1. **Large drops retire; small ones stop.** A list clear or no-survivor
   replace, or a content swap, that drops a list of at least 1000 rows
   retires it (rrx-core `$retire`) instead of stopping it; smaller drops stop at
   once. [ren-bench UI/dispose.mjs](https://github.com/wiltonlazary/ren-bench/blob/main/bench/ui/dispose.mjs) (node v24.15.0, market rows, 10 ABBA pairs,
   load 3.6): the clear's blocking time, stop against retire, is 0.024
   against 0.028 ms at 100 rows (retire not faster, 3/10 pairs), 0.044
   against 0.025 at 300, 0.136 against 0.044 at 1,000, 0.514 against 0.095
   at 3,000 and 2.53 against 0.37 at 10,000 (10/10 pairs from 300 up); the
   sweep then costs what `$stop` did (2.2 ms at 10,000, one slice). 1000 keeps
   every small and medium list synchronous (cleanups run in the update, as
   the tests expect) and retires where the saving starts to count for
   heavier rows.
2. **Rows live in a container scope per list.** A clear retires the
   container, one mark for every row, and maps new items in a fresh
   container, rather than one `$retire` per row (rrx-core's `{ retire: true }`,
   fixed when the list is made, which would also retire small removals).
   The list reads its items before its rows memo, so a clear is seen before
   the memo would stop the rows. Cost: one scope per list, and one memo for
   an accessor `each`.
3. **Pacing by the environment.** Idle callbacks on a main thread, a slice
   after the frame without them, macrotask slices in a worker; 4 ms slices,
   halved after a late frame, and a `$flush` after each. Measured in
   [ren-bench UI](https://github.com/wiltonlazary/ren-bench/blob/main/bench/ui/README.md): no dropped frame while 10,000 rows (and 100,000
   memo/effect/cleanup triples) are freed under typing, and the drain
   finishes 1.5–4 times sooner than with rrx-core's default 4 ms `setTimeout`
   slices.
4. **A compiled template lowercases its event names once, in the plan.**
   An `on<Name>` part is an event op that carries the event's name, instead
   of a property op whose name each instance slices and lowercases.
   [ren-bench UI/rows.mjs](https://github.com/wiltonlazary/ren-bench/blob/main/bench/ui/rows.mjs) (node, market rows compiled, ABBA against the property op
   sliced per instance, 30 and 60 pairs): create 1,000 rows −4.6% (16/30),
   −6.8% (40/60), −5.9% (41/60).
5. **Measured and not taken** (same harness, 30–60 ABBA pairs):
   caching the Pending lookup per context layer (create 0.981, 10/30 pairs);
   a name cache for runtime handlers (1.02, 0.999); bound handlers
   `[handler, data]` carried by the row's runner, no closure per row
   (compiled 1.063 and 0.965, runtime 1.041 and 1.028); property bindings
   without `previous` except for `style` (0.958–1.017); in Chrome (market,
   ABBA, 4 pairs) the DOM host making a kept text node with `textContent`
   (create 10k JS time 1.2×). None pays for itself.
