/* Strategy compliance.
 *
 * The playbook column is transcribed from swing_trading_playbook.pdf v1.0 with
 * its section number. The engine column is read live from /api/strategy_spec,
 * so this page cannot go stale the way the CSV results did.
 */

import * as ui from '../core/ui.js';
import * as api from '../core/api.js';
import * as fmt from '../core/fmt.js';

const $ = id => document.getElementById(id);

/** [rule, playbook text, fn(spec) -> [engine text, status]] */
const RULES = [
  ['Entry trigger', '§2, §3C — zone tap on a 15M/5M order block or FVG only. "Never chase expansion: if price leaves a level without tapping the POI/FVG, let it go."',
    s => s.allow_sweep_only_entries
      ? ['Raw PDH/PDL sweeps are also accepted as entries', 'bad']
      : ['Order block or FVG tap only; sweeps set bias, never entry', 'ok']],

  ['3M confirmation', '[ENTRY_TRIGGER_3M] — <code>Candle_Close(3M) == GREEN AND Lower_Wick_Ratio >= 30%</code>',
    s => s.confirmation_and
      ? [`Green close AND wick ≥ ${(s.min_wick_ratio * 100).toFixed(0)}%` +
         (s.require_close_beyond_prior ? ', and close beyond the prior bar' : ''), 'ok']
      : ['Joined with OR — a 0% wick can qualify on the close alone', 'bad']],

  ['Stop loss size', '§4 — gold 4–10 points (40–100 pips), placed 1–2 points behind the order block wick',
    s => {
      const inBand = s.sl_min_usd >= 4 && s.sl_max_usd <= 10;
      return [`$${s.sl_min_usd.toFixed(2)} – $${s.sl_max_usd.toFixed(2)}` +
              (s.reject_if_sl_exceeds ? '; wider setups are declined, not clamped' : '; NO CEILING'),
              !s.reject_if_sl_exceeds ? 'bad' : inBand ? 'ok' : 'off'];
    }],

  ['Stop buffer', '[ENTRY_TRIGGER_3M] — <code>Bullish_OB.Low - 1.5_POINTS</code>',
    s => [`$${s.sl_buffer_usd.toFixed(2)} behind the POI extreme`,
          Math.abs(s.sl_buffer_usd - 1.5) < 0.01 ? 'ok' : 'off']],

  ['Take profit 1', '[ENTRY_TRIGGER_3M] — immediate structural resistance, minimum 1:1.5 RR. §4 — close 70–80%',
    s => [`Structure first, ${s.tp1_min_rr}R floor; close ${s.tp1_partial_pct}%`,
          s.tp1_min_rr >= 1.5 && s.tp1_partial_pct >= 70 && s.tp1_partial_pct <= 80 ? 'ok' : 'off']],

  ['Cost-to-Cost', '§4 — triggered at +40 to +60 pips on gold. [TRADE_MANAGEMENT_ENGINE] — move stop to breakeven <b>plus spread</b>',
    s => [`+${s.ctc_trigger_pips.toFixed(0)} pips → entry + spread`,
          s.ctc_trigger_pips >= 40 && s.ctc_trigger_pips <= 60 ? 'ok' : 'off']],

  ['Trailing after TP1', '[TRADE_MANAGEMENT_ENGINE] — <code>SET_TRAILING_SL = Swing_Low(3M) - 1.0_POINT</code>',
    s => s.trail_after_tp1 ? ['Trails to the 3M swing anchor', 'ok'] : ['Not enabled', 'off']],

  ['Order block mitigation', '§3B — active for 2 to 3 taps; the 4th tap invalidates it',
    s => [`${s.max_ob_retests} retests permitted, 4th blocked`, s.max_ob_retests === 3 ? 'ok' : 'off']],

  ['Daily bias', '[BIAS_EVALUATION] — Asian sweep of PDH/PDL confirmed by a <b>1H</b> close back inside the range',
    s => s.bias_requires_1h
      ? [`1H close required; minimum sweep depth $${s.min_sweep_depth_usd.toFixed(2)}`, 'ok']
      : ['Uses the lower-timeframe close instead of the 1H close', 'off']],

  ['Session window', '§1 — live 06:00–13:00 IST, i.e. 00:30–07:30 UTC, plus selective US-news evenings',
    s => {
      const w = s.session_windows_utc.map(([a, b]) => `${a.toFixed(2)}–${b.toFixed(2)}`).join(', ');
      const aligned = s.session_windows_utc.some(([a, b]) => a <= 1 && b >= 7 && b <= 8);
      return [`${w} UTC` + (s.us_news_session_enabled ? ' + US news block' : ''), aligned ? 'ok' : 'off'];
    }],

  ['London-open trap', '§5 — no new orders at 11:00 IST (05:30 UTC); wait 5–10 minutes',
    s => [`Blocks ${s.london_trap_utc.toFixed(2)} UTC for ${s.london_trap_minutes} minutes`,
          Math.abs(s.london_trap_utc - 5.5) < 0.01 ? 'ok' : 'bad']],

  ['Session discipline', '§4 — max 2–4 trades per session; pause immediately after 2 consecutive SL or CTC exits',
    s => [`${s.max_trades_per_session} trades per session; pause after ${s.consecutive_stops_to_pause}`,
          s.max_trades_per_session >= 2 && s.max_trades_per_session <= 4 &&
          s.consecutive_stops_to_pause === 2 ? 'ok' : 'off']],

  ['Position sizing', '§4 — 0.01 lot per $100–200 balance, scaling to 0.10–0.20 at $5,000+. Risk 1.0% per trade',
    s => [`${s.lot_tiers.length}-tier table, capped at ${s.max_risk_percent}% risk`,
          s.max_risk_percent <= 1.0 ? 'ok' : 'off']],

  ['News protocol', '§5 — pre-news move to CTC or close 80%; no 1-minute spike trades; wait 15 minutes after release',
    () => ['Not implemented — no economic calendar is wired in', 'off']],
];

