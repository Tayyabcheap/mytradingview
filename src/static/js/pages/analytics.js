/* Analytics.
 *
 * Every number here is USD on the lot size recorded with the trade. The old
 * page labelled the same figures "pips", hardcoded a "+" prefix (so a losing
 * strategy rendered as "+-13,574 pips"), showed a total under a "monthly"
 * heading, and divided every strategy by a hardcoded 12 months regardless of
 * the actual span.
 *
 * It also shipped five invented placeholder numbers in the HTML — 5,953
 * trades, 65.3%, 1.44 — which were visible on every page load and on any
 * fetch failure. There are no placeholders in this template.
 */

import * as ui from '../core/ui.js';
import * as api from '../core/api.js';
import * as fmt from '../core/fmt.js';

const $ = id => document.getElementById(id);
let page = 1, pages = 1, summaries = null;

const q = () => ({
  strategy: $('f-strategy').value,
  outcome: $('f-outcome').value,
  q: $('f-search').value.trim(),
  page, size: 100,
});

function tile(k, v, cls, note) {
  return `<div class="stat"><span class="stat-k">${fmt.esc(k)}</span>
    <span class="stat-v ${cls || ''}">${v}</span>
    <span class="stat-n">${note || ''}</span></div>`;
}

function renderKpis(s) {
  const kbox = $('kpis'), vbox = $('verdict');
  if (!kbox) return;
  if (!s || s.empty) { kbox.innerHTML = ''; if (vbox) vbox.innerHTML = ''; return; }

  // The verdict line is the point of this page. Everything below it is support.
  if (vbox) vbox.innerHTML = `
    <div class="banner ${s.is_profitable ? 'ok' : 'danger'}">
      <svg aria-hidden="true"><use href="#i-${s.is_profitable ? 'check' : 'warn'}"></use></svg>
      <div class="banner-body">
        <div class="banner-title">${fmt.esc(s.strategy_label || 'Result')} —
          ${fmt.usd(s.net_usd)} over ${s.period_months} months</div>
        <div class="banner-text">${fmt.esc(s.verdict)}</div>
      </div>
    </div>`;

  const margin = s.win_rate_margin;
  kbox.innerHTML = [
    tile('Net result', fmt.usd(s.net_usd), s.net_usd >= 0 ? 'pos' : 'neg',
         `${fmt.usd(s.net_usd_per_month)} per month · ${fmt.int(s.total_trades)} trades`),

    tile('Payoff ratio', s.payoff_ratio.toFixed(2), s.payoff_ratio >= 1 ? 'pos' : 'neg',
         `Average win ${fmt.usd(s.avg_win_usd)} against average loss ${fmt.usd(s.avg_loss_usd)}`),

    tile('Win rate', fmt.pct(s.win_rate), margin >= 0 ? 'pos' : 'neg',
         `Needs ${fmt.pct(s.breakeven_win_rate)} to break even — ` +
         `<b style="color:var(--${margin >= 0 ? 'long' : 'short'})">${margin >= 0 ? '+' : ''}${margin} points</b>`),

    tile('Expectancy', fmt.usd(s.expectancy_usd), s.expectancy_usd >= 0 ? 'pos' : 'neg',
         'Average outcome per trade, in dollars'),

    tile('Profit factor', s.profit_factor.toFixed(2), s.profit_factor >= 1 ? 'pos' : 'neg',
         s.profit_factor >= 1
           ? `$${s.profit_factor.toFixed(2)} won for every $1 lost`
           : `$1 won for every $${(1 / Math.max(s.profit_factor, 0.001)).toFixed(2)} lost`),

    tile('Scratch wins', fmt.int(s.scratch_wins), s.scratch_win_rate > 30 ? 'gold' : '',
         `${fmt.pct(s.scratch_win_rate)} of all trades won less than 0.5R — ` +
         'too small to pay for a loss'),

    tile('Worst loss', fmt.usd(s.largest_loss_usd), 'neg',
         `Max drawdown ${fmt.usd(-Math.abs(s.max_drawdown_usd), { sign: false })}`),

    tile('Expectancy in R', s.r_is_meaningful ? fmt.r(s.expectancy_r) : 'n/a',
         s.r_is_meaningful ? (s.expectancy_r >= 0 ? 'pos' : 'neg') : '',
         s.r_is_meaningful
           ? 'Risk per trade is consistent, so R is comparable'
           : `Not comparable — risk per trade varies by ${s.risk_cv}× across this set, ` +
             'because every trade used a fixed lot size regardless of stop distance'),
  ].join('');
}

