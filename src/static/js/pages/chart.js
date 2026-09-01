/* Chart page.
 *
 * Fixes carried over from the audit:
 *   M-03  Zone boxes are repositioned on pan and zoom, not only on the poll
 *         timer. The old code rebuilt them from innerHTML='' every 2.5s and
 *         was not subscribed to the chart at all, so the rectangles drifted
 *         away from the prices they marked whenever you moved the view.
 *   M-04  setData() once; update() for the forming bar thereafter.
 *   H-03  The Swing and Custom toggles do something. They previously wrote
 *         visibility.stratSwing / stratCustom, which nothing ever read.
 *         Trade markers are drawn — the old arrow-buy / arrow-sell SVG
 *         markers were constructed on every render and referenced by nothing.
 */

import * as ui from '../core/ui.js';
import * as api from '../core/api.js';
import * as fmt from '../core/fmt.js';
import * as voice from '../core/voice.js';
import * as alarms from '../core/alarms.js';
import { DrawingManager } from '../core/drawings.js';

const $ = id => document.getElementById(id);

let chart, series, tf = localStorage.getItem('twr.tf') || '3M';
let candles = [], zones = [], todaySignals = [], lastSignalKey = null;
let pdhLine = null, pdlLine = null, alarmLines = [];
let prevPrice = null, lastPositions = [];
let seenSignalKeys = new Set();
let firstLoad = true;
let selectedSignal = null;
let liveBid = null, liveAsk = null, accountBalance = 1000;
let chartLotSize = 0.01;
let activeSignalLine = null;
let lastChartData = null;

const defaultLayers = {
  OB_15M: true,
  OB_1H: false,
  OB_4H: false,
  OB_1D: false,
  // Missing keys are falsy, so drawZones skipped these entirely while the
  // checkbox above them looked available. A new layer has to be declared here
  // or it can never render, no matter what the toolbar says.
  SR: true,
  BLOCKED: false,
  FVG: true,
  SWING_CORE: true,
  SWING_PRO: true,
  ALARMS: true,
};

let savedLayers = {};
try { savedLayers = JSON.parse(localStorage.getItem('twr.layers') || '{}') || {}; } catch {}
const layers = Object.assign({}, defaultLayers, savedLayers);
// Clean up legacy keys if present
if ('SUPPORT' in layers || 'RESISTANCE' in layers) {
  if (savedLayers.OB_15M === undefined) layers.OB_15M = savedLayers.SUPPORT ?? true;
  delete layers.SUPPORT;
  delete layers.RESISTANCE;
  localStorage.setItem('twr.layers', JSON.stringify(layers));
}

const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------------------------------------------------------------- chart */

function initChart() {
  const el = $('chart');
  chart = LightweightCharts.createChart(el, {
    layout: { background: { color: 'transparent' }, textColor: css('--text-muted'), fontSize: 11,
              fontFamily: css('--mono') || 'monospace' },
    grid: { vertLines: { color: css('--border') }, horzLines: { color: css('--border') } },
    rightPriceScale: { borderColor: css('--border'), scaleMargins: { top: 0.08, bottom: 0.08 } },
    timeScale: { borderColor: css('--border'), timeVisible: true, secondsVisible: false, rightOffset: 6 },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    handleScale: true, handleScroll: true,
  });

  series = chart.addCandlestickSeries({
    upColor: css('--long'), downColor: css('--short'),
    borderUpColor: css('--long'), borderDownColor: css('--short'),
    wickUpColor: css('--long'), wickDownColor: css('--short'),
    priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
  });

  // Reposition overlays with the view, not with the poll timer.
  const repaint = () => { drawZones(); drawSignalBlocks(); };
  chart.timeScale().subscribeVisibleLogicalRangeChange(repaint);
  series.subscribeDataChanged?.(repaint);
  new ResizeObserver(() => {
    chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    repaint();
  }).observe(el);

  // Init Drawing Manager
  window.drawingManager = new DrawingManager(chart, series);
  
  // Wire up left toolbar
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tool = btn.dataset.tool;
      if (tool === 'clear') {
        window.drawingManager.clearAll();
        return;
      }
      document.querySelectorAll('.tool-btn').forEach(b => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      window.drawingManager.setTool(tool);
    });
  });
}

function drawZones() {
  const box = $('zones');
  if (!box || !chart || !series) return;
  box.replaceChildren();

  const w = box.clientWidth;
  const h = box.clientHeight;
  const ts = chart.timeScale();

  for (const z of zones) {
    if (!layers[z.category]) continue;

    const x1 = ts.timeToCoordinate(z.start_time);
    const x2 = ts.timeToCoordinate(z.end_time);
    let yT = series.priceToCoordinate(z.top);
    let yB = series.priceToCoordinate(z.bottom);

    if (yT == null && yB == null) continue;
    if (yT == null) yT = yB < 0 ? -200 : h + 200;
    if (yB == null) yB = yT < 0 ? -200 : h + 200;

    const left = Math.max(0, x1 ?? 0);
    const right = Math.min(w, x2 ?? w);
    if (right - left < 4) continue;

    const topPx = Math.min(yT, yB);
    const heightPx = Math.max(6, Math.abs(yB - yT));

    const el = document.createElement('div');
    el.className = 'zone-box' + (z.mitigated ? ' mitigated' : '');
    el.style.cssText = `left:${left}px;top:${topPx}px;width:${right - left}px;` +
                       `height:${heightPx}px;` +
                       `background:${z.color};border-color:${z.border_color};color:${z.border_color}`;

    const tag = document.createElement('span');
    tag.className = 'zone-tag';
    tag.textContent = z.retests ? `${z.name} · ${z.retests}/${z.max_retests}` : z.name;
    el.appendChild(tag);

    if (z.mid_ce != null) {
      const yC = series.priceToCoordinate(z.mid_ce);
      if (yC != null && yC >= topPx && yC <= topPx + heightPx) {
        const ce = document.createElement('div');
        ce.className = 'zone-ce';
        ce.style.top = `${yC - topPx}px`;
        el.appendChild(ce);
      }
    }
    box.appendChild(el);
  }
}

/* ------------------------------------------------- signal blocks -------- */

const BLOCK_GAP = 48;        // clearance between the block and the candle wick
const BLOCK_PAD = 6;         // minimum gap between two blocks

/**
 * Draw one rounded block per signal, offset clear of the candles, with a
 * leader line back to the entry price and collision avoidance so two signals
 * minutes apart never overlap.
 */
