// The worker mode's shared mailbox: one message slot in a SharedArrayBuffer
// that the worker writes and the main thread reads, so the main thread can
// apply an answer inside its next animation frame instead of waiting for the
// message task, which Chrome runs after the frame that follows an input.
// It needs cross-origin isolation (COOP/COEP) in a browser; the message
// path stays for everything else.
//
// Layout: a control block of Int32 words, then the message's Int32 op words,
// its Float64 numbers, the lengths of its strings (the names new to the
// table first, then the message's strings) and their UTF-16 code units.
// The worker writes only while the slot is free and marks it written last
// (Atomics.store); the main thread reads it in place and frees it after it
// has applied the message. A message with structured values (style objects,
// template plans), or one that does not fit, goes by message.

/** Control words: slot state, message number, op words, numbers, strings, code units, names. */
const STATE = 0;
const NUMBER = 1;
const WORDS = 2;
const NUMS = 3;
const STRINGS = 4;
const UNITS = 5;
const NAMES = 6;
const CONTROL = 8;
const FREE = 0;
const WRITTEN = 1;

/** The default size of a mailbox, bytes. */
export const SIZE = 1 << 22;

/** One slot shared by the two sides, over a SharedArrayBuffer. */
export class Mailbox {
  /** @param {SharedArrayBuffer} buffer */
  constructor(buffer) {
    const size = buffer.byteLength;
    this.buffer = buffer;
    this.control = new Int32Array(buffer, 0, CONTROL);
    let at = CONTROL * 4;
    const words = (Math.floor((size * 0.4) / 4) >> 1) << 1;
    this.ops = new Int32Array(buffer, at, words);
    at += words * 4;
    const nums = Math.floor((size * 0.15) / 8);
    this.nums = new Float64Array(buffer, at, nums);
    at += nums * 8;
    const lens = Math.floor((size * 0.05) / 4);
    this.lens = new Int32Array(buffer, at, lens);
    at += lens * 4;
    this.units = new Uint16Array(buffer, at, Math.floor((size - at) / 2));
  }

  /** A new mailbox of `size` bytes. @param {number} [size] */
  static make(size = SIZE) {
    return new Mailbox(new SharedArrayBuffer(size));
  }

  /**
   * The worker: writes a message into the free slot; false when the slot is
   * taken or the message does not fit (it goes by message then).
   * @param {number} number @param {Int32Array} ops @param {number} n @param {Float64Array} nums @param {number} m
   * @param {readonly string[]} strs @param {readonly string[]} fresh
   */
  write(number, ops, n, nums, m, strs, fresh) {
    const control = this.control;
    if (Atomics.load(control, STATE) !== FREE) return false;
    if (n > this.ops.length || m > this.nums.length || strs.length + fresh.length > this.lens.length) return false;
    let units = 0;
    for (let i = 0; i < fresh.length; i++) units += fresh[i].length;
    for (let i = 0; i < strs.length; i++) units += strs[i].length;
    if (units > this.units.length) return false;
    this.ops.set(n === ops.length ? ops : ops.subarray(0, n));
    if (m > 0) this.nums.set(m === nums.length ? nums : nums.subarray(0, m));
    const lens = this.lens;
    const out = this.units;
    let k = 0;
    let p = 0;
    for (let s = 0; s < 2; s++) {
      const list = s === 0 ? fresh : strs;
      for (let i = 0; i < list.length; i++) {
        const text = list[i];
        const length = text.length;
        lens[k++] = length;
        for (let j = 0; j < length; j++) out[p++] = text.charCodeAt(j);
      }
    }
    control[NUMBER] = number;
    control[WORDS] = n;
    control[NUMS] = m;
    control[STRINGS] = strs.length;
    control[UNITS] = units;
    control[NAMES] = fresh.length;
    Atomics.store(control, STATE, WRITTEN);
    return true;
  }

  /** The main thread: the number of the message waiting in the slot, or -1. */
  waiting() {
    return Atomics.load(this.control, STATE) === WRITTEN ? this.control[NUMBER] : -1;
  }

  /**
   * The main thread: the message in the slot as the message path carries it,
   * `[BATCH, ops, n, nums, m, strs, fresh, null]`, with the op words and
   * numbers as views over the slot (valid until `free`).
   * @param {number} batch
   * @returns {any[]}
   */
  read(batch) {
    const control = this.control;
    const n = control[WORDS];
    const m = control[NUMS];
    const count = control[STRINGS];
    const names = control[NAMES];
    const lens = this.lens;
    const units = this.units;
    /** @type {string[]} */
    const fresh = new Array(names);
    /** @type {string[]} */
    const strs = new Array(count);
    let p = 0;
    for (let k = 0; k < names + count; k++) {
      const length = lens[k];
      const text = decode(units, p, length);
      p += length;
      if (k < names) fresh[k] = text;
      else strs[k - names] = text;
    }
    return [batch, this.ops.subarray(0, n), n, m > 0 ? this.nums.subarray(0, m) : null, m, count > 0 ? strs : null, names > 0 ? fresh : null, null];
  }

  /** The main thread: the message is applied; the worker may write the next. */
  free() {
    Atomics.store(this.control, STATE, FREE);
  }
}

/** A string from UTF-16 code units, in chunks (argument count limits). @param {Uint16Array} units @param {number} at @param {number} length */
function decode(units, at, length) {
  if (length <= 4096) return String.fromCharCode.apply(null, /** @type {any} */ (units.subarray(at, at + length)));
  let out = '';
  for (let i = 0; i < length; i += 4096) out += String.fromCharCode.apply(null, /** @type {any} */ (units.subarray(at + i, at + Math.min(length, i + 4096))));
  return out;
}
