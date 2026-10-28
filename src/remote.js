// ren-core/remote: the main-thread side of the worker mode.
//
// `connect(port, host, container, options)` applies the messages a worker's
// `serve` (ren-core/worker) posts to any real Host: `$dom(document)` or the
// Skia `Renderer`. It decodes the flat buffers of each message into plain host
// calls, transfers the buffers back (which acknowledges the message and
// reports its cost), and presents. Listeners on real nodes forward events as
// flat records; the events of one task go in one message.
//
// Scheduling on this thread (QoS):
// - A message that answers input applies at once. Messages apply in order, so
//   one waiting for its frame applies first, unless the worker marked the
//   answer as overtaking it (it touches nothing the waiting one touches).
// - Other messages apply at the next animation frame (`schedule: 'frame'`,
//   the default where requestAnimationFrame exists), so at most one message
//   applies per frame. The worker keeps one message in flight and merges new
//   work while this one waits, so a slow frame coalesces updates at the source.
// - A message applies whole. It is the published state of a flush; applying
//   part of one would show an intermediate state (a region cleared before its
//   content arrives, rows half moved), and the browser renders between tasks.
//   The frame budget is kept at the source instead: the worker sends deferred
//   operations in slices sized from the apply times this side reports.
// - Each acknowledgement reports the apply and present times and whether the
//   last frame was late (more than 1.5 frame periods since the previous
//   one), which the worker's budget follows.
//
// Shared mailbox (mailbox.js): with cross-origin isolation (or `mailbox:
// true`), this side offers the worker a SharedArrayBuffer slot. The worker
// writes a message there and rings a bell message; after forwarding input
// this side reads the slot in its next animation frames, so an answer the
// worker wrote in time applies in that frame, before the bell (a message
// task, which Chrome runs after the frame that follows an input) arrives.
// The bell applies it otherwise; messages with side values go by message.
//
// Edit echo: each event takes a sequence number, and every message carries
// the last number the worker had handled. A `value` update for a node the
// user has edited since is stale (the worker has not seen the newer edit yet)
// and is skipped; the worker answers the newer edit in a later message.

import { subscribe, NOTHING, PROTOCOL, mismatch } from './port.js';
import { plan, skeleton } from './core.js';
import { Mailbox, SIZE as BOX } from './mailbox.js';

/** @typedef {import('./port.js').Port} Port */
/** @typedef {import('./core.js').Host} Host */
/** @typedef {import('./worker.js').Lane} Lane */

// Opcodes: the table of worker.js.
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
/** Frames polled for an answer in the mailbox after forwarding input. */
const POLLS = 3;
/** A record's flags word: six flag bits, a wheel's deltaMode in two, a focus's focusVisible in one, and above them the dispatch number, below 2**30 (it wraps). */
const DISPATCHES = 2 ** 21 - 1;
/** The flag bits two wheels share to add up: the modifier keys and the deltaMode. */
const WHEELS = 15 | (3 << 6);
/** The words of one event record. */
const RECORD = 11;

const HEADER = 4;
const URGENT = 1;
const OVERTAKE = 4;

/** Events where only the latest matters: 1 keeps the last, 2 also sums the deltas (wheel). */
const SUPERSEDED = /** @type {Record<string, number>} */ ({
  pointermove: 1,
  mousemove: 1,
  touchmove: 1,
  dragover: 1,
  drag: 1,
  scroll: 1,
  scrolls: 1,
  move: 1,
  resize: 1,
  wheel: 2,
});

const now = () => performance.now();

/**
 * @typedef {object} Options
 * @property {'frame' | 'now'=} schedule When messages that do not answer input apply: at the next animation frame, or on arrival. 'frame' where requestAnimationFrame exists.
 * @property {boolean=} coalesce Merge a burst's superseded dispatches (pointer motion, scroll, resize, wheel): one reaching the same listeners as the dispatch queued right before it replaces it, the latest wins, and wheels with the same modifier keys, button and deltaMode add up their deltas (true).
 * @property {((info: Applied) => void)=} applied Called after each message applies and presents.
 * @property {((data: any) => void)=} message Receives `Session.post` data.
 * @property {((error: any) => void)=} error Receives a failure of the host while applying; it is thrown by default.
 * @property {string=} id For an application root: its id, which the worker's root must have. The connection sends it first, with the storage.
 * @property {any=} props The parent's first props: the worker's root builds with them in place (structured-clone data).
 * @property {import('./context.js').Shelf | null=} storage For an application root: its storage, mirrored in the worker. Writes cross in one message per task, both ways, with no reply.
 * @property {(boolean | number)=} mailbox Share a mailbox (a SharedArrayBuffer slot of this many bytes, 4 MB for true) that answers apply from in the next animation frame; on by default where the page is cross-origin isolated.
 */

