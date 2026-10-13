// ren-core/esbuild: the ren-core JSX compiler, as an esbuild plugin.
//
// esbuild parses the module (JSX, TypeScript) and emits classic factory
// calls, `__ren_h(type, props, ...children)`; this module then rewrites each
// tree of intrinsic elements (lowercase tags) into a template: its static
// structure becomes a plan made once per module, and every evaluation makes
// a Template holding only the values of its dynamic parts, in evaluation
// order. Where it renders, a DOM host clones its per-document copy of the
// plan's nodes (`cloneNode(true)`) and ren-core binds the dynamic parts by their
// position; other hosts build
// the same nodes through their Host calls. Components, fragments, spreads
// and anything else stay factory calls with the semantics of `jsx`.
//
// A value is static (in the shared template) only when it is a literal the
// DOM keeps as an attribute: text children, and string values of `class`,
// `className`, `style`, `id`, `title`, `role`, `href`, `src`, `alt`, `for`,
// `type`, `name`, `lang`, `dir`, `rel`, `target`, `placeholder`, or literal
// values of any name with a dash (`aria-*`, `data-*`). Every other part
// (handlers, refs, accessors, other properties, children expressions)
// applies per instance exactly as the runtime `jsx` path applies it.
//
// Only esbuild's output is scanned (strings, templates, comments, regular
// expressions and brackets, telling blocks from object literals, so a `/`
// after `}` is a regular expression only after a block; a function or class
// expression's body counts as one, so `function () {} / 2` does not compile). With source maps
// on, every token the rewrite copies keeps an anchor to its input position,
// and the output's map is composed with esbuild's, back to the JSX source.

const FACTORY = '__ren_h';
const FRAGMENT = '__ren_F';
const TEMPLATE = '__ren_t';
const PLAN = '__ren_p';

/** node:fs/promises, loaded where the plugin runs (the types need no Node declarations). */
const FS = 'node:fs/promises';
/** @returns {Promise<any>} */
const files = () => import(FS);

/** Names whose literal string values the DOM keeps as attributes (cloned with the template). */
const STATIC = new Set(['class', 'className', 'style', 'id', 'title', 'role', 'href', 'src', 'alt', 'for', 'type', 'name', 'lang', 'dir', 'rel', 'target', 'placeholder']);
/**
 * Props that replace an element's children, or read them (by tag; `*` for any). The runtime
 * sets props before it appends the children, a template after its children
 * are in place, so an element with one of these and JSX children stays a
 * factory call: both passes then take the runtime path.
 */
const CONTENT = { '*': new Set(['textContent', 'innerText', 'innerHTML']), text: new Set(['a', 'option', 'title', 'script']), value: new Set(['textarea', 'output', 'select']), defaultValue: new Set(['textarea', 'output']), selectedIndex: new Set(['select']) };
/** @param {string} tag @param {string} name */
const content = (tag, name) => CONTENT['*'].has(name) || (name !== '*' && Object.hasOwn(CONTENT, name) && /** @type {any} */ (CONTENT)[name].has(tag));

/** Keywords after which a `/` starts a regular expression. */
const BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const TAG = /^[a-z][a-z0-9]*$/;

/**
 * Compiler options.
 * @typedef {object} Options
 * @property {string=} runtime The module the compiled code imports its helpers from (`ren-core/jsx-runtime`).
 * @property {RegExp=} filter The files the plugin compiles (`/\.[jt]sx$/`).
 * @property {boolean=} sourcemap Append an inline source map (the plugin does when the build makes source maps).
 * @property {any=} map `transform`: the source map of its input (an object or JSON, such as esbuild's), which the output's map is composed with, back to the original source; implies `sourcemap`.
 * @property {string=} filename The source's name in the map.
 */

/** @param {number} c */
const idStart = c => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c === 36 || c > 127;
/** @param {number} c */
const idPart = c => idStart(c) || (c >= 48 && c <= 57);
/** @param {number} c */
const space = c => c === 32 || c === 10 || c === 13 || c === 9 || c === 11 || c === 12 || c === 0xa0 || c === 0xfeff || c === 0x2028 || c === 0x2029;

