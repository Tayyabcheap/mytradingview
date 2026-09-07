/* ------------------------------------------------------------------
 * myBrainsLab.js — the part where the neurons actually do work.
 * ------------------------------------------------------------------
 * Every department owns a slice of one trading pipeline. A neuron holds
 * a genome for its department's slice. To score a genome we run the WHOLE
 * pipeline on real bars with that genome substituted in and every other
 * department using its current champion — cooperative coevolution.
 *
 * That means a Mathematician is measured by what its position sizing does
 * to the desk's actual results, not by a made-up number. Departments are
 * forced to work together because none of them is scored alone.
 *
 * Train on the older 70% of bars, score on the unseen 30%. The gap between
 * the two is reported as "overfit" — it is the single most honest number
 * on the page.
 * ------------------------------------------------------------------ */

/* ============================ bars ============================ */

/* A round trip costs at least the quoted spread. Gold on this account is
 * $0.26 (config.py); for anything else, 1.3 basis points of price is a fair
 * retail starting point. Cost & Capacity may only ever scale this UP. */
import { prepareRays, prepareBlocks, linesAliveAt } from './myBrainsStructure.js';

/* Which timeframes the two structure analysts are allowed to work from, and
 * the pivot width each one uses. A Monthly chart with 14 candles cannot
 * support a 3-candle pivot, so the width shrinks with the timeframe. */
export const TL_TFS = ['1MN', '1W', '1D', '4H'];
export const TL_PIVOT = { '1MN': 1, '1W': 2, '1D': 3, '4H': 3 };
export const OB_TFS = ['1D', '4H', '1H'];
export const OB_IMPULSE = [4, 6, 8];

/* Market structure is expensive to build and identical for every neuron
 * looking at the same chart, so it is built once per (chart, timeframe) and
 * shared. The A+ thresholds are NOT baked in here — they are genes, applied
 * when the event is read — which is what keeps this cache to a handful of
 * entries instead of one per neuron. */
const STRUCT_CACHE = new WeakMap();
export function structFor(bars, kind, tf, pivotW, impulse) {
  let m = STRUCT_CACHE.get(bars);
  if (!m) { m = new Map(); STRUCT_CACHE.set(bars, m); }
  const key = kind + '|' + tf + '|' + pivotW + '|' + (impulse || 0);
  let p = m.get(key);
  if (!p) {
    p = kind === 'ray' ? prepareRays(bars, tf, pivotW) : prepareBlocks(bars, tf, pivotW, impulse);
    m.set(key, p);
  }
  return p;
}
export function structClear(bars) { if (bars) STRUCT_CACHE.delete(bars); }

/* Disciplines the research floor may explore but the Python live trader
 * cannot execute. Audit blocks any champion that uses one, so the robot can
 * never be handed a strategy that was never proven bar-for-bar against the
 * researcher.
 *
 * This list is EMPTY as of the port of modes 7 and 8 to strategy_structure.py
 * — both now pass parity as ordinary comparison cases. It stays here, and
 * stays wired into Audit, because the next new discipline belongs in it on
 * the day it is written and should only come out when parity says so.
 * Must match RESEARCH_ONLY_MODES in strategy_runtime.py. */
export const RESEARCH_ONLY_MODES = [];

export function est_spread(price) {
  if (price > 500) return 0.26;            // gold-ish
  if (price > 20) return price * 0.00013;
  return price * 0.00009;
}

function normaliseBars(json) {
  const rows = Array.isArray(json) ? json : (json && Array.isArray(json.data) ? json.data : null);
  if (!rows || rows.length < 300) return null;
  const n = rows.length;
  const t = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n),
    l = new Float64Array(n), c = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    const ts = r.timestamp != null ? r.timestamp : (r.time != null ? r.time : r.t);
    t[i] = typeof ts === 'string' ? Date.parse(ts) : (ts < 1e11 ? ts * 1000 : ts);
    o[i] = +(r.open != null ? r.open : r.o);
    h[i] = +(r.high != null ? r.high : r.h);
    l[i] = +(r.low != null ? r.low : r.l);
    c[i] = +(r.close != null ? r.close : r.c);
    if (!isFinite(c[i]) || !isFinite(o[i])) return null;
  }
  const mid = c[Math.floor(n / 2)] || 1;
  return { n, t, o, h, l, c, live: true, spread: est_spread(mid) };
}

/* Deterministic stand-in when MT5 is not answering: a regime-switching
 * random walk with a real intraday seasonality baked in, so the
 * Political Analysts' time filters have something genuine to find. */
export function syntheticBars(n = 2600, seed = 20260905, tfMinutes = 60) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const g = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const t = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n),
    l = new Float64Array(n), c = new Float64Array(n);
  let px = 2000, drift = 0, regime = 0, left = 0;
  const start = Date.now() - n * tfMinutes * 60000;
  for (let i = 0; i < n; i++) {
    if (left <= 0) { regime = Math.floor(rnd() * 3); left = 60 + Math.floor(rnd() * 220); drift = (regime === 0 ? 0.00022 : regime === 1 ? -0.00019 : 0) ; }
    left--;
    t[i] = start + i * tfMinutes * 60000;
    const d = new Date(t[i]);
    const hour = d.getUTCHours();
    // London/NY overlap is livelier and trends; the Asian session chops.
    const seas = (hour >= 12 && hour < 17) ? 1.45 : (hour >= 0 && hour < 6) ? 0.55 : 1;
    const vol = 0.0034 * seas;
    const ret = drift * seas + g() * vol;
    const op = px;
    px = px * (1 + ret);
    const wick = Math.abs(g()) * vol * px * 0.8;
    o[i] = op; c[i] = px;
    h[i] = Math.max(op, px) + wick;
    l[i] = Math.min(op, px) - wick;
  }
  return { n, t, o, h, l, c, live: false, spread: 0.26 };
}

/* The default search universe. One instrument caps how independent the book
 * can ever be — two strategies on the same chart correlate whatever their
 * settings say. Different instruments and different timeframes are where
 * genuine independence actually comes from. */
/* What the desk would LIKE to cover, in priority order. The broker decides
 * what actually exists — names carry suffixes (c, m, .r, #, _i) that differ
 * per account, so these are matched as prefixes against the real symbol list
 * rather than used literally. Using literal names is why every instrument
 * fell back to a synthetic series. */
export const WANTED = {
  Forex: ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD',
          'EURJPY', 'GBPJPY', 'AUDJPY', 'EURGBP', 'CHFJPY', 'CADJPY', 'EURAUD',
          'GBPAUD', 'NZDJPY', 'EURCAD', 'AUDNZD'],
  Commodities: ['XAUUSD', 'XAGUSD', 'USOIL', 'UKOIL', 'XPTUSD', 'NGAS'],
  Crypto: ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'LTCUSD', 'ADAUSD', 'DOGEUSD', 'BNBUSD'],
  Indices: ['US30', 'US500', 'USTEC', 'NAS100', 'SPX500', 'GER40', 'UK100', 'JP225'],
  Stocks: ['AAPL', 'TSLA', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'AMD', 'INTC',
           'F', 'NIO', 'PLTR', 'SOFI', 'LCID', 'BAC'],
};

/* how many slots each category gets when the desk covers 20 instruments */
export const QUOTA = { Forex: 9, Commodities: 3, Crypto: 4, Indices: 2, Stocks: 2 };

const norm = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/* Ask the broker what it really has, and build the working universe from
 * that. Falls back to the wanted names only if the symbol list is
 * unreachable — and says so, rather than quietly inventing data. */
export async function discoverUniverse(currentSymbol, timeframe = '1H', maxN = 20) {
  let list = null, reason = '';
  try {
    const r = await fetch('/api/symbols');
    if (!r.ok) throw new Error(`symbols HTTP ${r.status}`);
    const j = await r.json();
    if (j && j.error) throw new Error(j.error);
    if (Array.isArray(j) && j.length) list = j;
    else throw new Error('broker returned an empty symbol list');
  } catch (e) {
    reason = e && e.message ? e.message : String(e);
  }

  if (!list) {
    const specs = [];
    for (const cat of Object.keys(QUOTA)) {
      for (const b of WANTED[cat].slice(0, QUOTA[cat])) specs.push({ symbol: b, timeframe, category: cat });
    }
    return { specs: specs.slice(0, maxN), discovered: false, reason, brokerCount: 0 };
  }

  /* index the broker's symbols by their normalised name */
  const byNorm = new Map();
  for (const s of list) {
    const n = norm(s.name);
    if (!byNorm.has(n)) byNorm.set(n, s);
  }
  const findFor = (base) => {
    const b = norm(base);
    if (byNorm.has(b)) return byNorm.get(b);
    let best = null;
    for (const s of list) {
      const n = norm(s.name);
      if (!n.startsWith(b)) continue;
      if (n.length - b.length > 3) continue;              // EURUSDc yes, EURUSDXYZ no
      if (!best) { best = s; continue; }
      if (!!s.visible && !best.visible) best = s;         // prefer what is in Market Watch
      else if (norm(s.name).length < norm(best.name).length) best = s;
    }
    return best;
  };

  const picked = [];
  const seen = new Set();
  const push = (sym, cat) => {
    if (!sym || seen.has(sym.name)) return false;
    seen.add(sym.name);
    picked.push({ symbol: sym.name, timeframe, category: cat, description: sym.description || '' });
    return true;
  };

  /* the chart you are on always leads */
  if (currentSymbol) {
    const cur = byNorm.get(norm(currentSymbol)) || findFor(currentSymbol);
    if (cur) push(cur, cur.category || 'Forex');
  }

  for (const cat of Object.keys(QUOTA)) {
    let n = 0;
    for (const base of WANTED[cat]) {
      if (n >= QUOTA[cat] || picked.length >= maxN) break;
      if (push(findFor(base), cat)) n++;
    }
  }

  /* still short — top up with anything liquid the broker exposes */
  if (picked.length < maxN) {
    const rest = list.filter(s => !seen.has(s.name) && s.visible !== false)
      .sort((a, b) => (a.spread || 999) - (b.spread || 999));
    for (const s of rest) {
      if (picked.length >= maxN) break;
      push(s, s.category || 'Other');
    }
  }

  return { specs: picked.slice(0, maxN), discovered: true, reason: '', brokerCount: list.length };
}

export async function loadUniverse(specs, count = 2600, onProgress = null) {
  const out = [];
  const CHUNK = 5;                       // twenty sequential fetches is a slow start
  for (let base = 0; base < specs.length; base += CHUNK) {
    const slice = specs.slice(base, base + CHUNK);
    const loaded = await Promise.all(slice.map(async (sp, k) => {
      const i = base + k;
      const bars = await loadBars(sp.symbol, sp.timeframe, count);
      let reason = bars.reason || '';
      if (!bars.live) {
        const alt = syntheticBars(count, 20260905 + i * 7919, TF_MINUTES[sp.timeframe] || 60);
        Object.assign(bars, alt);
        bars.reason = reason;
      }
      return {
        key: `${sp.symbol} ${sp.timeframe}`, symbol: sp.symbol, timeframe: sp.timeframe,
        category: sp.category || '', description: sp.description || '',
        bars, F: new Features(bars), live: bars.live, reason,
      };
    }));
    out.push(...loaded);
    if (onProgress) onProgress(out.length, specs.length);
  }
  return out;
}

export const TF_MINUTES = { '1M': 1, '5M': 5, '15M': 15, '30M': 30, '1H': 60, '4H': 240, '1D': 1440 };

/* A shared calendar so returns from different instruments can be compared.
 * Correlating by bar index across a 1H and a 15M series would be meaningless. */
export function calendarGrid(universe, bucketDays = 7) {
  let t0 = Infinity, t1 = -Infinity;
  for (const u of universe) {
    t0 = Math.min(t0, u.bars.t[0]);
    t1 = Math.max(t1, u.bars.t[u.bars.n - 1]);
  }
  const bucketMs = bucketDays * 86400000;
  return { t0, t1, bucketMs, n: Math.max(4, Math.ceil((t1 - t0) / bucketMs)) };
}

export function bucketByCalendar(tradeLog, grid, fromT, toT) {
  const out = new Float64Array(grid.n);
  for (const tr of tradeLog) {
    if (tr.t < fromT || tr.t >= toT) continue;
    const b = Math.floor((tr.t - grid.t0) / grid.bucketMs);
    if (b >= 0 && b < grid.n) out[b] += tr.R;
  }
  return out;
}

