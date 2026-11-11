// The built-in contexts of an application root. Everything an application
// root confines derives from its one id: storage keys `ren:<id>:<key>`, lock
// names `ren:<id>:<name>` (their leases `ren-lock:<id>:<name>` in the storage
// backing, where there is no lock manager) and element ids `<id>-<name>`. A root provides
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
 * Once its root is disposed it still reads and writes the backing (an answer
 * that arrives late keeps what it brings); nothing tracks or hears it then.
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
    if (!this.version.root.closed) $read(this.version);
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
    if (!this.version.root.closed) $read(this.version);
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
    if (version.root.closed) return;
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

/** A request a Lease has not granted yet: its lock, and the one timer it waits on. @typedef {{ name: string, key: string, timer: any }} Ask */

/** @param {string} message */
function unsupported(message) {
  const error = new Error(message);
  error.name = 'NotSupportedError';
  return error;
}

/** A name no other tab's Lease has: 64 random bits. */
function token() {
  const words = new Uint32Array(2);
  const crypto = /** @type {any} */ (globalThis).crypto;
  if (typeof crypto?.getRandomValues === 'function') crypto.getRandomValues(words);
  else for (let i = 0; i < 2; i++) words[i] = Math.random() * 0x100000000;
  return words[0].toString(36) + words[1].toString(36);
}

/**
 * The locks of one root where there is no lock manager: a lease per lock in
 * the root's storage backing, shared by the tabs of an origin. A lease is
 * the item `ren-lock:<id>:<name>` holding `<until> <holder>`: outside the
 * root's Storage keys (`ren:<id>:`), so no Shelf lists, clears, tracks or
 * mirrors it.
 *
 * A request takes the lock when no other holder has an unexpired lease: it
 * writes its own, waits `settle` milliseconds for a tab that wrote at the
 * same moment (the last write stands) and holds the lock if the lease is
 * still its own; else it looks again every `poll` milliseconds. A lease
 * lasts `ttl` milliseconds from the moment it is held and is renewed every
 * third of that while its callback runs, so a holder that vanished (a tab
 * closed) frees the lock once its lease expires; the callback's end removes
 * it. Requests of one lock made through one Lease run in turn.
 *
 * It excludes as long as a holder's timers run at least once per `ttl` and
 * the tabs read one clock: a tab frozen for longer while it holds (a
 * suspended page) loses the lock to another tab while its callback still
 * runs, and nothing tells it.
 */
export class Lease {
  /** @param {string} id the root's id @param {Backing} backing */
  constructor(id, backing) {
    /** The lock names, as a lock manager would hold them. */
    this.names = `ren:${id}:`;
    /** The leases' keys in the backing. */
    this.prefix = `ren-lock:${id}:`;
    this.backing = backing;
    /** This Lease among those of other tabs. */
    this.holder = token();
    /** How long a lease lasts without a renewal, in milliseconds. */
    this.ttl = 15000;
    /** How long a request waits for a lease written at the same moment, in milliseconds. */
    this.settle = 50;
    /** How often a request looks again at a lease another holder has, in milliseconds. */
    this.poll = 100;
    /** The end of the last request of each lock made here: the next one's turn. @type {Map<string, Promise<void>>} */
    this.turns = new Map();
    /** The requests not granted yet. @type {Set<Ask>} */
    this.asks = new Set();
    /** The renewal timer of each lease held here, by its key. @type {Map<string, any>} */
    this.renewals = new Map();
    this.closed = false;
  }

  /** The lease kept under `key`, or null. @param {string} key @returns {{ until: number, holder: string } | null} */
  read(key) {
    const text = this.backing.getItem(key);
    if (text === null) return null;
    const at = text.indexOf(' ');
    const until = Number(text.slice(0, at));
    return at > 0 && until === until ? { until, holder: text.slice(at + 1) } : null;
  }

  /** True while another holder has an unexpired lease under `key`. @param {string} key */
  taken(key) {
    const lease = this.read(key);
    return lease !== null && lease.holder !== this.holder && lease.until > Date.now();
  }

  /** Writes this holder's lease under `key`, lasting `ttl` from now. @param {string} key */
  write(key) {
    this.backing.setItem(key, `${Date.now() + this.ttl} ${this.holder}`);
  }

