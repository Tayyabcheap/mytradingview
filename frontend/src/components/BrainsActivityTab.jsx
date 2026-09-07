import React, { useMemo, useState } from 'react';
import { Activity, Clock, CheckCircle2 } from 'lucide-react';
import { useBrainsSession } from './brainsSession';
import { DEPT_BY_ID, clamp } from './myBrainsCore';


/* USDCHF trades near 0.81 and its 15-minute ATR is about 0.0004. Printed at
 * three decimals that reads "0.000", which looks like a broken feed. Decimals
 * follow the size of the number, and ATR is shown to two significant figures
 * whatever its magnitude. */
const priceDp = (p) => {
  const a = Math.abs(p);
  return a >= 1000 ? 2 : a >= 100 ? 2 : a >= 10 ? 3 : a >= 1 ? 4 : 5;
};
const sigFmt = (v) => {
  const a = Math.abs(v);
  if (!(a > 0)) return '—';
  const dp = Math.min(8, Math.max(2, 1 - Math.floor(Math.log10(a))));
  return v.toFixed(dp);
};

/* ------------------------------------------------------------------
 * BrainsActivity — what every instrument is about to do, and why not yet.
 * ------------------------------------------------------------------ */

const GATE_COLOR = (s) => s.ok ? '#22c55e' : s.proximity > 0.6 ? '#eab308' : s.proximity > 0.25 ? '#f59e0b' : '#6e7681';

function Meter({ v, color, h = 6 }) {
  return (
    <div style={{ height: h, background: 'rgba(255,255,255,0.07)', borderRadius: h / 2, overflow: 'hidden' }}>
      <div style={{ width: `${clamp(v, 0, 100)}%`, height: '100%', background: color, borderRadius: h / 2, transition: 'width .5s ease' }} />
    </div>
  );
}

function ConfidenceDial({ value, size = 92 }) {
  const pct = clamp(value * 100, 0, 100);
  const col = pct >= 60 ? '#22c55e' : pct >= 30 ? '#eab308' : '#ef4444';
  const r = size / 2 - 8, C = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth="7"
          strokeLinecap="round" strokeDasharray={`${C * pct / 100} ${C}`} />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center'
      }}>
        <span style={{ fontSize: 21, fontWeight: 800, color: col, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{pct.toFixed(0)}</span>
        <span style={{ fontSize: 8.5, color: '#6e7681', letterSpacing: 0.5, marginTop: 2 }}>PERCENT</span>
      </div>
    </div>
  );
}