export async function loadBars(symbol, timeframe, count = 2600) {
  try {
    const r = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&count=${count}`);
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    if (j && j.error) throw new Error(j.error);
    const b = normaliseBars(j);
    if (b) return b;
    throw new Error('unusable history payload');
  } catch (e) {
    const b = syntheticBars(count);
    b.reason = e && e.message ? e.message : 'no history';
    return b;
  }
}

/* ========================== indicators ========================== */
/* Cached by period — mutation changes periods constantly, and without a
 * cache we would recompute the same EMA thousands of times a second. */

export class Features {
  constructor(bars) {
    this.b = bars;
    this.n = bars.n;
    this._c = new Map();
    this.hour = new Int8Array(bars.n);
    this.day = new Int8Array(bars.n);
    for (let i = 0; i < bars.n; i++) {
      const d = new Date(bars.t[i]);
      this.hour[i] = d.getUTCHours();   // UTC everywhere, so a session veto
      this.day[i] = d.getUTCDay();      // means the same thing on every machine
    }
  }
  _memo(key, fn) {
    let v = this._c.get(key);
    if (v) return v;
    v = fn();
    if (this._c.size > 500) this._c.clear();
    this._c.set(key, v);
    return v;
  }
  ema(p) {
    return this._memo('e' + p, () => {
      const { n, c } = this.b, out = new Float64Array(n), k = 2 / (p + 1);
      let e = c[0];
      for (let i = 0; i < n; i++) { e = c[i] * k + e * (1 - k); out[i] = e; }
      return out;
    });
  }
  atr(p) {
    return this._memo('a' + p, () => {
      const { n, h, l, c } = this.b, out = new Float64Array(n), k = 1 / p;
      let a = h[0] - l[0];
      for (let i = 0; i < n; i++) {
        const pc = i ? c[i - 1] : c[0];
        const tr = Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc));
        a = i ? a + (tr - a) * k : tr;
        out[i] = a || 1e-9;
      }
      return out;
    });
  }
  rsi(p) {
    return this._memo('r' + p, () => {
      const { n, c } = this.b, out = new Float64Array(n), k = 1 / p;
      let g = 0, ls = 0;
      for (let i = 1; i < n; i++) {
        const d = c[i] - c[i - 1];
        const up = d > 0 ? d : 0, dn = d < 0 ? -d : 0;
        g = i === 1 ? up : g + (up - g) * k;
        ls = i === 1 ? dn : ls + (dn - ls) * k;
        out[i] = ls === 0 ? 100 : 100 - 100 / (1 + g / ls);
      }
      out[0] = 50;
      return out;
    });
  }
  /* current ATR relative to its own slow average: 1.0 = a normal day */
  volRatio(p) {
    return this._memo('v' + p, () => {
      const a = this.atr(p), n = this.n, out = new Float64Array(n), k = 2 / 201;
      let e = a[0];
      for (let i = 0; i < n; i++) { e = a[i] * k + e * (1 - k); out[i] = e > 0 ? a[i] / e : 1; }
      return out;
    });
  }
  /* swing pivots — the raw material for trend lines and for levels */
  pivots(w) {
    return this._memo('p' + w, () => {
      const { n, h, l } = this.b;
      const hi = new Int8Array(n), lo = new Int8Array(n);
      for (let i = w; i < n - w; i++) {
        let isH = true, isL = true;
        for (let j = i - w; j <= i + w; j++) {
          if (j === i) continue;
          if (h[j] >= h[i]) isH = false;
          if (l[j] <= l[i]) isL = false;
          if (!isH && !isL) break;
        }
        hi[i] = isH ? 1 : 0; lo[i] = isL ? 1 : 0;
      }
      return { hi, lo };
    });
  }
  sma(p) {
    return this._memo('m' + p, () => {
      const { n, c } = this.b, out = new Float64Array(n);
      let sum = 0;
      for (let i = 0; i < n; i++) { sum += c[i]; if (i >= p) sum -= c[i - p]; out[i] = sum / Math.min(i + 1, p); }
      return out;
    });
  }
  stdev(p) {
    /* rolling sum of squares: O(n) instead of O(n*p). The naive version was
     * quarter of a million operations every time a genome asked for a new
     * band length, which starved the render loop. */
    return this._memo('s' + p, () => {
      const { n, c } = this.b, out = new Float64Array(n);
      let sum = 0, sq = 0;
      for (let i = 0; i < n; i++) {
        sum += c[i]; sq += c[i] * c[i];
        if (i >= p) { sum -= c[i - p]; sq -= c[i - p] * c[i - p]; }
        const k = Math.min(i + 1, p);
        out[i] = Math.sqrt(Math.max(0, sq / k - (sum / k) * (sum / k)));
      }
      return out;
    });
  }
  /* monotonic-deque rolling extremes: O(n) rather than O(n*p) */
  _roll(key, src, p, cmp) {
    return this._memo(key + p, () => {
      const n = this.n, out = new Float64Array(n);
      const q = new Int32Array(n);
      let head = 0, tail = 0;
      for (let i = 0; i < n; i++) {
        while (tail > head && q[head] <= i - p) head++;
        while (tail > head && cmp(src[q[tail - 1]], src[i])) tail--;
        q[tail++] = i;
        out[i] = src[q[head]];
      }
      return out;
    });
  }
  highest(p) { return this._roll('H', this.b.h, p, (a, b) => a <= b); }
  lowest(p) { return this._roll('L', this.b.l, p, (a, b) => a >= b); }
}

/* =========================== genomes =========================== */

export const GENE_SPECS = {
  data: [
    { k: 'minRangeAtr', lo: 0.05, hi: 1.10, label: 'Min bar range (ATR)' },
    { k: 'maxGapAtr', lo: 0.30, hi: 5.00, label: 'Max gap tolerated (ATR)' },
    { k: 'warmup', lo: 30, hi: 160, int: true, label: 'Warm-up bars discarded' }
  ],
  science: [
    { k: 'mode', lo: 0, hi: 8, int: true, label: 'Analyst discipline',
      enums: ['Trend following', 'Pullback', 'Breakout', 'Trend-line break', 'Support / resistance',
              'Divergence', 'Mean reversion', 'Trend-line (top-down)', 'Order block'] },
    { k: 'fast', lo: 4, hi: 45, int: true, label: 'Fast EMA' },
    { k: 'slow', lo: 18, hi: 170, int: true, label: 'Slow EMA' },
    { k: 'rsiLen', lo: 4, hi: 32, int: true, label: 'RSI length' },
    { k: 'rsiLong', lo: 34, hi: 74, label: 'RSI gate (long)' },
    { k: 'rsiShort', lo: 26, hi: 66, label: 'RSI gate (short)' },
    { k: 'trendLen', lo: 40, hi: 260, int: true, label: 'Trend EMA' },
    { k: 'useTrend', lo: 0, hi: 1, int: true, label: 'Trend filter on' },
    { k: 'breakLen', lo: 8, hi: 60, int: true, label: 'Breakout lookback' },
    { k: 'allowShort', lo: 0, hi: 1, int: true, label: 'Shorts allowed' },
    { k: 'pivotLen', lo: 2, hi: 12, int: true, label: 'Swing pivot width' },
    { k: 'levelTol', lo: 0.08, hi: 1.2, label: 'Level proximity (ATR)' },
    { k: 'divLen', lo: 8, hi: 45, int: true, label: 'Divergence lookback' },
    { k: 'bandLen', lo: 10, hi: 60, int: true, label: 'Band length' },
    { k: 'bandK', lo: 1.2, hi: 3.4, label: 'Band width (sd)' },

    /* ---- the top-down trend-line analyst (mode 7) ----
     * The line is drawn on the higher timeframe and traded on this one. The
     * A+ rules are genes rather than constants because the right number of
     * taps on a Monthly line is not the right number on a 4H line, and the
     * floor is better placed to find that out than I am. */
    { k: 'tlTf', lo: 0, hi: 3, int: true, label: 'Trend-line timeframe',
      enums: ['Monthly', 'Weekly', 'Daily', '4 hour'] },
    { k: 'tlPlay', lo: 0, hi: 1, int: true, label: 'How the line is traded',
      enums: ['Rejection off the line', 'Close through the line'] },
    { k: 'tlMinTaps', lo: 2, hi: 5, int: true, label: 'Touches before it counts' },
    { k: 'tlMinAge', lo: 5, hi: 45, label: 'Line must be this old (days)' },
    { k: 'tlMaxAngle', lo: 15, hi: 60, label: 'Steepest slope allowed (deg)' },

    /* ---- the order block analyst (mode 8) ---- */
    { k: 'obTf', lo: 0, hi: 2, int: true, label: 'Order-block timeframe',
      enums: ['Daily', '4 hour', '1 hour'] },
    { k: 'obImpulse', lo: 0, hi: 2, int: true, label: 'Impulse window',
      enums: ['4 candles', '6 candles', '8 candles'] },
    { k: 'obMaxAge', lo: 2, hi: 45, label: 'Zone goes stale after (days)' },
    { k: 'obConfirm', lo: 0, hi: 1, int: true, label: 'Wait for close back out of zone' }
  ],
  math: [
    { k: 'atrLen', lo: 6, hi: 34, int: true, label: 'ATR length' },
    { k: 'slAtr', lo: 0.5, hi: 4.5, label: 'Stop distance (ATR)' },
    { k: 'rr', lo: 0.7, hi: 4.5, label: 'Reward : risk' },
    { k: 'maxHold', lo: 6, hi: 140, int: true, label: 'Max bars held' }
  ],
  political: [
    { k: 'hourMask', lo: 0, hi: 63, int: true, bits: 6, label: 'Blocked 4h blocks' },
    { k: 'dayMask', lo: 0, hi: 127, int: true, bits: 7, label: 'Blocked weekdays' }
  ],
  legal: [
    { k: 'maxDailyLossR', lo: 1, hi: 9, label: 'Daily loss stop (R)' },
    { k: 'cooldownBars', lo: 0, hi: 28, int: true, label: 'Cool-down after loss' },
    { k: 'maxTradesDay', lo: 2, hi: 12, int: true, label: 'Max trades per day' }
  ],
  investment: [
    { k: 'usePartial', lo: 0, hi: 1, int: true, label: 'Scale out enabled' },
    { k: 'partialAtR', lo: 0.4, hi: 2.6, label: 'Scale-out at (R)' },
    { k: 'partialFrac', lo: 0.1, hi: 0.8, label: 'Fraction scaled out' },
    { k: 'useTrail', lo: 0, hi: 1, int: true, label: 'Trailing stop on' },
    { k: 'trailAtR', lo: 0.4, hi: 3.2, label: 'Trail arms at (R)' },
    { k: 'trailAtr', lo: 0.5, hi: 4.0, label: 'Trail distance (ATR)' }
  ],
  finance: [
    { k: 'riskPct', lo: 0.2, hi: 2.5, label: 'Risk per trade (%)' },
    { k: 'ddThrottle', lo: 0, hi: 1, int: true, label: 'De-risk in drawdown' },
    { k: 'throttleAtDD', lo: 3, hi: 22, label: 'Throttle trigger (% DD)' },
    { k: 'compound', lo: 0, hi: 1, int: true, label: 'Compound gains' }
  ],

  /* ---- Cost & Capacity ------------------------------------------------
   * Owns the assumption about what a round trip really costs. The genes
   * deliberately cannot make cost cheaper than the broker's quoted spread —
   * costMult only ever scales it UP. A department that could evolve its own
   * costs downward would evolve them to zero by the second generation and
   * every result in the building would be a fiction. */
  cost: [
    { k: 'costMult', lo: 1.0, hi: 3.0, label: 'Safety margin on quoted cost' },
    { k: 'slipAtr', lo: 0.0, hi: 0.20, label: 'Assumed slippage (ATR)' },
    { k: 'minEdgeMult', lo: 1.0, hi: 8.0, label: 'Require risk > N x cost' }
  ],

  /* ---- Market Regime --------------------------------------------------- */
  regime: [
    { k: 'mode', lo: 0, hi: 2, int: true, label: 'Regime filter', enums: ['Off', 'Trend only', 'Range only'] },
    { k: 'len', lo: 20, hi: 200, int: true, label: 'Regime lookback' },
    { k: 'thresh', lo: 0.02, hi: 1.2, label: 'Trend strength cut-off' },
    { k: 'volLo', lo: 0.2, hi: 1.0, label: 'Min volatility (x normal)' },
    { k: 'volHi', lo: 1.0, hi: 3.2, label: 'Max volatility (x normal)' }
  ]
};

/* Departments whose work is a genome inside ONE strategy pipeline. */
export const PIPELINE_DEPTS = ['data', 'regime', 'science', 'math', 'political',
                               'legal', 'cost', 'investment', 'finance'];

/* Departments whose work is about the BOOK of strategies, not one strategy.
 * Their genomes are applied in portfolio.js-land, not in runPipeline. */
export const BOOK_SPECS = {
  diversity: [
    { k: 'maxCorr', lo: 0.10, hi: 0.95, label: 'Reject above correlation' },
    { k: 'minDistance', lo: 0.02, hi: 0.60, label: 'Min genome distance' },
    { k: 'bookSize', lo: 2, hi: 10, int: true, label: 'Strategies carried' }
  ],
  portfolio: [
    { k: 'weightMode', lo: 0, hi: 2, int: true, label: 'Weighting', enums: ['Equal', 'Inverse volatility', 'Risk parity'] },
    { k: 'maxWeight', lo: 0.20, hi: 1.0, label: 'Cap on any one strategy' },
    { k: 'volTarget', lo: 2, hi: 25, label: 'Portfolio vol target (%)' }
  ],
  incubation: [
    { k: 'minFolds', lo: 1, hi: 3, int: true, label: 'In-sample folds it must pass' },
    { k: 'minTrades', lo: 8, hi: 60, int: true, label: 'Min trades before full size' },
    { k: 'rampSteps', lo: 1, hi: 4, int: true, label: 'Steps from paper to full' }
  ],
  treasury: [
    { k: 'withdrawPct', lo: 0, hi: 40, label: 'Withdraw % of profit' },
    { k: 'withdrawEvery', lo: 1, hi: 6, int: true, label: 'Withdraw every N months' },
    { k: 'financingBps', lo: 0, hi: 60, label: 'Financing drag (bps/month)' }
  ]
};

export const DEFAULT_GENOMES = {
  data: { minRangeAtr: 0.12, maxGapAtr: 3.0, warmup: 60 },
  science: { mode: 0, tlTf: 2, tlPlay: 0, tlMinTaps: 3, tlMinAge: 21, tlMaxAngle: 45,
             obTf: 1, obImpulse: 1, obMaxAge: 20, obConfirm: 1,
             fast: 21, slow: 50, rsiLen: 14, rsiLong: 52, rsiShort: 48, trendLen: 200, useTrend: 1, breakLen: 20, allowShort: 1,
             pivotLen: 4, levelTol: 0.35, divLen: 20, bandLen: 20, bandK: 2.0 },
  math: { atrLen: 14, slAtr: 1.6, rr: 1.8, maxHold: 48 },
  political: { hourMask: 0, dayMask: 0 },
  legal: { maxDailyLossR: 4, cooldownBars: 0, maxTradesDay: 6 },
  investment: { usePartial: 0, partialAtR: 1.0, partialFrac: 0.5, useTrail: 0, trailAtR: 1.2, trailAtr: 2.0 },
  finance: { riskPct: 1.0, ddThrottle: 0, throttleAtDD: 10, compound: 1 },
  cost: { costMult: 1.3, slipAtr: 0.04, minEdgeMult: 3.0 },
  regime: { mode: 0, len: 60, thresh: 0.25, volLo: 0.5, volHi: 2.2 }
};

export const DEFAULT_BOOK_GENOMES = {
  diversity: { maxCorr: 0.45, minDistance: 0.12, bookSize: 5 },
  portfolio: { weightMode: 1, maxWeight: 0.45, volTarget: 8 },
  incubation: { minFolds: 2, minTrades: 20, rampSteps: 2 },
  treasury: { withdrawPct: 0, withdrawEvery: 3, financingBps: 8 }
};

const q = (v, s) => s.int ? Math.round(Math.min(s.hi, Math.max(s.lo, v))) : Math.min(s.hi, Math.max(s.lo, v));

export function specsFor(dept) { return GENE_SPECS[dept] || BOOK_SPECS[dept] || []; }

export function randomGenome(dept, rnd) {
  const g = {};
  for (const s of specsFor(dept)) g[s.k] = q(s.lo + rnd() * (s.hi - s.lo), s);
  if (dept === 'science' && g.slow <= g.fast) g.slow = Math.min(170, g.fast + 8);
  return g;
}

/* creativity 0..1 — how far a neuron is willing to jump from what it knows */
export function mutate(dept, g, creativity, rnd) {
  const out = { ...g };
  const specs = specsFor(dept);
  const nMut = Math.max(1, Math.round(creativity * specs.length * 0.7));
  for (let m = 0; m < nMut; m++) {
    const s = specs[Math.floor(rnd() * specs.length)];
    if (s.bits) {                             // masks mutate by flipping a bit
      const bit = 1 << Math.floor(rnd() * s.bits);
      out[s.k] = (out[s.k] ^ bit) & ((1 << s.bits) - 1);
      continue;
    }
    const span = (s.hi - s.lo);
    const step = span * (0.04 + creativity * 0.45) * (rnd() * 2 - 1);
    out[s.k] = q(out[s.k] + step, s);
  }
  if (rnd() < creativity * 0.06) return randomGenome(dept, rnd);   // rare leap
  if (dept === 'science' && out.slow <= out.fast) out.slow = q(out.fast + 8, specs.find(x => x.k === 'slow'));
  return out;
}

export function crossover(dept, a, b, rnd) {
  const out = {};
  for (const s of specsFor(dept)) {
    if (s.int || s.bits) out[s.k] = rnd() < 0.5 ? a[s.k] : b[s.k];
    else out[s.k] = q(a[s.k] + (b[s.k] - a[s.k]) * (0.2 + rnd() * 0.6), s);
  }
  if (dept === 'science' && out.slow <= out.fast) out.slow = q(out.fast + 8, GENE_SPECS.science.find(x => x.k === 'slow'));
  return out;
}

export function genomeDistance(dept, a, b) {
  let d = 0, n = 0;
  for (const s of specsFor(dept)) {
    if (s.bits) { d += (a[s.k] === b[s.k] ? 0 : 1); n++; continue; }
    d += Math.abs(a[s.k] - b[s.k]) / (s.hi - s.lo); n++;
  }
  return n ? d / n : 0;
}

/* ====================== the pipeline backtest ====================== */
/* One position at a time. Entry on the next bar's open. Inside a bar the
 * stop is assumed to be hit before the target — never the other way round,
 * because the optimistic assumption is how backtests lie to people. */

/* THE entry decision, in one place. The live Python trader mirrors this exact
 * function and nothing else, and there is a parity test that proves the two
 * agree bar for bar. If you change one, change the other. */
export function entryDir(F, cfg, i, ind) {
  const S = cfg.science;
  const c = F.b.c;
  const emaF = ind ? ind.emaF : F.ema(S.fast);
  const emaS = ind ? ind.emaS : F.ema(S.slow);
  const rsi = ind ? ind.rsi : F.rsi(S.rsiLen);
  const trend = S.useTrend ? (ind && ind.trend ? ind.trend : F.ema(S.trendLen)) : null;
  const hh = S.mode === 2 ? (ind && ind.hh ? ind.hh : F.highest(S.breakLen)) : null;
  const ll = S.mode === 2 ? (ind && ind.ll ? ind.ll : F.lowest(S.breakLen)) : null;
  if (i < 1) return 0;

  let dir = 0;
  const r = rsi[i];
  const M = Math.round(S.mode);

  /* --- the specialist disciplines, in the order the floor names them --- */
  if (M >= 3) {
    const atr = F.atr(cfg.math.atrLen);
    const a = atr[i];
    if (!(a > 0)) return 0;

    if (M === 3) {
      /* Trend-line break: draw the line through the last two swing highs and
       * see whether price has finally come through it. */
      const pv = F.pivots(Math.round(S.pivotLen));
      const look = 160;
      const hs = [], ls = [];
      for (let j = i - 1; j >= Math.max(1, i - look) && (hs.length < 2 || ls.length < 2); j--) {
        if (pv.hi[j] && hs.length < 2) hs.push(j);
        if (pv.lo[j] && ls.length < 2) ls.push(j);
      }
      if (hs.length === 2) {
        const [b2, b1] = [hs[0], hs[1]];               // b1 older, b2 newer
        const slope = (F.b.h[b2] - F.b.h[b1]) / (b2 - b1);
        const line = F.b.h[b2] + slope * (i - b2);
        if (slope < 0 && c[i] > line && c[i - 1] <= line + slope) dir = 1;
      }
      if (!dir && S.allowShort && ls.length === 2) {
        const [b2, b1] = [ls[0], ls[1]];
        const slope = (F.b.l[b2] - F.b.l[b1]) / (b2 - b1);
        const line = F.b.l[b2] + slope * (i - b2);
        if (slope > 0 && c[i] < line && c[i - 1] >= line + slope) dir = -1;
      }
    } else if (M === 4) {
      /* Support and resistance: price came to a level built from old pivots
       * and turned away from it rather than through it. */
      const pv = F.pivots(Math.round(S.pivotLen));
      const tol = S.levelTol * a;
      let sup = null, res = null;
      for (let j = i - 2; j >= Math.max(1, i - 220); j--) {
        if (pv.lo[j] && Math.abs(F.b.l[j] - c[i]) < tol && sup === null) sup = F.b.l[j];
        if (pv.hi[j] && Math.abs(F.b.h[j] - c[i]) < tol && res === null) res = F.b.h[j];
        if (sup !== null && res !== null) break;
      }
      if (sup !== null && F.b.l[i] <= sup + tol * 0.5 && c[i] > sup && c[i] > F.b.o[i]) dir = 1;
      else if (S.allowShort && res !== null && F.b.h[i] >= res - tol * 0.5 && c[i] < res && c[i] < F.b.o[i]) dir = -1;
    } else if (M === 5) {
      /* Divergence: price makes a new extreme, momentum does not follow. */
      const L = Math.round(S.divLen);
      if (i < L + 2) return 0;
      let loIdx = i - L, hiIdx = i - L;
      for (let j = i - L; j < i; j++) {
        if (F.b.l[j] < F.b.l[loIdx]) loIdx = j;
        if (F.b.h[j] > F.b.h[hiIdx]) hiIdx = j;
      }
      if (F.b.l[i] < F.b.l[loIdx] && rsi[i] > rsi[loIdx] && r <= S.rsiShort + 18) dir = 1;
      else if (S.allowShort && F.b.h[i] > F.b.h[hiIdx] && rsi[i] < rsi[hiIdx] && r >= S.rsiLong - 18) dir = -1;
    } else if (M === 6) {
      /* Mean reversion: stretched away from the mean and snapping back. */
      const bl = Math.round(S.bandLen);
      const m = F.sma(bl), sd = F.stdev(bl);
      const up = m[i] + S.bandK * sd[i], dn = m[i] - S.bandK * sd[i];
      const upP = m[i - 1] + S.bandK * sd[i - 1], dnP = m[i - 1] - S.bandK * sd[i - 1];
      if (c[i - 1] < dnP && c[i] > dn) dir = 1;
      else if (S.allowShort && c[i - 1] > upP && c[i] < up) dir = -1;
    } else if (M === 7) {
      /* Top-down trend line. The line lives on a higher timeframe, is drawn
       * through exactly two wick extremes, has never been closed through, and
       * has to clear the A+ bar the floor evolved. The signal is stamped on
       * the base bar the higher-timeframe candle CLOSED on, so nothing here
       * can see inside a candle that has not finished. */
      const tf = TL_TFS[clamp(Math.round(S.tlTf), 0, 3)];
      const prep = structFor(F.b, 'ray', tf, TL_PIVOT[tf]);
      const evs = prep.byBase.get(i);
      if (!evs) return 0;
      const want = Math.round(S.tlPlay) ? 'break' : 'bounce';
      for (const e of evs) {
        if (e.type !== want) continue;
        if (e.taps < S.tlMinTaps) continue;
        if (e.ageDays < S.tlMinAge) continue;
        if (e.angle > S.tlMaxAngle) continue;
        if (e.dir < 0 && !S.allowShort) continue;
        dir = e.dir;
        break;
      }
    } else if (M === 8) {
      /* Order block. The zone only exists if the move out of it closed past
       * the prior swing (structure) and left a gap between candle 1 and
       * candle 3 (displacement). The first return to the zone is the trade
       * and the only trade — a zone price has already been into is spent. */
      const tf = OB_TFS[clamp(Math.round(S.obTf), 0, 2)];
      const imp = OB_IMPULSE[clamp(Math.round(S.obImpulse), 0, 2)];
      const prep = structFor(F.b, 'ob', tf, 3, imp);
      const evs = prep.byBase.get(i);
      if (!evs) return 0;
      const needClose = !!Math.round(S.obConfirm);
      for (const e of evs) {
        if (e.ageDays > S.obMaxAge) continue;
        if (needClose && !e.closedBack) continue;
        if (e.dir < 0 && !S.allowShort) continue;
        dir = e.dir;
        break;
      }
    }
    if (!dir) return 0;
    if (S.useTrend) {
      if (dir > 0 && c[i] < trend[i]) return 0;
      if (dir < 0 && c[i] > trend[i]) return 0;
    }
    return dir;
  }

  if (S.mode === 0) {
    if (emaF[i] > emaS[i] && emaF[i - 1] <= emaS[i - 1] && r >= S.rsiLong) dir = 1;
    else if (S.allowShort && emaF[i] < emaS[i] && emaF[i - 1] >= emaS[i - 1] && r <= S.rsiShort) dir = -1;
  } else if (S.mode === 1) {
    if (emaF[i] > emaS[i] && c[i] < emaF[i] && c[i - 1] >= emaF[i - 1] && r >= S.rsiLong - 12) dir = 1;
    else if (S.allowShort && emaF[i] < emaS[i] && c[i] > emaF[i] && c[i - 1] <= emaF[i - 1] && r <= S.rsiShort + 12) dir = -1;
  } else {
    if (c[i] > hh[i - 1] && r >= S.rsiLong) dir = 1;
    else if (S.allowShort && c[i] < ll[i - 1] && r <= S.rsiShort) dir = -1;
  }
  if (!dir) return 0;
  if (S.useTrend) {
    if (dir > 0 && c[i] < trend[i]) return 0;
    if (dir < 0 && c[i] > trend[i]) return 0;
  }
  return dir;
}

/* Data Analysts' bar-validity rule, also mirrored by the live trader. */
export function barUsable(F, cfg, i, atr) {
  const D = cfg.data, b = F.b;
  const a = atr ? atr[i] : F.atr(cfg.math.atrLen)[i];
  if (!(a > 0) || i < 1) return false;
  if ((b.h[i] - b.l[i]) < D.minRangeAtr * a) return false;
  if (Math.abs(b.o[i] - b.c[i - 1]) > D.maxGapAtr * a) return false;
  return true;
}

/* Market Regime: is this the kind of market this strategy is for?
 * Most strategies do not lose money — they lose money in the wrong regime. */
export function regimeOk(F, cfg, i) {
  const R = cfg.regime;
  if (!R || !R.mode) return true;
  const len = Math.round(R.len);
  if (i < len + 1) return false;
  const e = F.ema(len), a = F.atr(cfg.math.atrLen);
  if (!(a[i] > 0)) return false;
  const strength = Math.abs(e[i] - e[i - len]) / (a[i] * Math.sqrt(len));
  const trending = strength >= R.thresh;
  if (R.mode === 1 && !trending) return false;
  if (R.mode === 2 && trending) return false;
  const vr = F.volRatio(cfg.math.atrLen)[i];
  if (vr < R.volLo || vr > R.volHi) return false;
  return true;
}

export function sessionAllowed(F, cfg, i) {
  const P = cfg.political;
  if ((P.hourMask >> Math.floor(F.hour[i] / 4)) & 1) return false;
  if ((P.dayMask >> F.day[i]) & 1) return false;
  return true;
}

export function runPipeline(F, cfg, i0, i1) {
  const b = F.b;
  const { o, h, l, c, t } = b;
  const D = cfg.data, S = cfg.science, M = cfg.math, P = cfg.political,
    L = cfg.legal, I = cfg.investment, FN = cfg.finance;
  const C = cfg.cost || { costMult: 1, slipAtr: 0, minEdgeMult: 0 };
  const quotedSpread = (b.spread != null ? b.spread : est_spread(c[Math.floor(b.n / 2)] || 1));

  const atr = F.atr(M.atrLen);
  const emaF = F.ema(S.fast);
  const emaS = F.ema(S.slow);
  const rsi = F.rsi(S.rsiLen);
  const trend = S.useTrend ? F.ema(S.trendLen) : null;
  const hh = S.mode === 2 ? F.highest(S.breakLen) : null;
  const ll = S.mode === 2 ? F.lowest(S.breakLen) : null;

  const start = Math.max(i0 + D.warmup, S.slow + 5, S.trendLen * (S.useTrend ? 1 : 0) + 2, 3);
  const end = i1 - 2;

  const Rs = [];
  const tradeLog = [];                     // for the book: when, and how much
  let cum = 0, peak = 0, maxDDR = 0, costR = 0, blockedByCost = 0, blockedByRegime = 0;
  let equity = 10000, eqPeak = 10000, maxEqDD = 0;
  const initial = 10000;

  let dayKey = -1, dayR = 0, dayTrades = 0, cooldownUntil = -1;
  let blockedByLegal = 0, blockedByPolitics = 0, blockedByData = 0, candidates = 0;
  /* Audit evidence: these must stay at zero. If the enforcement above ever
   * stops working, these counters are how anyone finds out. */
  let breachDailyLoss = 0, breachTradeCap = 0, breachCooldown = 0;

  let i = start;
  while (i < end) {
    const dk = Math.floor(t[i] / 86400000);
    if (dk !== dayKey) { dayKey = dk; dayR = 0; dayTrades = 0; }

    /* --- Data Analysts: is this bar even usable? --- */
    const a = atr[i];
    if (!(a > 0)) { i++; continue; }
    const rangeOk = (h[i] - l[i]) >= D.minRangeAtr * a;
    const gapOk = Math.abs(o[i] - c[i - 1]) <= D.maxGapAtr * a;
    if (!rangeOk || !gapOk) { blockedByData++; i++; continue; }

    /* --- Data Scientists: is there a thesis? --- */
    const dir = entryDir(F, cfg, i, { emaF, emaS, rsi, trend, hh, ll });
    if (!dir) { i++; continue; }
    candidates++;

    /* --- Market Regime: right kind of market for this idea? --- */
    if (!regimeOk(F, cfg, i)) { blockedByRegime++; i++; continue; }

    /* --- Political Analysts: is this a session we should be in? --- */
    const blk = Math.floor(F.hour[i] / 4);
    if ((P.hourMask >> blk) & 1) { blockedByPolitics++; i++; continue; }
    if ((P.dayMask >> F.day[i]) & 1) { blockedByPolitics++; i++; continue; }

    /* --- Legal: mandate, daily loss stop, cool-down --- */
    if (i < cooldownUntil) { blockedByLegal++; i++; continue; }
    if (dayTrades >= L.maxTradesDay) { blockedByLegal++; i++; continue; }
    if (dayR <= -L.maxDailyLossR) { blockedByLegal++; i++; continue; }

    /* --- Mathematicians: where does risk sit --- */
    const entry = o[i + 1];
    const risk = M.slAtr * a;
    if (!(risk > 0)) { i++; continue; }

    /* --- Cost & Capacity: is there room for an edge after the costs? ---
     * A stop so tight that the spread eats a fifth of it is not a trade,
     * it is a donation. This filter is where that gets refused. */
    const tradeCost = quotedSpread * C.costMult + 2 * C.slipAtr * a;
    if (C.minEdgeMult > 0 && risk < C.minEdgeMult * tradeCost) { blockedByCost++; i++; continue; }
    const rCost = tradeCost / risk;
    let sl = entry - dir * risk;
    const tp = entry + dir * risk * M.rr;

    /* --- Investment: manage it --- */
    let realized = 0, remaining = 1, tookPartial = false, ext = entry;
    let j = i + 1, exitIdx = i + 1;
    const lastBar = Math.min(i + 1 + M.maxHold, end);
    for (; j <= lastBar; j++) {
      const adverse = dir > 0 ? l[j] : h[j];
      const favour = dir > 0 ? h[j] : l[j];
      if (dir > 0 ? adverse <= sl : adverse >= sl) {
        realized += remaining * ((sl - entry) / risk) * dir;
        exitIdx = j; break;
      }
      if (dir > 0 ? favour >= tp : favour <= tp) {
        realized += remaining * M.rr;
        exitIdx = j; break;
      }
      const mfeR = ((favour - entry) / risk) * dir;
      if (dir > 0 ? favour > ext : favour < ext) ext = favour;
      if (I.usePartial && !tookPartial && mfeR >= I.partialAtR) {
        realized += I.partialFrac * I.partialAtR;
        remaining = 1 - I.partialFrac;
        tookPartial = true;
        sl = entry;                                   // rest rides at breakeven
      }
      if (I.useTrail && mfeR >= I.trailAtR) {
        const cand = ext - dir * I.trailAtr * atr[j];
        if (dir > 0 ? cand > sl : cand < sl) sl = cand;
      }
      exitIdx = j;
    }
    if (j > lastBar) realized += remaining * ((c[lastBar] - entry) / risk) * dir;

    /* every round trip pays the spread and the slippage, always */
    realized -= rCost;
    costR += rCost;

    /* --- Finance: what that trade did to the capital --- */
    let riskPct = FN.riskPct;
    const ddNow = eqPeak > 0 ? (1 - equity / eqPeak) * 100 : 0;
    if (FN.ddThrottle && ddNow > FN.throttleAtDD) riskPct *= 0.5;
    const stake = FN.compound ? equity : initial;
    equity += stake * (riskPct / 100) * realized;
    if (equity > eqPeak) eqPeak = equity;
    const dd = eqPeak > 0 ? (1 - equity / eqPeak) * 100 : 0;
    if (dd > maxEqDD) maxEqDD = dd;
    if (equity <= initial * 0.05) { Rs.push(realized); cum += realized; break; }   // wiped out

    Rs.push(realized);
    tradeLog.push({ i: exitIdx, t: t[exitIdx], R: realized });
    cum += realized;
    if (cum > peak) peak = cum;
    if (peak - cum > maxDDR) maxDDR = peak - cum;
    dayR += realized; dayTrades++;
    if (dayR < -L.maxDailyLossR - 1e-9 && dayTrades > 1) breachDailyLoss++;
    if (dayTrades > L.maxTradesDay) breachTradeCap++;
    if (realized < 0) cooldownUntil = exitIdx + L.cooldownBars;
    i = exitIdx + 1;
  }

  const n = Rs.length;
  let wins = 0, sumWin = 0, sumLoss = 0, sum = 0, sumSq = 0;
  for (const R of Rs) { sum += R; sumSq += R * R; if (R > 0) { wins++; sumWin += R; } else sumLoss -= R; }
  const expectancy = n ? sum / n : 0;
  const sd = n > 1 ? Math.sqrt(Math.max(0, sumSq / n - expectancy * expectancy)) : 0;

  return {
    trades: n,
    winRate: n ? (wins / n) * 100 : 0,
    expectancy,
    profitFactor: sumLoss > 0 ? sumWin / sumLoss : (sumWin > 0 ? 9.99 : 0),
    totalR: sum,
    maxDDR,
    /* Floor the dispersion and cap the result. A slice where every trade
     * returned nearly the same R is a degenerate sample, not an infinitely
     * good one, and an unbounded Sharpe here poisons the trial statistics
     * that the deflated Sharpe depends on. */
    sharpe: n > 1 ? Math.max(-6, Math.min(6, (expectancy / Math.max(sd, 0.20)) * Math.sqrt(Math.min(n, 252)))) : 0,
    equity,
    returnPct: (equity / initial - 1) * 100,
    maxEqDD,
    candidates, tradeLog,
    costR,
    blockedByData, blockedByPolitics, blockedByLegal, blockedByCost, blockedByRegime,
    breaches: breachDailyLoss + breachTradeCap + breachCooldown,
    breachDetail: { dailyLoss: breachDailyLoss, tradeCap: breachTradeCap, cooldown: breachCooldown },
    sd,
    costPerTrade: n ? costR / n : 0,
    tStat: n > 1 ? Math.max(-8, Math.min(8, expectancy / (Math.max(sd, 0.20) / Math.sqrt(n)))) : 0,
    minTrades: minTradesFor(i1 - i0),
    fitness: scoreRun(n, expectancy, sd, maxDDR, (equity / initial - 1) * 100, maxEqDD, i1 - i0)
  };
}

/* A handful of lucky trades is not evidence. Demand activity proportional
 * to how much data the slice actually contains. */
function minTradesFor(bars) { return Math.max(10, Math.round(bars / 120)); }

/* The core of the score is the t-statistic of the R distribution, not raw
 * expectancy. Twelve lucky trades and sixty solid ones stop looking alike
 * the moment you divide by the standard error. */
function scoreRun(n, expectancy, sd, maxDDR, returnPct, maxEqDD, bars) {
  const minN = minTradesFor(bars);
  if (n < minN) return -45 + (n / minN) * 25;           // a desk that never trades is not a desk
  // Floor the dispersion: a run where every trade returned the same R is not
  // infinitely significant, it is a degenerate sample. Without this the
  // t-statistic explodes and the search locks onto a fluke forever.
  const se = Math.max(sd, 0.20) / Math.sqrt(n);
  const t = Math.max(-8, Math.min(8, expectancy / se));
  return t * 6
    + Math.min(n, 80) * 0.06                            // showing up counts for something
    + returnPct * 0.45
    - maxDDR * 1.0
    - maxEqDD * 0.55;
}

/* Three slices, and which one is allowed to influence which decision is
 * the whole ballgame:
 *   TRAIN      — a neuron hill-climbs here. Its own learning signal.
 *   VALIDATION — managers and HODs pick champions here. Selection pressure.
 *   TEST       — touched by NO decision, ever. It exists only to tell you
 *                the truth about what the desk built.
 * Selecting on the test slice would make every out-of-sample number on this
 * page a lie, so nothing in this file is allowed to read test.fitness. */
export const SPLIT = { f1: 0.29, f2: 0.58, valid: 0.78 };

export function evaluateSplit(F, cfg) {
  const n = F.n;
  const a = Math.floor(n * SPLIT.f1);
  const b = Math.floor(n * SPLIT.f2);
  const c = Math.floor(n * SPLIT.valid);
  const f1 = runPipeline(F, cfg, 0, a);
  const f2 = runPipeline(F, cfg, a, b);
  const f3 = runPipeline(F, cfg, b, c);
  const test = runPipeline(F, cfg, c, n);
  const inSample = runPipeline(F, cfg, 0, c);
  // Selection = mean of the in-sample folds, penalised for disagreeing with
  // itself across them. A hard MIN was tried first and is a dead end: once
  // one fold bottoms out on the min-trades penalty, hundreds of different
  // genomes score identically and the search loses its gradient.
  const fs = [f1.fitness, f2.fitness, f3.fitness];
  const mean = (fs[0] + fs[1] + fs[2]) / 3;
  const sd = Math.sqrt(fs.reduce((a, v) => a + (v - mean) * (v - mean), 0) / 3);
  const select = mean - 0.6 * sd;
  const learn = mean;
  return {
    folds: [f1, f2, f3],
    inSample, test,
    learn, select,
    honest: test.fitness,
    gap: inSample.fitness - test.fitness
  };
}

/* ===================== audit: the leak detector ===================== */
/* `select` is supposed to depend on the first 78% of the series and nothing
 * else. Corrupt the held-out tail and re-measure: if the selection number
 * moves by so much as a rounding error, some decision path is reading data
 * it must never see, and every out-of-sample figure on the page is worthless.
 * This is the one check worth the CPU it costs. */
export function leakCheck(bars, cfg) {
  const before = evaluateSplit(new Features(bars), cfg).select;
  const cut = Math.floor(bars.n * SPLIT.valid);
  const c2 = { ...bars, o: Float64Array.from(bars.o), h: Float64Array.from(bars.h), l: Float64Array.from(bars.l), c: Float64Array.from(bars.c) };
  for (let i = cut; i < bars.n; i++) {
    const j = cut + ((i * 7919 + 13) % (bars.n - cut));
    c2.o[i] = bars.o[j]; c2.h[i] = bars.h[j]; c2.l[i] = bars.l[j]; c2.c[i] = bars.c[j];
  }
  const after = evaluateSplit(new Features(c2), cfg).select;
  return { clean: Math.abs(before - after) < 1e-9, before, after, delta: after - before };
}

/* ====================== human-readable output ====================== */

const HOUR_BLOCKS = ['00-04', '04-08', '08-12', '12-16', '16-20', '20-24'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function maskList(mask, bits, names) {
  const out = [];
  for (let i = 0; i < bits; i++) if ((mask >> i) & 1) out.push(names[i]);
  return out;
}

export function describeGene(dept, key, value) {
  const s = specsFor(dept).find(x => x.k === key);
  if (!s) return String(value);
  if (s.enums) return s.enums[Math.round(value)] || String(value);
  if (s.bits) {
    const names = s.bits === 6 ? HOUR_BLOCKS : DAY_NAMES;
    const l = maskList(value, s.bits, names);
    return l.length ? l.join(', ') : 'nothing blocked';
  }
  if (s.int) return String(Math.round(value));
  return value.toFixed(2);
}

export function geneLabel(dept, key) {
  const s = specsFor(dept).find(x => x.k === key);
  return s ? s.label : key;
}

/* One line a human can read about what a department currently believes. */
/* The same thing, said the way a person would say it out loud.
 *
 * Haider asked not to be shown complex stuff. "stop 2.83 ATR(15), target
 * 0.70R, out after 125 bars" is precise and it is also unreadable to the man
 * who owns the firm. Both versions now exist: this one is what the briefing
 * shows, and summariseChampion() sits behind a toggle for when the exact
 * numbers are actually wanted. Neither is dumbed down — they are the same
 * settings, described for different readers. */
export function plainChampion(dept, g) {
  if (!g) return 'not set yet';
  const specs = specsFor(dept);
  for (const spec of specs)
    if (typeof g[spec.k] !== 'number' || !Number.isFinite(g[spec.k])) return 'still being set up';
  const n = (v) => Math.round(v);
  switch (dept) {
    case 'data':
      return `Throws away bars that barely moved, and any bar that opened more than ${g.maxGapAtr.toFixed(1)} times the usual distance from the last close.`;
    case 'science': {
      const m = Math.round(g.mode);
      const how = [
        'Buys when the short average crosses above the long one, and sells when it crosses back.',
        'Waits for a trend, then buys the dip back to the short average instead of chasing.',
        `Buys when price breaks above the highest point of the last ${n(g.breakLen)} bars.`,
        'Draws a line across recent highs or lows and trades the moment price comes through it.',
        'Finds levels price has turned at before, and trades the turn away from them.',
        'Looks for price making a new extreme while momentum quietly fails to follow.',
        'Waits for price to stretch far from its average, then trades the snap back.',
        `Draws ${TL_TFS[clamp(Math.round(g.tlTf), 0, 3)]} trend lines through two wick extremes, keeps only those touched at least ${n(g.tlMinTaps)} times and at least ${n(g.tlMinAge)} days old, then trades the ${Math.round(g.tlPlay) ? 'break through' : 'bounce off'} them.`,
        `Finds the last opposing candle before a sharp move that broke structure and left a gap, then buys or sells the first time price returns to that zone — once only.`,
      ][m] || 'an analyst discipline';
      return how + (g.allowShort ? '' : ' Buys only, never sells short.');
    }
    case 'math':
      return `Risks losing ${g.slAtr.toFixed(1)} times the recent average move on each trade, aims to make ${g.rr.toFixed(1)} times that, and gives up after ${n(g.maxHold)} bars if neither happens.`;
    case 'political': {
      const hrs = maskList(g.hourMask, 6, ['00-04', '04-08', '08-12', '12-16', '16-20', '20-24']);
      const dys = maskList(g.dayMask, 7, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
      if (!hrs.length && !dys.length) return 'Happy to trade any hour of any weekday.';
      return `Refuses to trade${hrs.length ? ` between ${hrs.join(' and ')} UTC` : ''}${hrs.length && dys.length ? ', or' : ''}${dys.length ? ` on ${dys.join(', ')}` : ''}.`;
    }
    case 'legal':
      return `Stops for the day after losing ${g.maxDailyLossR.toFixed(1)} times one trade's risk and never takes more than ${n(g.maxTradesDay)} trades in a day${n(g.cooldownBars) ? `, waiting ${n(g.cooldownBars)} bars after a loss before trying again` : ''}.`;
    case 'investment':
      return `${g.usePartial ? `Takes ${(g.partialFrac * 100).toFixed(0)}% of the profit off the table early` : 'Holds the whole position to the target'}${g.useTrail ? ', then trails the stop behind price to protect the rest.' : ', with a fixed stop throughout.'}`;
    case 'finance':
      return `Puts ${g.riskPct.toFixed(2)}% of the account at risk on each trade${g.compound ? ', growing the stake as the account grows' : ', at a fixed stake'}${g.ddThrottle ? `, and halves that if the account falls ${g.throttleAtDD.toFixed(0)}% from its peak` : ''}.`;
    case 'cost':
      return `Assumes every trade costs ${g.costMult.toFixed(1)} times the spread the broker quotes, and refuses any trade not worth at least ${g.minEdgeMult.toFixed(0)} times that cost.`;
    case 'regime':
      return Math.round(g.mode) === 0
        ? 'Will trade in any kind of market.'
        : `Only trades when the market is ${Math.round(g.mode) === 1 ? 'clearly trending' : 'moving sideways'}, and sits out when it is unusually quiet or unusually wild.`;
    case 'diversity':
      return `Runs at most ${n(g.bookSize)} strategies at once, and turns away any new one that behaves too much like one already running.`;
    case 'portfolio':
      return `Splits the money so the steadier strategies get more of it, and never lets one strategy take more than ${(g.maxWeight * 100).toFixed(0)}% of the book.`;
    case 'incubation':
      return `Nothing goes live until it has worked in ${n(g.minFolds)} of 3 separate periods with at least ${n(g.minTrades)} trades behind it.`;
    case 'treasury':
      return g.withdrawPct > 0
        ? `Takes ${g.withdrawPct.toFixed(0)}% of profit off the table periodically — banked profit cannot be given back.`
        : 'Leaves everything in the account to compound.';
    default:
      return summariseChampion(dept, g);
  }
}