  /** Removes the lease under `key` while it is this holder's; a backing that refuses leaves it to expire. @param {string} key */
  release(key) {
    try {
      if (this.read(key)?.holder === this.holder) this.backing.removeItem(key);
    } catch {
      // The lease expires by itself.
    }
  }

  /**
   * Requests the lock `name`: see `Locker.request` for what it supports.
   * @param {string} name @param {any} options @param {(lock: any) => any} callback
   * @returns {Promise<any>}
   */
  request(name, options, callback) {
    if (typeof callback !== 'function') return Promise.reject(new TypeError('REN: a lock request needs a callback'));
    const mode = options.mode ?? 'exclusive';
    if (mode !== 'exclusive' && mode !== 'shared') return Promise.reject(new TypeError(`REN: unknown lock mode "${String(mode)}"`));
    if (options.steal === true) return Promise.reject(unsupported('REN: a lock held as a lease in storage cannot be stolen (no lock manager)'));
    const signal = options.signal ?? null;
    const ifAvailable = options.ifAvailable === true;
    if (ifAvailable && signal !== null) return Promise.reject(unsupported('REN: a lock request takes ifAvailable or a signal, not both'));
    if (signal !== null && signal.aborted) return Promise.reject(signal.reason);
    return this.run(name, ifAvailable, signal, callback);
  }

  /**
   * @param {string} name @param {boolean} ifAvailable @param {any} signal @param {(lock: any) => any} callback
   * @returns {Promise<any>}
   */
  async run(name, ifAvailable, signal, callback) {
    const key = this.prefix + name;
    const before = this.turns.get(key);
    // Held or awaited here already: not available.
    if (ifAvailable && before !== undefined) return callback(null);
    /** Ends this request's turn. @type {() => void} */
    let done = () => {};
    /** @type {Promise<void>} */
    const ended = new Promise(resolve => (done = resolve));
    const turn = before === undefined ? ended : before.then(() => ended);
    this.turns.set(key, turn);
    /** @type {Ask} */
    const ask = { name, key, timer: null };
    this.asks.add(ask);
    /** @type {(() => void) | null} */
    let abort = null;
    /** Rejects when the signal aborts. @type {Promise<never> | null} */
    const aborted =
      signal === null
        ? null
        : new Promise((_, reject) => {
            abort = () => reject(signal.reason);
            signal.addEventListener('abort', abort, { once: true });
          });
    // One that aborts once nothing waits on it is not a failure.
    if (aborted !== null) aborted.catch(() => {});
    /** @template T @param {Promise<T>} wait @returns {Promise<T>} */
    const until = wait => (aborted === null ? wait : Promise.race([wait, aborted]));
    /** A request of a disposed root never settles. @returns {Promise<never>} */
    const never = () => new Promise(() => {});
    let leased = false;
    let held = false;
    try {
      if (before !== undefined) await until(before);
      if (this.closed) await never();
      for (;;) {
        // timer: poll, a lease another holder has is looked at again until it is removed or expired (a Backing has no event)
        while (!ifAvailable && this.taken(key)) await until(new Promise(resolve => (ask.timer = setTimeout(resolve, this.poll))));
        if (this.taken(key)) break;
        this.write(key);
        leased = true;
        // timer: feature, the settle window: a lease another tab wrote at the same moment shows within it
        await until(new Promise(resolve => (ask.timer = setTimeout(resolve, this.settle))));
        if (this.read(key)?.holder === this.holder) {
          // Still its own: held, its term counted from now.
          this.write(key);
          held = true;
          break;
        }
        leased = false;
        if (ifAvailable) break;
      }
      this.asks.delete(ask);
      if (!held) return await callback(null);
      // timer: feature, the lease is renewed while it is held, so only a holder that vanished lets it expire
      const renewal = setInterval(() => {
        try {
          if (this.read(key)?.holder === this.holder) this.write(key);
        } catch {
          // A renewal the backing refused: the next one, or the lease expires.
        }
      }, this.ttl / 3);
      this.renewals.set(key, renewal);
      return await callback({ name: this.names + name, mode: 'exclusive' });
    } finally {
      if (abort !== null) signal.removeEventListener('abort', abort);
      clearTimeout(ask.timer);
      this.asks.delete(ask);
      if (held) {
        clearInterval(this.renewals.get(key));
        this.renewals.delete(key);
      }
      if (leased) this.release(key);
      done();
      // The lock's turns are forgotten once every request up to this one has
      // ended: one that ends early (aborted in line) leaves the holder ahead.
      turn.then(() => {
        if (this.turns.get(key) === turn) this.turns.delete(key);
      });
    }
  }

