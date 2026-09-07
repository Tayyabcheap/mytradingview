import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { TrendingUp, RefreshCw, Calendar } from 'lucide-react';

/* ------------------------------------------------------------------
 * BrainsPerformance — open positions on the left, the record on the right.
 * ------------------------------------------------------------------ */

const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'm3', label: 'Last 3 months' },
  { id: 'm6', label: 'Last 6 months' },
  { id: 'custom', label: 'Custom' },
];

function periodRange(id, custom) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  switch (id) {
    case 'today': break;
    case 'week': {
      const dow = (start.getDay() + 6) % 7;            // Monday = 0
      start.setDate(start.getDate() - dow);
      break;
    }
    case 'month': start.setDate(1); break;
    case 'm3': start.setMonth(start.getMonth() - 3); break;
    case 'm6': start.setMonth(start.getMonth() - 6); break;
    case 'custom': {
      const a = custom.from ? new Date(custom.from + 'T00:00:00') : new Date(0);
      const b = custom.to ? new Date(custom.to + 'T23:59:59') : now;
      return [a.getTime() / 1000, b.getTime() / 1000];
    }
    default: break;
  }
  return [start.getTime() / 1000, now.getTime() / 1000 + 86400];
}

const money = (v, dp = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const pnlColor = (v) => v > 0 ? '#22c55e' : v < 0 ? '#f23645' : '#8b949e';

function Stat({ label, value, color = '#d1d4dc', sub }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9, color: '#6e7681', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{value}</div>
      {sub && <div style={{ fontSize: 9.5, color: '#6e7681', marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

/* Equity curve of the selected period, built from the trades themselves. */
function Curve({ trades, w = 560, h = 92 }) {
  const pts = useMemo(() => {
    const sorted = trades.slice().sort((a, b) => (a.close_time || 0) - (b.close_time || 0));
    let cum = 0;
    return sorted.map(t => (cum += (t.net_pnl || 0)));
  }, [trades]);
  if (pts.length < 2) {
    return <div style={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#4b5563' }}>
      Not enough closed trades in this period to draw a curve.
    </div>;
  }
  const min = Math.min(0, ...pts), max = Math.max(0, ...pts), span = Math.max(1e-9, max - min);
  const x = (i) => (i / (pts.length - 1)) * w;
  const y = (v) => h - ((v - min) / span) * h;
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `0,${y(0).toFixed(1)} ${line} ${w},${y(0).toFixed(1)}`;
  const end = pts[pts.length - 1];
  const col = end >= 0 ? '#22c55e' : '#f23645';
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <line x1="0" y1={y(0)} x2={w} y2={y(0)} stroke="#2a2e39" strokeDasharray="3 3" strokeWidth="1" />
      <polygon points={area} fill={col} opacity="0.10" />
      <polyline points={line} fill="none" stroke={col} strokeWidth="1.8" />
      <circle cx={x(pts.length - 1)} cy={y(end)} r="3" fill={col} />
    </svg>
  );
}

export default function BrainsPerformanceTab({ accountInfo }) {
  const [trades, setTrades] = useState(null);
  const [err, setErr] = useState('');
  const [period, setPeriod] = useState('month');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [symbolFilter, setSymbolFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/journal/trades?days=400')
      .then(r => r.json())
      .then(j => {
        if (j && j.error) { setErr(j.error); setTrades([]); }
        else { setErr(''); setTrades(Array.isArray(j) ? j : []); }
      })
      .catch(e => { setErr(String(e.message || e)); setTrades([]); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 20000); return () => clearInterval(id); }, [load]);

  const all = trades || [];
  const open = all.filter(t => t.status === 'OPEN');
  const closedAll = all.filter(t => t.status !== 'OPEN');

  const symbols = useMemo(() => ['ALL', ...Array.from(new Set(all.map(t => t.symbol))).sort()], [all]);

  const closed = useMemo(() => {
    const [from, to] = periodRange(period, custom);
    return closedAll.filter(t => {
      const ct = t.close_time || t.open_time || 0;
      if (ct < from || ct > to) return false;
      if (symbolFilter !== 'ALL' && t.symbol !== symbolFilter) return false;
      return true;
    }).sort((a, b) => (b.close_time || 0) - (a.close_time || 0));
  }, [closedAll, period, custom, symbolFilter]);

  const stats = useMemo(() => {
    const n = closed.length;
    const pnl = closed.map(t => t.net_pnl || 0);
    const wins = pnl.filter(v => v > 0), losses = pnl.filter(v => v < 0);
    const gross = wins.reduce((a, b) => a + b, 0);
    const grossLoss = -losses.reduce((a, b) => a + b, 0);
    let cum = 0, peak = 0, dd = 0;
    closed.slice().sort((a, b) => (a.close_time || 0) - (b.close_time || 0)).forEach(t => {
      cum += t.net_pnl || 0; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum);
    });
    return {
      n, net: pnl.reduce((a, b) => a + b, 0),
      winRate: n ? (wins.length / n) * 100 : 0,
      pf: grossLoss > 0 ? gross / grossLoss : (gross > 0 ? 99 : 0),
      avgWin: wins.length ? gross / wins.length : 0,
      avgLoss: losses.length ? -grossLoss / losses.length : 0,
      best: n ? Math.max(...pnl) : 0, worst: n ? Math.min(...pnl) : 0,
      maxDD: dd, wins: wins.length, losses: losses.length,
    };
  }, [closed]);

  const openPnl = open.reduce((a, t) => a + (t.net_pnl || 0), 0);

  const chip = (active) => ({
    fontSize: 11, fontWeight: 600, padding: '5px 11px', borderRadius: 6, cursor: 'pointer',
    background: active ? 'rgba(41,98,255,0.18)' : 'rgba(255,255,255,0.04)',
    border: `1px solid ${active ? 'rgba(41,98,255,0.5)' : 'rgba(255,255,255,0.08)'}`,
    color: active ? '#7aa2ff' : '#8b949e', whiteSpace: 'nowrap',
  });

  return (
    <div style={{ height: '100%', display: 'flex', background: '#0b0f16', overflow: 'hidden' }}>

      {/* ------------------------- LEFT: open right now ------------------------- */}
      <div style={{ width: 420, flexShrink: 0, borderRight: '1px solid #1f2430', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '13px 15px', borderBottom: '1px solid #1f2430' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TrendingUp size={15} color="#fbbf24" />
            <span style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>Open right now</span>
            <span style={{ marginLeft: 'auto', fontSize: 15, fontWeight: 800, color: pnlColor(openPnl), fontVariantNumeric: 'tabular-nums' }}>
              {open.length ? money(openPnl) : '—'}
            </span>
          </div>
          <div style={{ fontSize: 10.5, color: '#6e7681', marginTop: 4 }}>
            {open.length ? `${open.length} position${open.length === 1 ? '' : 's'} · ${(accountInfo && accountInfo.currency) || 'USD'}` : 'Flat — nothing at risk.'}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
          {open.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#4b5563', fontSize: 12, lineHeight: 1.7 }}>
              No open positions.<br />When the desk opens one it appears here with its stop, target and running P/L.
            </div>
          )}
          {open.map(t => {
            const isBuy = t.type === 'BUY';
            const risk = t.sl ? Math.abs(t.open_price - t.sl) : 0;
            const moved = (t.close_price - t.open_price) * (isBuy ? 1 : -1);
            const rNow = risk > 0 ? moved / risk : 0;
            return (
              <div key={t.ticket} style={{
                background: '#0f141d', border: '1px solid #161c27',
                borderLeft: `3px solid ${isBuy ? '#22c55e' : '#f23645'}`,
                borderRadius: 8, padding: '11px 12px', marginBottom: 8
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{t.symbol}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 3,
                    background: isBuy ? 'rgba(34,197,94,0.15)' : 'rgba(242,54,69,0.15)',
                    color: isBuy ? '#22c55e' : '#f23645'
                  }}>{t.type} {t.volume}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 800, color: pnlColor(t.net_pnl), fontVariantNumeric: 'tabular-nums' }}>
                    {money(t.net_pnl)}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 8 }}>
                  <Stat label="Entry" value={t.open_price ? t.open_price.toFixed(3) : '—'} />
                  <Stat label="Now" value={t.close_price ? t.close_price.toFixed(3) : '—'} />
                  <Stat label="Stop" value={t.sl ? t.sl.toFixed(3) : '—'} color={t.sl ? '#f23645' : '#4b5563'} />
                  <Stat label="Target" value={t.tp ? t.tp.toFixed(3) : '—'} color={t.tp ? '#22c55e' : '#4b5563'} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: '#6e7681' }}>
                  <span>{t.duration_str || ''}</span>
                  {risk > 0 && <span style={{ color: pnlColor(rNow), fontWeight: 700 }}>{rNow >= 0 ? '+' : ''}{rNow.toFixed(2)}R</span>}
                  <span style={{ marginLeft: 'auto', color: '#4b5563' }}>{t.comment || `#${t.ticket}`}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ------------------------- RIGHT: the record ------------------------- */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ padding: '13px 16px', borderBottom: '1px solid #1f2430' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
            <Calendar size={15} color="#2dd4bf" />
            <span style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>Closed trades</span>
            <button onClick={load} title="Refresh" style={{
              marginLeft: 'auto', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              color: '#8b949e', borderRadius: 5, padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11
            }}>
              <RefreshCw size={11} /> {loading ? 'Loading' : 'Refresh'}
            </button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {PERIODS.map(p => (
              <button key={p.id} onClick={() => setPeriod(p.id)} style={chip(period === p.id)}>{p.label}</button>
            ))}
            {period === 'custom' && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
                <input type="date" value={custom.from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))}
                  style={{ background: '#131722', border: '1px solid #2a2e39', color: '#d1d4dc', borderRadius: 5, padding: '4px 7px', fontSize: 11 }} />
                <span style={{ color: '#4b5563', fontSize: 11 }}>to</span>
                <input type="date" value={custom.to} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))}
                  style={{ background: '#131722', border: '1px solid #2a2e39', color: '#d1d4dc', borderRadius: 5, padding: '4px 7px', fontSize: 11 }} />
              </span>
            )}
            <span style={{ width: 1, height: 18, background: '#1f2430', margin: '0 3px' }} />
            <select value={symbolFilter} onChange={e => setSymbolFilter(e.target.value)}
              style={{ background: '#131722', border: '1px solid #2a2e39', color: '#d1d4dc', borderRadius: 6, padding: '5px 8px', fontSize: 11 }}>
              {symbols.map(sy => <option key={sy} value={sy}>{sy === 'ALL' ? 'All symbols' : sy}</option>)}
            </select>
          </div>
        </div>

        {err && (
          <div style={{ margin: 16, padding: 12, background: 'rgba(242,54,69,0.08)', border: '1px solid rgba(242,54,69,0.3)', borderRadius: 8, fontSize: 11.5, color: '#fca5a5' }}>
            Could not read the trade history: {err}. MetaTrader may not be running.
          </div>
        )}

        {/* the numbers for the chosen period */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #1f2430' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 16, marginBottom: 14 }}>
            <Stat label="Net P/L" value={stats.n ? money(stats.net) : '—'} color={pnlColor(stats.net)}
              sub={(accountInfo && accountInfo.currency) || 'USD'} />
            <Stat label="Trades" value={stats.n} sub={`${stats.wins}W / ${stats.losses}L`} />
            <Stat label="Win rate" value={stats.n ? `${stats.winRate.toFixed(1)}%` : '—'}
              color={stats.winRate >= 50 ? '#22c55e' : '#eab308'} />
            <Stat label="Profit factor" value={stats.n ? stats.pf.toFixed(2) : '—'}
              color={stats.pf >= 1 ? '#22c55e' : '#f23645'} />
            <Stat label="Avg win" value={stats.wins ? money(stats.avgWin) : '—'} color="#22c55e" />
            <Stat label="Avg loss" value={stats.losses ? money(stats.avgLoss) : '—'} color="#f23645" />
            <Stat label="Best" value={stats.n ? money(stats.best) : '—'} color="#22c55e" />
            <Stat label="Worst drawdown" value={stats.n ? `−${stats.maxDD.toFixed(2)}` : '—'} color="#f59e0b" />
          </div>
          <Curve trades={closed} />
        </div>

        {/* the trades themselves */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '104px 84px 62px 78px 78px 74px 84px 1fr',
            gap: 8, padding: '8px 16px', borderBottom: '1px solid #1f2430', position: 'sticky', top: 0,
            background: '#0b0f16', fontSize: 9, color: '#6e7681', fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase'
          }}>
            <span>Closed</span><span>Symbol</span><span>Side</span><span>Entry</span><span>Exit</span>
            <span style={{ textAlign: 'right' }}>Pips</span><span style={{ textAlign: 'right' }}>Net</span><span>Reason</span>
          </div>

          {closed.length === 0 && !loading && (
            <div style={{ padding: '44px 20px', textAlign: 'center', color: '#4b5563', fontSize: 12, lineHeight: 1.7 }}>
              No closed trades in this period.<br />Pick a wider range, or wait for the desk to finish one.
            </div>
          )}

          {closed.map(t => (
            <div key={t.ticket} style={{
              display: 'grid', gridTemplateColumns: '104px 84px 62px 78px 78px 74px 84px 1fr',
              gap: 8, padding: '9px 16px', borderBottom: '1px solid #131822', fontSize: 11,
              color: '#8b949e', alignItems: 'center'
            }}>
              <span style={{ color: '#6e7681', fontSize: 10.5 }}>{(t.close_time_str || t.open_time_str || '').slice(5, 16)}</span>
              <span style={{ color: '#d1d4dc', fontWeight: 600 }}>{t.symbol}</span>
              <span style={{ color: t.type === 'BUY' ? '#22c55e' : '#f23645', fontWeight: 700, fontSize: 10 }}>{t.type}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{t.open_price ? t.open_price.toFixed(3) : '—'}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{t.close_price ? t.close_price.toFixed(3) : '—'}</span>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: pnlColor(t.pips) }}>{t.pips != null ? t.pips.toFixed(1) : '—'}</span>
              <span style={{ textAlign: 'right', fontWeight: 700, color: pnlColor(t.net_pnl), fontVariantNumeric: 'tabular-nums' }}>{money(t.net_pnl)}</span>
              <span style={{ fontSize: 10, color: '#6e7681', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.exit_reason || ''}{t.duration_str ? ` · ${t.duration_str}` : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