/**
 * A token of esbuild's output.
 * @typedef {{ t: 'ws' | 'comment' | 'str' | 'tpl' | 'regex' | 'num' | 'id' | 'punct', s: number, e: number, parts?: [number, number][] }} Token
 */

/** @param {string} message @param {number} at */
function fail(message, at) {
  return new Error(`REN esbuild: ${message} at offset ${at}`);
}

/**
 * The token at `i`. `regex` tells whether a `/` there starts a regular expression.
 * @param {string} code @param {number} i @param {boolean} regex
 * @returns {Token}
 */
function lex(code, i, regex) {
  const n = code.length;
  const c = code.charCodeAt(i);
  if (space(c)) {
    let j = i + 1;
    while (j < n && space(code.charCodeAt(j))) j++;
    return { t: 'ws', s: i, e: j };
  }
  if (c === 47) {
    const d = code.charCodeAt(i + 1);
    if (d === 47) {
      let j = code.indexOf('\n', i);
      if (j < 0) j = n;
      return { t: 'comment', s: i, e: j };
    }
    if (d === 42) {
      const j = code.indexOf('*/', i + 2);
      if (j < 0) throw fail('unterminated comment', i);
      return { t: 'comment', s: i, e: j + 2 };
    }
    if (regex) {
      let j = i + 1;
      let set = false;
      for (;;) {
        if (j >= n) throw fail('unterminated regular expression', i);
        const x = code.charCodeAt(j);
        if (x === 92) j += 2;
        else if (x === 10) throw fail('unterminated regular expression', i);
        else {
          if (x === 91) set = true;
          else if (x === 93) set = false;
          else if (x === 47 && !set) break;
          j++;
        }
      }
      j++;
      while (j < n && idPart(code.charCodeAt(j))) j++;
      return { t: 'regex', s: i, e: j };
    }
  }
  if (c === 34 || c === 39) {
    let j = i + 1;
    for (;;) {
      if (j >= n) throw fail('unterminated string', i);
      const x = code.charCodeAt(j);
      if (x === 92) j += 2;
      else if (x === c) break;
      else j++;
    }
    return { t: 'str', s: i, e: j + 1 };
  }
  if (c === 96) {
    /** @type {[number, number][]} */
    const parts = [];
    let j = i + 1;
    for (;;) {
      if (j >= n) throw fail('unterminated template', i);
      const x = code.charCodeAt(j);
      if (x === 92) j += 2;
      else if (x === 96) break;
      else if (x === 36 && code.charCodeAt(j + 1) === 123) {
        const k = scan(code, j + 2, '}');
        parts.push([j + 2, k]);
        j = k + 1;
      } else j++;
    }
    return { t: 'tpl', s: i, e: j + 1, parts };
  }
  if ((c >= 48 && c <= 57) || (c === 46 && code.charCodeAt(i + 1) >= 48 && code.charCodeAt(i + 1) <= 57)) {
    let j = i + 1;
    while (j < n) {
      const x = code.charCodeAt(j);
      if (idPart(x) || x === 46) j++;
      else if ((x === 43 || x === 45) && (code.charCodeAt(j - 1) | 32) === 101 && !/^0[xX]/.test(code.slice(i, j))) j++;
      else break;
    }
    return { t: 'num', s: i, e: j };
  }
  if (idStart(c) || (c === 35 && idStart(code.charCodeAt(i + 1)))) {
    let j = i + 1;
    while (j < n && idPart(code.charCodeAt(j))) j++;
    return { t: 'id', s: i, e: j };
  }
  // ++ and -- are one token (a `/` after them divides), => is one (a block
  // body follows it), and so is ... (a word after it is no property name).
  if ((c === 43 || c === 45) && code.charCodeAt(i + 1) === c) return { t: 'punct', s: i, e: i + 2 };
  if (c === 46 && code.charCodeAt(i + 1) === 46 && code.charCodeAt(i + 2) === 46) return { t: 'punct', s: i, e: i + 3 };
  if (c === 61 && code.charCodeAt(i + 1) === 62) return { t: 'punct', s: i, e: i + 2 };
  return { t: 'punct', s: i, e: i + 1 };
}

