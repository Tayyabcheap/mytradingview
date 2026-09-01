/*
 * pineEngine.js — a pragmatic Pine Script (v5/v6) SUBSET interpreter.
 *
 * Runs a pasted script over an array of bars and returns plots + signal shapes,
 * so common indicator/strategy scripts render on the chart like TradingView.
 *
 * Whole-series model: every value is an array over all bars (scalars broadcast).
 *
 * SUPPORTED: inputs (defaults used), assignments (= and :=), one level of if/else,
 *   close/open/high/low/hl2/hlc3/ohlc4/volume/bar_index/time/na,
 *   ta.ema/sma/rma/wma/rsi/atr/tr/highest/lowest/change/mom/stdev/crossover/crossunder/cross,
 *   math.*, operators (+ - * / %, comparisons, and/or/not), ternary ?:, history expr[n],
 *   plot(), plotshape()/plotchar()/plotarrow(), hline(), strategy.entry/exit/close (as BUY/SELL),
 *   color.* and color.new().
 * NOT SUPPORTED (reported as warnings, script still runs): for/while loops, arrays/matrices,
 *   user functions (=>), request.security / multi-timeframe, tables, line/box/label drawing objects,
 *   switch, deep nested ifs. Unknown lines are skipped with a warning.
 */

const NA = NaN;

// ---------- series helpers ----------
const isArr = Array.isArray;
function fill(n, v) { return new Array(n).fill(v); }
function asSeries(v, n) { return isArr(v) ? v : fill(n, v); }

