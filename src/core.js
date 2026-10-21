// ren-core: the renderer-neutral component layer over rrx-core.
//
// JSX evaluates to host nodes, lazy component descriptors, arrays, values and
// accessors. Intrinsic elements are created at once through the active host;
// components are lazy descriptors and run in their own
// scope when inserted, so a branch that is never shown never runs. Every
// reactive property becomes a Render binding (compute, then apply in the
// Render phase of the flush) and every dynamic child a region: an effect that
// rebuilds its content in a fresh scope between two markers. There is no
// virtual DOM: a change reaches exactly the bindings and regions that read it.
//
// A host is the renderer: the renderer packages (ren-dom, ren-skia,
// ren-three, ren-json, …). It owns nodes; this module only calls the Host interface below.

import {
  $root, $signal, $read, $write, $memo, $effect, $untrack, $batch, $flush, $scope, $enter, $stop, $cleanup, $owner,
  $catch, $deliver, $context, Provided, $provide, $lookup, $with, $rows, $positions, $auto, $writable, $dispose, $commit, WAITING, Node, $alive, $after,
  $retire, $discard, $watch, $release,
} from 'rrx-core';
import { Layer } from 'rrx-core/context';
import { waitedOn, $bind, Application, $cancel, suspend, peeked, peekCount, development, counted, diagnose, lift } from 'rrx-core/core';
import { base } from './context.js';
import { Pace, Eager, RETIRE, modeOf } from './sweep.js';

/**
 * The renderer contract. Nodes are opaque to ren-core.
 * @typedef {object} Host
 * @property {(tag: string, props: any, parent: any) => any} element A primitive or host element for `tag`; `props` may choose its form, and `parent` is the element it goes into (null where none is known yet: a view's root built apart), whose namespace a markup host gives it (SVG inside an `svg`).
 * @property {(text: string) => any} text A text node.
 * @property {(node: any, text: string) => void} content Replaces a text node's text.
 * @property {(node: any, name: string, value: any, previous: any) => void} set Applies a property.
 * @property {(node: any, name: string, handler: (event: any) => void) => (() => void) | null} listen Adds an event handler; returns its removal, or null when the node holds the handler for a delegated dispatch (it goes with the node; `unlisten` drops it earlier). The name `keys` on the container a view renders into (`$keys`) hears every key pressed in its application root, after the focused item's own handlers (as a document's keydown listener hears it last), and when nothing in it has focus; its key event's `editable` is true when the key's target is a text field. The name `scrolls` there (`$scrolls`) hears every scroll that can move the root's items (a Scroll in it, the page, on the DOM an element around the container). The name `presses` there (`$presses`) hears every pointer press in the root, its portals too, after the pressed item and its ancestors heard it. The name `move` on a primitive's node (`$moves`) hears its border box change place in its surface (`{ x, y }` as getBoundingClientRect's, after each change from where it was when the listening started), whatever moved it.
 * @property {((node: any, name: string, handler: (event: any) => void, runner: { run: (handler: (event: any) => void, event: any) => void }) => boolean)=} delegate Keeps a handler and its runner on the node for a delegated dispatch, which calls `runner.run(handler, event)`; false when the host cannot delegate this one (ren-core then listens).
 * @property {((node: any, name: string) => void)=} unlisten Drops a handler `listen` delegated (returned null for).
 * @property {((target: any) => () => void)=} attach Makes `target` (a container views render into) a delegation root: one listener per delegated event type there; returns the detach, which removes them.
 * @property {(parent: any, child: any, before: any) => void} insert Inserts or moves `child` before `before` (null appends).
 * @property {(parent: any, child: any) => void} remove Removes a child.
 * @property {((element: any, text: string, keep: boolean) => any)=} fill Sets an element's content to one text (`textContent`); returns its Text node when `keep`.
 * @property {((parent: any, first: any, last: any) => void)=} clear Removes the sibling run `first`…`last` (inclusive) of `parent` at once; without it, ren-core removes node by node.
 * @property {((plan: Plan, values: any[], parent: any) => any[])=} clone A fresh instance of a compiled template: the nodes at `plan.refs`, the root first (per document; never a node shared across documents); `values` are the instance's dynamic values (a host with `construct` needs some at creation); `parent` is the element it goes into, as `element`'s. Without it, ren-core builds the template through `element`, `set`, `text` and `insert`.
 * @property {() => any} marker An empty placeholder node.
 * @property {(node: any) => any} parent The parent of a node, or null.
 * @property {(node: any) => any} next The next sibling of a node, or null.
 * @property {(node: any) => boolean} owns True for this host's nodes.
 * @property {() => any} layer The container portals render into by default.
 * @property {(() => void)=} present Called after each flush round (a rrx-core `$commit` hook: Present/Commit); a host that tracks damage makes an unchanged round free.
 * @property {((tokens: import('./theme.js').Tokens) => void)=} setTheme Takes a new theme at once, keeping the view and its state (every renderer package but ren-json, which has no visuals).
 * @property {string=} kind The renderer's name (`dom`, `shadow`, `canvas`, `skia`, `three`, `json`), for `Runtime`.
 * @property {((element: any, id: string) => any)=} open Prepares an application root's host element (null: none) and returns the container its view renders into; one root per renderer.
 * @property {(() => void)=} close Releases what `open` made and empties the container.
 * @property {ReadonlySet<string>=} construct The property names `element` needs at creation (a constructor's arguments): a compiled template built through the Host calls passes each instance's values of these in `element`'s props, as the runtime path passes every prop; they are still `set` after.
 * @property {((report: (width: number, height: number, flags: number) => void) => () => void)=} viewport Reports the viewport the root's view lives in (`$viewport`, `$media`): its width and height in CSS pixels and its flags (1: the user prefers a dark color scheme, 2: reduced motion), now and whenever they change; returns the stop. Without it a root's viewport is 0 × 0.
 * @property {((node: any) => { viewport: (report: (width: number, height: number, flags: number) => void) => () => void } | null)=} viewportOf The viewport of the region of the root that `node` is in (an element being built or built), when that region has one of its own (ren-three's panel): an object whose `viewport(report)` reports as the Host's `viewport` does, from now on (it may report the root's until it knows the region: `node` may not be placed yet); null for the root's. `$viewport` and `$media` called while `node` is built read it.
 * @property {(() => Host)=} nest A new renderer for a root nested in this one's views (`<Root>` without `renderer`); its presence says this host's elements can hold a nested root's host element.
 */

/**
 * Something JSX can render.
 * @typedef {null | undefined | boolean | string | number | Lazy | Choice | List | readonly any[] | (() => any) | import('rrx-core/core').Node<any> | object} View
 */

/** A component call, run when inserted. */
export class Lazy {
  /** @param {(props: any) => any} component @param {any} props */
  constructor(component, props) {
    this.component = component;
    this.props = props;
  }
}

/**
 * A list region: a memo of rows, each a range of host nodes. The rows live
 * in a container scope, so a clear (or a replace that keeps no row) of a
 * large list retires the container, one mark for every row, and maps the
 * new items in a fresh one.
 */
class List {
  /**
   * @param {import('rrx-core/core').Graph} R
   * @param {import('rrx-core/core').Readable<any> | null} items the items node, null for a fixed array
   * @param {((item: any) => unknown) | null | undefined} key For's key (null: the item), undefined for a positional For
   * @param {(read: () => any, removal: { retire: number } | undefined) => import('rrx-core/core').Readable<any[]>} map makes the rows memo over `read`
   * @param {any} each the fixed items, when `items` is null
   * @param {any} fallback
   */
  constructor(R, items, key, map, each, fallback) {
    this.R = R;
    this.items = items;
    this.key = key;
    this.map = map;
    this.fallback = fallback;
    /** The owner and context containers are made in. */
    this.owner = /** @type {import('rrx-core/core').Owner} */ ($owner(R));
    this.context = R.ctx;
    /** The items the rows were last mapped from. @type {readonly any[] | null} */
    this.last = null;
    this.read = items === null ? () => each : () => (this.last = $read(/** @type {any} */ (items)));
    // Updates that remove at least the root's threshold of rows retire them
    // (rrx-core decides per update); never under Pending, as in list.
    const pace = pacing(R, $lookup(R, PENDING_BOUNDARY));
    /** The root's Pace where its drops may retire, else null. @type {Pace | null} */
    this.pace = items === null ? null : pace;
    this.removal = pace === null ? undefined : { retire: pace.threshold };
    /** @type {import('rrx-core/core').Owner} */
    this.scope = $scope(R, this.owner);
    /** @type {import('rrx-core/core').Readable<any[]>} */
    this.rows = $enter(this.scope, () => map(this.read, this.removal));
  }

  /** True when `items` keeps none of the rows: a clear, or a keyed replace. @param {readonly any[] | null | undefined} items */
  gone(items) {
    if (items == null || items.length === 0) return true;
    const n = items.length;
    const key = this.key;
    const last = this.last;
    if (key === undefined || last == null || last.length === 0) return false;
    const k = key ?? same;
    // Rows that stay at either end rule a replace out without a set.
    if (k(items[0]) === k(last[0]) || k(items[n - 1]) === k(last[last.length - 1])) return false;
    const old = new Set();
    for (let i = 0; i < last.length; i++) old.add(k(last[i]));
    for (let i = 0; i < n; i++) if (old.has(k(items[i]))) return false;
    return true;
  }

  /** Retires every row at once (their container) and maps in a fresh container. */
  renew() {
    const R = this.R;
    const old = this.scope;
    this.scope = $with(R, this.context, () => $scope(R, this.owner));
    this.rows = $enter(this.scope, () => this.map(this.read, this.removal));
    $retire(old);
  }
}

/** @param {any} item */
const same = item => item;

/** A `When` descriptor for `Choose`. */
class Choice {
  /** @param {any} when @param {any} children */
  constructor(when, children) {
    this.when = when;
    this.children = children;
  }
}

/** The host nodes of a row of several nodes: everything between two markers. A row of one node is that node. */
class Range {
  /** @param {any} first @param {any} last @param {any[]} nodes */
  constructor(first, last, nodes) {
    this.first = first;
    this.last = last;
    this.nodes = nodes;
  }
}

// ---------------------------------------------------------------------------
// The active view: the root and host of the view being built or updated.

/** @type {import('rrx-core/core').Graph | null} */
let active = null;
/** @type {Host | null} */
let host = null;
/**
 * The host element the elements being made go into (`element`'s and
 * `clone`'s `parent`), null where none is known: a register set around
 * each build of children and restored after it.
 * @type {any}
 */
let into = null;

/** The element the elements being made go into, or null. */
export function placing() {
  return into;
}

/** Runs `fn` making elements that go into `parent`. @template T @param {any} parent @param {() => T} fn @returns {T} */
function at(parent, fn) {
  const outer = into;
  into = parent;
  try {
    return fn();
  } finally {
    into = outer;
  }
}

/**
 * A boundary pending reads report to: a Pending, or a region's or list's
 * build (a Probe). `revealed` is true while what it covers is on screen (a
 * Pending shows its content, not its fallback; a build's content is placed):
 * a shown value that waits there holds its update (a transition). `holds`
 * is true where new content that waits keeps the old content in place: under
 * a Pending that shows its content.
 * @typedef {{ wait: () => void, settle: () => void, revealed: () => boolean, holds: () => boolean }} Boundary
 */

/** The nearest boundary: an internal, fixed context layer. */
const PENDING_BOUNDARY = $context(/** @type {Boundary | null} */ (null));

/** The nearest Sequence: the Pendings below it register their order there. */
const SEQUENCE = $context(/** @type {Order | null} */ (null));

/** The root of the view being built. */
export function $active() {
  if (active === null) throw new Error('REN: no view is being built; call it in a component (under mount or Root) or one of its handlers');
  return active;
}

/** True while a view is being built (a component runs). */
export function building() {
  return active !== null;
}

/** The host of the view being built. */
export function $surface() {
  if (host === null) throw new Error('REN: no view is being built; call it in a component (under mount or Root) or one of its handlers');
  return host;
}

/** @template T @param {import('rrx-core/core').Graph} R @param {Host} H @param {() => T} fn @returns {T} */
function within(R, H, fn) {
  const r = active;
  const h = host;
  active = R;
  host = H;
  try {
    return fn();
  } finally {
    active = r;
    host = h;
  }
}

/** Reads an accessor, a reactive node, or a plain value. @param {any} value */
export function read(value) {
  if (typeof value === 'function') return value();
  if (value instanceof Node) return $read(value);
  return value;
}

/** @param {any} value */
const reactive = value => typeof value === 'function' || value instanceof Node;

// ---------------------------------------------------------------------------
// JSX

/** @param {any} props */
function childrenOf(props) {
  return props == null ? undefined : props.children;
}

/**
 * The JSX factory (automatic runtime). Every element is a lazy descriptor,
 * built where it is inserted: intrinsic tags become host nodes, components
 * run in their own scope. A branch that is never shown is never built, and
 * everything is owned by the region, boundary and context it renders in.
 * @param {string | ((props: any) => any)} type
 * @param {any} props
 * @param {any} [key] a JSX `key`, which the compiler passes apart; components receive it as a prop
 * @returns {any}
 */
export function jsx(type, props, key) {
  if (type === Fragment) return childrenOf(props);
  // Attributes apply in the order written: a `key` written before a spread
  // that carries one gives way to it, as `h` reads the same element.
  if (key !== undefined && typeof type === 'function' && (props == null || !('key' in props))) props = { ...props, key };
  return new Lazy(/** @type {any} */ (type), props ?? {});
}

