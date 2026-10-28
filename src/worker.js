// ren-core/worker: the worker side of the worker mode.
//
// `serve(view, options)` runs the components, the rrx-core graph and the ren-core
// component layer in a dedicated worker, against a remote Host whose nodes are
// handles with integer ids. The renderer stays on the main thread, where
// `connect` (ren-core/remote) applies what this module records.
//
// Every host call is recorded into flat buffers: Int32 words for opcodes, ids
// and small operands, a Float64 column for other numbers, a per-message string
// table for values, a persistent table for names (tags, properties, events),
// and a rare side slot for structured values such as style objects or shapes.
// One message carries one flush: the typed buffers are transferred, and the
// main thread transfers them back when it has applied them, so steady state
// allocates no buffers. `parent`, `next`, `owns` and `layer` are answered from
// the handles themselves, which mirror the tree: nothing waits for a reply.
//
// Lanes, promotion, coalescing and the budget:
// - Operations recorded while the graph runs deferred work (`$deferred(root)`:
//   inside `$defer`, and the low-lane effects and applications it queued) wait
//   in a low stream behind urgent ones.
// - An urgent operation that changes structure, or addresses a node a deferred
//   operation touched, first promotes the deferred operations ahead of it, so
//   every message applies in a valid order.
// - Property updates coalesce per node and property within their lane until
//   the message leaves: the later value overwrites the earlier record in place,
//   so a dead value is never sent.
// - One message is in flight at a time (backpressure). While the main thread
//   has not applied the previous one, new work merges into the pending
//   buffers, which coalesces it further.
// - Input preempts on both sides. An answer to input carries no deferred
//   operations. When the message in flight is one the main thread holds for
//   its next frame, and the answer touches nothing that message touched, the
//   answer overtakes it: it is posted at once and applied on arrival. When it
//   depends on the held message, it is posted at once as well, and the main
//   thread applies the held message first; it never waits for an
//   acknowledgement, which could queue behind this thread's long tasks.
// - A message carries every urgent operation and deferred ones up to a budget:
//   the milliseconds of main-thread apply time the options allow, from the
//   costs the main thread reports, and a record limit that halves when the
//   main thread reports a late frame and grows again while frames are on time
//   (rendering cost included). Each message that carries deferred work carries
//   at least MINIMUM records, and an answer to input carries them too once
//   the backlog has waited STARVE ms, so the low lane cannot starve.
//
// Wire format (worker → main), one array per message:
//   [BATCH, ops: ArrayBuffer, n, nums: ArrayBuffer | null, m, strs | null, names | null, side | null]
//   ops is Int32 words; the first HEADER words are
//     [acked, flags, split, number]  acked: the last event or post sequence
//     number handled before this message; flags: URGENT (answers input) |
//     MORE (deferred operations remain) | OVERTAKE (independent of a held
//     message, apply at once); split: where the deferred operations begin;
//     number: the message's own number, returned in its acknowledgement.
//   Then records, each an opcode and fixed operands (SIZE below):
//     ELEMENT id tag lines parent   TEXT id str   MARKER id   CONTENT id str
//     SET_* id name operand  (always four words; UNDEF NULL FALSE TRUE: 0; INT: the value;
//       NUM: an index into nums; STR: into strs; NODE: an id;
//       OBJ: an index into side holding value, previous)
//     INSERT parent child before (-1 appends)   REMOVE parent child
//     LISTEN node listener generation name   UNLISTEN listener   FREE id
//     VIEW node follower (follow the viewport of the region node is in, as
//       the host's `viewportOf` gives it; reports come back as REGION)
//     UNVIEW follower
//     PLAN plan side (a compiled template's tree, once per plan, urgent)
//     CLONE plan first parent (an instance of a plan: ids first … first +
//       refs - 1)
//     BUILD id tag side parent (ELEMENT with the construct props, `serve`'s
//       `construct`, as an object in side)   CLONE_WITH plan first side
//       parent (CLONE with the instance's construct values, sparse by value
//       index)
//   parent is the id of the element the new one goes into (the Host's
//   `element` and `clone` hear it), -1 for none known.
//   tag and name index the persistent name table; `names` extends it.
//   Id 0 is the container and id 1 the host's portal layer.
//   Also [VERSION, protocol] (this side's wire version, port.js's
//   PROTOCOL, the answer to ROOT), [SYNCED, tokens], [APP, data], and
//   [SAVED, pairs, seen]: the
//   root's storage writes of one task, flat [key, value | null, …], and the
//   number of STORE messages applied before them.
//   With a shared mailbox (mailbox.js; the main thread offers it with
//   [MAILBOX, buffer]), a message without side values that fits is written
//   there instead and announced by [BELL, number]; its buffers stay here.
// Messages main → worker: [EVENT, count, ...records of RECORD scalars]
// (a record's flags word carries six flag bits, then a wheel's deltaMode in
// two bits, a focus's focusVisible in one, and above them the number of the
// main-thread dispatch it came from, 0 for none: a stopPropagation skips the
// later records of its dispatch),
// [RETURN, ops, nums | null, apply ms, present ms, records, number, late],
// [SYNC, token], [POST, seq, lane, data]; [ROOT, id, entries, props, view,
// protocol, regional] first, on which the view builds (an application root's id, which
// must be this root's, or null; its storage as flat [key, value, …] or null;
// the parent's first props; the host's viewport as [width, height, flags], or
// null; the main thread's wire version, which must be this side's; whether
// its host gives regions viewports of their own, `viewportOf`); [VIEWPORT,
// width, height, flags] when the host's viewport changes; [REGION, follower,
// width, height, flags] for each report of a region's viewport VIEW follows;
// for an application root [STORE, pairs] (writes made on the main thread or
// in another tab, or, after a SAVED that crossed a STORE, the values the main
// thread holds for its keys: the main thread's storage is the one that
// counts) and [PROPS, value] (the parent's props).

import { $root, $batch, $defer, $deferred, $dispose, $signal, $write, $writable, $unowned } from 'rrx-core';
import { mount } from './core.js';
import { subscribe, NOTHING, PROTOCOL, mismatch } from './port.js';
import { Shelf, Memory, Locker, Storage, Locks, Runtime, Send, base } from './context.js';
import { Mailbox } from './mailbox.js';

/** @typedef {import('./port.js').Port} Port */
/** @typedef {import('rrx-core/core').Graph} Graph */
/** @typedef {import('./core.js').Host} Host */

// Opcodes. remote.js holds the same table; both are module-local constants.
const ELEMENT = 1;
const TEXT = 2;
const MARKER = 3;
const CONTENT = 4;
const SET_UNDEF = 5;
const SET_NULL = 6;
const SET_FALSE = 7;
const SET_TRUE = 8;
const SET_INT = 9;
const SET_NUM = 10;
const SET_STR = 11;
const SET_NODE = 12;
const SET_OBJ = 13;
const INSERT = 14;
const REMOVE = 15;
const LISTEN = 16;
const UNLISTEN = 17;
const FREE = 18;
const PLAN = 19;
const CLONE = 20;
const BUILD = 21;
const CLONE_WITH = 22;
const VIEW = 23;
const UNVIEW = 24;
/** Words per record, by opcode. */
const SIZE = new Int32Array([0, 5, 3, 2, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 5, 2, 2, 3, 4, 5, 5, 3, 2]);