export function summariseChampion(dept, g) {
  if (!g) return '—';
  for (const spec of specsFor(dept)) {
    if (typeof g[spec.k] !== 'number' || !Number.isFinite(g[spec.k])) return 'incomplete genome';
  }
  switch (dept) {
    case 'data': return `keeps bars with range ≥ ${g.minRangeAtr.toFixed(2)} ATR, rejects gaps > ${g.maxGapAtr.toFixed(1)} ATR`;
    case 'science': {
      /* The structure disciplines do not use the moving averages, so listing
       * them on the card would describe a strategy that is not running. */
      const name = GENE_SPECS.science[0].enums[Math.round(g.mode)];
      const tail = `${g.useTrend ? ` · trend EMA ${Math.round(g.trendLen)}` : ''}${g.allowShort ? '' : ' · long only'}`;
      if (Math.round(g.mode) === 7)
        return `${name} · ${TL_TFS[clamp(Math.round(g.tlTf), 0, 3)]} lines · ${Math.round(g.tlPlay) ? 'trades the close through' : 'trades the rejection off'} · needs ${Math.round(g.tlMinTaps)} touches, ${Math.round(g.tlMinAge)} days old, under ${Math.round(g.tlMaxAngle)}°${tail}`;
      if (Math.round(g.mode) === 8)
        return `${name} · ${OB_TFS[clamp(Math.round(g.obTf), 0, 2)]} zones · ${OB_IMPULSE[clamp(Math.round(g.obImpulse), 0, 2)]}-candle impulse · fresh for ${Math.round(g.obMaxAge)} days · ${Math.round(g.obConfirm) ? 'waits for a close back out' : 'enters on touch'}${tail}`;
      return `${name} · EMA ${Math.round(g.fast)}/${Math.round(g.slow)} · RSI(${Math.round(g.rsiLen)}) gate ${g.rsiLong.toFixed(0)}/${g.rsiShort.toFixed(0)}${tail}`;
    }
    case 'math': return `stop ${g.slAtr.toFixed(2)} ATR(${Math.round(g.atrLen)}), target ${g.rr.toFixed(2)}R, out after ${Math.round(g.maxHold)} bars`;
    case 'political': {
      const h = maskList(g.hourMask, 6, HOUR_BLOCKS), d = maskList(g.dayMask, 7, DAY_NAMES);
      if (!h.length && !d.length) return 'no session or weekday currently vetoed';
      return `vetoes ${[h.length ? h.join('/') + ' UTC' : null, d.length ? d.join('/') : null].filter(Boolean).join(' and ')}`;
    }
    case 'legal': return `stop the day at −${g.maxDailyLossR.toFixed(1)}R, max ${Math.round(g.maxTradesDay)} trades/day, ${Math.round(g.cooldownBars)} bar cool-down after a loss`;
    case 'investment': return `${g.usePartial ? `scale ${(g.partialFrac * 100).toFixed(0)}% out at ${g.partialAtR.toFixed(2)}R` : 'no scale-out'} · ${g.useTrail ? `trail ${g.trailAtr.toFixed(1)} ATR from ${g.trailAtR.toFixed(2)}R` : 'no trail'}`;
    case 'finance': return `${g.riskPct.toFixed(2)}% risk/trade${g.compound ? ', compounding' : ', fixed stake'}${g.ddThrottle ? `, halve risk past ${g.throttleAtDD.toFixed(0)}% DD` : ''}`;
    case 'cost': return `assume costs are ${g.costMult.toFixed(2)}x the quoted spread plus ${g.slipAtr.toFixed(2)} ATR of slippage, and refuse any trade whose risk is under ${g.minEdgeMult.toFixed(1)}x that`;
    case 'regime': return g.mode === 0
      ? 'no regime filter — trades every market state'
      : `${GENE_SPECS.regime[0].enums[g.mode].toLowerCase()}, trend cut-off ${g.thresh.toFixed(2)} over ${Math.round(g.len)} bars, volatility ${g.volLo.toFixed(1)}x-${g.volHi.toFixed(1)}x normal`;
    case 'diversity': return `carry at most ${Math.round(g.bookSize)} strategies, reject anything correlating above ${g.maxCorr.toFixed(2)} or closer than ${g.minDistance.toFixed(2)} to one we run`;
    case 'portfolio': return `${BOOK_SPECS.portfolio[0].enums[g.weightMode].toLowerCase()} weighting, no strategy above ${(g.maxWeight * 100).toFixed(0)}% of the book, ${g.volTarget.toFixed(0)}% volatility target`;
    case 'incubation': return `nothing goes live until it clears ${Math.round(g.minFolds)} of 3 folds with ${Math.round(g.minTrades)}+ trades, ramped in ${Math.round(g.rampSteps)} step${g.rampSteps > 1 ? 's' : ''}`;
    case 'treasury': return g.withdrawPct > 0
      ? `bank ${g.withdrawPct.toFixed(0)}% of profit every ${Math.round(g.withdrawEvery)} months; financing drag ${g.financingBps.toFixed(0)} bps/month`
      : `nothing withdrawn — everything left to compound; financing drag ${g.financingBps.toFixed(0)} bps/month`;
    default: return '—';
  }
}