/** The ren-core primitive roles, for JSX: `<View>`, `<Label text=…>`. */
export const View = 'View';
export const Layout = 'Layout';
export const Scroll = 'Scroll';
export const Label = 'Label';
export const Edit = 'Edit';
export const Action = 'Action';
export const Image = 'Image';
export const Shape = 'Shape';

/**
 * Builds a host node for an intrinsic element.
 * @param {import('rrx-core/core').Graph} R @param {Host} H @param {string} type @param {any} props
 */
function element(R, H, type, props) {
  const node = H.element(type, props, into);
  if (props != null) {
    for (const name in props) {
      // A key (one a spread carried) belongs to JSX, not to the host.
      if (name === 'children' || name === 'ref' || name === 'key') continue;
      prop(R, H, node, name, props[name]);
    }
    const children = props.children;
    if (children !== undefined) {
      const outer = into;
      into = node;
      try {
        // A component that is the element's only child and makes a list owns
        // the element: its rows need no markers, and clearing it is one call.
        if (children instanceof Lazy && typeof children.component !== 'string') {
          const made = materialize(R, H, children);
          if (made instanceof List) list(R, H, made, null, node);
          else insert(R, H, node, made, null);
        } else insert(R, H, node, children, null);
      } finally {
        into = outer;
      }
    }
    const ref = props.ref;
    if (ref != null) bindRef(node, ref);
  }
  return node;
}

/**
 * Whether a prop names an event: `on` and a capital letter (`onClick`). Any
 * other name, `on-state` or `on1` too, is a property, as the compiler's
 * static attributes are.
 * @param {string} name
 */
function eventName(name) {
  if (name.length < 3 || name.charCodeAt(0) !== 111 || name.charCodeAt(1) !== 110) return false;
  const c = name.charCodeAt(2);
  return c >= 65 && c <= 90;
}

/**
 * Applies one property of an intrinsic element: an event handler, a
 * reactive binding, or a value set once.
 * @param {import('rrx-core/core').Graph} R @param {Host} H @param {any} node @param {string} name @param {any} value
 */
function prop(R, H, node, name, value) {
  if (eventName(name)) {
    // on + Capital: an event handler, run as a batch that flushes once.
    // (Compiled templates carry the lowercased name in their plan.)
    if (typeof value === 'function') bindEvent(R, H, node, name.slice(2).toLowerCase(), value);
    return;
  }
  // A Label's runs carry handlers too: the host gets them wrapped.
  if (name === 'runs') {
    const press = pressing(R, H);
    if (reactive(value)) {
      const source = value;
      bind(R, H, node, name, () => press(read(source)));
    } else H.set(node, name, press(value), undefined);
    return;
  }
  if (reactive(value)) bind(R, H, node, name, value);
  else H.set(node, name, value, undefined);
}

/**
 * Wraps each run's `onPress` (a Label's `runs`) so it runs as the view's
 * handlers run (`handle`: a batch in the context it was bound in, failures to
 * the boundary around its element, only while its owner lives). The host
 * calls it as it did the raw one. A run keeps its wrapped copy while it is the
 * same object, and runs without a handler (or a list with none) pass as
 * they are, so reactive updates rebind nothing they need not.
 * @param {import('rrx-core/core').Graph} R @param {Host} H
 * @returns {(runs: any) => any}
 */
function pressing(R, H) {
  const context = R.ctx;
  const owner = $owner(R);
  /** @type {WeakMap<object, object>} */
  const wrapped = new WeakMap();
  /** @param {any} run */
  const wrap = run => {
    if (run === null || typeof run !== 'object' || typeof run.onPress !== 'function') return run;
    let copy = wrapped.get(run);
    if (copy === undefined) {
      const handler = run.onPress;
      /** @type {object} */
      const made = {
        ...run,
        onPress: (/** @type {any} */ event) => {
          if (R.closed || (owner !== null && !$alive(owner))) return;
          handle(R, H, context, owner, handler, event);
        },
      };
      wrapped.set(run, made);
      copy = made;
    }
    return copy;
  };
  return runs => {
    if (!Array.isArray(runs)) return runs;
    let out = null;
    for (let i = 0; i < runs.length; i++) {
      const run = wrap(runs[i]);
      if (run !== runs[i]) (out ??= runs.slice())[i] = run;
    }
    return out ?? runs;
  };
}

/** A `ref`: a callback receives the node, a signal is written with it. @param {any} node @param {any} ref */
function bindRef(node, ref) {
  if (typeof ref === 'function') ref(node);
  else if (ref instanceof Node) $write(/** @type {any} */ (ref), node);
}
export const jsxs = jsx;

/** Groups children without a node. @param {{ children?: any }} props */
export function Fragment(props) {
  return props.children;
}

/** @param {import('rrx-core/core').Graph} R @param {Host} H @param {any} node @param {string} event @param {(event: any) => void} handler */
function bindEvent(R, H, node, event, handler) {
  // A change of a controlled Edit shows its bound value again when the
  // handler's flush did not adopt the typed text.
  if (event === 'change') handler = controlled(R, H, node, handler);
  // The handler runs in the context it was bound in, so `$lookup` and `$update`
  // reach the providers around its element.
  const context = R.ctx;
  const owner = $owner(R);
  if (H.delegate !== undefined) {
    // One runner per owner and context (a row's handlers share one): the
    // host keeps the handler and the runner on the node, no closure.
    let r = runner;
    if (r === null || r.R !== R || r.H !== H || r.context !== context || r.owner !== owner) runner = r = new Runner(R, H, context, owner);
    if (H.delegate(node, event, handler, r)) return;
  }
  const remove = H.listen(node, event, e => {
    // A delegated handler stays on its node; it runs only while its owner lives.
    if (R.closed || (owner !== null && !$alive(owner))) return;
    handle(R, H, context, owner, handler, e);
  });
  // A delegated handler goes with its node: no removal to register.
  if (remove != null && owner !== null) $cleanup(owner, remove);
}

/**
 * Runs delegated handlers bound in one owner and context: in the view's root
 * and host, the context they were bound in, as a `$batch`, and only while
 * their owner lives.
 */
class Runner {
  /** @param {import('rrx-core/core').Graph} R @param {Host} H @param {any} context @param {import('rrx-core/core').Owner | null} owner */
  constructor(R, H, context, owner) {
    this.R = R;
    this.H = H;
    this.context = context;
    this.owner = owner;
  }
  /** @param {(event: any) => void} handler @param {any} event */
  run(handler, event) {
    const R = this.R;
    const owner = this.owner;
    if (R.closed || (owner !== null && !$alive(owner))) return;
    handle(R, this.H, this.context, owner, handler, event);
  }
}

/**
 * Runs a handler in its view's root and host and the context it was bound
 * in, as a `$batch`. What it throws goes to the boundary around its element
 * (the nearest `$catch` of its owner, then the root's), and is raised to the
 * host's dispatch only when nothing handles it.
 * @param {import('rrx-core/core').Graph} R @param {Host} H @param {any} context @param {import('rrx-core/core').Owner | null} owner
 * @param {(event: any) => void} handler @param {any} event
 */
function handle(R, H, context, owner, handler, event) {
  try {
    within(R, H, () => $with(R, context, () => $batch(R, () => handler(event))));
  } catch (error) {
    const left = $deliver(R, owner, error);
    // What the handler wrote before it threw still shows.
    if (!R.closed) $flush(R);
    if (left !== null) throw left;
  }
}

/**
 * The runner of the last delegated handler bound; the next handler of the
 * same owner and context shares it. mount's dispose drops it for its root.
 * @type {Runner | null}
 */
let runner = null;

/**
 * A reactive property: computed in the graph, applied in the Render phase.
 * A pending read keeps the previous value and reports to the nearest Pending.
 * @param {import('rrx-core/core').Graph} R @param {Host} H @param {any} node @param {string} name @param {any} source
 */
function bind(R, H, node, name, source) {
  const p = new Prop(H, node, name, source);
  if (name === 'value') values.set(node, p);
  $bind(R, p, readSource);
}

/** The `value` binding of each node that has one (a controlled Edit). @type {WeakMap<any, Prop>} */
const values = new WeakMap();

/** A value as an Edit shows it. @param {any} value */
const shown = value => (value == null ? '' : String(value));

/**
 * A controlled Edit's change handler: when the flush the handler starts applies no new value to the
 * Edit's `value` binding and the typed text differs from the bound value,
 * the Edit shows its bound value again (a rejected keystroke, a filter). An
 * Edit without a `value` binding, or an event without a string `value` (a
 * DOM element's own change event), runs the handler alone. The same code
 * runs in the worker, so worker mode behaves alike.
 * @param {import('rrx-core/core').Graph} R @param {Host} H @param {any} node @param {(event: any) => void} handler
 * @returns {(event: any) => void}
 */
function controlled(R, H, node, handler) {
  return event => {
    const p = values.get(node);
    if (p === undefined || event == null || typeof event.value !== 'string') {
      handler(event);
      return;
    }
    const before = p.previous;
    const typed = event.value;
    try {
      handler(event);
    } finally {
      // After the flush's Render phase and `$commit` hooks: a binding that changed has applied by then.
      $after(R, () => {
        if (R.closed || p.previous !== before || typed === shown(before)) return;
        H.set(node, 'value', before, before);
        if (H.present !== undefined) H.present();
      });
    }
  };
}

/**
 * A binding's state: an rrx-core Application whose fields replace the
 * closures of a Render (one node and this record per binding). A pending
 * read finds its boundary then (the nearest Pending, or a region's build):
 * a binding that never waits costs nothing for it.
 */
class Bound extends Application {
  /** @param {(value: any) => void} run @param {any} source */
  constructor(run, source) {
    super(run, true);
    this.source = source;
    /** The boundary its pending reads report to, found at the first. @type {Boundary | null} */
    this.boundary = null;
    this.waiting = false;
    /** True once its owner's cleanup settles a wait left open when it stops. */
    this.released = false;
  }
}

/** A property binding. */
class Prop extends Bound {
  /** @param {Host} H @param {any} node @param {string} name @param {any} source */
  constructor(H, node, name, source) {
    super(applyProp, source);
    this.H = H;
    this.node = node;
    this.name = name;
    /** @type {any} */
    this.previous = undefined;
  }
}

/**
 * Reads a binding's source (`this` is its node). The first value applies at
 * once, as the node is built (as a static property does), so it never waits
 * in the Render queue; later values apply in the Render phase. A pending
 * read keeps the value shown and reports to its boundary; a shown value
 * suspends the binding, so its update is held whole until the read is ready
 * (a transition), unless its boundary shows its fallback anew
 * (`Pending again`).
 * @this {any}
 */
function readSource() {
  const b = /** @type {Bound} */ (this.apply);
  try {
    const value = read(b.source);
    if (b.waiting) settled(b);
    if (b.applied === 0) {
      b.applied = 1;
      b.shown = value;
      b.run(value);
    }
    return value;
  } catch (error) {
    if (error !== WAITING) throw error;
    waitedOn();
    const boundary = waits(this, b);
    if (b.applied === 1 && (boundary === null || boundary.revealed())) suspend(this);
    return b.shown;
  }
}

/**
 * A binding's read waits: it reports to its boundary once, and settles it
 * when it stops waiting or its owner stops. Returns the boundary.
 * @param {any} x the binding's node @param {Bound} b
 * @returns {Boundary | null}
 */
function waits(x, b) {
  if (b.waiting) return b.boundary;
  const boundary = b.boundary ?? (b.boundary = $lookup(x.root, PENDING_BOUNDARY));
  if (boundary === null) return null;
  b.waiting = true;
  boundary.wait();
  if (!b.released) {
    b.released = true;
    const R = x.root;
    $cleanup(x.owner, () => {
      if (b.waiting && !R.closed) settled(b);
    });
  }
  return boundary;
}

/** A binding's read is ready again: its boundary no longer waits for it. @param {Bound} b */
function settled(b) {
  b.waiting = false;
  /** @type {Boundary} */ (b.boundary).settle();
}

/** @this {Prop} @param {any} value */
function applyProp(value) {
  this.H.set(this.node, this.name, value, this.previous);
  this.previous = value;
}

/**
 * A text binding: a node source (signal or memo) whose value is text, shown
 * by one Text node through `content`. A value that needs structure hands
 * the node to a region, which takes it as its end marker.
 */
class Text extends Bound {
  /** @param {Host} H @param {any} text @param {any} source */
  constructor(H, text, source) {
    super(applyText, source);
    this.H = H;
    this.text = text;
    /** @type {any} */
    this.self = null;
  }
}

/** @this {Text} @param {any} value */
function applyText(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    this.H.content(this.text, String(value));
    return;
  }
  // Structure: a region adopts the text node, and this binding stops.
  const R = this.self.root;
  const H = this.H;
  $cancel(this.self);
  $untrack(R, () => within(R, H, () => region(R, H, this.source, null, true, this.text)));
}

/**
 * A reactive child inside an element: a node source whose value is text
 * binds one Text node directly (no region, no effect closure, no scope);
 * anything else is a region.
 * @param {import('rrx-core/core').Graph} R @param {Host} H @param {any} source @param {any[] | null} out @param {any} adopt
 */
function child(R, H, source, out, adopt) {
  if (source instanceof Node) {
    // An untracked look at the value (no closure: the root's current observer is set aside).
    let value;
    const current = R.current;
    R.current = null;
    try {
      value = $read(source);
    } catch (error) {
      if (error !== WAITING) throw error;
      value = null;
    } finally {
      R.current = current;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const text = adopt ?? H.text('');
      if (adopt === null) /** @type {any[]} */ (out).push(text);
      const app = new Text(H, text, source);
      app.self = $bind(R, app, readSource);
      return;
    }
  }
  region(R, H, source, out, true, adopt);
}