function ema(src, len) {
  const n = src.length, out = fill(n, NA), k = 2 / (len + 1);
  let prev = NA;
  for (let i = 0; i < n; i++) {
    const x = src[i];
    if (isNaN(x)) { out[i] = prev; continue; }
    prev = isNaN(prev) ? x : x * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
function sma(src, len) {
  const n = src.length, out = fill(n, NA);
  let sum = 0, cnt = 0; const q = [];
  for (let i = 0; i < n; i++) {
    const x = src[i];
    q.push(x); if (!isNaN(x)) { sum += x; cnt++; }
    if (q.length > len) { const o = q.shift(); if (!isNaN(o)) { sum -= o; cnt--; } }
    out[i] = q.length >= len ? sum / len : NA;
  }
  return out;
}
function rma(src, len) {
  const n = src.length, out = fill(n, NA), a = 1 / len;
  let prev = NA, seed = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i];
    if (isNaN(x)) { out[i] = prev; continue; }
    if (isNaN(prev)) {
      seed += x; cnt++;
      if (cnt === len) { prev = seed / len; out[i] = prev; } else out[i] = NA;
    } else { prev = a * x + (1 - a) * prev; out[i] = prev; }
  }
  return out;
}
function wma(src, len) {
  const n = src.length, out = fill(n, NA), denom = len * (len + 1) / 2;
  for (let i = 0; i < n; i++) {
    if (i < len - 1) { out[i] = NA; continue; }
    let s = 0, ok = true;
    for (let j = 0; j < len; j++) { const x = src[i - j]; if (isNaN(x)) { ok = false; break; } s += x * (len - j); }
    out[i] = ok ? s / denom : NA;
  }
  return out;
}
function change(src, len = 1) {
  const n = src.length, out = fill(n, NA);
  for (let i = 0; i < n; i++) out[i] = i >= len ? src[i] - src[i - len] : NA;
  return out;
}
function highest(src, len) {
  const n = src.length, out = fill(n, NA);
  for (let i = 0; i < n; i++) { if (i < len - 1) continue; let m = -Infinity; for (let j = 0; j < len; j++) m = Math.max(m, src[i - j]); out[i] = m; }
  return out;
}
function lowest(src, len) {
  const n = src.length, out = fill(n, NA);
  for (let i = 0; i < n; i++) { if (i < len - 1) continue; let m = Infinity; for (let j = 0; j < len; j++) m = Math.min(m, src[i - j]); out[i] = m; }
  return out;
}
function stdev(src, len) {
  const n = src.length, out = fill(n, NA);
  for (let i = 0; i < n; i++) {
    if (i < len - 1) continue;
    let s = 0; for (let j = 0; j < len; j++) s += src[i - j]; const mean = s / len;
    let v = 0; for (let j = 0; j < len; j++) { const d = src[i - j] - mean; v += d * d; }
    out[i] = Math.sqrt(v / len);
  }
  return out;
}
function rsi(src, len) {
  const n = src.length, out = fill(n, NA);
  let ag = 0, al = 0;
  for (let i = 1; i < n; i++) {
    const ch = src[i] - src[i - 1]; const g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
    if (i <= len) { ag += g; al += l; if (i === len) { ag /= len; al /= len; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
    else { ag = (ag * (len - 1) + g) / len; al = (al * (len - 1) + l) / len; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
  }
  return out;
}
function trueRange(h, l, c) {
  const n = h.length, out = fill(n, NA);
  for (let i = 0; i < n; i++) out[i] = i === 0 ? h[i] - l[i] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  return out;
}
function atr(h, l, c, len) { return rma(trueRange(h, l, c), len); }
function crossover(a, b) {
  const n = a.length, out = fill(n, false);
  for (let i = 1; i < n; i++) out[i] = a[i] > b[i] && a[i - 1] <= b[i - 1];
  return out;
}
function crossunder(a, b) {
  const n = a.length, out = fill(n, false);
  for (let i = 1; i < n; i++) out[i] = a[i] < b[i] && a[i - 1] >= b[i - 1];
  return out;
}
function crossany(a, b) { const o = crossover(a, b), u = crossunder(a, b); return o.map((x, i) => x || u[i]); }
function shift(src, k) { const n = src.length, out = fill(n, NA); for (let i = 0; i < n; i++) out[i] = i - k >= 0 ? src[i - k] : NA; return out; }

// element-wise binary
function ew(a, b, f, n) {
  a = asSeries(a, n); b = asSeries(b, n); const out = fill(n, NA);
  for (let i = 0; i < n; i++) out[i] = f(a[i], b[i]);
  return out;
}
function ewu(a, f, n) { a = asSeries(a, n); const out = fill(n, NA); for (let i = 0; i < n; i++) out[i] = f(a[i]); return out; }

// ---------- tokenizer ----------
function tokenize(src) {
  const toks = []; let i = 0; const n = src.length;
  const isIdStart = c => /[A-Za-z_]/.test(c);
  const isId = c => /[A-Za-z0-9_.]/.test(c);
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '"' || c === "'") { const q = c; let j = i + 1, s = ''; while (j < n && src[j] !== q) { s += src[j]; j++; } toks.push({ t: 'str', v: s }); i = j + 1; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) { let j = i, s = ''; while (j < n && /[0-9.]/.test(src[j])) { s += src[j]; j++; } toks.push({ t: 'num', v: parseFloat(s) }); i = j; continue; }
    if (isIdStart(c)) { let j = i, s = ''; while (j < n && isId(src[j])) { s += src[j]; j++; } toks.push({ t: 'id', v: s }); i = j; continue; }
    const two = src.substr(i, 2);
    if (['==', '!=', '<=', '>=', ':=', '=>'].includes(two)) { toks.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/%<>?:()[],='.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    i++; // skip unknown char
  }
  toks.push({ t: 'eof', v: null });
  return toks;
}

// ---------- Pratt parser ----------
function parseExpr(toks) {
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = v => { const t = toks[p]; if (t.v !== v) throw new Error(`expected '${v}' but got '${t.v}'`); p++; };

  function primary() {
    const t = peek();
    if (t.t === 'num') { next(); return { k: 'num', v: t.v }; }
    if (t.t === 'str') { next(); return { k: 'str', v: t.v }; }
    if (t.v === '(') { next(); const e = ternary(); expect(')'); return e; }
    if (t.v === '-') { next(); return { k: 'neg', a: unary() }; }
    if (t.v === 'not') { next(); return { k: 'not', a: unary() }; }
    if (t.t === 'id') {
      const name = t.v; next();
      if (peek().v === '(') { next(); const args = []; const kw = {}; if (peek().v !== ')') { do { args.push(parseArg(kw)); } while (peek().v === ',' && next()); } expect(')'); return { k: 'call', name, args, kw }; }
      return { k: 'id', name };
    }
    throw new Error(`unexpected token '${t.v}'`);
  }
  function parseArg(kw) {
    // keyword arg: id = expr  (but not ==)
    if (peek().t === 'id' && toks[p + 1] && toks[p + 1].v === '=') { const key = next().v; next(); const val = ternary(); kw[key] = val; return { k: 'kw', key, val }; }
    return ternary();
  }
  function postfix() {
    let e = primary();
    while (peek().v === '[') { next(); const idx = ternary(); expect(']'); e = { k: 'hist', a: e, idx }; }
    return e;
  }
  function unary() { const t = peek(); if (t.v === '-') { next(); return { k: 'neg', a: unary() }; } if (t.v === 'not') { next(); return { k: 'not', a: unary() }; } return postfix(); }
  function bin(nextFn, ops) { let e = nextFn(); while (ops.includes(peek().v)) { const op = next().v; const r = nextFn(); e = { k: 'bin', op, a: e, b: r }; } return e; }
  const mul = () => bin(unary, ['*', '/', '%']);
  const add = () => bin(mul, ['+', '-']);
  const cmp = () => bin(add, ['<', '>', '<=', '>=']);
  const eq = () => bin(cmp, ['==', '!=']);
  const and = () => bin(eq, ['and']);
  const or = () => bin(and, ['or']);
  function ternary() { let c = or(); if (peek().v === '?') { next(); const a = ternary(); expect(':'); const b = ternary(); return { k: 'tern', c, a, b }; } return c; }

  const tree = ternary();
  if (peek().t !== 'eof') throw new Error(`unexpected trailing '${peek().v}'`);
  return tree;
}

// ---------- evaluator ----------
function makeEval(ctx) {
  const N = ctx.N;
  const S = v => asSeries(v, N);
  function ev(node) {
    switch (node.k) {
      case 'num': return node.v;
      case 'str': return { __str: node.v };
      case 'neg': return ewu(ev(node.a), x => -x, N);
      case 'not': return ewu(ev(node.a), x => (x ? 0 : 1) ? !x : !x, N).map(x => !x); // boolean
      case 'id': return resolveId(node.name);
      case 'hist': { const a = S(ev(node.a)); const k = scalar(ev(node.idx)); return shift(a, Math.round(k)); }
      case 'bin': return binop(node.op, ev(node.a), ev(node.b));
      case 'tern': { const c = S(ev(node.c)), a = S(ev(node.a)), b = S(ev(node.b)); const out = fill(N, NA); for (let i = 0; i < N; i++) out[i] = c[i] ? a[i] : b[i]; return out; }
      case 'call': return callFn(node.name, node.args.map(ev), node.kw, node.args);
    }
    throw new Error('bad node ' + node.k);
  }
  function scalar(v) { return isArr(v) ? v[v.length - 1] : v; }
  function binop(op, a, b) {
    if (op === 'and') return ew(a, b, (x, y) => (!!x && !!y), N);
    if (op === 'or') return ew(a, b, (x, y) => (!!x || !!y), N);
    const f = {
      '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y, '/': (x, y) => x / y, '%': (x, y) => x % y,
      '<': (x, y) => x < y, '>': (x, y) => x > y, '<=': (x, y) => x <= y, '>=': (x, y) => x >= y,
      '==': (x, y) => x === y, '!=': (x, y) => x !== y
    }[op];
    if (!isArr(a) && !isArr(b)) return f(a, b);
    return ew(a, b, f, N);
  }
  function resolveId(name) {
    if (name in ctx.vars) return ctx.vars[name];
    const b = ctx.builtins[name];
    if (b !== undefined) return typeof b === 'function' ? b() : b;
    ctx.warn(`unknown identifier '${name}' (treated as na)`);
    return fill(N, NA);
  }
  function callFn(name, args, kw, rawArgs) {
    const f = ctx.fns[name];
    if (!f) { ctx.warn(`unsupported function '${name}()' — skipped`); return fill(N, NA); }
    const ekw = {}; for (const k in kw) ekw[k] = ev(kw[k]);
    return f(args, ekw);
  }
  return { ev, scalar };
}

// ---------- color parsing ----------
const COLORS = { red: '#f23645', green: '#089981', lime: '#00e676', blue: '#2962ff', yellow: '#ffd600', orange: '#ff9800', purple: '#9c27b0', white: '#ffffff', black: '#131722', gray: '#787b86', teal: '#00bcd4', maroon: '#b71c1c', navy: '#1a237e', fuchsia: '#e040fb', aqua: '#00e5ff', silver: '#b2b5be', olive: '#808000' };
function colorFromNode(v) { if (v && v.__color) return v.__color; if (v && v.__str) return v.__str; return null; }

// ---------- main compile/run ----------
function compilePine(src) {
  const errors = [], warnings = [];
  // split into logical lines, strip comments, keep indentation
  const rawLines = src.replace(/\r\n/g, '\n').split('\n');
  const lines = [];
  for (let li = 0; li < rawLines.length; li++) {
    let line = rawLines[li];
    // strip // comments (not inside strings)
    let inStr = false, q = '', out = '';
    for (let i = 0; i < line.length; i++) { const c = line[i]; if (inStr) { out += c; if (c === q) inStr = false; } else { if (c === '"' || c === "'") { inStr = true; q = c; out += c; } else if (c === '/' && line[i + 1] === '/') break; else out += c; } }
    const indent = out.match(/^\s*/)[0].replace(/\t/g, '    ').length;
    const text = out.trim();
    if (text) lines.push({ indent, text, ln: li + 1 });
  }

  return { compiled: { lines, errors, warnings }, errors };
}

// Execute the compiled program against bar arrays.
function runPine(src, bars) {
  const errors = [], warnings = [];
  const N = bars.length;
  const open = bars.map(b => b.open), high = bars.map(b => b.high), low = bars.map(b => b.low), close = bars.map(b => b.close), volume = bars.map(b => b.volume ?? 0), time = bars.map(b => b.timestamp);

  const vars = {};
  const plots = [], shapes = [], hlines = [];
  let title = 'Pine Script';
  let overlay = true;

  const builtins = {
    close, open, high, low, volume, time,
    hl2: close.map((c, i) => (high[i] + low[i]) / 2),
    hlc3: close.map((c, i) => (high[i] + low[i] + close[i]) / 3),
    ohlc4: close.map((c, i) => (open[i] + high[i] + low[i] + close[i]) / 4),
    bar_index: close.map((_, i) => i),
    na: NaN, true: 1, false: 0,
  };
  // color.* constants
  for (const k in COLORS) builtins['color.' + k] = { __color: COLORS[k] };
  builtins['strategy.long'] = { __dir: 1 }; builtins['strategy.short'] = { __dir: -1 };
  builtins['location.belowbar'] = { __loc: 'below' }; builtins['location.abovebar'] = { __loc: 'above' }; builtins['location.top'] = { __loc: 'above' }; builtins['location.bottom'] = { __loc: 'below' };
  for (const s of ['shape.triangleup', 'shape.arrowup', 'shape.labelup', 'shape.circle', 'shape.flag']) builtins[s] = { __shape: 'up' };
  for (const s of ['shape.triangledown', 'shape.arrowdown', 'shape.labeldown', 'shape.xcross', 'shape.cross']) builtins[s] = { __shape: 'down' };

  const warn = m => { if (warnings.length < 50 && !warnings.includes(m)) warnings.push(m); };
  const ctxObj = { N, vars, builtins, warn, fns: {} };
  const E = makeEval(ctxObj);
  const S = v => asSeries(v, N);
  const sc = v => (isArr(v) ? v[v.length - 1] : v);

  // function registry
  const fns = ctxObj.fns;
  const num = v => (v && v.__str !== undefined ? v.__str : sc(v));
  fns['ta.ema'] = a => ema(S(a[0]), Math.round(sc(a[1])));
  fns['ta.sma'] = a => sma(S(a[0]), Math.round(sc(a[1])));
  fns['ta.rma'] = a => rma(S(a[0]), Math.round(sc(a[1])));
  fns['ta.wma'] = a => wma(S(a[0]), Math.round(sc(a[1])));
  fns['ta.rsi'] = a => rsi(S(a[0]), Math.round(sc(a[1])));
  fns['ta.atr'] = a => atr(high, low, close, Math.round(sc(a[0])));
  fns['ta.tr'] = () => trueRange(high, low, close);
  fns['ta.highest'] = a => highest(S(a[0]), Math.round(sc(a[1])));
  fns['ta.lowest'] = a => lowest(S(a[0]), Math.round(sc(a[1])));
  fns['ta.change'] = a => change(S(a[0]), a[1] ? Math.round(sc(a[1])) : 1);
  fns['ta.mom'] = a => change(S(a[0]), a[1] ? Math.round(sc(a[1])) : 1);
  fns['ta.stdev'] = a => stdev(S(a[0]), Math.round(sc(a[1])));
  fns['ta.crossover'] = a => crossover(S(a[0]), S(a[1]));
  fns['ta.crossunder'] = a => crossunder(S(a[0]), S(a[1]));
  fns['ta.cross'] = a => crossany(S(a[0]), S(a[1]));
  const m1 = f => a => ewu(S(a[0]), f, N);
  fns['math.abs'] = m1(Math.abs); fns['math.sqrt'] = m1(Math.sqrt); fns['math.floor'] = m1(Math.floor);
  fns['math.ceil'] = m1(Math.ceil); fns['math.round'] = m1(Math.round); fns['math.sign'] = m1(Math.sign); fns['math.log'] = m1(Math.log); fns['math.exp'] = m1(Math.exp);
  fns['math.max'] = a => ew(a[0], a[1], Math.max, N);
  fns['math.min'] = a => ew(a[0], a[1], Math.min, N);
  fns['math.pow'] = a => ew(a[0], a[1], Math.pow, N);
  fns['math.avg'] = a => ew(a[0], a[1], (x, y) => (x + y) / 2, N);
  fns['nz'] = a => ewu(S(a[0]), x => (isNaN(x) ? (a[1] !== undefined ? sc(a[1]) : 0) : x), N);
  fns['na'] = a => ewu(S(a[0]), x => (isNaN(x) ? 1 : 0), N);
  // inputs → defaults
  const inp = a => (a[0] && a[0].__str !== undefined ? a[0].__str : sc(a[0]));
  for (const k of ['input', 'input.int', 'input.float', 'input.bool', 'input.string', 'input.color', 'input.source', 'input.timeframe', 'input.session', 'input.time', 'input.price']) fns[k] = inp;
  fns['color.new'] = a => ({ __color: colorFromNode(a[0]) || '#2962ff' });
  fns['color.rgb'] = a => ({ __color: `rgb(${Math.round(sc(a[0]))},${Math.round(sc(a[1]))},${Math.round(sc(a[2]))})` });
  // header
  const header = (a, kw) => { if (a[0] && a[0].__str) title = a[0].__str; else if (kw.title && kw.title.__str) title = kw.title.__str; if (kw.overlay !== undefined) overlay = !!sc(kw.overlay); return NA; };
  fns['indicator'] = header; fns['strategy'] = header; fns['study'] = header;
  // no-op statement fns (ignore gracefully)
  for (const k of ['alertcondition', 'bgcolor', 'fill', 'barcolor', 'plotcandle', 'label.new', 'line.new', 'box.new', 'table.new', 'table.cell', 'alert', 'strategy.risk.allow_entry_in', 'strategy.exit']) fns[k] = () => NA;

  // plot / shape statement handlers (return via side effects)
  fns['plot'] = (a, kw) => {
    const data = S(a[0]); const color = colorFromNode(kw.color) || colorFromNode(a[1]) || pickColor(plots.length);
    const wArg = kw.linewidth ? Math.round(sc(kw.linewidth)) : 1;
    const titleP = (kw.title && kw.title.__str) || (a[1] && a[1].__str) || `Plot ${plots.length + 1}`;
    plots.push({ data, color, width: Math.max(1, wArg), title: titleP });
    return data;
  };
  fns['hline'] = (a, kw) => { hlines.push({ value: sc(a[0]), color: colorFromNode(kw.color) || '#787b86' }); return NA; };

  function emitShape(condSeries, opts) {
    const c = S(condSeries);
    for (let i = 0; i < N; i++) if (c[i]) shapes.push({ i, dir: opts.dir, color: opts.color, text: opts.text, loc: opts.loc, price: opts.loc === 'above' ? high[i] : low[i] });
  }
  const shapeCall = defaultDir => (a, kw) => {
    const cond = a[0];
    const shp = (kw.style && kw.style.__shape) || null;
    const dir = shp || (kw.location && kw.location.__loc === 'above' ? 'down' : defaultDir);
    const color = colorFromNode(kw.color) || (dir === 'up' ? '#089981' : '#f23645');
    const text = (kw.text && kw.text.__str) || (kw.title && kw.title.__str) || '';
    const loc = (kw.location && kw.location.__loc) || (dir === 'up' ? 'below' : 'above');
    emitShape(cond, { dir, color, text, loc });
    return NA;
  };
  fns['plotshape'] = shapeCall('up');
  fns['plotchar'] = shapeCall('up');
  fns['plotarrow'] = (a) => { const v = S(a[0]); for (let i = 0; i < N; i++) { if (v[i] > 0) shapes.push({ i, dir: 'up', color: '#089981', text: '', loc: 'below', price: low[i] }); else if (v[i] < 0) shapes.push({ i, dir: 'down', color: '#f23645', text: '', loc: 'above', price: high[i] }); } return NA; };
  // strategy entries -> BUY/SELL shapes, gated by current if-mask
  fns['strategy.entry'] = (a, kw, maskCond) => {
    const dirObj = a.find(x => x && x.__dir !== undefined); const dir = dirObj ? dirObj.__dir : 1;
    return { __entry: dir };
  };
  fns['strategy.close'] = () => NA;

  // ---------- statement execution with 1-level if masking ----------
  const { compiled } = compilePine(src);
  const L = compiled.lines;
  let idx = 0;
  const TRUE = fill(N, 1);

  function evalMasked(node, mask) {
    // special handling for statement-level calls that need the mask (strategy.entry, plotshape under if)
    if (node.k === 'call') {
      const nm = node.name;
      const argEvs = node.args.map(x => (x.k === 'kw' ? undefined : E.ev(x)));
      const kwEvs = {}; for (const k in node.kw) kwEvs[k] = E.ev(node.kw[k]);
      if (nm === 'strategy.entry') {
        const dirObj = argEvs.find(x => x && x.__dir !== undefined); const dir = dirObj ? dirObj.__dir : 1;
        for (let i = 0; i < N; i++) if (mask[i]) shapes.push({ i, dir: dir === 1 ? 'up' : 'down', color: dir === 1 ? '#089981' : '#f23645', text: dir === 1 ? 'BUY' : 'SELL', loc: dir === 1 ? 'below' : 'above', price: dir === 1 ? low[i] : high[i] });
        return;
      }
      if (nm === 'plotshape' || nm === 'plotchar') {
        // combine mask with the cond arg
        const cond = S(argEvs[0]); const combined = cond.map((v, i) => v && mask[i]);
        fns[nm]([combined, ...argEvs.slice(1)], kwEvs); return;
      }
      if (nm === 'plotarrow') { fns[nm](argEvs, kwEvs); return; }
      // generic call (plot/hline/alertcondition/etc.)
      if (fns[nm]) { fns[nm](argEvs, kwEvs); return; }
      ctxObj.warn(`unsupported function '${nm}()' — skipped`); return;
    }
    // assignment handled elsewhere
    E.ev(node);
  }

  function processAssignment(text, mask) {
    // strip type keywords
    let t = text.replace(/^(var\s+|varip\s+)?(simple\s+|series\s+|const\s+)?(float|int|bool|string|color)\s+/, '');
    const m = t.match(/^([A-Za-z_]\w*)\s*(:=|=)\s*(.+)$/);
    if (!m) return false;
    const name = m[1], op = m[2], rhs = m[3];
    let val;
    try { val = E.ev(parseExpr(tokenize(rhs))); } catch (e) { errors.push(`line: "${text}" → ${e.message}`); return true; }
    if (mask === TRUE) { vars[name] = val; }
    else { const prev = name in vars ? S(vars[name]) : fill(N, NA); const nv = S(val); const out = fill(N, NA); for (let i = 0; i < N; i++) out[i] = mask[i] ? nv[i] : prev[i]; vars[name] = out; }
    return true;
  }

  function isAssignment(text) {
    let t = text.replace(/^(var\s+|varip\s+)?(simple\s+|series\s+|const\s+)?(float|int|bool|string|color)\s+/, '');
    return /^[A-Za-z_]\w*\s*(:=|=)[^=]/.test(t);
  }

  function runBlock(baseIndent, mask) {
    while (idx < L.length && L[idx].indent >= baseIndent) {
      const line = L[idx];
      if (line.indent > baseIndent) { idx++; continue; } // safety
      const text = line.text;
      if (/^if\b/.test(text)) {
        const condSrc = text.replace(/^if\s+/, '');
        let cond;
        try { cond = S(E.ev(parseExpr(tokenize(condSrc)))); } catch (e) { errors.push(`if "${condSrc}" → ${e.message}`); cond = fill(N, 0); }
        idx++;
        const childIndent = idx < L.length ? L[idx].indent : baseIndent + 4;
        const combined = mask === TRUE ? cond.map(x => (x ? 1 : 0)) : cond.map((x, i) => (x && mask[i]) ? 1 : 0);
        runBlock(childIndent, combined);
        // else
        if (idx < L.length && L[idx].indent === baseIndent && /^else\b/.test(L[idx].text)) {
          idx++;
          const eIndent = idx < L.length ? L[idx].indent : baseIndent + 4;
          const elseMask = mask === TRUE ? cond.map(x => (x ? 0 : 1)) : cond.map((x, i) => (!x && mask[i]) ? 1 : 0);
          runBlock(eIndent, elseMask);
        }
        continue;
      }
      // statement
      try {
        if (isAssignment(text)) processAssignment(text, mask);
        else { const node = parseExpr(tokenize(text)); evalMasked(node, mask); }
      } catch (e) { errors.push(`line "${text}" → ${e.message}`); }
      idx++;
    }
  }

  try { runBlock(0, TRUE); }
  catch (e) { errors.push('fatal: ' + e.message); }

  return { title, overlay, plots: plots.slice(0, 6), shapes, hlines, warnings, errors, bars: N };
}

function pickColor(i) { return ['#2962ff', '#ff9800', '#9c27b0', '#00bcd4', '#ffd600', '#e040fb'][i % 6]; }

const pineRegistry = new Map();   // scriptId -> source
const pineResults = new Map();    // scriptId -> last run result (for draw)

function registerPineScript(id, src) { pineRegistry.set(id, src); }
function runPineById(id, dataList) {
  const src = pineRegistry.get(id);
  if (!src) return null;
  const res = runPine(src, dataList);
  pineResults.set(id, res);
  return res;
}
function getPineResult(id) { return pineResults.get(id); }
function pineMeta(src) {
  const bars = [];
  let p = 100;
  for (let i = 0; i < 120; i++) {
    const o = p, c = o + Math.sin(i / 5) * 1.5 + ((i % 7) - 3) * 0.2;
    const h = Math.max(o, c) + 0.5, l = Math.min(o, c) - 0.5;
    bars.push({ timestamp: (1704067200 + i * 3600) * 1000, open: o, high: h, low: l, close: c, volume: 100 });
    p = c;
  }
  const r = runPine(src, bars);
  return { title: r.title, overlay: r.overlay, plots: r.plots.map(pl => ({ color: pl.color, width: pl.width, title: pl.title })),
           errors: r.errors, warnings: r.warnings, hasShapes: r.shapes.length > 0 };
}

export { runPine, compilePine, pineMeta, registerPineScript, runPineById, getPineResult };