/** What the last applied message held and cost. */
export class Applied {
  constructor() {
    /** Records applied. */
    this.records = 0;
    /** Bytes received: 4 per word, 8 per number, 2 per string character; side values uncounted. */
    this.bytes = 0;
    /** Milliseconds decoding and calling the host. */
    this.ms = 0;
    /** Milliseconds in the host's present. */
    this.present = 0;
    /** True when the message answered input. */
    this.urgent = false;
    /** True when deferred operations remain in the worker. */
    this.more = false;
    /** The worker's last handled sequence number. */
    this.acked = 0;
    /** Records that came from the deferred lane. */
    this.deferred = 0;
    /** True when it applied inside an animation frame callback, so it shows in that frame. */
    this.framed = false;
  }
}

/** Main-thread counters. */
export class Totals {
  constructor() {
    this.messages = 0;
    this.records = 0;
    this.bytes = 0;
    /** Milliseconds applying (decode and host calls), presenting, and reading messages. */
    this.apply = 0;
    this.present = 0;
    this.read = 0;
    /** The longest apply plus present of one message. */
    this.max = 0;
    /** Events forwarded, and the messages that carried them. */
    this.events = 0;
    this.bursts = 0;
    /** Superseded events merged into a queued one. */
    this.merged = 0;
    /** Stale `value` echoes skipped. */
    this.stale = 0;
    /** Milliseconds spent capturing and posting events. */
    this.forward = 0;
    /** Messages applied from the shared mailbox, and how many of them inside a frame poll. */
    this.boxed = 0;
    this.polled = 0;
  }

  /** All main-thread time this connection used, in milliseconds. */
  get busy() {
    return this.apply + this.present + this.read + this.forward;
  }
}

