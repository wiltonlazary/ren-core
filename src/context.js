// The built-in contexts of an application root. Everything an application
// root confines derives from its one id: storage keys `ren:<id>:<key>`, lock
// names `ren:<id>:<name>` and element ids `<id>-<name>`. A root provides
// these contexts at its base (read-only layers), so application code reads
// them with `$lookup`, like any context. A nested root starts a new chain: it
// sees none of its parent's contexts.

import { $context, Layer } from 'rrx-core/context';
import { $signal, $read, $write, $writable, $untrack, $unowned, $lookup } from 'rrx-core/core';

/** @typedef {import('rrx-core/core').Graph} Graph */

/**
 * Web Storage, or anything with its methods.
 * @typedef {object} Backing
 * @property {(key: string) => string | null} getItem
 * @property {(key: string, value: string) => void} setItem
 * @property {(key: string) => void} removeItem
 * @property {(index: number) => string | null} key
 * @property {number} length
 */

/**
 * A Web Locks manager, or anything with its `request`.
 * @typedef {object} Manager
 * @property {(name: string, options: any, callback: (lock: any) => any) => Promise<any>} request
 * @property {(() => Promise<{ held?: { name?: string }[], pending?: { name?: string }[] }>)=} query
 */

/**
 * Where a root runs and renders.
 * @typedef {object} Place
 * @property {'direct' | 'worker'} runtime `direct`: the graph shares the renderer's thread; `worker`: it runs in a worker.
 * @property {string} renderer The renderer's name: `dom`, `shadow`, `canvas`, `skia`, `three`, `json`, `custom` (a Host without a `kind`), or `remote` inside a worker.
 * @property {any} element The root's host element on the main thread, or null (inside a worker, or a canvas-less Skia root).
 * @property {import('./remote.js').Connection | null=} connection Worker runtime, main thread: the connection to the root's worker (`idle()`, `totals`).
 */

/**
 * The storage of one root: the keys of a Web Storage under `ren:<id>:`.
 * Reads track one version signal of the root, so a computation that reads a
 * key follows writes to it, from this root, another tab or the other thread.
 * Every change dispatches `ren:storage` on the root's host element, with
 * `detail` `{ id, key, value }` (`key` null when the storage was cleared).
 */
export class Shelf {
  /** @param {Graph} root @param {Backing} backing */
  constructor(root, backing) {
    this.id = root.id;
    this.prefix = `ren:${root.id}:`;
    this.backing = backing;
    this.version = $unowned(root, () => $writable($signal(root, 0)));
    /** Receives the changes made on this side, for the other thread. @type {((key: string | null, value: string | null) => void) | null} */
    this.sink = null;
    /** Tells the application root of each change (it dispatches `ren:storage` on its host element); null in a worker. @type {((key: string | null, value: string | null) => void) | null} */
    this.notify = null;
  }

  /** The value of `key`, or null. @param {string} key @returns {string | null} */
  get(key) {
    $read(this.version);
    return this.backing.getItem(this.prefix + key);
  }

  /** @param {string} key @param {string} value */
  set(key, value) {
    const text = String(value);
    this.backing.setItem(this.prefix + key, text);
    this.changed(key, text, 0);
  }

  /** @param {string} key */
  remove(key) {
    this.backing.removeItem(this.prefix + key);
    this.changed(key, null, 0);
  }

  /** This root's keys, sorted. @returns {string[]} */
  keys() {
    $read(this.version);
    return this.own().sort();
  }

  /** Removes this root's keys only. */
  clear() {
    for (const key of this.own()) this.backing.removeItem(this.prefix + key);
    this.changed(null, null, 0);
  }

  /** @returns {string[]} */
  own() {
    const backing = this.backing;
    const prefix = this.prefix;
    /** @type {string[]} */
    const out = [];
    for (let i = 0; i < backing.length; i++) {
      const key = backing.key(i);
      if (key !== null && key.startsWith(prefix)) out.push(key.slice(prefix.length));
    }
    return out;
  }

  /** Every key and value, flat: `[key, value, …]`. @returns {string[]} */
  entries() {
    /** @type {string[]} */
    const out = [];
    for (const key of this.own()) {
      const value = this.backing.getItem(this.prefix + key);
      if (value !== null) out.push(key, value);
    }
    return out;
  }

  /**
   * A change from elsewhere. `write` stores it (from the other thread); a
   * storage event from another tab has already been stored.
   * @param {string | null} key @param {string | null} value @param {boolean} write
   */
  receive(key, value, write) {
    if (write && key !== null) {
      if (value === null) this.backing.removeItem(this.prefix + key);
      else this.backing.setItem(this.prefix + key, value);
    }
    this.changed(key, value, write ? 2 : 1);
  }

  /**
   * @param {string | null} key @param {string | null} value
   * @param {number} origin 0: this side; 1: another tab; 2: the other thread (not echoed back)
   */
  changed(key, value, origin) {
    const version = this.version;
    $write(version, $untrack(version.root, () => $read(version)) + 1);
    if (origin !== 2 && this.sink !== null) this.sink(key, value);
    if (this.notify !== null) this.notify(key, value);
  }