/**
 * A binding or region that stops while it waits releases its boundary.
 * @param {import('rrx-core/core').Graph} R @param {() => boolean} waiting @param {{ settle: () => void }} boundary
 */
function release(R, waiting, boundary) {
  const owner = $owner(R);
  if (owner !== null)
    $cleanup(owner, () => {
      if (waiting() && !R.closed) boundary.settle();
    });
}

// ---------------------------------------------------------------------------
// Insertion

/**
 * Inserts a view into `parent` before `before`. What it resolves stays
 * inside `parent`, so a reactive text there needs no markers (see region).
 * @param {import('rrx-core/core').Graph} R @param {Host} H @param {any} parent @param {any} value @param {any} before
 */
function insert(R, H, parent, value, before) {
  /** @type {any[]} */
  const out = [];
  if (into === parent) resolve(R, H, value, out, true);
  else at(parent, () => resolve(R, H, value, out, true));
  for (let i = 0; i < out.length; i++) H.insert(parent, out[i], before);
}

/**
 * Flattens a view into host nodes, materializing components and opening
 * regions for accessors. `inside` holds when the nodes go into an element
 * (or between a region's markers) and nothing keeps their list: a reactive
 * text there is one text node, whose markers, should it ever grow structure,
 * land inside that element. A row, a portal, a boundary's content and a
 * mounted view keep their nodes, so their regions keep markers.
 * @param {import('rrx-core/core').Graph} R @param {Host} H @param {any} value @param {any[]} out @param {boolean} inside
 */
function resolve(R, H, value, out, inside) {
  if (value == null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    out.push(H.text(value));
    return;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    out.push(H.text(String(value)));
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) resolve(R, H, value[i], out, inside);
    return;
  }
  if (value instanceof Template) {
    out.push(instance(R, H, value));
    return;
  }
  if (value instanceof Lazy) {
    if (typeof value.component === 'string') out.push(element(R, H, value.component, value.props));
    else resolve(R, H, materialize(R, H, value), out, inside);
    return;
  }
  if (typeof value === 'function' || value instanceof Node) {
    if (inside) child(R, H, value, out, null);
    else region(R, H, value, out, false, null);
    return;
  }
  if (value instanceof List) {
    list(R, H, value, out, null);
    return;
  }
  if (value instanceof Provided) {
    // <Context value={…}>: the children build under a provider.
    const children = value.children;
    $provide(R, value.context, value.value, () => resolve(R, H, children, out, inside));
    return;
  }
  if (H.owns(value)) {
    out.push(value);
    return;
  }
  if (value instanceof Range) {
    // A part of several nodes ($parts), placed whole.
    const nodes = rangeNodes(H, value);
    for (let i = 0; i < nodes.length; i++) out.push(nodes[i]);
    return;
  }
  out.push(H.text(String(value)));
}

// ---------------------------------------------------------------------------
// Children as rendered ($parts)

/** A part `$parts` built: its nodes (a host node, a Range, or null for none) and the scope they live in (null: none of its own). */
class Built {
  /** @param {import('rrx-core/core').Owner | null} scope @param {any} value */
  constructor(scope, value) {
    this.scope = scope;
    this.value = value;
  }
}

/** The control flow `$parts` opens: what it shows is parts, not one part. @type {ReadonlySet<Function>} */
const OPENED = new Set([Show, Choose, Render, For, Times]);

/**
 * The parts `child` shows now, as a reactive list, for a component that
 * lays its children out one by one: a separator between two, each in a cell
 * of its own. A part is a host node, or several kept together, which a row
 * of a `For` over the list renders as its child (keyed by the part, the row
 * keeps it and its place; its accessor never changes). The child is opened as written: arrays and
 * fragments, an accessor or a reactive node (what it holds now), `Show`,
 * `Choose` and `Render` (what they show now: nothing when they show
 * nothing), and `For` and `Times` (each row a part, or the fallback's
 * parts); nothing, null and booleans give none. Any other component,
 * element or text is one part, built once while it stays in the child (a
 * component showing nothing, at its build, is none). Parts that leave stop.
 * They are built on the list's first read, for the element it is read in
 * (a `For`'s: where the parts go). Call it in a component, as a `For`'s `each`:
 * `<For each={$parts(props.children)}>{(part, i) => [() => (i() > 0 ? <Line /> : null), part]}</For>`.
 * @param {any} child
 * @returns {import('rrx-core/core').Readable<readonly any[]>}
 */
export function $parts(child) {
  const R = $active();
  const H = $surface();
  const context = R.ctx;
  const home = $scope(R, $owner(R));
  const shown = $writable($signal(R, /** @type {readonly any[]} */ ([])));
  /** The element the parts go into, as `element` hears it: where the list is first read (its element), else where the call is made. */
  let place = into;
  /** What was built, by what it was built from: a descriptor, an object, a text and its count. @type {Map<any, Built>} */
  let built = new Map();
  /** How many rows each list showed at the last run. @type {Map<List, number>} */
  let shownRows = new Map();
  /** Builds `fn` once, in a scope of its own under the call's owner and context, untracked. @param {() => any} fn */
  const make = fn => {
    const scope = $scope(R, home);
    const value = $untrack(R, () => $with(R, context, () => $enter(scope, () => within(R, H, () => at(place, fn)))));
    return new Built(scope, value);
  };
  /** Makes `fn`'s nodes (a memo) in a scope of its own under the call's owner and context, tracked where they are read. @param {() => any} fn */
  const make0 = fn => {
    const scope = $scope(R, home);
    return new Built(scope, $with(R, context, () => $enter(scope, fn)));
  };
  /** One part from anything: its nodes, kept together. @param {any} value */
  const one = value => {
    /** @type {any[]} */
    const nodes = [];
    resolve(R, H, value, nodes, false);
    if (nodes.length === 0) return null;
    if (nodes.length === 1) return nodes[0];
    const start = H.marker();
    const end = H.marker();
    nodes.unshift(start);
    nodes.push(end);
    return new Range(start, end, nodes);
  };
  // The parts are built on the list's first read, where it goes: in its element.
  let started = false;
  const start = () =>
    $effect(R, () => {
      /** @type {Map<any, Built>} */
      const next = new Map();
      /** @type {any[]} */
      const out = [];
      /** @type {Map<string, number>} */
      const texts = new Map();
      /** How many rows each list shows now. @type {Map<List, number>} */
      const counts = new Map();
      /** What the retired rows' closes raised. @type {Failure | null} */
      let lost = null;
      /** The part built from `key`, again or now. @param {any} key @param {() => Built} build */
      const reuse = (key, build) => {
        let b = built.get(key) ?? next.get(key);
        if (b === undefined) b = build();
        next.set(key, b);
        return b;
      };
      /** @param {any} value */
      const gather = value => {
        if (value == null || typeof value === 'boolean') return;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
          const text = String(value);
          const n = (texts.get(text) ?? 0) + 1;
          texts.set(text, n);
          out.push(reuse(`${n} ${text}`, () => new Built(null, H.text(text))).value);
          return;
        }
        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) gather(value[i]);
          return;
        }
        if (value instanceof Node) {
          gather($read(value));
          return;
        }
        if (typeof value === 'function') {
          // An accessor: a memo of its own, so it runs again only when what it reads changes.
          gather($read(reuse(value, () => make0(() => $memo(R, value))).value));
          return;
        }
        if (value instanceof Lazy && typeof value.component !== 'string' && OPENED.has(value.component)) {
          // Control flow: built once, what it shows opened.
          gather(reuse(value, () => make(() => materialize(R, H, value))).value);
          return;
        }
        if (value instanceof List) {
          // As a list region reads it: the items first, so a change reruns
          // this before anything pulls the rows; a large clear or replace
          // retires every row, and what retired rows hold outside themselves
          // (portals, nested roots) closes now.
          const pace = value.pace;
          const before = shownRows.get(value) ?? 0;
          if (value.items !== null) {
            const items = $read(value.items);
            if (pace !== null && before >= pace.threshold && value.gone(items)) {
              value.renew();
              lost ??= closeRetired(pace);
            }
          }
          const rows = $read(value.rows);
          if (pace !== null && before >= pace.threshold) lost ??= closeRetired(pace);
          counts.set(value, rows.length);
          for (let i = 0; i < rows.length; i++) out.push(rows[i]);
          if (rows.length === 0 && value.fallback != null) gather(value.fallback);
          return;
        }
        if (value instanceof Range || H.owns(value)) {
          out.push(value);
          return;
        }
        // An element, a template, a component, any other child: one part.
        const part = reuse(value, () => make(() => one(value))).value;
        if (part !== null) out.push(part);
      };
      try {
        at(place, () => gather(child));
      } catch (error) {
        if (error !== WAITING) throw error;
        // A read that waits keeps the parts shown; what this run built stays for the next.
        waitedOn();
        for (const [key, b] of next) built.set(key, b);
        for (const [list, n] of counts) shownRows.set(list, n);
        raise(lost);
        return;
      }
      // What it does not show now stops.
      for (const [key, b] of built) if (!next.has(key) && b.scope !== null) $stop(b.scope);
      built = next;
      shownRows = counts;
      $write(shown, out);
      raise(lost);
    });
  return $memo(R, () => {
    if (!started) {
      started = true;
      if (into !== null) place = into;
      $untrack(R, () => $enter(home, start));
    }
    return $read(shown);
  });
}

/**
 * Calls a component body or a row or branch callback, which runs untracked.
 * In development, a reactive read made there (not inside JSX, a memo or an
 * accessor) is reported: it happens once, and nothing updates when the value
 * changes (a common mistake). `$untrack` marks a read as meant.
 * @template T @param {import('rrx-core/core').Graph} R @param {string} name @param {(a: any, b: any) => T} fn @param {any} a @param {any} b
 * @returns {T}
 */
function body(R, name, fn, a, b) {
  if (!development()) return fn(a, b);
  const [value, reads] = counted(R, () => fn(a, b));
  if (reads > 0)
    diagnose(`REN dev: ${name} read reactive state in its body, where nothing tracks it: it will not update. Read it in JSX or an accessor (() => …), or in a memo; wrap a read meant once in $untrack.`);
  return value;
}

/**
 * Runs a component untracked in its own scope under the current owner, so
 * its effects stop with the region that rendered it.
 * @param {import('rrx-core/core').Graph} R @param {Host} H @param {Lazy} lazy
 */
function materialize(R, H, lazy) {
  const scope = $scope(R, $owner(R));
  try {
    return $untrack(R, () => $enter(scope, () => within(R, H, () => body(R, lazy.component.name || 'a component', lazy.component, lazy.props, undefined))));
  } catch (error) {
    if (error !== WAITING) throw error;
    // The body read a pending value: it runs again tracked (see waited).
    waitedOn();
    $stop(scope);
    return () => lazy.component(lazy.props);
  }
}

/**
 * Calls a row or branch callback untracked (`body`). One that reads a
 * pending value, where nothing tracks the read, gives instead an accessor
 * that calls it again tracked: in the region that accessor opens it waits
 * as a reactive read does (its Pending shows the fallback), and it runs
 * again once what it read changes. A component body does the same
 * (`materialize`).
 * @template T @param {import('rrx-core/core').Graph} R @param {string} name @param {(a: any, b: any) => T} fn @param {any} a @param {any} b
 * @returns {T | (() => T)}
 */
function waited(R, name, fn, a, b) {
  try {
    return body(R, name, fn, a, b);
  } catch (error) {
    if (error !== WAITING) throw error;
    waitedOn();
    return () => fn(a, b);
  }
}

/**
 * Regions and lists that changed while their place was detached: inside the
 * content a waiting Pending holds, which is in no host parent until the
 * Pending shows it. Each root keeps them as flat (owner, retry) pairs, and a
 * Pending that places its content retries them after that flush.
 */
class Detached {
  constructor() {
    /** @type {any[]} */
    this.queue = [];
    this.scheduled = false;
  }
}

/** @type {WeakMap<import('rrx-core/core').Graph, Detached>} */
const detached = new WeakMap();

/** Queues a retry for when the owner's place is attached. @param {import('rrx-core/core').Graph} R @param {any} owner @param {() => void} retry */
function later(R, owner, retry) {
  let d = detached.get(R);
  if (d === undefined) detached.set(R, (d = new Detached()));
  d.queue.push(owner, retry);
  // Placements run in the Render phase, after a Pending may have shown its
  // content in the same flush: retry once this flush settles.
  reattach(R);
}

/**
 * Retries the detached updates once this flush settles (a Pending placed its
 * content). A retry that is still detached queues itself again; the drain
 * repeats while it makes progress, so nested Pendings place in turn.
 * @param {import('rrx-core/core').Graph} R
 */
function reattach(R) {
  const d = detached.get(R);
  if (d === undefined || d.queue.length === 0 || d.scheduled) return;
  d.scheduled = true;
  $after(R, () => {
    d.scheduled = false;
    for (;;) {
      const q = d.queue;
      if (q.length === 0) return;
      d.queue = [];
      for (let i = 0; i < q.length; i += 2) if ($alive(q[i])) q[i + 1]();
      if (d.queue.length >= q.length) return;
    }
  });
}

// ---------------------------------------------------------------------------
// Background disposal (see sweep.js): each application root's Pace.

/** @type {WeakMap<import('rrx-core/core').Graph, Pace>} */
const paces = new WeakMap();

