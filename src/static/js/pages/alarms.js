import * as ui from '../core/ui.js';
import * as api from '../core/api.js';
import * as fmt from '../core/fmt.js';
import * as voice from '../core/voice.js';
import * as alarms from '../core/alarms.js';

const $ = id => document.getElementById(id);
let ctx = { price: null, prevPrice: null, pdh: null, pdl: null, zones: [], positions: [] };

const HINTS = {
  CUSTOM_PRICE:    'Fires when price reaches the level you set.',
  SWEEP_PDH:       'Fires when price trades above yesterday\'s high — the setup for a bearish bias flip.',
  SWEEP_PDL:       'Fires when price trades below yesterday\'s low — the setup for a bullish bias flip.',
  ZONE_RESISTANCE: 'Fires when price enters any live 15M supply zone.',
  ZONE_SUPPORT:    'Fires when price enters any live 15M demand zone.',
  ORDER_BLOCK:     'Fires on a tap of any unmitigated 15M order block.',
  FVG_CE:          'Fires at the 50% midpoint of a fair value gap — the level the playbook enters from.',
  CTC_MILESTONE:   'Fires when an open trade reaches +50 pips, so you can move the stop to breakeven.',
};

function renderForm() {
  $('a-type').innerHTML = alarms.TYPES.map(t =>
    `<option value="${t.id}">${fmt.esc(t.label)}</option>`).join('');
  $('a-tone').innerHTML = alarms.TONES.map(t =>
    `<option value="${t}">${t.replace(/_/g, ' ').toLowerCase()}</option>`).join('');
  onTypeChange();
}

function onTypeChange() {
  const id = $('a-type').value;
  const t = alarms.TYPES.find(x => x.id === id);
  $('wrap-price').hidden = !t?.needsPrice;
  $('wrap-cond').hidden = !t?.needsCondition;
  $('a-type-hint').textContent = HINTS[id] || '';
  if (t?.needsPrice && ctx.price) {
    $('a-price-hint').textContent = `Current price ${fmt.price(ctx.price)}`;
    if (!$('a-price').value) $('a-price').value = ctx.price.toFixed(3);
  }
}

function renderList() {
  const list = alarms.load();
  $('armed-count').textContent = list.length;
  const nav = $('alarm-count');
  if (nav) { const n = alarms.activeCount(); nav.hidden = !n; nav.textContent = n; }

  if (!list.length) {
    $('armed-list').innerHTML = `<div class="empty">
      <svg aria-hidden="true"><use href="#i-empty"></use></svg><div>Nothing armed yet.</div></div>`;
    return;
  }

  $('armed-list').innerHTML = list.map(a => {
    const t = alarms.TYPES.find(x => x.id === a.type);
    const active = a.status === 'ACTIVE';
    let dist = '';
    if (a.price != null && ctx.price != null) {
      const d = a.price - ctx.price;
      dist = `<span class="mono" style="font-size:11px;color:var(--${Math.abs(d) < 1 ? 'warn' : 'text-faint'})">
        ${d >= 0 ? '+' : '−'}${fmt.pips(Math.abs(d))}p away</span>`;
    }
    return `
      <div style="display:flex;gap:10px;align-items:center;padding:10px 2px;border-bottom:1px solid var(--border);${active ? '' : 'opacity:.5'}">
        <span class="pill ${active ? 'live' : 'range'}" style="min-width:66px;justify-content:center">
          <span class="dot"></span>${active ? 'Armed' : 'Paused'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600">${fmt.esc(a.label || t?.label || a.type)}</div>
          <div style="font-size:11.5px;color:var(--text-muted)">
            ${fmt.esc(t?.label || a.type)}${a.price != null ? ` at <span class="mono">${fmt.price(a.price)}</span>` : ''}
            ${dist}
          </div>
        </div>
        <button class="btn btn-sm" data-toggle="${a.id}">${active ? 'Pause' : 'Arm'}</button>
        <button class="btn btn-sm btn-danger" data-del="${a.id}" aria-label="Delete alarm">Delete</button>
      </div>`;
  }).join('');

  $('armed-list').querySelectorAll('[data-toggle]').forEach(b =>
    b.onclick = () => { alarms.toggle(b.dataset.toggle); renderList(); });
  $('armed-list').querySelectorAll('[data-del]').forEach(b =>
    b.onclick = async () => {
      if (!await ui.confirmAction({ title: 'Delete this alarm?', lines: [], confirmText: 'Delete', danger: true })) return;
      alarms.remove(b.dataset.del); renderList();
    });
}

function check(price) {
  const hits = alarms.evaluate({ ...ctx, price, ctcTriggerUsd: 5.0 });
  for (const h of hits) {
    alarms.playTone(h.alarm.tone);
    if (h.alarm.speak !== false) voice.say('ALARM');
    ui.toast(`${h.title} — ${h.action}`, 'warn', 13000);
    api.notifyTray({ message: `${h.title}. ${h.action}` }).catch(() => {});
  }
  ctx.prevPrice = price;
  ctx.price = price;
}

async function main() {
  renderForm();
  renderList();

  $('a-type').addEventListener('change', onTypeChange);
  $('btn-tone').addEventListener('click', () => alarms.playTone($('a-tone').value));

  $('btn-arm').addEventListener('click', () => {
    const type = $('a-type').value;
    const t = alarms.TYPES.find(x => x.id === type);
    const price = t?.needsPrice ? parseFloat($('a-price').value) : null;
    if (t?.needsPrice && (isNaN(price) || price <= 0)) {
      ui.toast('Enter a target price first.', 'err');
      $('a-price').focus();
      return;
    }
    alarms.add({
      type, price,
      condition: t?.needsCondition ? $('a-cond').value : null,
      tone: $('a-tone').value,
      label: $('a-label').value.trim() || t?.label || type,
      speak: $('a-speak').checked,
    });
    $('a-label').value = '';
    renderList();
    ui.toast('Alarm armed.', 'ok');
  });

  window.addEventListener('alarms:changed', renderList);

  await ui.boot({
    timeframe: () => '3M',
    onStatus: s => { if (s.connected) check(s.bid); },
  });

  api.poll(async () => {
    const d = await api.chartData('3M');
    if (d && !d.error) {
      ctx.pdh = d.pdh; ctx.pdl = d.pdl;
      ctx.zones = d.zones || []; ctx.positions = d.open_positions || [];
      renderList();
    }
  }, 8000);
}

main();
