// The first or last focusable inside a primitive: a canvas item's own
// methods, or the DOM elements Tab reaches below an element.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { $focus } from 'ren-core';
import { focusables } from 'ren-core/host';
import { closeAfter } from './fixtures/after.js';

describe('ren-core $focus', () => {
  it('focuses the first or last element Tab reaches inside a DOM element', t => {
    const window = new Window();
    // window.close() closes only a window a script opened: happy-dom's own close
    // frees this one, after the test however it ends.
    closeAfter(t, () => window.happyDOM.close());
    const document = window.document;
    const box = document.createElement('div');
    box.innerHTML = '<span>text</span><button id="off" disabled>x</button><input id="a"><div hidden><button id="hid">h</button></div><div tabindex="-1" id="out"></div><div inert><button id="inert">i</button><div tabindex="0" id="still"></div></div><div tabindex="0" id="region"></div><button id="b">b</button><input type="hidden" id="h" name="token">';
    document.body.appendChild(box);
    assert.deepEqual(focusables(box).map(el => el.id), ['a', 'region', 'b'], 'nothing in an inert region; a tabindex 0 region in the order');
    assert.equal($focus(box), true);
    assert.equal(document.activeElement?.id, 'a');
    assert.equal($focus(box, true), true);
    assert.equal(document.activeElement?.id, 'b');
    const empty = document.createElement('div');
    document.body.appendChild(empty);
    assert.equal($focus(empty), false, 'nothing inside to focus');
  });

  it('passes by what a disabled fieldset or a hidden visibility takes out, and stops at an editable element and a summary', t => {
    const window = new Window();
    closeAfter(t, () => window.happyDOM.close());
    const document = window.document;
    const box = document.createElement('div');
    box.innerHTML =
      // A disabled fieldset disables its controls, but not those in its first legend, nor a link or a tabindex stop.
      '<fieldset disabled><legend><input id="legend"></legend><legend><input id="second"></legend><input id="field"><button id="press">x</button><select id="pick"></select><textarea id="area"></textarea>' +
      '<fieldset><input id="deep"></fieldset><a href="#" id="link">a</a><div tabindex="0" id="stop"></div></fieldset>' +
      '<fieldset><legend><fieldset disabled><input id="inner"></fieldset></legend><input id="free"></fieldset>' +
      // Visibility hides what is below, unless one below shows itself again.
      '<div style="visibility: hidden"><button id="unseen">v</button><button id="seen" style="visibility: visible">v</button></div>' +
      '<div style="visibility: collapse"><input id="collapsed"></div>' +
      // An editable element and a details' first summary are stops with no tabindex.
      '<div contenteditable id="edit"></div><div contenteditable="true" id="edit2"></div><div contenteditable="FALSE" id="fixed"></div><div contenteditable tabindex="-1" id="skipped"></div>' +
      '<details><summary id="summary">s</summary><summary id="other">s</summary></details><summary id="loose">s</summary>';
    document.body.appendChild(box);
    assert.deepEqual(focusables(box).map(el => el.id), ['legend', 'link', 'stop', 'free', 'seen', 'edit', 'edit2', 'summary']);
    assert.equal($focus(box), true);
    assert.equal(document.activeElement?.id, 'legend');
  });

  it("asks a canvas item to focus its own, and does nothing for what has neither", () => {
    /** @type {string[]} */
    const calls = [];
    const item = { focusFirst: () => (calls.push('first'), true), focusLast: () => (calls.push('last'), false) };
    assert.equal($focus(item), true);
    assert.equal($focus(item, true), false);
    assert.deepEqual(calls, ['first', 'last']);
    assert.equal($focus({ id: 3 }), false, "a worker's Handle");
    assert.equal($focus(null), false);
    assert.deepEqual(focusables(null), []);
  });
});
