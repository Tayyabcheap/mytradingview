/* Shared shell: header ticker, bias, session state, connection, theme,
 * toasts, confirmation dialog, and the trade-milestone announcer.
 *
 * The announcer lives here rather than on the chart page so that a Cost-to-Cost
 * or stop-loss call still reaches you while you are on Analytics or Settings.
 */

import * as api from './api.js';
import * as fmt from './fmt.js';
import * as voice from './voice.js';

/* ---------- toasts ---------- */

export function toast(msg, kind = '', ms = 4200) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s'; el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }, ms);
}

/* ---------- confirmation ---------- */

/**
 * Blocking confirm dialog. The old app sent a live market order on a single
 * click; its only two confirm() calls guarded clearing chart drawings and
 * shutting down the server.
 */
export function confirmAction({ title, lines = [], confirmText = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <div class="card-hd"><h2>${fmt.esc(title)}</h2></div>
      <div class="card-bd">
        <dl class="confirm-lines">
          ${lines.map(([k, v]) => `<dt>${fmt.esc(k)}</dt><dd>${fmt.esc(v)}</dd>`).join('')}
        </dl>
      </div>
      <div class="modal-actions">
        <button class="btn" data-x="no">Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-buy'}" data-x="yes">${fmt.esc(confirmText)}</button>
      </div>`;
    document.body.appendChild(dlg);
    const done = v => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.querySelector('[data-x="no"]').onclick = () => done(false);
    dlg.querySelector('[data-x="yes"]').onclick = () => done(true);
    dlg.addEventListener('cancel', e => { e.preventDefault(); done(false); });
    dlg.showModal();
    dlg.querySelector('[data-x="yes"]').focus();
  });
}

/* ---------- header ---------- */

const $ = id => document.getElementById(id);

/** BUY/SELL announcements, muted independently of the global voice switch. */
export const tradeAlertsEnabled = () => localStorage.getItem('twr.tradeAlerts') !== '0';

function setConn(ok, text) {
  const p = $('t-conn'), t = $('t-conn-text');
  if (!p) return;
  p.className = `pill ${ok ? 'live' : 'off'}`;
  if (t) t.textContent = text;
}

function setBias(bias) {
  const p = $('t-bias'), t = $('t-bias-text');
  if (!p || !bias) return;
  const b = bias.bias || 'RANGE_BOUND';
  // The old client compared against 'BULLISH_FLOW'/'BEARISH_FLOW', strings the
  // status endpoint never emitted, so the pill was permanently stuck on RANGE.
  const map = {
    STRONG_BULLISH: ['long',  'Bias: BULLISH — longs only'],
    STRONG_BEARISH: ['short', 'Bias: BEARISH — shorts only'],
    RANGE_BOUND:    ['range', 'Bias: RANGE — buy support, sell resistance'],
  };
  const [cls, label] = map[b] || map.RANGE_BOUND;
  p.className = `pill ${cls}`;
  t.textContent = label;
  p.title = bias.reason || '';
}

function setSession(s) {
  const p = $('t-session'), t = $('t-session-text');
  if (!p || !s) return;
  if (s.is_paused) {
    p.className = 'pill short';
    t.textContent = 'PAUSED — 2 stops';
    p.title = 'Circuit breaker tripped (playbook §4). Resumes ' + (s.paused_until || '');
  } else {
    const near = s.trades_taken >= s.max_trades;
    p.className = `pill ${near ? 'warn' : 'range'}`;
    t.textContent = `Session ${s.trades_taken}/${s.max_trades}`;
    p.title = `${s.consecutive_stops}/${s.pause_threshold} toward the two-stop pause`;
  }
}

/* ---------- milestone announcer ---------- */

const announced = new Set();
let lastPositionIds = new Set();

function announcePositions(positions) {
  const live = new Set(positions.map(p => p.ticket));

  for (const p of positions) {
    const ctcTrigger = Number(localStorage.getItem('twr.ctcTriggerUsd') || 5.0);

    if (p.excursion_usd >= ctcTrigger) {
      const k = `${p.ticket}:ctc`;
      if (!announced.has(k)) {
        announced.add(k);
        voice.say('CTC');
        toast(`Cost-to-Cost — ticket ${p.ticket} is +${fmt.pips(p.excursion_usd)} pips. Move the stop to ${fmt.price(p.entry_price)}.`, 'ok', 9000);
        api.notifyTray({ message: `Move stop to breakeven on ticket ${p.ticket}` }).catch(() => {});
      }
    }

    if (p.sl) {
      const beyondBE = p.type === 'BUY' ? p.sl >= p.entry_price : p.sl <= p.entry_price;
      const k = `${p.ticket}:protected`;
      if (beyondBE && !announced.has(k)) { announced.add(k); }
    }
  }

  // A position that vanished has closed. Classify from its last known P&L so
  // the circuit breaker sees it.
  for (const t of lastPositionIds) {
    if (live.has(t)) continue;
    const last = window.__lastPos?.[t];
    if (!last) continue;
    const risk = last.sl ? Math.abs(last.entry_price - last.sl) * 100 * last.lots : null;
    let outcome = 'BREAKEVEN';
    if (risk && last.profit_usd > 0.25 * risk) outcome = 'WIN';
    else if (risk && last.profit_usd < -0.25 * risk) outcome = 'LOSS';

    if (outcome === 'WIN') { voice.say('TP2'); toast(`Ticket ${t} closed ${fmt.usd(last.profit_usd)}`, 'ok'); }
    else if (outcome === 'LOSS') { voice.say('SL'); toast(`Ticket ${t} stopped out ${fmt.usd(last.profit_usd)}`, 'err'); }
    else { toast(`Ticket ${t} closed at breakeven`, 'warn'); }

    api.recordExit(outcome).catch(() => {});
  }

  window.__lastPos = Object.fromEntries(positions.map(p => [p.ticket, p]));
  lastPositionIds = live;
}

/* ---------- boot ---------- */

export async function boot({ timeframe = () => '3M', onStatus = null } = {}) {
  // theme
  const savedTheme = localStorage.getItem('twr.theme') || 'dark';
  document.documentElement.dataset.theme = savedTheme;
  $('btn-theme')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('twr.theme', next);
  });

  // voice — initialised in the background. Awaiting it blocked first paint by
  // up to 3.2s on any machine with no speech voices installed, because
  // getVoices() never resolves there and the loader waits out its timeout.
  const vb = $('btn-voice');
  const paint = () => {
    if (!vb) return;
    const on = voice.isEnabled();
    vb.setAttribute('aria-pressed', String(on));
    vb.querySelector('use').setAttribute('href', on ? '#i-volume' : '#i-mute');
    vb.title = on ? `Voice on — ${voice.isNeural() ? 'neural' : (voice.currentVoiceName() || 'browser')}` : 'Voice muted';
  };
  paint();
  const vstate = voice.init().then(st => { paint(); return st; });
  vb?.addEventListener('click', () => {
    const on = voice.setEnabled(!voice.isEnabled());
    paint();
    if (on) voice.say('READY', null, { force: true });
  });

  // Separate mute for BUY/SELL announcements. Silencing new-trade calls while
  // keeping Cost-to-Cost and stop-loss calls is a different decision — the
  // latter are about money already at risk.
  const tv = $('btn-trade-voice');
  const paintTrade = () => {
    if (!tv) return;
    const on = tradeAlertsEnabled();
    tv.setAttribute('aria-pressed', String(on));
    tv.querySelector('use').setAttribute('href', on ? '#i-bell-on' : '#i-bell-off');
    tv.title = on
      ? 'BUY and SELL announcements are on — click to mute'
      : 'BUY and SELL announcements are muted. Cost-to-Cost and stop-loss calls still play.';
  };
  paintTrade();
  tv?.addEventListener('click', () => {
    const on = !tradeAlertsEnabled();
    localStorage.setItem('twr.tradeAlerts', on ? '1' : '0');
    paintTrade();
    toast(on ? 'BUY and SELL alerts unmuted.' : 'BUY and SELL alerts muted.', on ? 'ok' : 'warn');
    if (on) voice.say(null, 'Trade alerts are back on, baby.', { force: true });
  });

  // status polling
  const poller = api.poll(async () => {
    let s;
    try { s = await api.status(timeframe()); }
    catch { setConn(false, 'Server offline'); throw new Error('offline'); }

    if (!s.connected) {
      setConn(false, 'MT5 offline');
      $('t-bid') && ($('t-bid').textContent = '—');
      $('t-ask') && ($('t-ask').textContent = '—');
      onStatus?.(s);
      return;
    }

    setConn(true, 'MT5 live');
    $('t-bid') && ($('t-bid').textContent = fmt.price(s.bid));
    $('t-ask') && ($('t-ask').textContent = fmt.price(s.ask));
    const sp = $('t-spread');
    if (sp) {
      sp.textContent = `${fmt.pips(s.spread_usd)}p`;
      sp.style.color = s.spread_wide ? 'var(--warn)' : '';
      sp.title = `$${s.spread_usd?.toFixed(3)} — ${s.spread_wide ? 'unusually wide' : 'normal'}`;
    }
    const bal = $('t-balance');
    if (bal) bal.textContent = s.balance != null ? `$${fmt.int(Math.round(s.balance))}` : '—';

    setBias(s.bias);
    setSession(s.session);
    announcePositions(s.open_positions || []);
    onStatus?.(s);
  }, window.DESK?.pollStatus || 1000);

  return { poller, voiceReady: vstate };
}

export { fmt, voice, api };
