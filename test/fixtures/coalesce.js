// The model of worker-mode event coalescing, for the parity tests: which
// dispatches of a burst the worker hears, with what values. It follows the
// README's rule, not remote.js's code: the main thread forwards every listener
// of a dispatch (the stops run in the worker), one message per flush; in a
// message, a dispatch of superseded events whose records reach the same
// listeners in the same order as the dispatch right before it replaces that
// dispatch (the latest values; a wheel adds up its deltas, only with the same
// modifier keys and button). A dispatch of a frozen event has no number, so
// each of its records stands alone; a dispatch split by a flush is not
// replaced, nor replaces, in the message that continues it.

/** Superseded events: 1 keeps the latest, 2 adds up the deltas (wheel). @type {Record<string, number>} */
const KIND = { pointermove: 1, scroll: 1, scrolls: 1, wheel: 2 };

/** @param {any} init */
const modsOf = init => (init.shiftKey ? 1 : 0) | (init.ctrlKey ? 2 : 0) | (init.altKey ? 4 : 0) | (init.metaKey ? 8 : 0);
/** @param {any} init */
const buttonOf = init => (typeof init.button === 'number' ? init.button : -1);

/**
 * The dispatches the worker hears for one burst, to replay in direct mode.
 * `steps` are `{ path, init, frozen }` dispatches (`path` a list of
 * `[tag, name]`, each a listener the main thread forwards) and `{ flush: true }`
 * message ends; a dispatch's `split` (an index into its path) ends a message
 * before that listener. Returns dispatches as lists of `{ at, init }`
 * records, `at` a `[tag, name]`, each record with its own event values, and
 * whether the event was frozen (a stop cannot reach the rest).
 * @param {any[]} steps
 * @returns {{ records: { at: string[], init: any }[], frozen: boolean }[]}
 */
export function coalesced(steps) {
  /** Delivered groups, in order: a group is one dispatch's records in a row (one record for a frozen event). @type {any[]} */
  const delivered = [];
  /** The message's last two groups (indexes into `delivered`, -1 for none). */
  let previous = -1;
  let last = -1;
  /** The step whose records the previous message ended with. */
  let posted = /** @type {any} */ (null);
  let fresh = true;
  const close = () => {
    if (last < 0) return;
    const group = delivered[last];
    const before = previous >= 0 ? delivered[previous] : null;
    if (
      before !== null &&
      group.kind !== 0 &&
      before.kind === group.kind &&
      !before.continues &&
      !group.continues &&
      before.records.length === group.records.length &&
      before.records.every((/** @type {any} */ r, /** @type {number} */ k) => r.at.join(' ') === group.records[k].at.join(' ')) &&
      (group.kind !== 2 || (modsOf(before.init) === modsOf(group.init) && buttonOf(before.init) === buttonOf(group.init)))
    ) {
      const init = group.kind === 2 ? { ...group.init, deltaX: (before.init.deltaX ?? 0) + (group.init.deltaX ?? 0), deltaY: (before.init.deltaY ?? 0) + (group.init.deltaY ?? 0) } : group.init;
      delivered[previous] = { ...group, init, records: group.records.map((/** @type {any} */ r) => ({ at: r.at, init })) };
      delivered.length = last;
      last = -1;
      return;
    }
    previous = last;
    last = -1;
  };
  const flush = () => {
    close();
    if (delivered.length > 0 && !fresh) posted = delivered.at(-1).step;
    previous = -1;
    fresh = true;
  };
  for (const step of steps) {
    if (step.flush) {
      flush();
      continue;
    }
    for (let i = 0; i < step.path.length; i++) {
      if (i === step.split) flush();
      const at = step.path[i];
      const kind = KIND[at[1]] ?? 0;
      const current = last >= 0 ? delivered[last] : null;
      if (current === null || step.frozen || current.step !== step) {
        close();
        last = delivered.length;
        delivered.push({ step, init: step.init, kind, continues: fresh && !step.frozen && posted === step, records: [] });
      } else if (current.kind !== kind) current.kind = 0;
      fresh = false;
      delivered[last].records.push({ at, init: delivered[last].init });
    }
  }
  close();
  // A dispatch split across messages is heard as one: its stop reaches its later records.
  /** @type {{ records: { at: string[], init: any }[], frozen: boolean }[]} */
  const out = [];
  for (let g = 0; g < delivered.length; g++) {
    const group = delivered[g];
    const prior = g > 0 ? delivered[g - 1] : null;
    if (prior !== null && prior.step === group.step && !group.step.frozen) out.at(-1)?.records.push(...group.records);
    else out.push({ records: group.records.slice(), frozen: !!group.step.frozen });
  }
  return out;
}
