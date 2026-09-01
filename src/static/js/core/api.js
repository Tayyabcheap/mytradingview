/* Fetch layer and polling.
 *
 * Two things the old client did that this does not:
 *   - polled /api/chart_data every 2.5s regardless of which page was open,
 *     and each call rebuilt the entire dataset server-side;
 *   - shipped the full trade history in that payload and re-parsed it.
 *
 * Polling here pauses when the tab is hidden and backs off on failure.
 */

const token = () => window.DESK?.token || '';

async function req(url, opts = {}) {
  const headers = { 'X-Desk-Token': token(), ...(opts.headers || {}) };
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 204) return null;
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status, data });
  return data;
}

export const get  = (url) => req(url);
export const post = (url, body) => req(url, { method: 'POST', body: JSON.stringify({ ...body, token: token() }) });

export const status        = (tf) => get(`/api/status?timeframe=${encodeURIComponent(tf || '3M')}`);
export const chartData     = (tf, days) => get(`/api/chart_data?timeframe=${encodeURIComponent(tf || '3M')}${days ? '&days=' + days : ''}`);
export const backtest      = ()   => get('/api/backtest_summary');
export const trades        = (q)  => get('/api/trades?' + new URLSearchParams(q));
export const strategySpec  = ()   => get('/api/strategy_spec');
export const canTrade      = ()   => get('/api/can_trade');
export const health        = ()   => get('/api/health');
export const positionSize  = (b)  => post('/api/position_size', b);
export const execute       = (b)  => post('/api/execute_trade', b);
export const closePosition = (ticket) => post('/api/close_position', { ticket });
export const modifyPosition = (b) => post('/api/modify_position', b);
export const recordExit    = (o)  => post('/api/record_exit', { outcome: o });
export const resetSession  = ()   => post('/api/session/reset', {});
export const voiceLines    = (p)  => get(`/api/voice/lines?persona=${encodeURIComponent(p || '')}`);
export const telegramGet   = ()   => get('/api/telegram_settings');
export const telegramSet   = (b)  => post('/api/telegram_settings', b);
export const telegramTest  = (m)  => post('/api/send_telegram_alert', { message: m });
export const notifyTray    = (b)  => post('/api/notify_tray', b);
export const restart       = ()   => post('/api/restart_server', {});
export const shutdown      = ()   => post('/api/shutdown_server', {});
export const reloadHistory = ()   => post('/api/reload_history', {});

/** Repeating task that sleeps with the tab and backs off when the server is down. */
export function poll(fn, ms, { immediate = true } = {}) {
  let timer = null, stopped = false, fails = 0;

  async function tick() {
    if (stopped) return;
    if (document.hidden) { schedule(ms); return; }
    try { await fn(); fails = 0; schedule(ms); }
    catch { fails++; schedule(Math.min(ms * Math.pow(2, Math.min(fails, 4)), 30000)); }
  }
  function schedule(delay) {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(tick, delay);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !stopped) { clearTimeout(timer); tick(); }
  });

  if (immediate) tick(); else schedule(ms);
  return { stop() { stopped = true; clearTimeout(timer); }, now: tick };
}
