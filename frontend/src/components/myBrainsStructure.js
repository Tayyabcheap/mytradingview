/* ------------------------------------------------------------------
 * myBrainsStructure.js — the trend-line and order-block analysts.
 * ------------------------------------------------------------------
 * Two disciplines that need real market structure rather than an indicator.
 * Everything here is computed once per bar series and cached; recomputing
 * structure on every bar of every backtest would make the lab unusable.
 * ------------------------------------------------------------------ */

export const TF_MS = {
  '5M': 300000, '15M': 900000, '30M': 1800000, '1H': 3600000,
  '4H': 14400000, '1D': 86400000, '1W': 604800000, '1MN': 2592000000,
};

/* the top-down ladder, macro first, exactly as the desk works it */
export const LADDER = ['1MN', '1W', '1D', '4H', '1H', '30M', '5M'];

/* ============ 1. TIMEFRAME AGGREGATION ============
 * A higher-timeframe candle only exists once its last constituent bar has
 * closed. Building them any other way lets a backtest see a Monthly high
 * before the month is over, which is the most common way a multi-timeframe
 * strategy lies about its own results. */

export function resample(bars, tfMs) {
  const n = bars.n;
  const t = [], o = [], h = [], l = [], c = [], endIdx = [];
  let curKey = null;
  for (let i = 0; i < n; i++) {
    const key = Math.floor(bars.t[i] / tfMs);
    if (key !== curKey) {
      curKey = key;
      t.push(key * tfMs); o.push(bars.o[i]); h.push(bars.h[i]); l.push(bars.l[i]); c.push(bars.c[i]);
      endIdx.push(i);
    } else {
      const k = h.length - 1;
      if (bars.h[i] > h[k]) h[k] = bars.h[i];
      if (bars.l[i] < l[k]) l[k] = bars.l[i];
      c[k] = bars.c[i];
      endIdx[k] = i;
    }
  }
  return {
    n: c.length, tfMs,
    t: Float64Array.from(t), o: Float64Array.from(o), h: Float64Array.from(h),
    l: Float64Array.from(l), c: Float64Array.from(c),
    endIdx: Int32Array.from(endIdx),
  };
}

/* swing pivots on any series, wick extremes only */
export function swings(series, w) {
  const n = series.n, hi = [], lo = [];
  for (let i = w; i < n - w; i++) {
    let isH = true, isL = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (series.h[j] >= series.h[i]) isH = false;
      if (series.l[j] <= series.l[i]) isL = false;
      if (!isH && !isL) break;
    }
    if (isH) hi.push({ i, t: series.t[i], p: series.h[i], confirmed: i + w });
    if (isL) lo.push({ i, t: series.t[i], p: series.l[i], confirmed: i + w });
  }
  return { hi, lo };
}

/* ============ 2. RAYS ============
 * Two anchors and an infinite extension right. Stored in (time, price) so a
 * Monthly line can be evaluated on a 5-minute chart — which is the whole
 * point of drawing the Monthly line in the first place. */

export function makeRay(a, b, kind, tf) {
  const dt = b.t - a.t;
  if (dt <= 0) return null;
  return {
    kind, tf, t0: a.t, p0: a.p, t1: b.t, p1: b.p,
    slope: (b.p - a.p) / dt, aIdx: a.i, bIdx: b.i,
  };
}

export const rayPriceAt = (ray, t) => ray.p0 + ray.slope * (t - ray.t0);

/* Everything that used to sit here — buildLadder, activeLines, buildRays,
 * findOrderBlocks and their helpers — has been removed on purpose.
 *
 * Those functions answered "what does the chart look like right now", which
 * is the correct question for drawing on a screen and the WRONG one for a
 * backtest: they read the whole series to decide whether a line was ever
 * broken, so a line that survived to today looked unbroken in 2024 too.
 * Leaving them exported next to the causal versions below was a trap — the
 * next person to reach for buildLadder would have silently reintroduced the
 * look-ahead this file exists to prevent.
 *
 * If a chart overlay is ever needed, build it from prepareRays/linesAliveAt
 * below with upToIdx set to the last bar. Same answer, no trap. */

/* ==================================================================
 * 5. THE CAUSAL LAYER  — what the backtest is actually allowed to use
 * ==================================================================
 * Everything above answers "what does the chart look like NOW". A backtest
 * needs a different question: "what did the chart look like at bar 4,312,
 * knowing nothing after it". Those are not the same thing and the difference
 * is the single biggest lie in multi-timeframe strategy testing.
 *
 * A trend line that survived to the right-hand edge of the chart is a
 * survivor. Selecting on survivors and then claiming the line "held" is
 * circular: it held because we only kept the ones that held. So each ray
 * here carries a lifespan — the bar it became knowable (its second anchor
 * confirmed) and the bar it died (first close through it) — and a list of
 * the exact bars it was touched on. Nothing is read outside that window.
 *
 * The output is not a picture, it is a list of EVENTS stamped with the base
 * bar they became actionable on. The backtest looks up bar i and gets only
 * what a person watching the screen at bar i could have seen.
 * ------------------------------------------------------------------ */

