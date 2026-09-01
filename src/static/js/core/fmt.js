/* Number formatting — one definition, used everywhere.
 *
 * The old UI carried four contradictory ones at the same time:
 *   header pill    "0.10 Lot = $0.01/pip"   (the code's own math gave $1.00)
 *   spread readout  spread_pts * 0.001      (config declared * 0.01)
 *   alarm dropdown "+40p CTC"               (config and playbook say 50)
 *   TP toast       "+30 Pips Captured!"     (hardcoded, ignored the real TP)
 *
 * 1 pip = $0.10 of XAUUSD price movement. That is the only convention here.
 */

export const USD_PER_PIP = 0.10;

export const price  = v => (v == null || isNaN(v)) ? '—' : Number(v).toFixed(window.DESK?.priceDecimals ?? 3);
export const pips   = usd => (usd == null || isNaN(usd)) ? '—' : (usd / USD_PER_PIP).toFixed(0);
export const toPips = usd => usd / USD_PER_PIP;

/** Signed USD. Never prefixes "+" blindly — the old code did, and rendered
 *  Swing Core's -13,574 result as "+-13,574 pips". */
export function usd(v, { sign = true, dp = 2 } = {}) {
  if (v == null || isNaN(v)) return '—';
  const n = Number(v);
  const s = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const pre = !sign ? '' : n > 0 ? '+' : n < 0 ? '−' : '';
  return `${pre}$${s}`;
}

export function pct(v, dp = 1) {
  return (v == null || isNaN(v)) ? '—' : `${Number(v).toFixed(dp)}%`;
}

export function r(v, dp = 2) {
  if (v == null || isNaN(v)) return '—';
  const n = Number(v);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(dp)}R`;
}

export const int = v => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString();

export function clock(secs) {
  if (secs == null) return '—';
  const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ago(iso) {
  if (!iso) return '—';
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

/** Escape untrusted text before it reaches innerHTML. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const cls = v => v > 0 ? 'pos' : v < 0 ? 'neg' : '';
