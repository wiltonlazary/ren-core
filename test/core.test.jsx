// The component layer with no renderer package: views, control flow,
// events, application roots, nested roots, background disposal and the
// worker runtime, all on the in-memory Tree host of test/fixtures.

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { $parts, $settle, $settled, $sweeper, Storage, Memory, $memo, $auto, $flush, $effect, $catch, $task, $pending, $keys, $defer, Portal, Recover, Root, $signal, $read, $write, $dispose, $cleanup, $lookup, Runtime, Props, Show, Choose, When, For, Times, $owner, $active, $surface, Edit, View, Label, Pending, Sequence } from 'ren-core';
import { mount } from 'ren-core/host';
import { serve } from 'ren-core/worker';
import { connect } from 'ren-core/remote';
import { Tree, text, find } from './fixtures/tree.js';
import { closeAfter } from './fixtures/after.js';
import { PROTOCOL } from '../src/port.js';

describe('ren-core without a renderer package', () => {
  it('renders components, control flow and reactive text into any Host', () => {
    const H = Tree();
    const R = Root('main');
    const items = $signal(R, ['a', 'b']);
    const open = $signal(R, true);
    const Item = (/** @type {{ name: string }} */ props) => <li>{props.name}</li>;
    const box = H.element('box', null);
    const dispose = mount(H, () => (
      <list>
        <For each={items}>{name => <Item name={name} />}</For>
        <Show when={open} fallback={<p>closed</p>}>
          <p>open {() => $read(items).length}</p>
        </Show>
      </list>
    ), box, { root: R });
    assert.equal(text(box), 'abopen 2');
    $write(items, ['c', 'a', 'b']);
    $write(open, false);
    assert.equal(text(box), 'cabclosed');
    assert.ok(H.presented > 0, 'the host presents after each flush');
    dispose();
    assert.equal(box.children.length, 0);
  });

  it('binds a ref that writes state in a For row as in a thunk child: keyed, by position, a static each, a row added later', () => {
    const H = Tree();
    const R = Root('main');
    /** A component whose ref writes a signal of its own, and shows what it holds. */
    const Anchored = () => {
      const anchor = $signal($active(), /** @type {any} */ (null));
      const node = $signal($active(), /** @type {any} */ (null));
      return (
        <p ref={(/** @type {any} */ n) => $write(anchor, n)}>
          <b ref={node} />
          {() => ($read(anchor) !== null && $read(node) !== null ? 'set' : 'unset')}
        </p>
      );
    };
    const items = $signal(R, [1]);
    const box = H.element('box', null);
    const dispose = mount(H, () => (
      <list>
        <For each={items}>{() => <Anchored />}</For>
        <For each={items} by="position">{() => <Anchored />}</For>
        <For each={[1]}>{() => <Anchored />}</For>
        {() => <Anchored />}
      </list>
    ), box, { root: R });
    $flush(R);
    assert.equal(text(box), 'setsetsetset');
    $write(items, [1, 2]);
    $flush(R);
    assert.equal(text(box), 'setsetsetsetsetset', 'rows added later bind theirs too');
    dispose();
  });

  it('gives the parts a child shows, reactively: For rows, a Show showing nothing skipped, accessors and nested arrays opened', () => {
    const H = Tree();
    const R = Root('main');
    const items = $signal(R, ['x', 'y']);
    const on = $signal(R, false);
    const more = $signal(R, false);
    /** @type {string[]} */
    const stopped = [];
    const Leaf = (/** @type {{ n: string }} */ p) => {
      $cleanup(/** @type {any} */ ($owner($active())), () => stopped.push(p.n));
      return <leaf>{p.n}</leaf>;
    };
    const Nothing = () => null;
    /** Its children with a separator between every two parts. @param {{ children?: any }} props */
    const Group = props => (
      <group>
        <For each={$parts(props.children)}>{(part, i) => [() => (i() > 0 ? <sep /> : null), part]}</For>
      </group>
    );
    const box = H.element('box', null, null);
    const dispose = mount(H, () => (
      <Group>
        <a />
        <For each={items}>{x => <row>{x}</row>}</For>
        <Show when={on}><shown /></Show>
        <Show when={on} fallback={null}>{() => <fn />}</Show>
        {() => ($read(more) ? [<m1 />, <Leaf n="m2" />] : null)}
        {[[<b />], 'text', <Nothing />, false, null]}
        <Leaf n="end" />
      </Group>
    ), box, { root: R });
    const tags = () => find(box, 'group')[0].children.filter((/** @type {any} */ c) => !c.tag.startsWith('#') || c.tag === '#text').map((/** @type {any} */ c) => (c.tag === '#text' ? c.text : c.tag));
    assert.deepEqual(tags(), ['a', 'sep', 'row', 'sep', 'row', 'sep', 'b', 'sep', 'text', 'sep', 'leaf'], 'a Show showing nothing, a component showing nothing, null and false are no parts');
    const a = find(box, 'a')[0];
    $write(on, true);
    assert.deepEqual(tags(), ['a', 'sep', 'row', 'sep', 'row', 'sep', 'shown', 'sep', 'fn', 'sep', 'b', 'sep', 'text', 'sep', 'leaf']);
    $write(items, ['y']);
    $write(more, true);
    assert.deepEqual(tags(), ['a', 'sep', 'row', 'sep', 'shown', 'sep', 'fn', 'sep', 'm1', 'sep', 'leaf', 'sep', 'b', 'sep', 'text', 'sep', 'leaf']);
    assert.equal(find(box, 'a')[0], a, 'a part that stays is the same node');
    $write(more, false);
    $write(on, false);
    assert.deepEqual(tags(), ['a', 'sep', 'row', 'sep', 'b', 'sep', 'text', 'sep', 'leaf']);
    assert.deepEqual(stopped, ['m2'], 'a part that leaves stops');
    dispose();
    assert.deepEqual(stopped, ['m2', 'end']);
  });

  it('gives the parts a child shows in worker mode too', { timeout: 30000 }, async t => {
    const H = Tree();
    const box = H.element('box', null, null);
    const W = Root('app');
    const items = $signal(W, ['x', 'y']);
    const on = $signal(W, false);
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    /** @param {{ children?: any }} props */
    const Group = props => <group><For each={$parts(props.children)}>{(part, i) => [() => (i() > 0 ? <sep /> : null), part]}</For></group>;
    const session = serve(() => (
      <Group>
        <a />
        <For each={items}>{x => <row>{x}</row>}</For>
        <Show when={on}><shown /></Show>
      </Group>
    ), { port: port1, root: W });
    closeAfter(t, () => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    const tags = () => find(box, 'group')[0].children.filter((/** @type {any} */ c) => !c.tag.startsWith('#')).map((/** @type {any} */ c) => c.tag);
    assert.deepEqual(tags(), ['a', 'sep', 'row', 'sep', 'row']);
    $write(on, true);
    $write(items, ['y']);
    await connection.idle();
    assert.deepEqual(tags(), ['a', 'sep', 'row', 'sep', 'shown']);
  });

  it("tells the Host's element the parent it goes into, for content built later too", () => {
    const H = Tree();
    const R = Root('main');
    const on = $signal(R, false);
    const items = $signal(R, [1]);
    const Leaf = (/** @type {{ n: number }} */ p) => <leaf n={p.n}><tip /></leaf>;
    const box = H.element('box', null, null);
    const layer = H.layer();
    const dispose = mount(H, () => (
      <outer>
        <Leaf n={0} />
        <mid>
          <Show when={on}><shown><Leaf n={1} /></shown></Show>
          <For each={items}>{n => <row><Leaf n={n} /></row>}</For>
        </mid>
        <solo><For each={items}>{n => <cell n={n} />}</For></solo>
        {() => ($read(on) ? <late><Leaf n={2} /></late> : null)}
        <Portal><portaled /></Portal>
      </outer>
    ), box, { root: R });
    $write(on, true);
    $write(items, [1, 2, 3]);
    /** @type {string[]} */
    const wrong = [];
    /** @param {any} n */
    const walk = n => {
      for (const c of n.children) {
        if (!c.tag.startsWith('#') && c.into !== n) wrong.push(`${c.tag} in ${n.tag} was told ${c.into?.tag ?? 'none'}`);
        walk(c);
      }
    };
    walk(box);
    walk(layer);
    assert.deepEqual(wrong, []);
    assert.equal(find(box, 'tip').length, 6, 'the content shown later is all there');
    assert.equal(find(layer, 'portaled').length, 1);
    dispose();
  });

  it('closes a portal with what its regions showed after it opened, and leaves the next portal in place', () => {
    const H = Tree();
    const R = Root('main');
    const open = $signal(R, true);
    const late = $signal(R, false);
    const items = $signal(R, /** @type {number[]} */ ([]));
    const box = H.element('box', null);
    const layer = H.layer();
    const dispose = mount(H, () => (
      <outer>
        <Show when={open}>
          <Portal>
            <Show when={late}><notice /></Show>
            <For each={items}>{n => <row n={n} />}</For>
          </Portal>
        </Show>
        <Portal><other /></Portal>
      </outer>
    ), box, { root: R });
    $write(late, true);
    $write(items, [1, 2]);
    assert.equal(find(layer, 'notice').length, 1);
    assert.equal(find(layer, 'row').length, 2);
    $write(open, false);
    assert.deepEqual(layer.children.map(c => c.tag), ['other'], 'the shown notice and rows went with their portal');
    $write(open, true);
    assert.equal(find(layer, 'notice').length, 1, 'opened again: shown once');
    dispose();
    assert.equal(layer.children.length, 0);
  });

  it("makes $parts' parts for the element the list goes into (an <a> under <svg>), for parts shown later too", () => {
    const H = Tree();
    const R = Root('main');
    const items = $signal(R, [1]);
    const more = $signal(R, false);
    // The parts go into the svg the component makes, not where the component is.
    const Wrap = (/** @type {{ children?: any }} */ props) => <svg><For each={$parts(props.children)}>{part => part}</For></svg>;
    const box = H.element('box', null, null);
    const dispose = mount(H, () => (
      <div>
        <Wrap>
          <a />
          <For each={items}>{n => <row n={n}><title /></row>}</For>
          <Show when={more}><late /></Show>
          {() => ($read(more) ? <c /> : null)}
        </Wrap>
      </div>
    ), box, { root: R });
    $write(items, [1, 2]);
    $write(more, true);
    /** @type {string[]} */
    const wrong = [];
    /** @param {any} n */
    const walk = n => {
      for (const c of n.children) {
        if (!c.tag.startsWith('#') && c.into !== n) wrong.push(`${c.tag} in ${n.tag} was told ${c.into?.tag ?? 'none'}`);
        walk(c);
      }
    };
    walk(box);
    assert.deepEqual(find(box, 'svg')[0].children.filter((/** @type {any} */ c) => !c.tag.startsWith('#')).map((/** @type {any} */ c) => c.tag), ['a', 'row', 'row', 'late', 'c']);
    assert.deepEqual(wrong, []);
    dispose();
  });

  it("tells the main thread's Host the parent of each element a worker makes", { timeout: 30000 }, async t => {
    const H = Tree();
    const box = H.element('box', null, null);
    const W = Root('app');
    const on = $signal(W, false);
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    const session = serve(() => <outer><mid><Show when={on}><shown><tip /></shown></Show></mid><For each={() => [1, 2]}>{() => <row><tip /></row>}</For></outer>, { port: port1, root: W });
    closeAfter(t, () => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    $write(on, true);
    await connection.idle();
    /** @type {string[]} */
    const wrong = [];
    /** @param {any} n */
    const walk = n => {
      for (const c of n.children) {
        if (!c.tag.startsWith('#') && c.into !== n) wrong.push(`${c.tag} in ${n.tag} was told ${c.into?.tag ?? 'none'}`);
        walk(c);
      }
    };
    walk(box);
    assert.equal(find(box, 'tip').length, 3);
    assert.deepEqual(wrong, []);
  });

  it('renders a BigInt as a child and as a prop, compiled or not', () => {
    const H = Tree();
    const R = Root('main');
    const box = H.element('box', null);
    const dispose = mount(H, () => <b data={10n} tone={0x1fn}>{10n}</b>, box, { root: R });
    const [b] = find(box, 'b');
    assert.equal(text(box), '10');
    assert.equal(b.props.data, 10n);
    assert.equal(b.props.tone, 31n);
    dispose();
  });

  it('takes a key as written: the last one wins, and a host never sees it', () => {
    const H = Tree();
    const R = Root('main');
    const box = H.element('box', null);
    const spread = { title: 't', key: 'spread' };
    /** @type {any[]} */
    const seen = [];
    const C = (/** @type {any} */ props) => {
      seen.push(props.key);
      return null;
    };
    const dispose = mount(
      H,
      () => (
        <>
          <div key="k" {...spread}>x</div>
          <C key="k" {...spread} />
          <C key="k" a="1" />
          <C {...spread} />
        </>
      ),
      box,
      { root: R },
    );
    assert.deepEqual(find(box, 'div')[0].props, { title: 't' }, 'a key never reaches the host');
    // A spread written after the key sets it last.
    assert.deepEqual(seen, ['spread', 'k', 'spread']);
    dispose();
  });

  it('renders Times over a count, and nothing for a count that is not a finite number', () => {
    /** @type {[any, string][]} */
    const rows = [
      [3, '012'],
      [2.7, '01'],
      [-1, ''],
      [Infinity, ''],
      [-Infinity, ''],
      [NaN, ''],
      ['x', ''],
      ['2', '01'],
    ];
    for (const [count, shown] of rows) {
      const H = Tree();
      const R = Root('main');
      const box = H.element('box', null);
      const dispose = mount(H, () => <View><Times count={count}>{i => String(i)}</Times></View>, box, { root: R });
      assert.equal(text(box), shown, `count ${String(count)}`);
      dispose();
    }
  });

  it("runs a Label run's onPress as the view's handlers run: a batch, failures to its boundary", () => {
    for (const reactive of [false, true]) {
      const H = Tree();
      const R = Root('main');
      const box = H.element('box', null);
      const a = $signal(R, 0);
      const b = $signal(R, 0);
      let runs = 0;
      $effect(R, () => {
        $read(a);
        $read(b);
        runs++;
      });
      const fail = $signal(R, false);
      const list = [
        { text: 'both', onPress: () => { $write(a, 1); $write(b, 1); } },
        { text: 'link', onPress: () => { if ($read(fail)) throw new Error('x'); } },
      ];
      const dispose = mount(H, () => <View><Recover fallback="failed"><Label runs={reactive ? () => list : list} /></Recover></View>, box, { root: R });
      $flush(R);
      const [label] = find(box, 'Label');
      const before = runs;
      label.props.runs[0].onPress({ type: 'press' });
      assert.equal(runs, before + 1, `${reactive ? 'reactive' : 'static'}: one flush for both writes (a batch)`);
      $write(fail, true);
      assert.doesNotThrow(() => find(box, 'Label')[0].props.runs[1].onPress({ type: 'press' }), 'the failure does not reach the host');
      assert.equal(text(box), 'failed', `${reactive ? 'reactive' : 'static'}: the Recover around it shows its fallback`);
      dispose();
    }
  });

  it('sets an element\'s props in source order, compiled or not', () => {
    const H = Tree();
    /** @type {Map<any, string[]>} */
    const order = new Map();
    const set = H.set;
    H.set = (n, name, value, previous) => {
      order.set(n, [...(order.get(n) ?? []), name]);
      set(n, name, value, previous);
    };
    const R = Root('main');
    const box = H.element('box', null);
    const h = $signal(R, '#x');
    const dispose = mount(
      H,
      () => (
        <main>
          <input valueAsNumber={5} type="number" />
          <a hash={h} href="https://a.example/">go</a>
          <p title={() => 't'} class="c" />
          <b class="c" title={() => 't'} />
        </main>
      ),
      box,
      { root: R },
    );
    const of = (/** @type {string} */ tag) => order.get(find(box, tag)[0]);
    assert.deepEqual(of('input'), ['valueAsNumber', 'type'], 'a literal after a dynamic prop comes after it');
    assert.deepEqual(of('a'), ['hash', 'href']);
    assert.deepEqual(of('p'), ['title', 'class']);
    assert.deepEqual(of('b'), ['class', 'title'], 'a literal ahead of every dynamic prop stays first');
    dispose();
  });

  it('sets on- and on-digit props as properties and binds only on + capital as an event, compiled or not', () => {
    const H = Tree();
    const box = H.element('box', null);
    const R = Root('main');
    const mode = 'm';
    let clicks = 0;
    const dispose = mount(
      H,
      () => (
        <main>
          <div on-state="lit" on-mode={mode} on1="one" onClick={() => clicks++} />
        </main>
      ),
      box,
      { root: R },
    );
    const [div] = find(box, 'div');
    assert.equal(div.props['on-state'], 'lit');
    assert.equal(div.props['on-mode'], 'm');
    assert.equal(div.props.on1, 'one');
    assert.deepEqual(Object.keys(div.on), ['click']);
    div.on.click({});
    assert.equal(clicks, 1);
    dispose();
    $dispose(R);
  });

  it('keeps JSX children beside a content prop, compiled or not', () => {
    // A host whose content props replace an element's children, as the DOM's do.
    const H = Tree();
    const set = H.set;
    H.set = (n, name, value, previous) => {
      // A select's selectedIndex reads its options as they are when it is set.
      if (name === 'selectedIndex') {
        const option = n.children[value];
        set(n, 'picked', option === undefined ? null : text(option), undefined);
        return;
      }
      // A select's value picks the option whose value (or text) matches, among those present then.
      if (name === 'value' && n.tag === 'select') {
        const option = n.children.find((/** @type {any} */ o) => (o.props.value ?? text(o)) === value);
        set(n, 'chosen', option === undefined ? null : option.props.value ?? text(option), undefined);
        return;
      }
      if (['textContent', 'innerText', 'innerHTML', 'text', 'value', 'defaultValue'].includes(name)) {
        for (const child of [...n.children]) H.remove(n, child);
        if (value != null && value !== '') H.insert(n, H.text(String(value)), null);
        return;
      }
      set(n, name, value, previous);
    };
    const R = Root('main');
    const box = H.element('box', null);
    const dispose = mount(
      H,
      () => (
        <main>
          <a href="/x" text="T">kid</a>
          <p textContent={null}>kid</p>
          <div innerText="I">kid</div>
          <textarea value="v">kid</textarea>
          <option text={() => 'o'}>kid</option>
          <section innerHTML="H">kid</section>
          <select selectedIndex={1}>
            <option>a</option>
            <option>b</option>
          </select>
          <select value="1">
            <option value={'0'}>1</option>
            <option value={'1'}>2</option>
          </select>
        </main>
      ),
      box,
      { root: R },
    );
    // The runtime sets props, then appends the children: both passes agree on that.
    assert.deepEqual(
      ['a', 'p', 'div', 'textarea', 'option', 'section'].map(tag => text(find(box, tag)[0])),
      ['Tkid', 'kid', 'Ikid', 'vkid', 'okid', 'Hkid'],
    );
    assert.equal(find(box, 'select')[0].props.picked, null, 'selectedIndex is set before the options join, as at runtime');
    assert.equal(find(box, 'select')[1].props.chosen, null, "a select's value is set before its options join, as at runtime");
    dispose();
  });

  it('names an unknown For by string instead of keying by it', () => {
    const H = Tree();
    const R = Root('main');
    const box = H.element('box', null);
    assert.throws(
      () => mount(H, () => <list><For each={['a']} by={/** @type {any} */ ('id')}>{name => <p>{name}</p>}</For></list>, box, { root: R }),
      /REN: unknown For by "id"/,
    );
    $dispose(R);
  });

  it('routes a host event to its handler, in a batch', () => {
    const H = Tree();
    const R = Root('main');
    const count = $signal(R, 0);
    const box = H.element('box', null);
    mount(H, () => <button onClick={() => $write(count, $read(count) + 1)}>{count}</button>, box, { root: R });
    const [button] = find(box, 'button');
    button.on.click({});
    button.on.click({});
    assert.equal(text(box), '2');
    $dispose(R);
  });

  it('returns from a handler that closes its own view and root', () => {
    const H = Tree();
    const box = H.element('box', null);
    /** @type {() => void} */
    let close = () => {};
    let clicks = 0;
    close = mount(H, () => <button onClick={() => { clicks++; close(); }}>x</button>, box);
    find(box, 'button')[0].on.click({});
    assert.equal(clicks, 1);
    assert.equal(box.children.length, 0, 'the view is gone');
  });

  it('hands a host its construct props at creation, compiled or not', () => {
    const H = Tree({ construct: new Set(['params']) });
    const R = Root('main');
    const size = 3;
    const box = H.element('box', null);
    mount(H, () => <scene><cube params={[size, 2]} tone="red" /></scene>, box, { root: R });
    const [cube] = find(box, 'cube');
    assert.deepEqual(cube.made, { params: [3, 2] }, 'element saw the params');
    assert.equal(cube.props.tone, 'red');
    $dispose(R);
  });

  it('starts an application root on a renderer with no document, and needs one', () => {
    const H = Tree();
    /** @type {any} */
    let seen = null;
    const Probe = () => {
      seen = { renderer: $lookup(Runtime).renderer, props: $lookup(Props) };
      return <p>{() => $lookup(Props)?.name}</p>;
    };
    const R = Root({ id: 'app', renderer: H, storage: null, locks: null, props: { name: 'tree' }, children: <Probe /> });
    assert.deepEqual(seen, { renderer: 'tree', props: { name: 'tree' } });
    $dispose(R);
    assert.equal(H.closed, true);
    assert.throws(() => Root({ id: 'bare', storage: null, locks: null, children: <p /> }), /a Root needs a renderer: \$dom\(document\) from ren-dom/);
  });

  it('nests a root through the parent host: its nest() by default, refused without one', () => {
    const outer = Tree();
    const R = Root({
      id: 'outer',
      renderer: outer,
      storage: null,
      locks: null,
      children: () => (
        <shell>
          <Root id="inner" storage={null} locks={null}>
            {() => <p>{() => $lookup(Runtime).renderer}</p>}
          </Root>
        </shell>
      ),
    });
    const [shell] = find(/** @type {any} */ (outer.container), 'shell');
    assert.equal(text(shell), 'tree', 'the inner root renders with a Tree of its own');
    $dispose(R);
    const flat = Tree({ nest: false });
    assert.throws(
      () => Root({ id: 'flat', renderer: flat, storage: null, locks: null, children: () => <Root id="inside" storage={null} locks={null}>{() => <p />}</Root> }),
      /a nested Root needs a parent renderer that holds root elements \(tree does not\)/,
    );
  });

  it('gives the root and host of the view being built, and only then', () => {
    const H = Tree();
    const R = Root('main');
    /** @type {any[]} */
    const seen = [];
    const Probe = () => {
      seen.push($active(), $surface());
      return <p>probe</p>;
    };
    const dispose = mount(H, () => <Probe />, H.element('box', null), { root: R });
    assert.deepEqual(seen, [R, H]);
    const outside = /^Error: REN: no view is being built; call it in a component \(under mount or Root\) or one of its handlers$/;
    assert.throws(() => $active(), outside);
    assert.throws(() => $surface(), outside);
    dispose();
    $dispose(R);
  });

  it('retires a large list at once and frees its rows in the background', async () => {
    const H = Tree();
    const R = Root('main');
    const rows = $signal(R, Array.from({ length: 50 }, (_, i) => i));
    let cleaned = 0;
    const Row = (/** @type {{ n: number }} */ props) => {
      $cleanup(/** @type {any} */ ($owner($active())), () => cleaned++);
      return <row>{props.n}</row>;
    };
    /** @type {(drain: any) => void} */
    let drained = () => {};
    const done = new Promise(resolve => (drained = resolve));
    const box = H.element('box', null);
    mount(H, () => <For each={rows}>{n => <Row n={n} />}</For>, box, { root: R, retire: 10, sweep: 'task', swept: drain => drained(drain) });
    assert.equal(find(box, 'row').length, 50);
    $write(rows, []);
    assert.equal(find(box, 'row').length, 0, 'the rows leave the host at once');
    assert.equal(cleaned, 0, 'their cleanups wait for the sweep');
    const drain = /** @type {any} */ (await done);
    assert.equal(cleaned, 50);
    assert.ok(drain.slices >= 1);
    $dispose(R);
  });

  it("shows a top-level Recover's fallback for a failure the view's own build heard", () => {
    const H = Tree();
    const R = Root('main');
    // A task that failed before the build: the binding that reads it fails as it is made.
    const t = $task(R, () => 1, (_, complete) => void complete({ ok: false, error: new Error('down') }));
    /** @type {string[]} */
    const heard = [];
    const box = H.element('box', null);
    const dispose = mount(H, () => (
      <Recover fallback={(/** @type {Error} */ error) => (heard.push(error.message), 'failed')}>
        <b>{() => $read(t)}</b>
      </Recover>
    ), box, { root: R });
    assert.deepEqual(heard, ['down']);
    assert.equal(text(box), 'failed');
    assert.equal(find(box, 'b').length, 0);
    dispose();
    $dispose(R);
  });

  it("closes what a large list's retired rows hold outside them (portals) at once under $parts, as a For does", async () => {
    const H = Tree();
    const R = Root('main');
    const rows = $signal(R, Array.from({ length: 50 }, (_, i) => i));
    let cleaned = 0;
    const Row = (/** @type {{ n: number }} */ props) => {
      $cleanup(/** @type {any} */ ($owner($active())), () => cleaned++);
      return [<row>{props.n}</row>, <Portal><pop /></Portal>];
    };
    // It shows how many parts there are: no list region of its own retires them.
    const Count = (/** @type {{ children?: any }} */ props) => {
      const parts = $parts(props.children);
      return <count>{() => $read(parts).length}</count>;
    };
    /** @type {(drain: any) => void} */
    let drained = () => {};
    const done = new Promise(resolve => (drained = resolve));
    const box = H.element('box', null);
    const dispose = mount(H, () => <Count><For each={rows}>{n => <Row n={n} />}</For></Count>, box, { root: R, retire: 10, sweep: 'task', swept: drain => drained(drain) });
    const pops = () => find(H.layer(), 'pop').length;
    assert.equal(text(box), '50');
    assert.equal(pops(), 50);
    $write(rows, $read(rows).slice(0, 5));
    assert.equal(text(box), '5');
    assert.equal(pops(), 5, 'a large removal closes the removed rows\' portals at once');
    assert.equal(cleaned, 0, 'the rows were retired: their cleanups wait for the sweep');
    $write(rows, Array.from({ length: 50 }, (_, i) => i));
    assert.equal(pops(), 50);
    $write(rows, []);
    assert.equal(text(box), '0');
    assert.equal(pops(), 0, 'a clear closes every row\'s portal at once');
    assert.equal(cleaned, 0);
    await done;
    dispose();
    $dispose(R);
  });

  it("leaves a root's sweeper as it was after a failed mount, so later retired rows are freed", { timeout: 10000 }, async () => {
    const Boom = () => {
      throw new Error('boom');
    };
    // A root with no sweeper of its own: the failed mount's pacing goes, and the next mount paces again.
    const H = Tree();
    const R = Root('main');
    assert.throws(() => mount(H, () => <Boom />, H.element('box', null), { root: R }), /boom/);
    assert.equal(R.sweeper, undefined, 'no sweeper left behind');
    const rows = $signal(R, Array.from({ length: 50 }, (_, i) => i));
    let cleaned = 0;
    const Row = (/** @type {{ n: number }} */ props) => {
      $cleanup(/** @type {any} */ ($owner($active())), () => cleaned++);
      return <row>{props.n}</row>;
    };
    /** @type {(drain: any) => void} */
    let drained = () => {};
    const done = new Promise(resolve => (drained = resolve));
    /** @type {any} */
    let timer;
    // timer: deadline, reports rows never freed instead of hanging the test.
    const late = new Promise(resolve => void (timer = setTimeout(() => resolve('never drained'), 3000)));
    const dispose = mount(H, () => <For each={rows}>{n => <Row n={n} />}</For>, H.element('box', null), { root: R, retire: 10, swept: drain => drained(drain) });
    $write(rows, []);
    const outcome = await Promise.race([done.then(() => 'drained'), late]);
    clearTimeout(timer);
    assert.equal(outcome, 'drained');
    assert.equal(cleaned, 50);
    dispose();
    $dispose(R);
    // A root with a sweeper of its own keeps it.
    const own = Root('own');
    const mine = () => {};
    $sweeper(own, mine);
    assert.throws(() => mount(H, () => <Boom />, H.element('box', null), { root: own, sweep: 'task' }), /boom/);
    assert.equal(own.sweeper, mine, 'its own sweeper stays');
    $dispose(own);
  });

  it('carries construct props from the worker to the host that makes the elements', { timeout: 30000 }, async t => {
    const H = Tree({ construct: new Set(['params']) });
    const box = H.element('box', null);
    const W = Root('app');
    const size = $signal(W, 3);
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    const session = serve(
      () => (
        <scene>
          <cube params={[$read(size), 2]} tone="red" />
          <For each={() => [1, 2]}>{n => <ball params={() => [n(), n() * 10]} />}</For>
        </scene>
      ),
      { port: port1, root: W, construct: ['params'] },
    );
    closeAfter(t, () => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    const [cube] = find(box, 'cube');
    assert.deepEqual(cube.made, { params: [3, 2] }, 'element saw the params made in the worker');
    assert.equal(cube.props.tone, 'red');
    assert.deepEqual(find(box, 'ball').map(b => b.made), [{ params: [1, 10] }, { params: [2, 20] }]);
  });

  it('runs the worker runtime against any Host', { timeout: 30000 }, async t => {
    const H = Tree();
    const box = H.element('box', null);
    const W = Root('app');
    const count = $signal(W, 1);
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    const session = serve(() => <button onClick={() => $write(count, $read(count) + 1)}>n{count}</button>, { port: port1, root: W });
    closeAfter(t, () => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    assert.equal(text(box), 'n1');
    find(box, 'button')[0].on.click({ type: 'click' });
    await connection.idle();
    assert.equal(text(box), 'n2');
  });

  it("carries a wheel's deltaMode to the worker, and adds up only wheels of one unit", { timeout: 30000 }, async t => {
    const H = Tree();
    const box = H.element('box', null);
    const W = Root('app');
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    /** @type {number[][]} */
    const seen = [];
    const session = serve(() => <pane onWheel={(/** @type {any} */ e) => void seen.push([e.deltaMode, e.deltaY])} />, { port: port1, root: W });
    closeAfter(t, () => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    const wheel = find(box, 'pane')[0].on.wheel;
    // One burst: two wheels in lines merge into one, a wheel in pixels after them stays apart.
    wheel({ type: 'wheel', deltaY: 1, deltaMode: 1 });
    wheel({ type: 'wheel', deltaY: 2, deltaMode: 1 });
    wheel({ type: 'wheel', deltaY: 40, deltaMode: 0 });
    await connection.idle();
    wheel({ type: 'wheel', deltaY: 1, deltaMode: 2 });
    await connection.idle();
    assert.deepEqual(seen, [[1, 3], [0, 40], [2, 1]]);
  });

  it('refuses a main thread of another wire version in the worker', () => {
    /** @type {any[]} */
    const sent = [];
    /** @type {any} */
    let listener = null;
    const port = { postMessage: (/** @type {any} */ m) => void sent.push(m), addEventListener: (/** @type {string} */ _t, /** @type {any} */ l) => void (listener = l), removeEventListener() {}, start() {} };
    let built = 0;
    const session = serve(() => (built++, <p>hi</p>), { port: /** @type {any} */ (port), id: 'main', locks: null });
    try {
      // A forged first message: ROOT with a wire version this side does not speak.
      assert.throws(() => listener({ data: [5, null, null, undefined, null, PROTOCOL + 1] }), new RegExp(`^Error: REN worker: the main thread speaks worker protocol ${PROTOCOL + 1}, this side ${PROTOCOL}`));
      assert.deepEqual(sent, [[7, PROTOCOL]], 'the main thread hears this side version');
      assert.equal(built, 0, 'no view builds');
      // One with no version at all, as a main thread before versions.
      assert.throws(() => listener({ data: [5, null, null, undefined, null] }), /REN worker: the main thread speaks worker protocol none/);
    } finally {
      session.close();
    }
    const good = serve(() => (built++, <p>hi</p>), { port: /** @type {any} */ (port), id: 'main', locks: null });
    try {
      listener({ data: [5, null, null, undefined, null, PROTOCOL] });
      assert.equal(built, 1, 'the same version builds');
    } finally {
      good.close();
    }
  });

  it('refuses a worker of another wire version on the main thread', () => {
    /** @type {any[]} */
    const sent = [];
    /** @type {any} */
    let listener = null;
    const port = () => ({ postMessage: (/** @type {any} */ m) => void sent.push(m), addEventListener: (/** @type {string} */ _t, /** @type {any} */ l) => void (listener = l), removeEventListener() {} });
    const H = Tree();
    const c = connect(/** @type {any} */ (port()), H, H.element('box', null), { schedule: 'now', mailbox: false });
    assert.equal(sent[0][0], 5, 'ROOT goes first');
    assert.equal(sent[0][5], PROTOCOL, 'with this side version');
    listener({ data: [7, PROTOCOL] });
    assert.equal(c.closed, false, 'the same version goes on');
    assert.throws(() => listener({ data: [7, PROTOCOL + 1] }), new RegExp(`^Error: REN remote: the worker speaks worker protocol ${PROTOCOL + 1}, this side ${PROTOCOL}`));
    assert.equal(c.closed, true, 'the connection closes');
    /** @type {any[]} */
    const errors = [];
    const d = connect(/** @type {any} */ (port()), H, H.element('box', null), { schedule: 'now', mailbox: false, error: e => errors.push(e) });
    listener({ data: [7, 'x'] });
    assert.equal(d.closed, true);
    assert.match(errors[0]?.message ?? '', /REN remote: the worker speaks worker protocol none/, "connect's error hears it");
  });

  it('runs a worker handler that disposes its own root without a failure', { timeout: 30000 }, async t => {
    const H = Tree();
    const box = H.element('box', null);
    const W = Root('app');
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    const session = serve(() => <button onClick={() => $dispose(W)}>x</button>, { port: port1, root: W });
    /** @type {any[]} */
    const failures = [];
    const failed = (/** @type {any} */ error) => void failures.push(error);
    process.on('uncaughtException', failed);
    closeAfter(t, () => {
      process.off('uncaughtException', failed);
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    find(box, 'button')[0].on.click({ type: 'click' });
    // The worker handles the click before the sync idle() sends after it.
    await connection.idle();
    assert.equal(W.closed, true);
    assert.deepEqual(failures.map(e => e.message), []);
  });

  it('keeps applying frames after a present throws', { timeout: 30000 }, async t => {
    const g = /** @type {any} */ (globalThis);
    const raf = g.requestAnimationFrame;
    const caf = g.cancelAnimationFrame;
    /** @type {(() => void)[]} */
    let frames = [];
    // Frames run when the test says, so a throwing one can be caught.
    g.requestAnimationFrame = (/** @type {() => void} */ f) => frames.push(f);
    g.cancelAnimationFrame = () => {};
    const H = Tree();
    let fail = false;
    const present = H.present;
    H.present = function () {
      if (fail) {
        fail = false;
        throw new Error('present failed once');
      }
      return present?.call(this);
    };
    const box = H.element('box', null);
    const W = Root('app');
    const count = $signal(W, 0);
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box);
    /** Resolves once a message waits for its frame. */
    const waiting = () =>
      new Promise(resolve => {
        const heard = () => {
          if (connection.pending.length === 0) return;
          port2.removeEventListener('message', heard);
          resolve(undefined);
        };
        port2.addEventListener('message', heard);
      });
    const frame = () => {
      const run = frames;
      frames = [];
      for (const f of run) f();
    };
    const session = serve(() => <View>{count}</View>, { port: port1, root: W });
    closeAfter(t, () => {
      g.requestAnimationFrame = raf;
      g.cancelAnimationFrame = caf;
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await waiting();
    frame();
    assert.equal(text(box), '0');
    fail = true;
    $write(count, 1);
    await waiting();
    assert.throws(frame, /present failed once/);
    $write(count, 2);
    await waiting();
    frame();
    assert.equal(text(box), '2', 'a later write applies');
    assert.equal(connection.pending.length, 0);
  });

  it('applies an urgent answer and settles idle() while a held message throws', { timeout: 30000 }, async t => {
    const g = /** @type {any} */ (globalThis);
    const raf = g.requestAnimationFrame;
    const caf = g.cancelAnimationFrame;
    // No frame runs: held messages apply only when an urgent answer or idle() drains them.
    g.requestAnimationFrame = () => 1;
    g.cancelAnimationFrame = () => {};
    const H = Tree();
    let fail = false;
    const present = H.present;
    H.present = function () {
      if (fail) {
        fail = false;
        throw new Error('present failed once');
      }
      return present?.call(this);
    };
    const box = H.element('box', null);
    const W = Root('app');
    const count = $signal(W, 0);
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box);
    /** @type {any[]} */
    const thrown = [];
    // A drain's failure is rethrown from the port's listener: kept here instead.
    const receive = connection.receive.bind(connection);
    connection.receive = (/** @type {any} */ data) => {
      try {
        receive(data);
      } catch (error) {
        thrown.push(error);
      }
    };
    /** Resolves once a message waits for its frame. */
    const held = () =>
      new Promise(resolve => {
        const heard = () => {
          if (connection.pending.length === 0) return;
          port2.removeEventListener('message', heard);
          resolve(undefined);
        };
        port2.addEventListener('message', heard);
      });
    const session = serve(() => <button onClick={() => $write(count, $read(count) + 10)}>n{count}</button>, { port: port1, root: W });
    closeAfter(t, () => {
      g.requestAnimationFrame = raf;
      g.cancelAnimationFrame = caf;
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    assert.equal(text(box), 'n0');
    // An urgent answer while a throwing message is held.
    fail = true;
    $write(count, 1);
    await held();
    const urgent = new Promise(resolve => port2.addEventListener('message', resolve, { once: true }));
    find(box, 'button')[0].on.click({ type: 'click' });
    await urgent;
    assert.equal(text(box), 'n11', 'the urgent answer applies');
    assert.deepEqual(thrown.map(e => e.message), ['present failed once'], 'and the failure is rethrown');
    // idle() while a throwing message is held.
    fail = true;
    $write(count, 12);
    await held();
    await connection.idle();
    assert.equal(text(box), 'n12');
    assert.equal(thrown.length, 2);
    $write(count, 13);
    await connection.idle();
    assert.equal(text(box), 'n13', 'the connection keeps going');
  });

  it('resolves idle() once what was sent before it is applied, through a storm of deferred work', { timeout: 30000 }, async t => {
    const H = Tree();
    const box = H.element('box', null);
    const W = Root('app');
    const tick = $signal(W, 0);
    const rows = Array.from({ length: 2000 }, (_, i) => i);
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    // A tight budget: each message carries a few deferred records, so a backlog stays.
    const session = serve(() => <list><For each={() => rows}>{i => <row n={() => $read(tick) + i()} />}</For></list>, { port: port1, root: W, budget: 0.01 });
    // The storm: every message the main thread receives brings new deferred work, so the deferred stream never empties.
    const storm = () => $defer(W, () => $write(tick, $read(tick) + 1));
    closeAfter(t, () => {
      port2.removeEventListener('message', storm);
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    assert.equal(find(box, 'row').length, 2000);
    port2.addEventListener('message', storm);
    storm();
    // Once a backlog stands, ask: idle() waits for what was sent before it, not for the storm to end.
    await new Promise(resolve => {
      const heard = () => {
        if (session.counters.backlog < 1000 || $read(tick) < 10) return;
        port2.removeEventListener('message', heard);
        resolve(undefined);
      };
      port2.addEventListener('message', heard);
    });
    const asked = $read(tick);
    await connection.idle();
    const first = Number(find(box, 'row')[0].props.n);
    assert.ok(first >= asked, `the row shows what was written before idle() (${first} >= ${asked})`);
  });

  it("answers input at once, ahead of a deferred backlog that reaches the same view", { timeout: 30000 }, async t => {
    const H = Tree();
    const box = H.element('box', null);
    const W = Root('app');
    const count = $signal(W, 0);
    const tick = $signal(W, 0);
    const rows = Array.from({ length: 2000 }, (_, i) => i);
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    // A tight budget: the deferred backlog takes many messages to publish.
    const session = serve(
      () => (
        <list>
          <button onClick={() => $write(count, $read(count) + 10)}>{count}</button>
          <For each={() => rows}>{i => <row n={() => $read(tick) + i()} />}</For>
        </list>
      ),
      { port: port1, root: W, budget: 0.01 },
    );
    closeAfter(t, () => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    // Deferred: the button's count and every row, a backlog.
    $defer(W, () => {
      $write(count, 1);
      $write(tick, 1);
    });
    await new Promise(resolve => port2.addEventListener('message', resolve, { once: true }));
    assert.ok(session.counters.backlog > 0, 'a deferred backlog stands');
    const [button] = find(box, 'button');
    // The backlog left when the click's count shows.
    const shown = new Promise(resolve => {
      const heard = () => {
        if (text(button) !== '11') return;
        port2.removeEventListener('message', heard);
        resolve(session.counters.backlog);
      };
      port2.addEventListener('message', heard);
    });
    button.on.click({ type: 'click' });
    assert.ok(/** @type {number} */ (await shown) > 0, 'the click is answered while the rows still wait');
  });

  it('refuses a message whose split names no record, instead of looping', { timeout: 5000 }, () => {
    /** @type {any} */
    let listener = null;
    const port = { postMessage() {}, addEventListener: (/** @type {string} */ _t, /** @type {any} */ l) => void (listener = l), removeEventListener() {} };
    const connection = connect(/** @type {any} */ (port), Tree(), {}, { schedule: 'now', mailbox: false });
    try {
      // The header [acked, flags (urgent), split, number], then one record: opcode 3 (two words), operand 0.
      const message = (/** @type {number} */ split) => [1, new Int32Array([0, 1, split, 1, 3, 0]).buffer, 6, null, 0, null, null, null];
      // Below the header: read from the first record.
      listener({ data: message(1) });
      assert.equal(connection.totals.messages, 1, 'a split below the header counts from the first record');
      // On an operand word of 0: no record starts there.
      assert.throws(() => listener({ data: message(5) }), /REN remote: bad split/);
    } finally {
      connection.close();
    }
  });

  it('posts nothing after close()', { timeout: 30000 }, async t => {
    const H = Tree();
    const box = H.element('box', null);
    const W = Root('app');
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    const session = serve(() => <View />, { port: port1, root: W });
    closeAfter(t, () => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    assert.equal(connection.post('open') > 0, true, 'a sequence number while open');
    connection.close();
    let sent = 0;
    const postMessage = port2.postMessage.bind(port2);
    port2.postMessage = (/** @type {any[]} */ ...args) => {
      sent++;
      postMessage(...args);
    };
    assert.equal(connection.post('closed'), 0, 'no sequence number once closed');
    assert.equal(sent, 0, 'nothing reaches the port');
  });

  it('carries a resize\'s border box to the worker', { timeout: 30000 }, async t => {
    const H = Tree();
    const box = H.element('box', null);
    const W = Root('app');
    const size = $signal(W, '');
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    const session = serve(() => <View onResize={(/** @type {any} */ e) => $write(size, `${e.width}x${e.height}`)}>{size}</View>, { port: port1, root: W });
    closeAfter(t, () => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    const [view] = find(box, 'View');
    view.on.resize({ type: 'resize', width: 120, height: 40, target: view });
    view.on.resize({ type: 'resize', width: 130, height: 44, target: view });
    await connection.idle();
    assert.equal(text(box), '130x44', 'the latest size of a burst');
  });

  /** A controlled Edit that takes lowercase letters only, turned into capitals by `upper`. */
  const Letters = (/** @type {{ v: any, upper?: boolean }} */ props) => (
    <Edit
      value={props.v}
      onChange={(/** @type {{ value: string }} */ e) => {
        if (props.upper) $write(props.v, e.value.toUpperCase());
        else if (/^[a-z]*$/.test(e.value)) $write(props.v, e.value);
      }}
    />
  );
  /** The user types `text` into a Tree Edit: the host shows it, then sends change. @param {any} edit @param {string} typed */
  const type = (edit, typed) => {
    edit.props.value = typed;
    edit.on.change({ value: typed });
  };

  it('shows a controlled Edit\'s bound value again after an edit the view did not adopt', () => {
    const H = Tree();
    const R = Root('main');
    const v = $signal(R, 'ab');
    const box = H.element('box', null);
    const dispose = mount(H, () => <Letters v={v} />, box, { root: R });
    const [edit] = find(box, 'Edit');
    type(edit, 'abc');
    assert.equal(edit.props.value, 'abc', 'an adopted edit stays');
    assert.equal($read(v), 'abc');
    const presented = H.presented;
    type(edit, 'abcX');
    assert.equal($read(v), 'abc');
    assert.equal(edit.props.value, 'abc', 'the rejected keystroke is gone');
    assert.ok(H.presented > presented, 'the host presents the value it shows again');
    type(edit, 'abcX');
    assert.equal(edit.props.value, 'abc', 'again, with the binding unchanged');
    dispose();
    // A value rewritten by the view (a mask) applies as it is.
    const u = $signal(R, '');
    const box2 = H.element('box', null);
    const dispose2 = mount(H, () => <Letters v={u} upper />, box2, { root: R });
    const [upper] = find(box2, 'Edit');
    type(upper, 'x');
    assert.equal(upper.props.value, 'X');
    type(upper, 'X');
    assert.equal(upper.props.value, 'X', 'the same value again: nothing to restore');
    dispose2();
    // Without a value binding the Edit is not controlled.
    const box3 = H.element('box', null);
    const dispose3 = mount(H, () => <Edit onChange={() => {}} />, box3, { root: R });
    const [free] = find(box3, 'Edit');
    type(free, 'anything');
    assert.equal(free.props.value, 'anything');
    dispose3();
    $dispose(R);
  });

  it('shows a controlled Edit\'s bound value again in worker mode', { timeout: 30000 }, async t => {
    const H = Tree();
    const box = H.element('box', null);
    const W = Root('app');
    const v = $signal(W, 'ab');
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    const session = serve(() => <Letters v={v} />, { port: port1, root: W });
    closeAfter(t, () => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    const [edit] = find(box, 'Edit');
    assert.equal(edit.props.value, 'ab');
    type(edit, 'abc');
    await connection.idle();
    assert.equal($read(v), 'abc');
    assert.equal(edit.props.value, 'abc');
    type(edit, 'abcX');
    await connection.idle();
    assert.equal($read(v), 'abc');
    assert.equal(edit.props.value, 'abc', 'the worker restored the bound value');
  });

  it('settles every idle() when the connection closes, and idle() after close at once', { timeout: 30000 }, async t => {
    const H = Tree();
    const box = H.element('box', null);
    const W = Root('app');
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    const session = serve(() => <b>x</b>, { port: port1, root: W });
    closeAfter(t, () => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    const before = connection.idle();
    connection.close();
    // Neither can settle from the worker any more: the connection stopped listening.
    /** @type {any} */
    let timer;
    // timer: deadline, fails the test instead of hanging it.
    const late = new Promise(resolve => void (timer = setTimeout(() => resolve('pending'), 1000)));
    const after = connection.idle();
    assert.equal(await Promise.race([Promise.all([before, after]).then(() => 'settled'), late]), 'settled');
    clearTimeout(timer);
  });

  it('builds nothing for a session disposed before the main thread connects', { timeout: 30000 }, async t => {
    for (const own of [false, true]) {
      const H = Tree();
      const box = H.element('box', null);
      const W = own ? null : Root('app');
      const { port1, port2 } = new MessageChannel();
      let built = 0;
      const App = () => {
        built++;
        return <View>hi</View>;
      };
      const session = serve(() => <App />, own ? { port: port1, id: 'app' } : { port: port1, root: W });
      session.dispose();
      // The worker has read the main thread's first message once this listener, added after its own, hears it.
      const heard = new Promise(resolve => port1.addEventListener('message', resolve, { once: true }));
      const connection = connect(port2, H, box, { schedule: 'now' });
      closeAfter(t, () => {
        connection.close();
        session.close();
        port1.close();
        port2.close();
        if (W !== null) $dispose(W);
      });
      await heard;
      assert.equal(built, 0, own ? 'its own root is disposed' : 'the given root builds no view');
      assert.equal(text(box), '');
    }
  });

  it("ends writes of one key made on both threads at once on the main thread's value, on both", { timeout: 30000 }, async t => {
    const { port1, port2 } = new MessageChannel();
    const W = Root('s');
    /** @type {any} */
    let inWorker = null;
    const session = serve(() => {
      inWorker = $lookup(Storage);
      return <View />;
    }, { port: port1, root: W });
    const backing = new Memory();
    const R = Root({ id: 's', runtime: 'worker', worker: port2, renderer: Tree(), storage: backing, locks: null, connect: { schedule: 'now' } });
    closeAfter(t, () => {
      $dispose(R);
      session.close();
      $dispose(W);
      port1.close();
      port2.close();
    });
    const connection = $lookup(R, Runtime).connection;
    await connection.idle();
    const onMain = $lookup(R, Storage);
    for (const [first, second] of [[inWorker, onMain], [onMain, inWorker]]) {
      // One task, both sides: each write crosses the other's on the way.
      first.set('k', first === onMain ? 'main' : 'worker');
      second.set('k', second === onMain ? 'main' : 'worker');
      await connection.idle();
      await connection.idle();
      assert.equal(inWorker.get('k'), onMain.get('k'), 'both threads hold one value');
      assert.equal(backing.getItem('ren:s:k'), onMain.get('k'));
    }
    // A clear crossing a write ends the same on both.
    inWorker.clear();
    onMain.set('k', 'again');
    await connection.idle();
    await connection.idle();
    assert.deepEqual(inWorker.keys(), onMain.keys());
  });

  it('gives a worker view no storage when its root has none (storage: null), as direct', { timeout: 30000 }, async t => {
    /** @type {any} */
    let direct;
    /** @type {any} */
    let inWorker;
    const D = Root({ id: 'd', renderer: Tree(), storage: null, locks: null, children: () => ((direct = $lookup(Storage)), <View />) });
    const { port1, port2 } = new MessageChannel();
    const W = Root('w');
    const session = serve(() => ((inWorker = $lookup(Storage)), <View />), { port: port1, root: W });
    const R = Root({ id: 'w', runtime: 'worker', worker: port2, renderer: Tree(), storage: null, locks: null, connect: { schedule: 'now' } });
    closeAfter(t, () => {
      $dispose(D);
      $dispose(R);
      session.close();
      $dispose(W);
      port1.close();
      port2.close();
    });
    await $lookup(R, Runtime).connection.idle();
    assert.equal(direct, null);
    assert.equal(inWorker, null, 'the worker view reads no storage either');
  });

  it('keeps a Sequence\'s order bounded and right while a Pending below it comes and goes', () => {
    const H = Tree();
    const R = Root('main');
    const box = H.element('box', null);
    const on = $signal(R, true);
    /** @type {((value: string) => void)[]} */
    const done = [];
    const tasks = [0, 1].map(i => $task(R, () => i, (_, complete) => void (done[i] = value => complete({ ok: true, value }))));
    /** The Sequence's order, found through the context layers (an internal). @type {any} */
    let order = null;
    const Probe = () => {
      for (let layer = $active().ctx; layer !== null && order === null; layer = layer.parent) if (Array.isArray(layer.value?.slots)) order = layer.value;
      return null;
    };
    mount(H, () => (
      <Sequence>
        <Probe />
        {tasks.map((t, i) => <Pending fallback={`w${i}`}><b>{() => $read(t)}</b></Pending>)}
        <Show when={on}><Pending fallback="w"><a>t</a></Pending></Show>
      </Sequence>
    ), box, { root: R });
    for (let i = 0; i < 200; i++) $write(on, i % 2 === 1);
    assert.ok(order !== null, 'the probe found the order');
    assert.ok(order.slots.length <= 3, `a Pending that left leaves the order (${order.slots.length} slots)`);
    assert.equal(text(box), 'w0w1w', 'the last one made waits for those before it');
    done[1]('b');
    assert.equal(text(box), 'w0w1w', 'the second waits for the first');
    done[0]('a');
    assert.equal(text(box), 'abt');
    $dispose(R);
  });

  it('settles once every task completes, and times out otherwise', async () => {
    const R = Root('main');
    const box = Tree().element('box', null);
    let done = false;
    // timer: feature, a task that stands for slow I/O.
    const slow = $task(R, () => 1, (_, complete) => void setTimeout(() => complete({ ok: true, value: 'late' }), 20));
    mount(Tree(), () => <p>{() => ($pending(slow) ? 'waiting' : $read(slow))}</p>, box, { root: R });
    const settled = $settle(R).then(() => void (done = true));
    assert.equal(done, false);
    await settled;
    assert.equal($read(slow), 'late', 'resolved after the task completed');
    const never = $task(R, () => 2, () => {});
    await assert.rejects($settle(R, { timeout: 30 }), /did not settle within 30 ms/);
    void never;
    await $settle(Root('empty'));
    $dispose(R);
  });
});

describe('$settle', () => {
  // The contract, case by case: see $settle's JSDoc and the README's
  // "Rendering once". Every case checks that nothing is left behind: the
  // root's handler is the one it had (or the one set meanwhile) and no timer
  // is live.
  const real = globalThis.setTimeout;

  /** Counts the timers started meanwhile that neither fired nor were cleared. */
  function timers() {
    /** @type {Set<any>} */
    const live = new Set();
    const [start, stop] = [globalThis.setTimeout, globalThis.clearTimeout];
    const set = mock.method(globalThis, 'setTimeout', (/** @type {any} */ fn, /** @type {any} */ ms) => {
      // timer: feature, the mock passes the timers under test through
      const id = start(() => {
        live.delete(id);
        fn();
      }, ms);
      live.add(id);
      return id;
    });
    const clear = mock.method(globalThis, 'clearTimeout', (/** @type {any} */ id) => {
      live.delete(id);
      stop(id);
    });
    return {
      live,
      restore() {
        set.mock.restore();
        clear.mock.restore();
        for (const id of live) stop(id);
      },
    };
  }

  /** How a promise ends, or 'pending' if it has not within `ms`. @param {Promise<any>} p */
  function outcome(p, ms = 300) {
    return Promise.race([
      p.then(
        () => 'resolved',
        (/** @type {any} */ e) => `rejected: ${e.message}`,
      ),
      // timer: deadline, reports a settle that never ends instead of hanging the suite.
      new Promise(done => void real(() => done('pending'), ms)),
    ]);
  }

  /** An auto-flushing root, with `own` as its handler, and a task the test completes by hand. @param {any} own */
  function setup(own, name = 'settle') {
    const R = Root(name);
    $auto(R, true);
    if (own) $catch(R, own);
    let complete = (/** @type {any} */ _) => {};
    const task = $task(R, () => 1, (_, done) => void (complete = done));
    $effect(R, () => void $pending(task));
    return { R, task, finish: () => complete({ ok: true, value: 5 }) };
  }

  /** @param {any} R @param {any} own @param {{ live: Set<any> }} clock */
  function clean(R, own, clock) {
    assert.equal(R.errorHandler, own, 'the handler it had, nothing of the settle');
    assert.equal(clock.live.size, 0, 'no timer left');
    assert.equal(R.settled.length, 0, 'no $settled callback left');
  }

  const owns = () => [null, (/** @type {any} */ _) => {}];

  it('resolves once the tasks settle', async () => {
    for (const own of owns()) {
      const clock = timers();
      try {
        const { R, finish } = setup(own);
        const p = $settle(R, { timeout: 500 });
        queueMicrotask(finish);
        assert.equal(await outcome(p), 'resolved');
        clean(R, own, clock);
        $dispose(R);
      } finally {
        clock.restore();
      }
    }
  });

  it('waits for the tasks of the nested roots the view started', async () => {
    // [case, what ends first, what ends last, the outcome]
    /** @type {[string, 'none' | 'outer' | 'inner', 'outer' | 'inner' | 'fail' | 'hide', string][]} */
    const rows = [
      ['inner only', 'none', 'inner', 'resolved'],
      ['inner slower than outer', 'outer', 'inner', 'resolved'],
      ['outer slower than inner', 'inner', 'outer', 'resolved'],
      ['inner fails', 'outer', 'fail', 'rejected: inner down'],
      ['inner removed while it waits', 'outer', 'hide', 'resolved'],
    ];
    for (const [name, first, last, end] of rows) {
      const clock = timers();
      try {
        /** @type {Record<string, (result: any) => void>} */
        const complete = {};
        /** @type {any} */
        let inner = null;
        const Inner = () => {
          inner = $active();
          const t = $task(inner, () => 1, (_, done) => void (complete.inner = done));
          return <p>{() => String($read(t) ?? '')}</p>;
        };
        let shown = /** @type {any} */ (null);
        const R = Root({
          id: 'outer',
          renderer: Tree(),
          storage: null,
          locks: null,
          children: () => {
            const o = first === 'none' ? null : $task($active(), () => 1, (_, done) => void (complete.outer = done));
            shown = $signal($active(), true);
            return (
              <shell>
                <Show when={shown}>
                  <Root id="inner" storage={null} locks={null}>{() => <Inner />}</Root>
                </Show>
                <b>{() => (o === null ? 'outer' : String($read(o) ?? ''))}</b>
              </shell>
            );
          },
        });
        const ends = {
          none: () => {},
          outer: () => complete.outer({ ok: true, value: 'outer-done' }),
          inner: () => complete.inner({ ok: true, value: 'inner-done' }),
          fail: () => complete.inner({ ok: false, error: new Error('inner down') }),
          hide: () => $write(shown, false),
        };
        const p = $settle(R, { timeout: 500 });
        ends[first]();
        assert.equal(await outcome(p, 30), 'pending', `${name}: waits for ${last}`);
        ends[last]();
        assert.equal(await outcome(p), end, name);
        assert.equal(clock.live.size, 0, `${name}: no timer left`);
        if (inner !== null && !inner.closed) assert.equal(inner.errorHandler, null, `${name}: the inner root's handler is back`);
        $dispose(R);
      } finally {
        clock.restore();
      }
    }
  });

  it('ends right when a root of the tree is disposed after its part was in', async () => {
    // [case, what is disposed, the outcome]
    /** @type {[string, 'outer' | 'inner' | 'hide', string][]} */
    const rows = [
      ['the outer root, an inner one still waiting', 'outer', 'rejected: REN: the root "outer" was disposed before it settled'],
      ['the inner root, by its own dispose', 'inner', 'pending'],
      ['the inner root, removed from the view', 'hide', 'pending'],
    ];
    for (const [name, what, end] of rows) {
      const clock = timers();
      try {
        /** @type {Record<string, (result: any) => void>} */
        const done = {};
        /** @type {any} */
        let inner = null;
        /** @type {any} */
        let shown = null;
        const Inner = () => {
          inner = $active();
          const t = $task(inner, () => 1, (_, d) => void (done.inner = d));
          return <p>{() => String($read(t) ?? '')}</p>;
        };
        const R = Root({
          id: 'outer',
          renderer: Tree(),
          storage: null,
          locks: null,
          children: () => {
            shown = $signal($active(), true);
            const t = $task($active(), () => 1, (_, d) => void (done.outer = d));
            const u = $task($active(), () => 1, (_, d) => void (done.later = d));
            return (
              <shell>
                <Show when={shown}>
                  <Root id="inner" storage={null} locks={null}>{() => <Inner />}</Root>
                </Show>
                <b>{() => String($read(t) ?? '') + String($read(u) ?? '')}</b>
              </shell>
            );
          },
        });
        const p = $settle(R, { timeout: 500 });
        done.outer({ ok: true, value: 1 });
        if (what !== 'outer') done.later({ ok: true, value: 2 });
        assert.equal(await outcome(p, 20), 'pending', `${name}: waits`);
        const gone = inner;
        if (what === 'outer') {
          done.later({ ok: true, value: 2 });
          $dispose(R);
        } else if (what === 'inner') $dispose(inner);
        else $write(shown, false);
        // The outer root rejects; with the inner one gone, the outer (no task left) resolves.
        assert.equal(await outcome(p), end === 'pending' ? 'resolved' : end, name);
        assert.equal(gone.settled.length, 0, `${name}: no $settled callback left on the disposed root`);
        assert.equal(gone.errorHandler, null, `${name}: no handler left on the disposed root`);
        assert.equal(clock.live.size, 0, `${name}: no timer left`);
        $dispose(R);
      } finally {
        clock.restore();
      }
    }
  });

  it("holds every root's boundary until the whole settle ends", async () => {
    // A failure in any root of the tree while the settle still waits rejects it,
    // whatever part of the pass that root had already given.
    /** @type {[string, string[], string][]} */
    const rows = [
      ['a nested root fails after its own part was in', ['a', 'start inner', 'inner fails', 'c'], 'rejected: inner down'],
      ['a nested root rendered mid-pass fails', ['show inner', 'inner fails', 'c'], 'rejected: inner down'],
      ['the outer fails after its part was in, an inner one still waiting', ['a', 'c', 'outer fails', 'inner ends'], 'rejected: outer down'],
    ];
    for (const [name, steps, end] of rows) {
      const clock = timers();
      try {
        /** @type {Record<string, (result: any) => void>} */
        const complete = {};
        /** @type {any} */
        let n = null;
        /** @type {any} */
        let shown = null;
        /** @type {any} */
        let boom = null;
        const Inner = () => {
          const t = $task($active(), () => $lookup(Props), (v, done) => {
            // In the first row the inner root settles at once, and starts a task only once `n` moves.
            if (v > 0 || !name.startsWith('a nested root fails after')) complete.inner = done;
            else done({ ok: true, value: 0 });
          });
          return <p>{() => String($read(t) ?? '')}</p>;
        };
        const R = Root({
          id: 'outer',
          renderer: Tree(),
          storage: null,
          locks: null,
          children: () => {
            const R = $active();
            n = $signal(R, 0);
            shown = $signal(R, !name.includes('mid-pass'));
            boom = $signal(R, false);
            $effect(R, () => {
              if ($read(boom)) throw new Error('outer down');
            });
            const a = name.includes('mid-pass') ? null : $task(R, () => 1, (_, done) => void (complete.a = done));
            const c = $task(R, () => 1, (_, done) => void (complete.c = done));
            return (
              <shell>
                <Show when={shown}>
                  <Root id="inner" storage={null} locks={null} props={n}>{() => <Inner />}</Root>
                </Show>
                <b>{() => String(a === null ? '' : ($read(a) ?? '')) + String($read(c) ?? '')}</b>
              </shell>
            );
          },
        });
        /** @type {Record<string, () => void>} */
        const act = {
          a: () => complete.a({ ok: true, value: 'A' }),
          c: () => complete.c({ ok: true, value: 'C' }),
          'start inner': () => $write(n, 1),
          'show inner': () => $write(shown, true),
          'inner fails': () => complete.inner({ ok: false, error: new Error('inner down') }),
          'inner ends': () => complete.inner({ ok: true, value: 'I' }),
          'outer fails': () => $write(boom, true),
        };
        /** @type {string[]} */
        const thrown = [];
        const p = $settle(R, { timeout: 500 });
        for (let i = 0; i < steps.length; i++) {
          // Pending until a step failed a root, then ended with that failure.
          const failed = steps.slice(0, i).some(step => step.endsWith('fails'));
          assert.equal(await outcome(p, 20), failed ? end : 'pending', `${name}: before ${steps[i]}`);
          try {
            act[steps[i]]();
          } catch (error) {
            thrown.push(`${steps[i]}: ${/** @type {any} */ (error).message}`);
          }
        }
        assert.equal(await outcome(p), end, name);
        assert.deepEqual(thrown, [], `${name}: nothing thrown at the step that failed`);
        assert.equal(clock.live.size, 0, `${name}: no timer left`);
        $dispose(R);
      } finally {
        clock.restore();
      }
    }
  });

  it('offers a failure while waiting to the previous handler, and rejects with what it leaves unhandled', async () => {
    /** @type {string[]} */
    let seen = [];
    const rows = [
      { name: 'no previous handler', own: null, end: 'rejected: boom', seen: [] },
      { name: 'a previous handler that rethrows', own: (/** @type {any} */ e) => { seen.push(e.message); throw e; }, end: 'rejected: boom', seen: ['boom'] },
      { name: 'a previous handler that throws another', own: (/** @type {any} */ e) => { seen.push(e.message); throw new Error('wrapped'); }, end: 'rejected: wrapped', seen: ['boom'] },
      { name: 'a previous handler that handles it', own: (/** @type {any} */ e) => void seen.push(e.message), end: 'resolved', seen: ['boom'] },
    ];
    for (const row of rows) {
      seen = [];
      const clock = timers();
      try {
        const { R, task, finish } = setup(row.own);
        $effect(R, () => {
          if (!$pending(task) && $read(task) === 5) throw new Error('boom');
        });
        const p = $settle(R, { timeout: 500 });
        queueMicrotask(finish);
        assert.equal(await outcome(p), row.end, row.name);
        assert.deepEqual(seen, row.seen, row.name);
        clean(R, row.own, clock);
        $dispose(R);
      } finally {
        clock.restore();
      }
    }
  });

  it('rejects every overlapping settle with a failure left unhandled', async () => {
    const clock = timers();
    try {
      const { R, task, finish } = setup(null);
      $effect(R, () => {
        if (!$pending(task) && $read(task) === 5) throw new Error('boom');
      });
      const all = [$settle(R, { timeout: 500 }), $settle(R, { timeout: 500 }), $settle(R, { timeout: 500 })];
      queueMicrotask(finish);
      assert.deepEqual(await Promise.all(all.map(p => outcome(p))), ['rejected: boom', 'rejected: boom', 'rejected: boom']);
      clean(R, null, clock);
      $dispose(R);
    } finally {
      clock.restore();
    }
  });

  it('restores the original handler after overlapping settles end in either order', async () => {
    for (const n of [2, 3])
      for (const order of ['first', 'last'])
        for (const own of owns()) {
          const name = `${n} settles, the ${order} ends first, ${own ? 'a' : 'no'} handler`;
          const clock = timers();
          try {
            const { R } = setup(own);
            const all = Array.from({ length: n }, (_, i) => $settle(R, { timeout: 20 * (order === 'first' ? i + 1 : n - i) }));
            const ends = all.map(p => outcome(p, 1000));
            await (order === 'first' ? ends[0] : ends[n - 1]);
            assert.notEqual(R.errorHandler, own, `${name}: still the boundary while one waits`);
            for (const end of await Promise.all(ends)) assert.match(end, /did not settle within/, name);
            clean(R, own, clock);
            // A later failure is not swallowed: it reaches the handler, or throws from its flush.
            const seen = /** @type {any[]} */ ([]);
            if (own) $catch(R, (/** @type {any} */ e) => void seen.push(e.message));
            const s = $signal(R, 0);
            $effect(R, () => {
              if ($read(s) === 1) throw new Error('later');
            });
            if (own) {
              $write(s, 1);
              assert.deepEqual(seen, ['later'], name);
            } else assert.throws(() => $write(s, 1), /later/, name);
            $dispose(R);
          } finally {
            clock.restore();
          }
        }
  });

  it('keeps a handler set while it waits, and lets it take the failures', async () => {
    for (const later of [false, true]) {
      const clock = timers();
      try {
        const { R, task, finish } = setup(null);
        $effect(R, () => {
          if (!$pending(task) && $read(task) === 5) throw new Error('boom');
        });
        const all = [$settle(R, { timeout: 500 })];
        /** @type {string[]} */
        const seen = [];
        const own = (/** @type {any} */ e) => void seen.push(e.message);
        $catch(R, own);
        // A settle that starts after the handler was set, while the first still waits.
        if (later) all.push($settle(R, { timeout: 500 }));
        queueMicrotask(finish);
        assert.deepEqual(await Promise.all(all.map(p => outcome(p))), all.map(() => 'resolved'));
        assert.deepEqual(seen, ['boom']);
        clean(R, own, clock);
        $dispose(R);
      } finally {
        clock.restore();
      }
    }
  });

  it('ends its boundary role once a $catch is set while it waits', async () => {
    // The handler set meanwhile takes the failures; one it leaves unhandled
    // is raised by the flush that met it. A settle started after it has a
    // boundary of its own over it.
    const rethrow = (/** @type {any} */ e) => {
      throw e;
    };
    const rows = [
      { name: 'a handler that rethrows', own: rethrow, later: false, ends: ['resolved'], raised: true },
      { name: 'no handler ($catch(root, null))', own: null, later: false, ends: ['resolved'], raised: true },
      { name: 'a handler that rethrows, a settle after it', own: rethrow, later: true, ends: ['resolved', 'rejected: boom'], raised: false },
    ];
    for (const row of rows) {
      const clock = timers();
      try {
        const { R, task, finish } = setup(null);
        $effect(R, () => {
          if (!$pending(task) && $read(task) === 5) throw new Error('boom');
        });
        const all = [$settle(R, { timeout: 500 })];
        $catch(R, row.own);
        if (row.later) all.push($settle(R, { timeout: 500 }));
        // The completion flushes at once: a failure raised is thrown here.
        if (row.raised) assert.throws(finish, /boom/, row.name);
        else finish();
        assert.deepEqual(await Promise.all(all.map(p => outcome(p))), row.ends, row.name);
        clean(R, row.own, clock);
        $dispose(R);
      } finally {
        clock.restore();
      }
    }
  });

  it('settles when called from a $settled callback', async () => {
    const clock = timers();
    try {
      const R = Root('nested');
      $auto(R, true);
      /** @type {Promise<void> | null} */
      let p = null;
      $settled(R, () => void (p = $settle(R, { timeout: 200 })));
      $flush(R);
      assert.ok(p);
      assert.equal(await outcome(/** @type {any} */ (p), 400), 'resolved');
      clean(R, null, clock);
      $dispose(R);
    } finally {
      clock.restore();
    }
  });

  it('waits forever with a timeout past the timer range', async () => {
    for (const timeout of [Infinity, 2 ** 31]) {
      const clock = timers();
      try {
        const { R, finish } = setup(null);
        const p = $settle(R, { timeout });
        assert.equal(clock.live.size, 0, `${timeout}: no deadline timer`);
        finish();
        assert.equal(await outcome(p), 'resolved', `${timeout}`);
        clean(R, null, clock);
        $dispose(R);
      } finally {
        clock.restore();
      }
    }
  });

  it('keeps one dispose cleanup per root, however many settles it saw', async () => {
    const R = Root('many');
    $auto(R, true);
    const before = R.home.cleanup?.length ?? 0;
    for (let i = 0; i < 1000; i++) await $settle(R);
    const list = R.home.cleanup ?? [];
    assert.ok(list.length <= before + 1, `bounded: ${list.length} slots`);
    assert.ok(list.filter(Boolean).length <= 1, 'at most one live entry');
    $dispose(R);
  });

  it('never swallows a failure raised in its own flush after it is done', async () => {
    for (const own of [null, (/** @type {any} */ e) => void seen.push(e.message)]) {
      /** @type {string[]} */
      var seen = [];
      const clock = timers();
      try {
        const R = Root('after');
        $auto(R, true);
        if (own) $catch(R, own);
        const s = $signal(R, 0);
        $effect(R, () => {
          if ($read(s) === 1) throw new Error('effect after settle');
        });
        $flush(R);
        // Runs before the settle's own callback, in the same flush; the effect fails after it.
        $settled(R, () => $write(s, 1));
        if (own) {
          assert.equal(await outcome($settle(R, { timeout: 500 })), 'resolved');
          assert.deepEqual(seen, ['effect after settle'], 'the current handler has it');
        } else assert.throws(() => $settle(R, { timeout: 500 }), /effect after settle/, 'thrown from the flush');
        clean(R, own, clock);
        $dispose(R);
      } finally {
        clock.restore();
      }
    }
  });

  it('rejects at once on a root disposed before the call', async () => {
    for (const own of owns()) {
      const clock = timers();
      try {
        const R = Root('gone');
        $dispose(R);
        $catch(R, own);
        assert.match(await outcome($settle(R, { timeout: 500 })), /rejected: .*disposed/);
        clean(R, own, clock);
      } finally {
        clock.restore();
      }
    }
  });

  it('rejects promptly on a root disposed while it waits', async () => {
    for (const timeout of [0, 500])
      for (const own of owns()) {
        const name = `timeout ${timeout}, ${own ? 'a' : 'no'} handler`;
        const clock = timers();
        try {
          const { R } = setup(own);
          const p = $settle(R, { timeout });
          const t0 = Date.now();
          $dispose(R);
          assert.match(await outcome(p), /rejected: .*disposed/, name);
          assert.ok(Date.now() - t0 < 100, `${name}: promptly`);
          clean(R, own, clock);
        } finally {
          clock.restore();
        }
      }
  });

  it('rejects at the deadline, and cleans up', async () => {
    for (const own of owns()) {
      const clock = timers();
      try {
        const { R } = setup(own);
        assert.equal(await outcome($settle(R, { timeout: 30 })), 'rejected: REN: the root "settle" did not settle within 30 ms');
        clean(R, own, clock);
        $dispose(R);
      } finally {
        clock.restore();
      }
    }
  });

  it('leaves no $settled callback behind after settles that time out', async () => {
    const R = Root('hung');
    const m = $memo(R, () => new Promise(() => {}));
    $effect(R, () => {
      try {
        $read(m);
      } catch {}
    });
    for (let i = 0; i < 50; i++) await $settle(R, { timeout: 1 }).catch(() => {});
    assert.equal(R.settled.length, 0, 'every timed-out settle took its callback back');
    $dispose(R);
  });

  it("settles once rrx-core's own drain sweeps the last pending task away (sweep: false)", async () => {
    const R = Root('swept');
    const H = Tree();
    const box = H.element('box', null);
    const items = $signal(R, [1, 2, 3]);
    let cancelled = 0;
    const Row = () => {
      $task($active(), () => 1, () => () => void cancelled++);
      return <View />;
    };
    const dispose = mount(H, () => <View><For each={items}>{() => <Row />}</For></View>, box, { root: R, sweep: false, retire: 1 });
    assert.equal(R.loading, 3);
    $write(items, []);
    assert.equal(cancelled, 0, 'the rows were retired, not stopped');
    assert.equal(await outcome($settle(R, { timeout: 1000 }), 2000), 'resolved');
    assert.equal(cancelled, 3);
    dispose();
    $dispose(R);
  });
});

describe('a view that throws while it builds', () => {
  /** A Tree host that counts its delegation roots. */
  const Attaching = () => {
    const H = Tree();
    /** @type {Set<any>} */
    const attached = new Set();
    /** @param {any} n */
    H.attach = n => {
      attached.add(n);
      return () => void attached.delete(n);
    };
    return { H, attached };
  };

  it('leaves its root as it was: a later mount hears $keys on its own container', () => {
    const { H, attached } = Attaching();
    const R = Root('main');
    const a = H.element('box', null);
    let stopped = 0;
    const Early = () => {
      $cleanup(/** @type {any} */ ($owner(R)), () => stopped++);
      return <View />;
    };
    const Boom = () => {
      throw new Error('boom');
    };
    assert.throws(() => mount(H, () => <View><Early /><Boom /></View>, a, { root: R }), /boom/);
    assert.equal(stopped, 1, 'the view scope stopped');
    assert.equal(attached.has(a), false, 'nothing is left attached to the first container');
    const b = H.element('box', null);
    const Probe = () => {
      $keys(() => {});
      return <View />;
    };
    const dispose = mount(H, () => <Probe />, b, { root: R });
    assert.equal(typeof b.on?.keys, 'function', 'the second container hears the root');
    assert.equal(a.on?.keys, undefined, 'the first container does not');
    dispose();
    assert.equal(attached.size, 0);
    $dispose(R);
  });

  it('disposes the root it made', () => {
    const { H, attached } = Attaching();
    const box = H.element('box', null);
    /** @type {any} */
    let made = null;
    const Boom = () => {
      made = $active();
      throw new Error('boom');
    };
    assert.throws(() => mount(H, () => <Boom />, box), /boom/);
    assert.equal(made?.closed, true, 'the own root is disposed');
    assert.equal(attached.size, 0);
  });

  it('closes a portal whose children throw', () => {
    const { H, attached } = Attaching();
    const R = Root('main');
    const box = H.element('box', null);
    const target = H.element('box', null);
    const Boom = () => {
      throw new Error('boom');
    };
    const dispose = mount(H, () => <View><Recover fallback="failed"><Portal into={target}><Boom /></Portal></Recover></View>, box, { root: R });
    assert.equal(text(box), 'failed');
    assert.equal(attached.has(target), false, 'the portal target is not left attached');
    dispose();
    assert.equal(attached.size, 0);
    $dispose(R);
  });

  it('closes a portal whose target refuses a node', () => {
    const { H, attached } = Attaching();
    const R = Root('main');
    const box = H.element('box', null);
    const target = H.element('box', null);
    const insert = H.insert;
    let inserts = 0;
    H.insert = (parent, child, before) => {
      if (parent === target && ++inserts === 2) throw new Error('refused');
      insert(parent, child, before);
    };
    let stopped = 0;
    const Child = () => {
      $cleanup(/** @type {any} */ ($owner(R)), () => stopped++);
      return <View />;
    };
    const dispose = mount(H, () => <View><Recover fallback="failed"><Portal into={target}><Child /><View /></Portal></Recover></View>, box, { root: R });
    assert.equal(text(box), 'failed');
    assert.equal(target.children.length, 0, 'the node inserted before the failure is removed');
    assert.equal(attached.has(target), false, 'the portal target is not left attached');
    assert.equal(stopped, 1, 'the portal scope stopped');
    dispose();
    $dispose(R);
  });
});

describe('a pending value read where nothing tracks it', () => {
  /** @typedef {import('rrx-core').Readable<string>} Value */
  const Comp = (/** @type {{ t: Value }} */ props) => <b>{$read(props.t)}</b>;
  /** Where the read is: each shows the task's value once it is ready. @type {Record<string, (t: Value) => any>} */
  const places = {
    'a component body': t => <Comp t={t} />,
    'a component body in a function child': t => () => <Comp t={t} />,
    'a For row': t => <For each={[1]}>{() => $read(t)}</For>,
    'a component body in a For row': t => <For each={[1]}>{() => <Comp t={t} />}</For>,
    'a positional For row': t => <For each={[1]} by="position">{() => $read(t)}</For>,
    'a Times row': t => <Times count={1}>{() => $read(t)}</Times>,
    'a Show child': t => <Show when={true}>{() => $read(t)}</Show>,
    'a When child': t => <Choose><When when={true}>{() => $read(t)}</When></Choose>,
  };
  /** When the task completes, against the build and the flushes. @type {Record<string, (complete: () => void, R: any) => Promise<void> | void>} */
  const timings = {
    'before the build': () => {},
    'right after the build': complete => complete(),
    'after a microtask': async complete => {
      await Promise.resolve();
      complete();
    },
    'after a macrotask and a flush': async (complete, R) => {
      // timer: feature, the task completes after a macrotask: the timing under test.
      await new Promise(resolve => setImmediate(resolve));
      $flush(R);
      complete();
    },
  };
  for (const [where, view] of Object.entries(places))
    for (const [when, finish] of Object.entries(timings))
      for (const ok of [true, false])
        it(`in ${where}, completing ${when}${ok ? '' : ' with a failure'}: the fallback, then the ${ok ? 'content' : 'failure'}`, async () => {
          const H = Tree();
          const R = Root('main');
          /** @type {(state: any) => void} */
          let done = () => {};
          const t = $task(R, () => 1, (_, complete) => void (done = complete));
          const complete = () => done(ok ? { ok: true, value: 'ready' } : { ok: false, error: new Error('down') });
          if (when === 'before the build') complete();
          /** @type {unknown[]} */
          const errors = [];
          const box = H.element('box', null);
          const dispose = mount(H, () => (
            <Recover fallback={(/** @type {unknown} */ error) => (errors.push(error), 'failed')}>
              <Pending fallback="waiting">{view(t)}</Pending>
            </Recover>
          ), box, { root: R });
          if (when !== 'before the build') {
            assert.equal(text(box), 'waiting', 'the fallback shows while the value is pending');
            await finish(complete, R);
          }
          $flush(R);
          assert.equal(text(box), ok ? 'ready' : 'failed');
          assert.equal(errors.length, ok ? 0 : 1, 'Recover hears the task\'s failure only');
          if (!ok) assert.equal(/** @type {Error} */ (errors[0]).message, 'down');
          dispose();
          $dispose(R);
        });

  it('in a component body in a function child, in worker mode: the fallback, then the content', { timeout: 30000 }, async t => {
    const H = Tree();
    const box = H.element('box', null, null);
    const W = Root('app');
    /** @type {(state: any) => void} */
    let done = () => {};
    const task = $task(W, () => 1, (_, complete) => void (done = complete));
    /** @type {unknown[]} */
    const errors = [];
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now' });
    const session = serve(() => (
      <Recover fallback={(/** @type {unknown} */ error) => (errors.push(error), 'failed')}>
        <Pending fallback="waiting">{() => <Comp t={task} />}</Pending>
      </Recover>
    ), { port: port1, root: W });
    closeAfter(t, () => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    assert.equal(text(box), 'waiting');
    done({ ok: true, value: 'ready' });
    await connection.idle();
    assert.equal(text(box), 'ready');
    assert.deepEqual(errors, []);
  });
});