function drawSignalBlocks() {
  const box = $('signal-blocks');
  if (!box || !chart || !series) return;
  box.replaceChildren();

  const ts = chart.timeScale();
  const W = box.clientWidth, H = box.clientHeight;
  const placed = [];                       // rects already on screen

  // A signal the risk layer would have refused is a candidate, not a trade.
  // Drawing it identically to a real one is what makes the chart look like a
  // wall of losses: the session cap and the circuit breaker would have stopped
  // most of a bad run before it happened. Blocked signals are hidden by
  // default and drawn ghosted when the Blocked layer is switched on.
  const visible = todaySignals.filter(s =>
    layers[s.strategy] && (s.tradeable !== false || layers.BLOCKED));

  for (const s of visible) {
    const x = ts.timeToCoordinate(s.timestamp);
    const yEntry = series.priceToCoordinate(s.entry_price);
    if (x == null || yEntry == null || x < -60 || x > W + 60) continue;

    const isBuy = s.type === 'BUY';
    const bar = candles.find(c => c.time === s.timestamp);
    // Anchor to the candle extreme so the block never sits on the wick.
    const anchorPrice = bar ? (isBuy ? bar.low : bar.high) : s.entry_price;
    const yAnchor = series.priceToCoordinate(anchorPrice) ?? yEntry;

    const el = document.createElement('div');
    el.className = `sig-block ${isBuy ? 'buy' : 'sell'}${s.is_live ? '' : ' done'}` + (s.tradeable === false ? ' blocked' : '');
    el.style.cursor = 'pointer';
    el.onclick = (e) => {
      e.stopPropagation();
      selectSignal(s);
    };
    el.innerHTML = `
      <div class="sig-dir">${s.type}</div>
      <div class="sig-line">TP <b>${fmt.price(s.tp1)}</b></div>
      <div class="sig-line">SL <b>${fmt.price(s.sl)}</b></div>
      <div class="sig-status${s.is_live ? ' live' : ''}">${fmt.esc(s.status_label || 'IN PROGRESS')}</div>`;
    if (s.banked_pct) el.classList.add('banked');
    el.title = (s.tradeable === false
                 ? `NOT TAKEN — ${s.blocked_reason}\n\n`
                 : `Click to load & execute this ${s.type} signal\n`) +
               `Entry ${fmt.price(s.entry_price)} · TP1 ${fmt.price(s.tp1)} · TP2 ${fmt.price(s.tp2)} · SL ${fmt.price(s.sl)}\n` +
               `Risk ${s.risk_pips} pips · peak +${s.peak_pips ?? 0} pips · ${s.time_str}`;

    // Measure off-screen, then place.
    el.style.visibility = 'hidden';
    box.appendChild(el);
    const w = el.offsetWidth, h = el.offsetHeight;

    const overlaps = t => placed.some(p =>
      !(x + w / 2 + BLOCK_PAD < p.l || x - w / 2 - BLOCK_PAD > p.r ||
        t + h + BLOCK_PAD < p.t || t - BLOCK_PAD > p.b));
    const fits = t => t >= 2 && t + h <= H - 2;

    // Walk outward from the candle on the preferred side first — below for a
    // buy, above for a sell — then try the other side. Clamping into bounds
    // instead of switching sides is what piles blocks on top of each other
    // when the preferred side runs out of room near the edge of the pane.
    const lane = (dir, n) => (dir > 0 ? yAnchor + BLOCK_GAP : yAnchor - BLOCK_GAP - h)
                             + dir * n * (h + BLOCK_PAD);
    const preferred = isBuy ? 1 : -1;

    let top = null;
    for (const dir of [preferred, -preferred]) {
      for (let n = 0; n < 14; n++) {
        const t = lane(dir, n);
        if (!fits(t)) break;
        if (!overlaps(t)) { top = t; break; }
      }
      if (top !== null) break;
    }

    // Last resort: the pane is genuinely full. Stack from the preferred edge
    // so the newest signal stays readable rather than landing under another.
    if (top === null) {
      top = preferred > 0 ? H - h - 2 : 2;
      let n = 0;
      while (overlaps(top) && n++ < 14) {
        top -= preferred * (h + BLOCK_PAD);
        if (!fits(top)) { top = Math.max(2, Math.min(H - h - 2, top)); break; }
      }
    }

    el.style.left = `${x}px`;
    el.style.top = `${top}px`;
    el.style.visibility = '';
    placed.push({ l: x - w / 2, r: x + w / 2, t: top, b: top + h });

    // Leader line and entry dot.
    const lineTop = isBuy ? yAnchor : top + h;
    const lineH = isBuy ? (top - yAnchor) : (yAnchor - (top + h));
    if (lineH > 2) {
      const line = document.createElement('div');
      line.className = 'sig-leader';
      line.style.cssText = `left:${x}px;top:${lineTop}px;height:${lineH}px`;
      box.appendChild(line);
    }
    const dot = document.createElement('div');
    dot.className = `sig-dot ${isBuy ? 'buy' : 'sell'}`;
    dot.style.cssText = `left:${x}px;top:${yEntry}px`;
    box.appendChild(dot);
  }
}

/* --------------------------------------------------- new-signal flash --- */

let flashTimer = null;