/** What an open bracket is: a block, an expression brace (object literal), a parenthesis or square bracket. */
const BLOCK = 0;
const OBJECT = 1;
const GROUP = 2;
/** The parenthesis after if, while, for or with: a statement follows its `)`, so a `/` there starts a regular expression. */
const HEAD = 3;
/** Keywords whose parenthesis a statement follows. */
const BEFORE_STATEMENT = new Set(['if', 'while', 'for', 'with']);
/** Keywords after which a `{` opens an object literal (an expression follows them). */
const BEFORE_EXPRESSION = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'yield', 'await']);

/**
 * The lexical context a scan tracks: whether a `/` starts a regular
 * expression, and what each open bracket is. A `}` that closes a block ends
 * a statement (a `/` after it starts a regular expression); one that closes
 * an object literal ends a value (a `/` after it divides).
 */
class Reader {
  /** @param {boolean} statement true at a statement start, false at an expression's */
  constructor(statement) {
    this.regex = true;
    /** @type {number[]} */
    this.open = [];
    /** The last significant token: a punctuator or word, or '0' for a value; ';' or '(' at the start. */
    this.last = statement ? ';' : '(';
    /** What encloses the scanned range: a statement list, or an expression (an argument, object entries). */
    this.outer = statement ? BLOCK : OBJECT;
  }

  /** @param {string} code @param {Token} tok */
  step(code, tok) {
    const t = tok.t;
    if (t === 'ws' || t === 'comment') return;
    if (t === 'punct') {
      const text = code.slice(tok.s, tok.e);
      if (text === '{') {
        this.open.push(this.brace());
        this.regex = true;
      } else if (text === '}') this.regex = this.open.pop() === BLOCK;
      else if (text === '(' || text === '[') {
        this.open.push(text === '(' && BEFORE_STATEMENT.has(this.last) ? HEAD : GROUP);
        this.regex = true;
      } else if (text === ')' || text === ']') this.regex = this.open.pop() === HEAD; else this.regex = text !== '++' && text !== '--';
      this.last = text;
    } else if (t === 'id') {
      const text = code.slice(tok.s, tok.e);
      // A keyword after `.` (of `.` or `?.`) is a property name, a value.
      const property = this.last === '.';
      // `of` is a keyword only in a for-of head, right after the binding
      // (a name, `]` or `}`); elsewhere it names a value.
      this.regex = !property && BEFORE_REGEX.has(text) && (text !== 'of' || (this.open[this.open.length - 1] === HEAD && this.binding()));
      // `for await (` is a head like `for (`.
      if (!(text === 'await' && this.last === 'for')) this.last = property ? '0' : text;
    } else {
      this.regex = false;
      this.last = '0';
    }
  }

  /** Whether the last token ends a for-of binding: a name (not a declaring or operator word), `]` or `}`. */
  binding() {
    const last = this.last;
    if (last === ']' || last === '}' || last === '0') return true;
    if (!/^[A-Za-z_$]/.test(last)) return false;
    return last === 'of' || !(last === 'let' || last === 'const' || last === 'var' || BEFORE_REGEX.has(last));
  }

  /** What a `{` opens here: a block after a statement end, `)`, `=>` or a word such as else; an object literal after an operator or an expression keyword. */
  brace() {
    const last = this.last;
    if (last === ';' || last === '{' || last === '}' || last === ')' || last === '=>' || last === '0') return BLOCK;
    if (last === ':') {
      // A property value or a ternary branch, unless directly in a block (a label or a case).
      const top = this.open.length > 0 ? this.open[this.open.length - 1] : this.outer;
      return top === BLOCK ? BLOCK : OBJECT;
    }
    const c = last.charCodeAt(0);
    if (idStart(c)) return BEFORE_EXPRESSION.has(last) ? OBJECT : BLOCK;
    return OBJECT;
  }
}

