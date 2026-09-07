// confluence.js — the Secret Strategy signal brain.
// Produces ONE tiered signal from the agreement of the 5M and 15M charts,
// graded by 1H trend context and higher-timeframe Order-Block confluence,
// and carrying a REAL measured hit-rate taken from this chart's own history.
//
// Everything here is evaluated on CLOSED candles only (the still-forming bar
// is dropped) so the signal does not twitch with every tick — the locking in
// SecretStrategyTab then holds it until a reversal or a stronger setup.

import { computeThreeGates } from './threeGates';

function _tr(d) { return d.map((k, i) => i === 0 ? k.high - k.low : Math.max(k.high - k.low, Math.abs(k.high - d[i - 1].close), Math.abs(k.low - d[i - 1].close))); }
function _rma(v, len) { const o = new Array(v.length).fill(null); let p, s = 0; for (let i = 0; i < v.length; i++) { const x = v[i]; if (i < len) { s += x; if (i === len - 1) { p = s / len; o[i] = p; } } else { p = (p * (len - 1) + x) / len; o[i] = p; } } return o; }
function _sma(vals, len) { if (!vals || vals.length < len) return null; let s = 0; for (let i = vals.length - len; i < vals.length; i++) s += vals[i]; return s / len; }

// Unmitigated Order Blocks — same definition the chart draws, used here to
// check whether the entry sits inside institutional footprint on a higher TF.
function _obs(c, atrLen) {
  atrLen = atrLen || 14;
  const atr = _rma(_tr(c), atrLen), n = c.length;
  let raw = [];
  for (let i = 1; i < n - 1; i++) {
    const a = atr[i]; if (a == null) continue; const nx = c[i + 1];
    if (c[i].close < c[i].open && nx.close > nx.open && (nx.close - nx.open) > 1.2 * a && nx.close > c[i].high) raw.push({ top: c[i].high, bottom: c[i].low, kind: 'BULL', idx: i });
    if (c[i].close > c[i].open && nx.close < nx.open && (nx.open - nx.close) > 1.2 * a && nx.close < c[i].low) raw.push({ top: c[i].high, bottom: c[i].low, kind: 'BEAR', idx: i });
  }
  return raw.filter(z => { for (let j = z.idx + 2; j < n; j++) { if (z.kind === 'BULL' && c[j].close < z.bottom) return false; if (z.kind === 'BEAR' && c[j].close > z.top) return false; } return true; });
}

// Measured base rate: of the last resolved setups in this direction, the share
// that reached TP before SL. null when there is not enough history to be honest.
function _hitRate(setups, dir) {
  const rel = (setups || []).filter(s => s.dir === dir && (s.outcome === 'TP' || s.outcome === 'SL')).slice(-20);
  if (rel.length < 4) return { rate: null, count: rel.length };
  const tp = rel.filter(s => s.outcome === 'TP').length;
  return { rate: tp / rel.length, count: rel.length };
}

const _closed = (d) => (Array.isArray(d) && d.length > 2) ? d.slice(0, -1) : (d || []);

// dataByTf: { d5, d15, d1h } — raw getFullData() arrays (forming bar included; we drop it here).
export function computeConfluence(dataByTf, cfg) {
  cfg = cfg || {};
  const d5 = _closed(dataByTf.d5), d15 = _closed(dataByTf.d15), d1h = _closed(dataByTf.d1h);
  if (d5.length < 40 || d15.length < 40) return null;

  const r5 = computeThreeGates(d5, cfg), r15 = computeThreeGates(d15, cfg);
  const live = (r) => { const s = r.setups && r.setups.length ? r.setups[r.setups.length - 1] : null; return s && s.outcome === 'OPEN' ? s : null; };
  const s5 = live(r5), s15 = live(r15);

  // Core requirement: BOTH 5M and 15M must show a live gate-3 setup in the SAME direction.
  if (!s5 || !s15 || s5.dir !== s15.dir || s5.dir === 0) {
    return { dir: 0, gate5: !!s5, gate15: !!s15, g5state: gatePhase(r5), g15state: gatePhase(r15) };
  }
  const dir = s5.dir;
  // Entry/stops taken from the 5M setup (the finer trigger).
  const entry = s5.entry, sl = s5.sl, tp1 = s5.tp1, tp2 = s5.tp2;

  // 1H trend context (20-SMA level + slope).
  let trend = 0;
  if (d1h.length >= 25) {
    const cl = d1h.map(x => x.close);
    const sma = _sma(cl, 20), smaPrev = _sma(cl.slice(0, -5), 20);
    if (sma != null && smaPrev != null) {
      if (cl[cl.length - 1] > sma && sma >= smaPrev) trend = 1;
      else if (cl[cl.length - 1] < sma && sma <= smaPrev) trend = -1;
    }
  }
  const trendAgrees = trend !== 0 && trend === dir;

  // Higher-TF Order-Block confluence: entry sitting inside a fresh 15M or 1H OB of the right side.
  const wantKind = dir === 1 ? 'BULL' : 'BEAR';
  const inOB = (d) => _obs(d, cfg.atrLen || 14).some(z => z.kind === wantKind && entry <= z.top + 1e-9 && entry >= z.bottom - 1e-9);
  const obConfluence = inOB(d15) || (d1h.length >= 30 && inOB(d1h));

  // Tiering.
  let tier = 1;
  if (trendAgrees || obConfluence) tier = 2;
  if (trendAgrees && obConfluence) tier = 3;
  const label = tier === 3 ? 'A-CLASS' : tier === 2 ? 'CONFIDENT' : 'SIGNAL';

  const hr = _hitRate(r15.setups, dir);

  return {
    dir, entry, sl, tp1, tp2, tier, label,
    gate5: true, gate15: true, trendAgrees, obConfluence,
    hitRate: hr.rate, hitCount: hr.count,
    rr: Math.abs(tp1 - entry) / Math.max(1e-9, Math.abs(entry - sl)),
    createdTs: d5[d5.length - 1].timestamp || Date.now(),
  };
}

// Short phase label for a single timeframe (used in the "awaiting agreement" strip).
function gatePhase(r) {
  if (!r) return 'stand aside';
  const last = r.setups && r.setups.length ? r.setups[r.setups.length - 1] : null;
  if (last && last.outcome === 'OPEN') return 'setup';
  if (r.pending) return 'gate 2';
  return 'stand aside';
}

// Confidence % to display: prefer the measured hit-rate; if history is thin,
// fall back to a conservative tier floor so the card is never blank.
export function displayConfidence(sig) {
  if (!sig || sig.dir === 0) return null;
  if (sig.hitRate != null) return { pct: Math.round(sig.hitRate * 100), measured: true, n: sig.hitCount };
  const floor = sig.tier === 3 ? 70 : sig.tier === 2 ? 60 : 50;
  return { pct: floor, measured: false, n: sig.hitCount || 0 };
}
