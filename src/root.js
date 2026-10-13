// Application roots: rrx-core's root (`$root`), extended with what an application needs to
// live confined in a document. One id names everything: the rrx-core root, the
// host element (`data-ren-root="<id>"`), storage keys `ren:<id>:<key>`, lock
// names `ren:<id>:<name>`, element ids `<id>-<name>` (`$name`), and the
// per-document registry of live roots. Each root has its own graph, its own
// renderer (configured by its own options), its own contexts and, in the
// worker runtime, its own worker. Nothing is kept in module state but a
// WeakMap from each document (or document-less renderer) to its live ids.

import { $root as Graph, $dispose, $scope, $cleanup, $owner, $watch, $write, $signal, $writable, $unowned, $untrack, $batch, $with } from 'rrx-core';
import { checkId } from 'rrx-core/context';
import { mount, building, placing, $active, $surface, read, eager, forget, replaced } from './core.js';
import { connect } from './remote.js';
import { nested } from './nested.js';
import { Shelf, Locker, Storage, Locks, Runtime, Send, base } from './context.js';

/** @typedef {import('rrx-core/core').Graph} Root */
/** @typedef {import('./core.js').Host} Host */
/** @typedef {import('./port.js').Port} Port */

/**
 * @typedef {object} Options
 * @property {string} id The root's id, `[a-z][a-z0-9-]{0,31}`, unique among the live roots of its document.
 * @property {any=} children The view: an element or component (`<App />`), or a function returning the view. Direct runtime only.
 * @property {Host=} renderer This root's renderer, from a renderer package: `$dom(document, options)` or `$shadow(options)` (ren-dom), `$skia(kit, options)` (ren-skia), `$three(THREE, options)` (ren-three), `$tree(options)` (ren-json). Required at top level; a nested root defaults to its parent renderer's `nest()`. One renderer per root.
 * @property {any=} target Top level: the element the root's host element is appended to (none for a document-less Skia root).
 * @property {'direct' | 'worker'=} runtime `direct` (default) runs the graph here; `worker` runs it in `worker`.
 * @property {(Port | ((id: string) => Port))=} worker The worker runtime's endpoint (serving `serve` with a root of the same id), or a function making it; a worker it made is terminated with the root.
 * @property {import('./context.js').Backing | null=} storage The Web Storage behind `$lookup(Storage)`; the window's localStorage by default, null for none.
 * @property {import('./context.js').Manager | null=} locks The lock manager behind `$lookup(Locks)`; `navigator.locks` by default.
 * @property {any=} props The value the root reads with `$lookup(Props)`. Nested: an accessor or node is tracked in the parent, and the child follows it. Worker runtime: structured-clone data.
 * @property {((data: any) => void)=} onMessage Receives `$lookup(Send)(data)` from the root; nested, it runs in the parent's context, in a batch.
 * @property {[import('rrx-core/context').Context<any>, any][]=} provide Direct runtime: contexts passed explicitly, as providers around the view (a nested root inherits none).
 * @property {boolean=} auto Flush every write outside a batch at once (true).
 * @property {(number | false)=} retire Background disposal from this many rows (1000; `false`: never), as `mount`. Direct runtime.
 * @property {(import('./sweep.js').Mode | false)=} sweep How retired work is swept, as `mount`. Direct runtime.
 * @property {((drain: import('./sweep.js').Drain) => void)=} swept Each drain's report, as `mount`. Direct runtime.
 * @property {string=} tag The host element's tag (`div`).
 * @property {import('./remote.js').Options=} connect Worker runtime: the connection's options (`schedule`, `applied`, `error`, …).
 */

/** Live root ids by document, or by renderer for a root without one. @type {WeakMap<object, Map<string, Root>>} */
const registry = new WeakMap();

/** The owner each nested root was rendered in (its place in the parent's views). @type {WeakMap<Root, any>} */
const nestedIn = new WeakMap();

/**
 * Claims `id` in `scope`; returns the release. A nested root that holds the
 * id in content a region is replacing (placed later, so its old content is
 * still live) hands it over: it ends now.
 * @param {object} scope @param {string} id @param {Root} root
 */