const STRUCT_TOL = 0.35;      // the "zero intersection" tolerance, in avg candle ranges
const RAY_SPAN = 8;           // anchor B is within 8 pivots of anchor A
const RAY_SPACING = 6;        // two taps must be 6 candles apart to count separately
const ANGLE_WINDOW_MS = 90 * 86400000;
const BASE_COOLDOWN = 12;      // base bars between two trades off the same line

/* The tolerance a line is judged with must itself be causal. Averaging the
 * candle range over the WHOLE series and then using it to decide whether a
 * line broke at candle 300 imports next year's volatility into last year's
 * decision — a small leak that quietly changes which lines survive. */
function tolSeries(ser, look = 120) {
  const n = ser.n, out = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += ser.h[i] - ser.l[i];
    if (i >= look) acc -= ser.h[i - look] - ser.l[i - look];
    out[i] = STRUCT_TOL * (acc / Math.min(i + 1, look));
  }
  return out;
}

/* base bar -> index of the last HTF candle that had definitely CLOSED.
 * Strictly less-than: a candle is not closed while we are still inside it. */
function mapBaseToHtf(bars, ser) {
  const out = new Int32Array(bars.n).fill(-1);
  let k = 0;
  for (let i = 0; i < bars.n; i++) {
    while (k < ser.n && ser.endIdx[k] < i) k++;
    out[i] = k - 1;
  }
  return out;
}

/* rolling 90-day high/low over the HTF series, so a line's angle can be
 * measured against the screen the trader was actually looking at. */
function rollingWindow(ser) {
  const n = ser.n, hi = new Float64Array(n), lo = new Float64Array(n), i0 = new Int32Array(n);
  const qh = [], ql = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    while (s < i && ser.t[i] - ser.t[s] > ANGLE_WINDOW_MS) s++;
    while (qh.length && qh[0] < s) qh.shift();
    while (ql.length && ql[0] < s) ql.shift();
    while (qh.length && ser.h[qh[qh.length - 1]] <= ser.h[i]) qh.pop();
    while (ql.length && ser.l[ql[ql.length - 1]] >= ser.l[i]) ql.pop();
    qh.push(i); ql.push(i);
    hi[i] = ser.h[qh[0]]; lo[i] = ser.l[ql[0]]; i0[i] = s;
  }
  return { hi, lo, i0 };
}

function angleAt(ray, ser, win, k) {
  const range = Math.max(1e-9, win.hi[k] - win.lo[k]);
  const spanMs = Math.max(1, ser.t[k] - ser.t[win.i0[k]]);
  return Math.abs(Math.atan((ray.slope * spanMs) / range) * 180 / Math.PI);
}