/* ==================================================================
 * THE BOOK — many strategies, and the departments that curate them
 * ==================================================================
 * One strategy cannot compound safely at a high rate. k INDEPENDENT
 * strategies sharing one risk budget deliver sqrt(k) times the return at the
 * same volatility — that is the only lever in this whole system that raises
 * return without raising ruin.
 *
 * The catch, and the reason Alpha Diversity exists as a department: the
 * benefit is in the word INDEPENDENT. Fifty strategies correlated at 0.6
 * behave like 1.7 of them. Profitable-but-duplicated is worth almost nothing,
 * so this code is allowed to reject a profitable strategy.
 */

const BUCKET = 40;   // bars per bucket; correlating raw per-trade series is
                     // mostly correlating zeros, which flatters everything

export function bucketSeries(tradeLog, i0, i1) {
  const nb = Math.max(1, Math.ceil((i1 - i0) / BUCKET));
  const out = new Float64Array(nb);
  for (const tr of tradeLog) {
    if (tr.i < i0 || tr.i >= i1) continue;
    out[Math.min(nb - 1, Math.floor((tr.i - i0) / BUCKET))] += tr.R;
  }
  return out;
}

export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 4) return 0;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  if (da <= 1e-12 || db <= 1e-12) return 0;
  return num / Math.sqrt(da * db);
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length);
}