function bar(label, value, max, colour, note) {
  const w = max > 0 ? Math.max(1.5, Math.abs(value) / max * 100) : 0;
  return `
    <div style="margin-bottom:11px">
      <div style="display:flex;gap:8px;align-items:baseline;font-size:12px;margin-bottom:4px">
        <span>${fmt.esc(label)}</span>
        <span class="mono" style="margin-left:auto;font-weight:700;color:${colour}">${fmt.usd(value)}</span>
      </div>
      <div style="height:7px;background:var(--surface-3);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${w}%;background:${colour};border-radius:3px"></div>
      </div>
      ${note ? `<div style="font-size:11px;color:var(--text-faint);margin-top:3px">${fmt.esc(note)}</div>` : ''}
    </div>`;
}

function renderSplit(s) {
  if (!s || s.empty) return;
  const n = s.total_trades || 1;
  const row = (label, count, colour) => `
    <div style="margin-bottom:11px">
      <div style="display:flex;gap:8px;align-items:baseline;font-size:12px;margin-bottom:4px">
        <span>${label}</span>
        <span class="mono" style="margin-left:auto;font-weight:700;color:${colour}">
          ${fmt.int(count)} · ${((count / n) * 100).toFixed(1)}%</span>
      </div>
      <div style="height:7px;background:var(--surface-3);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${(count / n) * 100}%;background:${colour};border-radius:3px"></div>
      </div>
    </div>`;

  $('split-body').innerHTML =
    row('Wins', s.wins, 'var(--long)') +
    row('Breakeven exits', s.breakevens, 'var(--info)') +
    row('Losses', s.losses, 'var(--short)') +
    `<div class="banner ${s.scratch_win_rate > 30 ? 'warn' : 'info'}" style="margin:12px 0 0">
       <svg aria-hidden="true"><use href="#i-${s.scratch_win_rate > 30 ? 'warn' : 'info'}"></use></svg>
       <div class="banner-body"><div class="banner-text">
         <b>${fmt.int(s.scratch_wins)}</b> of those
         ${fmt.int(s.wins)} wins (<b>${fmt.pct(s.scratch_win_rate)}</b> of all trades)
         made less than 0.5R. A win that small does not pay for a loss, which is how a
         high win rate and a negative balance live together.
       </div></div>
     </div>`;
}

function renderMoney(s) {
  if (!s || s.empty) return;
  const max = Math.max(s.gross_profit, s.gross_loss, 1);
  $('money-body').innerHTML =
    bar('Gross profit', s.gross_profit, max, 'var(--long)',
        `${s.wins} winning trades, ${fmt.usd(s.avg_win_usd)} average`) +
    bar('Gross loss', -s.gross_loss, max, 'var(--short)',
        `${s.losses} losing trades, ${fmt.usd(s.avg_loss_usd)} average`) +
    bar('Net', s.net_usd, max, s.net_usd >= 0 ? 'var(--long)' : 'var(--short)',
        `over ${s.period_months} months · ${s.trades_per_month} trades per month`);
}

function renderStale(all) {
  const stale = Object.entries(all.per_strategy || {})
    .filter(([, s]) => s.is_stale || s.fingerprint_unknown);
  if (!stale.length) { $('stale-banner').innerHTML = ''; return; }

  $('stale-banner').innerHTML = `
    <div class="banner warn">
      <svg aria-hidden="true"><use href="#i-warn"></use></svg>
      <div class="banner-body">
        <div class="banner-title">These results may not describe the strategy you are running</div>
        <div class="banner-text">
          ${stale.map(([k, s]) => `<b>${k === 'SWING_CORE' ? 'Core SMC' : 'Swing Pro'}</b>:
            ${s.fingerprint_unknown
              ? 'the file carries no engine fingerprint, so it predates fingerprinting'
              : `built by engine <code class="mono">${fmt.esc((s.data_fingerprints || []).join(', '))}</code>`}`)
            .join('; ')}.
          The engine now running is <code class="mono">${fmt.esc(all.engine_fingerprint)}</code>.
          Run <code class="mono">RUN_BACKTEST.bat</code> to regenerate them.
        </div>
      </div>
    </div>`;
}

