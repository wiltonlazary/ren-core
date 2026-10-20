// A root's behavior: an app by default, a page as asked, and each switch over
// either one.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { behaviorOf } from 'ren-core/host';

const APP = { select: false, selectAll: false, textCursor: false, menu: false, editMenu: true, callout: false };
const PAGE = { select: true, selectAll: true, textCursor: true, menu: true, editMenu: true, callout: true };

describe('behaviorOf', () => {
  it('is an app when nothing says otherwise: the browser menu only in an Edit', () => {
    assert.deepEqual(behaviorOf(undefined), APP);
    assert.deepEqual(behaviorOf(null), APP);
    assert.deepEqual(behaviorOf('app'), APP);
    assert.deepEqual(behaviorOf({}), APP);
  });

  it('is a page as asked, in a word or as `like`', () => {
    assert.deepEqual(behaviorOf('page'), PAGE);
    assert.deepEqual(behaviorOf({ like: 'page' }), PAGE);
  });

  it("each switch overrides its own part over either `like`; the rest keep that `like`'s", () => {
    for (const [like, base] of /** @type {const} */ ([['app', APP], ['page', PAGE]])) {
      for (const key of Object.keys(base)) {
        const flipped = !base[/** @type {keyof typeof base} */ (key)];
        assert.deepEqual(behaviorOf({ like, [key]: flipped }), { ...base, [key]: flipped }, `${like} with ${key} ${flipped}`);
      }
    }
  });

  it('gives a new record each time, never its defaults themselves', () => {
    const one = behaviorOf('app');
    one.select = true;
    assert.equal(behaviorOf('app').select, false);
  });
});