/** A worker view applied to a real host. */
export class Connection {
  /** @param {Port} port @param {Host} host @param {any} container @param {Options} options */
  constructor(port, host, container, options) {
    this.port = port;
    this.host = host;
    /** Real nodes by id. @type {any[]} */
    this.nodes = [container, host.layer()];
    // The container and the portal layer are the host's delegation roots.
    /** @type {(() => void)[]} */
    this.detach = [];
    if (host.attach !== undefined) {
      this.detach.push(host.attach(container));
      if (this.nodes[1] !== container) this.detach.push(host.attach(this.nodes[1]));
    }
    /** The persistent name table. @type {string[]} */
    this.names = [];
    /** Compiled template plans by the worker's plan id. @type {any[]} */
    this.plans = [];
    /** The index of 'value' in `names`. */
    this.value = -1;
    /** Listener removals by listener id. @type {((() => void) | null)[]} */
    this.removers = [];
    /** The sequence number of the last edit sent for a node id. @type {number[]} */
    this.edits = [];
    /** Superseding kind by listener id (0: none). @type {number[]} */
    this.kinds = [];
    /**
     * The queued burst's last two groups of records (a group: one main-thread
     * dispatch's records in a row, or one record of none): where each starts in
     * `out` (-1 for none), its kind (0 when not coalescable) and whether it
     * continues a dispatch already posted. The last one replaces the one
     * before it when it supersedes it.
     */
    this.group = -1;
    this.groupKind = 0;
    this.groupGoes = false;
    this.groupDispatch = 0;
    this.previous = -1;
    this.previousKind = 0;
    this.previousGoes = false;
    /** The dispatch number of the last group posted: its later records continue it. */
    this.posted = 0;
    /** The dispatch number of each event object forwarded (one per main-thread dispatch, the ancestors' and `$keys`' records too), and the last one given. @type {WeakMap<object, number>} */
    this.dispatches = new WeakMap();
    this.dispatch = 0;
    /** The last sequence number sent, and the last the worker had handled. */
    this.seq = 0;
    this.acked = 0;
    this.schedule = options.schedule ?? (typeof requestAnimationFrame === 'function' ? 'frame' : 'now');
    this.coalesce = options.coalesce !== false;
    this.applied = options.applied ?? null;
    this.message = options.message ?? null;
    this.error = options.error ?? null;
    /** Messages waiting for their frame. @type {any[][]} */
    this.pending = [];
    this.frame = 0;
    this.sending = false;
    /** The event message being gathered. @type {any[]} */
    this.out = [EVENT, 0];
    /** @type {any[]} */
    this.ack = [RETURN, null, null, 0, 0, 0, 0, false];
    /** The previous animation frame, and whether the last one came late. */
    this.lastFrame = 0;
    this.late = false;
    this.framing = false;
    /** @type {ArrayBuffer[]} */
    this.transfer = [];
    this.hint = { lines: 0 };
    this.info = new Applied();
    this.totals = new Totals();
    /** @type {Map<number, () => void>} */
    this.syncs = new Map();
    this.token = 0;
    this.closed = false;
    this.started = 0;
    const g = /** @type {any} */ (globalThis);
    const shared = options.mailbox ?? (g.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function');
    /** The shared mailbox, the number of its message taken last, and the frames left to poll. @type {Mailbox | null} */
    this.box = shared === false ? null : Mailbox.make(typeof shared === 'number' ? shared : BOX);
    this.boxed = -1;
    this.polls = 0;
    this.tick = () => {
      this.frame = 0;
      const t = now();
      const gap = t - this.lastFrame;
      this.lastFrame = t;
      if (gap > 25 && gap < 250) this.late = true;
      this.framing = true;
      try {
        this.drain();
        if (this.box !== null) this.poll();
      } finally {
        this.framing = false;
      }
    };
    this.send = () => this.flushEvents();
    this.stop = subscribe(
      port,
      data => this.receive(data),
      () => {
        this.started = now();
      },
    );
    /** The application root's storage, mirrored in the worker. */
    this.storage = options.storage ?? null;
    /** Storage changes of this task for the worker. @type {(string | null)[]} */
    this.saving = [];
    /** STORE messages posted: a SAVED that saw fewer crossed one. */
    this.stores = 0;
    const storage = this.storage;
    if (options.id !== undefined && storage !== null)
      storage.sink = (key, value) => {
        this.saving.push(key, value);
        if (this.saving.length === 2) queueMicrotask(() => this.save());
      };
    /** The host's viewport, followed for the worker's `$viewport`: [width, height, flags], null while the host reported none. @type {number[] | null} */
    this.view = null;
    this.rooted = false;
    /** Stops following the host's viewport. @type {(() => void) | null} */
    this.unview =
      host.viewport?.((width, height, flags) => {
        this.view = [width, height, flags];
        if (this.rooted && !this.closed) this.port.postMessage([VIEWPORT, width, height, flags], NOTHING);
      }) ?? null;
    // The worker's root builds on this first message, with its id checked,
    // its storage mirrored, its first props and its viewport in place.
    /** The region viewports the worker follows (VIEW), by follower: their stops. @type {Map<number, () => void>} */
    this.regions = new Map();
    port.postMessage([ROOT, options.id ?? null, storage === null ? null : storage.entries(), options.props, this.view, PROTOCOL, host.viewportOf !== undefined], NOTHING);
    this.rooted = true;
    if (this.box !== null) port.postMessage([MAILBOX, this.box.buffer], NOTHING);
  }

  /** A frame: applies the mailbox's message, or polls again for a few frames after input. */
  poll() {
    const box = /** @type {Mailbox} */ (this.box);
    const number = box.waiting();
    if (number >= 0 && number !== this.boxed) {
      this.polls = 0;
      this.totals.polled++;
      this.take(number);
    } else if (this.polls > 0) {
      this.polls--;
      // timer: fallback, a write to the shared mailbox has no event: its next POLLS frames look.
      if (this.frame === 0) this.frame = requestAnimationFrame(this.tick);
    }
  }

  /** Takes the mailbox's message `number` (once): applied now, or at its frame as the message path would. @param {number} number */
  take(number) {
    const box = this.box;
    if (box === null || number === this.boxed || box.waiting() !== number) return;
    this.boxed = number;
    this.totals.boxed++;
    // Reading starts now (the message path stamps its arrival).
    this.started = now();
    this.receive(box.read(BATCH));
  }

  /** Posts this task's storage changes to the worker in one message. */
  save() {
    const pairs = this.saving;
    if (pairs.length === 0 || this.closed) return;
    this.saving = [];
    this.stores++;
    this.port.postMessage([STORE, pairs], NOTHING);
  }

  /** Sends the parent's props to the worker's root (`$lookup(Props)`); structured-clone data. @param {any} value */
  props(value) {
    if (!this.closed) this.port.postMessage([PROPS, value], NOTHING);
  }

  // -------------------------------------------------------------------------
  // Receiving

  /** @param {any} data */
  receive(data) {
    if (this.closed) return;
    const kind = data[0];
    if (kind === BATCH) {
      if (!wellFormed(data)) return this.refuse(data);
      // Names extend the table in arrival order: an overtaking message may use
      // names that a waiting one brought.
      const fresh = data[6];
      if (fresh !== null) {
        const names = this.names;
        for (let i = 0; i < fresh.length; i++) {
          if (fresh[i] === 'value') this.value = names.length;
          names.push(fresh[i]);
        }
      }
      const flags = data[1] instanceof Int32Array ? data[1][1] : new Int32Array(data[1], 4, 1)[0];
      if ((flags & URGENT) !== 0 || this.schedule === 'now') {
        // A held message that throws still lets this one apply; its failure follows.
        const failure = (flags & OVERTAKE) === 0 ? this.applyHeld() : null;
        this.totals.read += now() - this.started;
        this.apply(data);
        if (failure !== null) throw failure.error;
      } else {
        this.totals.read += now() - this.started;
        this.pending.push(data);
        // timer: feature, a message is applied at its frame.
        if (this.frame === 0) this.frame = requestAnimationFrame(this.tick);
      }
    } else if (kind === SYNCED) {
      // A held message that throws still lets idle() settle; its failure follows.
      const failure = this.applyHeld();
      const tokens = data[1];
      for (let i = 0; i < tokens.length; i++) {
        const resolve = this.syncs.get(tokens[i]);
        this.syncs.delete(tokens[i]);
        if (resolve) resolve();
      }
      if (failure !== null) throw failure.error;
    } else if (kind === BELL) {
      this.take(data[1]);
    } else if (kind === VERSION) {
      if (data[1] === PROTOCOL) return;
      // A worker of another wire: nothing it sends can be read.
      this.close();
      const error = mismatch('REN remote', 'worker', data[1]);
      if (this.error !== null) this.error(error);
      else throw error;
    } else if (kind === APP) {
      if (this.message !== null) this.message(data[1]);
    } else if (kind === SAVED) {
      const storage = this.storage;
      if (storage === null) return;
      // This task's own writes go first: they precede the worker's here.
      this.save();
      const pairs = data[1];
      for (let i = 0; i < pairs.length; i += 2) {
        const key = pairs[i];
        if (key === null) for (const own of storage.own()) storage.backing.removeItem(storage.prefix + own);
        storage.receive(key, pairs[i + 1], true);
      }
      // The worker wrote before it saw some writes of this side, and applies
      // them after its own: it gets back what this side now holds for those
      // keys, so both end on the main thread's value. (No count: echo.)
      if (!(data[2] >= this.stores)) {
        /** @type {(string | null)[]} */
        const held = [];
        for (let i = 0; i < pairs.length; i += 2) {
          const key = pairs[i];
          held.push(key, key === null ? null : storage.backing.getItem(storage.prefix + key));
        }
        this.stores++;
        this.port.postMessage([STORE, held], NOTHING);
      }
    }
  }

  /**
   * Returns a malformed message's buffers at once (the worker waits for them:
   * without them it would stall for good), then throws.
   * @param {any[]} data
   */
  refuse(data) {
    // A mailbox message frees its slot and is acknowledged by the number it was taken as.
    const shared = data[1] instanceof Int32Array;
    if (shared && this.box !== null) this.box.free();
    const ops = data[1] instanceof ArrayBuffer ? data[1] : null;
    const nums = data[3] instanceof ArrayBuffer && data[3] !== ops ? data[3] : null;
    const number = shared ? this.boxed : ops !== null && ops.byteLength >= HEADER * 4 ? new Int32Array(ops, 0, HEADER)[3] : 0;
    /** @type {ArrayBuffer[]} */
    const transfer = [];
    if (ops !== null) transfer.push(ops);
    if (nums !== null) transfer.push(nums);
    this.port.postMessage([RETURN, ops, nums, 0, 0, 0, number, false], transfer);
    throw new Error('REN remote: bad message');
  }

  /** Applies every message waiting for its frame; throws the first failure after. */
  drain() {
    const failure = this.applyHeld();
    if (failure !== null) throw failure.error;
  }

  /**
   * Applies every message waiting for its frame, each whether one before it
   * threw (its buffers went back either way), and returns the first failure,
   * or null.
   * @returns {{ error: any } | null}
   */
  applyHeld() {
    const pending = this.pending;
    if (pending.length === 0) return null;
    if (this.frame !== 0) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    /** @type {{ error: any } | null} */
    let failure = null;
    for (let i = 0; i < pending.length; i++) {
      try {
        this.apply(pending[i]);
      } catch (error) {
        if (failure === null) failure = { error };
      }
    }
    pending.length = 0;
    return failure;
  }

  /** Applies one message, presents, and returns its buffers. @param {any[]} data */
  apply(data) {
    const start = now();
    // A mailbox message carries views over the shared slot; others, buffers.
    const shared = data[1] instanceof Int32Array;
    const opsBuffer = shared ? null : data[1];
    const n = data[2];
    const numsBuffer = shared ? null : data[3];
    const ops = shared ? data[1] : new Int32Array(opsBuffer, 0, n);
    const nums = shared ? (data[3] ?? EMPTY) : numsBuffer === null ? EMPTY : new Float64Array(numsBuffer, 0, data[4]);
    const strs = data[5] ?? NONE;
    const fresh = data[6];
    const side = data[7] ?? NONE;
    let bytes = n * 4 + data[4] * 8;
    if (fresh !== null) for (let i = 0; i < fresh.length; i++) bytes += fresh[i].length * 2;
    for (let i = 0; i < strs.length; i++) bytes += strs[i].length * 2;
    const acked = ops[0];
    const flags = ops[1];
    // Where the deferred records start, held to the records (a malformed one would read the header).
    const split = Math.min(Math.max(ops[2], HEADER), n);
    if (acked > this.acked) this.acked = acked;
    let records = 0;
    let deferred = 0;
    /** @type {any} */
    let failure = null;
    try {
      records = this.decode(ops, n, nums, strs, side, acked);
      deferred = split < n ? this.count(ops, split, n) : 0;
    } catch (error) {
      failure = { error };
    }
    const middle = now();
    let presented = 0;
    if (failure === null && this.host.present) {
      try {
        this.host.present();
      } catch (error) {
        failure = { error };
      }
      presented = now() - middle;
    }
    const applied = middle - start;
    // The buffers go back at once (or the slot is freed): this acknowledges the message.
    const ack = this.ack;
    const transfer = this.transfer;
    transfer.length = 0;
    const number = ops[3];
    if (shared) /** @type {Mailbox} */ (this.box).free();
    ack[1] = opsBuffer;
    if (opsBuffer !== null) transfer.push(opsBuffer);
    ack[2] = numsBuffer;
    if (numsBuffer !== null) transfer.push(numsBuffer);
    ack[3] = applied;
    ack[4] = presented;
    ack[5] = records;
    ack[6] = number;
    ack[7] = this.late;
    this.late = false;
    this.port.postMessage(ack, transfer);
    ack[1] = ack[2] = null;
    const t = this.totals;
    t.messages++;
    t.records += records;
    t.bytes += bytes;
    t.apply += applied;
    t.present += presented;
    if (applied + presented > t.max) t.max = applied + presented;
    const info = this.info;
    info.records = records;
    info.bytes = bytes;
    info.ms = applied;
    info.present = presented;
    info.urgent = (flags & URGENT) !== 0;
    info.more = (flags & 2) !== 0;
    info.acked = acked;
    info.deferred = deferred;
    info.framed = this.framing;
    if (failure !== null) {
      if (this.error !== null) this.error(failure.error);
      else throw failure.error;
    }
    if (this.applied !== null) this.applied(info);
  }

  /** Records between two offsets. @param {Int32Array} ops @param {number} from @param {number} to */
  count(ops, from, to) {
    let records = 0;
    for (let i = from; i < to; records++) {
      const size = SIZE[ops[i]];
      // A split that lands on no record's opcode would loop here (a size of 0) or read garbage.
      if (!(size > 0)) throw new Error('REN remote: bad split');
      i += size;
    }
    return records;
  }

  /**
   * Calls the host for each record; returns how many.
   * @param {Int32Array} ops @param {number} n @param {Float64Array} nums @param {readonly string[]} strs @param {readonly any[]} side @param {number} acked
   */
  decode(ops, n, nums, strs, side, acked) {
    const host = this.host;
    const nodes = this.nodes;
    const names = this.names;
    const edits = this.edits;
    const valueName = this.value;
    let records = 0;
    let i = HEADER;
    while (i < n) {
      const op = ops[i];
      records++;
      if (op >= SET_UNDEF && op <= SET_OBJ) {
        const id = ops[i + 1];
        const name = ops[i + 2];
        const operand = ops[i + 3];
        i += 4;
        if (name === valueName && edits[id] > acked) {
          this.totals.stale++;
          continue;
        }
        /** @type {any} */
        let value;
        /** @type {any} */
        let previous;
        switch (op) {
          case SET_UNDEF:
            value = undefined;
            break;
          case SET_NULL:
            value = null;
            break;
          case SET_FALSE:
            value = false;
            break;
          case SET_TRUE:
            value = true;
            break;
          case SET_INT:
            value = operand;
            break;
          case SET_NUM:
            value = nums[operand];
            break;
          case SET_STR:
            value = strs[operand];
            break;
          case SET_NODE:
            value = nodes[operand];
            break;
          default:
            value = side[operand];
            previous = side[operand + 1];
        }
        host.set(nodes[id], names[name], value, previous);
        continue;
      }
      switch (op) {
        case ELEMENT: {
          const lines = ops[i + 3];
          let props = null;
          if (lines >= 0) {
            this.hint.lines = lines;
            props = this.hint;
          }
          nodes[ops[i + 1]] = host.element(names[ops[i + 2]], props, upOf(nodes, ops[i + 4]));
          i += 5;
          break;
        }
        case TEXT:
          nodes[ops[i + 1]] = host.text(strs[ops[i + 2]]);
          i += 3;
          break;
        case MARKER:
          nodes[ops[i + 1]] = host.marker();
          i += 2;
          break;
        case CONTENT:
          host.content(nodes[ops[i + 1]], strs[ops[i + 2]]);
          i += 3;
          break;
        case INSERT: {
          const before = ops[i + 3];
          host.insert(nodes[ops[i + 1]], nodes[ops[i + 2]], before < 0 ? null : nodes[before]);
          i += 4;
          break;
        }
        case REMOVE:
          host.remove(nodes[ops[i + 1]], nodes[ops[i + 2]]);
          i += 3;
          break;
        case LISTEN: {
          const id = ops[i + 1];
          const listener = ops[i + 2];
          const name = names[ops[i + 4]];
          this.kinds[listener] = SUPERSEDED[name] ?? 0;
          const node = nodes[id];
          // A delegated handler stays on its node; dropping it takes unlisten.
          this.removers[listener] = host.listen(node, name, this.forwarder(listener, ops[i + 3], id, name === 'change' || name === 'input')) ?? (() => host.unlisten?.(node, name));
          i += 5;
          break;
        }
        case UNLISTEN: {
          const listener = ops[i + 1];
          const remove = this.removers[listener];
          if (remove != null) {
            this.removers[listener] = null;
            remove();
          }
          i += 2;
          break;
        }
        case PLAN:
          this.plans[ops[i + 1]] = plan(side[ops[i + 2]]);
          i += 3;
          break;
        case CLONE:
        case CLONE_WITH: {
          const p = this.plans[ops[i + 1]];
          const first = ops[i + 2];
          const values = op === CLONE_WITH ? side[ops[i + 3]] : undefined;
          const parent = upOf(nodes, ops[i + SIZE[op] - 1]);
          const made = host.clone !== undefined ? host.clone(p, values, parent) : skeleton(host, p, values, parent);
          for (let r = 0; r < made.length; r++) nodes[first + r] = made[r];
          i += SIZE[op];
          break;
        }
        case BUILD:
          nodes[ops[i + 1]] = host.element(names[ops[i + 2]], side[ops[i + 3]], upOf(nodes, ops[i + 4]));
          i += 5;
          break;
        case FREE: {
          const id = ops[i + 1];
          nodes[id] = null;
          edits[id] = 0;
          i += 2;
          break;
        }
        case VIEW: {
          // A region's viewport the worker's view reads: followed while it does, when the host gives one.
          const follower = ops[i + 2];
          const source = host.viewportOf?.(nodes[ops[i + 1]]) ?? null;
          if (source !== null)
            this.regions.set(
              follower,
              source.viewport((width, height, flags) => {
                if (!this.closed) this.port.postMessage([REGION, follower, width, height, flags], NOTHING);
              }),
            );
          i += 3;
          break;
        }
        case UNVIEW: {
          const stop = this.regions.get(ops[i + 1]);
          if (stop !== undefined) {
            this.regions.delete(ops[i + 1]);
            stop();
          }
          i += 2;
          break;
        }
        default:
          throw new Error(`REN remote: unknown operation ${op} at word ${i}`);
      }
    }
    return records;
  }

  // -------------------------------------------------------------------------
  // Events

  /**
   * The real listener of a worker listener.
   * @param {number} listener @param {number} gen @param {number} id @param {boolean} edit
   * @returns {(event: any) => void}
   */
  forwarder(listener, gen, id, edit) {
    return event => this.forward(listener, gen, id, edit, event);
  }

  /**
   * Queues an event as a flat record; the burst posts once, in a microtask.
   * @param {number} listener @param {number} gen @param {number} id @param {boolean} edit @param {any} event
   */
  forward(listener, gen, id, edit, event) {
    if (this.closed) return;
    const start = now();
    const seq = ++this.seq;
    const source = event != null && event.event != null ? event.event : event;
    const dispatch = this.dispatchOf(source);
    let value = null;
    if (event != null) {
      if (typeof event.value === 'string') value = event.value;
      else if (source.target != null && typeof source.target.value === 'string') value = source.target.value;
    }
    if (edit && value !== null) this.edits[id] = seq;
    const out = this.out;
    const kind = this.kinds[listener];
    // A resize carries the new border box's width and height where a pointer carries x and y.
    const size = source != null && source.type === 'resize';
    const flags = flagsOf(source) | (dispatch << 9);
    const button = source != null && typeof source.button === 'number' ? source.button : -1;
    if (this.group < 0 || dispatch === 0 || dispatch !== this.groupDispatch) {
      // Another dispatch: the one before it is whole.
      this.closeGroup();
      this.group = out.length;
      this.groupKind = kind;
      this.groupDispatch = dispatch;
      this.groupGoes = out.length === 2 && dispatch !== 0 && dispatch === this.posted;
    } else if (kind !== this.groupKind) this.groupKind = 0;
    out.push(
      seq,
      listener,
      gen,
      flags,
      button,
      num(source, size ? 'width' : 'x'),
      num(source, size ? 'height' : 'y'),
      num(source, 'deltaX'),
      num(source, 'deltaY'),
      value,
      source != null && typeof source.key === 'string' ? source.key : null,
    );
    out[1]++;
    this.totals.events++;
    if (!this.sending) {
      this.sending = true;
      queueMicrotask(this.send);
    }
    this.totals.forward += now() - start;
  }

  /**
   * Ends the queued burst's last group of records. A dispatch of superseded
   * events (pointer motion, scroll, resize, wheel) whose records reach the same
   * listeners, in the same order, as the dispatch queued right before it
   * replaces that dispatch: each record takes the latest values, modifier
   * keys, button, key and dispatch number (the latest wins), and a wheel adds
   * up the deltas, only with the same modifier keys, button and deltaMode. The delivered
   * dispatch keeps its records in a row, so a stop in the worker skips
   * exactly what it skips in direct mode; a burst of one motion queues one
   * dispatch, whatever its length.
   */
  closeGroup() {
    const start = this.group;
    if (start < 0) return;
    this.group = -1;
    const out = this.out;
    const before = this.previous;
    const kind = this.groupKind;
    const length = out.length - start;
    if (this.coalesce && kind !== 0 && before >= 0 && this.previousKind === kind && !this.previousGoes && start - before === length && samePath(out, before, start, length) && (kind !== 2 || ((out[before + 3] & WHEELS) === (out[start + 3] & WHEELS) && out[before + 4] === out[start + 4]))) {
      for (let i = before, j = start; j < out.length; i += RECORD, j += RECORD) {
        out[i] = out[j];
        out[i + 3] = out[j + 3];
        out[i + 4] = out[j + 4];
        out[i + 5] = out[j + 5];
        out[i + 6] = out[j + 6];
        if (kind === 2) {
          out[i + 7] += out[j + 7];
          out[i + 8] += out[j + 8];
        } else {
          out[i + 7] = out[j + 7];
          out[i + 8] = out[j + 8];
        }
        out[i + 9] = out[j + 9];
        out[i + 10] = out[j + 10];
      }
      out.length = start;
      const records = length / RECORD;
      out[1] -= records;
      this.totals.events -= records;
      this.totals.merged += records;
      return;
    }
    this.previous = start;
    this.previousKind = kind;
    this.previousGoes = this.groupGoes;
  }

  /**
   * The number of the main-thread dispatch an event object belongs to: every
   * listener it reaches forwards the same object, so the worker can skip the
   * rest of a dispatch whose propagation a handler stopped. 0 for none.
   * @param {any} source
   */
  dispatchOf(source) {
    // A frozen or sealed object may be shared by unrelated dispatches (a renderer's one empty event): none.
    if (source == null || typeof source !== 'object' || !Object.isExtensible(source)) return 0;
    let dispatch = this.dispatches.get(source);
    if (dispatch === undefined) {
      dispatch = this.dispatch = (this.dispatch % DISPATCHES) + 1;
      this.dispatches.set(source, dispatch);
    }
    return dispatch;
  }

  /** Posts the queued events as one message, after applying what waits for its frame. */
  flushEvents() {
    this.sending = false;
    if (this.closed) return;
    const start = now();
    const out = this.out;
    this.closeGroup();
    this.previous = -1;
    if (out[1] > 0) {
      this.posted = this.groupDispatch;
      this.port.postMessage(out, NOTHING);
      out.length = 2;
      out[1] = 0;
      this.totals.bursts++;
      // The answer may be in the mailbox before its bell: look in the next frames.
      if (this.box !== null && typeof requestAnimationFrame === 'function') {
        this.polls = POLLS;
        // timer: fallback, a write to the shared mailbox has no event: the next POLLS frames look.
        if (this.frame === 0) this.frame = requestAnimationFrame(this.tick);
      }
    }
    this.totals.forward += now() - start;
  }

  // -------------------------------------------------------------------------
  // API

  /**
   * Posts `data` to the worker's `message` handler, run in an rrx-core `$batch` of its
   * lane after the events sent before it. Returns its sequence number, or 0
   * after `close()`, which posts nothing.
   * @param {any} data @param {Lane} [lane]
   */
  post(data, lane = 'normal') {
    if (this.closed) return 0;
    if (this.sending) this.flushEvents();
    const seq = ++this.seq;
    this.port.postMessage([POST, seq, lane === 'urgent' ? 0 : lane === 'background' ? 2 : 1, data], NOTHING);
    return seq;
  }

  /** Resolves once the worker has published, and this side applied, everything sent before; `close()` settles it. @returns {Promise<void>} */
  idle() {
    if (this.closed) return Promise.resolve();
    if (this.sending) this.flushEvents();
    // This task's storage writes go first: they were sent before it asked.
    this.save();
    const token = ++this.token;
    return new Promise(resolve => {
      this.syncs.set(token, resolve);
      this.port.postMessage([SYNC, token], NOTHING);
    });
  }

  /** Stops applying messages and removes every real listener. */
  close() {
    if (this.closed) return;
    this.save();
    this.closed = true;
    if (this.storage !== null) this.storage.sink = null;
    if (this.unview !== null) this.unview();
    this.unview = null;
    for (const stop of this.regions.values()) stop();
    this.regions.clear();
    this.stop();
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.pending.length = 0;
    const removers = this.removers;
    for (let i = 0; i < removers.length; i++) {
      const remove = removers[i];
      if (remove != null) remove();
    }
    removers.length = 0;
    for (const detach of this.detach) detach();
    this.detach.length = 0;
    // No reply can arrive now: every idle() still waiting settles.
    for (const resolve of this.syncs.values()) resolve();
    this.syncs.clear();
  }
}

const EMPTY = new Float64Array(0);
/** @type {readonly any[]} */
const NONE = [];
/** Words per record, by opcode (the table of worker.js). */
const SIZE = new Int32Array([0, 5, 3, 2, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 5, 2, 2, 3, 4, 5, 5, 3, 2]);

/**
 * Whether a message's counts fit its buffers and its tables are tables, so
 * the views over them can be made: `[BATCH, ops, n, nums, m, strs, fresh, side]`.
 * @param {any[]} data
 */
function wellFormed(data) {
  const ops = data[1];
  const n = data[2];
  const m = data[4];
  if (!Number.isInteger(n) || n < HEADER) return false;
  if (ops instanceof Int32Array) {
    if (n > ops.length) return false;
  } else if (!(ops instanceof ArrayBuffer) || n * 4 > ops.byteLength) return false;
  const nums = data[3];
  if (nums === null || nums === undefined) {
    if (m !== 0 && m != null && !(ops instanceof Int32Array)) return false;
  } else if (nums instanceof Float64Array) {
    if (!Number.isInteger(m) || m < 0 || m > nums.length) return false;
  } else if (!(nums instanceof ArrayBuffer) || !Number.isInteger(m) || m < 0 || m * 8 > nums.byteLength) return false;
  for (const k of [5, 6, 7]) if (data[k] != null && !Array.isArray(data[k])) return false;
  return true;
}

/**
 * Whether the records at `a` and at `b` (`length` words each) reach the same
 * listeners, of the same generation, in the same order.
 * @param {any[]} out @param {number} a @param {number} b @param {number} length
 */
function samePath(out, a, b, length) {
  for (let k = 0; k < length; k += RECORD) if (out[a + k + 1] !== out[b + k + 1] || out[a + k + 2] !== out[b + k + 2]) return false;
  return true;
}

/** An event's flag bits: its modifier keys, a checked target, a text field's key, a wheel's deltaMode, a visible focus. @param {any} source */
function flagsOf(source) {
  let flags = 0;
  if (source != null) {
    if (source.shiftKey) flags |= 1;
    if (source.ctrlKey) flags |= 2;
    if (source.altKey) flags |= 4;
    if (source.metaKey) flags |= 8;
    if (source.target != null && source.target.checked === true) flags |= 16;
    if (source.editable === true) flags |= 32;
    const mode = source.deltaMode;
    if (mode === 1 || mode === 2) flags |= mode << 6;
    if (source.focusVisible === true) flags |= 256;
  }
  return flags;
}

/** The node a record's parent id names, or null (-1, or one not made here). @param {any[]} nodes @param {number} id */
const upOf = (nodes, id) => (id >= 0 ? (nodes[id] ?? null) : null);

/** A numeric field of an event, or 0; x and y fall back to clientX and clientY. @param {any} event @param {string} name */
function num(event, name) {
  if (event == null) return 0;
  const value = event[name];
  if (typeof value === 'number') return value;
  if (name === 'x' || name === 'y') {
    const client = event[name === 'x' ? 'clientX' : 'clientY'];
    if (typeof client === 'number') return client;
  }
  return 0;
}

/**
 * Applies a worker's view (see `serve` in ren-core/worker) to `host`, rendered
 * into `container`; returns the connection.
 * @param {Port} port the Worker, or a port to it
 * @param {Host} host a real host: `$dom(document)` or a Skia `Renderer`
 * @param {any} container the host node the view renders into (a DOM element; a renderer's `root`)
 * @param {Options} [options]
 * @returns {Connection}
 */
export function connect(port, host, container, options = {}) {
  return new Connection(port, host, container, options);
}