/**
 * The end of the expression at `i`: the first `,` or closing bracket at
 * depth zero that `stops` names.
 * @param {string} code @param {number} i @param {string} stops
 */
function scan(code, i, stops) {
  let depth = 0;
  const reader = new Reader(false);
  while (i < code.length) {
    const tok = lex(code, i, reader.regex);
    if (tok.t === 'punct' && tok.e - tok.s === 1) {
      const c = code[tok.s];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) {
          if (stops.includes(c)) return i;
          throw fail(`unbalanced ${c}`, i);
        }
        depth--;
      } else if (c === ',' && depth === 0 && stops.includes(',')) return i;
    }
    reader.step(code, tok);
    i = tok.e;
  }
  throw fail('unterminated expression', i);
}

/** The range without surrounding white space and comments. @param {string} code @param {number} s @param {number} e @returns {[number, number]} */
function trim(code, s, e) {
  for (;;) {
    while (s < e && space(code.charCodeAt(s))) s++;
    if (code.startsWith('/*', s)) {
      s = code.indexOf('*/', s + 2) + 2;
      continue;
    }
    if (code.startsWith('//', s)) {
      s = code.indexOf('\n', s);
      continue;
    }
    break;
  }
  while (e > s && space(code.charCodeAt(e - 1))) e--;
  return [s, e];
}

/** The value of a string literal. @param {string} text */
function unquote(text) {
  let out = '';
  for (let i = 1; i < text.length - 1; i++) {
    const c = text[i];
    if (c !== '\\') {
      out += c;
      continue;
    }
    const d = text[++i];
    switch (d) {
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'v': out += '\v'; break;
      case '0': out += '\0'; break;
      case 'x':
        out += String.fromCharCode(parseInt(text.slice(i + 1, i + 3), 16));
        i += 2;
        break;
      case 'u':
        if (text[i + 1] === '{') {
          const close = text.indexOf('}', i);
          out += String.fromCodePoint(parseInt(text.slice(i + 2, close), 16));
          i = close;
        } else {
          out += String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16));
          i += 4;
        }
        break;
      case '\r':
        if (text[i + 1] === '\n') i++;
        break;
      case '\n':
      case ' ':
      case ' ':
        break;
      default:
        out += d;
    }
  }
  return out;
}

/**
 * A factory call: its argument ranges and the index after it.
 * @typedef {{ args: [number, number][], end: number }} Call
 */

/** Parses the arguments of the call whose `(` is at `p`. @param {string} code @param {number} p @returns {Call} */
function call(code, p) {
  /** @type {[number, number][]} */
  const args = [];
  let i = p + 1;
  for (;;) {
    const [s] = trim(code, i, code.length);
    if (code[s] === ')') return { args, end: s + 1 };
    const e = scan(code, s, ',)');
    args.push([s, e]);
    if (code[e] === ')') return { args, end: e + 1 };
    i = e + 1;
  }
}

/**
 * What an argument is: a factory call, a literal, or another expression.
 * @typedef {{ kind: 'call', call: Call } | { kind: 'str', value: string } | { kind: 'num', value: number } | { kind: 'bool', value: boolean } | { kind: 'null' } | { kind: 'expr' }} Shape
 */

/** @param {string} code @param {[number, number]} range @returns {Shape} */
function shape(code, range) {
  const [s, e] = trim(code, range[0], range[1]);
  const text = code.slice(s, e);
  if (text.startsWith(FACTORY)) {
    const [p] = trim(code, s + FACTORY.length, e);
    if (code[p] === '(') {
      const c = call(code, p);
      if (c.end === e) return { kind: 'call', call: c };
    }
  }
  const tok = s < e ? lex(code, s, true) : null;
  if (tok !== null && tok.e === e) {
    if (tok.t === 'str') return { kind: 'str', value: unquote(text) };
    // A BigInt (`10n`) has no number value: it stays the expression it is.
    if (tok.t === 'num' && !text.endsWith('n')) return { kind: 'num', value: Number(text.replace(/_/g, '')) };
    if (text === 'true' || text === 'false') return { kind: 'bool', value: text === 'true' };
    if (text === 'null' || text === 'void 0' || text === 'undefined') return { kind: 'null' };
  }
  return { kind: 'expr' };
}

