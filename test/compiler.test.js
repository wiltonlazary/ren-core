// The ren-core/esbuild compiler: plans hoisted once per module, dynamic values
// kept per evaluation, the scanner (strings, templates, regular expressions,
// blocks against object literals), source maps, TSX and the development
// runtime's key. Compiled templates
// running on a renderer are tested in the renderer packages (ren-dom).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync, build } from 'esbuild';
import { SourceMap } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { h, template, plan, Fragment } from 'ren-core/jsx-runtime';
import { transform, compile, ren } from 'ren-core/esbuild';

/** Compiles JSX source to the module body the plugin would emit. */
const compiled = source =>
  transform(transformSync(source, { loader: 'jsx', jsx: 'transform', jsxFactory: '__ren_h', jsxFragment: '__ren_F', target: 'esnext' }).code);

/**
 * Evaluates compiled JSX (an expression of `scope`) with the runtime's
 * helpers: the compiler's own import line is dropped and its names bound.
 */
const evaluate = (source, scope) => {
  const code = compiled(`export default (${Object.keys(scope).join(', ')}) => ${source};`).replace(/^import .*\n/, '').replace('export default', 'return');
  return new Function('__ren_h', '__ren_F', '__ren_t', '__ren_p', code)(h, Fragment, template, plan)(...Object.values(scope));
};

