/* Trade desk.
 *
 * Implements playbook §4 sizing, which the old app declared in config and
 * never used — MAX_RISK_PERCENT was read by nothing, and the execute endpoint
 * took whatever lot number was typed into a box.
 *
 * Also puts a confirmation step in front of live execution (audit C-03) and
 * honours the session cap and two-stop circuit breaker before the order can
 * be sent at all.
 */

import * as ui from '../core/ui.js';
import * as api from '../core/api.js';
import * as fmt from '../core/fmt.js';
import * as voice from '../core/voice.js';

const $ = id => document.getElementById(id);
let signal = null, gate = { allowed: true }, sizing = null, balanceTouched = false;

/* ------------------------------------------------------------ the setup */

function loadSignal() {
  try { signal = JSON.parse(sessionStorage.getItem('twr.signal') || 'null'); } catch { signal = null; }
  if (!signal) return;

  $('setup-src').textContent = signal.strategy === 'SWING_CORE' ? 'Swing Core' : 'Swing Pro';
  $('setup-body').innerHTML = `
    <div class="sig-head">
      <span class="dir-badge ${signal.type}">${signal.type}</span>
      <span class="tag">${fmt.esc((signal.poi_type || '').replace(/_/g, ' '))}</span>
      <span class="tag">${signal.time_str || ''}</span>
    </div>
    <div class="levels">
      <div class="level entry"><span class="level-k">Entry</span><span class="level-v">${fmt.price(signal.entry_price)}</span></div>
      <div class="level sl"><span class="level-k">Stop</span><span class="level-v">${fmt.price(signal.sl)}</span>
        <span class="level-n">${signal.risk_pips} pips</span></div>
      <div class="level tp"><span class="level-k">TP1</span><span class="level-v">${fmt.price(signal.tp1)}</span>
        <span class="level-n">${signal.tp1_rr}R</span></div>
      <div class="level ctc"><span class="level-k">CTC at +${signal.ctc_trigger_pips}p</span>
        <span class="level-v">${fmt.price(signal.ctc_sl_price)}</span></div>
    </div>`;

  $('f-dir').value = signal.type;
  $('f-entry').value = signal.entry_price;
  $('f-sl').value = signal.sl;
  $('f-tp').value = signal.tp1;
}

/* ------------------------------------------------------------ the maths */

function inputs() {
  return {
    dir: $('f-dir').value,
    entry: parseFloat($('f-entry').value),
    sl: parseFloat($('f-sl').value),
    tp: parseFloat($('f-tp').value),
    balance: parseFloat($('f-balance').value),
    riskPct: parseFloat($('f-risk').value) || 1.0,
  };
}

async function recalc() {
  const v = inputs();
  const valid = !isNaN(v.entry) && !isNaN(v.sl) && v.entry !== v.sl;

  // Direction sanity — a buy whose stop sits above entry is an input error.
  if (valid) {
    const wrongWay = v.dir === 'BUY' ? v.sl >= v.entry : v.sl <= v.entry;
    $('rr-hint').innerHTML = wrongWay
      ? `<span style="color:var(--short)">The stop is on the wrong side of entry for a ${v.dir.toLowerCase()}.</span>`
      : rrText(v);
    if (wrongWay) { setSizing(null); return; }
  } else {
    $('rr-hint').textContent = 'Enter an entry and a stop to see risk and reward.';
    setSizing(null);
    return;
  }

  const riskUsd = Math.abs(v.entry - v.sl);
  try {
    setSizing(await api.positionSize({
      balance: isNaN(v.balance) ? undefined : v.balance,
      risk_usd: riskUsd, risk_percent: v.riskPct,
    }));
  } catch { setSizing(null); }
}

function rrText(v) {
  const risk = Math.abs(v.entry - v.sl);
  if (isNaN(v.tp)) return `Risk ${fmt.pips(risk)} pips ($${risk.toFixed(2)}). Add a target for the R multiple.`;
  const reward = Math.abs(v.tp - v.entry);
  const rr = reward / risk;
  const colour = rr >= 1.5 ? 'var(--long)' : 'var(--warn)';
  return `Risk ${fmt.pips(risk)} pips · reward ${fmt.pips(reward)} pips · ` +
         `<b style="color:${colour}">${rr.toFixed(2)}R</b>` +
         (rr < 1.5 ? ' — the playbook wants at least 1.5R' : '');
}

