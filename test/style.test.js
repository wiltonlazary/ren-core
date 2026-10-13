// The portable style: one vocabulary normalized once, the same for every
// renderer (ren-dom writes it as CSS, ren-canv lays it out and paints it).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Style, styled, overlay, argb, PORTABLE, Theme, UNITLESS } from '../src/host.js';

describe('ren-core portable style', () => {
  it('reads every portable color form as ARGB, and nothing else', () => {
    assert.equal(argb(0xff336699), 0xff336699);
    assert.equal(argb('#369'), 0xff336699);
    assert.equal(argb('#3698'), 0x88336699);
    assert.equal(argb('#336699'), 0xff336699);
    assert.equal(argb('#33669980'), 0x80336699);
    assert.equal(argb('rgb(51, 102, 153)'), 0xff336699);
    assert.equal(argb('rgba(51,102,153,0.5)'), 0x80336699);
    assert.equal(argb('transparent'), 0);
    assert.equal(argb('red'), null, 'named colors are not portable');
    assert.equal(argb('#12345'), null);
    assert.equal(argb(undefined), null);
    // A channel must be a number: dots alone, or two of them, are not one.
    for (const bad of ['rgb(.,.,.)', 'rgb(1..2, 3, 4)', 'rgb(1.2.3, 4, 5)', 'rgba(1, 2, 3, .)', 'rgb(, 1, 2)']) assert.equal(argb(bad), null, bad);
    assert.equal(argb('rgb(.5, 1., 2)'), 0xff010102, 'a leading or trailing dot is still a number');
  });

  it('normalizes the vocabulary into one record shape, unset as NaN, -1 or null', () => {
    const s = styled({
      direction: 'row', wrap: true, gap: 4, padding: [2, 8], margin: [1, 2, 3, 4], width: 100, grow: 1, align: 'center',
      justify: 'between', overflow: 'hidden', background: '#fff', color: 0xff000000, opacity: 0.5, border: 1, borderColor: '#000',
      radius: 6, shadow: { y: 2, blur: 8 }, fontSize: 20, fontWeight: 'bold', italic: true, textAlign: 'center', lineHeight: 1.2,
      underline: true, select: 'none', hover: { background: '#eee' },
    });
    assert.ok(s instanceof Style);
    assert.equal(s.direction, 1);
    assert.equal(s.wrap, 1);
    assert.deepEqual([s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft], [2, 8, 2, 8]);
    assert.deepEqual([s.marginTop, s.marginRight, s.marginBottom, s.marginLeft], [1, 2, 3, 4]);
    assert.equal(s.align, 1);
    assert.equal(s.justify, 3);
    assert.equal(s.overflow, 1);
    assert.equal(s.background, 0xffffffff);
    assert.deepEqual([s.shadowX, s.shadowY, s.shadowBlur, s.shadowColor], [0, 2, 8, 0x40000000]);
    assert.equal(s.fontWeight, 700);
    assert.equal(s.textAlign, 1);
    assert.equal(s.select, 0);
    assert.equal(s.hover?.background, 0xffeeeeee);
    assert.ok(Number.isNaN(s.height) && s.self === -1 && s.press === null, 'unset fields');
    assert.deepEqual(Object.keys(styled(null)), Object.keys(s), 'every record has the same shape');
    assert.equal(styled({ fontWeight: 500 }).fontWeight, 500, 'weights stay as given, in hundreds');
    assert.equal(styled({ fontWeight: 349 }).fontWeight, 300);
    assert.equal(styled({ fontWeight: 1000 }).fontWeight, 900);
    assert.equal(styled({ fontWeight: 'normal' }).fontWeight, 400);
    assert.equal(styled({ fontFamily: 'Fira Code, monospace' }).fontFamily, 'Fira Code, monospace');
    assert.equal(styled({}).fontFamily, null);
  });

  it('takes the placeholder color of an Edit', () => {
    assert.equal(styled({ placeholderColor: '#808080' }).placeholderColor, 0xff808080);
    assert.equal(styled({}).placeholderColor, null);
    assert.equal(styled({ placeholderColor: 'grey' }).placeholderColor, null, 'named colors are not portable');
    assert.ok(PORTABLE.has('placeholderColor'));
    assert.equal(styled({ placeholderColor: 0xff112233 }).other, null, 'it is not written as foreign CSS');
  });

  it('takes grid tracks and lines as CSS writes them', () => {
    const s = styled({ display: 'grid', columns: [100, '1fr', 'auto'], rows: 'repeat(2, 40px)', column: 2, row: '1 / 3', columnGap: 4, rowGap: 6 });
    assert.equal(s.display, 1);
    assert.equal(s.columns, '100px 1fr auto');
    assert.equal(s.rows, 'repeat(2, 40px)');
    assert.equal(s.column, '2');
    assert.equal(s.row, '1 / 3');
    assert.deepEqual([s.columnGap, s.rowGap], [4, 6]);
  });

  it('keeps names outside the vocabulary apart, for ren-dom to write as CSS', () => {
    const s = styled({ width: 10, 'border-left': '1px solid', letterSpacing: 1, cursor: 'pointer' });
    assert.deepEqual(s.other, { 'border-left': '1px solid', letterSpacing: 1 });
    assert.ok(PORTABLE.has('width') && !PORTABLE.has('letterSpacing'));
    // The cursor is portable: every renderer shows it.
    assert.ok(PORTABLE.has('cursor'));
    assert.equal(s.cursor, 'pointer');
  });

  it('takes positions, insets, a z-index and percent sizes', () => {
    const s = styled({ position: 'absolute', inset: 0, top: '100%', left: -4, zIndex: 3, width: '50%', maxHeight: '12.50%', minWidth: 40 });
    assert.equal(s.position, 1);
    assert.deepEqual([s.top, s.right, s.bottom, s.left], ['100%', 0, 0, -4], 'the shorthand sets all four; a later inset overrides it');
    assert.equal(s.zIndex, 3);
    assert.deepEqual([s.width, s.maxHeight, s.minWidth], ['50%', '12.5%', 40]);
    assert.equal(styled({ position: 'relative' }).position, 0);
    assert.equal(styled({ position: 'sticky', top: 0 }).position, 2, 'sticky');
    assert.equal(styled({ position: 'fixed' }).position, 3, 'fixed');
    const bad = styled({ position: 'static', zIndex: 1.5, width: '10px', top: 'auto' });
    assert.ok(bad.position === -1 && Number.isNaN(bad.zIndex) && Number.isNaN(bad.width) && Number.isNaN(bad.top), 'static, fractional z, other units: unset');
    assert.equal(styled({ zIndex: -2 }).zIndex, -2);
    for (const name of ['position', 'top', 'right', 'bottom', 'left', 'inset', 'zIndex']) assert.ok(PORTABLE.has(name), name);
    assert.equal(s.other, null);
    assert.deepEqual(Object.keys(bad), Object.keys(styled(null)), 'one shape');
    const over = overlay(s, styled({ top: 8, zIndex: 0 }));
    assert.deepEqual([over.top, over.zIndex, over.width, over.position], [8, 0, '50%', 1], 'a state overrides what it sets');
  });

  it('takes one radius or four corners, as CSS border-radius', () => {
    const one = styled({ radius: 6 });
    assert.deepEqual([one.radiusTopLeft, one.radiusTopRight, one.radiusBottomRight, one.radiusBottomLeft], [6, 6, 6, 6]);
    const four = styled({ radius: [1, 2, 3, 4] });
    assert.deepEqual([four.radiusTopLeft, four.radiusTopRight, four.radiusBottomRight, four.radiusBottomLeft], [1, 2, 3, 4]);
    assert.ok(Number.isNaN(styled({ radius: [1, 2] }).radiusTopLeft), 'two values are not portable');
    assert.equal(four.other, null);
    const over = overlay(four, styled({ radius: 0 }));
    assert.deepEqual([over.radiusTopLeft, over.radiusBottomLeft], [0, 0], 'a state sets every corner');
  });

  it('takes a border per side, its colors and its style', () => {
    const s = styled({ border: 1, borderTop: 3, borderColor: '#000', borderLeftColor: '#f00', borderStyle: 'dashed' });
    assert.deepEqual([s.borderTop, s.borderRight, s.borderBottom, s.borderLeft], [3, 1, 1, 1]);
    assert.deepEqual([s.borderTopColor, s.borderLeftColor], [0xff000000, 0xffff0000]);
    assert.equal(s.borderStyle, 1);
    assert.equal(styled({ borderStyle: 'double' }).borderStyle, -1, 'double is not portable');
    assert.equal(s.other, null);
    for (const name of ['borderTop', 'borderLeftColor', 'borderStyle']) assert.ok(PORTABLE.has(name), name);
  });

  it('takes a linear or radial gradient as a background', () => {
    const s = styled({ background: { linear: 90, stops: [[0, '#fff'], [1, 0xff000000]] } });
    assert.deepEqual({ ...s.background }, { radial: false, angle: 90, stops: [0, 0xffffffff, 1, 0xff000000] });
    const r = styled({ background: { radial: true, stops: [[0.2, '#f00'], [2, '#00f']] } });
    assert.deepEqual({ ...r.background }, { radial: true, angle: 0, stops: [0.2, 0xffff0000, 1, 0xff0000ff] }, 'offsets clamp to 0..1');
    assert.equal(styled({ background: { linear: 0, stops: [[0, 'red'], [1, '#000']] } }).background, null, 'a stop needs a portable color');
    assert.equal(styled({ background: { stops: [[0, '#000'], [1, '#fff']] } }).background, null, 'linear or radial');
    const over = overlay(s, styled({ background: '#eee' }));
    assert.equal(over.background, 0xffeeeeee, 'a state color replaces the gradient');
  });

  it('takes a transform: scale, rotate, translate and its origin', () => {
    const s = styled({ scale: [2, 0.5], rotate: -90, translate: [4, '50%'], transformOrigin: [0, '100%'] });
    assert.deepEqual([s.scaleX, s.scaleY, s.rotate, s.translateX, s.translateY, s.originX, s.originY], [2, 0.5, -90, 4, '50%', 0, '100%']);
    const one = styled({ scale: 1.5 });
    assert.deepEqual([one.scaleX, one.scaleY], [1.5, 1.5]);
    assert.ok(Number.isNaN(one.rotate) && Number.isNaN(one.originX), 'unset');
    assert.equal(s.other, null);
    assert.equal(overlay(one, styled({ scale: 1 })).scaleX, 1, 'a state scales too');
  });

  it('takes skews in degrees', () => {
    const s = styled({ skewX: 20, skewY: -10 });
    assert.deepEqual([s.skewX, s.skewY], [20, -10]);
    assert.equal(s.other, null);
    assert.ok(Number.isNaN(styled({}).skewX) && Number.isNaN(styled({ skewX: 'x' }).skewX));
    assert.ok(PORTABLE.has('skewX') && PORTABLE.has('skewY'));
    assert.equal(overlay(styled({}), styled({ skewY: 5 })).skewY, 5, 'a state skews too');
  });

  it('takes an aspect ratio', () => {
    assert.equal(styled({ aspectRatio: 16 / 9 }).aspectRatio, 16 / 9);
    assert.ok(Number.isNaN(styled({ aspectRatio: 0 }).aspectRatio) && Number.isNaN(styled({ aspectRatio: '16/9' }).aspectRatio));
    assert.ok(PORTABLE.has('aspectRatio'));
  });

  it('takes a strike through the text', () => {
    assert.equal(styled({ strike: true }).strike, 1);
    assert.equal(styled({}).strike, -1);
    assert.ok(PORTABLE.has('strike'));
  });

  it('takes an Image fit', () => {
    assert.equal(styled({ objectFit: 'cover' }).objectFit, 2);
    assert.equal(styled({ objectFit: 'scale-down' }).objectFit, -1);
    assert.ok(PORTABLE.has('objectFit'));
  });

  it('takes pointerEvents none or auto', () => {
    assert.equal(styled({ pointerEvents: 'none' }).pointerEvents, 0);
    assert.equal(styled({ pointerEvents: 'auto' }).pointerEvents, 1);
    assert.equal(styled({ pointerEvents: 'fill' }).pointerEvents, -1);
    assert.ok(PORTABLE.has('pointerEvents'));
  });

  it('takes touchAction as bits: pan-x 1, pan-y 2, pinch-zoom 4', () => {
    assert.equal(styled({ touchAction: 'auto' }).touchAction, 7);
    assert.equal(styled({ touchAction: 'manipulation' }).touchAction, 7);
    assert.equal(styled({ touchAction: 'none' }).touchAction, 0);
    assert.equal(styled({ touchAction: 'pan-x' }).touchAction, 1);
    assert.equal(styled({ touchAction: 'pan-y pinch-zoom' }).touchAction, 6);
    assert.equal(styled({ touchAction: ' pan-x  pan-y ' }).touchAction, 3);
    assert.equal(styled({ touchAction: 'pan-x pan-x' }).touchAction, -1, 'a pan named twice is not CSS');
    assert.equal(styled({ touchAction: 'none pan-x' }).touchAction, -1);
    assert.equal(styled({ touchAction: 'pan-left' }).touchAction, -1, 'not in the vocabulary');
    assert.equal(styled({}).touchAction, -1);
    assert.ok(PORTABLE.has('touchAction'));
    assert.equal(overlay(styled({ touchAction: 'none' }), styled({ touchAction: 'pan-y' })).touchAction, 2);
  });

  it('takes textTransform and display contents', () => {
    assert.deepEqual(['none', 'uppercase', 'lowercase', 'capitalize', 'small-caps'].map(t => styled({ textTransform: /** @type {any} */ (t) }).textTransform), [0, 1, 2, 3, -1]);
    assert.equal(styled({}).textTransform, -1);
    assert.deepEqual(['flex', 'grid', 'contents', 'block'].map(d => styled({ display: /** @type {any} */ (d) }).display), [0, 1, 2, -1]);
    assert.ok(PORTABLE.has('textTransform') && PORTABLE.has('display'));
    assert.equal(styled({ textTransform: 'uppercase', display: 'contents' }).other, null, 'neither is foreign CSS');
  });

  it('overlays a state style on the base', () => {
    const s = styled({ background: '#fff', color: '#000', padding: 4, hover: { background: '#eee', padding: [4, 6] } });
    const over = overlay(s, s.hover);
    assert.equal(over.background, 0xffeeeeee);
    assert.equal(over.color, 0xff000000, 'what the state does not set stays');
    assert.equal(over.paddingRight, 6);
    assert.equal(over.hover, s.hover);
    assert.equal(overlay(s, null).background, 0xffffffff);
  });

  it('adds text tokens to the theme: size, leading (unitless) and the entry width', () => {
    const t = new Theme({ text: 15 });
    assert.equal(t.text, 15);
    assert.equal(t.leading, 1.4);
    assert.equal(t.entry, 200);
    assert.ok(UNITLESS.has('leading') && !UNITLESS.has('text'));
  });

  it('rejects inherited names as theme tokens', () => {
    for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      const tokens = JSON.parse(`{"${name}": 1}`);
      assert.throws(() => new Theme(tokens), new RegExp(`unknown theme token ${name}`), name);
    }
    assert.equal(typeof String(new Theme({ ink: 1 })), 'string');
  });
  it('overlays a state value of -1 where it is a value: a one-pixel lift, a -1 offset, zIndex, rotate, skew, a shadow', () => {
    const o = overlay(styled({ translate: [0, 0], top: 0, zIndex: 2, rotate: 0, margin: 0 }), styled({ translate: [0, -1], top: -1, zIndex: -1, rotate: -1, skewX: -1, margin: -1, shadow: { x: -1, y: 2, blur: 3, color: '#000' } }));
    assert.deepEqual([o.translateY, o.top, o.zIndex, o.rotate, o.skewX, o.marginTop, o.shadowX], [-1, -1, -1, -1, -1, -1, -1]);
    // A keyword the state leaves unset (-1 there) keeps the base's.
    assert.equal(overlay(styled({ position: 'absolute' }), styled({ top: 1 })).position, styled({ position: 'absolute' }).position);
  });

  it("reads a Scroll's bars as CSS's scrollbar-width and scrollbar-color", () => {
    const s = styled({ scrollbarWidth: 'thin', scrollbarColor: ['#f00', 0xff00ff00] });
    assert.deepEqual([s.scrollbarWidth, s.scrollbarThumb, s.scrollbarTrack], [1, 0xffff0000, 0xff00ff00]);
    assert.equal(styled({ scrollbarWidth: 'none' }).scrollbarWidth, 2);
    assert.equal(styled({ scrollbarWidth: 'auto' }).scrollbarWidth, 0);
    assert.equal(styled({ scrollbarWidth: /** @type {any} */ ('wide') }).scrollbarWidth, -1, 'not a keyword: unset');
    for (const pair of ['auto', ['#f00'], ['#f00', 'red'], 3]) {
      const u = styled({ scrollbarColor: /** @type {any} */ (pair) });
      assert.deepEqual([u.scrollbarThumb, u.scrollbarTrack], [null, null], `${JSON.stringify(pair)}: both colors or neither`);
    }
    assert.ok(PORTABLE.has('scrollbarWidth') && PORTABLE.has('scrollbarColor'));
    // A state may change them, as any field.
    assert.equal(overlay(s, styled({ scrollbarWidth: 'none' })).scrollbarWidth, 2);
    assert.equal(overlay(s, styled({})).scrollbarThumb, 0xffff0000);
  });
});
