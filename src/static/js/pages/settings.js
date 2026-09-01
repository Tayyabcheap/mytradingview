import * as ui from '../core/ui.js';
import * as api from '../core/api.js';
import * as fmt from '../core/fmt.js';
import * as voice from '../core/voice.js';

const $ = id => document.getElementById(id);

function paintVoiceList() {
  const sel = $('v-voice');
  const list = voice.listVoices().filter(v => v.score > 0);
  const current = voice.currentVoiceName();

  if (!list.length) {
    sel.innerHTML = '<option>No female voice found on this system</option>';
    sel.disabled = true;
    $('v-voice-hint').innerHTML =
      'Windows ships Zira and Hazel with the English language packs. ' +
      'Install one under Settings → Time &amp; Language → Speech, or use neural voice above.';
    return;
  }

  sel.disabled = false;
  sel.innerHTML = list.map(v =>
    `<option value="${fmt.esc(v.name)}"${v.name === current ? ' selected' : ''}>
       ${fmt.esc(v.name)} · ${fmt.esc(v.lang)}
     </option>`).join('');
}

function showPreviewText() {
  const lines = voice.scriptFor($('v-event').value);
  $('v-preview-text').textContent = lines.length
    ? `"${lines[0]}"${lines.length > 1 ? ` (+${lines.length - 1} more variants)` : ''}`
    : 'This persona has no line for that event.';
}

async function loadTelegram() {
  try {
    const c = await api.telegramGet();
    $('tg-chat').value = c.chat_id || '';
    $('tg-on').checked = !!c.enabled;
    if (c.has_token) $('tg-token').placeholder = 'saved — leave blank to keep';
  } catch { /* offline */ }
}

async function loadHealth() {
  try {
    const h = await api.health();
    const row = (k, ok, note) => `
      <div style="display:flex;gap:9px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
        <span class="pill ${ok ? 'live' : 'off'}" style="min-width:60px;justify-content:center">
          <span class="dot"></span>${ok ? 'OK' : 'No'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600">${fmt.esc(k)}</div>
          <div style="font-size:11.5px;color:var(--text-muted)">${note}</div>
        </div>
      </div>`;

    $('health-body').innerHTML =
      row('MetaTrader 5 module', h.mt5_module,
          h.mt5_module ? 'Python package installed' : 'pip install MetaTrader5') +
      row('MetaTrader 5 terminal', h.mt5_connected,
          h.mt5_connected ? 'Connected and logged in' : 'Start MT5 and log into your account') +
      row('Neural voice', h.neural_voice,
          h.neural_voice ? 'edge-tts available' : 'pip install edge-tts for a far more natural voice — the browser voice is used meanwhile') +
      `<div style="padding:9px 0;font-size:11.5px;color:var(--text-faint)">
         Engine fingerprint <span class="mono">${fmt.esc(h.engine_fingerprint)}</span> ·
         cached timeframes ${h.cached_timeframes.join(', ') || 'none'} ·
         server pid ${h.pid}
       </div>`;
  } catch {
    $('health-body').innerHTML = '<div class="empty"><div>Server unreachable.</div></div>';
  }
}

async function main() {
  const shell = await ui.boot({ timeframe: () => '3M' });

  // Voice discovery runs in the background so it cannot delay first paint.
  // This page is the one that needs it, so it waits here instead.
  await shell.voiceReady;

  $('engine-tag').textContent = voice.isNeural() ? 'Neural voice' : 'Browser voice';
  $('v-persona').value = voice.getPersona();
  if ($('v-neural-voice')) {
    $('v-neural-voice').value = voice.getNeuralVoice();
    $('v-neural-voice').addEventListener('change', e => {
      voice.setNeuralVoice(e.target.value);
      ui.toast(`Neural voice set to ${e.target.selectedOptions[0]?.text?.split('—')[0]?.trim() || e.target.value}.`, 'ok');
      voice.say('READY', null, { force: true });
    });
  }
  $('v-rate').value = voice.getRate();
  $('v-pitch').value = voice.getPitch();
  $('v-rate-val').textContent = voice.getRate().toFixed(2);
  $('v-pitch-val').textContent = voice.getPitch().toFixed(2);
  paintVoiceList();
  showPreviewText();

  $('v-persona').addEventListener('change', async e => {
    await voice.setPersona(e.target.value);
    showPreviewText();
    ui.toast(`Persona set to ${e.target.value}.`, 'ok');
    voice.say('READY', null, { force: true });
  });

  $('v-voice').addEventListener('change', e => {
    voice.setVoiceByName(e.target.value);
    voice.say(null, 'This is how I will sound.', { force: true });
  });

  $('v-rate').addEventListener('input', e => {
    voice.setRate(e.target.value);
    $('v-rate-val').textContent = Number(e.target.value).toFixed(2);
  });
  $('v-pitch').addEventListener('input', e => {
    voice.setPitch(e.target.value);
    $('v-pitch-val').textContent = Number(e.target.value).toFixed(2);
  });

  $('v-event').addEventListener('change', showPreviewText);
  $('btn-preview').addEventListener('click', () =>
    voice.say($('v-event').value, null, { force: true }));

  await loadTelegram();

  $('btn-tg-save').addEventListener('click', async () => {
    const body = { chat_id: $('tg-chat').value.trim(), enabled: $('tg-on').checked };
    const tok = $('tg-token').value.trim();
    if (tok) body.bot_token = tok;
    try {
      await api.telegramSet(body);
      $('tg-token').value = '';
      $('tg-token').placeholder = 'saved — leave blank to keep';
      ui.toast('Mobile alert settings saved.', 'ok');
    } catch { ui.toast('Could not save.', 'err'); }
  });

  $('btn-tg-test').addEventListener('click', async () => {
    const r = await api.telegramTest(
      '🔔 <b>MyFinanceAdvisor</b>\n\nMobile alerts are connected. ' +
      'Signals, alarms and Cost-to-Cost reminders will arrive here.');
    ui.toast(r.success ? 'Test sent — check your phone.' : (r.error || 'Failed to send.'),
             r.success ? 'ok' : 'err', 7000);
  });

  await loadHealth();

  $('btn-restart').addEventListener('click', async () => {
    if (!await ui.confirmAction({
      title: 'Restart the server?',
      lines: [['Affects', 'this app and its tray icon only'],
              ['Open trades', 'are not touched — they live in MetaTrader 5']],
      confirmText: 'Restart',
    })) return;
    try { await api.restart(); } catch {}
    ui.toast('Restarting — reconnecting in a few seconds.', 'warn', 9000);
    setTimeout(() => location.reload(), 5000);
  });

  $('btn-shutdown').addEventListener('click', async () => {
    if (!await ui.confirmAction({
      title: 'Shut down the desk?',
      lines: [['Stops', 'this app and its tray icon'],
              ['Does not stop', 'MetaTrader 5, or any other Python process'],
              ['Open trades', 'stay open in MetaTrader 5']],
      confirmText: 'Shut down', danger: true,
    })) return;
    try { await api.shutdown(); } catch {}
    ui.toast('Shut down. You can close this tab.', 'warn', 30000);
  });
}

main();