// Messages.
const BATCH = 1;
const SYNCED = 2;
const APP = 3;
const SAVED = 5;
const BELL = 6;
const VERSION = 7;
const EVENT = 1;
const RETURN = 2;
const SYNC = 3;
const POST = 4;
const ROOT = 5;
const STORE = 6;
const PROPS = 7;
const MAILBOX = 8;
const VIEWPORT = 9;
const REGION = 10;

const HEADER = 4;
const URGENT = 1;
const MORE = 2;
const OVERTAKE = 4;
/** Milliseconds a deferred backlog may wait behind answers to input. */
const STARVE = 100;
/** Scalars per event record: seq, listener, generation, flags, button, x, y, dx, dy, value, key. */
const RECORD = 11;
/** The fewest deferred operations a message carries while any wait. */
const MINIMUM = 256;
/** A handle's flag: the host ignores children inserted into it (an Edit). */
const LEAF = 1;
/** The coalescing name of CONTENT. */
const CONTENT_NAME = -1;

/**
 * The viewport of the region a node is in, followed on the main thread
 * (VIEW) while it has readers: the root's until the main thread reports the
 * region's (REGION), and the root's again after the last reader leaves.
 */
class Region {
  /** @param {any} host the worker's Host @param {Handle} node */
  constructor(host, node) {
    this.host = host;
    this.node = node;
    /** Its follower number while followed, else -1. */
    this.id = -1;
    /** The region's viewport as the main thread last reported it, or null (the root's). @type {number[] | null} */
    this.own = null;
    /** @type {Set<(width: number, height: number, flags: number) => void>} */
    this.viewers = new Set();
  }

  /** @param {(width: number, height: number, flags: number) => void} report @returns {() => void} */
  viewport(report) {
    if (this.viewers.size === 0) this.id = this.host.follow(this);
    this.viewers.add(report);
    const v = this.own ?? this.host.view;
    report(v[0], v[1], v[2]);
    return () => {
      if (!this.viewers.delete(report) || this.viewers.size > 0) return;
      this.host.unfollow(this, this.id);
      this.id = -1;
      this.own = null;
    };
  }

  /** Tells every reader. @param {number} width @param {number} height @param {number} flags */
  report(width, height, flags) {
    for (const report of [...this.viewers]) report(width, height, flags);
  }
}

/**
 * A remote node: its id on the main thread, and the tree around it as the
 * host will have it once the recorded operations apply.
 */
export class Handle {
  /** @param {number} id @param {number} flags */
  constructor(id, flags) {
    this.id = id;
    this.flags = flags;
    /** @type {Handle | null} */
    this.parent = null;
    /** @type {Handle | null} */
    this.first = null;
    /** @type {Handle | null} */
    this.last = null;
    /** @type {Handle | null} */
    this.prev = null;
    /** @type {Handle | null} */
    this.next = null;
    /** The low-stream position of the last deferred operation on this node. */
    this.low = -1;
    /** The urgent-stream position of the last urgent operation on this node. */
    this.high = -1;
    // The coalescing slot of one property: its name, record position and lane.
    this.sn = -2;
    this.sp = -1;
    this.sl = 0;
    /** Further slots, as name, position, lane triples. @type {number[] | null} */
    this.more = null;
  }
}

/** A stream of records and its tables. Positions are absolute: `base + index`. */
class Stream {
  /** @param {number} start the words reserved at the front (the header) */
  constructor(start) {
    this.start = start;
    this.ops = new Int32Array(1024);
    this.n = start;
    this.nums = new Float64Array(64);
    this.m = 0;
    /** @type {string[]} */
    this.strs = [];
    /** @type {any[]} */
    this.side = [];
    /** The absolute position of index 0. */
    this.base = -start;
    /** The absolute position of the first unsent record: `base + start`. */
    this.floor = 0;
    /** Records held. */
    this.k = 0;
  }

  /** Makes room for `count` more words. @param {number} count */
  room(count) {
    if (this.n + count <= this.ops.length) return;
    let size = this.ops.length * 2;
    while (size < this.n + count) size *= 2;
    const ops = new Int32Array(size);
    ops.set(this.ops.subarray(0, this.n));
    this.ops = ops;
  }

  /** @param {number} value */
  num(value) {
    if (this.m === this.nums.length) {
      const nums = new Float64Array(this.m * 2);
      nums.set(this.nums);
      this.nums = nums;
    }
    this.nums[this.m] = value;
    return this.m++;
  }
}

/** Inputs whose handler stopped their propagation. @type {WeakSet<Input>} */
const stopped = new WeakSet();

/** A user event forwarded from the main thread. */
export class Input {
  /**
   * @param {string} type @param {number} flags @param {number} button @param {number} x @param {number} y
   * @param {number} dx @param {number} dy @param {string | null} value @param {string | null} key
   */
  constructor(type, flags, button, x, y, dx, dy, value, key) {
    /** The ren-core event name (press, change, key, …, or a DOM event name). */
    this.type = type;
    /** An edit's value (change, submit, input). */
    this.value = value;
    /** The key (key, keydown, submit). */
    this.key = key;
    this.x = x;
    this.y = y;
    this.deltaX = dx;
    this.deltaY = dy;
    this.button = button;
    this.shiftKey = (flags & 1) !== 0;
    this.ctrlKey = (flags & 2) !== 0;
    this.altKey = (flags & 4) !== 0;
    this.metaKey = (flags & 8) !== 0;
    /** A wheel's unit, as the DOM's WheelEvent: 0 pixels, 1 lines, 2 pages. */
    this.deltaMode = (flags >>> 6) & 3;
    this.checked = (flags & 16) !== 0;
    /** A key's target is a text field ($keys). */
    this.editable = (flags & 32) !== 0;
    /** A focus shows its ring, as the DOM's :focus-visible (focus, focusin). */
    this.focusVisible = (flags & 256) !== 0;
    /** A resize's new border box (its x and y on the wire). */
    this.width = type === 'resize' ? x : 0;
    this.height = type === 'resize' ? y : 0;
  }

  /** The event itself, so `event.target.value` reads as on the DOM. */
  get target() {
    return this;
  }

  /** Cannot cross the worker boundary; use the `prevent` property. */
  preventDefault() {}

  /** The handlers after this one that heard the same main-thread dispatch (ancestors, `$keys`) do not run. */
  stopPropagation() {
    stopped.add(this);
  }

  /** The primary pointer's id, as the DOM's. */
  get pointerId() {
    return 1;
  }

  /** Pointer capture cannot cross the worker boundary: a handler here asks for it in vain (the page's own renderer decides). */
  setPointerCapture() {}

  releasePointerCapture() {}
}

/**
 * The scheduling lane of work posted to the worker: `urgent` answers input,
 * `normal` is a view update, and `background` runs inside rrx-core `$defer`, so the
 * operations it causes publish in the low lane.
 * @typedef {'urgent' | 'normal' | 'background'} Lane
 */