/**
 * The root's Pace when drops made at this point may retire: never under a
 * Pending boundary, whose count a retired waiter would hold until swept.
 * @param {import('rrx-core/core').Graph} R @param {any} boundary
 * @returns {Pace | null}
 */
function pacing(R, boundary) {
  // A build's probe is not a Pending: the Pending around it, if any, decides.
  let b = boundary;
  while (b instanceof Probe) b = b.outer;
  if (b !== null) return null;
  const pace = paces.get(R);
  return pace === undefined || pace.threshold === Infinity ? null : pace;
}

/**
 * True when `scope` owns a list of at least the threshold's rows: dropping
 * it retires instead of stopping. Walks up from each large list (few).
 * @param {Pace} pace @param {import('rrx-core/core').Owner} scope
 */
function heavy(pace, scope) {
  const big = pace.big;
  if (big === null || big.size === 0) return false;
  for (const list of big) {
    if (!$alive(list.scope)) {
      big.delete(list);
      continue;
    }
    for (let s = /** @type {any} */ (list.scope); s != null; s = s.owner) if (s === scope) return true;
  }
  return false;
}

/**
 * Registers what must close when `owner` is retired rather than when it is
 * swept (a portal's nodes, a nested root); returns the record to `forget`.
 * @param {import('rrx-core/core').Graph} R @param {import('rrx-core/core').Owner | null} owner @param {() => void} close
 * @returns {Eager | null}
 */
export function eager(R, owner, close) {
  const pace = paces.get(R);
  if (pace === undefined || owner === null) return null;
  const record = new Eager(owner, close);
  (pace.eager ??= new Set()).add(record);
  return record;
}

/** @param {import('rrx-core/core').Graph} R @param {Eager | null} record */
export function forget(R, record) {
  if (record !== null) paces.get(R)?.eager?.delete(record);
}

/**
 * Something was retired: close what its subtree holds outside it at once.
 * @param {Pace} pace
 */
function retired(pace) {
  const set = pace.eager;
  if (set === null || set.size === 0) return;
  /** @type {Failure | null} */
  let failure = null;
  for (const record of set) {
    if ($alive(record.owner)) continue;
    set.delete(record);
    try {
      record.close();
    } catch (error) {
      failure ??= new Failure(error);
    }
  }
  raise(failure);
}

/** Closes what retired work holds outside itself; returns what that raised, or null. @param {Pace} pace @returns {Failure | null} */
function closeRetired(pace) {
  try {
    retired(pace);
    return null;
  } catch (error) {
    return new Failure(error);
  }
}

/**
 * Drops a region's old content: retired when it holds a large list (its
 * host nodes are already gone), stopped otherwise.
 * @param {Pace | null} pace @param {import('rrx-core/core').Owner} scope
 * @returns {Failure | null}
 */
function letGo(pace, scope) {
  if (pace === null || !heavy(pace, scope)) return halt(scope);
  $retire(scope);
  try {
    retired(pace);
    return null;
  } catch (error) {
    return new Failure(error);
  }
}

/** What a stopping scope's cleanups raised, kept until the host update completes. */
class Failure {
  /** @param {unknown} error */
  constructor(error) {
    this.error = error;
  }
}

/**
 * Stops a scope and returns what its cleanups raised, or null. Every cleanup
 * runs either way; the caller completes its host update first and raises the
 * failure after, so a throwing cleanup never leaves a stale view.
 * @param {import('rrx-core/core').Owner} scope
 * @returns {Failure | null}
 */
function halt(scope) {
  try {
    $stop(scope);
    return null;
  } catch (error) {
    return new Failure(error);
  }
}

/** Raises a failure kept by `halt`. @param {Failure | null} failure */
function raise(failure) {
  if (failure !== null) throw failure.error;
}

/**
 * A dynamic child. Its effect reads the source tracked; a text (string or
 * number) is one text node whose `data` follows it, and anything else is
 * rebuilt in a fresh scope between two markers. Inside an element the
 * region starts as the bare text node and adds its markers only when a
 * value first needs structure. `adopt` is an empty text node already in
 * place (a template's slot): the region's text, or its end marker.
 * A node source (a signal or memo) creates nothing when read, so its runs
 * need no scope of their own until they build structure.
 * @param {import('rrx-core/core').Graph} R @param {Host} H @param {any} source @param {any[] | null} out @param {boolean} inside @param {any} adopt
 */
function region(R, H, source, out, inside, adopt) {
  /** @type {any} */
  let start = null;
  /** @type {any} */
  let end = null;
  if (!inside) {
    start = H.marker();
    end = H.marker();
    /** @type {any[]} */ (out).push(start);
  }
  const boundary = $lookup(R, PENDING_BOUNDARY);
  let waiting = false;
  if (boundary !== null) release(R, () => waiting, boundary);
  const home = $owner(R);
  // A Pending's own region shows its fallback or content at once, never held.
  const indicator = typeof source === 'function' && indicators.has(source);
  // Content built while the region's place was detached waits here to be
  // placed; hold is the bare slot that becomes the end marker.
  /** @type {any[] | null} */
  let unplaced = null;
  /** @type {any} */
  let hold = null;
  let queued = false;
  const place = () => {
    const nodes = unplaced;
    if (nodes === null) return;
    const anchor = start === null ? hold : end;
    const parent = H.parent(anchor);
    if (parent === null) {
      if (boundary !== null && !queued) {
        queued = true;
        later(R, home, retry);
      }
      return;
    }
    unplaced = null;
    if (start === null) {
      // The bare text (or the adopted slot) becomes the end marker.
      start = H.marker();
      H.insert(parent, start, anchor);
      H.content(anchor, '');
      end = anchor;
      hold = null;
    }
    clear(H, parent, start, end);
    for (let i = 0; i < nodes.length; i++) H.insert(parent, nodes[i], end);
  };
  const retry = () => {
    queued = false;
    within(R, H, place);
  };
  const pure = source instanceof Node;
  /** The shown content's scope. @type {import('rrx-core/core').Owner | null} */
  let scope = null;
  /** The shown bare text node (a plain value). @type {any} */
  let text = null;
  // The first run builds into `out`; later runs build detached and place in
  // the Render phase. The effect drops `out` after its first run, so the
  // nodes it held are not kept alive by the region once they are replaced.
  /** @type {any[] | null} */
  let sink = out;
  let fresh = true;
  /** @type {any} */
  let value;
  /** @type {import('rrx-core/core').Owner | null} */
  let next = null;
  /** The update built and not yet placed. @type {Update | null} */
  let staged = null;
  /** The region's gate: its placements, applied in the Render phase. @type {Gate | null} */
  let gate = null;
  /** True once a value (not the empty place of a pending first read) was shown. */
  let showed = false;
  const compute = () => {
    const a = active;
    const h = host;
    active = R;
    host = H;
    try {
      return read(source);
    } finally {
      active = a;
      host = h;
    }
  };
  // Places an update: the old content stops (retired when it holds a large
  // list), the new one takes its place. What the old content's cleanups
  // raise waits until the new content is placed.
  const commit = (/** @type {Update} */ u) => {
    if (u !== staged) return;
    staged = null;
    /** @type {Failure | null} */
    let failed = null;
    within(R, H, () => {
      if (u.probe !== null) u.probe.close();
      if (u.nodes === null && text !== null) {
        // A plain value over a bare text: its data changes.
        if (scope !== null) {
          failed = letGo(pacing(R, boundary), scope);
          scope = null;
        }
        H.content(text, u.text);
        return;
      }
      /** @type {any[]} */
      let nodes;
      let own = u.scope;
      if (u.nodes === null) {
        // A plain value over structure: its text node is built now.
        own = $scope(R, home);
        nodes = [H.text(u.text)];
      } else nodes = u.nodes;
      if (scope !== null) failed = letGo(pacing(R, boundary), scope);
      replacing.delete(/** @type {any} */ (scope));
      scope = own;
      if (start === null && hold === null) hold = text ?? adopt;
      text = u.shown;
      unplaced = nodes;
      place();
    });
    raise(failed);
  };
  /** Stages an update for the gate. @param {Update | null} u null: the region's read waits */
  const request = u => {
    if (staged !== null) discard(staged);
    staged = u;
    const slot = u ?? PENDING_UPDATE;
    if (gate === null) gate = open(R, slot, commit, indicator);
    else $write(gate.slot, slot);
  };
  $effect(R, () => {
    const initial = sink;
    const first = fresh;
    sink = null;
    fresh = false;
    // A function source runs, tracked, inside the scope of this run, so
    // nodes it creates stop with the content they belong to; reading a
    // node creates nothing. An update's scope reports to its build's probe.
    next = null;
    /** @type {Probe | null} */
    let probe = null;
    // A run that reads $pending, $behind or $lastReady shows an indicator: its placement is never held.
    const peeks = peekCount();
    try {
      if (pure) value = compute();
      else {
        if (!first) probe = new Probe(R, boundary);
        next = probe === null ? $scope(R, $owner(R)) : $with(R, probe.layer(R), () => $scope(R, $owner(R)));
        value = $enter(next, compute);
      }
    } catch (error) {
      if (next !== null) $stop(next);
      if (error !== WAITING) throw error;
      waitedOn();
      if (!waiting) {
        waiting = true;
        if (boundary !== null) boundary.wait();
      }
      if (first) {
        // A bare region keeps its place with an empty text while it waits.
        if (start === null) {
          text = adopt ?? H.text('');
          if (initial !== null) initial.push(text);
        }
      } else if (showed && (boundary === null || boundary.revealed())) request(null);
      else if (staged !== null) {
        discard(staged);
        staged = null;
      }
      return;
    }
    if (waiting) {
      waiting = false;
      if (boundary !== null) boundary.settle();
    }
    showed = true;
    const plain = typeof value === 'string' || typeof value === 'number';
    if (!first) {
      // An update: built detached now, placed in the Render phase.
      if (plain) {
        const failed = next !== null ? halt(next) : null;
        const u = new Update(String(value), null, null, null, null);
        u.indicator = peekCount() !== peeks;
        request(u);
        raise(failed);
        return;
      }
      probe ??= new Probe(R, boundary);
      const p = probe;
      const own = next ?? $with(R, p.layer(R), () => $scope(R, $owner(R)));
      if (scope !== null) replacing.add(scope);
      /** @type {any[]} */
      const nodes = [];
      // Built apart, for the element its place is in.
      const anchor = start !== null ? end : (hold ?? text ?? adopt);
      const parent = anchor == null ? null : H.parent(anchor);
      $untrack(R, () => within(R, H, () => at(parent, () => $enter(own, () => resolve(R, H, value, nodes, true)))));
      const shown = nodes.length === 1 && (typeof value === 'string' || typeof value === 'number') ? nodes[0] : null;
      const u = new Update('', nodes, own, shown, p);
      u.indicator = peekCount() !== peeks;
      request(u);
      return;
    }
    if (plain && start === null) {
      // Bare text: one node, no markers.
      const failed = next !== null ? halt(next) : null;
      if (adopt !== null) {
        text = adopt;
        H.content(text, String(value));
      } else {
        text = H.text(String(value));
        /** @type {any[]} */ (initial).push(text);
      }
      raise(failed);
      return;
    }
    $untrack(R, () =>
      within(R, H, () => {
        const own = next ?? $scope(R, $owner(R));
        scope = own;
        /** @type {any[]} */
        const nodes = [];
        // A template's slot is in its element already; other first content goes where `out` goes.
        if (initial === null) at(H.parent(adopt), () => $enter(own, () => resolve(R, H, value, nodes, true)));
        else $enter(own, () => resolve(R, H, value, nodes, true));
        const shown = plain && nodes.length === 1 ? nodes[0] : null;
        if (initial === null) {
          // No list to fill (a template's slot): the content takes the slot's place.
          if (start === null && hold === null) hold = text ?? adopt;
          text = shown;
          unplaced = nodes;
          place();
          return;
        }
        text = shown;
        if (start === null) {
          start = H.marker();
          end = H.marker();
          initial.push(start);
          for (let i = 0; i < nodes.length; i++) initial.push(nodes[i]);
          initial.push(end);
        } else for (let i = 0; i < nodes.length; i++) initial.push(nodes[i]);
      }),
    );
  });
  if (!inside) /** @type {any[]} */ (out).push(end);
}

/**
 * A region's or list's update, built but not yet placed: a text (`nodes`
 * null) or detached content in its scope, with the probe its build reported
 * to. `rows` is a list's new rows.
 */
class Update {
  /**
   * @param {string} text @param {any[] | null} nodes @param {import('rrx-core/core').Owner | null} scope @param {any} shown
   * @param {Probe | null} probe @param {readonly any[] | null} [rows]
   */
  constructor(text, nodes, scope, shown, probe, rows = null) {
    this.text = text;
    this.nodes = nodes;
    this.scope = scope;
    this.shown = shown;
    this.probe = probe;
    this.rows = rows;
    /** Its run read an indicator ($pending, $lastReady): placed at once, never held. */
    this.indicator = false;
  }
}

/** A region's or list's read waits while its content shows: its gate holds. */
const PENDING_UPDATE = new Update('', null, null, null, null);

/** Stops an update that a newer one superseded before it was placed. @param {Update} u */
function discard(u) {
  if (u.probe !== null) u.probe.close();
  if (u.scope !== null) {
    const failed = halt(u.scope);
    raise(failed);
  }
}

/**
 * A build's boundary. It counts what an update's new content waits on and
 * passes each wait on to the boundary around (a Pending), so the gate knows
 * whether the new content is ready: content that waits under a boundary
 * showing its content keeps the old content in place until it is (stale
 * content stays visible). Closed once its update is placed or dropped.
 */