/* ---- trend lines, prepared once per (timeframe, pivot width) ---- */
export function prepareRays(bars, tf, pivotW) {
  const ser = resample(bars, TF_MS[tf]);
  const prep = { tf, pivotW, ser, rays: [], events: [], byBase: new Map(), tol: 0, candles: ser.n };
  if (ser.n < pivotW * 3 + 8) { prep.baseToHtf = mapBaseToHtf(bars, ser); return prep; }

  const tolA = tolSeries(ser);
  prep.tolA = tolA;
  prep.tol = tolA[ser.n - 1];
  prep.baseToHtf = mapBaseToHtf(bars, ser);
  prep.baseToHtfTmp = prep.baseToHtf;
  const win = rollingWindow(ser);
  const sw = swings(ser, pivotW);

  for (const [list, kind] of [[sw.hi, 'resistance'], [sw.lo, 'support']]) {
    for (let ai = 0; ai < list.length - 1; ai++) {
      for (let bi = ai + 1; bi < Math.min(list.length, ai + 1 + RAY_SPAN); bi++) {
        const A = list[ai], B = list[bi];
        const ray = makeRay(A, B, kind, tf);
        if (!ray) continue;
        /* a resistance line that rises steeply is not resistance, and a
         * support line that falls steeply is not support */
        if (kind === 'resistance' && ray.slope > 0 && (B.p - A.p) / Math.max(1e-9, A.p) > 0.02) continue;
        if (kind === 'support' && ray.slope < 0 && (A.p - B.p) / Math.max(1e-9, A.p) > 0.02) continue;

        const bornIdx = B.confirmed;               // knowable only once B is a confirmed pivot
        const rayIdx = prep.rays.length;
        const taps = [A.i, B.i];
        let last = B.i, deadIdx = ser.n, breakEv = null;

        for (let k = B.i + 1; k < ser.n; k++) {
          const line = rayPriceAt(ray, ser.t[k]);
          const tol = tolA[k];
          const closedThrough = kind === 'resistance' ? ser.c[k] > line + tol : ser.c[k] < line - tol;
          const wickedThrough = kind === 'resistance' ? ser.h[k] > line + tol : ser.l[k] < line - tol;
          if (closedThrough) {
            deadIdx = k;
            if (k >= bornIdx) breakEv = { k, line, dir: kind === 'resistance' ? 1 : -1 };
            break;
          }
          if (wickedThrough) { deadIdx = k; break; }   // wick through and back: line is spent, no trade
          if (k - last >= RAY_SPACING) {
            const touched = kind === 'resistance'
              ? ser.h[k] >= line - tol
              : ser.l[k] <= line + tol;
            if (touched) { taps.push(k); last = k; }
          }
        }
        if (deadIdx <= bornIdx && !breakEv) continue;   // died before anyone could have drawn it

        prep.rays.push({ ...ray, rayIdx, bornIdx, deadIdx, tapIdx: taps });

        const push = (k, line, dir, type, tapsThen) => {
          prep.events.push({
            type, dir, tf, kind, rayIdx, htfIdx: k, baseIdx: ser.endIdx[k], line,
            taps: tapsThen, ageDays: (ser.t[k] - ray.t0) / 86400000,
            angle: angleAt(ray, ser, win, k),
          });
        };
        if (breakEv) push(breakEv.k, breakEv.line, breakEv.dir, 'break', taps.length);
      }
    }
  }

  /* ---- execution on the chart in front of you ----
   * The line is a Daily line; the trade is not a Daily trade. A desk draws
   * the level on the higher timeframe and then works the entry on the chart
   * it is actually watching. So the REJECTION is looked for on every base
   * bar the ray is alive for, at that bar's own tolerance, with a cool-down
   * so one long stall at a level is one trade and not thirty.
   *
   * The line still only DIES on a higher-timeframe close through it — an
   * hourly poke through a Monthly line does not break the Monthly line. */
  const btol = tolSeries(bars);
  for (const r of prep.rays) {
    const b0 = ser.endIdx[r.bornIdx != null ? Math.min(r.bornIdx, ser.n - 1) : 0];
    const b1 = r.deadIdx < ser.n ? ser.endIdx[r.deadIdx] : bars.n - 1;
    let lastFire = -1e9;
    for (let i = b0 + 1; i <= b1 && i < bars.n; i++) {
      if (i - lastFire < BASE_COOLDOWN) continue;
      const line = rayPriceAt(r, bars.t[i]);
      const tol = btol[i];
      const touched = r.kind === 'resistance'
        ? (bars.h[i] >= line - tol && bars.h[i] <= line + tol)
        : (bars.l[i] <= line + tol && bars.l[i] >= line - tol);
      if (!touched) continue;
      const rejected = r.kind === 'resistance'
        ? (bars.c[i] < line && bars.c[i] < bars.o[i])
        : (bars.c[i] > line && bars.c[i] > bars.o[i]);
      if (!rejected) continue;
      const k = prep.baseToHtfTmp[i];
      if (k < r.bornIdx || k >= r.deadIdx) continue;
      let taps = 0;
      for (const ti of r.tapIdx) if (ti <= k) taps++;
      prep.events.push({
        type: 'bounce', dir: r.kind === 'resistance' ? -1 : 1, tf, kind: r.kind,
        rayIdx: r.rayIdx, htfIdx: k, baseIdx: i, line, taps,
        ageDays: (bars.t[i] - r.t0) / 86400000,
        angle: angleAt(r, ser, win, k),
      });
      lastFire = i;
    }
  }

  for (const e of prep.events) {
    const arr = prep.byBase.get(e.baseIdx);
    if (arr) arr.push(e); else prep.byBase.set(e.baseIdx, [e]);
  }
  return prep;
}