/**
 * The entries of an object literal props argument, or null when it is not
 * one the compiler takes (a spread, a computed key, a method).
 * @param {string} code @param {[number, number]} range
 * @returns {{ name: string, value: [number, number] | string }[] | null}
 */
function entries(code, range) {
  const [s, e] = trim(code, range[0], range[1]);
  if (code[s] !== '{' || code[e - 1] !== '}' || scan(code, s + 1, '}') !== e - 1) return null;
  /** @type {{ name: string, value: [number, number] | string }[]} */
  const out = [];
  let i = s + 1;
  while (i < e - 1) {
    const [a] = trim(code, i, e - 1);
    if (a >= e - 1) break;
    const end = scan(code, a, ',}');
    const [x, y] = trim(code, a, end);
    const tok = lex(code, x, false);
    let name;
    if (tok.t === 'str') name = unquote(code.slice(tok.s, tok.e));
    else if (tok.t === 'id' && code[x] !== '#') name = code.slice(tok.s, tok.e);
    else return null;
    const [k] = trim(code, tok.e, y);
    if (k === y) {
      if (tok.t !== 'id') return null;
      out.push({ name, value: name });
    } else if (code[k] === ':') out.push({ name, value: [k + 1, y] });
    else return null;
    i = end + 1;
  }
  return out;
}

/**
 * The state of one module's compilation: its plans, by tree, and whether
 * the output carries anchors for a source map.
 * @typedef {{ code: string, plans: Map<string, string>, marks: boolean }} Unit
 */

/** An anchor in the output: the input offset the text after it comes from (private-use delimiters, removed before the output is returned). @param {Unit} unit @param {number} at */
const mark = (unit, at) => (unit.marks ? `\uE000${at.toString(36)}\uE001` : '');

/**
 * Rewrites the factory calls in `s`…`e`, which starts a statement (the
 * module) or an expression (an argument, a template substitution).
 * @param {Unit} unit @param {number} s @param {number} e @param {boolean} statement
 * @returns {string}
 */
function rewrite(unit, s, e, statement) {
  const code = unit.code;
  /** @type {string[]} */
  const out = [];
  let i = s;
  const reader = new Reader(statement);
  while (i < e) {
    const tok = lex(code, i, reader.regex);
    if (tok.t === 'id' && tok.e - tok.s === FACTORY.length && code.startsWith(FACTORY, tok.s) && !idPart(code.charCodeAt(tok.e))) {
      const [p] = trim(code, tok.e, e);
      if (code[p] === '(') {
        const c = call(code, p);
        out.push(mark(unit, tok.s), emit(unit, c));
        i = c.end;
        reader.step(code, { t: 'num', s: tok.s, e: c.end });
        continue;
      }
    }
    if (tok.t === 'tpl' && tok.parts !== undefined && tok.parts.length > 0) {
      let at = tok.s;
      for (const [a, b] of tok.parts) {
        out.push(mark(unit, at), code.slice(at, a), rewrite(unit, a, b, false));
        at = b;
      }
      out.push(mark(unit, at), code.slice(at, tok.e));
    } else if (tok.t === 'ws') out.push(code.slice(tok.s, tok.e));
    else out.push(mark(unit, tok.s), code.slice(tok.s, tok.e));
    reader.step(code, tok);
    i = tok.e;
  }
  return out.join('');
}

/** An argument's code, rewritten. @param {Unit} unit @param {[number, number]} range */
const expression = (unit, range) => {
  const [s, e] = trim(unit.code, range[0], range[1]);
  return rewrite(unit, s, e, false);
};

/**
 * A factory call: a template for a tree of intrinsic elements, the factory
 * call (its arguments rewritten) for anything else.
 * @param {Unit} unit @param {Call} c
 */