class Probe {
  /** @param {import('rrx-core/core').Graph} R @param {Boundary | null} outer */
  constructor(R, outer) {
    this.R = R;
    this.outer = outer;
    this.n = 0;
    /** The count as a signal, made when a gate first reads a wait. @type {import('rrx-core/core').Writable<number> | null} */
    this.count = null;
    this.closed = false;
  }
  /** The context layer that makes this probe the boundary. @param {import('rrx-core/core').Graph} R */
  layer(R) {
    return new Layer(R.ctx, PENDING_BOUNDARY, null, this, false);
  }
  wait() {
    if (!this.closed) {
      this.n++;
      if (this.count !== null) $write(this.count, this.n);
    }
    if (this.outer !== null) this.outer.wait();
  }
  settle() {
    if (!this.closed) {
      this.n--;
      if (this.count !== null) $write(this.count, this.n);
    }
    if (this.outer !== null) this.outer.settle();
  }
  /** Its content is on screen once placed, where the boundary around shows it. */
  revealed() {
    return this.closed && (this.outer === null || this.outer.revealed());
  }
  /** New content waiting here holds only under a Pending that shows its content. */
  holds() {
    return this.outer !== null && this.outer.holds();
  }
  /** True while the new content waits where it holds the old in place (tracked). */
  holding() {
    if (this.closed || this.n === 0 || !this.holds()) return false;
    if (this.count === null) this.count = $writable($signal(this.R, this.n));
    return $read(this.count) > 0;
  }
  close() {
    this.closed = true;
    const count = this.count;
    this.count = null;
    if (count !== null) $discard(count);
  }
}

/** Old content a region is replacing: a nested root in it gives its id to the new content. @type {WeakSet<object>} */
const replacing = new WeakSet();

/**
 * True when `owner` lies in content a region is replacing (for root.js: a
 * nested root there hands its id over instead of refusing the new one).
 * @param {any} owner
 */
export function replaced(owner) {
  for (let s = owner; s != null; s = s.owner) if (replacing.has(s)) return true;
  return false;
}

/** The regions whose placements are indicators (a Pending's), never held. @type {WeakSet<Function>} */
const indicators = new WeakSet();

/**
 * A region's or list's gate: a Render whose read is the staged update and
 * whose application places it, in the Render phase, where a transition holds
 * it. Its read suspends while the region's own read waits, or while the
 * update's new content waits where content shows.
 */
class Gate extends Application {
  /** @param {import('rrx-core/core').Writable<Update>} slot @param {(u: Update) => void} place @param {boolean} indicator */
  constructor(slot, place, indicator) {
    super(applyGate, true);
    this.slot = slot;
    this.place = place;
    this.indicator = indicator;
  }
}

/** @this {Gate} @param {Update} u */
function applyGate(u) {
  if (u !== undefined && u !== PENDING_UPDATE) this.place(u);
}

/** @this {any} */
function readGate() {
  const g = /** @type {Gate} */ (this.apply);
  const u = $read(g.slot);
  if (g.indicator || u.indicator) peeked();
  if (u === PENDING_UPDATE || (u.probe !== null && u.probe.holding())) {
    suspend(this);
    return g.shown;
  }
  return u;
}

/**
 * Opens a gate staged with its first update.
 * @param {import('rrx-core/core').Graph} R @param {Update} first @param {(u: Update) => void} place @param {boolean} indicator
 */
function open(R, first, place, indicator) {
  const gate = new Gate($writable($signal(R, first)), place, indicator);
  $bind(R, gate, readGate);
  return gate;
}

/** Removes the nodes between two markers. @param {Host} H @param {any} parent @param {any} start @param {any} end */
function clear(H, parent, start, end) {
  let n = H.next(start);
  while (n !== null && n !== end) {
    const after = H.next(n);
    H.remove(parent, n);
    n = after;
  }
}

/**
 * Builds a row's host nodes once in its row scope: the node itself when the
 * row is one node, a Range between markers otherwise.
 * @param {import('rrx-core/core').Graph} R @param {Host} H @param {any} view
 * @returns {any}
 */
function range(R, H, view) {
  // A compiled row is one element: no node list to gather.
  if (view instanceof Template) return instance(R, H, view);
  /** @type {any[]} */
  const nodes = [];
  resolve(R, H, view, nodes, false);
  if (nodes.length === 1) return nodes[0];
  const start = H.marker();
  const end = H.marker();
  nodes.unshift(start);
  nodes.push(end);
  return new Range(start, end, nodes);
}

/** @param {any} row */
const firstOf = row => (row instanceof Range ? row.first : row);
/** @param {any} row */
const lastOf = row => (row instanceof Range ? row.last : row);

/** Inserts or moves a row before `before`. @param {Host} H @param {any} parent @param {any} row @param {any} before */
function place(H, parent, row, before) {
  if (row instanceof Range) {
    const nodes = rangeNodes(H, row);
    for (let i = 0; i < nodes.length; i++) H.insert(parent, nodes[i], before);
  } else H.insert(parent, row, before);
}

/** Removes a row's nodes. @param {Host} H @param {any} parent @param {any} row */
function drop(H, parent, row) {
  if (row instanceof Range) {
    const nodes = rangeNodes(H, row);
    for (let i = 0; i < nodes.length; i++) H.remove(parent, nodes[i]);
  } else H.remove(parent, row);
}

/**
 * Removes the rows `from`…`to` (exclusive), adjacent in the host: at once
 * where the host clears a sibling run, node by node otherwise.
 * @param {Host} H @param {any} parent @param {any[]} rows @param {number} from @param {number} to
 */
function sweep(H, parent, rows, from, to) {
  if (H.clear !== undefined && to - from > 1) H.clear(parent, firstOf(rows[from]), lastOf(rows[to - 1]));
  else for (let i = from; i < to; i++) drop(H, parent, rows[i]);
}

/**
 * Moves the rows of `a` (in the host, before `after`) into the order of `b`
 * with the fewest host operations:
 * the common prefix and suffix stay; swapped ends move twice; a window of
 * only new rows is inserted and one of only old rows removed at once; in a
 * mixed window the rows on a longest increasing subsequence of old
 * positions stay and only the others move. Rows are compared by identity.
 * @param {Host} H @param {any} parent @param {readonly any[]} a @param {readonly any[]} b @param {any} after
 */
function reconcile(H, parent, a, b, after) {
  const aLength = a.length;
  const bLength = b.length;
  if (bLength === 0) {
    if (aLength > 0) sweep(H, parent, /** @type {any[]} */ (a), 0, aLength);
    return;
  }
  if (aLength === 0) {
    // All new: insert in order (a fragment measured no faster in Chrome).
    for (let i = 0; i < bLength; i++) place(H, parent, b[i], after);
    return;
  }
  let aStart = 0;
  let bStart = 0;
  let aEnd = aLength;
  let bEnd = bLength;
  for (;;) {
    while (aStart < aEnd && bStart < bEnd && a[aStart] === b[bStart]) {
      aStart++;
      bStart++;
    }
    while (aStart < aEnd && bStart < bEnd && a[aEnd - 1] === b[bEnd - 1]) {
      aEnd--;
      bEnd--;
    }
    // The ends of the window swapped places and what lies between stays:
    // two moves, then trim again (a longest increasing subsequence finds
    // the same moves, at the cost of a map; a reversal is left to it).
    if (aEnd - aStart > 2 && a[aStart] === b[bEnd - 1] && a[aEnd - 1] === b[bStart] && a[aStart + 1] === b[bStart + 1]) {
      const tail = bEnd < bLength ? firstOf(b[bEnd]) : after;
      place(H, parent, b[bStart], firstOf(a[aStart]));
      place(H, parent, b[bEnd - 1], tail);
      aStart++;
      bStart++;
      aEnd--;
      bEnd--;
      continue;
    }
    break;
  }
  if (aStart >= aEnd) {
    const before = bEnd < bLength ? firstOf(b[bEnd]) : after;
    for (let i = bStart; i < bEnd; i++) place(H, parent, b[i], before);
    return;
  }
  if (bStart >= bEnd) {
    sweep(H, parent, /** @type {any[]} */ (a), aStart, aEnd);
    return;
  }
  const count = bEnd - bStart;
  /** @type {Map<any, number>} */
  const index = new Map();
  for (let i = bStart; i < bEnd; i++) index.set(b[i], i);
  // sources[new position in the window] = old position, or -1 for a new row.
  const sources = new Int32Array(count).fill(-1);
  const targets = new Int32Array(aEnd - aStart);
  let moved = false;
  let last = 0;
  let kept = 0;
  for (let i = aStart; i < aEnd; i++) {
    const j = index.get(a[i]);
    if (j === undefined) targets[i - aStart] = -1;
    else {
      targets[i - aStart] = j;
      sources[j - bStart] = i;
      kept++;
      if (j < last) moved = true;
      else last = j;
    }
  }
  const before = bEnd < bLength ? firstOf(b[bEnd]) : after;
  if (kept === 0) {
    // Nothing in the window survives: remove it at once, then build.
    sweep(H, parent, /** @type {any[]} */ (a), aStart, aEnd);
    for (let i = bStart; i < bEnd; i++) place(H, parent, b[i], before);
    return;
  }
  for (let i = aStart; i < aEnd; i++) if (targets[i - aStart] < 0) drop(H, parent, a[i]);
  const stay = moved ? increasing(sources) : null;
  let s = stay === null ? -1 : stay.length - 1;
  let next = before;
  for (let i = count - 1; i >= 0; i--) {
    const row = b[bStart + i];
    if (sources[i] < 0) place(H, parent, row, next);
    else if (stay !== null) {
      if (s >= 0 && stay[s] === i) s--;
      else place(H, parent, row, next);
    }
    next = firstOf(row);
  }
}

/**
 * The positions of a longest strictly increasing subsequence of `a`,
 * ignoring negative entries (patience sorting with predecessor links).
 * @param {Int32Array} a
 * @returns {Int32Array}
 */
function increasing(a) {
  const n = a.length;
  const links = new Int32Array(n);
  const tails = new Int32Array(n);
  let length = 0;
  for (let i = 0; i < n; i++) {
    const v = a[i];
    if (v < 0) continue;
    if (length === 0 || a[tails[length - 1]] < v) {
      links[i] = length > 0 ? tails[length - 1] : -1;
      tails[length++] = i;
      continue;
    }
    let lo = 0;
    let hi = length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (a[tails[m]] < v) lo = m + 1;
      else hi = m;
    }
    if (v < a[tails[lo]]) {
      links[i] = lo > 0 ? tails[lo - 1] : -1;
      tails[lo] = i;
    }
  }
  const out = new Int32Array(length);
  for (let k = length - 1, i = tails[length - 1]; k >= 0; k--) {
    out[k] = i;
    i = links[i];
  }
  return out;
}

/**
 * A list region: rows are the host nodes (or ranges) the $rows or $positions memo
 * keeps; an update reconciles the old order with the new one. A list that
 * is its element's only child owns that element (`owned`): no marker, and
 * clearing it empties the element at once. Otherwise it ends at a marker.
 * @param {import('rrx-core/core').Graph} R @param {Host} H @param {List} spec @param {any[] | null} out @param {any} owned
 */