/* One strategy, measured once and then cached. Everything the book
 * departments do afterwards is vector maths over these. */
export function makeCandidate(F, cfg, id, instrument, grid) {
  const n = F.n;
  const c = Math.floor(n * SPLIT.valid);
  const ev = evaluateSplit(F, cfg);
  const foldsPositive = ev.folds.filter(f => f.fitness > 0).length;
  const splitT = F.b.t[c];
  const endT = F.b.t[n - 1] + 1;
  const g = grid || { t0: F.b.t[0], bucketMs: 7 * 86400000, n: Math.max(4, Math.ceil((endT - F.b.t[0]) / (7 * 86400000))) };
  /* Where this was bred is not a label — the live trader needs the symbol and
   * timeframe to run it. A book entry without them cannot be traded. */
  const inst = (instrument && typeof instrument === 'object') ? instrument : null;
  return {
    id: id || ('s' + Math.random().toString(36).slice(2, 8)),
    cfg: JSON.parse(JSON.stringify(cfg)),
    instrument: inst ? inst.key : (instrument || 'default'),
    symbol: inst ? inst.symbol : null,
    timeframe: inst ? inst.timeframe : null,
    live: inst ? !!inst.live : false,
    born: Date.now(),
    fit: ev.select, honest: ev.honest, gap: ev.gap,
    trades: ev.test.trades, inTrades: ev.inSample.trades, foldsPositive,
    metrics: ev.test,
    inSeries: bucketByCalendar(ev.inSample.tradeLog, g, g.t0, splitT),
    testSeries: bucketByCalendar(ev.test.tradeLog, g, splitT, endT),
  };
}

