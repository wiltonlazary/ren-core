// Root-wide keys and scrolls: `$keys` and `$scrolls` hear every key and
// scroll of their application root through the host's `keys` and `scrolls`
// listeners on the view's container, directly and in worker mode; `$moves`
// hears a node's moves through its `move` listener, `$resizes` its sizes
// through its `resize` listener.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Root, $signal, $write, $read, $flush, $dispose, $owner, $active, $cleanups, $keys, $scrolls, $moves, $resizes, Show, View } from 'ren-core';
import { mount } from 'ren-core/host';
import { serve } from 'ren-core/worker';
import { connect } from 'ren-core/remote';
import { Tree, text, find } from './fixtures/tree.js';
import { closeAfter } from './fixtures/after.js';

describe('ren-core $keys', () => {
  it('hears the keys of the root through its container, while its owner lives', () => {
    const H = Tree();
    const R = Root('main');
    const open = $signal(R, true);
    const heard = $signal(R, '');
    const Launcher = () => {
      $keys(e => {
        if (e.ctrlKey && e.key === 'k') $write(heard, `${$read(heard)}K`);
      });
      return <View />;
    };
    const box = H.element('box', null);
    const dispose = mount(H, () => <View><Show when={open}><Launcher /></Show>{heard}</View>, box, { root: R });
    assert.equal(typeof box.on.keys, 'function', 'the container hears the root');
    box.on.keys({ key: 'k', ctrlKey: true });
    box.on.keys({ key: 'j', ctrlKey: true });
    assert.equal(text(box), 'K');
    $write(open, false);
    assert.equal(box.on.keys, undefined, 'removed with its owner');
    dispose();
  });

  it('needs a view being built or handling an event', () => {
    assert.throws(() => $keys(() => {}), /REN/);
  });

  it('hears the keys of the root in worker mode', { timeout: 30000 }, async t => {
    const H = Tree();
    const box = H.element('box', null);
    const W = Root('app');
    const last = $signal(W, '');
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    const App = () => {
      $keys(e => $write(last, `${e.editable ? 'field:' : ''}${e.ctrlKey ? 'ctrl+' : ''}${e.key}`));
      return <View>{last}</View>;
    };
    const session = serve(() => <App />, { port: port1, root: W });
    closeAfter(t, () => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    assert.equal(typeof box.on.keys, 'function', "the main thread's container hears the root");
    box.on.keys({ type: 'keydown', key: 'k', ctrlKey: true });
    await connection.idle();
    assert.equal(text(box), 'ctrl+k');
    box.on.keys({ type: 'keydown', key: 'a', editable: true });
    await connection.idle();
    assert.equal(text(box), 'field:a', 'whether the target is a text field crosses');
  });

  it("keeps a stopped event from the rest of its dispatch in worker mode: ancestors and the root's keys", { timeout: 30000 }, async t => {
    const H = Tree();
    const box = H.element('box', null);
    const W = Root('app');
    const log = $signal(W, '');
    const note = (/** @type {string} */ s) => $write(log, `${$read(log)}${s};`);
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    const App = () => {
      $keys(() => note('root'));
      return (
        <outer onClick={() => note('parent')}>
          <inner
            onClick={(/** @type {any} */ e) => {
              note('child');
              e.stopPropagation();
            }}
            onKey={(/** @type {any} */ e) => {
              note('focused');
              if (e.key === 'Escape') e.stopPropagation();
            }}
          />
          <p>{log}</p>
        </outer>
      );
    };
    const session = serve(() => <App />, { port: port1, root: W });
    closeAfter(t, () => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    const [outer] = find(box, 'outer');
    const [inner] = find(box, 'inner');
    // One dispatch reaches each listener on its way up with the same event.
    const click = { type: 'click' };
    inner.on.click(click);
    outer.on.click(click);
    await connection.idle();
    assert.equal($read(log), 'child;', 'the parent did not hear a click the child stopped');
    $write(log, '');
    for (const key of ['Escape', 'a']) {
      const down = { type: 'keydown', key };
      inner.on.key(down);
      box.on.keys(down);
    }
    await connection.idle();
    assert.equal($read(log), 'focused;focused;root;', "a key the focused item stopped does not reach the root's handlers");
  });
});

describe('ren-core $scrolls', () => {
  it('hears the scrolls of the root through its container, while its owner lives', () => {
    const H = Tree();
    const R = Root('main');
    const open = $signal(R, true);
    const heard = $signal(R, 0);
    const Popup = () => {
      $scrolls(e => {
        if (e.type === 'scroll') $write(heard, $read(heard) + 1);
      });
      return <View />;
    };
    const box = H.element('box', null);
    const dispose = mount(H, () => <View><Show when={open}><Popup /></Show>{heard}</View>, box, { root: R });
    assert.equal(typeof box.on.scrolls, 'function', 'the container hears the root');
    box.on.scrolls({ type: 'scroll', target: null });
    box.on.scrolls({ type: 'scroll', target: null });
    assert.equal(text(box), '2');
    $write(open, false);
    assert.equal(box.on.scrolls, undefined, 'removed with its owner');
    dispose();
  });

  it('needs a view being built or handling an event', () => {
    assert.throws(() => $scrolls(() => {}), /REN/);
  });

  it('hears the scrolls of the root in worker mode', { timeout: 30000 }, async t => {
    const H = Tree();
    const box = H.element('box', null);
    const W = Root('app');
    const count = $signal(W, 0);
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    const App = () => {
      $scrolls(() => $write(count, $read(count) + 1));
      return <View>{count}</View>;
    };
    const session = serve(() => <App />, { port: port1, root: W });
    closeAfter(t, () => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    assert.equal(typeof box.on.scrolls, 'function', "the main thread's container hears the root");
    box.on.scrolls({ type: 'scroll', target: null });
    await connection.idle();
    assert.equal(text(box), '1');
  });
});

describe('ren-core $moves', () => {
  it("hears a node's moves through the host's `move` listener on it, while its owner lives", () => {
    const H = Tree();
    const R = Root('main');
    const open = $signal(R, true);
    const heard = $signal(R, '');
    /** @type {any} */
    let target = null;
    const Popup = () => {
      $moves(target, e => {
        if (e.type === 'move') $write(heard, `${$read(heard)}${e.x},${e.y};`);
      });
      return <View />;
    };
    const box = H.element('box', null);
    const dispose = mount(H, () => <View><View ref={n => (target = n)} /><Show when={open}><Popup /></Show>{heard}</View>, box, { root: R });
    assert.equal(typeof target.on.move, 'function', 'the node hears its moves');
    target.on.move({ type: 'move', x: 4, y: 8, target });
    target.on.move({ type: 'move', x: 4, y: 20, target });
    assert.equal(text(box), '4,8;4,20;');
    $write(open, false);
    assert.equal(target.on.move, undefined, 'removed with its owner');
    dispose();
  });

  it('needs a view being built and a node of its host', () => {
    assert.throws(() => $moves({}, () => {}), /REN/);
    const H = Tree();
    const box = H.element('box', null);
    /** @type {any} */
    let error = null;
    const Bad = () => {
      try {
        $moves({ not: 'a node' }, () => {});
      } catch (e) {
        error = e;
      }
      return <View />;
    };
    const dispose = mount(H, () => <Bad />, box, { root: Root('main') });
    assert.match(String(error), /REN: \$moves needs a node/);
    dispose();
  });

  it("hears a node's moves in worker mode, the place crossing as x and y", { timeout: 30000 }, async t => {
    const H = Tree();
    const box = H.element('box', null);
    const W = Root('app');
    const last = $signal(W, '');
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    const App = () => {
      /** @type {any} */
      let target = null;
      const Follow = () => {
        $moves(target, e => $write(last, `${e.type} ${e.x},${e.y}`));
        return <View />;
      };
      return (
        <View>
          <View ref={n => (target = n)} />
          <Follow />
          {last}
        </View>
      );
    };
    const session = serve(() => <App />, { port: port1, root: W });
    closeAfter(t, () => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    const node = box.children[0].children[0];
    assert.equal(typeof node.on.move, 'function', "the main thread's node hears its moves");
    node.on.move({ type: 'move', x: 12, y: 30, target: node });
    await connection.idle();
    assert.equal(text(box), 'move 12,30');
  });
});

describe('ren-core $resizes', () => {
  it("hears a node's sizes through the host's `resize` listener on it, while its owner lives", () => {
    const H = Tree();
    const R = Root('main');
    const open = $signal(R, true);
    const heard = $signal(R, '');
    /** @type {any} */
    let target = null;
    const Indicator = () => {
      $resizes(target, e => {
        if (e.type === 'resize') $write(heard, `${$read(heard)}${e.width}x${e.height};`);
      });
      return <View />;
    };
    const box = H.element('box', null);
    const dispose = mount(H, () => <View><View ref={n => (target = n)} /><Show when={open}><Indicator /></Show>{heard}</View>, box, { root: R });
    assert.equal(typeof target.on.resize, 'function', 'the node hears its sizes');
    target.on.resize({ type: 'resize', width: 68, height: 30, target });
    target.on.resize({ type: 'resize', width: 72, height: 30, target });
    assert.equal(text(box), '68x30;72x30;');
    $write(open, false);
    assert.equal(target.on.resize, undefined, 'removed with its owner');
    assert.throws(() => $resizes(target, () => {}), /REN/);
    dispose();
  });

  it('follows an accessor of the node, listening to each node it gives', () => {
    const H = Tree();
    const R = Root('main');
    const heard = $signal(R, '');
    /** @type {any[]} */
    const nodes = [];
    const target = $signal(R, /** @type {any} */ (null));
    const Indicator = () => {
      $resizes(() => $read(target), e => $write(heard, `${$read(heard)}${e.width};`));
      return <View />;
    };
    const box = H.element('box', null);
    const dispose = mount(H, () => <View><View ref={n => nodes.push(n)} /><View ref={n => nodes.push(n)} /><Indicator />{heard}</View>, box, { root: R });
    $write(target, nodes[0]);
    assert.equal(typeof nodes[0].on.resize, 'function', 'the first node hears its sizes');
    nodes[0].on.resize({ type: 'resize', width: 1, height: 1, target: nodes[0] });
    $write(target, nodes[1]);
    assert.equal(nodes[0].on.resize, undefined, 'the first node is left');
    nodes[1].on.resize({ type: 'resize', width: 2, height: 1, target: nodes[1] });
    assert.equal(text(box), '1;2;');
    dispose();
    assert.equal(nodes[1].on.resize, undefined, 'removed with its owner');
  });

  it("hears a node's sizes in worker mode, the size crossing as width and height", { timeout: 30000 }, async t => {
    const H = Tree();
    const box = H.element('box', null);
    const W = Root('app');
    const last = $signal(W, '');
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    const App = () => {
      /** @type {any} */
      let target = null;
      const Follow = () => {
        $resizes(target, e => $write(last, `${e.type} ${e.width}x${e.height}`));
        return <View />;
      };
      return (
        <View>
          <View ref={n => (target = n)} />
          <Follow />
          {last}
        </View>
      );
    };
    const session = serve(() => <App />, { port: port1, root: W });
    closeAfter(t, () => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    const node = box.children[0].children[0];
    assert.equal(typeof node.on.resize, 'function', "the main thread's node hears its sizes");
    node.on.resize({ type: 'resize', width: 72, height: 30, target: node });
    await connection.idle();
    assert.equal(text(box), 'resize 72x30');
  });
});

describe('ren-core listeners and their owner', () => {
  it("leaves nothing on the owner when a listener goes before it: $resizes' changing target, a removal by hand", () => {
    const H = Tree();
    const R = Root('main');
    const box = H.element('box', null);
    /** @type {any} */
    let owner = null;
    /** @type {any} */
    let target = null;
    /** @type {Record<string, number>} */
    const counts = {};
    const Probe = () => {
      const root = $active();
      owner = $owner(root);
      target = $signal(root, H.element('box', null));
      $resizes(() => $read(target), () => {});
      const base = $cleanups(owner);
      const node = H.element('box', null);
      // Removed by hand, again and again: the owner keeps no cleanup for any of them.
      for (let i = 0; i < 100; i++) {
        $keys(() => {})();
        $scrolls(() => {})();
        $moves(node, () => {})();
      }
      counts.byHand = $cleanups(owner) - base;
      return <View />;
    };
    const dispose = mount(H, () => <View><Probe /></View>, box, { root: R });
    assert.equal(counts.byHand, 0, '$keys, $scrolls and $moves removed by hand');
    const before = $cleanups(owner);
    for (let i = 0; i < 100; i++) {
      $write(target, H.element('box', null));
      $flush(R);
    }
    assert.equal($cleanups(owner), before, "$resizes following 100 targets");
    dispose();
    $dispose(R);
  });
});
