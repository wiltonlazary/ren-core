// A root's locks: its lock manager's, or, where there is none, leases in
// its storage backing shared by the tabs of an origin. Two roots of one id
// over one backing stand for two tabs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Root, Locker, Locks, Storage, Memory, $lookup, $dispose, $effect, $flush } from 'ren-core';
import { Tree } from './fixtures/tree.js';

/**
 * Waits until `test()` holds, at most `bound` milliseconds.
 * @param {() => boolean} test @param {number} [bound]
 */
async function reached(test, bound = 5000) {
  const deadline = Date.now() + bound;
  // timer: poll, a lease's waits end on its own timers, which report to nothing a test can await
  while (!test()) await new Promise((resolve, reject) => (Date.now() > deadline ? reject(new Error('not reached in time')) : setTimeout(resolve, 1)));
}

/** Counts the reads of a backing: each look a waiting request takes at a lease. @param {Memory} backing */
function looks(backing) {
  const getItem = backing.getItem.bind(backing);
  const count = { n: 0 };
  backing.getItem = key => (count.n++, getItem(key));
  return count;
}

/**
 * A tab: a root `app` over `backing` with no lock manager, its waits shortened.
 * @param {import('node:test').TestContext} t @param {Memory} backing @param {{ ttl?: number }} [options]
 */
function tab(t, backing, options = {}) {
  const root = Root({ id: 'app', renderer: Tree(), storage: backing, locks: null, children: 'tab' });
  t.after(() => $dispose(root));
  const locker = $lookup(root, Locks);
  const lease = /** @type {NonNullable<typeof locker.lease>} */ (locker.lease);
  lease.settle = 2;
  lease.poll = 1;
  if (options.ttl !== undefined) lease.ttl = options.ttl;
  return { root, locker, lease };
}

