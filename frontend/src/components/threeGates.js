// threeGates.js — the "Secret Strategy" Three-Gate Breakout detector.
// Shared single source of truth used by BOTH the SECRET_GATES chart indicator
// and the SecretStrategy tab's live status readout.
//
// Gate 1 (Trend/Momentum): the breakout bar closes decisively beyond the level
//   in the breakout direction (a FRESH break — the prior bar was still inside).
// Gate 2 (Level Break): price closes beyond the nearest N-bar structural
//   high/low (the horizontal level).
// Gate 3 (Retest & Reject): within the next few bars price pulls back to the
//   broken level and prints a rejection candle closing back in the break
//   direction. Only then is the setup VALID (entry, SL beyond the wick, TP 1:1 & 1:2).

function _tr(d) { return d.map((k, i) => i === 0 ? k.high - k.low : Math.max(k.high - k.low, Math.abs(k.high - d[i - 1].close), Math.abs(k.low - d[i - 1].close))); }
function _rma(v, len) { const o = new Array(v.length).fill(null); let p, s = 0; for (let i = 0; i < v.length; i++) { const x = v[i]; if (i < len) { s += x; if (i === len - 1) { p = s / len; o[i] = p; } } else { p = (p * (len - 1) + x) / len; o[i] = p; } } return o; }

export function computeThreeGates(dataList, cfg) {
  cfg = cfg || {};
  const L = cfg.lookback || 20, RB = cfg.retestBars || 6, atrLen = cfg.atrLen || 14, tolMult = cfg.tol || 0.30, cooldown = cfg.cooldown || 3;
  const n = Array.isArray(dataList) ? dataList.length : 0;
  const empty = { setups: [], pending: null, brokenLevel: null };
  if (n < L + 5) return empty;
  const highs = dataList.map(d => d.high), lows = dataList.map(d => d.low), closes = dataList.map(d => d.close);
  const atr = _rma(_tr(dataList), atrLen);
  const setups = [];
  let pending = null, lastIdx = -1e9, i = L;
  try {
    while (i < n - 1) {
      if (i - lastIdx < cooldown) { i++; continue; }
      const a = atr[i] || 1;
      const priorHigh = Math.max(...highs.slice(i - L, i));
      const priorLow = Math.min(...lows.slice(i - L, i));
      const c = closes[i], cPrev = closes[i - 1];
      let dir = 0, level = 0;
      // FRESH break only (prior bar still inside the range)
      if (c > priorHigh && cPrev <= priorHigh) { dir = 1; level = priorHigh; }
      else if (c < priorLow && cPrev >= priorLow) { dir = -1; level = priorLow; }
      if (dir !== 0 && Math.abs(c - level) > 0.1 * a) {
        pending = { breakoutIdx: i, dir, level };           // Gates 1&2 passed, awaiting Gate 3
        const tol = a * tolMult; let resolved = false;
        for (let j = i + 1; j <= Math.min(n - 1, i + RB); j++) {
          const rk = dataList[j], rng = Math.max(1e-9, rk.high - rk.low);
          if (dir === 1) {
            const retouch = rk.low <= level + tol;
            const reject = rk.close > rk.open && rk.close > level && (rk.close - rk.low) > 0.5 * rng;
            if (retouch && reject) {
              const entry = rk.close, sl = Math.min(rk.low, level) - 0.2 * a, R = Math.max(1e-9, entry - sl);
              setups.push({ breakoutIdx: i, retestIdx: j, dir, level, entry, sl, tp1: entry + R, tp2: entry + 2 * R });
              lastIdx = j; i = j; resolved = true; pending = null; break;
            }
            if (rk.close < level - tol) { pending = null; break; }  // breakout failed
          } else {
            const retouch = rk.high >= level - tol;
            const reject = rk.close < rk.open && rk.close < level && (rk.high - rk.close) > 0.5 * rng;
            if (retouch && reject) {
              const entry = rk.close, sl = Math.max(rk.high, level) + 0.2 * a, R = Math.max(1e-9, sl - entry);
              setups.push({ breakoutIdx: i, retestIdx: j, dir, level, entry, sl, tp1: entry - R, tp2: entry - 2 * R });
              lastIdx = j; i = j; resolved = true; pending = null; break;
            }
            if (rk.close > level + tol) { pending = null; break; }
          }
        }
        // keep `pending` only if the breakout is at the very right edge (still awaiting retest)
        if (!resolved && i < n - 1 - RB) pending = null;
      }
      i++;
    }
    // resolve each setup: 1R target vs stop
    for (const s of setups) {
      let outcome = 'OPEN';
      for (let j = s.retestIdx + 1; j < n; j++) {
        const hi = dataList[j].high, lo = dataList[j].low;
        if (s.dir === 1) { if (lo <= s.sl) { outcome = 'SL'; break; } if (hi >= s.tp1) { outcome = 'TP'; break; } }
        else { if (hi >= s.sl) { outcome = 'SL'; break; } if (lo <= s.tp1) { outcome = 'TP'; break; } }
      }
      s.outcome = outcome;
    }
  } catch (e) { return { setups, pending, brokenLevel: pending ? pending.level : null }; }
  return { setups, pending, brokenLevel: pending ? pending.level : null };
}

// Short human status for the tab, describing where we are in the 3-gate sequence.
export function gateStatus(res) {
  if (!res) return { text: 'No data', color: '#8b949e', gate: 0 };
  if (res.pending) {
    const dir = res.pending.dir === 1 ? 'bullish' : 'bearish';
    return { text: `Gates 1–2 passed (${dir} break of ${res.pending.level.toFixed(2)}) — awaiting retest`, color: '#f7a600', gate: 2 };
  }
  const last = res.setups && res.setups.length ? res.setups[res.setups.length - 1] : null;
  if (last && last.outcome === 'OPEN') {
    return { text: `SETUP LIVE — ${last.dir === 1 ? 'BUY' : 'SELL'} @ ${last.entry.toFixed(2)} (all 3 gates)`, color: last.dir === 1 ? '#089981' : '#f23645', gate: 3 };
  }
  return { text: 'No valid setup — stand aside', color: '#8b949e', gate: 0 };
}