function list(R, H, spec, out, owned) {
  const end = owned === null ? H.marker() : null;
  /** The element the first rows go into; later ones go where the list is. */
  const first0 = owned ?? into;
  /** @type {readonly any[]} */
  let current = [];
  /** @type {any[] | null} */
  let fallback = null;
  /** @type {import('rrx-core/core').Owner | null} */
  let fallbackScope = null;
  // As in region: the first run fills `out`, and the effect drops it then.
  /** @type {any[] | null} */
  let sink = owned === null ? out : null;
  // A pending read of the items keeps the current rows and reports to the
  // nearest Pending, as a region does.
  const boundary = $lookup(R, PENDING_BOUNDARY);
  let waiting = false;
  if (boundary !== null) release(R, () => waiting, boundary);
  const home = $owner(R);
  /** @type {readonly any[]} */
  let latest = [];
  let queued = false;
  /** @type {Failure | null} */
  let failed = null;
  // Places the latest rows. While the list's place is detached (inside the
  // content a waiting Pending holds) it waits for that Pending to show it.
  const update = () => {
    const rows = latest;
    const initial = sink;
    sink = null;
    const parent = owned ?? (initial !== null ? null : H.parent(end));
    if (initial === null && parent === null) {
      if (boundary !== null && !queued) {
        queued = true;
        later(R, home, retry);
      }
      return;
    }
    if (rows.length > 0 && fallback !== null) {
      for (const n of fallback) if (H.parent(n) === parent) H.remove(parent, n);
      if (fallbackScope !== null) failed = halt(fallbackScope);
      fallback = null;
      fallbackScope = null;
    }
    if (initial !== null) {
      for (const row of rows) {
        if (row instanceof Range) for (const n of row.nodes) initial.push(n);
        else initial.push(row);
      }
    } else reconcile(H, parent, current, rows, end);
    current = rows;
    // Fallback when the list is empty.
    if (rows.length === 0 && spec.fallback != null && fallback === null) {
      fallbackScope = $scope(R, home);
      /** @type {any[]} */
      const nodes = [];
      at(parent ?? first0, () => $enter(/** @type {any} */ (fallbackScope), () => resolve(R, H, spec.fallback, nodes, false)));
      fallback = nodes;
      if (initial !== null) for (const n of nodes) initial.push(n);
      else for (const n of nodes) H.insert(parent, n, end);
    }
  };
  const run = () => {
    $untrack(R, () => within(R, H, update));
    const f = failed;
    failed = null;
    raise(f);
  };
  const retry = () => {
    queued = false;
    run();
  };
  // Background disposal: a clear, or a replace that keeps no row, of a list
  // of at least the threshold's rows retires them all at once; the list is
  // known as large to content swaps that would drop it.
  const pace = spec.items !== null ? pacing(R, boundary) : null;
  let large = false;
  let hooked = false;
  // Updates place in the Render phase through the list's gate (as a
  // region's), where a transition holds them.
  let first = true;
  /** @type {Update | null} */
  let staged = null;
  /** @type {Gate | null} */
  let gate = null;
  const commit = (/** @type {Update} */ u) => {
    if (u !== staged) return;
    staged = null;
    if (u.probe !== null) u.probe.close();
    latest = /** @type {readonly any[]} */ (u.rows);
    run();
  };
  /** @param {Update | null} u null: the items' read waits */
  const request = u => {
    if (staged !== null && staged.probe !== null) staged.probe.close();
    staged = u;
    const slot = u ?? PENDING_UPDATE;
    if (gate === null) gate = open(R, slot, commit, false);
    else $write(gate.slot, slot);
  };
  $effect(R, () => {
    /** @type {readonly any[]} */
    let rows;
    /** @type {Failure | null} */
    let lost = null;
    const initial = first;
    first = false;
    /** An update's new rows report to its probe. @type {Probe | null} */
    const probe = initial ? null : new Probe(R, boundary);
    // New rows are made for the element the list is in.
    const outer = into;
    into = initial ? first0 : (owned ?? H.parent(end));
    try {
      // The items are read first, so they are the effect's first source: a
      // change reruns it before anything pulls the rows memo (which would
      // stop the removed rows).
      if (pace !== null) {
        const items = $read(/** @type {any} */ (spec.items));
        if (current.length >= pace.threshold && spec.gone(items)) {
          spec.renew();
          try {
            retired(pace);
          } catch (error) {
            lost = new Failure(error);
          }
        }
      }
      const before = current.length;
      rows = probe === null ? $read(spec.rows) : $with(R, probe.layer(R), () => $read(spec.rows));
      // A large partial removal retired its rows inside the rows memo:
      // close what they hold outside themselves (portals, nested roots) now.
      if (pace !== null && before >= pace.threshold) {
        try {
          retired(pace);
        } catch (error) {
          lost ??= new Failure(error);
        }
      }
    } catch (error) {
      if (error !== WAITING) throw error;
      waitedOn();
      if (!waiting) {
        waiting = true;
        if (boundary !== null) boundary.wait();
      }
      // Nothing to build yet: later runs reconcile into the host. Rows
      // shown hold their update (a transition) while the items wait.
      sink = null;
      if (!initial && current.length > 0 && (boundary === null || boundary.revealed())) request(null);
      return;
    } finally {
      into = outer;
    }
    if (waiting) {
      waiting = false;
      if (boundary !== null) boundary.settle();
    }
    if (pace !== null && (rows.length >= pace.threshold) !== large) {
      large = !large;
      const big = (pace.big ??= new Set());
      if (!large) big.delete(spec);
      else {
        big.add(spec);
        if (!hooked && home !== null) {
          hooked = true;
          $cleanup(home, () => big.delete(spec));
        }
      }
    }
    if (initial) {
      latest = rows;
      run();
    } else request(new Update('', null, null, null, probe, rows));
    raise(lost);
  });
  if (end !== null) /** @type {any[]} */ (out).push(end);
}

/** @param {Host} H @param {Range} row */
function rangeNodes(H, row) {
  /** @type {any[]} */
  const nodes = [];
  for (let n = row.first; n !== null; n = H.next(n)) {
    nodes.push(n);
    if (n === row.last) break;
  }
  return nodes.length > 0 && nodes[nodes.length - 1] === row.last ? nodes : row.nodes;
}

// ---------------------------------------------------------------------------
// Compiled templates (ren-core/esbuild)
//
// The compiler turns each JSX element tree of intrinsic tags into a plan,
// made once per module, and a Template per evaluation holding the values of
// its dynamic parts (in evaluation order). A plan's tree is
// `[tag, statics | null, children, dynamic | null]`: statics are properties
// the host can apply once to a shared template (see the compiler's list);
// children are static texts, nested elements, or the index of a dynamic
// child's value; dynamic is flat `[name, value index, …]`. A host with
// `clone` copies its template of the plan (one per document); any other
// host gets the same nodes built through element, set, text and insert.
// Either way the dynamic parts then apply exactly as the runtime `jsx` path
// applies them.

const PROP = 0;
const CHILD = 1;
const REF = 2;
const ONLY = 3;
const EVENT = 4;

/** A compiled template's plan: its tree, the nodes its parts address, and those parts. */
export class Plan {
  /** @param {any[]} tree */
  constructor(tree) {
    this.tree = tree;
    /**
     * Preorder positions of the nodes an instance holds, ascending, the root
     * first: the nodes the parts address and their ancestors.
     * @type {number[]}
     */
    this.refs = [];
    /** Parts, four words each: kind, node (an index of refs), value index, name index (an event's name lowercased) or only-child flag. @type {number[]} */
    this.ops = [];
    /** @type {string[]} */
    this.names = [];
    /**
     * How a clone reaches its refs, four words per ref after the root:
     * the ref it starts from, 1 to take its first child first, then how many
     * next siblings (the fewest DOM steps).
     * @type {number[]}
     */
    this.path = [];
    /** @type {number[]} */
    const parents = [];
    /** @type {number[]} */
    const indexes = [];
    let position = 0;
    /** @param {any[]} node @param {number} parent @param {number} index */
    const walk = (node, parent, index) => {
      const self = position++;
      parents.push(parent);
      indexes.push(index);
      const children = node[2];
      const dynamic = node[3];
      let ref = -1;
      if (dynamic != null) {
        for (let k = 0; k < dynamic.length; k += 2) {
          const name = dynamic[k];
          if (name === 'key') continue;
          if (name === 'ref') ref = dynamic[k + 1];
          // on + Capital: an event, its name lowercased once per plan.
          else if (eventName(name))
            this.ops.push(EVENT, self, dynamic[k + 1], this.names.push(name.slice(2).toLowerCase()) - 1);
          else this.ops.push(PROP, self, dynamic[k + 1], this.names.push(name) - 1);
        }
      }
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (typeof child === 'number' && children.length === 1) {
          // A dynamic only child fills its element: no slot node in the template.
          this.ops.push(ONLY, self, child, 0);
        } else if (typeof child === 'string' || typeof child === 'number') {
          const at = position++;
          parents.push(self);
          indexes.push(i);
          if (typeof child === 'number') this.ops.push(CHILD, at, child, 0);
        } else walk(child, self, i);
      }
      if (ref >= 0) this.ops.push(REF, self, ref, 0);
    };
    walk(tree, -1, 0);
    // The nodes to hold: the addressed ones and their ancestors.
    const held = new Uint8Array(position);
    held[0] = 1;
    for (let i = 0; i < this.ops.length; i += 4) for (let p = this.ops[i + 1]; p >= 0 && held[p] === 0; p = parents[p]) held[p] = 1;
    const register = new Int32Array(position).fill(-1);
    for (let p = 0; p < position; p++) if (held[p] === 1) register[p] = this.refs.push(p) - 1;
    for (let i = 0; i < this.ops.length; i += 4) this.ops[i + 1] = register[this.ops[i + 1]];
    /** The ref index of each held node's parent (-1 for the root): a host mirroring the tree (the worker's) links them. @type {number[]} */
    this.up = [-1];
    // Each held node from its nearest held earlier sibling, or its parent.
    const lastChild = new Int32Array(position).fill(-1);
    for (let r = 1; r < this.refs.length; r++) {
      const p = this.refs[r];
      const q = parents[p];
      const sibling = lastChild[q];
      if (sibling >= 0) this.path.push(register[sibling], 0, indexes[p] - indexes[sibling], 0);
      else this.path.push(register[q], 1, indexes[p], 0);
      this.up.push(register[q]);
      lastChild[q] = p;
    }
  }
}

/** A compiled element tree: its plan and the values of its dynamic parts. */
export class Template {
  /** @param {Plan} plan @param {any[]} values */
  constructor(plan, values) {
    this.plan = plan;
    this.values = values;
  }
}

/**
 * The plan of a compiled template, made once per module (compiler output).
 * @param {any[]} tree
 * @returns {Plan}
 */
export function plan(tree) {
  return new Plan(tree);
}

/**
 * A compiled element tree with the values of its dynamic parts (compiler
 * output); like `jsx`, it is built where it is inserted.
 * @param {Plan} plan @param {any[]} values
 * @returns {any}
 */
export function template(plan, values) {
  return new Template(plan, values);
}

/**
 * The classic JSX factory the compiler leaves for components, fragments and
 * elements it does not compile: `h(type, props, ...children)` as `jsx`.
 * @param {any} type @param {any} props @param {...any} children
 * @returns {any}
 */
export function h(type, props, ...children) {
  const n = children.length;
  if (type === Fragment) return n === 0 ? props?.children : n === 1 ? children[0] : children;
  let key;
  /** @type {any} */
  let p = props;
  if (p != null && 'key' in p) {
    p = { ...p };
    key = p.key;
    delete p.key;
  } else if (n > 0) p = p == null ? {} : { ...p };
  if (n > 0) p.children = n === 1 ? children[0] : children;
  return jsx(type, p, key);
}

/**
 * The template's nodes built through the Host calls, in the plan's `refs`
 * order (the root first); a cloning host builds its shared template so.
 * With `values` (an instance's), a host's `construct` properties among the
 * dynamic parts reach `element` too. `parent` is the element the root goes
 * into (each other node's is the node it is made in), as `element` hears it.
 * @param {Host} H @param {Plan} plan @param {any[]} [values] @param {any} [parent]
 * @returns {any[]}
 */
export function skeleton(H, plan, values, parent = null) {
  const refs = plan.refs;
  const nodes = new Array(refs.length);
  let position = 0;
  let r = 0;
  /** @param {any[]} node @param {any} around */
  const make = (node, around) => {
    const self = position++;
    let props = node[1];
    const construct = H.construct;
    const dynamic = node[3];
    if (construct !== undefined && values !== undefined && dynamic != null) {
      for (let k = 0; k < dynamic.length; k += 2) if (construct.has(dynamic[k])) props = { ...props, [dynamic[k]]: values[dynamic[k + 1]] };
    }
    const el = H.element(node[0], props, around);
    if (r < refs.length && refs[r] === self) nodes[r++] = el;
    const statics = node[1];
    if (statics != null) for (const name in statics) H.set(el, name, statics[name], undefined);
    const children = node[2];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (typeof child === 'string') {
        position++;
        H.insert(el, H.text(child), null);
      } else if (typeof child === 'number') {
        if (children.length === 1) continue;
        const t = H.text('');
        if (r < refs.length && refs[r] === position) nodes[r++] = t;
        position++;
        H.insert(el, t, null);
      } else H.insert(el, make(child, el), null);
    }
    return el;
  };
  make(plan.tree, parent);
  return nodes;
}

/**
 * Builds a Template: its nodes (cloned where the host can), then its parts
 * in the order the runtime path applies them.
 * @param {import('rrx-core/core').Graph} R @param {Host} H @param {Template} t
 */
function instance(R, H, t) {
  const p = t.plan;
  const values = t.values;
  const nodes = H.clone !== undefined ? H.clone(p, values, into) : skeleton(H, p, values, into);
  const ops = p.ops;
  const names = p.names;
  for (let i = 0; i < ops.length; i += 4) {
    const node = nodes[ops[i + 1]];
    const value = values[ops[i + 2]];
    const kind = ops[i];
    if (kind === PROP) prop(R, H, node, names[ops[i + 3]], value);
    else if (kind === EVENT) {
      if (typeof value === 'function') bindEvent(R, H, node, names[ops[i + 3]], value);
    } else if (kind === CHILD) slot(R, H, node, value, false);
    else if (kind === ONLY) only(R, H, node, value);
    else if (value != null) bindRef(node, value);
  }
  return nodes[0];
}

/**
 * Fills an element with its dynamic only child: a text becomes its text
 * content (the host's `fill`: one call, no slot node cloned); a text signal
 * binds the Text node made so; a list owns the element; anything else goes
 * through a slot appended for it.
 * @param {import('rrx-core/core').Graph} R @param {Host} H @param {any} el @param {any} value
 */
function only(R, H, el, value) {
  if (typeof value === 'string') {
    if (value !== '') fill(H, el, value, false);
    return;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    fill(H, el, String(value), false);
    return;
  }
  if (value instanceof Node) {
    let first;
    const current = R.current;
    R.current = null;
    try {
      first = $read(value);
    } catch (error) {
      if (error !== WAITING) throw error;
      first = null;
    } finally {
      R.current = current;
    }
    if (typeof first === 'string' || typeof first === 'number') {
      const text = /** @type {any} */ (fill(H, el, String(first), true));
      const app = new Text(H, text, value);
      // Shown already: the first run has nothing to apply.
      app.applied = 1;
      app.shown = first;
      app.self = $bind(R, app, readSource);
      return;
    }
  }
  let v = value;
  if (v instanceof Lazy && typeof v.component !== 'string') {
    v = at(el, () => materialize(R, H, v));
    if (v instanceof List) {
      list(R, H, v, null, el);
      return;
    }
  }
  const anchor = H.text('');
  H.insert(el, anchor, null);
  slot(R, H, anchor, v, false);
}

