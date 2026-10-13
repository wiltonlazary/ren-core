// The live nested roots of the direct runtime, by parent: what `$settle`
// covers below a root. root.js adds a child when it nests one and it leaves
// when it ends; a settle watches the roots it covers, so a nested root that
// appears while it waits joins it at once.

import { $cleanup } from 'rrx-core';

/** @typedef {import('rrx-core/core').Graph} Root */

/** Each root's live nested roots (their graphs run here). @type {WeakMap<Root, Set<Root>>} */
const kids = new WeakMap();

/** Who listens for a new nested root of each root. @type {WeakMap<Root, Set<(child: Root) => void>>} */
const watchers = new WeakMap();

/** @type {readonly Root[]} */
const NONE = [];

/** Test-only (no package entry exports it): the tables, for test/settle.fuzz.test.js to find leftovers. */
export const probe = { kids, watchers };

/** The live nested roots of `root` whose graphs run on this thread. @param {Root} root @returns {Iterable<Root>} */
export function nestedRoots(root) {
  return kids.get(root) ?? NONE;
}

/** Records `child`, nested in `parent`, until it ends, and tells who watches `parent`. @param {Root} parent @param {Root} child */
export function nested(parent, child) {
  let set = kids.get(parent);
  if (set === undefined) kids.set(parent, (set = new Set()));
  const own = set;
  own.add(child);
  $cleanup(child.home, () => void own.delete(child));
  const heard = watchers.get(parent);
  if (heard !== undefined) for (const fn of [...heard]) fn(child);
}

/** Calls `fn` with each nested root `root` gets from now; returns the stop. @param {Root} root @param {(child: Root) => void} fn */
export function watchNested(root, fn) {
  let set = watchers.get(root);
  if (set === undefined) watchers.set(root, (set = new Set()));
  const own = set;
  own.add(fn);
  return () => void own.delete(fn);
}