/**
 * @typedef {object} Options
 * @property {Port=} port The endpoint to the main thread; the worker's global scope by default.
 * @property {Graph=} root The root to render in; a new one by default, disposed with the session.
 * @property {string=} id The id of the new root (`main` by default); ignored with `root`. The main thread's `$root` sends the id it expects.
 * @property {import('./context.js').Manager | null=} locks The lock manager behind `$lookup(Locks)` (`navigator.locks` where it exists).
 * @property {boolean=} auto Flush every write outside a batch at once (true by default).
 * @property {(number | false)=} retire As `mount`: background disposal from this many rows (1000); the worker sweeps in slices between messages.
 * @property {(import('./sweep.js').Mode | false)=} sweep As `mount` (`task` in a worker).
 * @property {((drain: import('./sweep.js').Drain) => void)=} swept As `mount`.
 * @property {Iterable<string>=} construct The property names the main thread's renderer needs when it makes an element (its Host's `construct`, as ren-three's `CONSTRUCT`): their values, which must be structured-clone data, travel with the element. None by default.
 * @property {boolean=} lanes Publish deferred operations behind urgent ones, under the budget (true).
 * @property {boolean=} coalesce Merge property updates per node within a lane (true).
 * @property {boolean=} backpressure Keep one message in flight and merge while it is (true).
 * @property {number=} budget Milliseconds of main-thread apply time one message may take for deferred operations (8); Infinity publishes all.
 * @property {((data: any, lane: Lane) => void)=} message Receives `Connection.post` data, in an rrx-core `$batch` of its lane.
 */

/** A message in flight: its number, and the stream positions it carried. */
class Flight {
  constructor() {
    this.number = 0;
    this.urgent = false;
    this.hiFrom = 0;
    this.hiTo = 0;
    this.loFrom = 0;
    this.loTo = 0;
    /** Ids it freed, reusable once it is applied. @type {number[]} */
    this.releasing = [];
  }

  /** True when the operation at position high or low travels in this message. @param {number} high @param {number} low */
  carries(high, low) {
    return (high >= this.hiFrom && high < this.hiTo) || (low >= this.loFrom && low < this.loTo);
  }
}

/** The worker-side counters. */
export class Counters {
  constructor() {
    /** Messages posted. */
    this.messages = 0;
    /** Records posted. */
    this.records = 0;
    /** Property updates merged into an earlier record. */
    this.coalesced = 0;
    /** Promotions of deferred operations. */
    this.promotions = 0;
    /** Flushes that merged into pending buffers while a message was in flight. */
    this.merged = 0;
    /** Deferred records held back by the budget at the last message. */
    this.backlog = 0;
    /** Answers to input that overtook a held message, and answers posted behind a held message they depend on. */
    this.overtaken = 0;
    this.hurried = 0;
    /** Late frames the main thread reported. */
    this.late = 0;
    /** The deferred record limit (halved on late frames). */
    this.limit = 0;
    /** Events dispatched, and event messages received. */
    this.events = 0;
    this.bursts = 0;
    /** Milliseconds inside postMessage for view messages (serialization and transfer). */
    this.post = 0;
    /** Words and numbers posted. */
    this.words = 0;
    this.numbers = 0;
    /** Messages sent through the shared mailbox. */
    this.boxed = 0;
  }
}

/**
 * The remote Host.
 * @implements {Host}
 */
export class Remote {
  /** @param {Graph} root @param {Port} port @param {Options} options */
  constructor(root, port, options) {
    this.root = root;
    this.port = port;
    /** The main thread's construct props, or undefined. @type {ReadonlySet<string> | undefined} */
    this.construct = options.construct === undefined ? undefined : new Set(options.construct);
    /** Per plan, the value indexes of its construct props. @type {WeakMap<object, number[]>} */
    this.constructs = new WeakMap();
    this.lanes = options.lanes !== false;
    this.coalesce = options.coalesce !== false;
    this.backpressure = options.backpressure !== false;
    this.budget = options.budget ?? 8;
    this.message = options.message ?? null;
    this.hi = new Stream(HEADER);
    this.lo = new Stream(0);
    /** The streams by lane: 0 urgent, 1 deferred. */
    this.streams = [this.hi, this.lo];
    this.spare = new Stream(0);
    /** The persistent name table. @type {Map<string, number>} */
    this.index = new Map();
    /** Names added since the last message. @type {string[]} */
    this.fresh = [];
    this.nextId = 2;
    /** Compiled template plans sent to the main thread, by plan. @type {Map<any, number>} */
    this.plans = new Map();
    /** @type {number[]} */
    this.free = [];
    /** Ids whose handles were collected, freed once nothing unsent refers to them. @type {number[]} */
    this.dying = [];
    this.registry = new FinalizationRegistry((/** @type {number} */ id) => {
      this.dying.push(id);
      if (this.dying.length === 1) queueMicrotask(() => this.flush());
    });
    this.container = new Handle(0, 0);
    this.portal = new Handle(1, 0);
    // Listeners: handler, generation and name by listener id.
    /** @type {(((event: any) => void) | null)[]} */
    this.handlers = [];
    /** @type {number[]} */
    this.gens = [];
    /** @type {string[]} */
    this.types = [];
    /** @type {number[]} */
    this.spareIds = [];
    this.nextListener = 0;
    /** The last event or post sequence number handled. */
    this.acked = 0;
    /** True when the pending operations answer input. */
    this.input = false;
    this.closed = false;
    /** Messages in flight (at most two: a held one and an answer overtaking it). @type {Flight[]} */
    this.flights = [];
    /** @type {Flight[]} */
    this.spareFlights = [new Flight(), new Flight(), new Flight()];
    /** The message in flight that the main thread holds for its frame, or null. @type {Flight | null} */
    this.held = null;
    /** The number of the next message. */
    this.number = 1;
    /** True when the pending urgent work touched a node the held message touched. */
    this.dependent = false;
    /** True when deferred work was promoted into the pending message. */
    this.promoted = false;
    this.overtake = false;
    /** When the low stream last published (or began to wait). */
    this.lowAt = 0;
    /** The deferred record limit: halves on a late frame, grows while frames are on time. */
    this.limit = 1 << 30;
    /** Buffers the main thread returned. @type {ArrayBuffer[]} */
    this.pool32 = [];
    /** @type {ArrayBuffer[]} */
    this.pool64 = [];
    /** Main-thread cost estimates from acknowledgements: ms per record, and ms per present. */
    this.perRecord = 0.0005;
    this.perPresent = 0;
    /** @type {any[]} */
    this.out = [BATCH, null, 0, null, 0, null, null, null];
    /** The shared mailbox the main thread offered, and the bell that announces a message in it. @type {Mailbox | null} */
    this.box = null;
    this.bell = [BELL, 0];
    /** @type {ArrayBuffer[]} */
    this.transfer = [];
    /** Waiting SYNC tokens, each with the deferred stream's end at its arrival. @type {number[]} */
    this.syncs = [];
    this.counters = new Counters();
    /** The root's storage mirror; its writes go to the main thread, batched per task. */
    this.shelf = new Shelf(root, new Memory());
    /** @type {(string | null)[]} */
    this.saving = [];
    /** STORE messages applied: a SAVED tells the main thread which of its writes it crossed. */
    this.seen = 0;
    /** The main-thread dispatch whose propagation a handler stopped, 0 for none. */
    this.halted = 0;
    this.shelf.sink = (key, value) => {
      this.saving.push(key, value);
      if (this.saving.length === 2) queueMicrotask(() => this.save());
    };
    /** The parent's props. */
    this.props = $unowned(root, () => $writable($signal(root, /** @type {any} */ (undefined))));
    /** The main thread's viewport (width, height, flags) and who follows it (`$viewport`). */
    this.view = [0, 0, 0];
    /** @type {Set<(width: number, height: number, flags: number) => void>} */
    this.viewers = new Set();
    /** Whether the main thread's host gives regions viewports of their own (its `viewportOf`). */
    this.regional = false;
    /** Each node's region viewport source, made on the first `viewportOf`. @type {WeakMap<Handle, Region>} */
    this.regionOf = new WeakMap();
    /** The regions followed, by follower number (never reused). @type {Map<number, Region>} */
    this.regions = new Map();
    this.nextRegion = 0;
    /** Builds the view: `serve` sets it, the main thread's first message (ROOT) runs it. @type {(() => void) | null} */
    this.start = null;
    this.stop = subscribe(port, data => this.receive(data));
  }