function emit(unit, c) {
  /** @type {string[]} */
  const values = [];
  const tree = element(unit, c, values);
  if (tree === null) return `${FACTORY}(${c.args.map(a => expression(unit, a)).join(', ')})`;
  let name = unit.plans.get(tree);
  if (name === undefined) {
    name = `${PLAN}${unit.plans.size}`;
    unit.plans.set(tree, name);
  }
  return `${TEMPLATE}(${name}, [${values.join(', ')}])`;
}

/**
 * The plan tree of an intrinsic element call (source of a literal), pushing
 * the code of its dynamic values in evaluation order; null when the call is
 * not one the compiler takes.
 * @param {Unit} unit @param {Call} c @param {string[]} values
 * @returns {string | null}
 */
function element(unit, c, values) {
  const code = unit.code;
  if (c.args.length === 0) return null;
  const type = shape(code, c.args[0]);
  if (type.kind !== 'str' || !TAG.test(type.value)) return null;
  /** @type {{ name: string, value: [number, number] | string }[]} */
  let props = [];
  if (c.args.length > 1) {
    const p = shape(code, c.args[1]);
    if (p.kind !== 'null') {
      const list = entries(code, c.args[1]);
      if (list === null) return null;
      props = list;
    }
  }
  const seen = new Set();
  for (const { name } of props) {
    const alias = name === 'className' ? 'class' : name;
    if (seen.has(alias) || name === 'children') return null;
    // A prop that replaces the children, beside JSX children: the runtime's order.
    if (c.args.length > 2 && content(type.value, name)) return null;
    seen.add(alias);
  }
  /** @type {Record<string, any>} */
  const statics = {};
  let any = false;
  /** @type {(string | number)[]} */
  const dynamic = [];
  // Whether a dynamic prop the element applies has come: key and ref are not
  // such (the runtime skips key, and binds ref after the children).
  let late = false;
  for (const { name, value } of props) {
    if (typeof value !== 'string') {
      const v = shape(code, value);
      const dash = name.includes('-');
      // A literal goes in the template only ahead of every dynamic part: after
      // one it applies after it too, as the runtime applies props in source
      // order (`<a hash={h} href="…">`: href would otherwise land first).
      if (!late && ((v.kind === 'str' && (STATIC.has(name) || dash)) || (dash && (v.kind === 'num' || v.kind === 'bool')))) {
        statics[name] = /** @type {any} */ (v).value;
        any = true;
        continue;
      }
    }
    if (name !== 'key' && name !== 'ref') late = true;
    dynamic.push(JSON.stringify(name), values.length);
    values.push(typeof value === 'string' ? value : expression(unit, value));
  }
  /** @type {string[]} */
  const children = [];
  for (let i = 2; i < c.args.length; i++) {
    const v = shape(code, c.args[i]);
    if (v.kind === 'str') {
      if (v.value !== '') children.push(JSON.stringify(v.value));
    } else if (v.kind === 'num') children.push(JSON.stringify(String(v.value)));
    else if (v.kind === 'bool' || v.kind === 'null') continue;
    else {
      const nested = v.kind === 'call' ? element(unit, v.call, values) : null;
      if (nested !== null) children.push(nested);
      else {
        children.push(String(values.length));
        values.push(v.kind === 'call' ? emit(unit, v.call) : expression(unit, c.args[i]));
      }
    }
  }
  return `[${JSON.stringify(type.value)}, ${any ? JSON.stringify(statics) : 'null'}, [${children.join(', ')}], ${dynamic.length > 0 ? `[${dynamic.join(', ')}]` : 'null'}]`;
}

/**
 * Compiles esbuild's classic-factory output (`jsxFactory: '__ren_h'`,
 * `jsxFragment: '__ren_F'`): templates for intrinsic trees, the runtime's
 * helpers imported, plans hoisted to the top of the module.
 * @param {string} code
 * @param {Options} [options]
 * @returns {string}
 */
