// Direct and worker mode hear the same events, on random scripts: the class
// guard behind parity.test.jsx's hand-written cases. Each seed makes bursts of
// main-thread dispatches (clicks, moves, wheels, keys, scrolls, focus; random
// targets, modifiers, buttons and stops, some split across messages by a
// flush, a few sharing one frozen object) and runs them on the in-memory Tree
// host in direct mode and in worker mode. Without coalescing the logs match
// exactly; with it, each burst's log is exactly the direct log of the burst
// with its superseded dispatches left out (test/fixtures/coalesce.js models
// which, and a merged wheel's added-up deltas), and the coalesced records of
// a burst are never more than the model's.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Root, $dispose, $keys, $scrolls } from 'ren-core';
import { mount } from 'ren-core/host';
import { serve } from 'ren-core/worker';
import { connect } from 'ren-core/remote';
import { Tree, find } from './fixtures/tree.js';
import { closeAfter } from './fixtures/after.js';
import { coalesced } from './fixtures/coalesce.js';

const SEEDS = 300;
const NAMES = ['click', 'pointermove', 'wheel', 'key', 'scroll', 'focus'];
/** @type {Record<string, string>} */
const PROP = { click: 'onClick', pointermove: 'onPointerMove', wheel: 'onWheel', key: 'onKey', scroll: 'onScroll', focus: 'onFocus' };
/** Each item's path to the top, as bubbling reaches it. @type {Record<string, string[]>} */
const PATHS = { c: ['c', 'b', 'a'], b: ['b', 'a'], a: ['a'], d: ['d', 'a'] };

/** The modifier bits of an event: shift 1, ctrl 2, alt 4, meta 8. @param {any} e */
const modsOf = e => (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0);

/**
 * A handler that logs who heard what; it stops the dispatch when the event's
 * key lists its tag. A wheel logs its deltas, so a merge shows.
 * @param {string[]} log @param {string} tag @param {string} name
 */
const handler = (log, tag, name) => (/** @type {any} */ e) => {
  const wheel = name === 'wheel' ? ` dx=${e.deltaX} dy=${e.deltaY}` : '';
  log.push(`${tag} ${name} x=${e.x ?? 0} m=${modsOf(e)} b=${e.button ?? -1} ${e.key ?? ''}${wheel}`);
  if (typeof e.key === 'string' && e.key.split(',').includes(tag)) e.stopPropagation();
};

/** @param {string[]} log */
const App = log => () => {
  $keys(handler(log, 'root', 'keys'));
  $scrolls(handler(log, 'root', 'scrolls'));
  /** @param {string} tag */
  const on = tag => Object.fromEntries(NAMES.map(n => [PROP[n], handler(log, tag, n)]));
  return (
    <a {...on('a')}>
      <b {...on('b')}>
        <c {...on('c')} />
      </b>
      <d {...on('d')} />
    </a>
  );
};

/** A seeded linear congruential generator. @param {number} seed */
function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/**
 * The script of one seed: bursts of dispatches `{ path, init, split, frozen }`.
 * A wheel's deltaX is its modifier bits plus one and its deltaY 1, so a merged
 * wheel's deltaX is its deltaY times that only when every event it took had
 * its modifiers.
 * @param {number} seed
 */
function makeScript(seed) {
  const rnd = random(seed);
  /** @param {any[]} a */
  const pick = a => a[Math.floor(rnd() * a.length)];
  const script = [];
  const bursts = 1 + Math.floor(rnd() * 6);
  for (let b = 0; b < bursts; b++) {
    const burst = [];
    const count = 1 + Math.floor(rnd() * 8);
    for (let k = 0; k < count; k++) {
      const name = pick(NAMES);
      const start = pick(['a', 'b', 'c', 'd']);
      /** @type {string[][]} */
      let path;
      if (name === 'focus') path = [[start, name]];
      else if (name === 'scroll') path = [['root', 'scrolls'], [start, name]];
      else {
        path = PATHS[start].map(t => [t, name]);
        if (name === 'key') path.push(['root', 'keys']);
      }
      const stops = ['a', 'b', 'c', 'd', 'root'].filter(() => rnd() < 0.3).join(',');
      const mods = Math.floor(rnd() * 4) * (rnd() < 0.5 ? 1 : 5);
      const init = {
        x: k + 10 * b,
        shiftKey: (mods & 1) !== 0,
        ctrlKey: (mods & 2) !== 0,
        altKey: (mods & 4) !== 0,
        metaKey: (mods & 8) !== 0,
        button: pick([-1, 0, 0, 0, 2]),
        deltaX: mods + 1,
        deltaY: 1,
        key: stops || 'none',
      };
      const split = rnd() < 0.2 ? Math.floor(rnd() * path.length) : -1;
      burst.push({ path, init, split, frozen: rnd() < 0.05 });
    }
    script.push(burst);
  }
  return script;
}