  /** Posts the storage writes of this task in one message. */
  save() {
    const pairs = this.saving;
    if (pairs.length === 0 || this.closed) return;
    this.saving = [];
    this.port.postMessage([SAVED, pairs, this.seen], NOTHING);
  }

  // -------------------------------------------------------------------------
  // Recording

  /** The stream of the current work. */
  pick() {
    return this.lanes && $deferred(this.root) ? this.lo : this.hi;
  }

  /** The persistent index of a name. @param {string} name */
  name(name) {
    let i = this.index.get(name);
    if (i === undefined) {
      i = this.index.size;
      this.index.set(name, i);
      this.fresh.push(name);
    }
    return i;
  }

  alloc() {
    return this.free.length > 0 ? /** @type {number} */ (this.free.pop()) : this.nextId++;
  }

  /**
   * Before an urgent operation on a handle: promotes deferred work that
   * touched it, and notes whether the held message touched it.
   * @param {Handle} h
   */
  touch(h) {
    const lo = this.lo;
    if (lo.n > 0 && h.low >= lo.floor) this.promote();
    const held = this.held;
    if (held !== null && held.carries(h.high, h.low)) this.dependent = true;
  }

  /** Moves every deferred operation ahead of the next urgent one. */
  promote() {
    this.counters.promotions++;
    this.promoted = true;
    this.move(Infinity);
  }

  /**
   * Moves up to `limit` deferred records to the end of the urgent stream, and
   * keeps the rest (compacted, with fresh tables) in the low stream.
   * @param {number} limit
   */
  move(limit) {
    const lo = this.lo;
    const hi = this.hi;
    const o = lo.ops;
    const n = lo.n;
    let i = 0;
    let count = 0;
    while (i < n && count < limit) {
      i += copy(o, i, lo, hi);
      count++;
    }
    if (i < n) {
      // Compact the rest into the spare stream; absolute positions hold.
      const rest = this.spare;
      rest.n = 0;
      rest.m = 0;
      rest.strs.length = 0;
      rest.side.length = 0;
      rest.k = 0;
      let j = i;
      while (j < n) j += copy(o, j, lo, rest);
      rest.base = lo.base + i;
      rest.floor = rest.base;
      lo.n = 0;
      lo.m = 0;
      lo.strs.length = 0;
      lo.side.length = 0;
      lo.k = 0;
      this.spare = lo;
      this.lo = rest;
      this.streams[1] = rest;
    } else {
      lo.base += n;
      lo.floor = lo.base;
      lo.n = 0;
      lo.m = 0;
      lo.strs.length = 0;
      lo.side.length = 0;
      lo.k = 0;
    }
    return count;
  }

  /** The coalescing record of `name` on `h` in `lane`, or -1. @param {Handle} h @param {number} name @param {number} lane */
  slot(h, name, lane) {
    const base = this.streams[lane].floor;
    if (h.sn === name && h.sl === lane && h.sp >= base) return h.sp;
    const more = h.more;
    if (more !== null)
      for (let k = 0; k < more.length; k += 3) if (more[k] === name && more[k + 2] === lane && more[k + 1] >= base) return more[k + 1];
    return -1;
  }

  /** Remembers the record of `name` on `h`. @param {Handle} h @param {number} name @param {number} lane @param {number} at */
  keep(h, name, lane, at) {
    if (h.sn === -2 || (h.sn === name && h.sl === lane) || h.sp < this.streams[h.sl].floor) {
      h.sn = name;
      h.sp = at;
      h.sl = lane;
      return;
    }
    let more = h.more;
    if (more === null) more = h.more = [];
    for (let k = 0; k < more.length; k += 3)
      if ((more[k] === name && more[k + 2] === lane) || more[k + 1] < this.streams[more[k + 2]].floor) {
        more[k] = name;
        more[k + 1] = at;
        more[k + 2] = lane;
        return;
      }
    more.push(name, at, lane);
  }

  /** @param {Stream} s @param {number} a @param {number} b */
  put2(s, a, b) {
    s.room(2);
    const n = s.n;
    const o = s.ops;
    o[n] = a;
    o[n + 1] = b;
    s.n = n + 2;
    s.k++;
    return s.base + n;
  }

  /** @param {Stream} s @param {number} a @param {number} b @param {number} c */
  put3(s, a, b, c) {
    s.room(3);
    const n = s.n;
    const o = s.ops;
    o[n] = a;
    o[n + 1] = b;
    o[n + 2] = c;
    s.n = n + 3;
    s.k++;
    return s.base + n;
  }

  /** @param {Stream} s @param {number} a @param {number} b @param {number} c @param {number} d @param {number} e */
  put5(s, a, b, c, d, e) {
    s.room(5);
    const n = s.n;
    const o = s.ops;
    o[n] = a;
    o[n + 1] = b;
    o[n + 2] = c;
    o[n + 3] = d;
    o[n + 4] = e;
    s.n = n + 5;
    s.k++;
    return s.base + n;
  }

  /** @param {Stream} s @param {number} a @param {number} b @param {number} c @param {number} d */
  put4(s, a, b, c, d) {
    s.room(4);
    const n = s.n;
    const o = s.ops;
    o[n] = a;
    o[n + 1] = b;
    o[n + 2] = c;
    o[n + 3] = d;
    s.n = n + 4;
    s.k++;
    return s.base + n;
  }

  /** @param {Handle} h @param {number} at @param {Stream} s */
  created(h, at, s) {
    if (s === this.lo) h.low = at;
    else h.high = at;
    this.registry.register(h, h.id);
    return h;
  }

  // -------------------------------------------------------------------------
  // Host

  /** @param {string} tag @param {any} props @param {Handle | null} [parent] */
  element(tag, props, parent = null) {
    const s = this.pick();
    const up = this.up(s, parent);
    const h = new Handle(this.alloc(), tag === 'Edit' ? LEAF : 0);
    const construct = this.construct;
    if (construct !== undefined && props != null) {
      /** @type {Record<string, any> | null} */
      let made = null;
      for (const name of construct) {
        const value = props[name];
        if (value !== undefined) (made ??= {})[name] = typeof value === 'function' ? value() : value;
      }
      if (made !== null) {
        const k = s.side.length;
        s.side.push(made, null);
        return this.created(h, this.put5(s, BUILD, h.id, this.name(tag), k, up), s);
      }
    }
    const lines = props != null && typeof props.lines === 'number' ? props.lines | 0 : -1;
    return this.created(h, this.put5(s, ELEMENT, h.id, this.name(tag), lines, up), s);
  }

  /**
   * The id of the element a new one goes into, for its record, or -1. An
   * urgent record that names it follows the deferred ones that touched it.
   * @param {Stream} s @param {Handle | null} parent
   */
  up(s, parent) {
    if (!(parent instanceof Handle)) return -1;
    if (s === this.hi) this.touch(parent);
    return parent.id;
  }