export function transform(code, options = {}) {
  const maps = options.map != null || options.sourcemap === true;
  if (!code.includes(FACTORY) && !code.includes(FRAGMENT)) return maps ? code + inline(sourceMap(code, [], options)) : code;
  /** @type {Unit} */
  const unit = { code, plans: new Map(), marks: maps && !code.includes('\uE000') };
  const body = rewrite(unit, 0, code.length, true);
  const runtime = JSON.stringify(options.runtime ?? 'ren-core/jsx-runtime');
  let head = `import { h as ${FACTORY}, Fragment as ${FRAGMENT}, template as ${TEMPLATE}, plan as ${PLAN} } from ${runtime};\n`;
  for (const [tree, name] of unit.plans) head += `const ${name} = /* @__PURE__ */ ${PLAN}(${tree});\n`;
  if (!maps) return head + body;
  // The anchors become the map from the output to `code`, composed with
  // `code`'s own map (esbuild's, back to the JSX source) when there is one.
  /** @type {number[]} */
  const anchors = [];
  let out = head;
  let at = 0;
  // Without anchors (the code holds U+E000 itself), the body's private-use
  // characters are the code's own and stay.
  while (unit.marks) {
    const open = body.indexOf('\uE000', at);
    if (open < 0) break;
    const close = body.indexOf('\uE001', open);
    if (close < 0) break;
    out += body.slice(at, open);
    anchors.push(out.length, parseInt(body.slice(open + 1, close), 36));
    at = close + 1;
  }
  out += body.slice(at);
  return out + inline(sourceMap(code, anchors, options, out));
}

// ---------------------------------------------------------------------------
// Source maps (version 3, base64 VLQ mappings)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** @param {number} n */
function vlq(n) {
  let v = n < 0 ? (-n << 1) | 1 : n << 1;
  let s = '';
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v > 0) digit |= 32;
    s += B64[digit];
  } while (v > 0);
  return s;
}

/**
 * Decodes version 3 mappings: per generated line, segments
 * [column, source, line, column] (the fields after the column are absent
 * for an unmapped segment).
 * @param {string} mappings
 * @returns {number[][][]}
 */
function decode(mappings) {
  /** @type {number[][][]} */
  const lines = [[]];
  let source = 0;
  let line = 0;
  let column = 0;
  let name = 0;
  let generated = 0;
  /** @type {number[]} */
  let fields = [];
  let value = 0;
  let shift = 0;
  const end = () => {
    if (fields.length === 0) return;
    generated += fields[0];
    const segment = [generated];
    if (fields.length >= 4) {
      source += fields[1];
      line += fields[2];
      column += fields[3];
      segment.push(source, line, column);
      if (fields.length >= 5) name += fields[4];
    }
    lines[lines.length - 1].push(segment);
    fields = [];
  };
  for (let i = 0; i < mappings.length; i++) {
    const c = mappings[i];
    if (c === ',') end();
    else if (c === ';') {
      end();
      lines.push([]);
      generated = 0;
    } else {
      const digit = B64.indexOf(c);
      value += (digit & 31) << shift;
      if (digit & 32) shift += 5;
      else {
        fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
        value = 0;
        shift = 0;
      }
    }
  }
  end();
  return lines;
}

/** The offsets where each line of `text` starts. @param {string} text */
function starts(text) {
  const out = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) out.push(i + 1);
  return out;
}

/** The [line, column] of an offset, by binary search over line starts. @param {number[]} lines @param {number} offset */
function position(lines, offset) {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (lines[m] <= offset) lo = m;
    else hi = m - 1;
  }
  return [lo, offset - lines[lo]];
}

/**
 * The source map of the output: `anchors` are (output offset, input offset)
 * pairs; with `options.map` (the input's own map), each lands where the
 * input's map puts the input position (its segment at or before it).
 * @param {string} code the input
 * @param {number[]} anchors
 * @param {{ map?: any, filename?: string }} options
 * @param {string} [out] the output (the input itself when absent)
 */