/* ---- order blocks, prepared once per (timeframe, pivot width, impulse) ---- */
export function prepareBlocks(bars, tf, pivotW, impulse) {
  const ser = resample(bars, TF_MS[tf]);
  const prep = { tf, pivotW, impulse, ser, blocks: [], events: [], byBase: new Map(), candles: ser.n };
  const n = ser.n;
  if (n < pivotW * 3 + 10) { prep.baseToHtf = mapBaseToHtf(bars, ser); return prep; }
  const sw = swings(ser, pivotW);

  /* the most recent swing that was already CONFIRMED before candle i */
  const priorSwing = (list, i) => {
    let best = null;
    for (const p of list) { if (p.confirmed < i) { if (!best || p.i > best.i) best = p; } else break; }
    return best;
  };

  for (let i = pivotW + 1; i < n - 3; i++) {
    const down = ser.c[i] < ser.o[i], up = ser.c[i] > ser.o[i];
    if (!down && !up) continue;
    if (i + 2 >= n) break;

    /* Filter 2 — displacement: a real gap between candle 1 and candle 3 */
    const fvg = down ? ser.l[i + 2] - ser.h[i] : ser.l[i] - ser.h[i + 2];
    if (!(fvg > 0)) continue;

    /* Filter 1 — structure: a CLOSE past the prior swing, and we record the
     * exact candle it happened on, because that is when the block exists.
     * Taking the best close over the whole impulse window and then stamping
     * the block two candles later is a look-ahead of up to six candles. */
    const sref = priorSwing(down ? sw.hi : sw.lo, i);
    if (!sref) continue;
    let bosIdx = -1;
    const end = Math.min(n - 1, i + impulse);
    for (let j = i + 1; j <= end; j++) {
      if (down ? ser.c[j] > sref.p : ser.c[j] < sref.p) { bosIdx = j; break; }
    }
    if (bosIdx < 0) continue;

    /* the block itself: the extreme opposing candle at the origin */
    let k = i;
    for (let j = i; j >= Math.max(1, i - 4); j--) {
      if (down ? !(ser.c[j] < ser.o[j]) : !(ser.c[j] > ser.o[j])) break;
      if (down ? ser.l[j] < ser.l[k] : ser.h[j] > ser.h[k]) k = j;
    }
    const formedIdx = Math.max(bosIdx, i + 2);
    const ob = {
      kind: down ? 'bullish' : 'bearish', i: k, t: ser.t[k],
      top: ser.h[k], bottom: ser.l[k], bosAt: sref.p, bosIdx, fvg, formedIdx, tf,
      obIdx: prep.blocks.length,
    };

    /* Filter 3 — freshness: the FIRST return is the trade. Everything after
     * it is a mitigated zone and must never fire again. */
    ob.mitigatedIdx = null;
    for (let j = formedIdx + 1; j < n; j++) {
      const touched = ob.kind === 'bullish' ? ser.l[j] <= ob.top : ser.h[j] >= ob.bottom;
      if (touched) { ob.mitigatedIdx = j; break; }
    }
    /* the entry is worked on the base chart the moment price steps into the
     * zone, which is minutes-to-hours before the higher-timeframe candle that
     * contains it has closed. Waiting for that close is not conservatism, it
     * is entering after the move. */
    ob.entryBase = null;
    const fb = ser.endIdx[formedIdx];
    for (let i = fb + 1; i < bars.n; i++) {
      const inZone = ob.kind === 'bullish' ? bars.l[i] <= ob.top : bars.h[i] >= ob.bottom;
      if (!inZone) continue;
      const dir = ob.kind === 'bullish' ? 1 : -1;
      ob.entryBase = i;
      prep.events.push({
        dir, tf, obIdx: ob.obIdx, htfIdx: formedIdx, baseIdx: i,
        zoneTop: ob.top, zoneBottom: ob.bottom, kind: ob.kind,
        ageDays: (bars.t[i] - ob.t) / 86400000,
        fvg,
        closedBack: dir > 0 ? bars.c[i] > ob.top : bars.c[i] < ob.bottom,
      });
      break;
    }
    prep.blocks.push(ob);
    i = end;
  }

  for (const e of prep.events) {
    const arr = prep.byBase.get(e.baseIdx);
    if (arr) arr.push(e); else prep.byBase.set(e.baseIdx, [e]);
  }
  prep.baseToHtf = mapBaseToHtf(bars, ser);
  return prep;
}

/* what the desk can see at base bar i, without seeing anything after it */
export function linesAliveAt(prep, baseIdx, filt) {
  const k = prep.baseToHtf ? prep.baseToHtf[baseIdx] : -1;
  const out = [];
  if (k < 0) return out;
  const { minTaps = 3, minAgeDays = 21, maxAngle = 45 } = filt || {};
  const win = prep._win || (prep._win = rollingWindow(prep.ser));
  for (const r of prep.rays) {
    if (k < r.bornIdx || k >= r.deadIdx) continue;
    let taps = 0;
    for (const ti of r.tapIdx) if (ti <= k) taps++;
    if (taps < minTaps) continue;
    const ageDays = (prep.ser.t[k] - r.t0) / 86400000;
    if (ageDays < minAgeDays) continue;
    const angle = angleAt(r, prep.ser, win, k);
    if (angle > maxAngle) continue;
    out.push({ ray: r, taps, ageDays, angle, price: rayPriceAt(r, prep.ser.t[k]) });
  }
  return out;
}
