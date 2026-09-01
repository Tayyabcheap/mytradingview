/* Alarms — all eight types, actually implemented.
 *
 * The old engine offered eight in the dropdown and evaluated exactly one:
 *
 *     if (alarm.type === 'CUSTOM_PRICE' && alarm.price) { ... }
 *     // no other alarm.type was ever tested
 *     // the pdh and pdl arguments were received and never read
 *
 * So you could arm a PDH Sweep alarm, see it listed as ACTIVE, and it would
 * never fire. That is the feature the README leads with.
 */

import * as fmt from './fmt.js';

export const TYPES = [
  { id: 'CUSTOM_PRICE',    label: 'Target price crossing', needsPrice: true,  needsCondition: true },
  { id: 'SWEEP_PDH',       label: 'Previous day high swept' },
  { id: 'SWEEP_PDL',       label: 'Previous day low swept' },
  { id: 'ZONE_RESISTANCE', label: 'Price enters a supply zone' },
  { id: 'ZONE_SUPPORT',    label: 'Price enters a demand zone' },
  { id: 'ORDER_BLOCK',     label: '15M order block tapped' },
  { id: 'FVG_CE',          label: '15M FVG 50% consequent encroachment' },
  { id: 'CTC_MILESTONE',   label: 'Open trade reaches the CTC trigger' },
];

export const TONES = ['MARIO_WIN', 'MARIO_POWERUP', 'ZELDA_VICTORY', 'SONIC_RING',
                      'RETRO_SIREN', 'WALLSTREET_BELL', 'CHIME'];

const KEY = 'twr.alarms';
const COOLDOWN_MS = 45000;
const cooldowns = {};