  /** @param {string} text */
  text(text) {
    const s = this.pick();
    const h = new Handle(this.alloc(), 0);
    return this.created(h, this.put3(s, TEXT, h.id, s.strs.push(text) - 1), s);
  }

  marker() {
    const s = this.pick();
    const h = new Handle(this.alloc(), 0);
    return this.created(h, this.put2(s, MARKER, h.id), s);
  }

  /**
   * A compiled template instance, cloned on the main thread: the plan's tree
   * goes once (urgent, ahead of any clone), each instance is one record, and
   * the handles of its held nodes take consecutive ids and mirror their
   * parents, so ren-core's parent and next calls stay answerable here.
   * With construct props, the instance's values of them go along.
   * @param {import('./core.js').Plan} plan @param {any[]} [values] @param {Handle | null} [parent]
   */
  clone(plan, values, parent = null) {
    const s = this.pick();
    const into = this.up(s, parent);
    let id = this.plans.get(plan);
    if (id === undefined) {
      id = this.plans.size;
      this.plans.set(plan, id);
      const hi = this.hi;
      const k = hi.side.length;
      hi.side.push(plan.tree, null);
      this.put3(hi, PLAN, id, k);
    }
    const refs = plan.refs;
    const up = plan.up;
    const n = refs.length;
    const first = this.nextId;
    this.nextId += n;
    const wanted = this.construct === undefined || values === undefined ? null : this.wanted(plan);
    let at;
    if (wanted !== null && wanted.length > 0 && values !== undefined) {
      /** @type {any[]} */
      const sparse = [];
      for (const v of wanted) sparse[v] = typeof values[v] === 'function' ? values[v]() : values[v];
      const k = s.side.length;
      s.side.push(sparse, null);
      at = this.put5(s, CLONE_WITH, id, first, k, into);
    } else at = this.put4(s, CLONE, id, first, into);
    /** @type {Handle[]} */
    const out = new Array(n);
    for (let r = 0; r < n; r++) {
      const h = this.created(new Handle(first + r, 0), at, s);
      out[r] = h;
      if (r > 0) {
        const parent = out[up[r]];
        h.parent = parent;
        h.prev = parent.last;
        if (parent.last === null) parent.first = h;
        else parent.last.next = h;
        parent.last = h;
      }
    }
    return out;
  }

  /** The value indexes of a plan's construct props. @param {import('./core.js').Plan} plan @returns {number[]} */
  wanted(plan) {
    let out = this.constructs.get(plan);
    if (out !== undefined) return out;
    const construct = /** @type {ReadonlySet<string>} */ (this.construct);
    /** @type {number[]} */
    const found = [];
    /** @param {any[]} node */
    const walk = node => {
      const dynamic = node[3];
      if (dynamic != null) for (let k = 0; k < dynamic.length; k += 2) if (construct.has(dynamic[k])) found.push(dynamic[k + 1]);
      for (const child of node[2]) if (Array.isArray(child)) walk(child);
    };
    walk(plan.tree);
    this.constructs.set(plan, found);
    return found;
  }

  /** @param {Handle} node @param {string} text */
  content(node, text) {
    const s = this.pick();
    const lane = s === this.lo ? 1 : 0;
    if (lane === 0) this.touch(node);
    if (this.coalesce) {
      const at = this.slot(node, CONTENT_NAME, lane);
      if (at >= 0) {
        s.strs[s.ops[at - s.base + 2]] = text;
        this.counters.coalesced++;
        return;
      }
    }
    const at = this.put3(s, CONTENT, node.id, s.strs.push(text) - 1);
    if (this.coalesce) this.keep(node, CONTENT_NAME, lane, at);
    if (lane === 1) node.low = at;
    else node.high = at;
  }

  /** @param {Handle} node @param {string} name @param {any} value @param {any} previous */
  set(node, name, value, previous) {
    const s = this.pick();
    const lane = s === this.lo ? 1 : 0;
    if (lane === 0) {
      this.touch(node);
      if (value instanceof Handle) this.touch(value);
    }
    const nm = this.name(name);
    let op;
    switch (typeof value) {
      case 'string':
        op = SET_STR;
        break;
      case 'number':
        op = (value | 0) === value ? SET_INT : SET_NUM;
        break;
      case 'boolean':
        op = value ? SET_TRUE : SET_FALSE;
        break;
      case 'undefined':
        op = SET_UNDEF;
        break;
      case 'object':
        op = value === null ? SET_NULL : value instanceof Handle ? SET_NODE : SET_OBJ;
        break;
      default:
        throw new TypeError(`REN worker: the value of ${name} cannot cross to the main thread (${typeof value})`);
    }
    if (this.coalesce) {
      const at = this.slot(node, nm, lane);
      if (at >= 0) {
        const o = s.ops;
        const i = at - s.base;
        const was = o[i];
        // A record of the same kind reuses its table entry; OBJ keeps the
        // previous value the main thread still has, so kinds never mix with it.
        if ((was === SET_OBJ) === (op === SET_OBJ)) {
          const old = o[i + 3];
          o[i] = op;
          if (op === SET_STR) {
            if (was === SET_STR) s.strs[old] = value;
            else o[i + 3] = s.strs.push(value) - 1;
          } else if (op === SET_NUM) {
            if (was === SET_NUM) s.nums[old] = value;
            else o[i + 3] = s.num(value);
          } else if (op === SET_INT) o[i + 3] = value;
          else if (op === SET_NODE) o[i + 3] = value.id;
          else if (op === SET_OBJ) s.side[old] = value;
          else o[i + 3] = 0;
          this.counters.coalesced++;
          if (lane === 1 && op === SET_NODE) value.low = at;
          return;
        }
      }
    }
    let operand = 0;
    if (op === SET_STR) operand = s.strs.push(value) - 1;
    else if (op === SET_INT) operand = value;
    else if (op === SET_NUM) operand = s.num(value);
    else if (op === SET_NODE) operand = value.id;
    else if (op === SET_OBJ) {
      operand = s.side.length;
      s.side.push(value, previous);
    }
    const at = this.put4(s, op, node.id, nm, operand);
    if (this.coalesce) this.keep(node, nm, lane, at);
    if (lane === 1) {
      node.low = at;
      if (op === SET_NODE) value.low = at;
    } else {
      node.high = at;
      if (op === SET_NODE) value.high = at;
    }
  }

  /** @param {Handle} node @param {string} name @param {(event: any) => void} handler */
  listen(node, name, handler) {
    const s = this.pick();
    const lane = s === this.lo ? 1 : 0;
    if (lane === 0) this.touch(node);
    const id = this.spareIds.length > 0 ? /** @type {number} */ (this.spareIds.pop()) : this.nextListener++;
    const gen = ((this.gens[id] ?? 0) + 1) | 0;
    this.gens[id] = gen;
    this.handlers[id] = handler;
    this.types[id] = name;
    s.room(5);
    const n = s.n;
    const o = s.ops;
    o[n] = LISTEN;
    o[n + 1] = node.id;
    o[n + 2] = id;
    o[n + 3] = gen;
    o[n + 4] = this.name(name);
    s.n = n + 5;
    s.k++;
    if (lane === 1) node.low = s.base + n;
    else node.high = s.base + n;
    return () => {
      if (this.handlers[id] !== handler || this.gens[id] !== gen) return;
      this.handlers[id] = null;
      this.spareIds.push(id);
      const t = this.pick();
      if (t === this.hi) this.touch(node);
      const at = this.put2(t, UNLISTEN, id);
      if (t === this.lo) node.low = at;
      else node.high = at;
    };
  }

