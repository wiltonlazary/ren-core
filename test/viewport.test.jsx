// The viewport of an application root and media queries over it: the
// host's reports as reactive nodes, directly and in worker mode.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Root, $signal, $write, $read, $flush, $dispose, $stats, $viewport, $media, $keys, $scrolls, $moves, $resizes, Show, View } from 'ren-core';
import { mount } from 'ren-core/host';
import { serve } from 'ren-core/worker';
import { connect } from 'ren-core/remote';
import { Tree, text, find } from './fixtures/tree.js';
import { closeAfter } from './fixtures/after.js';

/**
 * A Tree host whose `panel` elements are regions with a viewport of their
 * own: a source per panel, found from any node inside it (placed or not:
 * the Tree records the parent each element was made for).
 * @param {ReturnType<typeof Tree>} H
 */
function Regions(H) {
  /** @type {Map<any, { view: number[], viewers: Set<(w: number, h: number, f: number) => void>, follows: number, viewport(report: (w: number, h: number, f: number) => void): () => void, resize(w: number, h: number): void }>} */
  const sources = new Map();
  /** @param {any} panel */
  const sourceOf = panel => {
    let source = sources.get(panel);
    if (source === undefined) {
      const viewers = new Set();
      source = {
        view: [300, 200, 0],
        viewers,
        follows: 0,
        viewport(report) {
          this.follows++;
          viewers.add(report);
          report(this.view[0], this.view[1], this.view[2]);
          return () => void viewers.delete(report);
        },
        resize(w, h) {
          this.view = [w, h, 0];
          for (const report of [...viewers]) report(w, h, 0);
        },
      };
      sources.set(panel, source);
    }
    return source;
  };
  /** @type {any} */ (H).viewportOf = (/** @type {any} */ node) => {
    for (let n = node; n != null; n = n.parent ?? n.into) if (n.tag === 'panel') return sourceOf(n);
    return null;
  };
  return sourceOf;
}

