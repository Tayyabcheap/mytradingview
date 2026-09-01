/* Voice.
 *
 * Two engines behind one call:
 *   neural   /api/voice/speak returns an MP3 rendered by edge-tts.
 *   browser  Web Speech API, used when the endpoint answers 204.
 *
 * Why the old app sounded like a man
 * ----------------------------------
 * static/app.js matched voices with:
 *     voices.find(v => v.lang.startsWith('en') && (
 *       v.name.includes('Natural') || v.name.includes('Google') ||
 *       v.name.includes('Desktop') || v.name.includes('David')  ||
 *       v.name.includes('Zira')    || v.name.includes('English')))
 *
 * `find` returns the first match in ENUMERATION order, not preference order,
 * and 'Desktop' matches "Microsoft David Desktop - English (United States)",
 * which on a stock Windows install enumerates before Zira. So David won every
 * time. 'David' was in the list explicitly as well.
 *
 * Here the preference list is scored and ranked, male voices are excluded by
 * name, and getVoices() is awaited properly — the old code called it once and
 * silently fell back to the system default when it returned [] on first paint.
 */

import * as api from './api.js';

const FEMALE_RANK = [
  [/jenny/i,    100],
  [/ava/i,       98],
  [/sonia/i,     96],
  [/aria/i,      94],
  [/emma/i,      92],
  [/michelle/i,  90],
  [/natasha/i,   88],
  [/libby/i,     86],
  [/zira/i,      76],
  [/hazel/i,     74],
  [/eva/i,       70],
  [/catherine/i, 68],
  [/samantha/i,  80],
  [/female/i,    60],
];

// Never selectable, whatever else matches.
const MALE = /david|mark|george|ryan|guy|james|william|richard|brian|christopher|eric|roger|steffan|thomas|male\b/i;

let voices = [];
let neuralVoices = ['en-US-JennyNeural', 'en-US-AvaNeural', 'en-US-AvaMultilingualNeural', 'en-GB-SoniaNeural', 'en-US-AriaNeural', 'en-US-EmmaNeural'];
let chosen = null;
let chosenNeural = localStorage.getItem('twr.neuralVoice') || 'en-US-JennyNeural';
let enabled = true;
let persona = 'sultry';
let lines = {};
let neuralAvailable = false;
let lastSpoken = { text: '', at: 0 };
let audio = null;
let unlocked = false;

/* ---------- browser voice selection ---------- */

function loadVoices() {
  return new Promise(resolve => {
    const got = () => {
      const v = window.speechSynthesis?.getVoices?.() || [];
      if (v.length) { resolve(v); return true; }
      return false;
    };
    if (got()) return;
    // getVoices() is empty until voiceschanged fires on first load. The old
    // code did not wait, so it used whatever the default voice was.
    let tries = 0;
    const iv = setInterval(() => { if (got() || ++tries > 8) clearInterval(iv); }, 120);
    window.speechSynthesis?.addEventListener?.('voiceschanged', () => { if (got()) clearInterval(iv); });
    setTimeout(() => { clearInterval(iv); resolve(window.speechSynthesis?.getVoices?.() || []); }, 1200);
  });
}

function rank(v) {
  if (MALE.test(v.name)) return -1;
  let s = 0;
  for (const [re, pts] of FEMALE_RANK) if (re.test(v.name)) { s = Math.max(s, pts); }
  if (!s) return -1;
  if (/natural|neural/i.test(v.name)) s += 25;
  if (/online/i.test(v.name)) s += 6;
  if (v.lang?.startsWith('en')) s += 10;
  if (/en-US|en-GB/i.test(v.lang || '')) s += 4;
  return s;
}

export function listVoices() {
  return voices
    .map(v => ({ name: v.name, lang: v.lang, score: rank(v) }))
    .sort((a, b) => b.score - a.score);
}

export function setVoiceByName(name) {
  const v = voices.find(x => x.name === name);
  if (v) { chosen = v; localStorage.setItem('twr.voiceName', name); }
  return !!v;
}

/* ---------- init ---------- */