  /** @param {Handle} parent @param {Handle} child @param {Handle | null} before */
  insert(parent, child, before) {
    if ((parent.flags & LEAF) !== 0 || child === before) return;
    const s = this.pick();
    if (s === this.hi) {
      if (this.lo.n > 0) this.promote();
      this.touch(parent);
      this.touch(child);
      if (before !== null) this.touch(before);
    }
    // Mirror: the scene's link (ren-canv's src/scene.js), which the DOM matches for ren-core's calls.
    if (child.parent !== null) unlink(child);
    if (before !== null && before.parent !== parent) before = null;
    child.parent = parent;
    if (before === null) {
      child.prev = parent.last;
      child.next = null;
      if (parent.last === null) parent.first = child;
      else parent.last.next = child;
      parent.last = child;
    } else {
      child.prev = before.prev;
      child.next = before;
      if (before.prev === null) parent.first = child;
      else before.prev.next = child;
      before.prev = child;
    }
    const at = this.put4(s, INSERT, parent.id, child.id, before === null ? -1 : before.id);
    if (s === this.lo) {
      parent.low = at;
      child.low = at;
      if (before !== null) before.low = at;
    } else {
      parent.high = at;
      child.high = at;
      if (before !== null) before.high = at;
    }
  }

  /** @param {Handle} parent @param {Handle} child */
  remove(parent, child) {
    if (child.parent !== parent) return;
    const s = this.pick();
    if (s === this.hi) {
      if (this.lo.n > 0) this.promote();
      this.touch(parent);
      this.touch(child);
    }
    unlink(child);
    const at = this.put3(s, REMOVE, parent.id, child.id);
    if (s === this.lo) {
      parent.low = at;
      child.low = at;
    } else {
      parent.high = at;
      child.high = at;
    }
  }

  /** @param {Handle} node */
  parent(node) {
    return node.parent;
  }

  /** @param {Handle} node */
  next(node) {
    return node.next;
  }

  /** @param {any} value */
  owns(value) {
    return value instanceof Handle;
  }

  layer() {
    return this.portal;
  }

  /** Publishes after each flush round (ren-core Present/Commit). */
  present() {
    this.flush();
  }

  // -------------------------------------------------------------------------
  // Publishing

  /**
   * Posts what is pending, as backpressure allows: with nothing in flight; an
   * answer to input at once, overtaking a held message it does not depend on,
   * or behind the messages in flight (the main thread applies them first).
   */
  flush() {
    if (this.closed) {
      this.answer();
      return;
    }
    if (!this.backpressure || this.flights.length === 0) {
      this.post();
      return;
    }
    if (this.hi.n === HEADER && this.lo.n === 0) {
      this.answer();
      return;
    }
    if (this.input) {
      const held = this.held;
      if (held !== null && this.flights.length === 1 && !this.dependent && !this.promoted) {
        this.overtake = true;
        this.post();
        this.overtake = false;
        this.counters.overtaken++;
        return;
      }
      // A dependent answer goes at once too, behind what is in flight: the
      // main thread applies messages in order and a held one before an
      // answer, so the answer never waits for an acknowledgement queued
      // behind this thread's long tasks (a request to hurry did, at saturation).
      if (held !== null) this.counters.hurried++;
      this.post();
      return;
    }
    this.counters.merged++;
    this.answer();
  }

  /** How many deferred records the next message carries. */
  allowance() {
    if (!this.lanes || !(this.budget < Infinity)) return Infinity;
    // An answer to input goes alone, unless the backlog has waited too long.
    if (this.input && performance.now() - this.lowAt < STARVE) return 0;
    const cap = Math.floor((this.budget - this.perPresent) / this.perRecord);
    return Math.max(MINIMUM, Math.min(cap, this.limit) - this.hi.k);
  }

  /** Posts one message with the urgent operations and deferred ones up to the budget. */
  post() {
    const hi = this.hi;
    const split = hi.n;
    const loFrom = this.lo.floor;
    if (this.lo.n > 0 && !this.overtake) {
      const before = this.lo.n;
      this.move(this.allowance());
      if (this.lo.n !== before) this.lowAt = performance.now();
    }
    // move() may have swapped the low stream.
    const lo = this.lo;
    const loTo = lo.floor;
    const flight = this.spareFlights.pop() ?? new Flight();
    flight.releasing.length = 0;
    if (lo.n === 0 && this.dying.length > 0 && !this.overtake) {
      // Nothing unsent refers to these ids any more; they are reused once
      // this message is applied.
      const dying = this.dying;
      for (let i = 0; i < dying.length; i++) {
        this.put2(hi, FREE, dying[i]);
        flight.releasing.push(dying[i]);
      }
      dying.length = 0;
    }
    if (hi.n === HEADER) {
      this.spareFlights.push(flight);
      this.answer();
      return;
    }
    const urgent = this.input;
    const o = hi.ops;
    o[0] = this.acked;
    o[1] = (urgent ? URGENT : 0) | (lo.n > 0 ? MORE : 0) | (this.overtake ? OVERTAKE : 0);
    o[2] = split;
    o[3] = this.number;
    flight.number = this.number++;
    flight.urgent = urgent;
    flight.hiFrom = hi.floor;
    flight.hiTo = hi.base + hi.n;
    flight.loFrom = loFrom;
    flight.loTo = loTo;
    // Capacities, read before the transfer detaches the buffers.
    const capacity = o.length;
    const numbers = hi.nums.length;
    const c = this.counters;
    const start = performance.now();
    // Into the shared mailbox when the main thread offered one, the slot is
    // free and the message has no side values: the main thread can apply it
    // in its next frame; the bell covers the rest. The buffers stay here.
    const box = this.box;
    const boxed = box !== null && hi.side.length === 0 && box.write(o[3], o, hi.n, hi.nums, hi.m, hi.strs, this.fresh);
    if (boxed) {
      this.bell[1] = o[3];
      this.port.postMessage(this.bell, NOTHING);
      c.boxed++;
    } else {
      const out = this.out;
      const transfer = this.transfer;
      transfer.length = 0;
      out[1] = o.buffer;
      out[2] = hi.n;
      transfer.push(o.buffer);
      if (hi.m > 0) {
        out[3] = hi.nums.buffer;
        transfer.push(hi.nums.buffer);
      } else out[3] = null;
      out[4] = hi.m;
      out[5] = hi.strs.length > 0 ? hi.strs : null;
      out[6] = this.fresh.length > 0 ? this.fresh : null;
      out[7] = hi.side.length > 0 ? hi.side : null;
      // postMessage serializes at once, so every array here is reused.
      this.port.postMessage(out, transfer);
      out[1] = out[3] = out[5] = out[6] = out[7] = null;
    }
    c.post += performance.now() - start;
    c.words += hi.n;
    c.numbers += hi.m;
    c.messages++;
    c.records += hi.k;
    c.backlog = lo.k;
    hi.base += hi.n - HEADER;
    hi.floor = hi.base + HEADER;
    hi.n = HEADER;
    hi.k = 0;
    if (!boxed) {
      hi.ops = take32(this.pool32, capacity);
      if (hi.m > 0) hi.nums = take64(this.pool64, numbers);
    }
    hi.m = 0;
    hi.strs.length = 0;
    hi.side.length = 0;
    this.fresh.length = 0;
    this.input = false;
    this.dependent = false;
    this.promoted = false;
    this.flights.push(flight);
    // The main thread holds a message that does not answer input for its frame.
    if (!urgent && this.held === null) this.held = flight;
    this.answer();
  }