function setSizing(s) {
  sizing = s;
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };

  if (!s) {
    ['o-lots', 'o-cost', 'o-costpct', 'o-risk', 'o-tier', 'o-binding'].forEach(i => set(i, '—'));
    $('size-warning').innerHTML = '';
    $('btn-exec').disabled = true;
    return;
  }

  set('o-lots', s.lots.toFixed(2));
  set('o-binding', `limited by ${s.binding_constraint}`);
  set('o-cost', fmt.usd(-s.stop_out_cost_usd, { sign: false }));
  set('o-costpct', `${s.stop_out_pct_of_balance}% of balance`);
  set('o-risk', `${s.risk_pips}p`);
  set('o-tier', s.tier_lots.toFixed(2));

  $('o-costpct').style.color = s.exceeds_risk_budget ? 'var(--short)' : 'var(--text-muted)';

  $('size-warning').innerHTML = s.warning ? `
    <div class="banner warn" style="margin:12px 0 0">
      <svg aria-hidden="true"><use href="#i-warn"></use></svg>
      <div class="banner-body">
        <div class="banner-title">This size risks more than your limit</div>
        <div class="banner-text">${fmt.esc(s.warning)}</div>
      </div>
    </div>` : '';

  if (!$('f-lots').dataset.touched) $('f-lots').value = s.lots.toFixed(2);
  updateExecButton();
}

function updateExecButton() {
  const b = $('btn-exec'), v = inputs();
  const lots = parseFloat($('f-lots').value);
  const ok = sizing && !isNaN(lots) && lots >= 0.01 && lots <= (window.DESK?.maxLots ?? 1) && gate.allowed;
  b.disabled = !ok;
  b.className = `btn btn-xl btn-block ${v.dir === 'BUY' ? 'btn-buy' : 'btn-sell'}`;
  $('exec-label').textContent = gate.allowed
    ? `${v.dir === 'BUY' ? 'Buy' : 'Sell'} ${isNaN(lots) ? '' : lots.toFixed(2)} lots`
    : 'Blocked by session discipline';
}

/* ------------------------------------------------------------ execution */

async function execute() {
  const v = inputs();
  const lots = parseFloat($('f-lots').value);

  const lines = [
    ['Direction', v.dir],
    ['Symbol', 'XAUUSD'],
    ['Lots', lots.toFixed(2)],
    ['Stop loss', isNaN(v.sl) ? 'none' : fmt.price(v.sl)],
    ['Take profit', isNaN(v.tp) ? 'none' : fmt.price(v.tp)],
    ['Risk if stopped', sizing ? fmt.usd(-sizing.stop_out_cost_usd, { sign: false }) : '—'],
    ['Percent of balance', sizing ? `${sizing.stop_out_pct_of_balance}%` : '—'],
  ];

  const okToSend = await ui.confirmAction({
    title: `Send a live ${v.dir.toLowerCase()} order?`,
    lines,
    confirmText: `Send ${v.dir.toLowerCase()}`,
    danger: v.dir === 'SELL' || (sizing?.exceeds_risk_budget ?? false),
  });
  if (!okToSend) return;

  const b = $('btn-exec');
  b.disabled = true;
  $('exec-label').textContent = 'Sending…';

  try {
    const res = await api.execute({
      type: v.dir, lots,
      sl: isNaN(v.sl) ? 0 : v.sl,
      tp: isNaN(v.tp) ? 0 : v.tp,
      comment: `Swing ${signal?.strategy === 'SWING_PRO' ? 'Custom' : 'Core'}`,
    });

    if (res.success) {
      voice.say('ORDER_PLACED');
      ui.toast(`Filled — ticket ${res.ticket}, ${res.volume} lots at ${fmt.price(res.price)}`, 'ok', 8000);
      $('f-lots').dataset.touched = '';
      refreshGate();
    } else {
      ui.toast(res.error || 'The broker rejected the order.', 'err', 9000);
    }
  } catch (e) {
    if (e.status === 409) {
      ui.toast(e.data?.error || 'Blocked by session discipline.', 'warn', 10000);
      refreshGate();
    } else if (e.status === 401) {
      ui.toast('Session token rejected. Reload the page.', 'err');
    } else {
      ui.toast('Could not reach the server.', 'err');
    }
  } finally {
    updateExecButton();
  }
}