/** Sets an element's only text: the host's `fill`, or a text node inserted. @param {Host} H @param {any} el @param {string} text @param {boolean} keep */
function fill(H, el, text, keep) {
  if (H.fill !== undefined) return H.fill(el, text, keep);
  const t = H.text(text);
  H.insert(el, t, null);
  return t;
}

/**
 * Fills a template's dynamic child at its slot, an empty text node: a text
 * becomes the slot's data, a reactive child a region adopting the slot, a
 * list alone in its element owns that element, anything else is inserted
 * before the slot, which then goes.
 * @param {import('rrx-core/core').Graph} R @param {Host} H @param {any} anchor @param {any} value @param {boolean} only
 */
function slot(R, H, anchor, value, only) {
  if (typeof value === 'string') {
    if (value !== '') H.content(anchor, value);
    return;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    H.content(anchor, String(value));
    return;
  }
  if (typeof value === 'function' || value instanceof Node) {
    child(R, H, value, null, anchor);
    return;
  }
  const parent = H.parent(anchor);
  let v = value;
  if (only && v instanceof Lazy && typeof v.component !== 'string') {
    v = at(parent, () => materialize(R, H, v));
    if (v instanceof List) {
      H.remove(parent, anchor);
      list(R, H, v, null, parent);
      return;
    }
  }
  /** @type {any[]} */
  const out = [];
  at(parent, () => resolve(R, H, v, out, true));
  for (let i = 0; i < out.length; i++) H.insert(parent, out[i], anchor);
  H.remove(parent, anchor);
}

// ---------------------------------------------------------------------------
// Control flow (regions and boundaries)

/**
 * A list source: an array, an accessor of one, or a reactive node holding one.
 * @template T
 * @typedef {readonly T[] | null | undefined | (() => readonly T[] | null | undefined) | import('rrx-core/core').Readable<readonly T[]> | import('rrx-core/core').Readable<T[]>} Each
 */

/**
 * Shows `children` while `when` is truthy, `fallback` otherwise. The branch
 * changes only when truthiness does. A function child receives an accessor of
 * the value.
 * @template T
 * @param {{ when: T | (() => T) | import('rrx-core/core').Readable<T>, fallback?: any, children?: any }} props
 */
export function Show(props) {
  const R = $active();
  const when = props.when;
  const truthy = $memo(R, () => !!read(when));
  const children = props.children;
  return () =>
    $read(truthy)
      ? typeof children === 'function' && !(children instanceof Node)
        ? () => $untrack(R, () => waited(R, 'a Show child', children, () => read(when), undefined))
        : children
      : props.fallback;
}

/**
 * A branch of `Choose`.
 * @param {{ when: any, children?: any }} props
 */
export function When(props) {
  return new Choice(props.when, props.children);
}

/**
 * Shows the first `When` whose condition holds, or `fallback`. Conditions
 * are tested lazily in order; the branch changes only when a different match
 * becomes the first to hold.
 * @param {{ fallback?: any, children?: any }} props
 */
export function Choose(props) {
  const R = $active();
  /** @type {Choice[]} */
  const matches = [];
  const collect = (/** @type {any} */ c) => {
    if (Array.isArray(c)) c.forEach(collect);
    else if (c instanceof Lazy && c.component === When) matches.push(new Choice(c.props.when, c.props.children));
    else if (c instanceof Choice) matches.push(c);
  };
  collect(props.children);
  const chosen = $memo(R, () => {
    for (let i = 0; i < matches.length; i++) if (read(matches[i].when)) return i;
    return -1;
  });
  return () => {
    const i = $read(chosen);
    if (i < 0) return props.fallback;
    const match = matches[i];
    const children = match.children;
    return typeof children === 'function' && !(children instanceof Node) ? () => $untrack(R, () => waited(R, 'a When child', children, () => read(match.when), undefined)) : children;
  };
}

/**
 * A list. Keyed by default: each item keeps its row (built once) while it
 * stays in `each`; rows move instead of rebuilding, and `children(item,
 * index)` receives accessors. `by` extracts the identity (the item itself by
 * default); `by="position"` keeps each position's row instead, its item
 * accessor following the value there and its index a plain number.
 * @template T
 * @param {{ each: Each<T>, by?: ((item: T) => unknown) | 'position', fallback?: any, children: (item: () => T, index: any) => any }} props
 */
export function For(props) {
  const by = props.by ?? null;
  if (by === 'position') return positional(props);
  if (typeof by === 'string') throw new Error(`REN: unknown For by "${by}"`);
  const R = $active();
  const H = $surface();
  const each = props.each;
  const render = props.children;
  // Rows hands each row an accessor whose signal exists only once read
  // tracked; a child of one parameter reads no index and gets no signal.
  const build = render.length < 2 ? (/** @type {any} */ item) => row(R, H, render, item, null) : (/** @type {any} */ item, /** @type {any} */ index) => row(R, H, render, item, () => $read(index));
  return new List(R, items(R, each), by, (read, removal) => $rows(R, read, by, build, removal), each, props.fallback);
}

/**
 * The node a list reads its items from: the source itself when it is a node,
 * a memo of an accessor, null for a fixed array.
 * @param {import('rrx-core/core').Graph} R @param {any} each
 * @returns {import('rrx-core/core').Readable<any> | null}
 */
function items(R, each) {
  if (each instanceof Node) return each;
  if (typeof each === 'function') return $memo(R, () => each());
  return null;
}

/**
 * Builds a keyed row in the view's root and host.
 * @param {import('rrx-core/core').Graph} R @param {Host} H @param {(item: any, index: any) => any} render @param {() => any} item @param {(() => number) | null} index
 */
function row(R, H, render, item, index) {
  const a = active;
  const h = host;
  active = R;
  host = H;
  try {
    // A row is built as a thunk child's content is: it may write state (a ref, a component's own signals).
    return lift(R, () => range(R, H, waited(R, 'a For row', render, item, index === null ? undefined : index)));
  } finally {
    active = a;
    host = h;
  }
}

/**
 * A positional list (`For by="position"`): each index keeps its row; the
 * item accessor follows the value at that index.
 * @template T
 * @param {{ each: Each<T>, fallback?: any, children: (item: () => T, index: number) => any }} props
 */
function positional(props) {
  const R = $active();
  const H = $surface();
  const each = props.each;
  const render = props.children;
  /** @param {any} item @param {any} index */
  const build = (item, index) => within(R, H, () => lift(R, () => range(R, H, waited(R, 'a positional For row', render, () => $read(item), $untrack(R, () => $read(index))))));
  return new List(R, items(R, each), undefined, (read, removal) => $positions(R, read, build, removal), each, props.fallback);
}

/**
 * Renders `children(i)` for each `i` below `count`, with no diffing: a
 * larger count adds rows at the end, a smaller one removes them from the end.
 * `i` is a plain number.
 * @param {{ count: number | (() => number) | import('rrx-core/core').Readable<number>, fallback?: any, children: (i: number) => any }} props
 */
export function Times(props) {
  const R = $active();
  const H = $surface();
  const count = props.count;
  const render = props.children;
  /** @type {number[]} */
  let indices = [];
  const each = $memo(R, () => {
    // A count that is not a finite number (Infinity would build rows until memory runs out) renders none.
    const raw = Number(read(count));
    const n = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
    if (n === indices.length) return indices;
    const next = indices.slice(0, n);
    for (let i = indices.length; i < n; i++) next.push(i);
    return (indices = next);
  });
  /** @param {any} _ @param {any} index */
  const build = (_, index) => within(R, H, () => range(R, H, waited(R, 'a Times row', render, $untrack(R, () => $read(index)), undefined)));
  return new List(R, each, undefined, (source, removal) => $positions(R, source, build, removal), each, props.fallback);
}

/**
 * Renders the component `of` names, chosen at run time (a component, a tag
 * name, or an accessor of either), with the other props.
 * @param {{ of: any, [prop: string]: any }} props
 */
export function Render(props) {
  const { of, ...rest } = props;
  return () => {
    const c = read(of);
    if (c == null) return null;
    if (typeof c === 'string') return () => jsx(c, rest);
    return new Lazy(c, rest);
  };
}

/**
 * Renders `children` into `into`, a container elsewhere (the host's portal
 * layer by default), in the order portals open; they close with their owner.
 * @param {{ into?: any, children?: any }} props
 */
export function Portal(props) {
  const R = $active();
  const H = $surface();
  const target = props.into ?? H.layer();
  const scope = $scope(R, $owner(R));
  /** @type {any[]} */
  const nodes = [];
  // Handlers delegate from the portal's target too.
  const detach = H.attach !== undefined ? H.attach(target) : null;
  try {
    at(target, () => $enter(scope, () => resolve(R, H, props.children, nodes, false)));
    for (const n of nodes) H.insert(target, n, null);
  } catch (error) {
    // Children that throw, or a target that refuses one, leave nothing open:
    // the nodes in, the scope, the target as a delegation root.
    try {
      for (const n of nodes) if (H.parent(n) === target) H.remove(target, n);
      $stop(scope);
    } finally {
      if (detach !== null) detach();
    }
    throw error;
  }
  const owner = $owner(R);
  // The nodes leave their container when the owner stops or is retired
  // (background disposal: its scope is swept later with the owner's).
  let open = true;
  const shut = () => {
    if (!open) return;
    open = false;
    for (const n of nodes) if (H.parent(n) === target) H.remove(target, n);
    if (detach !== null) detach();
  };
  const record = eager(R, owner, shut);
  const close = () => {
    forget(R, record);
    shut();
    $stop(scope);
  };
  if (owner !== null) $cleanup(owner, close);
  return null;
}

/**
 * A pending boundary: `fallback` shows until every pending read below has a
 * first value; later reruns keep the content, and an update that makes it
 * wait is held whole until it is ready (a transition; use `$pending` or
 * `$behind` for indicators). With `again`, a change of that key shows the
 * fallback again until the content is ready.
 * @param {{ fallback?: any, again?: any, children?: any }} props
 */
export function Pending(props) {
  const R = $active();
  const H = $surface();
  const count = $writable($signal(R, 0));
  const again = props.again;
  const keyed = again !== undefined;
  let settled = false;
  /** @type {any} */
  let shownKey;
  /** @type {Boundary} */
  const boundary = {
    wait: () => $write(count, $untrack(R, () => $read(count)) + 1),
    settle: () => $write(count, $untrack(R, () => $read(count)) - 1),
    revealed: () => settled && (!keyed || Object.is($untrack(R, () => read(again)), shownKey)) && (slot === null || slot.shown),
    holds: () => boundary.revealed(),
  };
  /** @type {Slot | null} */
  let slot = null;
  const scope = $with(R, new Layer(R.ctx, PENDING_BOUNDARY, null, boundary, false), () => $scope(R, $owner(R)));
  /** @type {any[]} */
  const content = [];
  $enter(scope, () => resolve(R, H, props.children, content, false));
  const ready = $memo(R, () => {
    const n = $read(count);
    const key = keyed ? read(again) : undefined;
    if (settled && keyed && !Object.is(key, shownKey)) settled = n === 0;
    if (!settled && n === 0) settled = true;
    if (settled) shownKey = key;
    return settled;
  });
  // Under a Sequence, a ready Pending shows its content when its order allows.
  const order = $lookup(R, SEQUENCE);
  if (order !== null) slot = order.join(R, ready, $owner(R));
  const view = () => {
    if (slot !== null) {
      // A key change (again) shows the fallback again, in order as at first.
      if (keyed && slot.shown && !$read(ready)) slot.shown = false;
      const shown = slot.shows();
      if (shown !== true) return shown === null ? null : props.fallback;
    } else if (!$read(ready)) return props.fallback;
    // Updates that arrived while the content was held place once it shows.
    reattach(R);
    return content;
  };
  indicators.add(view);
  return view;
}

/**
 * A Pending's place in a Sequence's order. `shown` stays true once its content
 * has shown (a later revalidation keeps it).
 */
class Slot {
  /** @param {Order} order @param {import('rrx-core/core').Readable<boolean>} ready */
  constructor(order, ready) {
    this.order = order;
    this.ready = ready;
    this.shown = false;
    this.gone = false;
  }
  /** True: show the content; false: the fallback; null: nothing (nextOnly, after the first one not ready). Tracked. */
  shows() {
    if (this.shown) return true;
    const open = this.order.permits(this);
    if (open === true) this.shown = true;
    return open;
  }
}

/** A Sequence's order over the Pendings registered below it. */
class Order {
  /** @param {'in-turn' | 'at-once' | 'as-ready'} mode @param {boolean} nextOnly */
  constructor(mode, nextOnly) {
    this.mode = mode;
    this.nextOnly = nextOnly;
    /** @type {Slot[]} */
    this.slots = [];
  }
  /**
   * Registers a Pending (in creation order); it leaves when its owner stops.
   * @param {import('rrx-core/core').Graph} R @param {import('rrx-core/core').Readable<boolean>} ready @param {import('rrx-core/core').Owner | null} owner
   */
  join(R, ready, owner) {
    void R;
    const slot = new Slot(this, ready);
    this.slots.push(slot);
    if (owner !== null) $cleanup(owner, () => {
      slot.gone = true;
      const at = this.slots.indexOf(slot);
      if (at !== -1) this.slots.splice(at, 1);
    });
    return slot;
  }
  /** @param {Slot} slot @returns {boolean | null} */
  permits(slot) {
    const self = $read(slot.ready);
    if (this.mode === 'as-ready') return self;
    if (this.mode === 'at-once') {
      for (const s of this.slots) if (!s.gone && !s.shown && !$read(s.ready)) return false;
      return true;
    }
    // In turn: in creation order; those after the first one not ready wait.
    for (const s of this.slots) {
      if (s === slot) break;
      if (s.gone || s.shown) continue;
      if (!$read(s.ready)) return this.nextOnly ? null : false;
    }
    return self;
  }
}