  /**
   * Answers each SYNC once what was queued before it is published: the
   * urgent stream is empty and the deferred stream's floor has passed the
   * end it had at the SYNC. Deferred work queued after it (a steady stream
   * of it) does not hold the answer back.
   */
  answer() {
    const syncs = this.syncs;
    if (syncs.length === 0 || this.hi.n > HEADER) return;
    const floor = this.lo.floor;
    /** @type {number[] | null} */
    let ready = null;
    let kept = 0;
    for (let i = 0; i < syncs.length; i += 2) {
      if (syncs[i + 1] <= floor) (ready ??= []).push(syncs[i]);
      else {
        syncs[kept++] = syncs[i];
        syncs[kept++] = syncs[i + 1];
      }
    }
    syncs.length = kept;
    if (ready !== null) this.port.postMessage([SYNCED, ready], NOTHING);
  }

  // -------------------------------------------------------------------------
  // Receiving

  /** @param {any} data */
  receive(data) {
    switch (data[0]) {
      case EVENT:
        this.events(data);
        break;
      case RETURN:
        this.returned(data);
        break;
      case SYNC:
        // The token, and the end of the deferred stream it waits for.
        this.syncs.push(data[1], this.lo.base + this.lo.n);
        this.flush();
        break;
      case POST:
        this.posted(data);
        break;
      case ROOT:
        this.rooted(data);
        break;
      case STORE:
        this.seen++;
        this.stored(data[1]);
        break;
      case PROPS:
        if (!this.root.closed) $batch(this.root, () => $write(this.props, data[1]));
        break;
      case MAILBOX:
        this.box = new Mailbox(data[1]);
        break;
      case VIEWPORT:
        this.viewed(data[1], data[2], data[3]);
        break;
      case REGION:
        this.region(data);
        break;
    }
  }

  /**
   * The Host's viewport, as the main thread's host reports it: the last
   * report now, then each change. @param {(width: number, height: number, flags: number) => void} report
   */
  viewport(report) {
    this.viewers.add(report);
    const v = this.view;
    report(v[0], v[1], v[2]);
    return () => void this.viewers.delete(report);
  }

  /** The main thread's viewport changed. @param {number} width @param {number} height @param {number} flags */
  viewed(width, height, flags) {
    const v = this.view;
    v[0] = width;
    v[1] = height;
    v[2] = flags;
    if (this.closed || this.root.closed) return;
    for (const report of [...this.viewers]) report(width, height, flags);
    // Regions the main thread reported none for read the root's.
    for (const region of [...this.regions.values()]) if (region.own === null) region.report(width, height, flags);
    this.flush();
  }

  /**
   * The viewport source of the region `node` is in, as the main thread's
   * host gives it (`viewportOf`): followed there while it has readers, the
   * root's until the main thread reports one. Null when that host gives none.
   * @param {any} node
   * @returns {Region | null}
   */
  viewportOf(node) {
    if (!this.regional || !(node instanceof Handle)) return null;
    let region = this.regionOf.get(node);
    if (region === undefined) {
      region = new Region(this, node);
      this.regionOf.set(node, region);
    }
    return region;
  }

  /** Follows a region's viewport on the main thread; returns its follower number. @param {Region} region */
  follow(region) {
    const id = this.nextRegion++;
    this.regions.set(id, region);
    const node = region.node;
    const s = this.pick();
    if (s === this.hi) this.touch(node);
    const at = this.put3(s, VIEW, node.id, id);
    if (s === this.lo) node.low = at;
    else node.high = at;
    return id;
  }

  /** Stops following a region's viewport. @param {Region} region @param {number} id */
  unfollow(region, id) {
    this.regions.delete(id);
    const node = region.node;
    const s = this.pick();
    if (s === this.hi) this.touch(node);
    const at = this.put2(s, UNVIEW, id);
    if (s === this.lo) node.low = at;
    else node.high = at;
  }

  /** A region's viewport, as the main thread reports it. @param {any[]} data */
  region(data) {
    const region = this.regions.get(data[1]);
    if (region === undefined || this.closed || this.root.closed) return;
    region.own = [data[2], data[3], data[4]];
    region.report(data[2], data[3], data[4]);
    this.flush();
  }

  /** The main thread's root: its id must be this root's; its storage fills the mirror. @param {any[]} data */
  rooted(data) {
    // A session disposed before the main thread connected builds nothing.
    if (this.closed || this.root.closed) return;
    // The main thread hears this side's wire version whatever its own; a different one builds nothing.
    this.port.postMessage([VERSION, PROTOCOL], NOTHING);
    if (data[5] !== PROTOCOL) {
      this.start = null;
      throw mismatch('REN worker', 'main thread', data[5]);
    }
    if (data[1] !== null && data[1] !== this.root.id) throw new Error(`REN: the main thread expects root "${data[1]}", this worker serves "${this.root.id}"`);
    if (data[2] != null) this.stored(data[2]);
    // A main thread with no storage (`storage: null`): the view reads none, as in direct mode.
    else for (let layer = this.root.ctx; layer !== null; layer = layer.parent) if (layer.key === Storage) layer.value = null;
    if (data[3] !== undefined && !this.root.closed) $batch(this.root, () => $write(this.props, data[3]));
    if (data[4] != null) this.view = data[4];
    this.regional = data[6] === true;
    const start = this.start;
    this.start = null;
    if (start !== null) start();
  }

  /** Storage changes from the main thread: `[key, value | null, …]`, key null for a clear. @param {(string | null)[] | null} pairs */
  stored(pairs) {
    if (pairs === null || this.root.closed) return;
    const shelf = this.shelf;
    $batch(this.root, () => {
      for (let i = 0; i < pairs.length; i += 2) {
        const key = pairs[i];
        if (key === null) for (const own of shelf.own()) shelf.backing.removeItem(shelf.prefix + own);
        shelf.receive(key, pairs[i + 1], true);
      }
    });
  }

  /** A burst of events: one rrx-core `$batch`, so one flush and at most one message. @param {any[]} data */
  events(data) {
    if (this.closed || this.root.closed) return;
    // Held to the records the message holds: a bad count (Infinity, a string) reads none past its end.
    const raw = data[1];
    const count = Number.isInteger(raw) && raw > 0 ? Math.min(raw, Math.floor((data.length - 2) / RECORD)) : 0;
    const c = this.counters;
    c.bursts++;
    c.events += count;
    this.input = true;
    /** @type {any} */
    let failure = null;
    $batch(this.root, () => {
      for (let r = 0, i = 2; r < count; r++, i += RECORD) {
        this.acked = data[i];
        const flags = data[i + 3];
        // A dispatch's records come in a row: another dispatch's record ends a stop, so a number the counter gives again (it wraps) is heard.
        const dispatch = flags >>> 9;
        if (dispatch !== 0 && dispatch !== this.halted) this.halted = 0;
        const id = data[i + 1];
        const handler = this.handlers[id];
        if (handler == null || this.gens[id] !== data[i + 2]) continue;
        // A record of a dispatch whose propagation a handler stopped (in this burst or an earlier one).
        if (dispatch !== 0 && dispatch === this.halted) continue;
        const input = new Input(this.types[id], flags, data[i + 4], data[i + 5], data[i + 6], data[i + 7], data[i + 8], data[i + 9], data[i + 10]);
        try {
          handler(input);
        } catch (error) {
          if (failure === null) failure = { error };
        }
        if (dispatch !== 0 && stopped.has(input)) this.halted = dispatch;
      }
    });
    this.flush();
    if (failure !== null) throw failure.error;
  }