/* Does this strategy work anywhere other than the chart it was bred on?
 * The cheapest and harshest overfitting test available to this firm. */
export function crossInstrument(universe, cfg, exceptKey) {
  const rows = [];
  for (const u of universe) {
    if (u.key === exceptKey) continue;
    const ev = evaluateSplit(u.F, cfg);
    rows.push({ key: u.key, select: ev.select, honest: ev.honest, trades: ev.inSample.trades });
  }
  const positive = rows.filter(r => r.select > 0).length;
  return { rows, positive, total: rows.length };
}

/* ==================================================================
 * POOLED EVIDENCE — counting the trades the firm actually took
 * ==================================================================
 * Audit used to ask "does this strategy have enough trades on unseen data",
 * and it asked one chart. On a 15-minute chart of one pair a slow strategy
 * produces eight trades in the held-out slice, so it was blocked for being
 * slow rather than for being wrong — and the two structure analysts, which
 * fire 20-90 times a YEAR, could never have cleared that bar at all.
 *
 * The firm runs twenty instruments. The same genome on a different
 * instrument is not a second look at the same evidence, it is genuinely new
 * evidence — and a harsher test than the chart it was bred on, because
 * nothing was tuned to it.
 *
 * The catch, and the reason this is not simply 20x more evidence: EURUSD and
 * GBPUSD are largely the same bet. Twenty correlated instruments do not
 * carry twenty instruments' worth of information. So the count is discounted
 * by the same k_eff formula the book uses on its own strategies:
 *
 *     mEff = m / (1 + (m - 1) * rho)
 *
 * Pooled evidence therefore RAISES the bar for a book of near-identical
 * forex pairs and LOWERS it for a genuinely spread universe, which is the
 * behaviour you want from an honest counter. */

export function pooledEvidence(universe, cfg, grid) {
  const rows = [];
  const series = [];
  let trades = 0, wins = 0, sumR = 0, sumR2 = 0;
  const g = grid || calendarGrid(universe);

  for (const u of universe) {
    let ev = null;
    try { ev = evaluateSplit(u.F, cfg); } catch (e) { ev = null; }
    const t = ev && ev.test;
    if (!t || !Number.isFinite(t.expectancy)) { rows.push(null); series.push(null); continue; }
    const n = t.trades || 0;
    rows.push({ key: u.key, symbol: u.symbol || u.key, trades: n,
                expectancy: t.expectancy, fitness: t.fitness, live: !!u.live });
    if (n > 0) {
      trades += n;
      wins += Math.round((t.winRate || 0) / 100 * n);
      sumR += t.expectancy * n;
      sumR2 += (t.expectancy * t.expectancy + (t.sd || 0.5) * (t.sd || 0.5)) * n;
    }
    const c = Math.floor(u.F.n * SPLIT.valid);
    series.push(bucketByCalendar(t.tradeLog || [], g, u.F.b.t[c], u.F.b.t[u.F.n - 1] + 1));
  }
  const kept = rows.filter(Boolean);

  const m = kept.filter(r => r.trades > 0).length;

  /* How much do these instruments repeat each other?
   *
   * NOT measured from the trade log. Over a held-out slice a strategy leaves
   * a handful of trades scattered across dozens of weekly buckets, so those
   * series are almost entirely zeros — and the correlation of two mostly-zero
   * vectors is driven by the shared zeros, not by any relationship. It reads
   * ~0.5 for instruments that have nothing to do with each other.
   *
   * Measured instead from the instruments' own returns over the same window,
   * which is dense, stable, and is the real question: EURUSD and GBPUSD are
   * largely one bet whether or not this particular strategy traded them. */
  const denseFor = (u) => {
    const c = Math.floor(u.F.n * SPLIT.valid);
    const b = u.F.b, step = Math.max(1, Math.floor((b.n - c) / 120));
    const out = [];
    for (let i = c + step; i < b.n; i += step) {
      const prev = b.c[i - step];
      out.push(prev > 0 ? (b.c[i] - prev) / prev : 0);
    }
    return out;
  };
  const dense = [];
  for (let i = 0; i < universe.length; i++)
    if (rows[i] && rows[i].trades > 0) dense.push(denseFor(universe[i]));

  let sum = 0, pairs = 0;
  for (let i = 0; i < dense.length; i++)
    for (let j = i + 1; j < dense.length; j++) {
      const len = Math.min(dense[i].length, dense[j].length);
      if (len < 12) continue;
      const r = pearson(dense[i].slice(0, len), dense[j].slice(0, len));
      if (Number.isFinite(r)) { sum += Math.abs(r); pairs++; }
    }
  const rho = pairs ? sum / pairs : 0;
  const mEff = m ? m / (1 + (m - 1) * rho) : 0;

  const expectancy = trades ? sumR / trades : 0;
  const variance = trades ? Math.max(0.04, sumR2 / trades - expectancy * expectancy) : 1;
  const sd = Math.sqrt(variance);
  /* Evidence, discounted for how much the instruments repeat each other.
   * Never claims more than the raw count, and never less than one chart's. */
  const tradesEff = m ? Math.round(trades * (mEff / m)) : 0;
  let tStat = tradesEff > 1 ? (expectancy / sd) * Math.sqrt(tradesEff) : 0;
  if (!Number.isFinite(tStat)) tStat = 0;
  tStat = Math.max(-8, Math.min(8, tStat));

  return {
    rows: kept, instruments: m, tested: kept.length,
    trades, tradesEff, rho, mEff,
    expectancy, sd, tStat,
    winRate: trades ? (wins / trades) * 100 : 0,
    positive: kept.filter(r => r.trades > 0 && r.expectancy > 0).length,
    /* A flat bar, applied to evidence that is now counted honestly. Twenty
     * trades is roughly where a t-statistic starts to mean anything; the old
     * per-chart 10 was low precisely because one chart could rarely reach
     * more. Stricter on paper, and reachable for the first time. */
    minTrades: 20,
  };
}

/* Alpha Diversity + Strategy Incubation + Portfolio Construction, in the
 * order a real firm applies them: gate, then de-duplicate, then weight. */
export function assembleBook(candidates, bookG) {
  const DIV = bookG.diversity, INC = bookG.incubation, PF = bookG.portfolio;
  const rejected = [];

  /* Incubation: nothing reaches the book on the strength of one lucky fold */
  const eligible = candidates.filter(cd => {
    if (cd.foldsPositive < INC.minFolds) { rejected.push({ id: cd.id, why: 'failed incubation: not enough folds positive' }); return false; }
    /* evidence is counted over the whole in-sample history, not the short
     * held-out tail — otherwise a good slow strategy is rejected for being slow */
    if (cd.inTrades < INC.minTrades) { rejected.push({ id: cd.id, why: `failed incubation: only ${cd.inTrades} trades of history` }); return false; }
    return true;
  }).sort((x, y) => y.fit - x.fit);

  /* Alpha Diversity: admit greedily, rejecting anything that duplicates
   * risk the book already carries — even when it is profitable. */
  const admitted = [];
  for (const cd of eligible) {
    if (admitted.length >= DIV.bookSize) break;
    let worst = 0, dup = null;
    for (const held of admitted) {
      const r = Math.abs(pearson(cd.inSeries, held.inSeries));
      if (r > worst) { worst = r; dup = held; }
    }
    let minDist = 1;
    for (const held of admitted) {
      let d = 0;
      for (const dept of PIPELINE_DEPTS) d += genomeDistance(dept, cd.cfg[dept], held.cfg[dept]);
      minDist = Math.min(minDist, d / PIPELINE_DEPTS.length);
    }
    if (worst > DIV.maxCorr) { rejected.push({ id: cd.id, why: `correlates ${worst.toFixed(2)} with ${dup.id}` }); continue; }
    if (admitted.length && minDist < DIV.minDistance) { rejected.push({ id: cd.id, why: `too similar to what we already run (distance ${minDist.toFixed(2)})` }); continue; }
    admitted.push(cd);
  }

  /* the honest headline: how many independent bets does the book really hold */
  let sumCorr = 0, pairs = 0;
  for (let i = 0; i < admitted.length; i++)
    for (let j = i + 1; j < admitted.length; j++) {
      sumCorr += Math.abs(pearson(admitted[i].inSeries, admitted[j].inSeries)); pairs++;
    }
  const avgCorr = pairs ? sumCorr / pairs : 0;
  const k = admitted.length;
  const kEff = k ? k / (1 + (k - 1) * avgCorr) : 0;

  /* Portfolio Construction: weights, capped, then scaled to a vol target */
  let w = admitted.map(() => 1);
  if (PF.weightMode === 1) w = admitted.map(cd => 1 / Math.max(0.05, stdev(Array.from(cd.inSeries))));
  else if (PF.weightMode === 2) w = admitted.map(cd => {
    const sd = Math.max(0.05, stdev(Array.from(cd.inSeries)));
    return Math.max(0, cd.fit) / (sd * sd);
  });
  let tot = w.reduce((a, b) => a + b, 0) || 1;
  w = w.map(x => x / tot);
  w = w.map(x => Math.min(x, PF.maxWeight));
  tot = w.reduce((a, b) => a + b, 0) || 1;
  w = w.map(x => x / tot);

  return { admitted, rejected, weights: w, avgCorr, kEff, eligible: eligible.length };
}