/* --------------------------------------------------------- session gate */

async function refreshGate() {
  try { gate = await api.canTrade(); } catch { return; }
  const box = $('gate-banner');

  if (gate.allowed) {
    box.innerHTML = gate.state?.trades_taken
      ? `<div class="banner info">
           <svg aria-hidden="true"><use href="#i-info"></use></svg>
           <div class="banner-body"><div class="banner-title">Session discipline</div>
           <div class="banner-text">${fmt.esc(gate.reason)}</div></div>
         </div>` : '';
  } else {
    box.innerHTML = `
      <div class="banner danger">
        <svg aria-hidden="true"><use href="#i-warn"></use></svg>
        <div class="banner-body">
          <div class="banner-title">Trading is blocked</div>
          <div class="banner-text">${fmt.esc(gate.reason)}</div>
        </div>
      </div>`;
    if (gate.code === 'PAUSED') voice.say('PAUSED');
  }
  updateExecButton();
}

function renderPositions(list) {
  const body = $('pos-body');
  if (!list?.length) { body.innerHTML = '<div class="empty"><div>No open positions.</div></div>'; return; }

  body.innerHTML = `<div class="table-scroll"><table class="data" style="min-width:640px">
    <thead><tr><th>Ticket</th><th>Type</th><th>Lots</th><th>Entry</th><th>Now</th>
    <th>Excursion</th><th>Stop</th><th>P&amp;L</th><th>Next action</th></tr></thead><tbody>
    ${list.map(p => {
      const prot = p.sl && (p.type === 'BUY' ? p.sl >= p.entry_price : p.sl <= p.entry_price);
      const action = prot
        ? '<span style="color:var(--long)">Risk free — let the runner work</span>'
        : p.excursion_usd >= 5
          ? `<span style="color:var(--warn)">Move the stop to ${fmt.price(p.entry_price)}</span>`
          : `<span style="color:var(--text-faint)">Wait for +50 pips</span>`;
      return `<tr>
        <td class="num">${p.ticket}</td>
        <td><span class="badge ${p.type}">${p.type}</span></td>
        <td class="num">${p.lots}</td>
        <td class="num">${fmt.price(p.entry_price)}</td>
        <td class="num">${fmt.price(p.current_price)}</td>
        <td class="num" style="color:var(--${p.excursion_pips >= 0 ? 'long' : 'short'})">
          ${p.excursion_pips >= 0 ? '+' : ''}${p.excursion_pips}p</td>
        <td class="num">${p.sl ? fmt.price(p.sl) : '—'}</td>
        <td class="num" style="font-weight:700;color:var(--${p.profit_usd >= 0 ? 'long' : 'short'})">
          ${fmt.usd(p.profit_usd)}</td>
        <td>${action}</td></tr>`;
    }).join('')}
  </tbody></table></div>`;
}

/* ----------------------------------------------------------------- boot */

async function main() {
  loadSignal();

  ['f-dir', 'f-entry', 'f-sl', 'f-tp', 'f-risk'].forEach(id =>
    $(id).addEventListener('input', recalc));
  $('f-balance').addEventListener('input', () => { balanceTouched = true; recalc(); });
  $('f-lots').addEventListener('input', e => { e.target.dataset.touched = '1'; updateExecButton(); });
  $('btn-exec').addEventListener('click', execute);

  $('btn-reset-session').addEventListener('click', async () => {
    if (!await ui.confirmAction({
      title: 'Reset session discipline?',
      lines: [['Clears', 'the session trade count'], ['Clears', 'the two-stop circuit breaker']],
      confirmText: 'Reset',
    })) return;
    await api.resetSession();
    ui.toast('Session counters cleared.', 'ok');
    refreshGate();
  });

  await ui.boot({
    timeframe: () => '3M',
    onStatus: s => {
      if (!s.connected) return;
      if (!balanceTouched && s.balance != null && $('f-balance').value !== String(s.balance)) {
        $('f-balance').value = Math.round(s.balance);
        recalc();
      }
      renderPositions(s.open_positions);
    },
  });

  await refreshGate();
  await recalc();
  api.poll(refreshGate, 15000, { immediate: false });
}

main();