describe('ren-core/esbuild compiler', () => {
  it('hoists one plan per tree and keeps only dynamic values per evaluation', () => {
    const out = compiled('const f = (x, y) => <tr class="row"><td class="a">{x}</td><td><a onClick={y}>go</a></td></tr>;');
    assert.match(out, /^import \{ h as __ren_h, Fragment as __ren_F, template as __ren_t, plan as __ren_p \} from "ren-core\/jsx-runtime";/);
    assert.equal(out.match(/__ren_p\(/g).length, 1, 'one plan');
    assert.match(out, /__ren_t\(__ren_p0, \[x, y\]\)/, 'values in evaluation order');
    assert.match(out, /\["tr", \{"class":"row"\}/);
  });

  it('keeps a literal after key or ref in the template: neither is a part the literal must follow', () => {
    for (const [source, statics] of [
      ['const f = r => <input ref={r} type="number" />;', '{"type":"number"}'],
      ['const f = k => <div key={k} class="x" />;', '{"class":"x"}'],
    ]) {
      const out = compiled(source);
      assert.ok(out.includes(statics), `${source}: ${statics} in the template (${out.split('\n')[1]})`);
    }
  });

  it('compiles a prop named like an Object.prototype member beside children', () => {
    for (const source of ['const v = <div constructor="x">kid</div>;', 'const v = f => <div toString={f}>kid</div>;', 'const v = <div hasOwnProperty="1">kid</div>;']) {
      assert.doesNotThrow(() => compiled(source), source);
      assert.match(compiled(source), /kid/, source);
    }
  });

  it('leaves components, fragments and spreads as factory calls', () => {
    const out = compiled('const f = p => <><C a={1} /><div {...p} /><div class="x">{<C />}</div></>;');
    assert.match(out, /__ren_h\(__ren_F, null/);
    assert.match(out, /__ren_h\(C, \{ a: 1 \}\)/);
    assert.match(out, /__ren_h\("div", p\)|__ren_h\("div", \{ \.\.\.p \}\)/);
    assert.match(out, /__ren_t\(__ren_p0, \[__ren_h\(C, null\)\]\)/);
  });

  it('scans strings, templates, regular expressions and comments', () => {
    const out = compiled('const s = "__ren_h(" + `${"}"}${<b>{a / 2}</b>}` + /<i>[/]/.source; // __ren_h(\nconst t = x => x / 2 / <i />;');
    assert.match(out, /`__ren_h\(\$\{"\}"\}/, 'a factory name inside a template string stays text');
    assert.match(out, /\$\{\/\* @__PURE__ \*\/ __ren_t\(__ren_p0, \[a \/ 2\]\)\}`/);
    assert.match(out, /x \/ 2 \/ \/\* @__PURE__ \*\/ __ren_t\(__ren_p1, \[\]\)/, 'division is not a regular expression');
    assert.match(out, /\/<i>\[\/\]\/\.source/);
  });

  it('tells blocks from object literals: a / after } divides after a value', () => {
    // Division after an object literal, in a statement and in props.
    const a = compiled('const q = { a: 1 } / 2 / <i />;\nconst p = <b n={{} / 1}>{<u />}</b>;');
    assert.match(a, /\} \/ 2 \/ \/\* @__PURE__ \*\/ __ren_t\(__ren_p0, \[\]\)/, 'the object literal is divided');
    assert.match(a, /__ren_t\(__ren_p1, \[\{\} \/ 1\]\)/);
    assert.doesNotMatch(a, /__ren_h\(/, 'every tree compiled');
    // Division after an object literal inside a template substitution.
    const b = compiled('const r = `${ {} / 2 }${<b />}`;');
    assert.match(b, /\{\} \/ 2\}\$\{\/\* @__PURE__ \*\/ __ren_t\(__ren_p0, \[\]\)\}`/);
    // A regular expression after a block, and after an arrow body in a call.
    const c = compiled('if (ok) { f(); }\n/x}y/.test(s) && <i />;\ng(() => { return 1; }, /a}/.source, <u />);');
    assert.match(c, /\/x\}y\/\.test\(s\) && \/\* @__PURE__ \*\/ __ren_t\(__ren_p0, \[\]\)/);
    assert.match(c, /\/a\}\/\.source, \/\* @__PURE__ \*\/ __ren_t\(__ren_p1, \[\]\)/);
    // The compiled code still evaluates the division.
    assert.ok(Number.isNaN(evaluate('({ a: 1 } / 2)', {})));
  });

  it('divides after a keyword used as a property name', () => {
    for (const k of ['of', 'in', 'do', 'new', 'delete', 'return', 'case', 'else', 'void']) {
      for (const dot of ['.', '?.']) {
        const out = compiled(`const h = r => r${dot}${k} / 2;\nconst e = <p>{h}</p>;`);
        assert.match(out, /__ren_t\(__ren_p0, \[h\]\)/, `r${dot}${k}`);
      }
    }
  });

  it('reads a regular expression after the ) of if, while, for and with', () => {
    for (const head of ['if (x)', 'while (x)', 'for (;;)', 'with (x)']) {
      for (const q of ['"', "'", '`']) {
        const out = compiled(`function f(x, y) { ${head} /${q}/.test(y); return <b>{y}</b>; }`);
        assert.match(out, /__ren_t\(__ren_p0, \[y\]\)/, `${head} /${q}/`);
      }
    }
  });

  // The scanner's regular-expression-or-division table. Each snippet runs in
  // `async function* g(x, y, a, s, k, o, v)` (sloppy mode, so `with` parses)
  // before `return <b>{y}</b>`. A regular expression is `/"/`: read as a
  // division, its quote opens a string that swallows the tree. A division is
  // `/ 2` at a line end: read as a regular expression, it runs to the line
  // end and fails. `probe` must survive esbuild, so each case is exercised.
  // Not supported, left out:
  // - `super / 2`: a syntax error; `super` is only read through `.` or `[`.
  // - `a\n++b` and other statements ended by a line break: the scanner reads
  //   esbuild's output, which prints every `;`.
  const REGEX = ['regex', '/"/'];
  const DIVIDE = ['divide', '/ 2'];
  const table = [
    // A regular expression after a punctuator.
    ['(', 'v = f(/"/);', REGEX],
    [',', 'v = f(1, /"/);', REGEX],
    ['=', 'v = /"/;', REGEX],
    [': (property)', 'v = { k: /"/ };', REGEX],
    [': (ternary)', 'v = a ? 1 : /"/;', REGEX],
    ['[', 'v = [/"/];', REGEX],
    ['!', 'v = !/"/.test(s);', REGEX],
    ['&', 'v = a & /"/.lastIndex;', REGEX],
    ['&&', 'v = a && /"/;', REGEX],
    ['|', 'v = a | /"/.lastIndex;', REGEX],
    ['||', 'v = a || /"/;', REGEX],
    ['?', 'v = a ? /"/ : 1;', REGEX],
    ['{ (block)', '{ v = 1; }\n{ /"/.test(s); }', REGEX],
    ['} (block)', 'if (a) { f(); }\n/"/.test(s);', REGEX],
    [';', 'f(); /"/.test(s);', REGEX],
    ['+', 'v = 1 + /"/.lastIndex;', REGEX],
    ['-', 'v = 1 - /"/.lastIndex;', REGEX],
    ['*', 'v = 1 * /"/.lastIndex;', REGEX],
    ['%', 'v = 1 % /"/.lastIndex;', REGEX],
    ['<', 'v = 1 < /"/.lastIndex;', REGEX],
    ['>', 'v = 1 > /"/.lastIndex;', REGEX],
    ['~', 'v = ~/"/.lastIndex;', REGEX],
    ['^', 'v = 1 ^ /"/.lastIndex;', REGEX],
    ['=>', 'v = () => /"/;', REGEX],
    ['...', 'v = [.../"/.source];', REGEX],
    // A regular expression after a keyword.
    ...[
      ['return', 'if (a) return /"/;'],
      ['typeof', 'v = typeof /"/;'],
      ['instanceof', 'v = a instanceof /"/.constructor;'],
      ['in', 'v = "x" in /"/;'],
      ['of', 'for (const c of /"/.source) f(c);'],
      ['new', 'v = new /"/.constructor("x");'],
      ['delete', 'v = delete /"/.lastIndex;'],
      ['void', 'v = void /"/;'],
      ['throw', 'if (a) throw /"/;'],
      ['case', 'switch (a) { case /"/: f(); }'],
      ['do', 'do /"/.test(s); while (a);'],
      ['else', 'if (a) f(); else /"/.test(s);'],
      ['yield', 'v = yield /"/;'],
      ['await', 'v = await /"/;'],
      // After the spread of a keyword.
      ['...await', 'v = [...await /"/.source];'],
      ['...yield', 'v = [...yield /"/];'],
      ['...new', 'v = [...new /"/.constructor("x").source];'],
      ['...typeof', 'v = [...typeof /"/];'],
      // After a control head.
      ['if (…)', 'if (a) /"/.test(s);'],
      ['while (…)', 'while (a) /"/.test(s);'],
      ['for (…)', 'for (;;) /"/.test(s);'],
      ['for await (…)', 'for await (const c of o) /"/.test(c);'],
      ['with (…)', 'with (o) /"/.test(s);']
    ].map(([name, src]) => [name, src, REGEX]),
    // A division after a value.
    ...[
      ['identifier', 'v = x / 2'],
      ['number', 'v = 1 / 2'],
      ['string', 'v = "s" / 2'],
      ['template', 'v = `t` / 2'],
      ['template with a substitution', 'v = `${a}` / 2'],
      [') of a call', 'v = f(1) / 2'],
      [') of a group', 'v = (a) / 2'],
      [']', 'v = o[k] / 2'],
      ['} of an object literal', 'v = { a: 1 } / 2'],
      ['this', 'v = this / 2'],
      ['super.x', 'class C extends Object { m() { return super.x / 2\n} }'],
      ['super[k]', 'class C extends Object { m() { return super[k] / 2\n} }'],
      ['regular expression', 'v = /"/g / 2'],
      ['a.of', 'v = a.of / 2'],
      ['a variable named of', 'let of = 4; v = of / 2'],
      ['a?.in', 'v = a?.in / 2'],
      ['a.return', 'v = a.return / 2'],
      ['a.await', 'v = a.await / 2'],
      ['...a.yield', 'v = [...a.yield / 2\n]'],
      ['x++', 'v = x++ / 2'],
      ['x--', 'v = x-- / 2']
    ].map(([name, src]) => [name, `${src};`, DIVIDE])
  ];

  it('divides after a variable named of in a for head, and reads a regex after for-of', () => {
    const src = 'let n = 0; for (let of = 8; of / 2 > 1; of--) n++; for (const of of /"/.source) n++; export const v = <div>{n}</div>;';
    const out = compiled(src);
    assert.match(out, /of \/ 2 > 1/, 'the division is kept');
    assert.doesNotMatch(out, /__ren_h\(/, 'the tree is a template');
  });

  it('tells a regular expression from a division, table-driven', () => {
    const failed = [];
    for (const [name, src, [kind, probe]] of table) {
      const source = `async function* g(x, y, a, s, k, o, v) {\n${src}\nreturn <b>{y}</b>;\n}`;
      const esb = transformSync(source, { loader: 'jsx', jsx: 'transform', jsxFactory: '__ren_h', jsxFragment: '__ren_F', target: 'esnext' }).code;
      assert.ok(esb.includes(kind === 'regex' ? probe : `${probe};\n`) || esb.includes(`${probe}\n`), `${name}: esbuild kept ${probe}: ${esb}`);
      try {
        const out = compiled(source);
        assert.match(out, /__ren_t\(__ren_p0, \[y\]\)/);
        assert.doesNotMatch(out, /__ren_h\(/);
        // The output parses (a body, sloppy like the source, without the import).
        new Function(out.replace(/^import .*\n/, ''));
      } catch (e) {
        failed.push(`${kind} after ${name}: ${String(e.message).split('\n')[0]}`);
      }
    }
    assert.deepEqual(failed, []);
  });

  it('passes the map of a module with no JSX through, back to its source', async () => {
    const source = 'type Pair = { a: number; b: number };\n\nexport function useSum(p: Pair): number {\n  return whereIsIt(p.a) + p.b;\n}\n';
    const out = await compile(source, { sourcemap: true, filename: 'hooks.tsx', loader: 'tsx' });
    const map = JSON.parse(Buffer.from(/base64,(.*)$/m.exec(out)[1], 'base64').toString());
    assert.notEqual(map.mappings, '', 'the map is kept');
    const at = out.indexOf('whereIsIt');
    const before = out.slice(0, at).split('\n');
    const entry = new SourceMap(map).findEntry(before.length - 1, before[before.length - 1].length);
    assert.deepEqual([entry.originalSource, entry.originalLine], ['hooks.tsx', 3], 'a line maps to its source line');
  });

  it('maps the compiled output back to the JSX source', async () => {
    const source = 'const a = 1;\n\nexport const f = (x) => (\n  <p title="t">\n    {whereIsIt(x)}\n  </p>\n);\nconst g = <i>{other / 2}</i>;\n';
    /** The original [line, column] (0-based) of `name` in `code`, through its inline map. */
    const origin = (code, map, name) => {
      const at = code.indexOf(name);
      const before = code.slice(0, at).split('\n');
      const entry = new SourceMap(map).findEntry(before.length - 1, before[before.length - 1].length);
      return [entry.originalSource, entry.originalLine, entry.originalColumn];
    };
    const inlineMap = code => JSON.parse(Buffer.from(/base64,(.*)$/m.exec(code)[1], 'base64').toString());
    const out = await compile(source, { sourcemap: true, filename: 'view.jsx' });
    assert.match(out, /__ren_t\(__ren_p0, \[whereIsIt\(x\)\]\)/);
    const map = inlineMap(out);
    assert.deepEqual(origin(out, map, 'whereIsIt'), ['view.jsx', 4, 5]);
    assert.deepEqual(origin(out, map, 'other'), ['view.jsx', 7, 14]);
    assert.equal(map.sourcesContent[0], source);
    // Through the plugin, into a bundle's own map.
    mkdirSync(new URL('../artifact/tmp/compiler/', import.meta.url), { recursive: true });
    const file = fileURLToPath(new URL('../artifact/tmp/compiler/view.jsx', import.meta.url));
    writeFileSync(file, source);
    const built = await build({ entryPoints: [file], bundle: true, write: false, format: 'esm', sourcemap: 'external', outdir: fileURLToPath(new URL('../artifact/tmp/compiler/dist/', import.meta.url)), external: ['ren-core', 'ren-core/*'], plugins: [ren()], logLevel: 'silent' });
    const js = built.outputFiles.find(f => f.path.endsWith('.js')).text;
    const bundleMap = JSON.parse(built.outputFiles.find(f => f.path.endsWith('.map')).text);
    const [src, line, column] = origin(js, bundleMap, 'whereIsIt');
    assert.ok(src.endsWith('view.jsx'), src);
    assert.deepEqual([line, column], [4, 5]);
    // Without source maps, nothing is appended.
    assert.doesNotMatch(await compile(source), /sourceMappingURL/);
  });

  it('keeps private-use characters of the code when mapping', () => {
    // U+E000 in the code turns the output's anchors off; its own U+E000..U+E001
    // text is code, not an anchor, and stays.
    // (esbuild escapes them in strings, so the classic-factory input is given.)
    const input = 'const s = "abc";\nexport const v = __ren_h("div", { class: "x" }, s);\n';
    const out = transform(input, { sourcemap: true });
    assert.ok(out.includes('"abc"'), out);
    assert.match(out, /__ren_t\(__ren_p0, \[s\]\)/);
    // No anchors, no mappings: none that would point a line at the wrong one.
    const map = JSON.parse(Buffer.from(/base64,(.*)$/m.exec(out)[1], 'base64').toString());
    assert.match(map.mappings, /^;*$/);
  });

  it('compiles, with source maps, code holding U+E000 without a later U+E001', async () => {
    // Run apart: before the fix this looped and grew without end.
    const { Worker } = await import('node:worker_threads');
    const url = import.meta.resolve('ren-core/esbuild');
    const worker = new Worker(
      `import(${JSON.stringify(url)}).then(m => m.compile(${JSON.stringify('/*! icon  glyph */\nexport const v = <div class="x">hi</div>;')}, { sourcemap: true })).then(out => require('node:worker_threads').parentPort.postMessage(out));`,
      { eval: true, resourceLimits: { maxOldGenerationSizeMb: 128 } },
    );
    try {
      const out = await new Promise((resolve, reject) => {
        // timer: deadline, fails the test when compile does not return (the loop it guards).
        const timer = setTimeout(() => reject(new Error('compile did not return')), 10000);
        worker.once('message', out => (clearTimeout(timer), resolve(out)));
        worker.once('error', error => (clearTimeout(timer), reject(error)));
      });
      assert.ok(out.includes('icon  glyph'), out);
      assert.match(out, /__ren_t\(__ren_p0\b/);
      assert.match(out, /sourceMappingURL/);
    } finally {
      await worker.terminate();
    }
  });

  it('compiles TSX through compile()', async () => {
    const out = await compile('const f = (n: number): any => <p title="t">{n as number}</p>;', { loader: 'tsx' });
    assert.match(out, /__ren_t\(__ren_p0, \[n\]\)/);
    assert.doesNotMatch(out, /: number/);
  });
});


describe('the automatic development runtime', () => {
  it('passes a JSX key on to the component, as jsx does', async () => {
    const { jsxDEV } = await import('ren-core/jsx-dev-runtime');
    const { code } = transformSync('view(C => <C key="k1" a={1} />);', { loader: 'jsx', jsx: 'automatic', jsxDev: true, jsxImportSource: 'ren-core', format: 'esm' });
    assert.match(code, /jsxDEV\(C, \{ a: 1 \}, "k1"/);
    let view;
    new Function('jsxDEV', 'view', code.replace(/^import .*\n/m, ''))(jsxDEV, f => { view = f; });
    const lazy = view(props => props);
    assert.deepEqual(lazy.props, { a: 1, key: 'k1' });
  });
});