function claim(scope, id, root) {
  let ids = registry.get(scope);
  if (ids === undefined) registry.set(scope, (ids = new Map()));
  const holder = ids.get(id);
  if (holder !== undefined && nestedIn.has(holder) && replaced(nestedIn.get(holder))) $dispose(holder);
  if (ids.has(id)) throw new Error(`REN: a root "${id}" is already live in this document`);
  ids.set(id, root);
  const live = ids;
  return () => {
    if (live.get(id) === root) live.delete(id);
  };
}

/** The ids of the live roots of a document (or document-less renderer). @param {object} scope @returns {string[]} */
export function $roots(scope) {
  const ids = registry.get(scope);
  return ids === undefined ? [] : [...ids.keys()];
}

/** A window's localStorage, or null where it is missing or refused. @param {any} view */
function storageOf(view) {
  try {
    return view?.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Ends a worker a root made: a Worker terminates, a port closes. @param {any} port */
function end(port) {
  if (typeof port.terminate === 'function') port.terminate();
  else if (typeof port.close === 'function') port.close();
}

/**
 * A started application root.
 * @typedef {object} Started
 * @property {Root} root
 * @property {any} host its host element, or null
 * @property {import('rrx-core/core').Writable<any>} props
 * @property {import('./remote.js').Connection | null} connection
 */

/**
 * Starts an application root in `element` (nested) or in a host element of
 * its own (top level).
 * @param {Options} spec @param {any} element @param {((data: any) => void) | null} deliver @param {Host | null} fallback the parent's default for a nested root
 * @returns {Started}
 */
function start(spec, element, deliver, fallback) {
  const id = checkId(spec.id);
  const target = spec.target ?? null;
  const doc = element?.ownerDocument ?? target?.ownerDocument ?? null;
  const renderer = spec.renderer ?? fallback;
  if (renderer == null) throw new Error('REN: a Root needs a renderer: $dom(document) from ren-dom, $skia(kit) from ren-skia, $three(THREE) from ren-three or $tree() from ren-json');
  const runtime = spec.runtime ?? 'direct';
  if (runtime !== 'direct' && runtime !== 'worker') throw new Error(`REN: unknown runtime "${String(runtime)}"`);
  if (runtime === 'worker' && spec.worker == null) throw new Error('REN: the worker runtime needs a worker');
  const host = element ?? (doc !== null ? doc.createElement(spec.tag ?? 'div') : null);
  const R = Graph(id);
  const release = claim(doc ?? renderer, id, R);
  const view = doc?.defaultView ?? null;
  const backing = spec.storage !== undefined ? spec.storage : storageOf(view);
  const shelf = backing == null ? null : new Shelf(R, backing);
  // Each storage change dispatches `ren:storage` on the host element (the
  // Shelf itself knows no DOM, so a worker's mirror carries none).
  if (shelf !== null && host !== null && typeof host.dispatchEvent === 'function')
    shelf.notify = (key, value) => {
      const Event = host.ownerDocument?.defaultView?.CustomEvent ?? /** @type {any} */ (globalThis).CustomEvent;
      if (typeof Event === 'function') host.dispatchEvent(new Event('ren:storage', { detail: { id, key, value } }));
    };
  const nav = view?.navigator ?? /** @type {any} */ (globalThis).navigator;
  const locks = spec.locks !== undefined ? spec.locks : (nav?.locks ?? null);
  const nested = deliver !== null;
  const props = $unowned(R, () => $writable($signal(R, /** @type {any} */ (spec.props))));
  const onMessage = spec.onMessage;
  const send = deliver ?? ((/** @type {any} */ data) => onMessage?.(data));
  /** @type {import('./context.js').Place} */
  const place = { runtime, renderer: renderer.kind ?? 'custom', element: host, connection: null };
  base(
    R,
    [
      [Storage, shelf],
      [Locks, new Locker(id, locks)],
      [Runtime, place],
      [Send, send],
    ],
    props,
  );
  /** @type {(() => void) | null} */
  let unmount = null;
  /** @type {import('./remote.js').Connection | null} */
  let connection = null;
  /** @type {any} */
  let port = null;
  let owned = false;
  /** @type {(() => void) | null} */
  let unlisten = null;
  let done = false;
  const teardown = () => {
    if (done) return;
    done = true;
    if (unmount !== null) unmount();
    if (connection !== null) connection.close();
    if (owned && port !== null) end(port);
    if (unlisten !== null) unlisten();
    if (renderer.close) renderer.close();
    if (shelf !== null) shelf.notify = null;
    if (!nested && host !== null && host.parentNode != null) host.parentNode.removeChild(host);
    release();
  };
  // Created before the view's scope, so its cleanup runs after the view stops.
  $cleanup($scope(R, null), teardown);
  try {
    if (shelf !== null && view !== null) unlisten = shelf.listen(view);
    const container = renderer.open ? renderer.open(host, id) : host;
    if (container == null) throw new Error('REN: a Root needs a host element or a renderer that opens one');
    if (runtime === 'worker') {
      owned = typeof spec.worker === 'function';
      port = typeof spec.worker === 'function' ? spec.worker(id) : spec.worker;
      connection = connect(port, renderer, container, { ...spec.connect, id, storage: shelf, message: send, props: spec.props });
      place.connection = connection;
    } else {
      const children = spec.children;
      const provide = spec.provide ?? [];
      const build = () => {
        let v = typeof children === 'function' ? children() : children;
        for (let i = provide.length - 1; i >= 0; i--) v = provide[i][0]({ value: provide[i][1], children: v });
        return v;
      };
      unmount = mount(renderer, build, container, { root: R, auto: spec.auto, retire: spec.retire, sweep: spec.sweep, swept: spec.swept });
    }
    if (target !== null) target.appendChild(host);
  } catch (error) {
    $dispose(R);
    throw error;
  }
  return { root: R, host, props, connection };
}

/**
 * A nested application root, built where `<Root>` is rendered: its host
 * element is a node of the parent's renderer, which must be able to hold
 * one (a Host with `nest`, as the DOM renderers).
 * @param {Options} spec
 */
function nest(spec) {
  const R = $active();
  const H = $surface();
  if (typeof H.nest !== 'function') throw new Error(`REN: a nested Root needs a parent renderer that holds root elements (${H.kind ?? 'custom'} does not), in the direct runtime`);
  const owner = $owner(R);
  const context = R.ctx;
  const onMessage = spec.onMessage;
  /** @param {any} data */
  const deliver = data => {
    if (onMessage === undefined || R.closed) return;
    $with(R, context, () => $batch(R, () => onMessage(data)));
  };
  const element = H.element(spec.tag ?? 'div', null, placing());
  const source = spec.props;
  // The child builds with its first props already in place (in a worker too).
  const initial = source === undefined ? undefined : $untrack(R, () => read(source));
  const started = start({ ...spec, props: initial }, element, deliver, spec.renderer === undefined ? H.nest() : null);
  const child = started.root;
  nestedIn.set(child, owner);
  // A direct-runtime child is settled with its parent ($settle).
  if (started.connection === null && !child.closed) nested(R, child);
  if (source !== undefined) {
    const connection = started.connection;
    const props = started.props;
    // The parent tracks its props; the child only ever sees plain values.
    $watch(
      R,
      () => read(source),
      value => {
        if (connection !== null) connection.props(value);
        else if (!child.closed) $write(props, value);
      },
    );
  }
  // The child ends when its owner stops, or at once when the owner is
  // retired (its id is free again, its host element and worker go).
  const record = eager(R, owner, () => $dispose(child));
  if (owner !== null)
    $cleanup(owner, () => {
      forget(R, record);
      $dispose(child);
    });
  return element;
}

/**
 * The root: rrx-core's root (`$root`), extended. `Root(id)` is exactly rrx-core's (a graph).
 * `Root(options)` starts an application root and returns that same graph,
 * usable with every rrx-core operation (`$signal(root, …)`, `$flush(root)`);
 * `$dispose(root)` ends it and releases everything it made. Rendered as
 * `<Root id=… renderer=…>{() => <App />}</Root>`, it is a nested application
 * root with its own graph, renderer, contexts and (worker runtime) worker.
 * @overload
 * @param {string} spec
 * @returns {Root}
 */
/**
 * @overload
 * @param {Options} spec
 * @returns {Root}
 */
/**
 * @param {string | Options} spec
 * @returns {any}
 */
export function Root(spec) {
  if (typeof spec === 'string') return Graph(spec);
  if (spec == null || typeof spec !== 'object') throw new TypeError('REN: Root takes an id or options');
  if (spec.target === undefined && building()) return nest(spec);
  return start(spec, null, null, null).root;
}