export async function init() {
  persona = localStorage.getItem('twr.persona') || window.DESK?.persona || 'sultry';
  enabled = localStorage.getItem('twr.voiceOn') !== '0';

  try {
    const cfg = await api.voiceLines(persona);
    lines = cfg.lines || {};
    neuralAvailable = !!cfg.neural_available;
  } catch { lines = {}; }

  voices = await loadVoices();
  const saved = localStorage.getItem('twr.voiceName');
  chosen = (saved && voices.find(v => v.name === saved)) || null;
  if (!chosen) {
    const scored = voices.map(v => [v, rank(v)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
    chosen = scored.length ? scored[0][0] : (voices.find(v => v.lang?.startsWith('en')) || null);
  }

  // Browsers block audio until the user has interacted with the page.
  const unlock = () => {
    unlocked = true;
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });

  return { persona, enabled, neuralAvailable, voice: chosen?.name || null };
}

/* ---------- state ---------- */

export const isEnabled = () => enabled;
export function setEnabled(on) {
  enabled = !!on;
  localStorage.setItem('twr.voiceOn', enabled ? '1' : '0');
  if (!enabled) stop();
  return enabled;
}
export const getPersona = () => persona;
export async function setPersona(p) {
  persona = p;
  localStorage.setItem('twr.persona', p);
  try {
    const cfg = await api.voiceLines(p);
    lines = cfg.lines || {};
    neuralAvailable = !!cfg.neural_available;
  } catch { /* keep previous lines */ }
  return persona;
}
export const scriptFor = (event) => (lines[event] || []);

export function stop() {
  try { window.speechSynthesis?.cancel(); } catch {}
  if (audio) { audio.pause(); audio = null; }
}

/* ---------- speaking ---------- */

function pickLine(event) {
  const v = lines[event];
  if (!v || !v.length) return '';
  return v[Math.floor(Math.random() * v.length)];
}

/**
 * say('BUY') picks a persona line for the event.
 * say(null, 'literal text') speaks that text.
 *
 * `force` bypasses both the enabled flag and the repeat guard — used by the
 * Settings preview button.
 */
export async function say(event, text = null, { force = false } = {}) {
  if (!enabled && !force) return false;
  if (persona === 'silent' && !force) return false;

  const phrase = (text || pickLine(event) || '').trim();
  if (!phrase) return false;

  const now = Date.now();
  if (!force && phrase === lastSpoken.text && now - lastSpoken.at < 20000) return false;
  lastSpoken = { text: phrase, at: now };

  if (!unlocked && !force) return false;

  const engine = window.DESK?.voiceEngine || 'auto';
  if (engine !== 'browser' && neuralAvailable) {
    if (await speakNeural(phrase)) return true;
  }
  return speakBrowser(phrase);
}

async function speakNeural(text) {
  try {
    const vName = getNeuralVoice();
    const url = `/api/voice/speak?text=${encodeURIComponent(text)}&persona=${encodeURIComponent(persona)}` +
                (vName ? `&voice=${encodeURIComponent(vName)}` : '');
    const res = await fetch(url, { headers: { 'X-Desk-Token': window.DESK?.token || '' } });
    if (res.status === 204 || !res.ok) return false;
    const blob = await res.blob();
    if (blob.size < 512) return false;

    stop();
    audio = new Audio(URL.createObjectURL(blob));
    audio.volume = 1.0;
    await audio.play();
    audio.addEventListener('ended', () => { if (audio) { URL.revokeObjectURL(audio.src); audio = null; } });
    return true;
  } catch { return false; }
}

function speakBrowser(text) {
  if (!('speechSynthesis' in window)) return false;
  try {
    // Only cancel a queue that is actually stuck; the old code cancelled
    // unconditionally, so back-to-back alerts truncated each other.
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
    }
    const u = new SpeechSynthesisUtterance(text);
    u.volume = 1.0;
    u.rate = Number(localStorage.getItem('twr.rate') || window.DESK?.browserRate || 0.86);
    u.pitch = Number(localStorage.getItem('twr.pitch') || window.DESK?.browserPitch || 0.85);
    if (chosen) u.voice = chosen;
    window.speechSynthesis.speak(u);
    return true;
  } catch { return false; }
}

export function setRate(v) { localStorage.setItem('twr.rate', String(v)); }
export function setPitch(v) { localStorage.setItem('twr.pitch', String(v)); }
export const getRate  = () => Number(localStorage.getItem('twr.rate')  || window.DESK?.browserRate  || 0.86);
export const getPitch = () => Number(localStorage.getItem('twr.pitch') || window.DESK?.browserPitch || 0.85);
export const isNeural = () => neuralAvailable;
export const currentVoiceName = () => chosen?.name || null;
export const getNeuralVoice = () => localStorage.getItem('twr.neuralVoice') || chosenNeural || 'en-US-JennyNeural';
export function setNeuralVoice(v) {
  chosenNeural = v;
  localStorage.setItem('twr.neuralVoice', v);
  return chosenNeural;
}
export const listNeuralVoices = () => neuralVoices;