function flashNewSignal(s) {
  const el = $('sig-flash');
  if (!el) return;
  el.className = `sig-flash ${s.type === 'BUY' ? 'buy' : 'sell'}`;
  el.innerHTML = `${s.type === 'BUY' ? '▲' : '▼'} NEW ${s.type} ` +
                 `<span class="px">${fmt.price(s.entry_price)}</span>`;
  el.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

/* The forming candle used to redraw only on the 3s chart poll, so the price
   visibly lagged the ticker sitting right above it. The 1s status poll already
   carries the live bid — this paints it straight onto the last bar, and rolls
   a new bar when the current one closes. */
const TF_SECONDS = { '1M': 60, '3M': 180, '5M': 300, '15M': 900, '1H': 3600 };

function paintLiveTick(bid) {
  if (!series || !candles.length || bid == null) return;
  const span = TF_SECONDS[tf] || 180;
  const nowBar = Math.floor(Date.now() / 1000 / span) * span;
  let last = candles[candles.length - 1];

  if (nowBar > last.time) {
    // A new bar opened. Seed it from the tick; the next chart poll replaces it
    // with the broker's own open/high/low.
    last = { time: nowBar, open: bid, high: bid, low: bid, close: bid, volume: 0 };
    candles.push(last);
  } else if (nowBar === last.time) {
    last.close = bid;
    if (bid > last.high) last.high = bid;
    if (bid < last.low) last.low = bid;
  } else {
    return;                       // stale tick, ignore
  }
  try { series.update(last); } catch { /* next poll reconciles */ }
}

function drawMarkers() {
  if (!series) return;
  const marks = todaySignals
    .filter(s => layers[s.strategy])
    .map(s => ({
      time: s.timestamp,
      position: s.type === 'BUY' ? 'belowBar' : 'aboveBar',
      color: s.strategy === 'SWING_CORE' ? css('--gold') : css('--violet'),
      shape: s.type === 'BUY' ? 'arrowUp' : 'arrowDown',
      // No text. The signal block already carries direction, targets and
      // status; marker labels only collided with it and with each other.
    }));
  series.setMarkers(marks);
}

function syncAlarmLines() {
  alarmLines.forEach(l => { try { series.removePriceLine(l); } catch {} });
  alarmLines = [];
  if (!layers.ALARMS) return;
  for (const a of alarms.load()) {
    if (a.status !== 'ACTIVE' || a.price == null) continue;
    alarmLines.push(series.createPriceLine({
      price: a.price, color: css('--info'), lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true, title: a.label || 'Alarm',
    }));
  }
}

/* ------------------------------------------------------------ rendering */

function calculateSuggestedLots(balance = 1000, riskUsd = 4.0) {
  const maxRiskDollar = (balance * (window.DESK?.maxRiskPercent || 1.0)) / 100;
  const lotsByRisk = riskUsd > 0 ? maxRiskDollar / (riskUsd * 100) : 0.01;
  let tierLots = 0.01;
  if (balance >= 10000) tierLots = 0.20;
  else if (balance >= 5000) tierLots = 0.10;
  else if (balance >= 1000) tierLots = 0.07;
  else if (balance >= 500) tierLots = 0.05;
  else if (balance >= 200) tierLots = 0.02;

  let lots = Math.min(lotsByRisk, tierLots);
  lots = Math.max(0.01, Math.min(window.DESK?.maxLots || 1.0, Math.floor(lots * 100) / 100));
  return lots;
}

function selectSignal(s) {
  if (!s) return;
  selectedSignal = s;
  const side = $('side');
  if (side) side.hidden = false;
  $('btn-panel')?.setAttribute('aria-pressed', 'true');
  $('layout')?.classList.remove('solo');

  // Scroll to setup card
  $('signal-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Draw temporary entry line on chart
  if (activeSignalLine) {
    try { series.removePriceLine(activeSignalLine); } catch {}
    activeSignalLine = null;
  }
  if (series && s.entry_price) {
    activeSignalLine = series.createPriceLine({
      price: s.entry_price,
      color: s.type === 'BUY' ? css('--long') : css('--short'),
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Solid,
      axisLabelVisible: true,
      title: `Selected ${s.type} ${fmt.price(s.entry_price)}`,
    });
  }

  renderSignal(lastChartData?.latest_signal, lastChartData?.rejections);
  renderToday(todaySignals);
}

function clearSelectedSignal() {
  selectedSignal = null;
  if (activeSignalLine) {
    try { series.removePriceLine(activeSignalLine); } catch {}
    activeSignalLine = null;
  }
  renderSignal(lastChartData?.latest_signal, lastChartData?.rejections);
  renderToday(todaySignals);
}

async function executeSignalFromChart(sig, lots) {
  if (!sig) return;
  lots = Math.min(Math.max(0.01, Number(lots) || 0.01), window.DESK?.maxLots || 1.0);

  const riskUsd = (sig.risk_usd || Math.abs(sig.entry_price - sig.sl) || 4.0) * 100 * lots;
  const rewardUsd = (Math.abs((sig.tp1 || sig.entry_price) - sig.entry_price) || 6.0) * 100 * lots;

  const ok = await ui.confirmAction({
    title: `⚡ Execute Live ${sig.type} Order?`,
    lines: [
      ['Direction', sig.type],
      ['Symbol', 'XAUUSD (Gold)'],
      ['Lots', lots.toFixed(2) + (lots > 1.0 ? ' ⚠️ Max 1.0' : '')],
      ['Entry Price', fmt.price(sig.entry_price)],
      ['Stop Loss', fmt.price(sig.sl) + ` (${sig.risk_pips} pips)`],
      ['Take Profit 1', fmt.price(sig.tp1)],
      ['Est. Risk ($)', fmt.usd(-riskUsd, { sign: false })],
      ['Est. Reward ($)', fmt.usd(rewardUsd)],
    ],
    confirmText: `Send ${sig.type} ${lots.toFixed(2)} lots`,
    danger: sig.type === 'SELL',
  });

  if (!ok) return;

  const btn = $('btn-chart-exec');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Sending order to MT5…';
  }

  try {
    const res = await api.execute({
      type: sig.type,
      lots: lots,
      sl: sig.sl || 0,
      tp: sig.tp1 || 0,
      comment: `Swing ${sig.strategy === 'SWING_PRO' ? 'Custom' : 'Core'}`,
    });

    if (res.success) {
      voice.say('ORDER_PLACED');
      ui.toast(`🎉 Order executed! Ticket #${res.ticket}, ${res.volume} lots at ${fmt.price(res.price)}`, 'ok', 9000);
      refreshChart();
    } else {
      ui.toast(res.error || 'The broker rejected the order.', 'err', 10000);
    }
  } catch (e) {
    if (e.status === 409) {
      ui.toast(e.data?.error || 'Blocked by session discipline.', 'warn', 10000);
    } else {
      ui.toast(e.message || 'Execution failed. Check MT5 connection.', 'err', 10000);
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `⚡ EXECUTE ${sig.type} ${chartLotSize.toFixed(2)} LOTS`;
    }
  }
}

async function executeMarketTrade(type, lots, slPips = 40, tpPips = 60) {
  const isBuy = type.toUpperCase() === 'BUY';
  const px = isBuy ? (liveAsk || liveBid) : liveBid;
  if (!px) {
    ui.toast('Waiting for live price from MT5...', 'warn');
    return;
  }
  lots = Math.min(Math.max(0.01, Number(lots) || 0.01), window.DESK?.maxLots || 1.0);
  const sl = isBuy ? px - (slPips * 0.10) : px + (slPips * 0.10);
  const tp = isBuy ? px + (tpPips * 0.10) : px - (tpPips * 0.10);

  const ok = await ui.confirmAction({
    title: `⚡ Execute Live Market ${type}?`,
    lines: [
      ['Direction', type],
      ['Symbol', 'XAUUSD (Gold)'],
      ['Lots', lots.toFixed(2)],
      ['Est. Entry', fmt.price(px)],
      ['Stop Loss', fmt.price(sl) + ` (${slPips} pips)`],
      ['Take Profit', fmt.price(tp) + ` (${tpPips} pips)`],
    ],
    confirmText: `Send Market ${type}`,
    danger: type === 'SELL',
  });

  if (!ok) return;

  try {
    const res = await api.execute({
      type: type,
      lots: lots,
      sl: sl,
      tp: tp,
      comment: 'Chart Market Order',
    });

    if (res.success) {
      voice.say('ORDER_PLACED');
      ui.toast(`🎉 Market order executed! Ticket #${res.ticket}, ${res.volume} lots at ${fmt.price(res.price)}`, 'ok', 9000);
      refreshChart();
    } else {
      ui.toast(res.error || 'The broker rejected the order.', 'err', 10000);
    }
  } catch (e) {
    ui.toast(e.message || 'Execution failed.', 'err', 10000);
  }
}

function renderSignal(sig, rejections) {
  const body = $('signal-body'), card = $('signal-card'), t = $('sig-time');
  const activeSig = selectedSignal || sig;

  if (!activeSig) {
    card.classList.remove('signal-live');
    t.textContent = '—';
    const rows = (rejections || []).map(r => `
      <div class="reject">
        <div class="reject-k">${r.strategy === 'SWING_CORE' ? 'Swing Core' : 'Swing Pro'} — no entry</div>
        <div class="reject-v">${fmt.esc(r.reason)}</div>
      </div>`).join('');

    const safeLot = calculateSuggestedLots(accountBalance, 4.0);

    body.innerHTML = `
      <div class="empty">
        <svg aria-hidden="true"><use href="#i-empty"></use></svg>
        <div>No setup on the last closed bar.</div>
      </div>
      ${rows}

      <div class="quick-trade-panel" style="margin-top:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)">⚡ Quick Market Order</span>
          <span class="mono" style="font-size:11px;color:var(--text-faint)">Bid: ${fmt.price(liveBid)}</span>
        </div>
        <div class="lot-control" style="margin-bottom:8px">
          <button class="lot-stepper-btn" id="qm-lot-minus" type="button">−</button>
          <input type="number" step="0.01" min="0.01" max="${window.DESK?.maxLots || 1.0}" id="qm-lot" class="lot-input num" value="${safeLot.toFixed(2)}">
          <button class="lot-stepper-btn" id="qm-lot-plus" type="button">+</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button class="btn btn-buy btn-block" id="btn-qm-buy" type="button" style="padding:10px 8px;font-weight:700">
            ▲ BUY NOW
          </button>
          <button class="btn btn-sell btn-block" id="btn-qm-sell" type="button" style="padding:10px 8px;font-weight:700">
            ▼ SELL NOW
          </button>
        </div>
      </div>`;

    const qmLotInput = $('qm-lot');
    if (qmLotInput) {
      $('qm-lot-minus')?.addEventListener('click', () => {
        let v = parseFloat(qmLotInput.value) || 0.01;
        v = Math.max(0.01, Math.round((v - 0.01) * 100) / 100);
        qmLotInput.value = v.toFixed(2);
      });
      $('qm-lot-plus')?.addEventListener('click', () => {
        let v = parseFloat(qmLotInput.value) || 0.01;
        v = Math.min(window.DESK?.maxLots || 1.0, Math.round((v + 0.01) * 100) / 100);
        qmLotInput.value = v.toFixed(2);
      });
      $('btn-qm-buy')?.addEventListener('click', () => {
        const lots = parseFloat(qmLotInput.value) || 0.01;
        executeMarketTrade('BUY', lots, 40, 60);
      });
      $('btn-qm-sell')?.addEventListener('click', () => {
        const lots = parseFloat(qmLotInput.value) || 0.01;
        executeMarketTrade('SELL', lots, 40, 60);
      });
    }
    return;
  }

  card.classList.add('signal-live');
  t.textContent = activeSig.time_str || '—';
  const isSwing = activeSig.strategy === 'SWING_CORE';
  const suggestedLots = calculateSuggestedLots(accountBalance, activeSig.risk_usd || 4.0);
  chartLotSize = suggestedLots;

  const isManualSelection = selectedSignal !== null;
  const isBuy = activeSig.type === 'BUY';
  const riskUsdEst = (activeSig.risk_usd || Math.abs(activeSig.entry_price - activeSig.sl) || 4.0) * 100 * chartLotSize;
  const rewardUsdEst = (Math.abs((activeSig.tp1 || activeSig.entry_price) - activeSig.entry_price) || 6.0) * 100 * chartLotSize;

  body.innerHTML = `
    ${isManualSelection ? `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding:4px 8px;background:var(--surface-2);border-radius:4px;border:1px solid var(--gold)">
        <span style="font-size:11px;color:var(--gold);font-weight:700">★ Viewing ${activeSig.type} at ${activeSig.time_str || activeSig.time}</span>
        <button class="btn btn-sm" id="btn-reset-sig" type="button" style="margin-left:auto;padding:2px 8px;font-size:10.5px">Reset</button>
      </div>` : ''}

    <div class="sig-head">
      <span class="dir-badge ${activeSig.type}">${activeSig.type}</span>
      <span class="tag ${isSwing ? 'swing' : 'custom'}">${isSwing ? 'Swing Core' : 'Swing Pro'}</span>
      <span class="tag">${fmt.esc((activeSig.poi_type || '').replace(/_/g, ' '))}</span>
      ${activeSig.confluence_score != null ? `<span class="tag">${activeSig.confluence_score}/100</span>` : ''}
    </div>

    <div class="levels">
      <div class="level entry"><span class="level-k">Entry</span>
        <span class="level-v">${fmt.price(activeSig.entry_price)}</span></div>
      <div class="level sl"><span class="level-k">Stop</span>
        <span class="level-v">${fmt.price(activeSig.sl)}</span>
        <span class="level-n">${activeSig.risk_pips} pips · $${activeSig.risk_usd}</span></div>
      <div class="level tp"><span class="level-k">TP1 · ${activeSig.tp1_close_pct}%</span>
        <span class="level-v">${fmt.price(activeSig.tp1)}</span>
        <span class="level-n">${activeSig.tp1_rr}R · ${fmt.esc(activeSig.tp1_basis || '')}</span></div>
      <div class="level tp"><span class="level-k">TP2 · runner</span>
        <span class="level-v">${fmt.price(activeSig.tp2)}</span>
        <span class="level-n">${activeSig.tp2_rr}R · ${fmt.esc(activeSig.tp2_basis || '')}</span></div>
      <div class="level ctc" style="grid-column:1/-1">
        <span class="level-k">Cost-to-Cost at +${activeSig.ctc_trigger_pips} pips</span>
        <span class="level-v">${fmt.price(activeSig.ctc_sl_price)}</span>
        <span class="level-n">breakeven plus spread — risk-free</span></div>
    </div>

    <div class="quick-exec-box">
      <div class="quick-exec-hd">
        <span class="quick-exec-title">⚡ Trade Execution</span>
        <span class="quick-exec-risk-prev" id="risk-reward-prev">Risk: -$${riskUsdEst.toFixed(1)} · Reward: +$${rewardUsdEst.toFixed(1)}</span>
      </div>

      <div class="lot-control">
        <button class="lot-stepper-btn" id="sig-lot-minus" type="button">−</button>
        <input type="number" step="0.01" min="0.01" max="${window.DESK?.maxLots || 1.0}" id="sig-lot-input" class="lot-input num" value="${chartLotSize.toFixed(2)}">
        <button class="lot-stepper-btn" id="sig-lot-plus" type="button">+</button>
      </div>

      <div class="lot-chips">
        <button type="button" class="lot-chip ${chartLotSize === 0.01 ? 'active' : ''}" data-lot="0.01">0.01</button>
        <button type="button" class="lot-chip ${chartLotSize === 0.05 ? 'active' : ''}" data-lot="0.05">0.05</button>
        <button type="button" class="lot-chip ${chartLotSize === 0.10 ? 'active' : ''}" data-lot="0.10">0.10</button>
        <button type="button" class="lot-chip ${chartLotSize === 0.20 ? 'active' : ''}" data-lot="0.20">0.20</button>
        <button type="button" class="lot-chip ${chartLotSize === (window.DESK?.maxLots || 1.0) ? 'active' : ''}" data-lot="${window.DESK?.maxLots || 1.0}">MAX (${window.DESK?.maxLots || 1.0})</button>
      </div>

      <button class="btn btn-xl btn-block ${isBuy ? 'btn-buy' : 'btn-sell'} btn-exec-pulse" id="btn-chart-exec" type="button">
        ⚡ EXECUTE ${activeSig.type} ${chartLotSize.toFixed(2)} LOTS
      </button>

      <a href="/desk?from=signal" style="display:block;text-align:center;font-size:11px;margin-top:8px;color:var(--text-muted);text-decoration:none">
        Open full position sizing desk →
      </a>
    </div>

    <ul class="reasons" style="margin-top:12px">
      ${(activeSig.reasons || []).map(r => `<li${r.startsWith('  +') ? ' class="score"' : ''}>${fmt.esc(r)}</li>`).join('')}
    </ul>`;

  // Store for the desk page.
  sessionStorage.setItem('twr.signal', JSON.stringify(activeSig));

  const lotInput = $('sig-lot-input');
  const execBtn = $('btn-chart-exec');
  const riskPrev = $('risk-reward-prev');

  const updateLotDisplay = (newLot) => {
    chartLotSize = Math.max(0.01, Math.min(window.DESK?.maxLots || 1.0, Math.round(newLot * 100) / 100));
    if (lotInput) lotInput.value = chartLotSize.toFixed(2);
    if (execBtn) execBtn.innerHTML = `⚡ EXECUTE ${activeSig.type} ${chartLotSize.toFixed(2)} LOTS`;
    const rUsd = (activeSig.risk_usd || Math.abs(activeSig.entry_price - activeSig.sl) || 4.0) * 100 * chartLotSize;
    const rwUsd = (Math.abs((activeSig.tp1 || activeSig.entry_price) - activeSig.entry_price) || 6.0) * 100 * chartLotSize;
    if (riskPrev) riskPrev.textContent = `Risk: -$${rUsd.toFixed(1)} · Reward: +$${rwUsd.toFixed(1)}`;
    body.querySelectorAll('.lot-chip').forEach(c => {
      c.classList.toggle('active', parseFloat(c.dataset.lot) === chartLotSize);
    });
  };

  $('sig-lot-minus')?.addEventListener('click', () => updateLotDisplay(chartLotSize - 0.01));
  $('sig-lot-plus')?.addEventListener('click', () => updateLotDisplay(chartLotSize + 0.01));
  lotInput?.addEventListener('input', e => updateLotDisplay(parseFloat(e.target.value) || 0.01));
  body.querySelectorAll('.lot-chip').forEach(c => {
    c.addEventListener('click', () => updateLotDisplay(parseFloat(c.dataset.lot) || 0.01));
  });

  execBtn?.addEventListener('click', () => executeSignalFromChart(activeSig, chartLotSize));
  $('btn-reset-sig')?.addEventListener('click', () => clearSelectedSignal());

  const key = `${activeSig.strategy}:${activeSig.timestamp}`;
  if (!isManualSelection && key !== lastSignalKey) {
    lastSignalKey = key;
    ui.toast(`${activeSig.type} setup — ${activeSig.poi_type?.replace(/_/g, ' ')} at ${fmt.price(activeSig.entry_price)}`,
             activeSig.type === 'BUY' ? 'ok' : 'err', 9000);
    api.notifyTray({ message: `${activeSig.type} ${activeSig.symbol} at ${fmt.price(activeSig.entry_price)}` }).catch(() => {});
  }
}

function renderMatrix(m) {
  const body = $('matrix-body'), tag = $('confluence-tag');
  if (!m || !m.indicators) return;
  tag.textContent = `${m.bullish_confluence_pct}% ${m.confluence_label.split(' ')[0].toLowerCase()}`;

  body.innerHTML = m.indicators.map(i => {
    const p = i.direction_pct;
    const magnitude = i.kind === 'magnitude';
    const style = magnitude
      ? `left:0;width:${p}%`
      : (p >= 50 ? `left:50%;width:${p - 50}%` : `left:${p}%;width:${50 - p}%`);
    const cls = magnitude ? 'mag' : (p >= 50 ? 'bull' : 'bear');
    return `
      <div class="meter">
        <div class="meter-hd">
          <span class="meter-name">${fmt.esc(i.name)}</span>
          <span class="meter-val mono" style="color:var(--${magnitude ? 'info' : p >= 50 ? 'long' : 'short'})">${fmt.esc(i.val)}</span>
        </div>
        <div class="meter-track">${magnitude ? '' : '<div class="meter-mid"></div>'}
          <div class="meter-fill ${cls}" style="${style}"></div></div>
        <div class="meter-detail">${fmt.esc(i.detail)}</div>
      </div>`;
  }).join('');
}

function signalRow(s, showDate) {
  const when = showDate ? String(s.time).slice(5, 16) : (s.time_str || String(s.time).slice(11, 16));
  const isSelected = selectedSignal && selectedSignal.timestamp === s.timestamp && selectedSignal.strategy === s.strategy;
  return `
    <div class="sig-row-item ${isSelected ? 'selected' : ''}" data-ts="${s.timestamp}" data-strat="${s.strategy}">
      <span class="badge ${s.type}">${s.type}</span>
      <span class="mono" style="font-size:11px;color:var(--text-faint);min-width:${showDate ? 72 : 34}px">${fmt.esc(when)}</span>
      <span class="mono" style="font-size:12px">${fmt.price(s.entry_price)}</span>
      <span class="mono" style="font-size:10.5px;color:var(--text-faint)">${s.risk_pips}p</span>
      <span class="tag ${s.strategy === 'SWING_CORE' ? 'swing' : 'custom'}" style="margin-left:auto">
        ${s.strategy === 'SWING_CORE' ? 'Swing' : 'Custom'}</span>
      <span class="exec-hint">Trade →</span>
    </div>`;
}

function renderToday(list) {
  if (historyRange !== 0) return;
  const body = $('today-body');
  $('today-count').textContent = list.length;
  if (!list.length) {
    body.innerHTML = `<div class="empty">
      <div>No setups yet today.</div>
      <div style="font-size:11px;margin-top:6px;color:var(--text-faint)">
        Switch to 3d or 7d to see the engine firing on recent history.</div>
    </div>`;
    return;
  }
  body.innerHTML = list.slice().reverse().map(s => signalRow(s, false)).join('');

  // Wire up clickable rows
  body.querySelectorAll('.sig-row-item').forEach(row => {
    row.addEventListener('click', () => {
      const ts = Number(row.dataset.ts);
      const strat = row.dataset.strat;
      const hit = list.find(x => x.timestamp === ts && x.strategy === strat);
      if (hit) selectSignal(hit);
    });
  });
}

/* --------------------------------------------------- history scan ------- */

let historyRange = 0;

function scanProgress(show, pct, msg) {
  const box = $('scan-progress');
  if (!box) return;
  box.hidden = !show;
  if (!show) return;
  $('scan-pct').textContent = `${Math.round(pct)}%`;
  $('scan-bar').style.width = `${Math.max(2, pct)}%`;
  $('scan-msg').textContent = msg || '';
}

function renderScanSummary(d) {
  const box = $('scan-summary');
  if (!box) return;
  const cards = Object.entries(d.strategies).map(([k, v]) => {
    if (!v.signal_count) {
      return `<div class="banner warn" style="margin:0 0 8px">
        <svg aria-hidden="true"><use href="#i-warn"></use></svg>
        <div class="banner-body"><div class="banner-title">${fmt.esc(v.label)} — no signals</div>
        <div class="banner-text">${v.rejections.slice(0, 3).map(([r, n]) =>
          `${fmt.int(n)} × ${fmt.esc(r)}`).join('<br>')}</div></div></div>`;
    }
    const good = v.is_profitable;
    return `
      <div class="banner ${good ? 'ok' : 'danger'}" style="margin:0 0 8px">
        <svg aria-hidden="true"><use href="#i-${good ? 'check' : 'warn'}"></use></svg>
        <div class="banner-body">
          <div class="banner-title">${fmt.esc(v.label)} — ${fmt.r(v.net_r)} over ${d.days} days</div>
          <div class="banner-text">
            <b>${fmt.int(v.signal_count)}</b> signals (${v.per_week}/week, ${v.active_days} active days) ·
            win rate <b>${fmt.pct(v.win_rate)}</b> against <b>${fmt.pct(v.breakeven_win_rate)}</b> needed ·
            payoff <b>${v.payoff_ratio}</b> · expectancy <b>${fmt.r(v.expectancy_r)}</b>/signal ·
            worst drawdown <b>${fmt.r(-v.max_drawdown_r)}</b>
            <div style="margin-top:5px;font-size:11px;color:var(--text-faint)">
              At 1% risk per signal that is about
              <b style="color:var(--${good ? 'long' : 'short'})">${good ? '+' : '−'}${Math.abs(v.net_r).toFixed(0)}%</b>
              of the account before costs and slippage.
              ${Object.entries(v.outcome_mix).map(([m, n]) => `${m} ${n}`).join(' · ')}
            </div>
          </div>
        </div>
      </div>`;
  }).join('');

  const caveats = [];
  if (d.timeframe_requested && d.timeframe !== d.timeframe_requested) {
    caveats.push(`Entries timed on <b>${fmt.esc(d.timeframe)}</b> — this broker serves no
      ${fmt.esc(d.timeframe_requested)} bars.`);
  }
  if (d.history_short_by > 3) {
    caveats.push(`Your account only holds <b>${fmt.int(d.days_covered)} days</b> of that
      timeframe, not ${fmt.int(d.days)} — the figures above cover the shorter window.`);
  }

  box.innerHTML = `<div style="padding:10px 12px 2px">${cards}
    ${caveats.length ? `<div class="banner warn" style="margin:0 0 8px">
      <svg aria-hidden="true"><use href="#i-warn"></use></svg>
      <div class="banner-body"><div class="banner-text">${caveats.join('<br>')}</div></div>
    </div>` : ''}
    <div style="font-size:10.5px;color:var(--text-faint);padding-bottom:6px">
      R multiples model the playbook's own management — 75% banked at TP1, the runner
      to TP2 with the stop at breakeven. Scanned ${fmt.int(d.bars_available)} bars in ${d.elapsed_sec}s.
    </div></div>`;
}

async function runHistoryScan(days) {
  const body = $('today-body'), note = $('scan-note');
  $('scan-summary').innerHTML = '';
  body.innerHTML = `<div class="empty"><div>Replaying ${days} days…</div></div>`;
  scanProgress(true, 3, 'Requesting history');

  let d;
  try {
    const first = await api.get(`/api/scan_history?days=${days}&timeframe=${tf}`);
    if (first.async) {
      d = await new Promise((resolve, reject) => {
        const iv = setInterval(async () => {
          try {
            const st = await api.get(`/api/scan_status?job=${first.job_id}`);
            scanProgress(true, st.progress || 0, st.message);
            if (st.status === 'done') { clearInterval(iv); resolve(st.result); }
            if (st.status === 'error') { clearInterval(iv); reject(new Error(st.error)); }
          } catch (e) { clearInterval(iv); reject(e); }
        }, 900);
      });
    } else {
      d = first;
    }
  } catch (e) {
    scanProgress(false);
    body.innerHTML = `<div class="empty"><div>${fmt.esc(e.message || 'Scan failed')}</div>
      <div style="font-size:11px;margin-top:6px;color:var(--text-faint)">
        MetaTrader 5 must be running and logged in, with history for this range.</div></div>`;
    return;
  }
  scanProgress(false);

  const all = [];
  for (const [k, v] of Object.entries(d.strategies)) {
    v.signals.forEach(s => all.push({ ...s, strategy: k }));
  }
  all.sort((a, b) => a.timestamp - b.timestamp);
  $('today-count').textContent = all.length;

  note.innerHTML = Object.entries(d.strategies)
    .map(([, v]) => `${v.label}: <b>${v.signal_count}</b> (${v.per_week}/wk)`).join(' · ');

  renderScanSummary(d);

  if (!all.length) {
    body.innerHTML = `<div style="padding:4px 2px">${Object.entries(d.strategies).map(([, v]) => `
      <div style="margin-top:10px">
        <div style="font-size:11.5px;font-weight:700;margin-bottom:4px">${fmt.esc(v.label)} — why not</div>
        ${v.rejections.map(([r, n]) => `
          <div style="display:flex;gap:8px;font-size:11px;color:var(--text-muted);padding:2px 0">
            <span class="mono" style="min-width:52px;text-align:right;color:var(--text-faint)">${fmt.int(n)}</span>
            <span>${fmt.esc(r)}</span></div>`).join('')}
      </div>`).join('')}</div>`;
    return;
  }

  body.innerHTML = all.reverse().slice(0, 400).map(s => signalRow(s, true)).join('');

  body.querySelectorAll('.sig-row-item').forEach(row => {
    row.addEventListener('click', () => {
      const ts = Number(row.dataset.ts);
      const strat = row.dataset.strat;
      const hit = all.find(x => x.timestamp === ts && x.strategy === strat);
      if (hit) selectSignal(hit);
    });
  });
}

function initRangeButtons() {
  document.querySelectorAll('[data-range]').forEach(b => {
    b.addEventListener('click', () => {
      historyRange = Number(b.dataset.range);
      document.querySelectorAll('[data-range]').forEach(x =>
        x.setAttribute('aria-pressed', String(Number(x.dataset.range) === historyRange)));
      if (historyRange === 0) {
        chartDays = null;
        $('scan-note').innerHTML =
          "Swing's session is 00:30–07:30 UTC. Outside it, today shows nothing by design — " +
          'use a longer range to confirm the engine is firing.';
        renderToday(todaySignals);
      } else {
        chartDays = historyRange;
        runHistoryScan(historyRange);
      }
      refreshChart();
    });
  });
}

function renderPositions(list) {
  lastPositions = list || [];
  const card = $('positions-card'), body = $('positions-body');
  card.hidden = !lastPositions.length;
  if (!lastPositions.length) return;

  body.innerHTML = lastPositions.map(p => {
    const protectedNow = p.sl && (p.type === 'BUY' ? p.sl >= p.entry_price : p.sl <= p.entry_price);
    return `
      <div style="padding:8px 4px;border-bottom:1px solid var(--border)">
        <div style="display:flex;gap:7px;align-items:center;margin-bottom:3px">
          <span class="badge ${p.type}">${p.type}</span>
          <span class="mono" style="font-size:11px">${p.lots} lots</span>
          <span class="mono" style="margin-left:auto;font-weight:700;color:var(--${p.profit_usd >= 0 ? 'long' : 'short'})">
            ${fmt.usd(p.profit_usd)}</span>
        </div>
        <div class="mono" style="font-size:11px;color:var(--text-muted)">
          ${fmt.price(p.entry_price)} → ${fmt.price(p.current_price)} ·
          ${p.excursion_pips >= 0 ? '+' : ''}${p.excursion_pips}p
          ${protectedNow ? '· <span style="color:var(--long)">stop at BE</span>'
                         : (p.excursion_usd >= 5 ? '· <span style="color:var(--warn)">+50p up</span>' : '')}
        </div>
        <div class="pos-actions">
          ${!protectedNow ? `<button class="pos-btn pos-btn-be" data-be="${p.ticket}" type="button">🛡️ Stop to BE</button>` : ''}
          <button class="pos-btn pos-btn-close" data-close="${p.ticket}" type="button" style="margin-left:auto">✕ Close #${p.ticket}</button>
        </div>
      </div>`;
  }).join('');

  body.querySelectorAll('[data-be]').forEach(btn => {
    btn.onclick = async () => {
      const ticket = Number(btn.dataset.be);
      const pos = lastPositions.find(x => x.ticket === ticket);
      if (!pos) return;
      btn.disabled = true;
      btn.textContent = 'Updating…';
      try {
        const res = await api.modifyPosition({ ticket, sl: pos.entry_price, tp: pos.tp || 0 });
        if (res.success) {
          voice.say('CTC');
          ui.toast(`Stop moved to breakeven (${fmt.price(pos.entry_price)}) on #${ticket}`, 'ok');
          refreshChart();
        } else {
          ui.toast(res.error || 'Failed to update stop.', 'err');
        }
      } catch (e) {
        ui.toast('Failed to update stop.', 'err');
      } finally {
        btn.disabled = false;
      }
    };
  });

  body.querySelectorAll('[data-close]').forEach(btn => {
    btn.onclick = async () => {
      const ticket = Number(btn.dataset.close);
      const pos = lastPositions.find(x => x.ticket === ticket);
      if (!pos) return;
      const ok = await ui.confirmAction({
        title: `Close Position Ticket #${ticket}?`,
        lines: [
          ['Ticket', '#' + ticket],
          ['Direction', pos.type],
          ['Lots', pos.lots + ' lots'],
          ['Entry Price', fmt.price(pos.entry_price)],
          ['Current P&L', fmt.usd(pos.profit_usd)],
        ],
        confirmText: `Close Ticket #${ticket}`,
        danger: true,
      });
      if (!ok) return;
      btn.disabled = true;
      btn.textContent = 'Closing…';
      try {
        const res = await api.closePosition(ticket);
        if (res.success) {
          ui.toast(`Position #${ticket} closed at ${fmt.price(res.price)} (${fmt.usd(res.profit)})`, 'ok');
          refreshChart();
        } else {
          ui.toast(res.error || 'Failed to close position.', 'err');
        }
      } catch (e) {
        ui.toast('Failed to close position.', 'err');
      } finally {
        btn.disabled = false;
      }
    };
  });
}

/* -------------------------------------------------------------- polling */

let tfFallbackShown = '';
function markTimeframeFallback(asked, got) {
  if (!asked || !got) return;
  document.querySelectorAll('[data-tf]').forEach(b => {
    const downgraded = b.dataset.tf === asked && got !== asked;
    b.classList.toggle('tf-fallback', downgraded);
    b.title = downgraded
      ? `Your broker does not serve ${asked} bars — showing ${got}`
      : '';
  });
  const key = `${asked}>${got}`;
  if (got !== asked && tfFallbackShown !== key) {
    tfFallbackShown = key;
    ui.toast(`No ${asked} bars from this broker — charting ${got} instead.`, 'warn', 9000);
  }
  if (got === asked) tfFallbackShown = '';
}

let chartDays = null;
async function refreshChart() {
  const d = await api.chartData(tf, chartDays);
  if (!d || d.error) return;

  lastChartData = d;
  zones = d.zones || [];
  todaySignals = d.today_signals || [];
  markTimeframeFallback(d.timeframe_requested, d.timeframe);

  if (d.candles?.length) {
    const fresh = candles.length === 0 || d.candles.length !== candles.length
                  || d.candles[0]?.time !== candles[0]?.time;
    if (fresh) {
      series.setData(d.candles);
      if (candles.length === 0) chart.timeScale().fitContent();
    } else {
      series.update(d.candles[d.candles.length - 1]);
    }
    candles = d.candles;
  }

  const mkLine = (px, colour, title) => series.createPriceLine({
    price: px, color: colour, lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: true, title,
  });
  if (d.pdh != null) {
    if (pdhLine) pdhLine.applyOptions({ price: d.pdh }); else pdhLine = mkLine(d.pdh, css('--gold'), 'PDH');
  }
  if (d.pdl != null) {
    if (pdlLine) pdlLine.applyOptions({ price: d.pdl }); else pdlLine = mkLine(d.pdl, css('--info'), 'PDL');
  }

  const fresh = todaySignals.filter(s => !seenSignalKeys.has(`${s.strategy}:${s.timestamp}`));
  todaySignals.forEach(s => seenSignalKeys.add(`${s.strategy}:${s.timestamp}`));
  if (!firstLoad && fresh.length) {
    const s = fresh[fresh.length - 1];
    flashNewSignal(s);
    if (ui.tradeAlertsEnabled()) voice.say(s.type);
  }
  firstLoad = false;

  drawZones();
  drawSignalBlocks();
  drawMarkers();
  renderSignal(d.latest_signal, d.rejections);
  renderMatrix(d.tech_matrix);
  renderToday(todaySignals);
  renderPositions(d.open_positions);

  window.__ctx = { pdh: d.pdh, pdl: d.pdl, zones, positions: d.open_positions || [] };
}

function checkAlarms(price) {
  const c = window.__ctx || {};
  const hits = alarms.evaluate({
    price, prevPrice, pdh: c.pdh, pdl: c.pdl,
    zones: c.zones || [], positions: c.positions || [], ctcTriggerUsd: 5.0,
  });
  for (const h of hits) {
    alarms.playTone(h.alarm.tone);
    voice.say('ALARM');
    ui.toast(`${h.title} — ${h.action}`, 'warn', 12000);
    api.notifyTray({ message: `${h.title}. ${h.action}` }).catch(() => {});
  }
  prevPrice = price;
}

/* ----------------------------------------------------------------- boot */

async function main() {
  initChart();

  document.querySelectorAll('[data-tf]').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.tf === tf));
    b.addEventListener('click', () => {
      tf = b.dataset.tf;
      localStorage.setItem('twr.tf', tf);
      document.querySelectorAll('[data-tf]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.tf === tf)));
      candles = []; refreshChart();
    });
  });

  document.querySelectorAll('[data-layer]').forEach(cb => {
    cb.checked = Boolean(layers[cb.dataset.layer]);
    cb.addEventListener('change', () => {
      layers[cb.dataset.layer] = cb.checked;
      localStorage.setItem('twr.layers', JSON.stringify(layers));
      drawZones(); drawSignalBlocks(); drawMarkers(); syncAlarmLines();
    });
  });

  $('btn-fit').addEventListener('click', () => { chart.timeScale().fitContent(); drawZones(); drawSignalBlocks(); });
  $('btn-panel').addEventListener('click', e => {
    const solo = $('layout').classList.toggle('solo');
    $('side').hidden = solo;
    e.currentTarget.setAttribute('aria-pressed', String(!solo));
    setTimeout(() => { drawZones(); drawSignalBlocks(); }, 60);
  });

  window.addEventListener('alarms:changed', syncAlarmLines);
  initRangeButtons();

  await ui.boot({
    timeframe: () => tf,
    onStatus: s => {
      if (s.connected) {
        liveBid = s.bid;
        liveAsk = s.ask;
        if (s.balance != null) accountBalance = s.balance;
        paintLiveTick(s.bid);
        checkAlarms(s.bid);
        const t = $('bar-timer');
        if (t) t.textContent = fmt.clock(s.candle_time_left);
      }
    },
  });

  syncAlarmLines();
  api.poll(refreshChart, window.DESK?.pollChart || 3000);
}

main();
