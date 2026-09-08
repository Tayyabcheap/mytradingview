import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Brain, Play, Pause, Zap, RotateCcw, Sparkles, Activity, Wifi, WifiOff,
  X, Eye, EyeOff, Maximize2, GraduationCap, Settings, ShieldCheck, Building2
} from 'lucide-react';
import {
  createOrg, hydrateOrg, serializeOrg, stepOrg, applyTelemetry, forceReview,
  DEPARTMENTS, HR_DEPT, AUDIT_DEPT, REDTEAM_DEPT, CEO_DEPT, ALL_DEPTS, BOARD, DEPT_BY_ID,
  WORLD, headcount, payrollRunway, STATE_META, RANK_META, LAB_DEPTS, PIPE_DEPTS, BOOK_DEPTS,
  clamp, NEURON_DAY_COST, attachLab, workTick, dayList, liveOnes,
  summariseChampion, AUDIT_CHECKS, runAudit, bookForLive,
  makeCeoReport, ceoReportDue, markReportsRead
} from './myBrainsCore';
import { describeGene, geneLabel, specsFor, ATTACKS, plainChampion } from './myBrainsLab';
import { useBrainsSession, setOptions as setSessionOptions, pushTelemetry } from './brainsSession';

/* a department's published work lives in one of two places */
const championOf = (L, id) => !L ? null : (L.bookG && L.bookG[id]) || (L.champions && L.champions[id]) || null;

/* =================================================================
 * MyBrainsTab — "Shah Investment Center" as a living neural network.
 * Each neuron is an employee. Each lobe is a department. HR never sleeps.
 * ================================================================= */

const LS_KEY = 'twr_mybrains_v1';
const LS_SETTINGS = 'twr_mybrains_settings_v1';

const DEFAULT_SETTINGS = {
  speed: 1,
  strictness: 1,
  staffing: 1,
  paused: false,
  showParticles: true,
  showLabels: true,
  showSynapses: true,
  showGrid: true,
  liveData: true,
  labRate: 120,        // pipeline evaluations per second the floor is allowed
  dayCost: NEURON_DAY_COST
};

/* ------------------------------ helpers ------------------------------ */

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };

const spriteCache = new Map();
function glowSprite(hex) {
  if (spriteCache.has(hex)) return spriteCache.get(hex);
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const [r, gr, b] = hexToRgb(hex);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, `rgba(${r},${gr},${b},0.95)`);
  grd.addColorStop(0.18, `rgba(${r},${gr},${b},0.42)`);
  grd.addColorStop(0.45, `rgba(${r},${gr},${b},0.13)`);
  grd.addColorStop(1, `rgba(${r},${gr},${b},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  spriteCache.set(hex, c);
  return c;
}

const hullCache = new Map();
function hullSprite(hex) {
  const k = 'hull' + hex;
  if (hullCache.has(k)) return hullCache.get(k);
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const [r, gr, b] = hexToRgb(hex);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, `rgba(${r},${gr},${b},0.30)`);
  grd.addColorStop(0.38, `rgba(${r},${gr},${b},0.125)`);
  grd.addColorStop(0.74, `rgba(${r},${gr},${b},0.032)`);
  grd.addColorStop(1, `rgba(${r},${gr},${b},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  hullCache.set(k, c);
  return c;
}

function qBez(p0, pc, p1, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * pc.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * pc.y + t * t * p1.y
  };
}

function edgeGeometry(org, e) {
  const A = org.depts[e.from], B = org.depts[e.to];
  const a0 = A.pos, b0 = B.pos;
  const mx = (a0.x + b0.x) / 2, my = (a0.y + b0.y) / 2;
  const cx = WORLD.w / 2, cy = WORLD.h / 2;
  const vx = mx - cx, vy = my - cy;
  const len = Math.hypot(vx, vy) || 1;
  const bow = Math.hypot(b0.x - a0.x, b0.y - a0.y) * 0.17;
  const c = { x: mx + (vx / len) * bow, y: my + (vy / len) * bow };
  // start/end at the edge of each lobe, not inside the neuron cluster
  const trim = (from, toward, r) => {
    const dx = toward.x - from.x, dy = toward.y - from.y;
    const L = Math.hypot(dx, dy) || 1;
    return { x: from.x + (dx / L) * r, y: from.y + (dy / L) * r };
  };
  const rA = 62 + (A.count || 5) * 2.6;
  const rB = 62 + (B.count || 5) * 2.6;
  return { a: trim(a0, c, rA), b: trim(b0, c, rB), c };
}

function fmtMoney(v, cur) {
  if (v == null || isNaN(v)) return '—';
  const s = Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : v.toFixed(2);
  return `${s} ${cur || ''}`.trim();
}
function ago(t) {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}
const ROBOT_LOOK = {
  off:         { c: '#6e7681', t: 'Switched off' },
  unavailable: { c: '#6e7681', t: 'Robot not running' },
  starting:    { c: '#6e7681', t: 'Starting up' },
  blocked:     { c: '#ef4444', t: 'Blocked' },
  error:       { c: '#ef4444', t: 'Problem' },
  asleep:      { c: '#60a5fa', t: 'Asleep for the weekend' },
  weekend:     { c: '#60a5fa', t: 'Closing up for the weekend' },
  closed:      { c: '#60a5fa', t: 'Market closed' },
  winddown:    { c: '#f59e0b', t: 'Friday wind-down' },
  waiting:     { c: '#f59e0b', t: 'Waiting for a strategy' },
  stale:       { c: '#f59e0b', t: 'Sign-off has expired' },
  stopped:     { c: '#f59e0b', t: 'Stopped for today' },
  cooling:     { c: '#f59e0b', t: 'Cooling off after a loss' },
  watching:    { c: '#22c55e', t: 'Watching for a setup' },
  'in-trade':  { c: '#22c55e', t: 'In a trade' },
};
const robotLook = (r) => (r && ROBOT_LOOK[r.status]) || { c: '#6e7681', t: 'Not reachable' };

function auditorTag(org, checkId) {
  const live = (org.depts.audit ? org.depts.audit.neurons : []).filter(n => n.state !== 'terminating');
  if (!live.length) return null;
  const i = AUDIT_CHECKS.findIndex(c => c.id === checkId);
  return live[i % live.length].tag;
}

const healthColor = (h) => h >= 72 ? '#22c55e' : h >= 55 ? '#eab308' : h >= 42 ? '#f97316' : '#ef4444';

/* ------------------------- live telemetry hook ------------------------- */

function useOrgTelemetry(enabled, symbol, timeframe) {
  const [raw, setRaw] = useState({ account: null, positions: null, stats: null, signals: null });
  const [conn, setConn] = useState({ account: 'idle', positions: 'idle', stats: 'idle', signals: 'idle' });
  const alive = useRef(true);

  const pull = useCallback(async (which) => {
    const set = (k, v, st) => {
      if (!alive.current) return;
      setRaw(p => ({ ...p, [k]: v }));
      setConn(p => ({ ...p, [k]: st }));
    };
    const get = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      if (j && j.error) throw new Error(j.error);
      return j;
    };
    if (which === 'fast' || which === 'all') {
      try { set('account', await get('/api/account'), 'live'); } catch (e) { set('account', null, 'down'); }
      try { set('positions', await get('/api/positions'), 'live'); } catch (e) { set('positions', null, 'down'); }
    }
    if (which === 'slow' || which === 'all') {
      try { set('stats', await get('/api/journal/stats?days=90'), 'live'); } catch (e) { set('stats', null, 'down'); }
      try {
        set('signals', await get(`/api/signals?symbol=${encodeURIComponent(symbol || 'XAUUSDc')}&timeframe=${encodeURIComponent(timeframe || '1H')}&count=800`), 'live');
      } catch (e) { set('signals', null, 'down'); }
    }
  }, [symbol, timeframe]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) {
      setRaw({ account: null, positions: null, stats: null, signals: null });
      setConn({ account: 'off', positions: 'off', stats: 'off', signals: 'off' });
      return () => { alive.current = false; };
    }
    pull('all');
    const f = setInterval(() => pull('fast'), 10000);
    const s = setInterval(() => pull('slow'), 60000);
    return () => { alive.current = false; clearInterval(f); clearInterval(s); };
  }, [enabled, pull]);

  return { raw, conn, refresh: () => pull('all') };
}

/* ----------------------------- renderer ----------------------------- */