  /** The locks with an unexpired lease in the backing (any tab's), and those requested here and not granted yet. @returns {{ held: string[], pending: string[] }} */
  query() {
    const backing = this.backing;
    const prefix = this.prefix;
    const now = Date.now();
    /** @type {string[]} */
    const held = [];
    for (let i = 0; i < backing.length; i++) {
      const key = backing.key(i);
      if (key === null || !key.startsWith(prefix)) continue;
      const lease = this.read(key);
      if (lease !== null && lease.until > now) held.push(key.slice(prefix.length));
    }
    return { held: held.sort(), pending: [...this.asks].map(ask => ask.name) };
  }

  /**
   * Ends with the root: the leases held here are removed (their callbacks
   * run on, no longer excluding), every timer is cleared, and the requests
   * not granted yet never settle, as a closed page's.
   */
  close() {
    this.closed = true;
    for (const ask of this.asks) {
      clearTimeout(ask.timer);
      this.release(ask.key);
    }
    this.asks.clear();
    for (const [key, renewal] of this.renewals) {
      clearInterval(renewal);
      this.release(key);
    }
    this.renewals.clear();
  }
}

/**
 * The locks of one root: Web Locks named `ren:<id>:<name>`, held by the
 * root's lock manager, or, where there is none, by its `lease` (leases in
 * the root's storage backing, which an application root in the direct
 * runtime sets). With neither, there are no locks: `request` throws.
 */
export class Locker {
  /** @param {string} id @param {Manager | null} manager */
  constructor(id, manager) {
    this.prefix = `ren:${id}:`;
    this.manager = manager;
    /** The locks without a manager, null for none: set by the application root, cleared when it ends. @type {Lease | null} */
    this.lease = null;
  }

  /**
   * Requests the lock `name` of this root, as `navigator.locks.request`:
   * the callback runs holding it, and the promise settles as the callback
   * does, the lock released either way.
   *
   * With a lock manager, the request is the manager's. Without one, the
   * `lease` holds the lock across the tabs that share the storage backing:
   * the callback gets `{ name, mode: 'exclusive' }`; `ifAvailable: true`
   * calls it with null when the lock is held or awaited; a `signal` that
   * aborts while the request waits rejects it with the signal's reason (a
   * granted request runs on); `mode: 'shared'` is granted as exclusive (one
   * holder at a time, so two shared requests wait for each other); `steal`
   * rejects with a `NotSupportedError`, as `ifAvailable` with a `signal`
   * does. What the backing refuses (a full or closed storage) rejects the
   * request. Once the root is disposed its held leases are removed and its
   * waiting requests never settle.
   *
   * With no manager and no lease (a root with no storage, a worker's root,
   * a Locker made by hand), it throws: there are no locks.
   * @template T
   * @param {string} name
   * @param {any} options Web Locks options, or the callback
   * @param {((lock: any) => T | Promise<T>)=} callback
   * @returns {Promise<T>}
   */
  request(name, options, callback) {
    const manager = this.manager;
    if (manager === null) {
      const lease = this.lease;
      if (lease === null) throw new Error('REN: this root has no lock manager (Web Locks)');
      if (typeof options === 'function') return lease.request(name, {}, options);
      return lease.request(name, options ?? {}, /** @type {any} */ (callback));
    }
    if (typeof options === 'function') return manager.request(this.prefix + name, {}, options);
    return manager.request(this.prefix + name, options ?? {}, /** @type {any} */ (callback));
  }

  /**
   * The names of this root's held and pending locks. From a lease: the
   * locks any tab holds, and the requests made here that still wait
   * (another tab's waiting requests are not known).
   * @returns {Promise<{ held: string[], pending: string[] }>}
   */
  async query() {
    const manager = this.manager;
    if (manager === null) return this.lease === null ? { held: [], pending: [] } : this.lease.query();
    if (typeof manager.query !== 'function') return { held: [], pending: [] };
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