  /** The main thread applied a message: its buffers come back with its cost. @param {any[]} data */
  returned(data) {
    const ops = data[1];
    if (ops != null && ops.byteLength >= this.hi.ops.length * 4 && this.pool32.length < 4) this.pool32.push(ops);
    const nums = data[2];
    if (nums != null && nums.byteLength >= this.hi.nums.length * 8 && this.pool64.length < 4) this.pool64.push(nums);
    const ms = data[3];
    const present = data[4];
    const records = data[5];
    // Costs that are not numbers (a malformed answer) teach nothing: the budget math stays finite.
    if (records > 0 && ms >= 0 && Number.isFinite(ms / records)) this.perRecord = this.perRecord * 0.7 + Math.max(1e-5, ms / records) * 0.3;
    if (present >= 0 && Number.isFinite(present)) this.perPresent = this.perPresent * 0.7 + present * 0.3;
    // The record limit: halves on a late frame, grows by an eighth otherwise.
    if (data[7]) {
      this.counters.late++;
      const cap = Math.floor((this.budget - this.perPresent) / this.perRecord);
      this.limit = Math.max(MINIMUM, Math.min(this.limit, cap) >> 1);
    } else if (this.limit < 1 << 30) this.limit = Math.min(1 << 30, this.limit + Math.max(MINIMUM, this.limit >> 3));
    this.counters.limit = this.limit;
    const flights = this.flights;
    for (let i = 0; i < flights.length; i++) {
      const flight = flights[i];
      if (flight.number !== data[6]) continue;
      flights.splice(i, 1);
      if (this.held === flight) this.held = null;
      const ids = flight.releasing;
      for (let k = 0; k < ids.length; k++) this.free.push(ids[k]);
      ids.length = 0;
      this.spareFlights.push(flight);
      break;
    }
    if (!this.closed) this.flush();
  }

  /** Work posted by the main thread, run in its lane. @param {any[]} data */
  posted(data) {
    this.acked = data[1];
    const handler = this.message;
    if (handler === null || this.closed) return;
    const lane = data[2] === 0 ? 'urgent' : data[2] === 2 ? 'background' : 'normal';
    const R = this.root;
    if (lane === 'urgent') this.input = true;
    $batch(R, () => (lane === 'background' ? $defer(R, () => handler(data[3], lane)) : handler(data[3], lane)));
    this.flush();
  }
}

/** Unlinks a handle from its parent. @param {Handle} child */
function unlink(child) {
  const parent = /** @type {Handle} */ (child.parent);
  if (child.prev === null) parent.first = child.next;
  else child.prev.next = child.next;
  if (child.next === null) parent.last = child.prev;
  else child.next.prev = child.prev;
  child.parent = null;
  child.prev = null;
  child.next = null;
}

/**
 * Copies the record at `i` of `from` into `to`, moving its table operands.
 * Returns the record's size.
 * @param {Int32Array} o @param {number} i @param {Stream} from @param {Stream} to
 */
function copy(o, i, from, to) {
  const op = o[i];
  const size = SIZE[op];
  to.room(size);
  const d = to.ops;
  const n = to.n;
  for (let w = 0; w < size; w++) d[n + w] = o[i + w];
  if (op === TEXT || op === CONTENT) d[n + 2] = to.strs.push(from.strs[o[i + 2]]) - 1;
  else if (op === SET_STR) d[n + 3] = to.strs.push(from.strs[o[i + 3]]) - 1;
  else if (op === SET_NUM) d[n + 3] = to.num(from.nums[o[i + 3]]);
  else if (op === BUILD || op === CLONE_WITH) {
    const k = o[i + 3];
    d[n + 3] = to.side.length;
    to.side.push(from.side[k], null);
  } else if (op === SET_OBJ) {
    const k = o[i + 3];
    d[n + 3] = to.side.length;
    to.side.push(from.side[k], from.side[k + 1]);
  }
  to.n = n + size;
  to.k++;
  return size;
}

/** A returned Int32 buffer, or a new one. @param {ArrayBuffer[]} pool @param {number} length */
function take32(pool, length) {
  const buffer = pool.pop();
  return buffer !== undefined && buffer.byteLength >= length * 4 ? new Int32Array(buffer) : new Int32Array(length);
}

/** @param {ArrayBuffer[]} pool @param {number} length */
function take64(pool, length) {
  const buffer = pool.pop();
  return buffer !== undefined && buffer.byteLength >= length * 8 ? new Float64Array(buffer) : new Float64Array(length);
}

/** A running worker view. */
export class Session {
  /** @param {Remote} host @param {() => void} dispose @param {boolean} own */
  constructor(host, dispose, own) {
    this.host = host;
    this.release = dispose;
    this.own = own;
  }

  /** The worker-side counters. */
  get counters() {
    return this.host.counters;
  }

  /** Posts `data` to the main thread's `message` handler (not ordered with view messages). @param {any} data */
  post(data) {
    this.host.port.postMessage([APP, data], NOTHING);
  }

  /** Removes the view, publishes the removal at once, and stops handling events. */
  dispose() {
    const host = this.host;
    if (host.closed) return;
    // A view not built yet (the main thread has not connected) never builds.
    host.start = null;
    this.release();
    host.budget = Infinity;
    host.post();
    host.closed = true;
    if (this.own) $dispose(host.root);
  }

  /** Detaches from the port. */
  close() {
    this.dispose();
    this.host.stop();
  }
}

/**
 * Renders `view()` in this worker for a main thread that `connect`s a real
 * host to the other end of `options.port`.
 * @param {() => any} view
 * @param {Options} [options]
 * @returns {Session}
 */
export function serve(view, options = {}) {
  const port = options.port ?? /** @type {Port} */ (/** @type {unknown} */ (globalThis));
  const own = options.root == null;
  const root = options.root ?? $root(options.id ?? 'main');
  const host = new Remote(root, port, options);
  const nav = /** @type {any} */ (globalThis).navigator;
  const locks = options.locks !== undefined ? options.locks : (nav?.locks ?? null);
  base(
    root,
    [
      [Storage, host.shelf],
      [Locks, new Locker(root.id, locks)],
      [Runtime, { runtime: 'worker', renderer: 'remote', element: null, connection: null }],
      [Send, (/** @type {any} */ data) => host.port.postMessage([APP, data], NOTHING)],
    ],
    host.props,
  );
  // The view builds once the main thread connects: its first props are in place then.
  /** @type {(() => void) | null} */
  let dispose = null;
  host.start = () => {
    dispose = mount(host, view, host.container, { root, auto: options.auto, retire: options.retire, sweep: options.sweep, swept: options.swept });
  };
  return new Session(host, () => dispose?.(), own);
}
