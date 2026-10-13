// A minimal in-memory Host for ren-core's own tests: plain nodes with a tag,
// properties, handlers and children, no document. It proves the component
// layer, roots and the worker runtime need no renderer package.

/** @typedef {{ made?: Record<string, any>, into?: Node | null, tag: string, props: Record<string, any>, on: Record<string, (event: any) => void>, children: Node[], parent: Node | null, text: string | null }} Node */

/** @param {string} tag @param {string | null} text @returns {Node} */
const node = (tag, text) => ({ tag, props: {}, on: {}, children: [], parent: null, text });

/**
 * A tree host; each element keeps, as `into`, the parent `element` was
 * told it goes into. `nest` is on unless `options.nest` is false; `construct`
 * names the props `element` records as `made` (what it saw at creation).
 * @param {{ nest?: boolean, construct?: ReadonlySet<string> }} [options]
 * @returns {import('ren-core/host').Host & { layer(): Node, container: Node | null, presented: number, closed: boolean, view: number[], viewers: Set<(w: number, h: number, f: number) => void>, resize(width: number, height: number, flags?: number): void }}
 */
export function Tree(options = {}) {
  const layer = node('layer', null);
  /** @type {any} */
  const H = {
    kind: 'tree',
    presented: 0,
    container: null,
    closed: false,
    // A viewport of 800 × 600 with no preferences; `resize` changes it.
    view: [800, 600, 0],
    viewers: new Set(),
    viewport(/** @type {(w: number, h: number, f: number) => void} */ report) {
      H.viewers.add(report);
      report(H.view[0], H.view[1], H.view[2]);
      return () => void H.viewers.delete(report);
    },
    resize(/** @type {number} */ width, /** @type {number} */ height, flags = 0) {
      H.view = [width, height, flags];
      for (const report of [...H.viewers]) report(width, height, flags);
    },
    element(/** @type {string} */ tag, /** @type {any} */ props, /** @type {Node | null} */ parent) {
      const n = node(tag, null);
      // The element it was told it goes into.
      n.into = parent ?? null;
      if (options.construct !== undefined) n.made = Object.fromEntries([...options.construct].filter(k => props?.[k] !== undefined).map(k => [k, props[k]]));
      return n;
    },
    text: (/** @type {string} */ text) => node('#text', text),
    content: (/** @type {Node} */ n, /** @type {string} */ text) => void (n.text = text),
    set: (/** @type {Node} */ n, /** @type {string} */ name, /** @type {any} */ value) => void (n.props[name] = value),
    listen(/** @type {Node} */ n, /** @type {string} */ name, /** @type {(event: any) => void} */ handler) {
      n.on[name] = handler;
      return () => {
        if (n.on[name] === handler) delete n.on[name];
      };
    },
    insert(/** @type {Node} */ parent, /** @type {Node} */ child, /** @type {Node | null} */ before) {
      if (child.parent !== null) H.remove(child.parent, child);
      const at = before === null ? parent.children.length : parent.children.indexOf(before);
      parent.children.splice(at, 0, child);
      child.parent = parent;
    },
    remove(/** @type {Node} */ parent, /** @type {Node} */ child) {
      const at = parent.children.indexOf(child);
      if (at >= 0) parent.children.splice(at, 1);
      child.parent = null;
    },
    marker: () => node('#marker', null),
    parent: (/** @type {Node} */ n) => n.parent,
    next(/** @type {Node} */ n) {
      if (n.parent === null) return null;
      const siblings = n.parent.children;
      return siblings[siblings.indexOf(n) + 1] ?? null;
    },
    owns: (/** @type {any} */ value) => value != null && typeof value === 'object' && Array.isArray(value.children) && 'tag' in value,
    layer: () => layer,
    present() {
      H.presented++;
    },
    open(/** @type {Node | null} */ host) {
      return (H.container = host ?? node('root', null));
    },
    close() {
      H.closed = true;
    },
  };
  if (options.construct !== undefined) H.construct = options.construct;
  if (options.nest !== false) H.nest = () => Tree(options);
  return H;
}

/** The text of a tree: its text nodes, in order. @param {Node} n @returns {string} */
export const text = n => (n.text ?? '') + n.children.map(text).join('');

/** The nodes of a tree with `tag`, in order. @param {Node} n @param {string} tag @returns {Node[]} */
export const find = (n, tag) => [...(n.tag === tag ? [n] : []), ...n.children.flatMap(c => find(c, tag))];