/**
 * Coordinates when the Pendings below it show their content: `in-turn` (the
 * default) in the order they were made, each once it and those before it are
 * ready; `at-once` all together, when all are ready; `as-ready` each when it
 * is ready. With `nextOnly` (in turn), those past the first not ready show
 * nothing rather than their fallback. Content once shown stays shown.
 * @param {{ order?: 'in-turn' | 'at-once' | 'as-ready', nextOnly?: boolean, children?: any }} props
 */
export function Sequence(props) {
  const R = $active();
  const H = $surface();
  const mode = props.order ?? 'in-turn';
  if (mode !== 'in-turn' && mode !== 'at-once' && mode !== 'as-ready') throw new Error(`REN: unknown Sequence order "${String(mode)}"`);
  const order = new Order(mode, props.nextOnly === true && mode === 'in-turn');
  const scope = $with(R, new Layer(R.ctx, SEQUENCE, null, order, false), () => $scope(R, $owner(R)));
  /** @type {any[]} */
  const nodes = [];
  $enter(scope, () => resolve(R, H, props.children, nodes, false));
  return nodes;
}

/**
 * An error boundary: a failure below renders `fallback(error, reset)`;
 * `reset()` renders the children again.
 * @param {{ fallback: any, children?: any }} props
 */
export function Recover(props) {
  const R = $active();
  const failure = $writable($signal(R, /** @type {{ error: any } | null} */ (null)));
  const reset = () => $write(failure, null);
  return () => {
    const f = $read(failure);
    if (f !== null) {
      const fallback = props.fallback;
      return typeof fallback === 'function' ? $untrack(R, () => fallback(f.error, reset)) : fallback;
    }
    // The children render in a scope whose boundary catches later failures.
    return () =>
      $untrack(R, () => {
        const owner = /** @type {import('rrx-core/core').Owner} */ ($owner(R));
        $catch(owner, error => $write(failure, { error }));
        try {
          /** @type {any[]} */
          const nodes = [];
          resolve(R, $surface(), props.children, nodes, false);
          return nodes;
        } catch (error) {
          $write(failure, { error });
          return null;
        }
      });
  };
}

// ---------------------------------------------------------------------------
// Root-wide keys

/** Where a root's first view renders: its host and container. */
class Place {
  /** @param {Host} H @param {any} container */
  constructor(H, container) {
    this.H = H;
    this.container = container;
  }
}

/** Each root's first view's place, while it is mounted. @type {WeakMap<import('rrx-core/core').Graph, Place>} */
const places = new WeakMap();

/** Where a root's first view renders (its host and container), or undefined. @param {import('rrx-core/core').Graph} R */
export const placeOf = R => places.get(R);

/**
 * Hears every key pressed anywhere in the running application root, not
 * only in focused descendants (a launcher's Ctrl+K while nothing inside it
 * has focus): the host's keydown, after the focused item and its ancestors
 * heard it (as a document's listener hears it last: a focused handler's
 * `stopPropagation` keeps it from here), and when nothing in the root has
 * focus. `editable` tells whether the key's target is a text field (an
 * Edit; on the DOM an input, textarea, select or contenteditable element),
 * so a root-wide shortcut can leave keys typed in fields alone.
 * `preventDefault` keeps the key's own action (a field's typing) on the
 * main thread, not from a worker. The handler runs as the view's handlers
 * run (a batch, in the context it was bound in) while its owner lives;
 * returns its removal, which the owner's cleanup also runs.
 * @param {(event: { key: string, shiftKey: boolean, ctrlKey: boolean, metaKey: boolean, altKey: boolean, editable: boolean, target: unknown, preventDefault(): void, stopPropagation(): void }) => void} handler
 * @returns {() => void}
 */
export function $keys(handler) {
  return rootwide('keys', handler);
}

/**
 * Hears every scroll that can move the running application root's items:
 * a Scroll inside it, the page, or on the DOM any element around the
 * root's container (as a document's capture-phase scroll listener hears
 * scrolls that do not bubble). A popup placed against its target follows
 * it through this instead of measuring every frame. The event is
 * `{ type: 'scroll', target }`; in worker mode it crosses as an event
 * (scrolls within a burst merge). Runs and is removed as `$keys`'s handler.
 * @param {(event: { type: string, target: unknown }) => void} handler
 * @returns {() => void}
 */
export function $scrolls(handler) {
  return rootwide('scrolls', handler);
}

/**
 * Hears every pointer press anywhere in the running application root, its
 * portals too (a menu over any text, a dialog's included), after the
 * pressed item and its ancestors heard it: a handler's `stopPropagation`
 * keeps it from here. The event is the pointerdown's (`button`,
 * `pointerType`, `target`, the point), and its `preventDefault` keeps the
 * press's own action. Runs and is removed as `$keys`'s handler.
 * @param {(event: any) => void} handler
 * @returns {() => void}
 */
export function $presses(handler) {
  return rootwide('presses', handler);
}

/**
 * Hears every move of a node's border box in its surface while the
 * caller's owner lives, whatever moved it: a scroll, a layout shift (the
 * content above it growing), a transform or an animation.
 * `node` is a primitive's node (a ref) of the running root's host. The
 * event is `{ type: 'move', x, y, target }`, its new place as
 * `getBoundingClientRect()` gives it, after each change of `x` or `y`
 * from where it was when the listening started (a change of size alone is
 * `onResize`'s). A popup placed against its target follows it through
 * this and `$scrolls`. In worker mode moves cross as events (merged
 * within a burst). Runs and is removed as `$keys`'s handler. The Host
 * hears it as `listen(node, 'move', handler)`.
 * @param {any} node
 * @param {(event: { type: string, x: number, y: number, target: unknown }) => void} handler
 * @returns {() => void}
 */
export function $moves(node, handler) {
  const R = $active();
  const place = places.get(R);
  if (place === undefined) throw new Error('REN: $moves needs a mounted view of this root');
  if (!place.H.owns(node)) throw new Error("REN: $moves needs a node of its root's host");
  return hear(R, place.H, node, 'move', handler);
}

/**
 * Hears every change of a node's border box size while the caller's owner
 * lives, as a ResizeObserver on it: `onResize` for a node held by a ref
 * (a target given to a component), as `$moves` hears its place. `node` is
 * the node, or an accessor of it (null: none), listened to again when it
 * changes. The event is `{ type: 'resize', width, height, target }`, after
 * each change from its size when the listening started (a font loading,
 * content or a layout changing it). An indicator sized to its target
 * follows it through this. In worker mode sizes cross as events (merged
 * within a burst). Runs and is removed as `$keys`'s handler. The Host
 * hears it as `listen(node, 'resize', handler)`, as `onResize`.
 * @param {any} node
 * @param {(event: { type: string, width: number, height: number, target: unknown }) => void} handler
 * @returns {() => void}
 */
export function $resizes(node, handler) {
  const R = $active();
  const place = places.get(R);
  if (place === undefined) throw new Error('REN: $resizes needs a mounted view of this root');
  const H = place.H;
  /** @param {any} n */
  const owned = n => {
    if (!H.owns(n)) throw new Error("REN: $resizes needs a node of its root's host");
  };
  if (typeof node !== 'function') {
    owned(node);
    return hear(R, H, node, 'resize', handler);
  }
  // The owner and context of the call, for a node the accessor gives later.
  const owner = $owner(R);
  const context = R.ctx;
  // Each listener belongs to the watch: its application's cleanup removes it
  // when the target changes or the watch stops, so the owner holds none.
  const watch = $watch(R, node, n => {
    if (n == null) return undefined;
    owned(n);
    return hear(R, H, n, 'resize', handler, owner, context, false);
  });
  return watch.stop;
}

/**
 * Listens on the running root's first view's container for a root-wide
 * event (`keys`, `scrolls`, `presses`) while the caller's owner lives.
 * @param {string} name @param {(event: any) => void} handler
 * @returns {() => void}
 */
function rootwide(name, handler) {
  const R = $active();
  const place = places.get(R);
  if (place === undefined) throw new Error(`REN: $${name} needs a mounted view of this root`);
  return hear(R, place.H, place.container, name, handler);
}

/**
 * Listens on a node of `H` for `name` while the caller's owner lives,
 * running the handler as the view's handlers run (in the given owner and
 * context: the caller's by default). The owner's cleanup that removes it is
 * released when it is removed first, so a listener taken down by hand
 * leaves nothing on the owner; `tie` false leaves the removal to the caller
 * (a watch's cleanup).
 * @param {import('rrx-core/core').Graph} R @param {Host} H @param {any} node @param {string} name @param {(event: any) => void} handler @param {any} [owner] @param {any} [context] @param {boolean} [tie]
 * @returns {() => void}
 */
function hear(R, H, node, name, handler, owner = $owner(R), context = R.ctx, tie = true) {
  const removed = H.listen(node, name, e => {
    if (R.closed || (owner !== null && !$alive(owner))) return;
    handle(R, H, context, owner, handler, e);
  });
  let open = true;
  /** @type {number | null} */
  let key = null;
  const remove = () => {
    if (!open) return;
    open = false;
    if (key !== null) $release(owner, key);
    key = null;
    if (removed != null) removed();
    else H.unlisten?.(node, name);
  };
  if (tie && owner !== null) key = $cleanup(owner, remove);
  return remove;
}

// ---------------------------------------------------------------------------
// Rendering

/**
 * @typedef {object} Options
 * @property {import('rrx-core/core').Graph=} root The root to render in; a new one by default, disposed with the view.
 * @property {string=} id The id of the new root (`main` by default); ignored with `root`.
 * @property {boolean=} auto Flush every write outside a batch at once (true by default).
 * @property {(number | false)=} retire Background disposal: a list clear or replace, or a content swap, that drops a list of at least this many rows retires it (its host nodes go at once, its scopes are freed in paced slices); `false` always stops at once. 1000 by default.
 * @property {(import('./sweep.js').Mode | false)=} sweep How the root sweeps retired work: `idle` (idle callbacks), `frame` (a slice after each frame), `task` (macrotask slices, the worker's); the best the environment has by default; `false` leaves it to rrx-core (its default drain: idle callbacks, else 4 ms macrotask slices) or to the root's own Sweeper.
 * @property {((drain: import('./sweep.js').Drain) => void)=} swept Receives each drain's report: slices, the longest slice, busy and total time, late frames.
 */

/**
 * Renders `view()` into `container` through `H`; returns the dispose
 * function. The view is built in one batch, so it settles before it is
 * shown. A view that throws undoes the mount and the error is rethrown.
 * @param {Host} H
 * @param {() => any} view
 * @param {any} container
 * @param {Options} [options]
 * @returns {() => void}
 */
export function mount(H, view, container, options = {}) {
  const own = options.root == null;
  const R = options.root ?? $root(options.id ?? 'main');
  // Root-wide listeners (`$keys`) go on the first view's container.
  const placed = !places.has(R);
  if (placed) places.set(R, new Place(H, container));
  // A root without a base context gets the built-in Id layer.
  if (R.ctx === null) base(R, [], null);
  if (options.auto !== false) $auto(R, true);
  // The root's disposal pacing, unless another view of it already has one.
  /** @type {Pace | null} */
  let pace = null;
  if (!paces.has(R)) {
    const retire = options.retire;
    const mode = options.sweep ?? (R.sweeper === undefined ? modeOf() : false);
    pace = new Pace(R, retire === false ? Infinity : (retire ?? RETIRE), mode, options.swept ?? null);
    paces.set(R, pace);
  }
  const scope = $scope(R, null);
  /** @type {any[]} */
  const nodes = [];
  // The container is a delegation root before any handler binds.
  const detach = H.attach !== undefined ? H.attach(container) : null;
  /**
   * Undoes the mount in reverse order. A failed mount leaves the root as it
   * found it (its place and pacing free for the next view); a disposed one
   * keeps the pacing of a root that lives on for later views.
   * @param {boolean} failed
   */
  const undo = failed => {
    for (const n of nodes) if (H.parent(n) === container) H.remove(container, n);
    // A throwing cleanup still lets the view release its listeners and root.
    try {
      $stop(scope);
    } finally {
      if (detach !== null) detach();
      if (placed) places.delete(R);
      if (runner !== null && runner.R === R) runner = null;
      // `$dispose` finishes the teardown at once; the pacing stops with it.
      if (pace !== null && (own || failed)) {
        pace.close();
        paces.delete(R);
      }
      if (own) $dispose(R);
    }
  };
  try {
    // The nodes go in before the build's batch flushes: an update the build
    // itself made (a failure a Recover heard) finds its place in the container.
    within(R, H, () =>
      at(container, () =>
        $batch(R, () => {
          $enter(scope, () => resolve(R, H, view(), nodes, false));
          for (const n of nodes) H.insert(container, n, null);
        }),
      ),
    );
    const present = H.present;
    if (present) {
      // The host presents after each flush round settles (ren-core Present/Commit);
      // a host that tracks damage makes an unchanged round free.
      $commit(R, scope, () => present.call(H));
      present.call(H);
    }
  } catch (error) {
    try {
      undo(true);
    } catch {
      // The build's error is the one to report; a cleanup's would hide it.
    }
    throw error;
  }
  return () => undo(false);
}
