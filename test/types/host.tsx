// ren-core/host: a renderer package implements Host; an application root takes it.
import { Root, $signal, $read, $dispose, $focus, $keys, $scrolls, $viewport, $media, Action, Edit, Label, Scroll, Image, Shape, View as Box } from 'ren-core';
import { mount, skeleton, Theme, COLORS, type Host } from 'ren-core/host';

const nodes: any[] = [];
const host: Host = {
  kind: 'list',
  element: tag => ({ tag }),
  text: text => ({ text }),
  content: (node, text) => void (node.text = text),
  set: (node, name, value) => void (node[name] = value),
  listen: () => () => {},
  insert: (_parent, child) => void nodes.push(child),
  remove: () => {},
  marker: () => ({}),
  parent: () => null,
  next: () => null,
  owns: value => typeof value === 'object' && value !== null,
  layer: () => ({}),
  open: () => ({}),
};
const R = Root({ id: 'typed', renderer: host, storage: null, children: () => <View /> });
const count = $signal(R, 1);
const View = () => <p>{() => $read(count)}</p>;
const dispose: () => void = mount(host, () => <b />, {}, { retire: 1000, sweep: 'idle' });
const theme: Theme = new Theme({ ink: 0xff000000 });
const colors: Set<string> = COLORS;
void skeleton, dispose, theme, colors;
$dispose(R);
// @ts-expect-error a Root takes options or an id
Root(1);
// The portable Edit and Label props.
const typed = $signal(R, '');
void (
  <Edit value={typed} lines={3} autosize={8} disabled={() => false} readOnly secret style={{ placeholderColor: '#999' }} />
);
void (<Label text="long" lines={2} ellipsis />);
// @ts-expect-error autosize is a row count or a flag
void (<Edit autosize="many" />);
// What a primitive means: a role with its aria states, and microdata.
void (<Label role="heading" aria-level={2} text="Inbox" />);
void (
  <Box itemscope itemtype="Product" role="article">
    <Label itemprop="name" text="Lamp" />
    <Label itemprop="price" content={25} text="$25.00" />
    <Label role="link" href="/lamp" text="Details" />
  </Box>
);
// @ts-expect-error a role is a name
void (<Box role={1} />);
// A Scroll's axis.
void (<Scroll axis="x" />);
// @ts-expect-error an axis is x, y or both
void (<Scroll axis="z" />);
void (<Image source="a.png" style={{ objectFit: "cover" }} onError={e => void e.target} />);
void (<Box trap={() => true} />);
void (<Box onDrop={e => void e.files.length} />);
void (<Box onDragEnter={e => void e.types.map(t => t.length)} onDragOver={e => void (e.files + e.x + e.y)} onDragLeave={e => void (e.type === 'dragleave')} />);
void (<Box onFocusIn={e => void (e.type === 'focusin' && e.relatedTarget)} onFocusOut={e => void (e.type === 'focusout')} />);
// @ts-expect-error a drag carries a count of files, not the files
void (<Box onDragOver={e => void e.files.length} />);
// Skews, in degrees.
void (<Box style={{ skewX: 12, skewY: -4, rotate: 0 }} />);
// @ts-expect-error a skew is a number of degrees
void (<Box style={{ skewX: '12deg' }} />);
// A figure filled with a gradient, as a background takes one.
void (<Shape shapes={[{ kind: 'oval', x: 0, y: 0, right: 10, bottom: 10, fill: { linear: 90, stops: [[0, '#fff'], [1, 0xff000000]] } }, { kind: 'rect', fill: '#123' }]} />);
// @ts-expect-error a fill is a color or a gradient
void (<Shape shapes={[{ kind: 'rect', fill: { linear: 'left' } }]} />);
// The first or last focusable inside a ref.
const focused: boolean = $focus(null) || $focus({}, true);
void focused;
// Root-wide keys.
const Spot = () => {
  const stop: () => void = $keys(e => void (!e.editable && e.ctrlKey && e.key === 'k' && e.preventDefault()));
  const follow: () => void = $scrolls(e => void (e.type === 'scroll' && e.target));
  void stop;
  void follow;
  return <Box />;
};
void Spot;
// The viewport and media queries.
const Shell = () => {
  const v = $viewport();
  const wide = $media('(min-width: 48em)');
  return <Box>{() => `${$read(v.width)}x${$read(v.height)} ${$read(v.dark)} ${$read(v.reduced)} ${$read(wide)}`}</Box>;
};
void Shell;
const viewing: Host = { ...host, viewport: report => (report(1, 2, 3), () => {}) };
void viewing;
// A Label of styled runs.
void (
  <Label
    runs={[
      { text: 'Hello ' },
      { text: 'world', style: { background: '#ffec99', fontWeight: 700, italic: true, underline: true, strike: false, fontFamily: 'monospace', fontSize: 14, color: 0xff000000 } },
      { text: ' link', onPress: e => void e },
    ]}
    lines={2}
  />
);
// @ts-expect-error a run's style is the text part of the vocabulary
void (<Label runs={[{ text: 'x', style: { padding: 4 } }]} />);
// An Edit's value in styled runs: paint and face, the value plain.
void (<Edit value="let x" runs={[{ text: 'let', style: { color: '#c678dd', fontWeight: 700 } }, { text: ' ' }, { text: 'x', style: { background: '#ffec99', underline: true, italic: true } }]} />);
void (<Edit value="" runs={null} lines={3} />);
// @ts-expect-error an Edit's run keeps the Edit's size (one line height)
void (<Edit runs={[{ text: 'x', style: { fontSize: 20 } }]} />);
// @ts-expect-error an Edit's run has no press (a press places the caret)
void (<Edit runs={[{ text: 'x', onPress: () => {} }]} />);
// Touches, text case, boxless items, a cancelled press and a machine-readable date.
void (<Box style={{ touchAction: 'pan-y', textTransform: 'uppercase', display: 'contents' }} onPointerCancel={e => void (e.pointerId + e.x)} />);
void (<Box style={{ touchAction: 'pan-x pan-y pinch-zoom' }} />);
// @ts-expect-error touch-action names its pans in CSS's order
void (<Box style={{ touchAction: 'pan-y pan-x' }} />);
// @ts-expect-error a text transform is one of CSS's four
void (<Label style={{ textTransform: 'small-caps' }} />);
void (<Label role="time" datetime="2026-09-27" text="today" />);
// An item's fields outside it, by id.
void (
  <Box>
    <Box itemscope itemtype="Person" itemref="mail"><Label itemprop="name" text="Ada" /></Box>
    <Label id="mail" itemprop="email" text="ada@example.com" />
  </Box>
);
// @ts-expect-error a View takes no scroll (a Scroll scrolls)
void (<Box scroll />);
// @ts-expect-error a Label takes no rule
void (<Label rule />);
// @ts-expect-error an Edit takes no mask (a component masks its value)
void (<Edit mask="##" />);
// A region focusable from code, an Action out of the Tab order, an inert region.
void (<Box tabIndex={-1} inert={() => false}><Action tabIndex={-1} text="a" /><Edit tabIndex={0} /></Box>);
void (<Scroll tabIndex={0} />);
void (<Label inert />);
// A right-to-left region, a field whose direction follows its value.
void (<Box dir="rtl"><Edit dir="auto" /><Label dir={() => 'ltr'} /></Box>);
// @ts-expect-error a direction is ltr, rtl or auto
void (<Box dir="right" />);
// @ts-expect-error a Label takes no focus
void (<Label tabIndex={0} />);
// @ts-expect-error a tab index is a number
void (<Box tabIndex="0" />);
