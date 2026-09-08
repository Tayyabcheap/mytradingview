/* ------------------------------------------------------------------
 * brainsSession.js — one firm, shared by every tab.
 * ------------------------------------------------------------------
 * The organisation used to live inside the MyBrains tab, which meant the
 * whole floor stopped working the moment you looked at anything else. It
 * lives here now: created once, kept running on its own timer, and read by
 * MyBrains, BrainsActivity and BrainsPerformance alike.
 * ------------------------------------------------------------------ */

import { useEffect, useState } from 'react';
import {
  createOrg, hydrateOrg, serializeOrg, stepOrg, workTick, attachLab, applyTelemetry,
} from './myBrainsCore';
import { loadUniverse, discoverUniverse, tradeReadiness } from './myBrainsLab';

const LS_KEY = 'twr_mybrains_v1';

const S = {
  org: null,
  status: 'idle',          // idle | loading | ready
  note: '',
  universe: null,
  key: '',                 // symbol|timeframe this session was built for
  options: { speed: 1, paused: false, labRate: 120, reviewMs: 16000 },
  telemetry: null,
  timer: null,
  labAcc: 0,
  last: 0,
  saveAcc: 0,
  listeners: new Set(),
  readiness: [],
  readyAcc: 0,
  readyCursor: 0,
  discovery: null,
  progress: '',
};

function emit() { for (const fn of S.listeners) { try { fn(); } catch (e) { } } }

export function getOrg() { return S.org; }
export function getSession() { return S; }
export function setOptions(o) { Object.assign(S.options, o); }
export function pushTelemetry(raw) {
  S.telemetry = raw;
  if (S.org) applyTelemetry(S.org, raw);
}

function loop() {
  const now = performance.now();
  const dt = Math.min(now - (S.last || now), 120);
  S.last = now;
  const org = S.org;
  if (!org) return;
  const o = S.options;

  if (!o.paused && org.lab) {
    S.labAcc += (o.labRate * o.speed) * (dt / 1000);
    if (S.labAcc >= 2) {
      const budget = Math.min(80, Math.floor(S.labAcc));
      S.labAcc -= workTick(org, budget) || budget;
      if (S.labAcc < 0) S.labAcc = 0;
    }
  }
  stepOrg(org, dt, { speed: o.speed, paused: o.paused, reviewMs: o.reviewMs });

  /* What every instrument is about to do. With twenty of them this is walked
   * a few at a time on a rotating cursor — doing all twenty in one pass makes
   * the interface stutter every second for no benefit, since a gate cannot
   * change until a bar closes anyway. */
  S.readyAcc += dt;
  if (org.lab && org.lab.universe && S.readyAcc > 350) {
    S.readyAcc = 0;
    const uni = org.lab.universe;
    const cred = org.lab.dsr ? org.lab.dsr.psr : 0.5;
    if (S.readiness.length !== uni.length) {
      S.readiness = uni.map(u => ({
        key: u.key, symbol: u.symbol, timeframe: u.timeframe, live: u.live,
        category: u.category, reason: u.reason, stages: [], met: 0, total: 6,
        gateScore: 0, confidence: 0, direction: 0, pending: true,
      }));
    }
    const BATCH = 4;
    for (let k = 0; k < BATCH; k++) {
      const idx = S.readyCursor % uni.length;
      S.readyCursor = (S.readyCursor + 1) % uni.length;
      const u = uni[idx];
      try {
        const r = tradeReadiness(u.F, org.lab.champions, { credibility: cred });
        S.readiness[idx] = {
          ...r, key: u.key, symbol: u.symbol, timeframe: u.timeframe,
          live: u.live, category: u.category, reason: u.reason, pending: false,
        };
      } catch (e) {
        S.readiness[idx] = {
          key: u.key, symbol: u.symbol, timeframe: u.timeframe, live: u.live,
          category: u.category, reason: u.reason, stages: [], met: 0, total: 6,
          gateScore: 0, confidence: 0, direction: 0, error: String(e.message || e),
        };
      }
    }
  }

  S.saveAcc += dt;
  if (S.saveAcc > 20000) {
    S.saveAcc = 0;
    try { localStorage.setItem(LS_KEY, JSON.stringify(serializeOrg(org))); } catch (e) { }
  }
}

export function ensureSession(symbol = 'XAUUSDc', timeframe = '1H') {
  const key = `${symbol}|${timeframe}`;
  if (S.org && S.key === key) return S;
  if (S.status === 'loading' && S.key === key) return S;

  S.key = key;
  S.status = 'loading';
  S.note = 'Loading price history…';
  emit();

  if (!S.org) {
    let restored = null;
    try { restored = hydrateOrg(JSON.parse(localStorage.getItem(LS_KEY))); } catch (e) { restored = null; }
    S.org = restored || createOrg();
  }

  discoverUniverse(symbol, timeframe, 50).then(disc => {
    S.discovery = disc;
    S.note = disc.discovered
      ? `Found ${disc.brokerCount} symbols at your broker — loading ${disc.specs.length} instruments…`
      : `Could not read the broker's symbol list (${disc.reason}). Trying ${disc.specs.length} standard names…`;
    emit();
    return loadUniverse(disc.specs, 2600, (done, total) => {
      S.progress = `${done} of ${total} instruments loaded`;
      emit();
    });
  }).then(universe => {
    S.universe = universe;
    attachLab(S.org, universe, { live: universe.some(u => u.live), symbol, timeframe });
    if (S.telemetry) applyTelemetry(S.org, S.telemetry);
    const liveN = universe.filter(u => u.live).length;
    S.status = 'ready';
    S.live = liveN > 0;
    S.liveCount = liveN;
    S.progress = '';
    const firstReason = (universe.find(u => !u.live && u.reason) || {}).reason || '';
    S.note = liveN === universe.length
      ? `${universe.length} instruments, all on live MetaTrader history.`
      : liveN > 0
        ? `${liveN} of ${universe.length} instruments on live history; the rest fell back to a simulated series${firstReason ? ` (${firstReason})` : ''}.`
        : `No live history reached the app${firstReason ? ` — ${firstReason}` : ''}. Every instrument is running on a simulated series and nothing you see is real market data.`;
    if (!S.timer) { S.last = performance.now(); S.timer = setInterval(loop, 60); }
    emit();
  }).catch(e => {
    S.status = 'error';
    S.note = String(e && e.message ? e.message : e);
    emit();
  });

  return S;
}

/* Re-render on a fixed cadence rather than on every simulation step — the
 * panels only need to look alive, not to chase 60 frames a second. */
export function useBrainsSession(symbol, timeframe, everyMs = 700) {
  const [, force] = useState(0);
  /* synchronous and idempotent: the org exists on the very first render, so
   * consumers never have to guard against a null firm */
  ensureSession(symbol, timeframe);
  useEffect(() => { ensureSession(symbol, timeframe); }, [symbol, timeframe]);
  useEffect(() => {
    const fn = () => force(v => v + 1);
    S.listeners.add(fn);
    const id = setInterval(fn, everyMs);
    return () => { S.listeners.delete(fn); clearInterval(id); };
  }, [everyMs]);
  return S;
}