function blend(admitted, weights, key) {
  if (!admitted.length) return new Float64Array(0);
  const len = Math.min(...admitted.map(c => c[key].length));
  const out = new Float64Array(len);
  admitted.forEach((cd, i) => { for (let j = 0; j < len; j++) out[j] += weights[i] * cd[key][j]; });
  return out;
}

/* Treasury takes money off the table. It lowers the final equity and it
 * lowers the chance of ending with nothing — banked profit is the only
 * profit that cannot be given back. */
export function portfolioResult(admitted, weights, bookG, key) {
  const series = blend(admitted, weights, key);
  const PF = bookG.portfolio, TR = bookG.treasury;
  const arr = Array.from(series);
  const sd = stdev(arr) || 1e-9;
  // scale the book so a typical bucket moves equity by the vol target
  const scale = Math.min(1.5, (PF.volTarget / 100) / sd);
  let eq = 1, peak = 1, maxDD = 0, withdrawn = 0;
  const curve = [];
  for (let i = 0; i < arr.length; i++) {
    eq *= (1 + Math.max(-0.9, Math.min(0.9, arr[i] * scale)));
    eq *= (1 - TR.financingBps / 10000 / 12);
    if (TR.withdrawPct > 0 && i > 0 && i % (TR.withdrawEvery * 4) === 0 && eq > 1) {
      const take = (eq - 1) * (TR.withdrawPct / 100);
      withdrawn += take; eq -= take;
    }
    eq = Math.max(eq, 0.01);
    peak = Math.max(peak, eq);
    maxDD = Math.max(maxDD, 1 - eq / peak);
    curve.push(eq);
  }
  const m = mean(arr), s = stdev(arr) || 1e-9;
  let sharpe = m / s * Math.sqrt(Math.max(1, arr.length));
  if (!Number.isFinite(sharpe)) sharpe = 0;
  return {
    curve, equity: eq, withdrawn, wealth: eq + withdrawn,
    returnPct: (eq + withdrawn - 1) * 100, maxDD: maxDD * 100,
    sharpe, buckets: arr.length,
    /* log wealth, not raw percentage: a compounded curve can reach absurd
     * numbers and then dominate the score for arithmetic reasons alone */
    fitness: (() => {
      const f = sharpe * 8 + Math.log(Math.max(0.01, eq + withdrawn)) * 18 - maxDD * 100 * 0.55;
      /* A single NaN score poisons a whole department's mean and standard
       * deviation, and HR then cannot rank anyone in it. Never let one out. */
      return Number.isFinite(f) ? f : -60;
    })(),
  };
}

/* The whole book, scored the way the firm is scored. */
export function evaluateBook(candidates, bookG) {
  const asm = assembleBook(candidates, bookG);
  const inS = portfolioResult(asm.admitted, asm.weights, bookG, 'inSeries');
  const test = portfolioResult(asm.admitted, asm.weights, bookG, 'testSeries');
  return {
    ...asm, inSample: inS, test,
    select: inS.fitness, honest: test.fitness, gap: inS.fitness - test.fitness,
  };
}

/* ==================================================================
 * RED TEAM — paid to prove the desk's own work is luck
 * ==================================================================
 * Distinct from Audit. Audit asks "did you follow the process". Red Team
 * asks "is this real", and it attacks rather than inspects. Every one of
 * these is a test the strategy is EXPECTED to fail in a specific way; a
 * strategy that passes an attack it should have failed is the alarming case.
 */

export const ATTACKS = [
  { id: 'shuffle', name: 'Shuffled-market attack',
    plain: 'Destroy the order of the market and the edge must die with it' },
  { id: 'neighbourhood', name: 'Parameter neighbourhood',
    plain: 'Nudge every setting slightly; a real edge degrades, it does not fall off a cliff' },
  { id: 'coststress', name: 'Cost stress at 2x',
    plain: 'Double every cost and see whether anything is left' },
  { id: 'splithalf', name: 'Split-half consistency',
    plain: 'Both halves of the studied period should work, not just one' },
];

function shuffledBars(bars, rnd, from) {
  const n = bars.n;
  const rets = [];
  for (let i = from + 1; i < n; i++) rets.push(bars.c[i] / bars.c[i - 1] - 1);
  for (let i = rets.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [rets[i], rets[j]] = [rets[j], rets[i]];
  }
  const o = Float64Array.from(bars.o), h = Float64Array.from(bars.h),
    l = Float64Array.from(bars.l), c = Float64Array.from(bars.c);
  let px = c[from];
  for (let i = from + 1; i < n; i++) {
    const prev = px;
    px = px * (1 + rets[i - from - 1]);
    o[i] = prev; c[i] = px;
    const wick = Math.abs(px - prev) * 0.6 + 1e-9;
    h[i] = Math.max(prev, px) + wick;
    l[i] = Math.min(prev, px) - wick;
  }
  return { ...bars, o, h, l, c };
}

export function runAttacks(F, cfg, rnd, only) {
  const base = evaluateSplit(F, cfg);
  const out = [];
  const want = (id) => !only || only === id;

  if (want('shuffle')) {
    const sh = shuffledBars(F.b, rnd, Math.floor(F.n * 0.2));
    const r = evaluateSplit(new Features(sh), cfg);
    // a real edge should lose most of itself when the sequence is destroyed
    const survived = base.select > 5 ? (r.select / base.select) : 0;
    out.push({
      id: 'shuffle', passed: !(base.select > 5 && survived > 0.6),
      value: survived,
      detail: base.select <= 5
        ? 'Nothing to attack — the strategy has no in-sample edge to destroy.'
        : `On shuffled data the strategy keeps ${(survived * 100).toFixed(0)}% of its score. `
          + (survived > 0.6
            ? 'It should keep almost none. This edge is reading an artefact of the data, not the market.'
            : 'It collapses as it should — the edge depends on real sequence.'),
    });
  }

  if (want('neighbourhood')) {
    const scores = [];
    for (let k = 0; k < 8; k++) {
      const c2 = JSON.parse(JSON.stringify(cfg));
      for (const d of PIPELINE_DEPTS) c2[d] = mutate(d, c2[d], 0.10, rnd);
      scores.push(evaluateSplit(F, c2).select);
    }
    scores.sort((a, b) => a - b);
    const med = scores[Math.floor(scores.length / 2)];
    const drop = base.select > 1 ? (base.select - med) / Math.abs(base.select) : 0;
    out.push({
      id: 'neighbourhood', passed: drop < 0.5, value: drop,
      detail: `Nudging every setting by 10% costs ${(drop * 100).toFixed(0)}% of the score. `
        + (drop >= 0.5
          ? 'That is a cliff, not a hill — the settings are tuned to this exact history and will not survive contact with new data.'
          : 'The result sits on a broad plateau, which is what a real effect looks like.'),
    });
  }

  if (want('coststress')) {
    const c2 = JSON.parse(JSON.stringify(cfg));
    c2.cost = { ...c2.cost, costMult: (c2.cost.costMult || 1) * 2, slipAtr: (c2.cost.slipAtr || 0) * 2 };
    const r = evaluateSplit(F, c2);
    out.push({
      id: 'coststress', passed: r.select > 0, value: r.select,
      detail: `At double the assumed cost the in-sample score goes from ${base.select.toFixed(1)} to ${r.select.toFixed(1)}. `
        + (r.select > 0
          ? 'It still stands up, so the edge is not merely an underestimate of costs.'
          : 'It stops working, which means the result depends on costs being exactly as kind as assumed.'),
    });
  }

  if (want('splithalf')) {
    const n = F.n, cut = Math.floor(n * SPLIT.valid);
    const a = runPipeline(F, cfg, 0, Math.floor(cut / 2));
    const b = runPipeline(F, cfg, Math.floor(cut / 2), cut);
    const both = a.fitness > 0 && b.fitness > 0;
    out.push({
      id: 'splithalf', passed: both, value: Math.min(a.fitness, b.fitness),
      detail: `First half scores ${a.fitness.toFixed(1)}, second half ${b.fitness.toFixed(1)}. `
        + (both ? 'It works in both, which is the minimum bar for calling it an edge.'
                : 'It works in one half and not the other — that is one lucky period, not a strategy.'),
    });
  }

  return out;
}

/* ==================================================================
 * THE MULTIPLE-TESTING CORRECTION
 * ==================================================================
 * The firm runs tens of thousands of variations and then reports the best
 * one. That number is biased upward and the bias is computable, not a matter
 * of opinion: search enough random strategies and the luckiest of them will
 * look excellent on any finite history.
 *
 * So before believing a Sharpe ratio, ask what Sharpe PURE CHANCE would have
 * produced from the same number of trials on the same amount of data. If the
 * strategy does not clear that bar it has found nothing, however good the
 * backtest looks.
 *
 * This is the deflated Sharpe ratio (Bailey & Lopez de Prado). Almost nothing
 * outside professional quant shops does this, and it is the single largest
 * reason retail backtests do not survive contact with a live account.
 */

const EULER = 0.5772156649015329;

/* Abramowitz & Stegun 7.1.26 — normal CDF, plenty accurate here */
export function normCdf(x) {
  const s = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}