export default function BrainsActivityTab({ symbol = 'XAUUSDc', timeframe = '1H' }) {
  const S = useBrainsSession(symbol, timeframe, 800);
  const [selKey, setSelKey] = useState(null);
  const [sortMode, setSortMode] = useState('closest');

  const rows = useMemo(() => {
    const list = (S.readiness || []).slice();
    if (sortMode === 'category') {
      const order = ['Forex', 'Commodities', 'Crypto', 'Indices', 'Stocks'];
      list.sort((a, b) => (order.indexOf(a.category) + 99) % 99 - (order.indexOf(b.category) + 99) % 99
        || String(a.symbol).localeCompare(String(b.symbol)));
    } else {
      list.sort((a, b) => (b.direction ? 2 : 0) - (a.direction ? 2 : 0) || (b.gateScore || 0) - (a.gateScore || 0));
    }
    return list;
  }, [S.readiness, sortMode]);

  const sel = rows.find(r => r.key === selKey) || rows[0] || null;
  const org = S.org;
  const lab = org && org.lab;
  const credibility = lab && lab.dsr ? lab.dsr.psr : null;
  const armed = rows.filter(r => r.direction).length;
  const nearly = rows.filter(r => !r.direction && (r.gateScore || 0) > 0.75).length;
  const liveN = rows.filter(r => r.live).length;
  const allSim = rows.length > 0 && liveN === 0;
  const someSim = liveN > 0 && liveN < rows.length;
  const simReason = (rows.find(r => !r.live && r.reason) || {}).reason || '';
  const cats = [];
  for (const r of rows) if (r.category && !cats.includes(r.category)) cats.push(r.category);

  if (S.status !== 'ready') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0f16', color: '#6e7681', fontSize: 13 }}>
        <Activity size={15} style={{ marginRight: 8 }} /> {S.note || 'Starting the floor…'}
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', background: '#0b0f16', overflow: 'hidden' }}>

      {/* ---------------- left: every instrument, closest first ---------------- */}
      <div style={{ width: 396, flexShrink: 0, borderRight: '1px solid #1f2430', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '13px 15px', borderBottom: '1px solid #1f2430' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={15} color="#2dd4bf" />
            <span style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>What the desk is working on</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              {[['closest', 'Closest'], ['category', 'By type']].map(([k, lbl]) => (
                <button key={k} onClick={() => setSortMode(k)} style={{
                  fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 5, cursor: 'pointer',
                  background: sortMode === k ? 'rgba(45,212,191,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${sortMode === k ? 'rgba(45,212,191,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  color: sortMode === k ? '#2dd4bf' : '#6e7681'
                }}>{lbl}</button>
              ))}
            </span>
          </div>
          <div style={{ fontSize: 10.5, color: '#6e7681', marginTop: 4, lineHeight: 1.5 }}>
            {rows.length} instruments{cats.length ? ` · ${cats.join(', ')}` : ''}
          </div>
          <div style={{ fontSize: 10.5, color: '#8b949e', marginTop: 3, lineHeight: 1.5 }}>
            {armed > 0
              ? `${armed} with a live setup${nearly ? `, ${nearly} close behind` : ''}.`
              : nearly > 0
                ? `Nothing triggered. ${nearly} ${nearly === 1 ? 'is' : 'are'} one condition away.`
                : 'Nothing triggered and nothing close. The desk is watching.'}
          </div>

          {allSim && (
            <div style={{
              marginTop: 9, padding: '9px 10px', borderRadius: 7,
              background: 'rgba(239,68,68,0.09)', border: '1px solid rgba(239,68,68,0.35)'
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', marginBottom: 3 }}>
                This is not real market data
              </div>
              <div style={{ fontSize: 10, color: '#fca5a5', lineHeight: 1.6 }}>
                No price history reached the app{simReason ? `: ${simReason}` : ''}. Every instrument below is running
                on a simulated series, so none of these readings mean anything about the actual market.
                Check that MetaTrader 5 is running and logged in, then reload.
              </div>
            </div>
          )}
          {someSim && (
            <div style={{
              marginTop: 9, padding: '8px 10px', borderRadius: 7,
              background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)',
              fontSize: 10, color: '#fcd34d', lineHeight: 1.55
            }}>
              {liveN} of {rows.length} instruments are on live history. The ones marked SIM could not be fetched
              from your broker{simReason ? ` (${simReason})` : ''} and are simulated.
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
          {rows.map((r, ri) => {
            const prev = ri > 0 ? rows[ri - 1] : null;
            const active = sel && sel.key === r.key;
            const dirCol = r.direction > 0 ? '#22c55e' : r.direction < 0 ? '#ef4444' : '#6e7681';
            const blockDept = r.waitingOn ? DEPT_BY_ID[r.waitingOn] : null;
            const header = r.category && (!prev || prev.category !== r.category) && sortMode === 'category'
              ? <div key={'h' + r.category} style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: '#4b5563',
                  textTransform: 'uppercase', margin: ri ? '12px 0 6px' : '0 0 6px'
                }}>{r.category}</div>
              : null;
            return (
              <React.Fragment key={r.key}>
              {header}
              <div onClick={() => setSelKey(r.key)} style={{
                background: active ? '#151d27' : '#0f141d',
                border: `1px solid ${active ? '#2f3947' : '#161c27'}`,
                borderLeft: `3px solid ${r.direction ? dirCol : blockDept ? blockDept.color : '#242c37'}`,
                borderRadius: 8, padding: '11px 12px', marginBottom: 8, cursor: 'pointer'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{r.symbol}</span>
                  <span style={{ fontSize: 10, color: '#6e7681', background: '#1a2029', padding: '1px 6px', borderRadius: 3 }}>{r.timeframe}</span>
                  {!r.live && <span style={{ fontSize: 8.5, fontWeight: 700, color: '#94a3b8', background: 'rgba(148,163,184,0.14)', padding: '2px 5px', borderRadius: 3 }}>SIM</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: dirCol }}>
                    {r.direction && r.met === r.total
                      ? (r.direction > 0 ? 'BUY ready' : 'SELL ready')
                      : r.direction
                        ? (r.direction > 0 ? 'BUY signal' : 'SELL signal')
                        : `${r.met}/${r.total}`}
                  </span>
                </div>

                {/* the gate chain, at a glance */}
                <div style={{ display: 'flex', gap: 3, marginBottom: 7 }}>
                  {r.stages.map((st, i) => (
                    <div key={i} title={st.label} style={{
                      flex: 1, height: 5, borderRadius: 3,
                      background: GATE_COLOR(st),
                      opacity: st.ok ? 1 : 0.35 + st.proximity * 0.5
                    }} />
                  ))}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.direction && r.met === r.total
                        ? 'All conditions met — waiting on the robot'
                        : r.direction
                          ? `analyst has a signal, ${blockDept ? blockDept.name : 'another gate'} is holding it`
                          : blockDept ? `held at ${blockDept.name}` : '—'}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                    color: r.confidence > 0.6 ? '#22c55e' : r.confidence > 0.3 ? '#eab308' : '#6e7681'
                  }}>{r.pending ? '…' : `${(r.confidence * 100).toFixed(0)}%`}</span>
                </div>
              </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ---------------- right: the detail of one instrument ---------------- */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 18, minWidth: 0 }}>
        {!sel && <div style={{ color: '#6e7681', fontSize: 13 }}>Nothing to show yet.</div>}
        {sel && (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, marginBottom: 20 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 5 }}>
                  <span style={{ fontSize: 21, fontWeight: 800, color: '#fff' }}>{sel.symbol}</span>
                  <span style={{ fontSize: 11.5, color: '#8b949e', background: '#1a2029', padding: '2px 8px', borderRadius: 4 }}>{sel.timeframe}</span>
                  {sel.direction !== 0 && (
                    <span style={{
                      fontSize: 11.5, fontWeight: 800, padding: '3px 10px', borderRadius: 4,
                      background: sel.direction > 0 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                      color: sel.direction > 0 ? '#22c55e' : '#ef4444'
                    }}>{sel.direction > 0 ? 'BUY SETUP' : 'SELL SETUP'}</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.6 }}>
                  {sel.setup ? `${sel.setup.name} analyst on duty. ${sel.setup.text}.` : ''}
                </div>
                <div style={{ display: 'flex', gap: 20, marginTop: 12 }}>
                  <div>
                    <div style={{ fontSize: 9, color: '#6e7681', letterSpacing: 0.5, fontWeight: 600 }}>PRICE</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#d1d4dc', fontVariantNumeric: 'tabular-nums' }}>{sel.price ? sel.price.toFixed(priceDp(sel.price)) : '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: '#6e7681', letterSpacing: 0.5, fontWeight: 600 }}>ATR</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#d1d4dc', fontVariantNumeric: 'tabular-nums' }}>{sel.atr ? sigFmt(sel.atr) : '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: '#6e7681', letterSpacing: 0.5, fontWeight: 600 }}>CONDITIONS MET</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: sel.met === sel.total ? '#22c55e' : '#d1d4dc' }}>{sel.met} of {sel.total}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: '#6e7681', letterSpacing: 0.5, fontWeight: 600 }}>LAST BAR</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#d1d4dc' }}>{sel.barTime ? new Date(sel.barTime).toISOString().slice(5, 16).replace('T', ' ') : '—'}</div>
                  </div>
                </div>
              </div>

              <div style={{
                display: 'flex', alignItems: 'center', gap: 14, background: '#0f141d',
                border: '1px solid #1f2430', borderRadius: 10, padding: '14px 16px'
              }}>
                <ConfidenceDial value={sel.confidence} />
                <div style={{ maxWidth: 210 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: '#d1d4dc', marginBottom: 4 }}>How sure we are</div>
                  <div style={{ fontSize: 10, color: '#6e7681', lineHeight: 1.6 }}>
                    {(sel.gateScore * 100).toFixed(0)}% of the conditions are in place, and the strategy behind them is{' '}
                    {credibility == null ? 'not yet assessed' : `${(credibility * 100).toFixed(0)}% likely to be real`}.
                    Confidence is the two multiplied — a perfect setup on an unproven strategy is not a sure thing.
                  </div>
                </div>
              </div>
            </div>

            {/* the pipeline, gate by gate */}
            <div style={{ fontSize: 10, color: '#6e7681', fontWeight: 700, letterSpacing: 0.6, marginBottom: 10 }}>
              THE ROUTE TO A TRADE — WHERE IT IS SITTING NOW
            </div>

            {sel.stages.map((st, i) => {
              const d = DEPT_BY_ID[st.dept] || { name: st.dept, color: '#6e7681' };
              const col = GATE_COLOR(st);
              const isBlocker = !st.ok && sel.waitingOn === st.dept;
              return (
                <div key={i} style={{
                  display: 'flex', gap: 14, padding: '13px 15px', marginBottom: 7, borderRadius: 9,
                  background: isBlocker ? 'rgba(245,158,11,0.05)' : '#0f141d',
                  border: `1px solid ${isBlocker ? 'rgba(245,158,11,0.3)' : '#161c27'}`
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 26, flexShrink: 0 }}>
                    {st.ok
                      ? <CheckCircle2 size={17} color="#22c55e" />
                      : isBlocker ? <Clock size={17} color="#f59e0b" /> : <div style={{ width: 15, height: 15, borderRadius: 8, border: `2px solid ${col}`, opacity: 0.5 }} />}
                    {i < sel.stages.length - 1 && <div style={{ width: 1, flex: 1, minHeight: 12, background: '#242c37' }} />}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 3 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 4, background: d.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: d.color }}>{d.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: st.ok ? '#d1d4dc' : '#8b949e' }}>{st.label}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, color: col, fontVariantNumeric: 'tabular-nums' }}>
                        {st.ok ? 'open' : `${(st.proximity * 100).toFixed(0)}% there`}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.6, marginBottom: 7 }}>{st.detail}</div>
                    <Meter v={st.ok ? 100 : st.proximity * 100} color={col} h={4} />
                  </div>
                </div>
              );
            })}

            <div style={{
              marginTop: 14, padding: 12, borderRadius: 8, background: 'rgba(148,163,184,0.05)',
              border: '1px solid #1f2430', fontSize: 10.5, color: '#6e7681', lineHeight: 1.65
            }}>
              Every gate has to be open at the same moment on the same closed bar. A condition that was met an hour
              ago does not count — this is the state right now, recalculated as each bar closes.
              {sel.direction !== 0 && (sel.met === sel.total
                ? ' All of them are open: if the robot is switched on and Audit has signed the strategy off, this is the next trade.'
                : ' The analyst has a signal, but a gate above is shut, so this is not a trade — a signal on its own is not permission.')}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
