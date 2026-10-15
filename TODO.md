# TODO

Open work for ren-core, the renderer-neutral layer.

- [ ] A ref that writes reactive state fails inside a `For` row: rui-core's
  Select (any combobox field: its `ref` is `setAnchor`, which `$write`s
  the anchor signal, `rui-core` `core/combobox/combobox.jsx`) throws
  "RRX: computation cannot write reactive state" (from `bindRef`) when it
  is rendered in a `For` row, keyed or not, with a static `each` too; the
  same Select returned by a thunk child (`{() => <Select … />}`) renders
  fine, so a row's refs are bound inside a computation where a thunk
  child's are not. Repro (ren-dom over happy-dom): `Root` with children
  `<Rui><Stack><For each={() => [1]}>{() => <Select label="Payer"
  data={[{ value: 'a', label: 'A' }]} value={null} onChange={() => {}}
  />}</For></Stack></Rui>`, then `$flush`: it throws. Wanted: refs in a
  `For` row are bound as a thunk child's are (outside the computation, or
  untracked as writes are allowed there), so a component whose ref writes
  state works in lists. Done with that repro as a test (in ren-core with a
  ref that `$write`s, and the Select case in rui-core). fiman builds its
  payer lines with a reactive `.map` until then.
