import * as L from '../frontend/src/components/myBrainsLab.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
/* Write next to the checker, not into whatever directory this was run from.
 * Writing to the current directory once left a stale dump beside the checker
 * and the parity test happily validated yesterday's JavaScript. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'parity.json');
let s = 20260905; const rnd = () => { s = (s*1664525+1013904223)>>>0; return s/4294967296; };
const bars = L.syntheticBars(3000, 424242);
const F = new L.Features(bars);
const cases = [];
/* The disciplines the Python trader is built to execute. Modes 7 and 8 are
 * researched in JavaScript only, so they get their own cases below where the
 * expectation is the opposite: Python must refuse, not agree. */
const LIVE_MODES = L.GENE_SPECS.science[0].enums.length - L.RESEARCH_ONLY_MODES.length;
const MODES = LIVE_MODES;
for (let k = 0; k < MODES + 6; k++) {
  const cfg = {};
  for (const d of L.PIPELINE_DEPTS)
    cfg[d] = k < MODES ? JSON.parse(JSON.stringify(L.DEFAULT_GENOMES[d])) : L.randomGenome(d, rnd);
  // one case per analyst discipline, then random genomes on top
  if (k < MODES) { cfg.science.mode = k; cfg.science.useTrend = 0; cfg.cost.minEdgeMult = 0; }
  // a random genome may land on a research-only discipline; parity of the
  // executable path is what these cases are for, so pull it back in range
  else if (L.RESEARCH_ONLY_MODES.includes(Math.round(cfg.science.mode)))
    cfg.science.mode = Math.floor(rnd() * MODES);
  const entries = [];
  for (let i = 1; i < bars.n; i++) {
    const atr = F.atr(cfg.math.atrLen);
    if (!L.barUsable(F, cfg, i, atr)) continue;
    const dir = L.entryDir(F, cfg, i);
    if (!dir) continue;
    if (!L.regimeOk(F, cfg, i)) continue;
    if (!L.sessionAllowed(F, cfg, i)) continue;
    const risk = cfg.math.slAtr * atr[i];
    const tradeCost = bars.spread * cfg.cost.costMult + 2 * cfg.cost.slipAtr * atr[i];
    if (cfg.cost.minEdgeMult > 0 && risk < cfg.cost.minEdgeMult * tradeCost) continue;
    entries.push([i, dir]);
  }
  cases.push({ cfg, entries, researchOnly: false });
}

/* ---- the structure disciplines, tuned so they actually fire ----
 * At their default A+ settings these two produce a handful of entries on a
 * 3,000-bar series, and a parity test that compares nothing proves nothing.
 * These cases loosen the thresholds so both engines have real work to
 * disagree about. */
for (const m of [7, 8]) {   // again, with thresholds loose enough to fire often
  const cfg = {};
  for (const d of L.PIPELINE_DEPTS) cfg[d] = JSON.parse(JSON.stringify(L.DEFAULT_GENOMES[d]));
  cfg.science.mode = m;
  cfg.science.useTrend = 0;
  cfg.cost.minEdgeMult = 0;
  if (m === 7) { cfg.science.tlTf = 3; cfg.science.tlPlay = 1; cfg.science.tlMinTaps = 2; cfg.science.tlMinAge = 5; cfg.science.tlMaxAngle = 60; }
  if (m === 8) { cfg.science.obTf = 2; cfg.science.obImpulse = 1; cfg.science.obMaxAge = 45; cfg.science.obConfirm = 0; }
  const entries = [];
  for (let i = 1; i < bars.n; i++) {
    const atr = F.atr(cfg.math.atrLen);
    if (!L.barUsable(F, cfg, i, atr)) continue;
    const dir = L.entryDir(F, cfg, i);
    if (!dir) continue;
    if (!L.regimeOk(F, cfg, i)) continue;
    if (!L.sessionAllowed(F, cfg, i)) continue;
    entries.push([i, dir]);
  }
  cases.push({ cfg, entries, researchOnly: false });
}
fs.writeFileSync(OUT, JSON.stringify({
  bars: { spread: bars.spread, t: Array.from(bars.t), o: Array.from(bars.o), h: Array.from(bars.h), l: Array.from(bars.l), c: Array.from(bars.c) },
  cases
}));
console.log('dumped', cases.length, 'cases ->', OUT);
const names = L.GENE_SPECS.science[0].enums;
/* A fingerprint of the DETERMINISTIC cases (one per discipline, fixed
 * genomes, fixed bars). These numbers must not move unless the entry logic
 * for that discipline was deliberately changed. A count that drifts while
 * nobody touched the discipline means something upstream — the bar
 * generator, a shared indicator, a default gene — moved underneath it, and
 * that is exactly the kind of change that is easy to miss and expensive to
 * find later. */
const names2 = L.GENE_SPECS.science[0].enums;
const fingerprint = {};
cases.forEach((c,i)=>{ if (i < MODES) fingerprint[names2[i]] = c.entries.length; });
fs.writeFileSync(path.join(HERE, 'parity_fingerprint.json'), JSON.stringify(fingerprint, null, 1));

cases.forEach((c,i)=>console.log('  case '+i+': '
  + (i < MODES ? names[i] : ('random (' + names[Math.round(c.cfg.science.mode)] + ')')).padEnd(38)
  + c.entries.length + ' entries'));