describe('ren-core $viewport and $media', () => {
  it("follows the host's viewport while a reader lives", () => {
    const H = Tree();
    const R = Root('main');
    const open = $signal(R, true);
    const Size = () => {
      const v = $viewport();
      return <View>{() => `${$read(v.width)}x${$read(v.height)}${$read(v.dark) ? ' dark' : ''}${$read(v.reduced) ? ' still' : ''}`}</View>;
    };
    const box = H.element('box', null);
    const dispose = mount(H, () => <View><Show when={open}><Size /></Show></View>, box, { root: R });
    assert.equal(text(box), '800x600');
    H.resize(375, 812, 3);
    assert.equal(text(box), '375x812 dark still');
    $write(open, false);
    assert.equal(H.viewers.size, 0, 'the host stops reporting after the last reader');
    dispose();
  });

  it('matches media queries as a browser reads them', () => {
    // [query, at 800 x 600 light with motion, at 375 x 812 dark with reduced motion].
    // A malformed query is `not all`: never a match. An unknown term stays unknown under `not`
    // unless a term known false decides the query (`and` is three-valued).
    /** @type {[string, boolean, boolean][]} */
    const table = [
      // Features: width and height (min-, max-, a range; px, em, rem), orientation, color scheme, motion.
      ['(min-width: 48em)', true, false],
      ['(max-width: 47.99em)', false, true],
      ['(min-width: 600px) and (max-height: 700px)', true, false],
      ['(orientation: portrait)', false, true],
      ['(orientation: landscape)', true, false],
      ['(prefers-color-scheme: dark)', false, true],
      ['(prefers-color-scheme: light)', true, false],
      ['(prefers-reduced-motion: reduce)', false, true],
      ['(min-width:0)', true, true],
      ['(MIN-WIDTH: 1PX)', true, true],
      ['( min-width : 1px )', true, true],
      ['(orientation: LANDSCAPE)', true, false],
      // Numbers take a sign and an exponent; case folds in ASCII only (U+212A, the Kelvin sign, is not k).
      ['(min-width: +1px)', true, true],
      ['(min-width: 1e1px)', true, true],
      ['(max-width: 1e3px)', true, true],
      ['(min-width: -1px)', true, true],
      ['(prefers-color-scheme: dar\u212A)', false, false],
      // An unclosed block closes at the end of the query.
      ['(min-width: 1px', true, true],
      ['not (min-width: 1px', false, false],
      ['(min-width: 1px, screen', false, false],
      // A stray `)` is a token of its own: it opens nothing, so a later block keeps its commas.
      ['), (x, screen, y)', false, false],
      ['), (x, print)', false, false],
      ['not print, )', true, true],
      // A feature without a value is boolean context.
      ['(prefers-reduced-motion)', false, true],
      ['(orientation)', true, true],
      ['(prefers-color-scheme)', true, true],
      ['(width)', true, true],
      // Lists, types, not and only.
      ['', true, true],
      ['   ', true, true],
      ['not (min-width: 48em)', false, true],
      ['print, (max-width: 400px)', false, true],
      ['print, (min-width: 1px)', true, true],
      ['not print, (min-width: 1px)', true, true],
      ['screen,', true, true],
      ['screen and (width >= 40rem)', true, false],
      ['SCREEN', true, true],
      ['SCREEN AND (MIN-WIDTH: 10PX)', true, true],
      ['all and (min-width: 1px) and (max-width: 2000px)', true, true],
      ['screen and not (min-width: 48em)', false, true],
      ['print and (min-width: 1px)', false, false],
      ['not print', true, true],
      ['not print2', true, true],
      ['not -x-foo', true, true],
      ['not\tprint', true, true],
      ['not\nprint', true, true],
      ['only\tscreen', true, true],
      ['not print and (min-width: 1px)', true, true],
      ['not screen and (max-width: 400px)', true, false],
      // Unknown features and invalid values: false, under not too.
      ['(hover: hover)', false, false],
      ['(min-width: 10)', false, false],
      ['not (hover: hover)', false, false],
      ['not (min-width: abc)', false, false],
      ['not (prefers-color-scheme: blue)', false, false],
      ['not (width >= abc)', false, false],
      ['not (orientation: sideways)', false, false],
      ['not (min-width)', false, false],
      ['not screen and (hover: hover)', false, false],
      // `and` is three-valued: a term known false decides it, unknown or not.
      ['not print and (hover: hover)', true, true],
      ['not print and not (hover: hover)', true, true],
      ['not screen and (max-width: 1px) and (hover: hover)', true, true],
      ['not screen and (min-width: 48em) and (hover: hover)', false, true],
      ['(max-width: 1px) and (hover: hover)', false, false],
      // Malformed: `not all`, whatever its not says.
      ['not screen (min-width: 1px)', false, false],
      ['not 12px', false, false],
      ['not screen and', false, false],
      ['only (min-width: 1px)', false, false],
      ['only', false, false],
      ['not only', false, false],
      ['not and', false, false],
      ['not not', false, false],
      ['not screen and print', false, false],
      ['not (max-width: 1px) and screen', false, false],
      ['not (max-width: 1px) and (max-width: 1px)', false, false],
      ['(min-width: 1px) and screen', false, false],
      ['screen and(min-width: 1px)', false, false],
      [',', false, false],
      // Not read: or and nested parentheses do not match.
      ['(min-width: 1px) or (max-width: 1px)', false, false],
      ['((min-width: 1px))', false, false],
    ];
    const H = Tree();
    const R = Root('main');
    const Probe = () => {
      const matches = table.map(([q]) => $media(q));
      return <View>{() => matches.map(m => ($read(m) ? '1' : '0')).join('')}</View>;
    };
    const box = H.element('box', null);
    const dispose = mount(H, () => <Probe />, box, { root: R });
    /** @param {1 | 2} at */
    const check = at => {
      const got = text(box);
      const wrong = table.filter((row, i) => (got[i] === '1') !== row[at]).map(row => row[0]);
      assert.deepEqual(wrong, [], `queries that read wrong at ${at === 1 ? '800x600 light' : '375x812 dark'}`);
    };
    check(1);
    H.resize(375, 812, 3);
    check(2);
    dispose();
  });

  it('keeps the root flat when a reader of a root-wide resource comes and goes', () => {
    // Each hook a component calls to follow something of its root: none may leave nodes behind.
    /** @type {[string, (node: any) => void][]} */
    const hooks = [
      ['$viewport', () => void $read($viewport().width)],
      ['$media', () => void $read($media('(min-width: 48em)'))],
      ['$keys', () => void $keys(() => {})],
      ['$scrolls', () => void $scrolls(() => {})],
      ['$moves', node => void $moves(node, () => {})],
      ['$resizes', node => void $resizes(node, () => {})],
    ];
    for (const [name, use] of hooks) {
      const H = Tree();
      const R = Root('main');
      const open = $signal(R, false);
      const target = H.element('box', null);
      const Reader = () => {
        use(target);
        return <View />;
      };
      const box = H.element('box', null);
      const dispose = mount(H, () => <View><Show when={open}><Reader /></Show></View>, box, { root: R });
      $write(open, true);
      $flush(R);
      $write(open, false);
      $flush(R);
      const nodes = $stats(R).nodes;
      for (let i = 0; i < 50; i++) {
        $write(open, true);
        $flush(R);
        $write(open, false);
        $flush(R);
      }
      assert.equal($stats(R).nodes, nodes, `${name}: the same nodes after 50 readers came and went`);
      assert.equal(H.viewers.size, 0, `${name}: the host follows nothing without a reader`);
      dispose();
    }
  });

  it("reads a region's own viewport where the Host gives one, one follow per region", () => {
    const H = Tree();
    const sourceOf = Regions(H);
    const R = Root('main');
    const open = $signal(R, true);
    const Size = () => {
      const v = $viewport();
      const wide = $media('(min-width: 500px)');
      return <View>{() => `${$read(v.width)}x${$read(v.height)} ${$read(wide) ? 'wide' : 'narrow'};`}</View>;
    };
    const box = H.element('box', null);
    const dispose = mount(H, () => (
      <View>
        <Size />
        <Show when={open}>
          <panel>
            <Size />
            <View><Size /></View>
          </panel>
        </Show>
      </View>
    ), box, { root: R });
    const panel = sourceOf(find(box, 'panel')[0]);
    assert.equal(text(box), '800x600 wide;300x200 narrow;300x200 narrow;');
    assert.equal(panel.follows, 1, 'one follow per region, whatever its readers');
    panel.resize(640, 480);
    assert.equal(text(box), '800x600 wide;640x480 wide;640x480 wide;');
    H.resize(375, 812);
    assert.equal(text(box), '375x812 narrow;640x480 wide;640x480 wide;', 'the root follows its own');
    $write(open, false);
    assert.equal(panel.viewers.size, 0, 'the region stops reporting after its last reader');
    assert.equal(H.viewers.size, 1, 'the root still has its reader');
    dispose();
    assert.equal(H.viewers.size, 0);
  });

  it("carries the main thread's viewport to the worker", { timeout: 30000 }, async t => {
    const H = Tree();
    H.resize(1024, 768);
    const box = H.element('box', null);
    const W = Root('app');
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    const App = () => {
      const wide = $media('(min-width: 62em)');
      const v = $viewport();
      return <View>{() => `${$read(v.width)} ${$read(wide) ? 'wide' : 'narrow'}`}</View>;
    };
    const session = serve(() => <App />, { port: port1, root: W });
    // The ports close after the test however it ends (the finally below would wait on a hung await).
    closeAfter(t, () => {
      port1.close();
      port2.close();
    });
    try {
      await connection.idle();
      assert.equal(text(box), '1024 wide', 'in place when the view builds');
      H.resize(640, 480);
      await connection.idle();
      assert.equal(text(box), '640 narrow');
    } finally {
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    }
    assert.equal(H.viewers.size, 0, 'the connection stops following');
  });

  it("carries a region's own viewport to the worker", { timeout: 30000 }, async t => {
    const H = Tree();
    const sourceOf = Regions(H);
    const box = H.element('box', null);
    const W = Root('app');
    const open = $signal(W, true);
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    const Size = () => {
      const v = $viewport();
      const wide = $media('(min-width: 500px)');
      return <View>{() => `${$read(v.width)}x${$read(v.height)} ${$read(wide) ? 'wide' : 'narrow'};`}</View>;
    };
    const session = serve(() => (
      <View>
        <Size />
        <Show when={open}>
          <panel>
            <Size />
            <View><Size /></View>
          </panel>
        </Show>
      </View>
    ), { port: port1, root: W });
    closeAfter(t, () => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    // The region's report crosses after the view's first message: one more round.
    await connection.idle();
    const panel = sourceOf(find(box, 'panel')[0]);
    assert.equal(text(box), '800x600 wide;300x200 narrow;300x200 narrow;');
    assert.equal(panel.follows, 2, 'one follow per node read in, on the main thread');
    panel.resize(640, 480);
    await connection.idle();
    assert.equal(text(box), '800x600 wide;640x480 wide;640x480 wide;');
    H.resize(375, 812);
    await connection.idle();
    assert.equal(text(box), '375x812 narrow;640x480 wide;640x480 wide;');
    $write(open, false);
    await connection.idle();
    assert.equal(panel.viewers.size, 0, 'the main thread stops following the region after its last reader');
  });
});