const FLAG = { ok: ['ok', 'COMPLIANT'], off: ['off', 'DIFFERS'], bad: ['bad', 'VIOLATES'] };

async function main() {
  await ui.boot({ timeframe: () => '3M' });

  let spec;
  try { spec = await api.strategySpec(); }
  catch { ui.toast('Could not load the strategy specification.', 'err'); return; }

  const r = spec.swing_core;
  $('fp').textContent = spec.engine_fingerprint;

  // Broker server time vs UTC. Every session rule below is written in UTC,
  // but MetaTrader stamps bars in the broker's server time — so if this is
  // wrong, the whole strategy runs on the wrong hours of the day.
  const clk = spec.clock || {};
  const win = (r.session_windows_utc || []).map(([a, b]) => {
    const f = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
    return `${f(a)}–${f(b)}`;
  }).join(', ');
  const brokerWin = (r.session_windows_utc || []).map(([a, b]) => {
    const f = h => { const x = ((h + (clk.broker_utc_offset || 0)) % 24 + 24) % 24;
      return `${String(Math.floor(x)).padStart(2, '0')}:${String(Math.round((x % 1) * 60)).padStart(2, '0')}`; };
    return `${f(a)}–${f(b)}`;
  }).join(', ');

  $('clock-box').innerHTML = `
    <div class="banner ${clk.detected ? 'info' : 'warn'}">
      <svg aria-hidden="true"><use href="#i-${clk.detected ? 'info' : 'warn'}"></use></svg>
      <div class="banner-body">
        <div class="banner-title">
          Broker server time is UTC${(clk.broker_utc_offset ?? 0) >= 0 ? '+' : ''}${clk.broker_utc_offset ?? '?'}
          ${clk.detected ? '' : ' — not detected, assuming 0'}
        </div>
        <div class="banner-text">
          MetaTrader stamps every bar in server time, not UTC, and the rules below are
          written in UTC. Swing's window of <b>${win} UTC</b> therefore sits at
          <b class="mono">${brokerWin}</b> on your MT5 chart.
          ${clk.detected
            ? `UTC now ${clk.utc_now}, broker clock ${clk.broker_now}.`
            : 'Start MetaTrader 5 so the offset can be read from a live tick.'}
        </div>
      </div>
    </div>`;
  $('units').innerHTML = `1 pip = $${spec.units.usd_per_pip.toFixed(2)}`;
  $('units').style.fontFamily = 'var(--mono)';

  const s = spec.session_state;
  $('sess').textContent = s.is_paused ? 'PAUSED' : `${s.trades_taken}/${s.max_trades}`;
  $('sess').className = 'stat-v ' + (s.is_paused ? 'neg' : '');
  $('sess-note').textContent = s.is_paused
    ? 'Circuit breaker tripped — two consecutive stopped or breakeven exits'
    : `${s.consecutive_stops}/${s.pause_threshold} toward the two-stop pause`;

  const rows = RULES.map(([name, book, fn]) => {
    const [engine, status] = fn(r);
    const [cls, label] = FLAG[status];
    return { name, book, engine, cls, label, status };
  });

  const ok = rows.filter(x => x.status === 'ok').length;
  const bad = rows.filter(x => x.status === 'bad').length;
  $('compliance').textContent = `${ok}/${rows.length}`;
  $('compliance').className = 'stat-v ' + (bad ? 'neg' : ok === rows.length ? 'pos' : 'gold');
  $('compliance-note').textContent = bad
    ? `${bad} rule${bad > 1 ? 's' : ''} actively violated`
    : ok === rows.length ? 'Every rule matches the playbook'
    : `${rows.length - ok} deliberate difference${rows.length - ok > 1 ? 's' : ''}`;

  $('spec-rows').innerHTML = rows.map(x => `
    <div class="spec-row">
      <div class="spec-name">${fmt.esc(x.name)}</div>
      <div class="spec-cell" data-label="Playbook says">${x.book}</div>
      <div class="spec-cell" data-label="Engine does">${fmt.esc(x.engine)}</div>
      <div class="spec-cell" data-label="Status"><span class="spec-flag ${x.cls}">${x.label}</span></div>
    </div>`).join('');

  const c = spec.custom_pro;
  $('custom-state').textContent = c.enabled ? 'Enabled' : 'Disabled';
  const item = (k, v, n) => `<div class="stat"><span class="stat-k">${k}</span>
    <span class="stat-v" style="font-size:18px">${v}</span><span class="stat-n">${n}</span></div>`;
  $('custom-grid').innerHTML = [
    item('Confluence threshold', c.min_confluence, 'Out of 100. Below this the setup is skipped.'),
    item('Trend filter', c.require_htf_alignment ? 'On' : 'Off',
         '50/200 EMA alignment. The old version had no direction filter at all.'),
    item('Rejection wick', `${(c.min_wick_ratio * 100).toFixed(0)}%`, 'Minimum on the trigger candle'),
    item('Stop range', `${c.sl_min_atr}–${c.sl_max_atr}× ATR`,
         'ATR-relative, not fixed dollars — gold moved from 3,280 to 4,650 across the sample'),
    item('Targets', `${c.tp1_rr}R / ${c.tp2_rr}R`, 'TP1 then runner'),
    item('Cost-to-Cost', `+${c.ctc_trigger_pips.toFixed(0)}p`, 'Breakeven plus spread'),
  ].join('');
}

main();