function sourceMap(code, anchors, options, out = code) {
  const given = options.map == null ? null : typeof options.map === 'string' ? JSON.parse(options.map) : options.map;
  // Nothing rewritten (a module without JSX: types and hooks in a .tsx): the
  // given map already maps the code back to its source.
  if (anchors.length === 0 && given !== null && out === code) return given;
  const input = starts(code);
  const output = starts(out);
  const segments = given === null ? null : decode(given.mappings);
  /** @type {string[]} */
  const lines = [];
  let line = 0;
  let column = 0;
  let previous = { source: 0, line: 0, column: 0 };
  let row = '';
  if (anchors.length === 0 && given === null && out === code) {
    // No rewrite: the output is the input, line for line. (A rewrite without
    // anchors, of code holding U+E000, maps nothing.)
    for (let i = 0; i < input.length; i++) lines.push(i === 0 ? 'AAAA' : 'AACA');
  } else {
    for (let k = 0; k < anchors.length; k += 2) {
      const [gl, gc] = position(output, anchors[k]);
      let [il, ic] = position(input, anchors[k + 1]);
      let source = 0;
      if (segments !== null) {
        const list = segments[il] ?? [];
        let found = null;
        for (let j = 0; j < list.length && list[j][0] <= ic; j++) if (list[j].length >= 4) found = list[j];
        if (found === null) continue;
        source = found[1];
        il = found[2];
        ic = found[3];
      }
      while (line < gl) {
        lines.push(row);
        row = '';
        line++;
        column = 0;
      }
      row += (row === '' ? '' : ',') + vlq(gc - column) + vlq(source - previous.source) + vlq(il - previous.line) + vlq(ic - previous.column);
      column = gc;
      previous = { source, line: il, column: ic };
    }
    lines.push(row);
  }
  return {
    version: 3,
    sources: given?.sources ?? [options.filename ?? 'input.js'],
    sourcesContent: given?.sourcesContent ?? [code],
    names: [],
    mappings: lines.join(';'),
  };
}

/** A map as an inline sourceMappingURL comment. @param {object} map */
function inline(map) {
  const json = JSON.stringify(map);
  const buffer = /** @type {any} */ (globalThis).Buffer;
  let base64;
  if (typeof buffer === 'function') base64 = buffer.from(json).toString('base64');
  else {
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    base64 = btoa(binary);
  }
  return `\n//# sourceMappingURL=data:application/json;base64,${base64}\n`;
}

/**
 * Compiles one JSX or TSX module to JavaScript with ren-core templates.
 * @param {string} source
 * @param {Options & { loader?: 'jsx' | 'tsx', filename?: string, esbuild?: any }} [options]
 * @returns {Promise<string>}
 */
export async function compile(source, options = {}) {
  const esbuild = options.esbuild ?? (await import('esbuild'));
  const maps = options.sourcemap === true;
  const out = await esbuild.transform(source, {
    loader: options.loader ?? 'jsx',
    jsx: 'transform',
    jsxFactory: FACTORY,
    jsxFragment: FRAGMENT,
    target: 'esnext',
    sourcefile: options.filename,
    sourcemap: maps ? 'external' : false,
    sourcesContent: maps,
  });
  return transform(out.code, maps ? { ...options, map: out.map } : options);
}

/**
 * The esbuild plugin: compiles `.jsx` and `.tsx` files (or `filter`) with
 * ren-core templates; other files load as usual.
 *
 *   import { ren } from 'ren-core/esbuild';
 *   await esbuild.build({ entryPoints: ['app.jsx'], bundle: true, plugins: [ren()] });
 *
 * @param {Options} [options]
 * @returns {{ name: string, setup: (build: any) => void }}
 */
export function ren(options = {}) {
  const filter = options.filter ?? /\.[jt]sx$/;
  return {
    name: 'ren',
    setup(build) {
      build.onLoad({ filter }, async (/** @type {{ path: string }} */ args) => {
        const source = await (await files()).readFile(args.path, 'utf8');
        // With source maps on, the contents carry an inline map back to the
        // JSX source, which esbuild composes into the bundle's.
        const sourcemap = options.sourcemap ?? Boolean(build.initialOptions?.sourcemap);
        const contents = await compile(source, { ...options, sourcemap, loader: args.path.endsWith('.tsx') ? 'tsx' : 'jsx', filename: args.path, esbuild: build.esbuild });
        return { contents, loader: 'js' };
      });
    },
  };
}