  /**
   * Follows `storage` events for this root's keys on `target` (a window);
   * returns the function that stops.
   * @param {{ addEventListener: Function, removeEventListener: Function }} target
   */
  listen(target) {
    const prefix = this.prefix;
    /** @param {any} event */
    const listener = event => {
      if (event.storageArea !== this.backing) return;
      const key = event.key;
      if (key === null) this.receive(null, null, false);
      else if (typeof key === 'string' && key.startsWith(prefix)) this.receive(key.slice(prefix.length), event.newValue ?? null, false);
    };
    target.addEventListener('storage', listener);
    return () => target.removeEventListener('storage', listener);
  }
}

/** An in-memory Backing: the worker's mirror of its root's keys. @implements {Backing} */
export class Memory {
  constructor() {
    /** @type {Map<string, string>} */
    this.map = new Map();
  }

  get length() {
    return this.map.size;
  }

  /** @param {number} index */
  key(index) {
    let i = 0;
    for (const key of this.map.keys()) if (i++ === index) return key;
    return null;
  }

  /** @param {string} key */
  getItem(key) {
    return this.map.get(key) ?? null;
  }

  /** @param {string} key @param {string} value */
  setItem(key, value) {
    this.map.set(key, String(value));
  }

  /** @param {string} key */
  removeItem(key) {
    this.map.delete(key);
  }
}

/** The locks of one root: Web Locks named `ren:<id>:<name>`. */
export class Locker {
  /** @param {string} id @param {Manager | null} manager */
  constructor(id, manager) {
    this.prefix = `ren:${id}:`;
    this.manager = manager;
  }

  /**
   * Requests the lock `name` of this root, as `navigator.locks.request`.
   * @template T
   * @param {string} name
   * @param {any} options Web Locks options, or the callback
   * @param {((lock: any) => T | Promise<T>)=} callback
   * @returns {Promise<T>}
   */
  request(name, options, callback) {
    const manager = this.manager;
    if (manager === null) throw new Error('REN: this root has no lock manager (Web Locks)');
    if (typeof options === 'function') return manager.request(this.prefix + name, {}, options);
    return manager.request(this.prefix + name, options ?? {}, /** @type {any} */ (callback));
  }

  /** The names of this root's held and pending locks. @returns {Promise<{ held: string[], pending: string[] }>} */
  async query() {
    const manager = this.manager;
    if (manager === null || typeof manager.query !== 'function') return { held: [], pending: [] };
    const state = await manager.query();
    const prefix = this.prefix;
    /** @param {{ name?: string }[] | undefined} list */
    const own = list => (list ?? []).map(lock => lock.name ?? '').filter(name => name.startsWith(prefix)).map(name => name.slice(prefix.length));
    return { held: own(state.held), pending: own(state.pending) };
  }
}

/** The id of the root being built or run. */
export const Id = $context('');
/** The root's storage (`ren:<id>:` keys), or null when it has none. */
export const Storage = $context(/** @type {Shelf | null} */ (null));
/** The root's locks (`ren:<id>:` names). */
export const Locks = $context(new Locker('', null));
/** Where the root runs and renders. */
export const Runtime = $context(/** @type {Place} */ ({ runtime: 'direct', renderer: '', element: null, connection: null }));
/** The value the parent passes a nested root (its `props`), tracked. */
export const Props = $context(/** @type {any} */ (undefined));
/** Sends data to the parent's `onMessage` (worker runtime: structured-clone data). */
export const Send = $context(
  /** @type {(data: any) => void} */ (
    () => {
      throw new Error('REN: this root has no parent to send to');
    }
  ),
);

/**
 * An element id unique across the roots of a document for a name without
 * `-` (`<id>-<name>`: root `a` with `b-c` and root `a-b` with `c` meet), for
 * `id`, `for` and the aria id references. `$name(root, name)` names the
 * root; `$name(name)` uses the running root.
 * @overload
 * @param {Graph} root
 * @param {string} name
 * @returns {string}
 */
/**
 * @overload
 * @param {string} name
 * @returns {string}
 */
/**
 * @param {any} a @param {any} [b]
 * @returns {string}
 */
export function $name(a, b) {
  const rooted = typeof a !== 'string';
  const id = rooted ? $lookup(a, Id) : $lookup(Id);
  if (id === '') throw new Error('REN: $name needs a root (call it while a view is built, or pass the root)');
  return `${id}-${rooted ? b : a}`;
}

/**
 * Sets a root's base context: the read-only layers every scope of the root
 * inherits. `props` is a node read by `$lookup(Props)`.
 * @param {Graph} root @param {[import('rrx-core/context').Context<any>, any][]} fixed @param {any} props
 */
export function base(root, fixed, props) {
  /** @type {Layer | null} */
  let chain = new Layer(null, Id, null, root.id, false);
  for (const [key, value] of fixed) chain = new Layer(chain, key, null, value, false);
  if (props != null) chain = new Layer(chain, Props, props, undefined, false);
  root.ctx = chain;
  root.home.context = chain;
}