export function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
export function save(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent('alarms:changed', { detail: list }));
}
export function add(alarm) {
  const list = load();
  list.push({ id: `a${Date.now()}${Math.floor(Math.random() * 999)}`, status: 'ACTIVE',
              created: new Date().toISOString(), ...alarm });
  save(list);
  return list;
}
export function remove(id) { save(load().filter(a => a.id !== id)); }
export function toggle(id) {
  save(load().map(a => a.id === id ? { ...a, status: a.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' } : a));
}
export const activeCount = () => load().filter(a => a.status === 'ACTIVE').length;

/* ---------- evaluation ---------- */

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const inZone = (p, z) => p >= z.bottom && p <= z.top;

/**
 * ctx = { price, prevPrice, pdh, pdl, zones, positions, ctcTriggerUsd }
 * Returns [{ alarm, title, detail, action, level }]
 */
export function evaluate(ctx) {
  const { price, prevPrice, pdh, pdl, zones = [], positions = [] } = ctx;
  if (price == null) return [];
  const now = Date.now();
  const hits = [];

  for (const a of load()) {
    if (a.status !== 'ACTIVE') continue;
    if (now - (cooldowns[a.id] || 0) < COOLDOWN_MS) continue;

    const hit = test(a, ctx);
    if (!hit) continue;
    cooldowns[a.id] = now;
    hits.push({ alarm: a, ...hit });
  }
  return hits;
}

function test(a, ctx) {
  const { price, prevPrice, pdh, pdl, zones = [], positions = [] } = ctx;
  const cross = (lvl) => prevPrice != null && ((prevPrice < lvl && price >= lvl) || (prevPrice > lvl && price <= lvl));

  switch (a.type) {
    case 'CUSTOM_PRICE': {
      if (a.price == null) return null;
      const c = a.condition || 'CROSSING';
      if (c === 'CROSSING' && !(cross(a.price) || near(price, a.price, 0.15))) return null;
      if (c === 'GREATER_EQUAL' && price < a.price) return null;
      if (c === 'LESS_EQUAL' && price > a.price) return null;
      return {
        title: `Price ${c === 'LESS_EQUAL' ? 'fell to' : c === 'GREATER_EQUAL' ? 'rose to' : 'tapped'} ${fmt.price(a.price)}`,
        detail: `Now ${fmt.price(price)}`,
        action: 'Check the 3M chart for a rejection candle before doing anything.',
        level: a.price,
      };
    }

    case 'SWEEP_PDH': {
      if (pdh == null || price <= pdh) return null;
      return {
        title: `Previous day high swept at ${fmt.price(pdh)}`,
        detail: `Price pushed to ${fmt.price(price)}, ${fmt.pips(price - pdh)} pips beyond`,
        action: 'Playbook §3A: if the 1H closes back below, bias turns bearish — sell rallies only.',
        level: pdh,
      };
    }

    case 'SWEEP_PDL': {
      if (pdl == null || price >= pdl) return null;
      return {
        title: `Previous day low swept at ${fmt.price(pdl)}`,
        detail: `Price pushed to ${fmt.price(price)}, ${fmt.pips(pdl - price)} pips beyond`,
        action: 'Playbook §3A: if the 1H closes back above, bias turns bullish — dip-buy only.',
        level: pdl,
      };
    }

    case 'ZONE_RESISTANCE':
    case 'ZONE_SUPPORT': {
      const want = a.type === 'ZONE_RESISTANCE' ? 'RESISTANCE' : 'SUPPORT';
      const z = zones.find(z => z.category === want && !z.mitigated && inZone(price, z));
      if (!z) return null;
      return {
        title: `${want === 'RESISTANCE' ? 'Supply' : 'Demand'} zone entered`,
        detail: `${fmt.price(z.bottom)} – ${fmt.price(z.top)}, retest ${z.retests}/${z.max_retests}`,
        action: z.retests >= z.max_retests
          ? 'Playbook §3B: this zone is on its fourth tap — treat it as invalidated.'
          : `Playbook §3C: drop to 3M and wait for a ${want === 'RESISTANCE' ? 'red' : 'green'} rejection candle with at least a 30% wick.`,
        level: want === 'RESISTANCE' ? z.bottom : z.top,
      };
    }

    case 'ORDER_BLOCK': {
      const z = zones.find(z => z.type?.includes('OB') && !z.mitigated && inZone(price, z));
      if (!z) return null;
      return {
        title: `15M ${z.type.includes('BULLISH') ? 'bullish' : 'bearish'} order block tapped`,
        detail: `${fmt.price(z.bottom)} – ${fmt.price(z.top)}, retest ${z.retests}/${z.max_retests}`,
        action: 'Playbook §3C: 3M confirmation candle required before entry. Stop 1.5 points behind the block.',
        level: z.type.includes('BULLISH') ? z.bottom : z.top,
      };
    }

    case 'FVG_CE': {
      const z = zones.find(z => z.category === 'FVG' && z.mid_ce != null
                                && !z.mitigated && near(price, z.mid_ce, 0.25));
      if (!z) return null;
      return {
        title: `FVG 50% consequent encroachment at ${fmt.price(z.mid_ce)}`,
        detail: `Gap ${fmt.price(z.bottom)} – ${fmt.price(z.top)}`,
        action: 'Playbook §3B: this is the level Swing enters from. Confirm on 3M first.',
        level: z.mid_ce,
      };
    }

    case 'CTC_MILESTONE': {
      const trig = ctx.ctcTriggerUsd ?? 5.0;
      const p = positions.find(p => p.excursion_usd >= trig);
      if (!p) return null;
      return {
        title: `Ticket ${p.ticket} reached +${fmt.pips(p.excursion_usd)} pips`,
        detail: `${p.type} ${p.lots} lots from ${fmt.price(p.entry_price)}`,
        action: `Playbook §4: move the stop to ${fmt.price(p.entry_price)} plus spread. The trade is then risk free.`,
        level: p.entry_price,
      };
    }

    default:
      return null;
  }
}

/* ---------- tones ---------- */

let ctx = null;
const audio = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());

function note(freq, at, dur, type = 'square', gain = 0.18) {
  const c = audio();
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + at);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur);
  o.connect(g); g.connect(c.destination);
  o.start(c.currentTime + at); o.stop(c.currentTime + at + dur + 0.02);
}

const SEQS = {
  MARIO_WIN:      [[660,0,.1],[660,.13,.1],[660,.28,.1],[510,.42,.1],[660,.54,.1],[770,.7,.2],[380,.95,.2]],
  MARIO_POWERUP:  [[523,0,.07],[659,.07,.07],[784,.14,.07],[1047,.21,.15]],
  ZELDA_VICTORY:  [[392,0,.12],[523,.13,.12],[659,.26,.12],[784,.39,.3]],
  SONIC_RING:     [[988,0,.08],[1319,.08,.2]],
  RETRO_SIREN:    [[440,0,.18],[880,.18,.18],[440,.36,.18],[880,.54,.25]],
  WALLSTREET_BELL:[[1047,0,.5],[1568,.05,.5]],
  CHIME:          [[880,0,.2],[1109,.1,.25],[1319,.2,.4]],
};

export function playTone(name = 'MARIO_WIN') {
  try {
    const seq = SEQS[name] || SEQS.MARIO_WIN;
    const type = name === 'WALLSTREET_BELL' || name === 'CHIME' ? 'sine' : 'square';
    seq.forEach(([f, t, d]) => note(f, t, d, type));
  } catch { /* audio blocked until first interaction */ }
}