/**
 * Runs one dispatch: its listeners in order with one event object, until a
 * handler stops it; in worker mode, a split sends the records so far first.
 * @param {any} box @param {any} step @param {any} connection
 */
function fire(box, step, connection) {
  let stopped = false;
  const event = step.frozen ? Object.freeze({ ...step.init, stopPropagation() {} }) : { ...step.init, stopPropagation: () => void (stopped = true) };
  for (let i = 0; i < step.path.length; i++) {
    if (stopped) break;
    if (connection !== null && i === step.split) connection.flushEvents();
    const [tag, name] = step.path[i];
    const node = tag === 'root' ? box : find(box, tag)[0];
    node.on[name]?.(event);
  }
}

/**
 * Direct mode's log, by burst, of dispatches given record by record (each
 * record with its own event values; a stop skips the dispatch's later ones).
 * Without coalescing, each step is one dispatch of its whole path.
 * @param {{ records: { at: string[], init: any }[], frozen: boolean }[][]} bursts
 */
function replay(bursts) {
  const H = Tree();
  const box = H.element('box', null);
  const R = Root('app');
  /** @type {string[]} */
  const log = [];
  const dispose = mount(H, App(log), box, { root: R });
  const out = [];
  for (const burst of bursts) {
    for (const dispatch of burst) {
      let stopped = false;
      for (const { at, init } of dispatch.records) {
        if (stopped) break;
        const event = dispatch.frozen ? Object.freeze({ ...init, stopPropagation() {} }) : { ...init, stopPropagation: () => void (stopped = true) };
        const node = at[0] === 'root' ? box : find(box, at[0])[0];
        node.on[at[1]]?.(event);
      }
    }
    out.push(log.splice(0));
  }
  dispose();
  $dispose(R);
  return out;
}

/** The direct mode's log, by burst. @param {any[][]} script */
function direct(script) {
  const H = Tree();
  const box = H.element('box', null);
  const R = Root('app');
  /** @type {string[]} */
  const log = [];
  const dispose = mount(H, App(log), box, { root: R });
  const out = [];
  for (const burst of script) {
    for (const step of burst) fire(box, step, null);
    out.push(log.splice(0));
  }
  dispose();
  $dispose(R);
  return out;
}

/** The worker mode's log, by burst. @param {any} t @param {any[][]} script @param {boolean} coalesce */
async function worker(t, script, coalesce) {
  const H = Tree();
  const box = H.element('box', null);
  const W = Root('app');
  /** @type {string[]} */
  const log = [];
  const { port1, port2 } = new MessageChannel();
  const connection = connect(port2, H, box, { schedule: 'now', coalesce });
  const session = serve(App(log), { port: port1, root: W });
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    connection.close();
    session.close();
    port1.close();
    port2.close();
    $dispose(W);
  };
  closeAfter(t, close);
  await connection.idle();
  const out = [];
  /** Records sent, by burst. */
  const records = [];
  for (const burst of script) {
    const before = connection.totals.events;
    for (const step of burst) fire(box, step, connection);
    await connection.idle();
    out.push(log.splice(0));
    records.push(connection.totals.events - before);
  }
  close();
  return Object.assign(out, { records });
}

/** @param {any[][]} script */
const describeScript = script => JSON.stringify(script.map(burst => burst.map(s => [s.path.map((/** @type {string[]} */ p) => p.join(':')).join('>'), s.init.key, s.split, s.frozen])));

describe('ren-core event parity on random scripts', () => {
  it('hears the same events in worker mode as in direct mode, without coalescing', { timeout: 60000 }, async t => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const script = makeScript(seed);
      const expected = direct(script);
      const heard = await worker(t, script, false);
      for (let b = 0; b < script.length; b++) assert.deepEqual(heard[b], expected[b], `seed ${seed} burst ${b}: ${describeScript(script)}`);
    }
  });

  it('hears the direct events without the superseded dispatches, with coalescing', { timeout: 60000 }, async t => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const script = makeScript(seed);
      const model = script.map(burst => coalesced(burst));
      const expected = replay(model);
      const heard = await worker(t, script, true);
      for (let b = 0; b < script.length; b++) {
        assert.deepEqual(heard[b], expected[b], `seed ${seed} burst ${b}: ${describeScript(script)}`);
        const records = model[b].reduce((n, d) => n + d.records.length, 0);
        assert.equal(heard.records[b], records, `seed ${seed} burst ${b}: records sent`);
      }
    }
  });
});