/** A promise and its two ends. @returns {{ promise: Promise<any>, resolve: (value?: any) => void, reject: (error: any) => void }} */
function gate() {
  /** @type {any} */
  let resolve;
  /** @type {any} */
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const KEY = 'ren-lock:app:refresh';

describe('a root with a lock manager', () => {
  it('asks its manager, with its own names, and holds no lease', async t => {
    /** @type {any[]} */
    const asked = [];
    const manager = {
      /** @param {string} name @param {any} options @param {(lock: any) => any} callback */
      request: async (name, options, callback) => (asked.push([name, options]), callback({ name, mode: options.mode ?? 'exclusive' })),
      query: async () => ({ held: [{ name: 'ren:app:a' }, { name: 'ren:other:b' }], pending: [{ name: 'ren:app:c' }] }),
    };
    const backing = new Memory();
    const root = Root({ id: 'app', renderer: Tree(), storage: backing, locks: manager, children: 'x' });
    t.after(() => $dispose(root));
    const locker = $lookup(root, Locks);
    assert.equal(locker.manager, manager);
    assert.equal(locker.lease, null);
    assert.equal(await locker.request('refresh', lock => lock.name), 'ren:app:refresh');
    assert.equal(await locker.request('read', { mode: 'shared' }, lock => lock.mode), 'shared');
    assert.deepEqual(asked, [['ren:app:refresh', {}], ['ren:app:read', { mode: 'shared' }]]);
    assert.deepEqual(await locker.query(), { held: ['a'], pending: ['c'] });
    assert.equal(backing.length, 0, 'nothing is written to the storage');
  });
});

describe('a root without a lock manager', () => {
  it('has no locks without a storage backing either, as a Locker made by hand: request throws', async t => {
    const root = Root({ id: 'bare', renderer: Tree(), storage: null, locks: null, children: 'x' });
    t.after(() => $dispose(root));
    for (const locker of [$lookup(root, Locks), new Locker('ticket', null)]) {
      assert.equal(locker.manager, null);
      assert.equal(locker.lease, null);
      assert.throws(() => locker.request('seat', () => 1), /REN: this root has no lock manager \(Web Locks\)/);
      assert.throws(() => locker.request('seat', { ifAvailable: true }, () => 1), /no lock manager/);
      assert.deepEqual(await locker.query(), { held: [], pending: [] });
    }
  });

  it('leaves the main-thread side of a worker root without locks', t => {
    const { port1, port2 } = new MessageChannel();
    const root = Root({ id: 'w', runtime: 'worker', worker: port2, renderer: Tree(), storage: new Memory(), locks: null, connect: { schedule: 'now' } });
    t.after(() => {
      $dispose(root);
      port1.close();
      port2.close();
    });
    const locker = $lookup(root, Locks);
    assert.equal(locker.lease, null);
    assert.throws(() => locker.request('seat', () => 1), /no lock manager/);
  });

  it('holds a lock as a lease in its storage backing: a promise of what the callback returns, the lease gone after', async t => {
    const backing = new Memory();
    const { root, locker, lease } = tab(t, backing);
    assert.equal(locker.manager, null, 'the manager stays null: the lease is beside it');
    const shelf = /** @type {import('ren-core').Shelf} */ ($lookup(root, Storage));
    shelf.set('kept', '1');
    let runs = 0;
    $effect(root, () => void (shelf.keys(), runs++));
    $flush(root);
    const request = locker.request('refresh', async lock => {
      assert.deepEqual(lock, { name: 'ren:app:refresh', mode: 'exclusive' });
      const [until, holder] = /** @type {string} */ (backing.getItem(KEY)).split(' ');
      assert.equal(holder, lease.holder);
      assert.ok(Number(until) > Date.now());
      // The lease is no key of the root's Storage: not listed, not cleared, and no reader runs again for it.
      assert.deepEqual(shelf.keys(), ['kept']);
      assert.deepEqual(shelf.entries(), ['kept', '1']);
      assert.deepEqual(await locker.query(), { held: ['refresh'], pending: [] });
      shelf.clear();
      assert.notEqual(backing.getItem(KEY), null, "the application's clear leaves it");
      return 'done';
    });
    assert.ok(request instanceof Promise);
    assert.equal(await request, 'done');
    assert.equal(backing.getItem(KEY), null, 'released');
    $flush(root);
    assert.equal(runs, 2, 'only the clear ran the reader again');
    assert.deepEqual(await locker.query(), { held: [], pending: [] });
  });

  it('runs one callback at a time across two tabs', async t => {
    const backing = new Memory();
    const [a, b] = [tab(t, backing), tab(t, backing)];
    assert.notEqual(a.lease.holder, b.lease.holder);
    const read = looks(backing);
    /** @type {string[]} */
    const seen = [];
    const hold = gate();
    const one = a.locker.request('refresh', async () => {
      seen.push('a in');
      await hold.promise;
      seen.push('a out');
      return 'a';
    });
    const two = b.locker.request('refresh', async () => (seen.push('b in'), 'b'));
    await reached(() => seen.length > 0);
    // b looks at a's lease again and again, and stays out; a lock of another name is free meanwhile.
    const before = read.n;
    await reached(() => read.n > before + 5);
    assert.deepEqual(seen, ['a in']);
    assert.equal(await b.locker.request('other', () => 'free'), 'free');
    hold.resolve();
    assert.deepEqual(await Promise.all([one, two]), ['a', 'b']);
    assert.deepEqual(seen, ['a in', 'a out', 'b in']);
    assert.equal(backing.length, 0, 'let go after the last');
  });

  it("runs one tab's requests of a lock in turn", async t => {
    const backing = new Memory();
    const { locker } = tab(t, backing);
    /** @type {string[]} */
    const seen = [];
    const gates = [gate(), gate(), gate()];
    const all = Promise.all(gates.map((hold, i) => locker.request('refresh', async () => {
      seen.push(`${i} in`);
      await hold.promise;
      seen.push(`${i} out`);
      return i;
    })));
    await reached(() => seen.length === 1);
    assert.deepEqual(await locker.query(), { held: ['refresh'], pending: ['refresh', 'refresh'] });
    // Let go out of order: each still waits for the one before it.
    gates[2].resolve();
    gates[1].resolve();
    for (let i = 0; i < 10; i++) await null;
    assert.deepEqual(seen, ['0 in']);
    gates[0].resolve();
    assert.deepEqual(await all, [0, 1, 2]);
    assert.deepEqual(seen, ['0 in', '0 out', '1 in', '1 out', '2 in', '2 out']);
  });

  it('yields to a tab that wrote its lease at the same moment: the last write stands', async t => {
    const backing = new Memory();
    const a = tab(t, backing);
    // Another tab's write lands right after this one's first, inside its settle window.
    const setItem = backing.setItem.bind(backing);
    let until = 0;
    backing.setItem = (key, value) => {
      setItem(key, value);
      if (until === 0) setItem(key, `${(until = Date.now() + 40)} other`);
    };
    assert.equal(await a.locker.request('refresh', async () => Date.now() >= until), true, 'it held only once the other lease was over');
    assert.equal(backing.length, 0);
  });

  it('takes the lease a vanished holder left once it expires, never before', async t => {
    const backing = new Memory();
    const b = tab(t, backing);
    // A tab closed holding the lock: its lease is renewed no more.
    const until = Date.now() + 60;
    backing.setItem(KEY, `${until} gone`);
    assert.equal(await b.locker.request('refresh', async () => Date.now() >= until), true, 'waited for it to expire');
    // What is no lease (a damaged item) holds nothing.
    backing.setItem(KEY, 'nonsense');
    assert.equal(await b.locker.request('refresh', async () => 'taken'), 'taken');
  });

  it('renews its lease while it holds the lock, so a long callback keeps the other tab out', async t => {
    const backing = new Memory();
    const [a, b] = [tab(t, backing, { ttl: 30 }), tab(t, backing, { ttl: 30 })];
    const hold = gate();
    /** @type {string[]} */
    const seen = [];
    let first = 0;
    const one = a.locker.request('refresh', async () => {
      first = Number(/** @type {string} */ (backing.getItem(KEY)).split(' ')[0]);
      seen.push('a in');
      await hold.promise;
      seen.push('a out');
    });
    await reached(() => seen.length === 1);
    const two = b.locker.request('refresh', async () => void seen.push('b in'));
    // Past the first lease's term: it was renewed, and b still waits.
    await reached(() => Date.now() > first + 30);
    assert.ok(Number(/** @type {string} */ (backing.getItem(KEY)).split(' ')[0]) > first, 'renewed');
    assert.deepEqual(seen, ['a in']);
    assert.deepEqual(await b.locker.query(), { held: ['refresh'], pending: ['refresh'] });
    assert.deepEqual(await a.locker.query(), { held: ['refresh'], pending: [] }, "another tab's waiting request is not known");
    hold.resolve();
    await Promise.all([one, two]);
    assert.deepEqual(seen, ['a in', 'a out', 'b in']);
  });

  it('releases the lock when the callback throws or rejects, and rejects with it', async t => {
    const backing = new Memory();
    const [a, b] = [tab(t, backing), tab(t, backing)];
    await assert.rejects(a.locker.request('refresh', () => {
      throw new Error('thrown');
    }), /thrown/);
    assert.equal(backing.getItem(KEY), null);
    await assert.rejects(a.locker.request('refresh', async () => Promise.reject(new Error('rejected'))), /rejected/);
    assert.equal(backing.getItem(KEY), null);
    assert.equal(await b.locker.request('refresh', () => 'next'), 'next', 'the next request has it at once');
    await assert.rejects(a.locker.request('refresh', /** @type {any} */ (undefined)), TypeError);
  });

  it('calls back with null for ifAvailable when the lock is held, here or in another tab', async t => {
    const backing = new Memory();
    const [a, b] = [tab(t, backing), tab(t, backing)];
    assert.equal(await a.locker.request('refresh', { ifAvailable: true }, lock => lock?.mode), 'exclusive', 'free: taken');
    const hold = gate();
    let held = false;
    const one = a.locker.request('refresh', async () => ((held = true), hold.promise));
    await reached(() => held);
    assert.equal(await b.locker.request('refresh', { ifAvailable: true }, lock => (lock === null ? 'held elsewhere' : 'taken')), 'held elsewhere');
    assert.equal(await a.locker.request('refresh', { ifAvailable: true }, lock => (lock === null ? 'held here' : 'taken')), 'held here');
    assert.equal(/** @type {string} */ (backing.getItem(KEY)).split(' ')[1], a.lease.holder, 'the holder keeps its lease');
    hold.resolve();
    await one;
    assert.equal(await b.locker.request('refresh', { ifAvailable: true }, lock => (lock === null ? 'held' : 'taken')), 'taken');
  });

  it('rejects a request whose signal aborts while it waits; one already granted runs on', async t => {
    const backing = new Memory();
    const [a, b] = [tab(t, backing), tab(t, backing)];
    const hold = gate();
    let held = false;
    const holding = new AbortController();
    const one = a.locker.request('refresh', { signal: holding.signal }, async () => ((held = true), hold.promise));
    await reached(() => held);
    // Waiting in another tab, and waiting its turn in the holder's own.
    const [there, here] = [new AbortController(), new AbortController()];
    let ran = false;
    const two = b.locker.request('refresh', { signal: there.signal }, () => (ran = true));
    const three = a.locker.request('refresh', { signal: here.signal }, () => (ran = true));
    const four = a.locker.request('refresh', () => 'after the aborted one');
    there.abort(new Error('stopped there'));
    here.abort(new Error('stopped here'));
    await assert.rejects(two, /stopped there/);
    await assert.rejects(three, /stopped here/);
    holding.abort(new Error('too late'));
    hold.resolve('kept');
    assert.equal(await one, 'kept', 'a granted request is not aborted');
    assert.equal(await four, 'after the aborted one');
    assert.equal(ran, false);
    const before = new AbortController();
    before.abort(new Error('aborted before'));
    await assert.rejects(a.locker.request('refresh', { signal: before.signal }, () => 1), /aborted before/);
    assert.equal(backing.length, 0);
  });

  it('keeps the lock its holder\'s when a request behind it aborts: the next one still waits its turn', async t => {
    const backing = new Memory();
    const { root, locker, lease } = tab(t, backing);
    /** @type {string[]} */
    const seen = [];
    let inside = 0;
    let most = 0;
    const [first, third] = [gate(), gate()];
    const hold = (/** @type {string} */ who, /** @type {Promise<any>} */ until) => async () => {
      most = Math.max(most, ++inside);
      seen.push(`${who} in`);
      await until;
      seen.push(`${who} out`);
      inside--;
    };
    const one = locker.request('refresh', hold('1', first.promise));
    await reached(() => seen.length === 1);
    // The second waits its turn, the last in line, and aborts there.
    const stop = new AbortController();
    const two = locker.request('refresh', { signal: stop.signal }, hold('2', Promise.resolve()));
    stop.abort(new Error('stopped'));
    await assert.rejects(two, /stopped/);
    const three = locker.request('refresh', hold('3', third.promise));
    assert.equal(await locker.request('refresh', { ifAvailable: true }, lock => (lock === null ? 'held' : 'taken')), 'held');
    // Long enough for the third to have settled its own lease, had it not waited.
    await new Promise(resolve => {
      // timer: deadline, the third request's settle window (2 ms) is well over by then; its turn must not have come
      setTimeout(resolve, 20);
    });
    assert.deepEqual(seen, ['1 in'], 'the third does not start before the first ends');
    assert.equal(/** @type {string} */ (backing.getItem(KEY)).split(' ')[1], lease.holder, "the lease stays the holder's");
    assert.equal(lease.renewals.size, 1);
    first.resolve();
    await one;
    await reached(() => seen.includes('3 in'));
    assert.notEqual(backing.getItem(KEY), null, 'the third holds it now');
    third.resolve();
    await three;
    assert.deepEqual(seen, ['1 in', '1 out', '3 in', '3 out']);
    assert.equal(most, 1, 'never two holders');
    // Nothing is left: no lease, no renewal timer, no turn, no waiting request; and none after the root ends.
    await reached(() => lease.turns.size === 0);
    assert.equal(backing.length, 0);
    assert.equal(lease.renewals.size, 0);
    assert.equal(lease.asks.size, 0);
    $dispose(root);
    assert.equal(lease.renewals.size, 0);
  });

  it('grants shared as exclusive, and refuses what a lease cannot do', async t => {
    const backing = new Memory();
    const { locker } = tab(t, backing);
    assert.equal(await locker.request('read', { mode: 'shared' }, lock => lock.mode), 'exclusive');
    await assert.rejects(locker.request('refresh', { steal: true }, () => 1), { name: 'NotSupportedError' });
    await assert.rejects(locker.request('refresh', { ifAvailable: true, signal: new AbortController().signal }, () => 1), { name: 'NotSupportedError' });
    await assert.rejects(locker.request('refresh', { mode: 'other' }, () => 1), TypeError);
    assert.equal(backing.length, 0);
  });

  it('rejects a request the backing refuses, and holds nothing', async t => {
    const backing = new Memory();
    const { locker } = tab(t, backing);
    const setItem = backing.setItem;
    backing.setItem = () => {
      throw new Error('storage full');
    };
    await assert.rejects(locker.request('refresh', () => 1), /storage full/);
    backing.setItem = setItem;
    assert.equal(await locker.request('refresh', () => 'works again'), 'works again');
  });

  it('gives its leases back when the root is disposed, and leaves the requests that wait unsettled', async t => {
    const backing = new Memory();
    const [a, b] = [tab(t, backing), tab(t, backing)];
    const hold = gate();
    let held = false;
    const one = a.locker.request('refresh', async () => ((held = true), hold.promise));
    await reached(() => held);
    let settled = false;
    a.locker.request('refresh', () => 1).then(() => (settled = true), () => (settled = true));
    $dispose(a.root);
    assert.equal(backing.getItem(KEY), null, 'the held lease is removed');
    assert.equal(a.locker.lease, null);
    assert.throws(() => a.locker.request('refresh', () => 1), /no lock manager/, 'a disposed root has no locks');
    assert.equal(await b.locker.request('refresh', () => 'b has it'), 'b has it');
    hold.resolve('finished');
    assert.equal(await one, 'finished', 'the callback that ran settles its request');
    // Long enough for the request that waited to have taken the lock, had it gone on.
    await b.locker.request('refresh', () => reached(() => !b.lease.taken(KEY)));
    await b.locker.request('refresh', () => 2);
    assert.equal(settled, false);
    assert.equal(backing.length, 0);
  });
});