/* Acklam's inverse normal CDF */
export function normInv(p) {
  if (p <= 0) return -8;
  if (p >= 1) return 8;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/* The Sharpe the best of N random tries would show, by luck alone. */
export function expectedMaxSharpe(trials, trialSharpeSd) {
  const N = Math.max(2, trials);
  const v = Math.max(0.05, trialSharpeSd);
  return v * ((1 - EULER) * normInv(1 - 1 / N) + EULER * normInv(1 - 1 / (N * Math.E)));
}

/* Probability the observed Sharpe is real rather than the luckiest of N tries.
 * Adjusted for sample length and for the fat, skewed return distributions
 * trading actually produces — a Sharpe from 30 trades is worth far less than
 * the same Sharpe from 300. */
export function deflatedSharpe({ sharpe, trades, skew = 0, kurtosis = 3, trials, trialSharpeSd }) {
  const T = Math.max(3, trades);
  const sr0 = expectedMaxSharpe(trials, trialSharpeSd);
  const denom = Math.sqrt(Math.max(0.05, 1 - skew * sharpe + ((kurtosis - 1) / 4) * sharpe * sharpe));
  const z = ((sharpe - sr0) * Math.sqrt(T - 1)) / denom;
  return { psr: normCdf(z), hurdle: sr0, z, observed: sharpe };
}

/* Third and fourth moments of the trade returns — needed above, and worth
 * showing anyway: a strategy that makes its money from rare huge winners
 * is a different animal from one that grinds. */
export function moments(Rs) {
  const n = Rs.length;
  if (n < 4) return { skew: 0, kurtosis: 3 };
  const m = Rs.reduce((a, b) => a + b, 0) / n;
  let s2 = 0, s3 = 0, s4 = 0;
  for (const r of Rs) { const d = r - m; s2 += d * d; s3 += d * d * d; s4 += d * d * d * d; }
  const sd = Math.sqrt(s2 / n);
  if (sd < 1e-9) return { skew: 0, kurtosis: 3 };
  return { skew: (s3 / n) / (sd ** 3), kurtosis: (s4 / n) / (sd ** 4) };
}

/* ==================================================================
 * HOW CLOSE IS THE DESK TO A TRADE, RIGHT NOW
 * ==================================================================
 * The pipeline is a series of gates. At any moment an instrument is sitting
 * at one of them. This reports which, what still has to happen, and how far
 * away it is in ATR — the only unit that means the same thing on gold and on
 * the yen.
 *
 * The confidence it returns is deliberately harsh: it multiplies how many
 * gates are open by how credible the strategy itself is. A setup one tick
 * from triggering on a strategy that has not beaten its own search is not a
 * high-confidence trade, and this will not report it as one.
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function rsiGateInfo(S, r, dir) {
  const need = dir > 0 ? S.rsiLong : S.rsiShort;
  const ok = dir > 0 ? r >= need : r <= need;
  return { ok, gap: Math.abs(r - need), need, have: r };
}

/* Primary trigger distance for whichever discipline is running, in ATR. */
export function setupDistance(F, cfg, i) {
  const S = cfg.science, c = F.b.c, a = F.atr(cfg.math.atrLen)[i] || 1e-9;
  const M = Math.round(S.mode);
  const name = GENE_SPECS.science[0].enums[M];
  const emaF = F.ema(S.fast), emaS = F.ema(S.slow);

  if (M === 0) {
    const gap = (emaF[i] - emaS[i]) / a;
    return { dist: Math.abs(gap), name,
      text: `EMA ${Math.round(S.fast)} sits ${Math.abs(gap).toFixed(2)} ATR ${gap > 0 ? 'above' : 'below'} EMA ${Math.round(S.slow)} — a cross is the trigger` };
  }
  if (M === 1) {
    const gap = (c[i] - emaF[i]) / a;
    return { dist: Math.abs(gap), name,
      text: `price is ${Math.abs(gap).toFixed(2)} ATR ${gap > 0 ? 'above' : 'below'} the fast EMA — waiting for the pull-back to touch it` };
  }
  if (M === 2) {
    const hh = F.highest(Math.round(S.breakLen)), ll = F.lowest(Math.round(S.breakLen));
    const up = (hh[i - 1] - c[i]) / a, dn = (c[i] - ll[i - 1]) / a;
    const d = Math.min(Math.abs(up), Math.abs(dn));
    return { dist: d, name,
      text: `${Math.abs(up) < Math.abs(dn) ? `${Math.abs(up).toFixed(2)} ATR below the ${Math.round(S.breakLen)}-bar high` : `${Math.abs(dn).toFixed(2)} ATR above the ${Math.round(S.breakLen)}-bar low`} — a break is the trigger` };
  }
  if (M === 3) {
    const pv = F.pivots(Math.round(S.pivotLen));
    const hs = [];
    for (let j = i - 1; j >= Math.max(1, i - 160) && hs.length < 2; j--) if (pv.hi[j]) hs.push(j);
    if (hs.length < 2) return { dist: 9, name, text: 'no clean trend line to work with yet' };
    const [b2, b1] = [hs[0], hs[1]];
    const slope = (F.b.h[b2] - F.b.h[b1]) / (b2 - b1);
    const line = F.b.h[b2] + slope * (i - b2);
    const d = Math.abs(line - c[i]) / a;
    return { dist: d, name, text: `price is ${d.toFixed(2)} ATR ${c[i] < line ? 'under' : 'over'} the descending trend line` };
  }
  if (M === 4) {
    const pv = F.pivots(Math.round(S.pivotLen));
    let best = 9;
    for (let j = i - 2; j >= Math.max(1, i - 220); j--) {
      if (pv.lo[j]) best = Math.min(best, Math.abs(F.b.l[j] - c[i]) / a);
      if (pv.hi[j]) best = Math.min(best, Math.abs(F.b.h[j] - c[i]) / a);
    }
    return { dist: best, name, text: best < 8 ? `nearest level is ${best.toFixed(2)} ATR away — waiting for a rejection off it` : 'no significant level nearby' };
  }
  if (M === 5) {
    const L = Math.round(S.divLen);
    let loIdx = Math.max(1, i - L), hiIdx = loIdx;
    for (let j = Math.max(1, i - L); j < i; j++) {
      if (F.b.l[j] < F.b.l[loIdx]) loIdx = j;
      if (F.b.h[j] > F.b.h[hiIdx]) hiIdx = j;
    }
    const dLow = (c[i] - F.b.l[loIdx]) / a, dHigh = (F.b.h[hiIdx] - c[i]) / a;
    const d = Math.min(Math.abs(dLow), Math.abs(dHigh));
    return { dist: d, name, text: `${d.toFixed(2)} ATR from the ${Math.abs(dLow) < Math.abs(dHigh) ? 'recent low' : 'recent high'} — a new extreme without momentum is the trigger` };
  }
  if (M === 7) {
    const tf = TL_TFS[clamp(Math.round(S.tlTf), 0, 3)];
    const prep = structFor(F.b, 'ray', tf, TL_PIVOT[tf]);
    const alive = linesAliveAt(prep, i, {
      minTaps: S.tlMinTaps, minAgeDays: S.tlMinAge, maxAngle: S.tlMaxAngle
    });
    if (!alive.length) return { dist: 9, name, text: `no ${tf} trend line currently clears the quality bar` };
    let best = null;
    for (const L of alive) {
      const d = Math.abs(L.price - c[i]) / a;
      if (!best || d < best.d) best = { d, L };
    }
    const L = best.L;
    const side = L.ray.kind === 'resistance' ? 'resistance' : 'support';
    return { dist: best.d, name,
      text: `price is ${best.d.toFixed(2)} ATR from a ${tf} ${side} line with ${L.taps} touches, ${L.ageDays.toFixed(0)} days old at ${L.angle.toFixed(0)}° — the trade is the ${Math.round(S.tlPlay) ? 'close through it' : 'rejection off it'}` };
  }
  if (M === 8) {
    const tf = OB_TFS[clamp(Math.round(S.obTf), 0, 2)];
    const imp = OB_IMPULSE[clamp(Math.round(S.obImpulse), 0, 2)];
    const prep = structFor(F.b, 'ob', tf, 3, imp);
    const k = prep.baseToHtf ? prep.baseToHtf[i] : -1;
    let best = null;
    if (k >= 0) {
      for (const ob of prep.blocks) {
        if (ob.formedIdx >= k) continue;                       // not formed yet
        if (ob.mitigatedIdx != null && ob.mitigatedIdx < k) continue;  // already spent
        const ageDays = (prep.ser.t[k] - ob.t) / 86400000;
        if (ageDays > S.obMaxAge) continue;
        const edge = ob.kind === 'bullish' ? ob.top : ob.bottom;
        const d = Math.abs(edge - c[i]) / a;
        if (!best || d < best.d) best = { d, ob, ageDays };
      }
    }
    if (!best) return { dist: 9, name, text: `no fresh ${tf} order block within reach` };
    return { dist: best.d, name,
      text: `price is ${best.d.toFixed(2)} ATR from the edge of a fresh ${tf} ${best.ob.kind} order block laid down ${best.ageDays.toFixed(0)} days ago — the first return into it is the trade` };
  }
  const bl = Math.round(S.bandLen);
  const m = F.sma(bl), sd = F.stdev(bl);
  const up = m[i] + S.bandK * sd[i], dn = m[i] - S.bandK * sd[i];
  const d = Math.min(Math.abs(up - c[i]), Math.abs(c[i] - dn)) / a;
  return { dist: d, name, text: `${d.toFixed(2)} ATR from the nearest band — the trade is the snap back inside` };
}

export function tradeReadiness(F, cfg, opts = {}) {
  const i = opts.index != null ? opts.index : F.n - 1;
  const S = cfg.science, c = F.b.c;
  const atr = F.atr(cfg.math.atrLen);
  const a = atr[i] || 1e-9;
  const stages = [];
  const add = (dept, label, ok, proximity, detail) =>
    stages.push({ dept, label, ok, proximity: clamp(proximity, 0, 1), detail });

  /* 1. Data Engineering */
  const range = (F.b.h[i] - F.b.l[i]) / a, needRange = cfg.data.minRangeAtr;
  const gap = Math.abs(F.b.o[i] - c[i - 1]) / a;
  const dataOk = range >= needRange && gap <= cfg.data.maxGapAtr;
  add('data', 'Bar accepted', dataOk, dataOk ? 1 : clamp(range / Math.max(1e-6, needRange), 0, 0.95),
    dataOk ? `Last bar is clean — range ${range.toFixed(2)} ATR, no broken gap.`
      : range < needRange ? `Last bar is too quiet: ${range.toFixed(2)} ATR against a ${needRange.toFixed(2)} minimum.`
        : `Opening gap of ${gap.toFixed(2)} ATR is larger than the ${cfg.data.maxGapAtr.toFixed(1)} tolerated.`);

  /* 2. Market Regime */
  const R = cfg.regime;
  let regOk = true, regText = 'No regime filter — every market state is accepted.', regProx = 1;
  if (R && Math.round(R.mode)) {
    const ln = Math.round(R.len);
    const e = F.ema(ln);
    const strength = i > ln ? Math.abs(e[i] - e[i - ln]) / (a * Math.sqrt(ln)) : 0;
    const vr = F.volRatio(cfg.math.atrLen)[i];
    const trending = strength >= R.thresh;
    const volOk = vr >= R.volLo && vr <= R.volHi;
    regOk = (Math.round(R.mode) === 1 ? trending : !trending) && volOk;
    regProx = regOk ? 1 : clamp(Math.round(R.mode) === 1 ? strength / R.thresh : R.thresh / Math.max(1e-6, strength), 0, 0.95);
    regText = regOk
      ? `Market is ${trending ? 'trending' : 'ranging'} as required, volatility ${vr.toFixed(2)}x normal.`
      : !volOk ? `Volatility is ${vr.toFixed(2)}x normal, outside the ${R.volLo.toFixed(1)}–${R.volHi.toFixed(1)} band this strategy works in.`
        : `Wants a ${Math.round(R.mode) === 1 ? 'trending' : 'ranging'} market; trend strength is ${strength.toFixed(2)} against a ${R.thresh.toFixed(2)} threshold.`;
  }
  add('regime', 'Right kind of market', regOk, regProx, regText);

  /* 3. Strategy Discovery */
  const dir = entryDir(F, cfg, i);
  const sd = setupDistance(F, cfg, i);
  const rsiInfo = rsiGateInfo(S, F.rsi(Math.round(S.rsiLen))[i], dir || 1);
  /* How far away "close" is depends on the discipline. A moving-average
   * cross is decided within a fraction of an ATR; a Daily trend line or an
   * order block is a zone price walks toward over days, so judging it on the
   * same scale reports 0% right up until it fires and tells you nothing. */
  const sM = Math.round(S.mode);
  const nearScale = (sM === 3 || sM === 4 || sM === 7 || sM === 8) ? 3.0 : 1.2;
  /* Only the disciplines that actually consult the RSI gate should mention
   * it. Quoting it under an order block describes a rule that is not running. */
  const usesRsi = sM <= 2 || sM === 5;
  add('science', dir ? `${dir > 0 ? 'BUY' : 'SELL'} setup confirmed` : 'Waiting for a setup', !!dir,
    dir ? 1 : clamp(1 - sd.dist / nearScale, 0, 0.95),
    dir ? `${sd.name} analyst has a ${dir > 0 ? 'long' : 'short'} signal on the last closed bar.`
      : `${sd.name}: ${sd.text}.${usesRsi ? ` RSI ${rsiInfo.have.toFixed(0)} against a ${rsiInfo.need.toFixed(0)} gate.` : ''}`);

  /* 4. Macro & Event */
  const sessOk = sessionAllowed(F, cfg, i);
  const blocks = ['00-04', '04-08', '08-12', '12-16', '16-20', '20-24'];
  add('political', 'Session allowed', sessOk, sessOk ? 1 : 0,
    sessOk ? `${blocks[Math.floor(F.hour[i] / 4)]} UTC is a session the desk trades.`
      : `Macro & Event have vetoed ${blocks[Math.floor(F.hour[i] / 4)]} UTC — no trades in this window.`);

  /* 5. Cost & Capacity */
  const risk = cfg.math.slAtr * a;
  const cost = (F.b.spread || 0.26) * cfg.cost.costMult + 2 * cfg.cost.slipAtr * a;
  const ratio = cost > 0 ? risk / cost : 99;
  const costOk = cfg.cost.minEdgeMult <= 0 || ratio >= cfg.cost.minEdgeMult;
  add('cost', 'Worth the costs', costOk, clamp(ratio / Math.max(1e-6, cfg.cost.minEdgeMult), 0, 1),
    costOk ? `Stop is ${ratio.toFixed(1)}x the round-trip cost — comfortably worth trading.`
      : `Stop is only ${ratio.toFixed(1)}x the cost; Cost & Capacity demand ${cfg.cost.minEdgeMult.toFixed(1)}x before risking anything.`);

  /* 6. Compliance — live limits, when the robot is reachable */
  const lim = opts.limits;
  const compOk = !lim || (!lim.stopped && !lim.capped && !lim.cooling);
  add('legal', 'Within the mandate', compOk, compOk ? 1 : 0,
    !lim ? `Daily stop −${cfg.legal.maxDailyLossR.toFixed(1)}R, max ${Math.round(cfg.legal.maxTradesDay)} trades a day.`
      : lim.stopped ? 'Daily loss stop has been hit — Compliance has closed the desk for today.'
        : lim.capped ? "Today's trade cap is used up."
          : lim.cooling ? 'Cooling off after a loss, as Compliance requires.'
            : `Inside the mandate: ${lim.trades} of ${Math.round(cfg.legal.maxTradesDay)} trades used today.`);

  const met = stages.filter(s => s.ok).length;
  const gateScore = stages.reduce((acc, s) => acc + (s.ok ? 1 : s.proximity * 0.55), 0) / stages.length;
  const credibility = opts.credibility == null ? 0.5 : clamp(opts.credibility, 0, 1);
  const blocking = stages.find(s => !s.ok);

  return {
    stages, met, total: stages.length, direction: dir,
    ready: met === stages.length,
    waitingOn: blocking ? blocking.dept : null,
    gateScore,
    confidence: gateScore * credibility,
    setup: sd,
    atr: a, price: c[i], barTime: F.b.t[i],
  };
}
