// Text actions: an Edit's from its ref, a root's from any of its nodes; none
// for a worker's Handle.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { editOf, textAt, selectText, selectedText } from 'ren-core';
import { EDIT, TEXT } from 'ren-core/host';

/** A root holding text actions, and a node in it. */
const rooted = () => {
  const calls = [];
  const root = {
    [TEXT]: {
      at: e => (calls.push(['at', e.x]), e.x > 0 ? { node: label, text: 'hello' } : null),
      select: n => (calls.push(['select', n.id]), () => calls.push(['release', n.id])),
      selected: () => 'he',
    },
  };
  const label = { id: 'label', getRootNode: () => root };
  return { root, label, calls };
};

describe('text actions', () => {
  it("gives an Edit's actions from its ref, and null for anything else", () => {
    const actions = { value: () => 'typed' };
    assert.equal(editOf({ [EDIT]: actions }), actions);
    assert.equal(editOf({}), null);
    assert.equal(editOf(null), null);
    assert.equal(editOf({ id: 3, parent: 1 }), null, "a worker's Handle");
  });

  it("finds the text under a pointer event, opens selection on it and reads the selection, through its root's", () => {
    const { label, calls } = rooted();
    assert.deepEqual(textAt({ target: label, x: 4 }), { node: label, text: 'hello' });
    assert.equal(textAt({ target: label, x: 0 }), null, 'over no text');
    const release = selectText(label);
    assert.equal(typeof release, 'function');
    release?.();
    assert.equal(selectedText(label), 'he');
    assert.deepEqual(calls, [['at', 4], ['at', 0], ['select', 'label'], ['release', 'label']]);
  });

  it("reaches a DOM shadow root's document, where the renderer keeps them", () => {
    const { root } = rooted();
    const shadow = { host: { ownerDocument: root } };
    const inside = { getRootNode: () => shadow };
    assert.equal(selectedText(inside), 'he');
  });

  it("gives nothing for a worker's Handle or a renderer without them", () => {
    const handle = { id: 7 };
    assert.equal(textAt({ target: handle }), null);
    assert.equal(selectText(handle), null);
    assert.equal(selectedText(handle), '');
    const bare = { getRootNode: () => ({}) };
    assert.equal(textAt({ target: bare }), null);
  });
});