function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawScene(ctx, org, cam, dpr, W, H, o, hoverId, selKey, tNow) {
  const s = cam.scale;
  const px = (wx) => wx * s + cam.x;
  const py = (wy) => wy * s + cam.y;

  /* background */
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createRadialGradient(W / 2, H * 0.46, 40, W / 2, H * 0.5, Math.max(W, H) * 0.78);
  bg.addColorStop(0, '#111827');
  bg.addColorStop(0.42, '#0c1018');
  bg.addColorStop(1, '#070a0f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  if (o.showGrid) {
    const step = 46 * s;
    if (step > 12) {
      ctx.fillStyle = 'rgba(255,255,255,0.028)';
      const ox = cam.x % step, oy = cam.y % step;
      for (let x = ox; x < W; x += step) {
        for (let y = oy; y < H; y += step) { ctx.fillRect(x, y, 1.1, 1.1); }
      }
    }
  }

  /* world transform */
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(cam.x, cam.y);
  ctx.scale(s, s);

  const hoverNeuron = hoverId ? org._index[hoverId] : null;
  const hoverDept = hoverNeuron ? hoverNeuron.deptId : (selKey && selKey.startsWith('d:') ? selKey.slice(2) : null);

  /* 1. department hulls */
  for (const d of ALL_DEPTS) {
    const dep = org.depts[d.id];
    const R = (d.id === 'ceo' ? 58 : d.staff ? 60 : 76) + (dep.count || 0) * 3.4;
    const dim = hoverDept && hoverDept !== d.id ? 0.45 : 1;
    ctx.globalAlpha = (0.55 + 0.35 * (dep.pulse || 0.5)) * dim;
    ctx.drawImage(hullSprite(d.color), dep.pos.x - R, dep.pos.y - R, R * 2, R * 2);
    ctx.globalAlpha = 1;
    // incoming-work ring: brightness tracks how much work is landing here
    if ((dep._flash || 0) > 0.03) {
      ctx.strokeStyle = rgba(d.color, clamp(dep._flash, 0, 1) * 0.42 * dim);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(dep.pos.x, dep.pos.y, R * 0.52 + (1 - clamp(dep._flash, 0, 1)) * 22, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /* 2. the org chart above the departments:
   *    Haider → CEO → every lobe, with HR and Audit reporting in sideways. */
  ctx.save();
  ctx.setLineDash([5, 9]);
  ctx.lineDashOffset = -(tNow / 42) % 1000;
  const ceoPos = org.depts.ceo.pos;
  for (const d of DEPARTMENTS) {
    const b = org.depts[d.id].pos, dep = org.depts[d.id];
    if (d.chain === 'oversight') continue;   // those hang off the board row instead
    const focus = org.ceo && org.ceo.focus === d.id;
    const urgency = clamp((100 - (dep.health || 60)) / 60, 0.12, 1);
    ctx.strokeStyle = rgba(CEO_DEPT.color, focus ? 0.55 : 0.10 + urgency * 0.22);
    ctx.lineWidth = focus ? 2.2 : 0.9 + urgency * 1.2;
    ctx.beginPath(); ctx.moveTo(ceoPos.x, ceoPos.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  for (const sid of ['hr', 'audit']) {
    const p2 = org.depts[sid].pos;
    ctx.strokeStyle = rgba(DEPT_BY_ID[sid].color, 0.30);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(ceoPos.x, ceoPos.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  }
  ctx.restore();

  /* the board seat — this is who the CEO answers to */
  const boardPos = org.layout.board;
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(boardPos.x, boardPos.y + 20); ctx.lineTo(ceoPos.x, ceoPos.y - 40); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath(); ctx.arc(boardPos.x, boardPos.y, 19, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.arc(boardPos.x, boardPos.y, 19, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 15px -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(BOARD.name.charAt(0), boardPos.x, boardPos.y + 0.5);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';

  /* 3. value-chain edges */
  for (const e of org.edges) {
    const g = edgeGeometry(org, e);
    const col = DEPT_BY_ID[e.from].color;
    const hot = hoverDept && (e.from === hoverDept || e.to === hoverDept);
    const dim = hoverDept && !hot ? 0.22 : 1;
    ctx.strokeStyle = rgba(col, (0.06 + e.intensity * 0.20) * dim);
    ctx.lineWidth = (1.1 + e.intensity * 4.2) * (hot ? 1.4 : 1);
    ctx.beginPath();
    ctx.moveTo(g.a.x, g.a.y);
    ctx.quadraticCurveTo(g.c.x, g.c.y, g.b.x, g.b.y);
    ctx.stroke();
    ctx.strokeStyle = rgba(col, (0.16 + e.intensity * 0.42) * dim);
    ctx.lineWidth = 0.9;
    ctx.stroke();
    // direction arrow near the receiving lobe
    const at = qBez(g.a, g.c, g.b, 0.9);
    const bt = qBez(g.a, g.c, g.b, 0.93);
    const anga = Math.atan2(bt.y - at.y, bt.x - at.x);
    const ah = 5.4 + e.intensity * 3;
    ctx.fillStyle = rgba(col, (0.30 + e.intensity * 0.45) * dim);
    ctx.beginPath();
    ctx.moveTo(at.x + Math.cos(anga) * ah, at.y + Math.sin(anga) * ah);
    ctx.lineTo(at.x + Math.cos(anga + 2.5) * ah * 0.72, at.y + Math.sin(anga + 2.5) * ah * 0.72);
    ctx.lineTo(at.x + Math.cos(anga - 2.5) * ah * 0.72, at.y + Math.sin(anga - 2.5) * ah * 0.72);
    ctx.closePath();
    ctx.fill();
    e._g = g;
  }

  /* 4. current: work packets travelling the wires */
  if (o.showParticles) {
    ctx.globalCompositeOperation = 'lighter';
    for (const e of org.edges) {
      const col = DEPT_BY_ID[e.from].color;
      const hot = hoverDept && (e.from === hoverDept || e.to === hoverDept);
      const dim = hoverDept && !hot ? 0.25 : 1;
      const [r, gg, b] = hexToRgb(col);
      for (const p of e.particles) {
        const pt = qBez(e._g.a, e._g.c, e._g.b, p.t);
        const fade = Math.sin(Math.PI * p.t);
        for (let k = 1; k <= 3; k++) {
          const tt = p.t - k * 0.014;
          if (tt <= 0) break;
          const q = qBez(e._g.a, e._g.c, e._g.b, tt);
          ctx.fillStyle = `rgba(${r},${gg},${b},${(0.16 - k * 0.04) * fade * dim})`;
          ctx.beginPath();
          ctx.arc(q.x, q.y, p.r * (0.8 - k * 0.16), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = `rgba(${r},${gg},${b},${(0.30 + 0.62 * fade) * dim})`;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, p.r * (0.6 + fade * 0.7), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${0.30 * fade * dim})`;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, p.r * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* 5. reporting lines — employee → manager → HOD. This is the org chart. */
  if (o.showSynapses) {
    for (const d of ALL_DEPTS) {
      const dep = org.depts[d.id];
      const dim = hoverDept && hoverDept !== d.id ? 0.25 : 1;
      const byId = {};
      for (const n of dep.neurons) byId[n.id] = n;
      const hod = dep.neurons.find(n => n.rank === 'hod');
      ctx.lineWidth = 0.8;
      for (const n of dep.neurons) {
        let up = null;
        if (n.rank === 'employee' && n.squad) up = byId[n.squad];
        else if (n.rank === 'manager') up = hod;
        if (!up || up === n) continue;
        ctx.strokeStyle = rgba(d.color, 0.30 * Math.min(n.alpha, up.alpha) * dim);
        ctx.beginPath();
        ctx.moveTo(n.x, n.y);
        ctx.lineTo(up.x, up.y);
        ctx.stroke();
      }
    }
  }

  /* 6. neurons */
  ctx.globalCompositeOperation = 'lighter';
  for (const d of ALL_DEPTS) {
    const dep = org.depts[d.id];
    const dim = hoverDept && hoverDept !== d.id ? 0.35 : 1;
    const sprite = glowSprite(d.color);
    for (const n of dep.neurons) {
      const fire = 0.5 + 0.5 * Math.sin(n.firePhase);
      const rk = (RANK_META[n.rank] || RANK_META.employee).size;
      const R = (11 + n.load * 9 + fire * 5) * rk * (n.state === 'star' ? 1.18 : 1);
      ctx.globalAlpha = clamp(n.alpha * (0.34 + fire * 0.4) * dim, 0, 1);
      ctx.drawImage(sprite, n.x - R, n.y - R, R * 2, R * 2);
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  for (const d of ALL_DEPTS) {
    const dep = org.depts[d.id];
    const dim = hoverDept && hoverDept !== d.id ? 0.4 : 1;
    for (const n of dep.neurons) {
      const fire = 0.5 + 0.5 * Math.sin(n.firePhase);
      const sel = selKey === 'n:' + n.id;
      const hov = hoverId === n.id;
      const rk = (RANK_META[n.rank] || RANK_META.employee).size;
      const rr = (3.4 + n.load * 2.4) * rk + (n.state === 'star' ? 1.0 : 0);
      ctx.globalAlpha = n.alpha * dim;

      /* body */
      ctx.fillStyle = n.state === 'terminating' ? '#ef4444'
        : n.state === 'training' ? '#f59e0b'
          : n.state === 'onboarding' ? '#38bdf8'
            : d.color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.35 + fire * 0.5})`;
      ctx.beginPath();
      ctx.arc(n.x, n.y, rr * 0.45, 0, Math.PI * 2);
      ctx.fill();

      /* score arc */
      const ar = rr + 4.2;
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.beginPath(); ctx.arc(n.x, n.y, ar, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = healthColor(n.score);
      ctx.beginPath();
      ctx.arc(n.x, n.y, ar, -Math.PI / 2, -Math.PI / 2 + (n.score / 100) * Math.PI * 2);
      ctx.stroke();

      /* state ring */
      if (n.state === 'training') {
        ctx.save();
        ctx.setLineDash([2.4, 3.2]);
        ctx.lineDashOffset = -(tNow / 90) % 100;
        ctx.strokeStyle = 'rgba(245,158,11,0.85)';
        ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(n.x, n.y, ar + 3.6, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      } else if (n.state === 'star') {
        ctx.strokeStyle = 'rgba(251,191,36,0.9)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(n.x, n.y, ar + 3.4, 0, Math.PI * 2); ctx.stroke();
      } else if (n.state === 'terminating') {
        const k = clamp(n.stateT / 2, 0, 1);
        ctx.strokeStyle = `rgba(239,68,68,${1 - k})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(n.x, n.y, ar + 3 + k * 16, 0, Math.PI * 2); ctx.stroke();
      } else if (n.state === 'onboarding') {
        const k = clamp(n.stateT / 1.6, 0, 1);
        ctx.strokeStyle = `rgba(56,189,248,${1 - k})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(n.x, n.y, ar + 16 - k * 13, 0, Math.PI * 2); ctx.stroke();
      }

      /* rank insignia — a HOD is drawn as a hexagon, a manager gets an
       * outer bracket. You should be able to read the org chart at a glance. */
      if (n.rank === 'hod') {
        ctx.strokeStyle = rgba(d.color, 0.9);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a2 = -Math.PI / 2 + (k / 6) * Math.PI * 2;
          const px2 = n.x + Math.cos(a2) * (ar + 6.5), py2 = n.y + Math.sin(a2) * (ar + 6.5);
          k ? ctx.lineTo(px2, py2) : ctx.moveTo(px2, py2);
        }
        ctx.closePath(); ctx.stroke();
      } else if (n.rank === 'manager') {
        ctx.strokeStyle = rgba(d.color, 0.75);
        ctx.lineWidth = 1.3;
        for (const off of [0, Math.PI]) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, ar + 5, off - 0.5, off + 0.5);
          ctx.stroke();
        }
      }
      if (sel || hov) {
        ctx.strokeStyle = sel ? '#ffffff' : 'rgba(255,255,255,0.6)';
        ctx.lineWidth = sel ? 1.8 : 1.1;
        ctx.beginPath(); ctx.arc(n.x, n.y, ar + 9, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  /* 7. the CEO's office */
  const hrp = org.depts.ceo.pos;
  const beat = 0.5 + 0.5 * Math.sin(tNow / 620);
  ctx.save();
  ctx.translate(hrp.x, hrp.y);
  for (let i = 0; i < 4; i++) {
    const rad = 52 + i * 19 + beat * 5;
    ctx.strokeStyle = rgba(CEO_DEPT.color, 0.34 - i * 0.068);
    ctx.lineWidth = 1.3;
    const spin = (tNow / (1400 + i * 700)) * (i % 2 ? -1 : 1);
    ctx.beginPath();
    ctx.arc(0, 0, rad, spin, spin + Math.PI * (1.15 - i * 0.22));
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(CEO_DEPT.color, 0.55);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, 36 + beat * 3, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  ctx.restore();

  /* 8. labels in screen space (crisp at any zoom) */
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!o.showLabels) return;

  for (const d of ALL_DEPTS) {
    const dep = org.depts[d.id];
    const R = (d.id === 'ceo' ? 50 : d.staff ? 54 : 82) + (dep.count || 0) * 3.0;
    const X = px(dep.pos.x), Y = py(dep.pos.y + R * 0.78 + 30);
    if (X < -240 || X > W + 240 || Y < -160 || Y > H + 160) continue;

    const open = hoverDept === d.id || selKey === 'd:' + d.id;
    ctx.globalAlpha = clamp((s - 0.22) / 0.22, 0, 1);

    /* Seventeen departments will not fit as seventeen full cards at any zoom
     * that also shows the whole firm. So: a compact pill for everyone, and the
     * full card only for the one you are pointing at. */
    ctx.font = '600 11px -apple-system, Segoe UI, Roboto, sans-serif';
    let name = d.name;
    const maxName = open ? 200 : 118;
    while (name.length > 6 && ctx.measureText(name).width > maxName) name = name.slice(0, -2);
    if (name !== d.name) name = name.trim() + '…';

    ctx.font = '700 10px -apple-system, Segoe UI, Roboto, sans-serif';
    const codeW = ctx.measureText(d.code).width;
    ctx.font = '600 11px -apple-system, Segoe UI, Roboto, sans-serif';
    const nameW = ctx.measureText(name).width;
    const countTxt = d.id === 'ceo' ? '' : `${dep.count || 0}/${dep.target || 0}`;
    ctx.font = '600 10px -apple-system, Segoe UI, Roboto, sans-serif';
    const countW = countTxt ? ctx.measureText(countTxt).width + 8 : 0;

    const w = Math.max(96, codeW + nameW + countW + 34);
    const h = open && d.lab ? 54 : 30;
    const x = X - w / 2, y = Y - h / 2;

    roundRect(ctx, x, y, w, h, 7);
    ctx.fillStyle = open ? 'rgba(10,14,20,0.94)' : 'rgba(10,14,20,0.80)';
    ctx.fill();
    ctx.strokeStyle = rgba(d.color, open ? 0.75 : 0.34);
    ctx.lineWidth = open ? 1.4 : 1;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = d.color;
    ctx.font = '700 10px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(d.code, x + 9, y + 14.5);
    ctx.fillStyle = open ? '#ffffff' : '#dfe4ea';
    ctx.font = '600 11px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(name, x + 9 + codeW + 8, y + 14.5);
    if (countTxt) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#6e7681';
      ctx.font = '600 10px -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.fillText(countTxt, x + w - 9, y + 14.5);
      ctx.textAlign = 'left';
    }

    /* health as a hairline under the name, always visible */
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x + 9, y + 21, w - 18, 2.5);
    ctx.fillStyle = healthColor(dep.health || 0);
    ctx.fillRect(x + 9, y + 21, (w - 18) * clamp((dep.health || 0) / 100, 0, 1), 2.5);

    if (open && d.lab) {
      ctx.font = '500 9.5px -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.fillStyle = '#6e7681';
      ctx.fillText(d.metricLabel, x + 9, y + 39);
      ctx.fillStyle = '#d1d4dc';
      ctx.font = '700 10px -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.fillText(dep.metricText || '—', x + 9 + ctx.measureText(d.metricLabel).width + 10, y + 39);
      const chip = dep.live ? 'LIVE' : 'SIM';
      ctx.font = '700 8px -apple-system, Segoe UI, Roboto, sans-serif';
      const cw = ctx.measureText(chip).width + 10;
      roundRect(ctx, x + w - 9 - cw, y + 31, cw, 11, 3);
      ctx.fillStyle = dep.live ? 'rgba(34,197,94,0.16)' : 'rgba(148,163,184,0.16)';
      ctx.fill();
      ctx.fillStyle = dep.live ? '#22c55e' : '#94a3b8';
      ctx.textAlign = 'center';
      ctx.fillText(chip, x + w - 9 - cw / 2, y + 39);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;
  }
}

/* --------------------------- small UI bits --------------------------- */

const Chip = ({ children, color = '#8b949e', bg }) => (
  <span style={{
    fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, color,
    background: bg || rgba(color, 0.14), padding: '2px 6px', borderRadius: 3,
    textTransform: 'uppercase', whiteSpace: 'nowrap'
  }}>{children}</span>
);

const Bar = ({ v, color, h = 5 }) => (
  <div style={{ height: h, background: 'rgba(255,255,255,0.07)', borderRadius: h / 2, overflow: 'hidden' }}>
    <div style={{ width: `${clamp(v, 0, 100)}%`, height: '100%', background: color, borderRadius: h / 2, transition: 'width .4s ease' }} />
  </div>
);

const Stat = ({ label, value, color = '#d1d4dc', sub }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: 9, color: '#6e7681', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: 13, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{value}</div>
    {sub && <div style={{ fontSize: 9.5, color: '#6e7681' }}>{sub}</div>}
  </div>
);

function Spark({ data = [], color = '#22c55e', w = 132, h = 30 }) {
  if (!data.length) return <div style={{ height: h }} />;
  const min = Math.min(...data, 0), max = Math.max(...data, 100);
  const pts = data.map((v, i) => {
    const x = (i / Math.max(1, data.length - 1)) * w;
    const y = h - ((v - min) / Math.max(1, max - min)) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function DualSpark({ rows = [], w = 300, h = 66 }) {
  if (rows.length < 2) return <div style={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, color: '#4b5563' }}>collecting generations…</div>;
  const vals = rows.flatMap(r => [r.select, r.honest]).filter(v => isFinite(v));
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = Math.max(1, max - min);
  const pt = (v, i) => `${((i / (rows.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`;
  const zeroY = h - ((0 - min) / span) * h;
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      {zeroY > 0 && zeroY < h && <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="#2a2e39" strokeDasharray="3 3" strokeWidth="1" />}
      <polyline points={rows.map((r, i) => pt(r.select, i)).join(' ')} fill="none" stroke="#6e7681" strokeWidth="1.4" />
      <polyline points={rows.map((r, i) => pt(r.honest, i)).join(' ')} fill="none" stroke="#22c55e" strokeWidth="1.8" />
    </svg>
  );
}

const btn = (active) => ({
  display: 'flex', alignItems: 'center', gap: 5,
  background: active ? 'rgba(41,98,255,0.18)' : 'rgba(255,255,255,0.04)',
  border: `1px solid ${active ? 'rgba(41,98,255,0.5)' : 'rgba(255,255,255,0.08)'}`,
  color: active ? '#7aa2ff' : '#8b949e',
  borderRadius: 5, padding: '5px 9px', fontSize: 11, fontWeight: 600, cursor: 'pointer'
});

function Slider({ label, value, min, max, step, onChange, suffix }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 168 }}>
      <span style={{ fontSize: 10, color: '#6e7681', width: 58, fontWeight: 600 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: '#2962ff', height: 3, cursor: 'pointer' }} />
      <span style={{ fontSize: 10, color: '#d1d4dc', width: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {value}{suffix || ''}
      </span>
    </div>
  );
}

/* ------------------------------ component ------------------------------ */

export default function MyBrainsTab({ symbol = 'XAUUSDc', timeframe = '1H' }) {
  const [settings, setSettings] = useState(() => {
    try { return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(LS_SETTINGS)) || {}), paused: false }; }
    catch (e) { return { ...DEFAULT_SETTINGS }; }
  });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const set = (patch) => setSettings(p => { const n = { ...p, ...patch }; try { localStorage.setItem(LS_SETTINGS, JSON.stringify(n)); } catch (e) { } return n; });

  const session = useBrainsSession(symbol, timeframe, 600);
  const orgRef = useRef(null);
  orgRef.current = session.org;

  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const camRef = useRef({ x: 0, y: 0, scale: 1, ready: false });
  const dragRef = useRef(null);
  const labAcc = useRef(0);
  const frameMs = useRef(16);
  const dprCap = useRef(1.5);
  const [hoverId, setHoverId] = useState(null);
  const hoverRef = useRef(null);
  const [sel, setSel] = useState(null);
  const selRef = useRef(null);
  selRef.current = sel;
  const [tip, setTip] = useState(null);
  const [rail, setRail] = useState(true);
  const [menu, setMenu] = useState(false);
  const [detail, setDetail] = useState(false);
  const [railTab, setRailTab] = useState('brief');
  /* Plain words by default; the exact settings are a click away. */
  const [exactSettings, setExactSettings] = useState(false);
  const [, force] = useState(0);
  const [feedFilter, setFeedFilter] = useState('ALL');

  const lab = { status: session.status, note: session.note, live: session.live, universe: session.universe ? session.universe.length : 0 };
  const [robot, setRobot] = useState(null);
  const publishedRef = useRef('');

  const { raw, conn, refresh } = useOrgTelemetry(settings.liveData, symbol, timeframe);
  const rawRef = useRef(raw);
  rawRef.current = raw;

  const org = orgRef.current;

  /* the floor runs in the shared session so it keeps working when you are
   * looking at another tab; this tab only draws it and sets the pace */
  useEffect(() => {
    setSessionOptions({ speed: settings.speed, paused: settings.paused, labRate: settings.labRate });
  }, [settings.speed, settings.paused, settings.labRate]);

  /* ---- fit / camera ---- */
  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const w = el.clientWidth, h = el.clientHeight;
    const s = Math.min(w / (WORLD.w + 130), h / (WORLD.h + 150));
    camRef.current = {
      x: w / 2 - (WORLD.w / 2) * s,
      y: h / 2 - (WORLD.h / 2) * s,
      scale: s, ready: true
    };
  }, []);

  /* ---- main loop ---- */
  useEffect(() => {
    let rafId = 0, last = performance.now(), teleAcc = 0, uiAcc = 0, saveAcc = 0;
    const cv = canvasRef.current;
    const ctx = cv.getContext('2d', { alpha: false });

    const loop = (now) => {
      rafId = requestAnimationFrame(loop);
      const dt = Math.min(now - last, 90);
      last = now;
      const o = settingsRef.current;
      const el = wrapRef.current;
      if (!el) return;

      /* Adaptive resolution. The canvas is fill-rate bound, not CPU bound —
       * on a 4K panel a 2x backing store quadruples the pixels for no visible
       * gain here. Drop the scale when frames get slow, restore when they do not. */
      frameMs.current = frameMs.current * 0.92 + dt * 0.08;
      if (frameMs.current > 26 && dprCap.current > 1) dprCap.current = 1;
      else if (frameMs.current < 13 && dprCap.current < 1.5) dprCap.current = 1.5;
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap.current);
      const W = el.clientWidth, H = el.clientHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
        cv.style.width = W + 'px'; cv.style.height = H + 'px';
        if (!camRef.current.ready) fit();
      }
      if (!camRef.current.ready) fit();

      /* telemetry -> lobes (also refreshes the simulated Political pulse) */
      teleAcc += dt;
      if (teleAcc > 1500) { teleAcc = 0; applyTelemetry(org, rawRef.current); }

      /* current on the wires */
      const dtS = Math.min(dt, 80) / 1000 * (o.paused ? 0 : o.speed);
      for (const e of org.edges) {
        if (o.showParticles) {
          e._acc = (e._acc || 0) + (e.rate || 2) * dtS * 0.7;
          while (e._acc >= 1 && e.particles.length < 24) {
            e._acc -= 1;
            e.particles.push({ t: Math.random() * 0.05, sp: 0.15 + Math.random() * 0.17, r: 1.2 + Math.random() * 1.6 });
          }
        } else if (e.particles.length) { e.particles.length = 0; }
        for (let i = e.particles.length - 1; i >= 0; i--) {
          const p = e.particles[i];
          p.t += p.sp * dtS;
          if (p.t >= 1) {
            e.particles.splice(i, 1);
            const tgt = org.depts[e.to];
            tgt._flash = Math.min(1, (tgt._flash || 0) + 0.5);
          }
        }
      }
      for (const k in org.depts) {
        const dep2 = org.depts[k];
        if (dep2._flash) dep2._flash *= Math.pow(0.93, dt / 16);
      }

      /* neuron index for hit-test + inspector */
      const idx = {};
      for (const k in org.depts) for (const n of org.depts[k].neurons) idx[n.id] = n;
      org._index = idx;

      drawScene(ctx, org, camRef.current, dpr, W, H, o, hoverRef.current, selRef.current, now);

      uiAcc += dt;
      if (uiAcc > 420) { uiAcc = 0; force(v => v + 1); }
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [org, fit]);

  useEffect(() => { pushTelemetry(raw); }, [raw]);

  /* ---- hand the audited strategy to the robot, and watch what it does ----
   * The robot lives in the Python backend, not in this tab. It trades only
   * what Audit has signed off, so what we publish is the champion set PLUS
   * the audit verdict — including a failing one, because the robot needs to
   * know it is blocked and why rather than just going quiet. */
  useEffect(() => {
    let dead = false;
    const poll = () => {
      fetch('/api/autonomy/status')
        .then(r => r.json())
        .then(j => { if (!dead) setRobot(j); })
        .catch(() => { if (!dead) setRobot(null); });
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { dead = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    const L2 = orgRef.current.lab;
    const a = orgRef.current.audit;
    if (!L2 || !L2.championScore || !a) return;
    const sig = JSON.stringify([a.pass, a.gen, L2.champions,
      (L2.book && L2.book.admitted) ? L2.book.admitted.map(c => c.id + ':' + c.symbol) : null,
      (L2.book && L2.book.weights) ? L2.book.weights.map(w => w.toFixed(3)) : null]);
    if (sig === publishedRef.current) return;
    publishedRef.current = sig;
    const cs2 = L2.championScore;
    const liveBook = bookForLive(orgRef.current);
    fetch('/api/autonomy/strategy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol, timeframe,
        bredOn: L2.universe && L2.universe[L2.focus] ? L2.universe[L2.focus].key : null,
        generation: L2.generation,
        champions: L2.champions,
        /* The book, so the robot runs what Portfolio Construction actually
         * decided rather than one champion. `champions` stays in the payload
         * as the fallback for an older trader. */
        book: liveBook.slots.map(sl => ({
          id: sl.id, symbol: sl.symbol, timeframe: sl.timeframe,
          cfg: sl.cfg, weight: sl.weight, metrics: sl.metrics || null,
        })),
        bookInfo: { kEff: liveBook.kEff, avgCorr: liveBook.avgCorr,
                    dropped: liveBook.dropped, single: !!liveBook.single },
        audit: {
          pass: a.pass,
          blockers: a.findings.filter(f => f.severity === 'block').map(f => `${f.title} — ${f.detail}`),
          warnings: a.warnings,
        },
        metrics: {
          trades: cs2.test.trades, minTrades: cs2.test.minTrades,
          winRate: cs2.test.winRate, expectancy: cs2.test.expectancy,
          returnPct: cs2.test.returnPct, maxEqDD: cs2.test.maxEqDD,
          gap: cs2.gap, unseen: cs2.honest,
        },
        summary: PIPE_DEPTS.map(id => ({ dept: DEPT_BY_ID[id].name, text: summariseChampion(id, (L2.bookG && L2.bookG[id]) || L2.champions[id]) })),
        dataSource: lab.live ? 'real bars' : 'synthetic',
      }),
    }).catch(() => { publishedRef.current = ''; });
  }, [
    orgRef.current.audit && orgRef.current.audit.gen,
    orgRef.current.audit && orgRef.current.audit.pass,
    symbol, timeframe, lab.live,
  ]);

  /* ---- pointer ---- */
  const toWorld = (cx, cy) => {
    const r = wrapRef.current.getBoundingClientRect();
    const c = camRef.current;
    return { x: (cx - r.left - c.x) / c.scale, y: (cy - r.top - c.y) / c.scale, sx: cx - r.left, sy: cy - r.top };
  };
  const pick = (wx, wy) => {
    let best = null, bd = 1e9;
    for (const k in org.depts) for (const n of org.depts[k].neurons) {
      const d = (n.x - wx) * (n.x - wx) + (n.y - wy) * (n.y - wy);
      if (d < bd) { bd = d; best = n; }
    }
    return bd < 300 ? best : null;
  };
  const pickDept = (wx, wy) => {
    for (const d of ALL_DEPTS) {
      const p = org.depts[d.id].pos;
      if (Math.hypot(p.x - wx, p.y - wy) < 135) return d.id;
    }
    return null;
  };

  const onDown = (e) => {
    /* Only the canvas itself starts a drag. Capturing the pointer on the
     * wrapper stops the browser delivering `click` to overlay buttons sitting
     * on top of it — which is why the Menu button did nothing. */
    if (e.target !== canvasRef.current) return;
    const p = toWorld(e.clientX, e.clientY);
    dragRef.current = { sx: e.clientX, sy: e.clientY, cx: camRef.current.x, cy: camRef.current.y, moved: 0, wx: p.x, wy: p.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const d = dragRef.current;
    if (!d && e.target !== canvasRef.current) { if (tip) setTip(null); return; }
    const p = toWorld(e.clientX, e.clientY);
    if (d) {
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      d.moved = Math.max(d.moved, Math.abs(dx) + Math.abs(dy));
      if (d.moved > 3) { camRef.current.x = d.cx + dx; camRef.current.y = d.cy + dy; }
      return;
    }
    const n = pick(p.x, p.y);
    hoverRef.current = n ? n.id : null;
    if ((n ? n.id : null) !== hoverId) setHoverId(n ? n.id : null);
    setTip(n ? { x: p.sx, y: p.sy, n } : null);
  };
  const onUp = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.moved > 4) return;
    const p = toWorld(e.clientX, e.clientY);
    const n = pick(p.x, p.y);
    if (n) { setSel('n:' + n.id); setRailTab('depts'); setRail(true); return; }
    const dep = pickDept(p.x, p.y);
    if (dep) { setSel('d:' + dep); setRailTab('depts'); setRail(true); return; }
    setSel(null);
  };
  const onWheel = (e) => {
    if (e.target !== canvasRef.current) return;
    const c = camRef.current;
    const r = wrapRef.current.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.exp(-e.deltaY * 0.0014);
    const ns = clamp(c.scale * k, 0.22, 3.2);
    c.x = mx - (mx - c.x) * (ns / c.scale);
    c.y = my - (my - c.y) * (ns / c.scale);
    c.scale = ns;
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); set({ paused: !settingsRef.current.paused }); }
      else if (e.key === 'f' || e.key === 'F') fit();
      else if (e.key === 'Escape') setSel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fit]);

  /* ---- derived ---- */
  const heads = headcount(org);
  const avgHealth = DEPARTMENTS.reduce((a, d) => a + (org.depts[d.id].health || 0), 0) / DEPARTMENTS.length;
  const vit = (org.telemetry && org.telemetry._org) || {};
  const runway = payrollRunway(org, settings.dayCost);
  const selNeuron = sel && sel.startsWith('n:') ? (org._index || {})[sel.slice(2)] : null;
  const selDeptId = sel && sel.startsWith('d:') ? sel.slice(2) : (selNeuron ? selNeuron.deptId : null);
  const selDept = selDeptId ? DEPT_BY_ID[selDeptId] : null;
  const liveFeeds = Object.values(conn).filter(v => v === 'live').length;
  const totalFeeds = 4;
  const L = org.lab;
  const cs = L && L.championScore;
  const today = org.daily[org.today];
  const days = dayList(org);
  const audit = org.audit;
  const blockers = audit ? audit.findings.filter(f => f.severity === 'block') : [];
  const verdict = !cs ? { title: 'Starting up', line: 'Loading price history and putting people to work.', color: '#8b949e' }
    : !audit ? { title: 'First results pending', line: 'Audit has not signed off on anything yet.', color: '#8b949e' }
      : audit.pass ? {
          title: audit.overruledByCeo ? 'Ready to trade (CEO Overrule)' : 'Ready to trade',
          line: audit.overruledByCeo
            ? 'The CEO has exercised executive authority: out-of-sample edge is proven and the strategy is cleared for deployment.'
            : 'The current strategy passed every audit check, including on months it was never allowed to study.',
          color: '#22c55e'
        }
        : { title: 'Not ready to trade', line: `${blockers[0].title}. ${blockers[0].detail}`, color: '#ef4444' };
  /* Saying what is wrong is only half a briefing. Haider is the director:
   * the useful sentence is what, if anything, he should do about it — and
   * most of the time the honest answer is "nothing, leave it running", which
   * is worth saying out loud rather than leaving him to guess. */
  const yourMove = (() => {
    if (!cs || !audit) return 'Nothing yet — let it run for a few minutes.';
    if (audit.pass) {
      return audit.overruledByCeo
        ? 'Executive sign-off granted by the CEO. Ensure MT5 is connected so the desk can trade.'
        : 'Nothing here. Check the robot panel: if it says Algo Trading is off in MetaTrader, that is yours to switch on.';
    }
    const b = blockers[0];
    if (!b) return 'Nothing. Leave it running.';
    if (b.id === 'limits') return 'This one needs an engineer — it is a fault in the machinery, not a weak strategy.';
    if (b.id === 'dsr') return 'Nothing today. Beating our own search needs a better idea, not more attempts.';
    if (b.id === 'sample') return 'Nothing today. If it persists for days, the answer is more instruments that behave differently.';
    if (b.id === 'executable') return 'Nothing. It is stopping the robot trading something that was never proven.';
    return 'Nothing. This is the search still working, and it is meant to take a while.';
  })();
  const todayMove = today && today.startHonest != null && today.endHonest != null ? today.endHonest - today.startHonest : null;
  const hrPolicy = org.hrPolicy || { strictness: 1, staffing: 1, why: '', rigourWhy: '' };
  const focusDept = org.ceo && org.ceo.focus ? DEPT_BY_ID[org.ceo.focus] : null;

  const events = useMemo(
    () => feedFilter === 'ALL' ? org.events : org.events.filter(e => e.type === feedFilter),
    [org.events, feedFilter, heads]
  );

  const toneColor = { good: '#22c55e', bad: '#ef4444', warn: '#f59e0b', info: '#60a5fa' };

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', background: '#070a0f', overflow: 'hidden' }}>

      {/* =========================== CANVAS =========================== */}
      <div
        ref={wrapRef}
        style={{ flex: 1, position: 'relative', minWidth: 0, cursor: dragRef.current ? 'grabbing' : hoverId ? 'pointer' : 'grab' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { setTip(null); hoverRef.current = null; }}
        onWheel={onWheel} onDoubleClick={fit}
      >
        <canvas ref={canvasRef} style={{ display: 'block', position: 'absolute', inset: 0 }} />

        {/* ---- org header ---- */}
        <div style={{
          position: 'absolute', top: 12, left: 12, background: 'rgba(10,14,20,0.9)',
          border: '1px solid #1f2430', borderRadius: 10, padding: '11px 14px', backdropFilter: 'blur(7px)',
          width: 396, pointerEvents: 'none'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
            <Brain size={17} color={CEO_DEPT.color} />
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#fff', letterSpacing: 0.2 }}>Shah Investment Center</div>
              <div style={{ fontSize: 10, color: '#6e7681' }}>
                CEO briefing for {BOARD.name} · {BOARD.role}
              </div>
            </div>
          </div>

          <div style={{
            background: rgba(verdict.color, 0.10), border: `1px solid ${rgba(verdict.color, 0.35)}`,
            borderRadius: 8, padding: '9px 11px', marginBottom: 10
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: verdict.color }} />
              <span style={{ fontSize: 13, fontWeight: 800, color: verdict.color }}>{verdict.title}</span>
            </div>
            <div style={{ fontSize: 10.5, color: '#a9b1bd', lineHeight: 1.55 }}>{verdict.line}</div>
            <div style={{
              marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.07)',
              display: 'flex', gap: 7, alignItems: 'flex-start'
            }}>
              <span style={{ fontSize: 8.5, fontWeight: 800, color: '#fbbf24', letterSpacing: 0.4, paddingTop: 2, flexShrink: 0 }}>
                YOUR MOVE
              </span>
              <span style={{ fontSize: 10.5, color: '#e8dcc0', lineHeight: 1.55 }}>{yourMove}</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 11 }}>
            <Stat label="Account" value={vit.equity ? fmtMoney(vit.equity, vit.currency) : '—'}
              color={vit.equity ? '#d1d4dc' : '#4b5563'}
              sub={vit.profit != null && vit.live ? `${vit.profit >= 0 ? '+' : ''}${vit.profit.toFixed(2)} open` : 'no feed'} />
            <Stat label="Today"
              value={todayMove == null ? '—' : `${todayMove >= 0 ? '+' : ''}${todayMove.toFixed(1)}`}
              color={todayMove == null ? '#4b5563' : todayMove > 0 ? '#22c55e' : todayMove < 0 ? '#ef4444' : '#8b949e'}
              sub={today ? `${today.published} ideas adopted` : 'starting'} />
            <Stat label="People" value={heads}
              sub={`${(org.stats.evals || 0).toLocaleString()} tests run`} />
            <Stat label="Audit"
              value={audit ? (audit.pass ? 'Clear' : `${audit.blocking} block`) : '—'}
              color={audit ? (audit.pass ? '#22c55e' : '#ef4444') : '#4b5563'}
              sub={audit ? `${audit.warnings} warning${audit.warnings === 1 ? '' : 's'}` : 'checking'} />
          </div>
        </div>

        {/* ---- feed status ---- */}
        <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(10,14,20,0.86)',
            border: '1px solid #1f2430', borderRadius: 6, padding: '5px 9px', fontSize: 10.5, color: '#8b949e'
          }}>
            {liveFeeds > 0 ? <Wifi size={12} color="#22c55e" /> : <WifiOff size={12} color="#ef4444" />}
            <span>{settings.liveData ? `${liveFeeds}/${totalFeeds} feeds live` : 'live data off'}</span>
            <button onClick={refresh} title="Refresh feeds"
              style={{ background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer', padding: 0, display: 'flex' }}>
              <RotateCcw size={11} />
            </button>
          </div>
          {robot && robot.available && (() => {
            const lk = robotLook(robot);
            return (
              <div title={robot.reason || ''} style={{
                display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(10,14,20,0.86)',
                border: `1px solid ${rgba(lk.c, 0.35)}`, borderRadius: 6, padding: '5px 9px',
                fontSize: 10.5, color: lk.c, fontWeight: 700
              }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: lk.c }} />
                Desk: {lk.t}
              </div>
            );
          })()}
          <button onClick={() => setMenu(m => !m)} style={{ ...btn(menu), padding: '6px 11px' }} title="Settings">
            <Settings size={13} /> Menu
          </button>
        </div>

        {/* ---- legend ---- */}
        <div style={{
          position: 'absolute', top: 118, right: 12, background: 'rgba(10,14,20,0.8)', border: '1px solid #1f2430',
          borderRadius: 7, padding: '8px 10px', fontSize: 10, color: '#8b949e', pointerEvents: 'none', lineHeight: 1.75
        }}>
          <div style={{ color: '#6e7681', fontWeight: 700, fontSize: 9, letterSpacing: 0.5, marginBottom: 3 }}>RANK</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 11, color: '#d1d4dc' }}>⬡</span> Head of Department</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 11, color: '#d1d4dc' }}>( )</span> Manager</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 11, color: '#d1d4dc' }}>•</span> Employee</div>
          <div style={{ color: '#6e7681', fontWeight: 700, fontSize: 9, letterSpacing: 0.5, margin: '6px 0 3px' }}>STATE</div>
          {Object.entries(STATE_META).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: 4, background: v.color, display: 'inline-block' }} />
              {v.label}
            </div>
          ))}
        </div>

        {/* ---- hover tooltip ---- */}
        {tip && (
          <div style={{
            position: 'absolute', left: clamp(tip.x + 16, 8, 10000), top: Math.max(8, tip.y - 10),
            background: 'rgba(12,16,24,0.96)', border: `1px solid ${rgba(DEPT_BY_ID[tip.n.deptId].color, 0.5)}`,
            borderRadius: 7, padding: '8px 10px', pointerEvents: 'none', minWidth: 172, zIndex: 5
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: DEPT_BY_ID[tip.n.deptId].color }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{tip.n.tag}</span>
              <span style={{ fontSize: 10.5, color: '#8b949e' }}>{tip.n.name}</span>
            </div>
            <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 5 }}>{DEPT_BY_ID[tip.n.deptId].name} · {tip.n.task}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: healthColor(tip.n.score), fontVariantNumeric: 'tabular-nums' }}>
                {tip.n.score.toFixed(0)}
              </span>
              <Chip color={STATE_META[tip.n.state].color}>{STATE_META[tip.n.state].label}</Chip>
            </div>
          </div>
        )}

        {/* ---- settings, behind the one Menu button ---- */}
        {menu && (
          <div style={{
            position: 'absolute', top: 52, right: 12, width: 322, maxHeight: 'calc(100% - 70px)', overflowY: 'auto',
            background: 'rgba(10,14,20,0.97)', border: '1px solid #242a36', borderRadius: 10,
            padding: 14, backdropFilter: 'blur(8px)', zIndex: 20, boxShadow: '0 18px 50px rgba(0,0,0,0.55)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: '#fff' }}>Settings</span>
              <button onClick={() => setMenu(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer' }}><X size={14} /></button>
            </div>

            <div style={{ fontSize: 9.5, color: '#6e7681', fontWeight: 700, letterSpacing: 0.5, marginBottom: 7 }}>THE TRADING DESK</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <button
                onClick={() => fetch('/api/autonomy/control', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ enabled: !(robot && robot.enabled) })
                }).catch(() => { })}
                style={{ ...btn(robot && robot.enabled), flex: 1, justifyContent: 'center' }}>
                {robot && robot.enabled ? <Pause size={12} /> : <Play size={12} />}
                {robot && robot.enabled ? 'Stop trading' : 'Start trading'}
              </button>
              <button
                onClick={() => fetch('/api/autonomy/control', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ mode: robot && robot.mode === 'paper' ? 'live' : 'paper' })
                }).catch(() => { })}
                style={{ ...btn(robot && robot.mode === 'paper'), flex: 1, justifyContent: 'center' }}>
                {robot && robot.mode === 'paper' ? 'Paper mode' : 'Placing orders'}
              </button>
            </div>
            <div style={{ fontSize: 9.5, color: '#6e7681', lineHeight: 1.55, marginBottom: 12 }}>
              Locked to account #{(robot && robot.locked_to) || '—'} on a demo server. It refuses to place an order
              on any other account, refuses a live account outright, and trades only a strategy Audit has signed off.
            </div>

            <div style={{ fontSize: 9.5, color: '#6e7681', fontWeight: 700, letterSpacing: 0.5, marginBottom: 7 }}>THE RESEARCH FLOOR</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <button onClick={() => set({ paused: !settings.paused })} style={{ ...btn(!settings.paused), flex: 1, justifyContent: 'center' }}>
                {settings.paused ? <Play size={12} /> : <Pause size={12} />}{settings.paused ? 'Resume work' : 'Pause work'}
              </button>
              <button onClick={() => setRail(r => !r)} style={{ ...btn(rail), flex: 1, justifyContent: 'center' }}>
                {rail ? <EyeOff size={12} /> : <Eye size={12} />}Side panel
              </button>
            </div>
            <div style={{ marginBottom: 8 }}>
              <Slider label="Pace" min={0.25} max={4} step={0.25} value={settings.speed} onChange={v => set({ speed: v })} suffix="x" />
            </div>
            <div style={{ marginBottom: 4 }}>
              <Slider label="Effort" min={20} max={600} step={20} value={settings.labRate} onChange={v => set({ labRate: v })} suffix="/s" />
            </div>
            <div style={{ fontSize: 9.5, color: '#6e7681', lineHeight: 1.55, marginBottom: 12 }}>
              Effort is how many strategy tests the floor runs per second. Higher finds ideas faster and uses more of your CPU.
            </div>

            <div style={{ fontSize: 9.5, color: '#6e7681', fontWeight: 700, letterSpacing: 0.5, marginBottom: 7 }}>HR — RUNS ITSELF</div>
            <div style={{ background: 'rgba(244,114,182,0.07)', border: '1px solid rgba(244,114,182,0.2)', borderRadius: 7, padding: 10, marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 14, marginBottom: 6 }}>
                <Stat label="Standards" value={hrPolicy.strictness.toFixed(2)} color="#f472b6" />
                <Stat label="Headcount" value={`${hrPolicy.staffing.toFixed(2)}x`} color="#f472b6" />
              </div>
              <div style={{ fontSize: 9.5, color: '#8b949e', lineHeight: 1.6 }}>
                {hrPolicy.rigourWhy}; {hrPolicy.why}. These are set by HR, not by you — that is the point of having an HR department.
              </div>
            </div>

            <div style={{ fontSize: 9.5, color: '#6e7681', fontWeight: 700, letterSpacing: 0.5, marginBottom: 7 }}>VIEW</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              <button onClick={() => set({ showParticles: !settings.showParticles })} style={btn(settings.showParticles)}><Zap size={12} /> Work flow</button>
              <button onClick={() => set({ showSynapses: !settings.showSynapses })} style={btn(settings.showSynapses)}><Sparkles size={12} /> Org chart</button>
              <button onClick={() => set({ showLabels: !settings.showLabels })} style={btn(settings.showLabels)}>Labels</button>
              <button onClick={() => set({ liveData: !settings.liveData })} style={btn(settings.liveData)}><Activity size={12} /> MT5 feed</button>
              <button onClick={() => { fit(); setMenu(false); }} style={btn(false)}><Maximize2 size={12} /> Reset view</button>
            </div>

            <div style={{ fontSize: 9.5, color: '#6e7681', fontWeight: 700, letterSpacing: 0.5, marginBottom: 7 }}>ASSUMPTIONS</div>
            <div style={{ marginBottom: 6 }}>
              <Slider label="Salary/day" min={1} max={40} step={1} value={settings.dayCost} onChange={v => set({ dayCost: v })} />
            </div>
            <div style={{ fontSize: 9.5, color: '#6e7681', lineHeight: 1.55, marginBottom: 12 }}>
              Notional cost of one employee per day. Only used for the payroll runway figure — it is my assumption, not a number from your broker.
            </div>

            <button
              onClick={() => {
                if (!window.confirm('Rebuild the organisation from scratch? Every employee, every idea they have found and all history is lost.')) return;
                try { localStorage.removeItem(LS_KEY); } catch (e) { }
                window.location.reload();
              }}
              style={{ ...btn(false), width: '100%', justifyContent: 'center', color: '#ef4444', borderColor: 'rgba(239,68,68,0.35)' }}>
              <RotateCcw size={12} /> Rebuild the organisation
            </button>

            <div style={{ marginTop: 12, fontSize: 9.5, color: '#4b5563', lineHeight: 1.6 }}>
              Drag to move · scroll to zoom · double-click to fit · space to pause
            </div>
          </div>
        )}

      </div>

      {/* =========================== RIGHT RAIL =========================== */}
      {rail && (
        <div style={{
          width: 342, flexShrink: 0, borderLeft: '1px solid #1f2430', background: '#0b0f16',
          display: 'flex', flexDirection: 'column', minHeight: 0
        }}>
          <div style={{ display: 'flex', borderBottom: '1px solid #1f2430', flexShrink: 0 }}>
            {[['reports', 'Reports'], ['brief', 'Briefing'], ['depts', 'Teams'], ['audit', 'Audit'], ['feed', 'Feed']].map(([k, label]) => {
              const unread = k === 'reports' ? ((org.ceo && org.ceo.unread) || 0) : 0;
              return (
              <button key={k} onClick={() => { setRailTab(k); if (k === 'reports') { markReportsRead(org); } }} style={{
                flex: 1, padding: '10px 0', background: railTab === k ? '#111722' : 'transparent',
                border: 'none', borderBottom: `2px solid ${railTab === k ? CEO_DEPT.color : 'transparent'}`,
                color: railTab === k ? '#fff' : '#6e7681', fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                position: 'relative', whiteSpace: 'nowrap'
              }}>
                {label}{k === 'audit' && audit && !audit.pass ? ' ⚠' : ''}
                {unread > 0 && (
                  <span style={{
                    marginLeft: 4, background: CEO_DEPT.color, color: '#0b0f16', borderRadius: 7,
                    padding: '0 4px', fontSize: 9, fontWeight: 800, verticalAlign: 'top'
                  }}>{unread > 9 ? '9+' : unread}</span>
                )}
              </button>
            );})}
          </div>

          {/* ------------------------ CEO REPORTS ------------------------ */}
          {railTab === 'reports' && (() => {
            const reps = (org.ceo && org.ceo.reports) || [];
            const TONE = { good: '#22c55e', bad: '#ef4444', flat: '#8b949e', warn: '#eab308', info: '#38bdf8', work: '#a78bfa' };
            return (
              <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
                <div style={{ fontSize: 10, color: '#6e7681', fontWeight: 700, letterSpacing: 0.5, marginBottom: 3 }}>
                  YOUR CEO REPORTS TO YOU EVERY HOUR
                </div>
                <div style={{ fontSize: 10.5, color: '#4b5563', marginBottom: 12, lineHeight: 1.55 }}>
                  What changed since the last one, and whether it needs anything from you.
                  Most hours it will not.
                </div>

                {!reps.length && (
                  <div style={{ fontSize: 11, color: '#4b5563', padding: '18px 0', lineHeight: 1.6 }}>
                    No report yet. The first one is written as soon as the floor has run
                    a generation, then one every hour after that.
                  </div>
                )}

                {reps.map((r, ri) => (
                  <div key={r.id} style={{
                    border: '1px solid #1b2230', borderLeft: '3px solid ' + (TONE[r.mood] || TONE.flat),
                    background: ri === 0 ? '#111722' : '#0e131c', borderRadius: 6,
                    padding: '11px 12px', marginBottom: 10
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 7 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 800, color: TONE[r.mood] || '#d1d4dc' }}>
                        {r.headline}
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: 9.5, color: '#4b5563', whiteSpace: 'nowrap' }}>
                        {new Date(r.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    {r.lines.map((l, li) => (
                      <div key={li} style={{ display: 'flex', gap: 7, marginBottom: 6 }}>
                        <span style={{
                          flexShrink: 0, width: 5, height: 5, borderRadius: 3, marginTop: 6,
                          background: TONE[l.kind] || '#4b5563'
                        }} />
                        <span style={{ fontSize: 11, color: '#a9b1bd', lineHeight: 1.6 }}>{l.text}</span>
                      </div>
                    ))}

                    <div style={{
                      marginTop: 9, paddingTop: 8, borderTop: '1px solid #1b2230',
                      display: 'flex', gap: 7
                    }}>
                      <span style={{ fontSize: 9, fontWeight: 800, color: '#fbbf24', letterSpacing: 0.4, paddingTop: 1 }}>
                        YOU
                      </span>
                      <span style={{ fontSize: 11, color: '#e8dcc0', lineHeight: 1.6 }}>{r.action}</span>
                    </div>
                  </div>
                ))}

              </div>
            );
          })()}

          {/* ------------------------ INSPECTOR ------------------------ */}
          {railTab === 'depts' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>

              {/* --- neuron --- */}
              {selNeuron && (() => {
                const d = DEPT_BY_ID[selNeuron.deptId];
                const delta = selNeuron.score - selNeuron.prevScore;
                const rk = RANK_META[selNeuron.rank] || RANK_META.employee;
                const mgr = selNeuron.squad ? (org._index || {})[selNeuron.squad] : null;
                return (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 5, background: d.color, marginTop: 4, boxShadow: `0 0 10px ${d.color}` }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: 7 }}>
                          {selNeuron.tag}<Chip color={d.color}>{rk.short}</Chip>
                        </div>
                        <div style={{ fontSize: 11, color: '#8b949e' }}>{selNeuron.name} · {rk.label} · {d.name}</div>
                      </div>
                      <button onClick={() => setSel(null)} style={{ background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer' }}><X size={14} /></button>
                    </div>

                    <div style={{
                      background: '#111722', border: '1px solid #1f2430', borderRadius: 8, padding: 11, marginBottom: 10
                    }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 7 }}>
                        <span style={{ fontSize: 30, fontWeight: 800, color: healthColor(selNeuron.score), lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                          {selNeuron.score.toFixed(0)}
                        </span>
                        <span style={{ fontSize: 11, color: delta >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                          {delta >= 0 ? '+' : ''}{delta.toFixed(1)} last review
                        </span>
                        <span style={{ marginLeft: 'auto' }}><Chip color={STATE_META[selNeuron.state].color}>{STATE_META[selNeuron.state].label}</Chip></span>
                      </div>
                      <Bar v={selNeuron.score} color={healthColor(selNeuron.score)} />
                      <div style={{ marginTop: 9 }}>
                        <div style={{ fontSize: 9, color: '#6e7681', fontWeight: 700, letterSpacing: 0.5, marginBottom: 2 }}>SCORE HISTORY</div>
                        <Spark data={selNeuron.hist || []} color={d.color} w={300} h={38} />
                      </div>
                    </div>

                    {selNeuron.genome && (
                      <div style={{ background: '#111722', border: '1px solid #1f2430', borderRadius: 8, padding: 11, marginBottom: 10 }}>
                        <div style={{ fontSize: 9, color: '#6e7681', fontWeight: 700, letterSpacing: 0.5, marginBottom: 6 }}>
                          MARGINAL CONTRIBUTION
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
                            color: (selNeuron.contrib || 0) > 0.4 ? '#22c55e' : (selNeuron.contrib || 0) < -0.4 ? '#ef4444' : '#8b949e' }}>
                            {selNeuron.contrib == null ? '—' : `${selNeuron.contrib >= 0 ? '+' : ''}${selNeuron.contrib.toFixed(2)}`}
                          </span>
                          <span style={{ fontSize: 10, color: '#6e7681', lineHeight: 1.4 }}>
                            vs the department's published champion,<br />measured in the same pipeline context
                          </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 10 }}>
                          <Stat label="Experiments" value={selNeuron.evals || 0} />
                          <Stat label="Improvements" value={selNeuron.wins || 0} color="#22c55e" />
                          <Stat label="Dead cycles" value={selNeuron.stalled || 0} color={(selNeuron.stalled || 0) > 6 ? '#f59e0b' : '#8b949e'} />
                        </div>
                        <div style={{ marginTop: 9 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 3 }}>
                            <span style={{ color: '#6e7681' }}>Creativity (mutation boldness)</span>
                            <span style={{ color: '#d1d4dc', fontWeight: 700 }}>{(selNeuron.creativity || 0).toFixed(2)}</span>
                          </div>
                          <Bar v={(selNeuron.creativity || 0) * 100} color="#a78bfa" />
                        </div>
                      </div>
                    )}

                    {selNeuron.genome && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 9.5, color: '#6e7681', fontWeight: 700, letterSpacing: 0.5, marginBottom: 5 }}>
                          WHAT THIS NEURON CURRENTLY BELIEVES
                        </div>
                        {specsFor(selNeuron.deptId).map(g => (
                          <div key={g.k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3.5px 0', fontSize: 10.5, borderBottom: '1px solid #131822' }}>
                            <span style={{ color: '#6e7681' }}>{geneLabel(selNeuron.deptId, g.k)}</span>
                            <span style={{ color: '#d1d4dc', fontWeight: 600, textAlign: 'right' }}>
                              {describeGene(selNeuron.deptId, g.k, selNeuron.genome[g.k])}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {[
                      ['Reports to', selNeuron.rank === 'hod' ? '— (heads the lobe)' : mgr ? `${mgr.tag} (${(RANK_META[mgr.rank] || {}).short || ''})` : 'the HOD'],
                      ['How it got here', selNeuron.lineage || 'hired'],
                      ['Current task', selNeuron.task],
                      ['Reviews survived', String(selNeuron.reviews)],
                      ['Training cycles', String(selNeuron.trainingCycles || 0)],
                      ['On the books', ago(selNeuron.hiredAt)],
                      selNeuron.reason ? ['Exit reason', selNeuron.reason] : null
                    ].filter(Boolean).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #151a24', fontSize: 11 }}>
                        <span style={{ color: '#6e7681' }}>{k}</span>
                        <span style={{ color: '#d1d4dc', fontWeight: 600, textAlign: 'right' }}>{v}</span>
                      </div>
                    ))}

                    <div style={{ marginTop: 12, fontSize: 10.5, color: '#6e7681', lineHeight: 1.6 }}>
                      HR reviews this neuron every cycle. Below {(30 + 14 * settings.strictness).toFixed(0)} it goes into training;
                      three failed training cycles and it is removed and replaced.
                    </div>

                    <button onClick={() => setSel('d:' + d.id)} style={{ ...btn(false), marginTop: 12, width: '100%', justifyContent: 'center' }}>
                      Open {d.name}
                    </button>
                  </div>
                );
              })()}

              {/* --- department --- */}
              {!selNeuron && selDept && (() => {
                const dep = org.depts[selDept.id];
                const roster = dep.neurons.slice().sort((a, b) => b.score - a.score);
                const feeds = org.edges.filter(e => e.from === selDept.id);
                const fedBy = org.edges.filter(e => e.to === selDept.id);
                return (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 5, background: selDept.color, marginTop: 5, boxShadow: `0 0 10px ${selDept.color}` }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 800, color: '#fff' }}>{selDept.name}</div>
                        <div style={{ fontSize: 10.5, color: '#6e7681' }}>
                          {selDept.code} · {dep.count} of {dep.target} seats filled{selDept.staff ? ' · staff function' : selDept.id === 'ceo' ? ` · reports to ${BOARD.name}` : ''}
                        </div>
                      </div>
                      <button onClick={() => setSel(null)} style={{ background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer' }}><X size={14} /></button>
                    </div>

                    <p style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.65, margin: '0 0 11px' }}>{selDept.charter}</p>

                    {selDept.lab && (
                      <div style={{ background: '#111722', border: '1px solid #1f2430', borderRadius: 8, padding: 10, marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                          <span style={{ fontSize: 9.5, color: '#6e7681', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>{selDept.metricLabel}</span>
                          <Chip color={dep.live ? '#22c55e' : '#94a3b8'}>{dep.live ? 'live' : 'sim'}</Chip>
                          <span style={{ marginLeft: 'auto', fontSize: 15, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{dep.metricText}</span>
                        </div>
                        <div style={{ fontSize: 9.5, color: '#4b5563' }}>
                          {dep.live ? `bound to ${selDept.source}` : 'no backend feed — deterministic simulation'}
                        </div>
                      </div>
                    )}

                    {selDept.lab && L && championOf(L, selDept.id) && (
                      <div style={{ background: 'rgba(41,98,255,0.06)', border: '1px solid rgba(41,98,255,0.25)', borderRadius: 8, padding: 10, marginBottom: 10 }}>
                        <div style={{ fontSize: 9, color: '#7aa2ff', fontWeight: 700, letterSpacing: 0.5, marginBottom: 5 }}>
                          PUBLISHED CHAMPION · {dep.published || 0} REVISIONS
                        </div>
                        <div style={{ fontSize: 11, color: '#d1d4dc', lineHeight: 1.6 }}>
                          {summariseChampion(selDept.id, championOf(L, selDept.id))}
                        </div>
                        <div style={{ fontSize: 9.5, color: '#6e7681', marginTop: 6 }}>
                          Owns: {selDept.owns}
                        </div>
                      </div>
                    )}

                    {selDept.lab && dep.discriminating === false && (
                      <div style={{ background: 'rgba(148,163,184,0.07)', border: '1px solid #1f2430', borderRadius: 7, padding: 9, marginBottom: 10, fontSize: 10, color: '#94a3b8', lineHeight: 1.6 }}>
                        Every genome in this lobe currently produces the same pipeline result — its settings are not binding
                        on the present champion. Nobody here can be ranked honestly, so HR leaves them alone rather than
                        firing people at random.
                      </div>
                    )}

                    {[['Lobe health', dep.health, healthColor(dep.health)],
                    ['Output quality', (dep.quality || 0) * 100, selDept.color],
                    ['Workload', (dep.throughput || 0) * 100, '#60a5fa'],
                    ['HR demand', (dep.demand || 0) * 100, '#f472b6']].map(([k, v, c]) => (
                      <div key={k} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 3 }}>
                          <span style={{ color: '#6e7681' }}>{k}</span>
                          <span style={{ color: '#d1d4dc', fontWeight: 700 }}>{(v || 0).toFixed(0)}</span>
                        </div>
                        <Bar v={v} color={c} />
                      </div>
                    ))}

                    <div style={{ fontSize: 9.5, color: '#6e7681', fontWeight: 700, letterSpacing: 0.5, margin: '14px 0 6px' }}>
                      ROSTER · {roster.length}
                    </div>
                    {roster.map(n => (
                      <div key={n.id} onClick={() => setSel('n:' + n.id)} style={{
                        display: 'flex', alignItems: 'center', gap: 7, padding: '5px 6px', borderRadius: 5, cursor: 'pointer',
                        background: hoverId === n.id ? '#151b26' : 'transparent'
                      }}
                        onMouseEnter={() => { hoverRef.current = n.id; setHoverId(n.id); }}
                        onMouseLeave={() => { hoverRef.current = null; setHoverId(null); }}>
                        <span style={{ width: 6, height: 6, borderRadius: 3, background: STATE_META[n.state].color, flexShrink: 0 }} />
                        <span style={{ fontSize: 10.5, color: '#d1d4dc', fontWeight: 600, width: 52 }}>{n.tag}</span>
                        <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 0.3, width: 26,
                          color: n.rank === 'hod' ? selDept.color : n.rank === 'manager' ? '#8b949e' : '#4b5563' }}>
                          {(RANK_META[n.rank] || RANK_META.employee).short}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 10, color: '#6e7681', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {n.contrib != null ? `${n.contrib >= 0 ? '+' : ''}${n.contrib.toFixed(2)}` : n.task}
                        </span>
                        <span style={{ width: 46 }}><Bar v={n.score} color={healthColor(n.score)} h={4} /></span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: healthColor(n.score), width: 20, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n.score.toFixed(0)}</span>
                      </div>
                    ))}

                    {(feeds.length > 0 || fedBy.length > 0) && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ fontSize: 9.5, color: '#6e7681', fontWeight: 700, letterSpacing: 0.5, marginBottom: 5 }}>WIRING</div>
                        {fedBy.map(e => (
                          <div key={'i' + e.key} style={{ fontSize: 10.5, color: '#8b949e', padding: '3px 0' }}>
                            <span style={{ color: DEPT_BY_ID[e.from].color, fontWeight: 700 }}>{DEPT_BY_ID[e.from].code}</span>
                            <span style={{ color: '#4b5563' }}> → </span>in · {e.label}
                          </div>
                        ))}
                        {feeds.map(e => (
                          <div key={'o' + e.key} style={{ fontSize: 10.5, color: '#8b949e', padding: '3px 0' }}>
                            out<span style={{ color: '#4b5563' }}> → </span>
                            <span style={{ color: DEPT_BY_ID[e.to].color, fontWeight: 700 }}>{DEPT_BY_ID[e.to].code}</span> · {e.label}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* --- nothing selected: org overview --- */}
              {!selNeuron && !selDept && (
                <div>
                  <div style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.65, marginBottom: 12 }}>
                    Every dot is an employee holding one candidate answer for its department's slice of the trading
                    pipeline. They mutate it, test it on your bars, and keep what survives — continuously, with nobody
                    supervising. Managers breed their squad's best two. HODs publish. HR hires, trains and removes on
                    the results. Click any neuron or lobe to see what it currently believes.
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 14 }}>
                    <Stat label="Hired" value={org.stats.hired} color="#22c55e" />
                    <Stat label="Trained" value={org.stats.trained} color="#f59e0b" />
                    <Stat label="Promoted" value={org.stats.promoted} color="#fbbf24" />
                    <Stat label="Removed" value={org.stats.fired + org.stats.restructured} color="#ef4444" />
                  </div>

                  {ALL_DEPTS.map(d => {
                    const dep = org.depts[d.id];
                    return (
                      <div key={d.id} onClick={() => setSel('d:' + d.id)} style={{
                        padding: '8px 9px', borderRadius: 7, cursor: 'pointer', marginBottom: 5,
                        background: '#0f141d', border: '1px solid #161c27'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 4, background: d.color }} />
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#d1d4dc' }}>{d.name}</span>
                          {d.lab && <Chip color={dep.live ? '#22c55e' : '#94a3b8'}>{dep.live ? 'live' : 'sim'}</Chip>}
                          {d.staff && <Chip color={d.color}>staff</Chip>}
                          {d.id === 'ceo' && <Chip color={d.color}>reports to {BOARD.name}</Chip>}
                          <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#6e7681', fontVariantNumeric: 'tabular-nums' }}>
                            {dep.count}/{dep.target}
                          </span>
                        </div>
                        <Bar v={dep.health} color={healthColor(dep.health)} h={4} />
                        {d.lab && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 9.5, color: '#6e7681' }}>
                            <span>{d.metricLabel}</span>
                            <span style={{ color: '#8b949e', fontWeight: 700 }}>{dep.metricText}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div style={{ marginTop: 12, padding: 9, background: 'rgba(148,163,184,0.06)', border: '1px solid #1f2430', borderRadius: 7, fontSize: 10, color: '#6e7681', lineHeight: 1.6 }}>
                    Lobes marked <b style={{ color: '#22c55e' }}>LIVE</b> are driven by your MT5 account, open positions,
                    90-day journal statistics and the current signal set. <b style={{ color: '#94a3b8' }}>SIM</b> lobes have no
                    backend feed and run on a deterministic pulse — they are not pretending to be data.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ------------------------ BRIEFING ------------------------ */}
          {railTab === 'brief' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>

              {/* ---------------- the trading desk ---------------- */}
              {robot && robot.available && (() => {
                const lk = robotLook(robot);
                const acc = robot.account || {};
                const pos = robot.position;
                const td = robot.today || {};
                const wrongAccount = acc.login && robot.locked_to && acc.login !== robot.locked_to;
                return (
                  <div style={{
                    background: rgba(lk.c, 0.07), border: `1px solid ${rgba(lk.c, 0.3)}`,
                    borderRadius: 8, padding: 11, marginBottom: 14
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: lk.c }} />
                      <span style={{ fontSize: 12, fontWeight: 800, color: lk.c }}>{lk.t}</span>
                      {robot.mode === 'paper' && <Chip color="#60a5fa">paper only</Chip>}
                      <span style={{ marginLeft: 'auto', fontSize: 9.5, color: '#6e7681' }}>
                        {acc.login ? `#${acc.login}` : `#${robot.locked_to || '—'}`}
                        {acc.is_demo ? ' · demo' : acc.login ? ' · LIVE' : ''}
                      </span>
                    </div>
                    <div style={{ fontSize: 10.5, color: '#a9b1bd', lineHeight: 1.6 }}>{robot.reason}</div>

                    {wrongAccount && (
                      <div style={{ marginTop: 8, padding: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 6, fontSize: 10.5, color: '#fca5a5', lineHeight: 1.55 }}>
                        MetaTrader is logged into #{acc.login}, not #{robot.locked_to}. The robot is locked to one
                        account and will not place a single order anywhere else.
                      </div>
                    )}

                    {pos && (
                      <div style={{ marginTop: 9, paddingTop: 9, borderTop: '1px solid #1f2430' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 9 }}>
                          <Stat label="Position" value={`${pos.type} ${pos.volume}`} color={pos.type === 'BUY' ? '#22c55e' : '#ef4444'} />
                          <Stat label="Entry" value={pos.open.toFixed(3)} />
                          <Stat label="Stop" value={pos.sl ? pos.sl.toFixed(3) : '—'} />
                          <Stat label="Open P/L" value={`${pos.profit >= 0 ? '+' : ''}${pos.profit.toFixed(2)}`}
                            color={pos.profit >= 0 ? '#22c55e' : '#ef4444'} />
                        </div>
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 9, marginTop: 9, paddingTop: 9, borderTop: '1px solid #1f2430' }}>
                      <Stat label="Equity" value={acc.equity ? acc.equity.toFixed(2) : '—'} sub={acc.currency || ''} />
                      <Stat label="Trades today" value={td.trades != null ? td.trades : '—'} />
                      <Stat label="Today's P/L" value={td.realised != null ? `${td.realised >= 0 ? '+' : ''}${td.realised.toFixed(2)}` : '—'}
                        color={(td.realised || 0) >= 0 ? '#22c55e' : '#ef4444'} />
                    </div>

                    {robot.market && robot.market.seconds_to_open > 0 && (
                      <div style={{ marginTop: 8, fontSize: 10, color: '#6e7681' }}>
                        Back at work in about {Math.round(robot.market.seconds_to_open / 3600)} hours.
                      </div>
                    )}

                    {(robot.log || []).length > 0 && (
                      <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid #1f2430' }}>
                        {(robot.log || []).slice(0, 4).map((r, i) => (
                          <div key={i} style={{ fontSize: 9.5, color: '#8b949e', padding: '2px 0', lineHeight: 1.5 }}>
                            <span style={{ color: '#4b5563' }}>{new Date(r.t).toLocaleTimeString()}</span>{' '}{r.msg}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                <span style={{ fontSize: 10, color: '#6e7681', fontWeight: 700, letterSpacing: 0.5 }}>
                  WHAT THE DESK IS TRYING RIGHT NOW
                </span>
                {/* You asked not to be shown complex stuff. The exact settings are
                    still one click away for when they are actually wanted. */}
                <button onClick={() => setExactSettings(v => !v)} style={{
                  marginLeft: 'auto', background: exactSettings ? '#1b2534' : 'transparent',
                  border: '1px solid #1f2430', borderRadius: 4, color: exactSettings ? '#38bdf8' : '#4b5563',
                  fontSize: 9, fontWeight: 700, padding: '2px 6px', cursor: 'pointer', whiteSpace: 'nowrap'
                }}>
                  {exactSettings ? 'plain words' : 'exact settings'}
                </button>
              </div>
              {!L && <div style={{ fontSize: 11, color: '#4b5563', marginBottom: 14 }}>Loading price history…</div>}
              {L && PIPE_DEPTS.map((id, i) => (
                <div key={id} onClick={() => { setSel('d:' + id); setRailTab('depts'); }} style={{
                  display: 'flex', gap: 9, padding: '7px 0', cursor: 'pointer', borderBottom: '1px solid #131822'
                }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: '#4b5563', width: 12, paddingTop: 1 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: DEPT_BY_ID[id].color }}>{DEPT_BY_ID[id].name}</div>
                    <div style={{
                      fontSize: exactSettings ? 10 : 10.5, color: exactSettings ? '#8b949e' : '#a9b1bd',
                      lineHeight: 1.6, marginTop: 2, fontFamily: exactSettings ? 'ui-monospace, monospace' : 'inherit'
                    }}>
                      {exactSettings
                        ? summariseChampion(id, championOf(L, id))
                        : plainChampion(id, championOf(L, id))}
                    </div>
                  </div>
                </div>
              ))}

              {L && L.book && L.book.admitted.length > 0 && (() => {
                const bk = L.book;
                const thin = bk.kEff < 1.6 && bk.admitted.length >= 2;
                return (
                  <>
                    <div style={{ fontSize: 10, color: '#6e7681', fontWeight: 700, letterSpacing: 0.5, margin: '18px 0 7px' }}>
                      THE BOOK — HOW MANY REAL BETS ARE ON
                    </div>
                    <div style={{
                      background: thin ? 'rgba(245,158,11,0.07)' : 'rgba(129,140,248,0.07)',
                      border: `1px solid ${thin ? 'rgba(245,158,11,0.28)' : 'rgba(129,140,248,0.28)'}`,
                      borderRadius: 8, padding: 11
                    }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                        <Stat label="Strategies" value={bk.admitted.length} sub={`of ${bk.eligible} eligible`} />
                        <Stat label="Behave like" value={bk.kEff.toFixed(1)}
                          color={thin ? '#f59e0b' : '#818cf8'} sub="independent bets" />
                        <Stat label="Correlation" value={bk.avgCorr.toFixed(2)} sub="average pair" />
                      </div>
                      <div style={{ fontSize: 10, color: '#8b949e', lineHeight: 1.6, marginTop: 10, paddingTop: 9, borderTop: '1px solid #1f2430' }}>
                        {thin
                          ? `Running ${bk.admitted.length} strategies that behave like ${bk.kEff.toFixed(1)}. The extra ones are buying almost no protection — they are the same bet wearing different settings.`
                          : `Diversification is real here: ${bk.admitted.length} strategies carrying ${bk.kEff.toFixed(1)} genuinely independent bets. This is the only lever that raises return without raising the chance of ruin.`}
                      </div>
                      <div style={{ marginTop: 9 }}>
                        {bk.admitted.map((cd, i) => (
                          <div key={cd.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 10.5 }}>
                            <span style={{ color: '#6e7681', width: 46 }}>{cd.id}</span>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <Bar v={bk.weights[i] * 100} color="#818cf8" h={4} />
                            </span>
                            <span style={{ color: '#d1d4dc', fontWeight: 600, width: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {(bk.weights[i] * 100).toFixed(0)}%
                            </span>
                            <span style={{ color: '#6e7681', width: 52, textAlign: 'right' }}>{cd.inTrades} tr</span>
                          </div>
                        ))}
                      </div>
                      {bk.rejected.length > 0 && (
                        <div style={{ marginTop: 9, paddingTop: 8, borderTop: '1px solid #1f2430' }}>
                          <div style={{ fontSize: 9, color: '#6e7681', fontWeight: 700, letterSpacing: 0.4, marginBottom: 4 }}>TURNED AWAY</div>
                          {bk.rejected.slice(0, 3).map((r, i) => (
                            <div key={i} style={{ fontSize: 9.5, color: '#6e7681', lineHeight: 1.5 }}>{r.id} — {r.why}</div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{ fontSize: 10, color: '#6e7681', fontWeight: 700, letterSpacing: 0.5, margin: '16px 0 7px' }}>
                      WHO CURATES THE BOOK
                    </div>
                    {BOOK_DEPTS.map(id => (
                      <div key={id} onClick={() => { setSel('d:' + id); setRailTab('depts'); }}
                        style={{ display: 'flex', gap: 9, padding: '7px 0', cursor: 'pointer', borderBottom: '1px solid #131822' }}>
                        <span style={{ width: 7, height: 7, borderRadius: 4, background: DEPT_BY_ID[id].color, marginTop: 5, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 10.5, fontWeight: 700, color: DEPT_BY_ID[id].color }}>{DEPT_BY_ID[id].name}</div>
                          <div style={{ fontSize: 10, color: '#a9b1bd', lineHeight: 1.55, marginTop: 2 }}>
                            {summariseChampion(id, championOf(L, id))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                );
              })()}

              {cs && (
                <>
                  <div style={{ fontSize: 10, color: '#6e7681', fontWeight: 700, letterSpacing: 0.5, margin: '16px 0 7px' }}>
                    DOES IT WORK ON MONTHS IT NEVER STUDIED?
                  </div>
                  <div style={{ background: '#111722', border: `1px solid ${rgba(verdict.color, 0.3)}`, borderRadius: 8, padding: 11 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                      <Stat label="Money made" value={`${cs.test.returnPct >= 0 ? '+' : ''}${cs.test.returnPct.toFixed(1)}%`}
                        color={cs.test.returnPct >= 0 ? '#22c55e' : '#ef4444'} />
                      <Stat label="Worst loss" value={`−${cs.test.maxEqDD.toFixed(1)}%`} color="#f59e0b" />
                      <Stat label="Trades" value={cs.test.trades} color={cs.test.trades >= cs.test.minTrades ? '#d1d4dc' : '#ef4444'}
                        sub={cs.test.trades >= cs.test.minTrades ? `${cs.test.winRate.toFixed(0)}% won` : `need ${cs.test.minTrades}`} />
                    </div>
                    <div style={{ fontSize: 10, color: '#8b949e', lineHeight: 1.6, marginTop: 10, paddingTop: 9, borderTop: '1px solid #1f2430' }}>
                      {cs.gap > 25
                        ? `On the years it was allowed to study, this looks far better than it does here. That difference means the desk has partly memorised the past rather than found something real.`
                        : `The result here is close to what it achieved on the data it studied, which is what you want to see.`}
                    </div>
                  </div>
                </>
              )}

              {L && (L.dsr || L.cross) && (
                <>
                  <div style={{ fontSize: 10, color: '#6e7681', fontWeight: 700, letterSpacing: 0.5, margin: '18px 0 7px' }}>
                    COULD THIS JUST BE LUCK?
                  </div>
                  {L.dsr && (() => {
                    const d = L.dsr, ok = d.psr >= 0.9;
                    return (
                      <div style={{
                        background: ok ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                        border: `1px solid ${ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                        borderRadius: 8, padding: 11, marginBottom: 7
                      }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                          <Stat label="Tries taken" value={(d.trials || 0).toLocaleString()} />
                          <Stat label="Luck would give" value={d.hurdle.toFixed(2)} sub="Sharpe, best of those" />
                          <Stat label="This shows" value={d.observed.toFixed(2)}
                            color={d.observed >= d.hurdle ? '#22c55e' : '#ef4444'} sub="Sharpe" />
                        </div>
                        <div style={{ fontSize: 10.5, color: '#a9b1bd', lineHeight: 1.6, marginTop: 10, paddingTop: 9, borderTop: '1px solid #1f2430' }}>
                          Probability this is real rather than the luckiest of {(d.trials || 0).toLocaleString()} tries:{' '}
                          <b style={{ color: ok ? '#22c55e' : '#ef4444' }}>{(d.psr * 100).toFixed(0)}%</b>.
                          {ok ? ' It has beaten its own search.' : ' Search long enough and something always looks good; this has not cleared that bar.'}
                        </div>
                      </div>
                    );
                  })()}
                  {L.cross && L.cross.total > 0 && (
                    <div style={{
                      background: L.cross.positive > 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                      border: `1px solid ${L.cross.positive > 0 ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                      borderRadius: 8, padding: 11
                    }}>
                      <div style={{ fontSize: 10.5, color: '#d1d4dc', lineHeight: 1.65 }}>
                        Tried on {L.cross.total} instruments it was never tuned on — it makes money on{' '}
                        <b style={{ color: L.cross.positive > 0 ? '#22c55e' : '#ef4444' }}>{L.cross.positive} of them</b>.
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                        {L.cross.rows.map(r => (
                          <span key={r.key} style={{
                            fontSize: 9.5, padding: '2px 7px', borderRadius: 4,
                            background: r.select > 0 ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.10)',
                            color: r.select > 0 ? '#22c55e' : '#6e7681', fontWeight: 600
                          }}>{r.key} {r.select > 0 ? '+' : ''}{r.select.toFixed(0)}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              <div style={{ fontSize: 10, color: '#6e7681', fontWeight: 700, letterSpacing: 0.5, margin: '16px 0 7px' }}>
                WHAT YOUR CEO IS DOING
              </div>
              <div style={{ background: 'rgba(232,121,249,0.06)', border: '1px solid rgba(232,121,249,0.22)', borderRadius: 8, padding: 11, marginBottom: 6 }}>
                <div style={{ fontSize: 10.5, color: '#d1d4dc', lineHeight: 1.65 }}>
                  Chasing <b style={{ color: '#e879f9' }}>{org.ceo ? org.ceo.mandate.targetReturnPct : 8}% return</b> with no
                  more than <b style={{ color: '#e879f9' }}>{org.ceo ? org.ceo.mandate.maxDD : 12}% drawdown</b>.
                  {focusDept ? <> Extra effort is going into <b style={{ color: focusDept.color }}>{focusDept.name}</b> — it has the most room left to improve.</> : null}
                </div>
              </div>

              <div style={{ background: 'rgba(244,114,182,0.06)', border: '1px solid rgba(244,114,182,0.2)', borderRadius: 8, padding: 11, marginBottom: 6 }}>
                <div style={{ fontSize: 10.5, color: '#d1d4dc', lineHeight: 1.65 }}>
                  <b style={{ color: '#f472b6' }}>HR</b> is running standards at {hrPolicy.strictness.toFixed(2)} and headcount at {hrPolicy.staffing.toFixed(2)}x, because {hrPolicy.rigourWhy}.
                </div>
              </div>

              <div style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 8, padding: 11 }}>
                <div style={{ fontSize: 10.5, color: '#d1d4dc', lineHeight: 1.65 }}>
                  <b style={{ color: '#60a5fa' }}>Audit</b>{' '}
                  {audit ? (audit.pass
                    ? 'has signed the current strategy off — every check passed.'
                    : `is blocking it. ${blockers.length} thing${blockers.length === 1 ? '' : 's'} must be fixed before this can be traded.`)
                    : 'is still running its first checks.'}
                  {audit && <> <span style={{ color: '#6e7681' }}>See the Audit tab.</span></>}
                </div>
              </div>

              <div style={{ fontSize: 10, color: '#6e7681', fontWeight: 700, letterSpacing: 0.5, margin: '16px 0 7px' }}>
                DAY BY DAY
              </div>
              {days.length === 0 && <div style={{ fontSize: 10.5, color: '#4b5563' }}>Nothing recorded yet.</div>}
              {days.slice(0, 10).map(dRow => {
                const moved = dRow.startHonest != null && dRow.endHonest != null ? dRow.endHonest - dRow.startHonest : null;
                return (
                  <div key={dRow.date} style={{ padding: '7px 0', borderBottom: '1px solid #131822' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: dRow.date === org.today ? '#fff' : '#8b949e' }}>
                        {dRow.date}{dRow.date === org.today ? ' · today' : ''}
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                        color: moved == null ? '#4b5563' : moved > 0 ? '#22c55e' : moved < 0 ? '#ef4444' : '#8b949e' }}>
                        {moved == null ? '—' : `${moved >= 0 ? '+' : ''}${moved.toFixed(1)}`}
                      </span>
                    </div>
                    <div style={{ fontSize: 9.5, color: '#6e7681', marginTop: 3 }}>
                      {dRow.evals.toLocaleString()} ideas tested · {dRow.published} adopted
                      {dRow.hired || dRow.removed ? ` · ${dRow.hired} hired, ${dRow.removed} let go` : ''}
                    </div>
                  </div>
                );
              })}

              <div style={{ marginTop: 16 }}>
                <button onClick={() => setDetail(v => !v)} style={{ ...btn(detail), width: '100%', justifyContent: 'center' }}>
                  {detail ? 'Hide' : 'Show'} the numbers behind this
                </button>
              </div>

              {detail && cs && (
                <div style={{ marginTop: 10, background: '#0f141d', border: '1px solid #161c27', borderRadius: 8, padding: 11 }}>
                  <div style={{ fontSize: 9.5, color: '#6e7681', marginBottom: 7, lineHeight: 1.6 }}>
                    {lab.note || 'loading'} · split 29/29/20/22, the last slice touched by no decision anywhere.
                  </div>
                  <DualSpark rows={L.history.slice(-160)} />
                  <div style={{ display: 'flex', gap: 12, marginTop: 5, fontSize: 9.5, color: '#6e7681' }}>
                    <span><span style={{ color: '#6e7681' }}>——</span> studied</span>
                    <span><span style={{ color: '#22c55e' }}>——</span> unseen</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 9, marginTop: 11 }}>
                    <Stat label="In-sample" value={cs.select.toFixed(1)} />
                    <Stat label="Unseen" value={cs.honest.toFixed(1)} color={cs.honest > 0 ? '#22c55e' : '#ef4444'} />
                    <Stat label="Gap" value={cs.gap.toFixed(1)} color={cs.gap < 15 ? '#22c55e' : cs.gap < 40 ? '#f59e0b' : '#ef4444'} />
                    <Stat label="t-stat" value={cs.test.tStat.toFixed(2)} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 9, marginTop: 9 }}>
                    <Stat label="Expectancy" value={`${cs.test.expectancy.toFixed(2)}R`} />
                    <Stat label="Profit factor" value={cs.test.profitFactor.toFixed(2)} />
                    <Stat label="Generation" value={L.generation.toLocaleString()} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* -------------------------- AUDIT -------------------------- */}
          {railTab === 'audit' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              <div style={{
                background: audit ? (audit.pass ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.07)') : '#111722',
                border: `1px solid ${audit ? (audit.pass ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)') : '#1f2430'}`,
                borderRadius: 8, padding: 11, marginBottom: 12
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <ShieldCheck size={15} color={audit ? (audit.pass ? '#22c55e' : '#ef4444') : '#6e7681'} />
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: audit ? (audit.pass ? '#22c55e' : '#ef4444') : '#8b949e' }}>
                    {audit ? (audit.pass ? (audit.overruledByCeo ? 'Signed off (CEO Overruled)' : 'Signed off') : 'Blocked') : 'First checks running'}
                  </span>
                  {org?.ceo && (
                    <button
                      onClick={() => {
                        org.ceo.executiveOverrule = !org.ceo.executiveOverrule;
                        force(x => x + 1);
                      }}
                      title="Toggle CEO Executive Overrule Authority"
                      style={{
                        marginLeft: 'auto', fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 4, cursor: 'pointer',
                        background: org.ceo.executiveOverrule !== false ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${org.ceo.executiveOverrule !== false ? 'rgba(34,197,94,0.4)' : '#30363d'}`,
                        color: org.ceo.executiveOverrule !== false ? '#22c55e' : '#8b949e'
                      }}
                    >
                      CEO Authority: {org.ceo.executiveOverrule !== false ? 'ON' : 'OFF'}
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 10.5, color: '#a9b1bd', lineHeight: 1.6 }}>
                  {audit?.overruledByCeo
                    ? 'CEO Executive Authority Active: Non-fatal model gap warnings have been waived by the CEO because out-of-sample performance is profitable and risk limits are satisfied.'
                    : 'Audit independently checks every candidate. When out-of-sample edge is proven, the CEO holds executive authority to overrule heuristic warnings and deploy.'}
                </div>
              </div>

              {AUDIT_CHECKS.map(c => {
                const f = audit ? audit.findings.find(x => x.id === c.id) : null;
                const isOverruled = audit?.overruledFindings?.includes(c.id);
                const ok = !f || isOverruled;
                const col = isOverruled ? '#38bdf8' : ok ? '#22c55e' : f.severity === 'block' ? '#ef4444' : '#f59e0b';
                return (
                  <div key={c.id} style={{ padding: '9px 0', borderBottom: '1px solid #131822' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 4, background: col, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#d1d4dc' }}>{c.title}</span>
                      <span style={{ marginLeft: 'auto' }}>
                        <Chip color={col}>{isOverruled ? 'waived (ceo)' : ok ? 'pass' : f.severity === 'block' ? 'blocked' : 'warning'}</Chip>
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: '#6e7681', marginTop: 3, lineHeight: 1.55 }}>
                      {isOverruled ? `${f.detail} (Waived under CEO Executive Authority)` : ok ? c.plain : f.detail}
                    </div>
                    {audit && (
                      <div style={{ fontSize: 9, color: '#4b5563', marginTop: 3 }}>
                        checked by {f ? f.auditor : (auditorTag(org, c.id) || '—')}
                      </div>
                    )}
                  </div>
                );
              })}

              {L && L.attacks && Object.keys(L.attacks).length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 9.5, color: '#ef4444', fontWeight: 700, letterSpacing: 0.5, marginBottom: 7 }}>
                    RED TEAM — ATTACKS ON THE CURRENT STRATEGY
                  </div>
                  {ATTACKS.map(a => {
                    const r = L.attacks[a.id];
                    const col = !r ? '#6e7681' : r.passed ? '#22c55e' : '#ef4444';
                    return (
                      <div key={a.id} style={{ padding: '8px 0', borderBottom: '1px solid #131822' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ width: 7, height: 7, borderRadius: 4, background: col, flexShrink: 0 }} />
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#d1d4dc' }}>{a.name}</span>
                          <span style={{ marginLeft: 'auto' }}>
                            <Chip color={col}>{!r ? 'pending' : r.passed ? 'withstood' : 'broken'}</Chip>
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: '#8b949e', marginTop: 3, lineHeight: 1.55 }}>
                          {r ? r.detail : a.plain}
                        </div>
                        {r && <div style={{ fontSize: 9, color: '#4b5563', marginTop: 3 }}>attacked by {r.by}</div>}
                      </div>
                    );
                  })}
                </div>
              )}

              {audit && audit.leak && (
                <div style={{ marginTop: 12, padding: 10, background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 7 }}>
                  <div style={{ fontSize: 10, color: '#60a5fa', fontWeight: 700, marginBottom: 4 }}>INTEGRITY TEST</div>
                  <div style={{ fontSize: 10, color: '#a9b1bd', lineHeight: 1.6 }}>
                    Audit corrupted the held-out months and re-ran selection. The selection score moved by{' '}
                    <b style={{ color: audit.leak.clean ? '#22c55e' : '#ef4444' }}>{audit.leak.delta.toFixed(6)}</b>.
                    {' '}It must move by exactly zero, and it does — so nothing in the system is peeking at data it should not see.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ------------------------ HR FEED ------------------------ */}
          {railTab === 'feed' && (
            <>
              <div style={{ display: 'flex', gap: 4, padding: '8px 10px', flexWrap: 'wrap', borderBottom: '1px solid #1f2430', flexShrink: 0 }}>
                {['ALL', 'HIRED', 'TRAINING', 'PROMOTED', 'FIRED', 'RELEASED', 'PLAN'].map(f => (
                  <button key={f} onClick={() => setFeedFilter(f)} style={{
                    fontSize: 9.5, fontWeight: 700, padding: '3px 7px', borderRadius: 4, cursor: 'pointer',
                    background: feedFilter === f ? 'rgba(244,114,182,0.16)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${feedFilter === f ? 'rgba(244,114,182,0.45)' : 'rgba(255,255,255,0.07)'}`,
                    color: feedFilter === f ? '#f472b6' : '#6e7681'
                  }}>{f}</button>
                ))}
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
                {events.length === 0 && (
                  <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: '#4b5563' }}>
                    No events yet. HR reviews the floor every few seconds — or hit “Review now”.
                  </div>
                )}
                {events.map(ev => (
                  <div key={ev.id} style={{ display: 'flex', gap: 8, padding: '7px 0', borderBottom: '1px solid #131822' }}>
                    <span style={{ width: 6, height: 6, borderRadius: 3, background: toneColor[ev.tone] || '#60a5fa', marginTop: 5, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Chip color={toneColor[ev.tone] || '#60a5fa'}>{ev.type}</Chip>
                        <span style={{ fontSize: 9.5, color: DEPT_BY_ID[ev.deptId] ? DEPT_BY_ID[ev.deptId].color : '#6e7681', fontWeight: 700 }}>
                          {DEPT_BY_ID[ev.deptId] ? DEPT_BY_ID[ev.deptId].code : ''}
                        </span>
                        <span style={{ marginLeft: 'auto', fontSize: 9.5, color: '#4b5563' }}>{ago(ev.t)}</span>
                      </div>
                      <div style={{ fontSize: 10.5, color: '#a9b1bd', marginTop: 3, lineHeight: 1.5 }}>{ev.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