/* ------------------------------------------------------------ trade log */

function renderLog(d) {
  const body = $('log-body');
  $('log-count').textContent = `${fmt.int(d.total)} trades`;
  $('pager-count').textContent = d.showing;
  page = d.page; pages = d.pages;
  $('btn-prev').disabled = page <= 1;
  $('btn-next').disabled = page >= pages;

  if (!d.trades.length) {
    body.innerHTML = `<tr><td colspan="14" style="text-align:center;color:var(--text-faint);padding:22px">
      No trades match these filters.</td></tr>`;
    return;
  }

  body.innerHTML = d.trades.map(t => `
    <tr>
      <td class="num">${t.id}</td>
      <td><span class="tag ${t.strategy === 'SWING_CORE' ? 'swing' : 'custom'}">${fmt.esc(t.strategy_label)}</span></td>
      <td><span class="badge ${t.type}">${t.type}</span></td>
      <td class="num" style="font-size:11px">${fmt.esc(t.entry_time)}</td>
      <td style="font-size:11px;color:var(--text-muted)">${fmt.esc(t.session_name || '—')}</td>
      <td style="font-size:11px">${fmt.esc((t.poi_type || '—').replace(/_/g, ' '))}</td>
      <td class="num">${fmt.price(t.entry_price)}</td>
      <td class="num" style="color:var(--short)">${fmt.price(t.sl)} <span style="color:var(--text-faint)">${t.risk_pips}p</span></td>
      <td class="num" style="color:var(--long)">${fmt.price(t.tp1)}</td>
      <td class="num">${fmt.price(t.exit_price)}</td>
      <td><span class="badge ${t.outcome}">${t.outcome}</span></td>
      <td class="num" style="color:var(--${t.r_multiple >= 0 ? 'long' : 'short'})">${fmt.r(t.r_multiple)}</td>
      <td class="num" style="font-weight:700;color:var(--${t.pnl_usd >= 0 ? 'long' : 'short'})">${fmt.usd(t.pnl_usd)}</td>
      <td style="font-size:11px;color:var(--text-muted)">${fmt.esc(t.exit_reason || '—')}</td>
    </tr>`).join('');
}

async function refresh(resetPage = false) {
  if (resetPage) page = 1;
  try {
    const d = await api.trades(q());
    renderLog(d);
    const s = $('f-outcome').value === 'ALL' && !$('f-search').value.trim()
      ? pickSummary() : d.filtered_summary;
    renderKpis(s); renderSplit(s); renderMoney(s);
  } catch { ui.toast('Could not load the trade log.', 'err'); }
}

function pickSummary() {
  if (!summaries) return null;
  const k = $('f-strategy').value;
  return k === 'ALL' ? summaries.combined : summaries.per_strategy[k];
}

async function loadSummaries() {
  summaries = await api.backtest();
  renderStale(summaries);
}

async function main() {
  await ui.boot({ timeframe: () => '3M' });

  try { await loadSummaries(); } catch { ui.toast('Could not load backtest summaries.', 'err'); }

  ['f-strategy', 'f-outcome'].forEach(id => $(id).addEventListener('change', () => refresh(true)));
  let t = null;
  $('f-search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => refresh(true), 260); });
  $('btn-prev').addEventListener('click', () => { page--; refresh(); });
  $('btn-next').addEventListener('click', () => { page++; refresh(); });
  $('btn-reload').addEventListener('click', async () => {
    await api.reloadHistory();
    await loadSummaries();
    refresh(true);
    ui.toast('Reloaded from disk.', 'ok');
  });

  refresh(true);
}

main();
