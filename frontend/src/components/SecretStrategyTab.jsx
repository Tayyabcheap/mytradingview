import React, { useState, useRef, useEffect } from 'react';
import KLineChartArea from './KLineChartArea';
import { computeThreeGates, gateStatus } from './threeGates';
import { computeConfluence, displayConfidence } from './confluence';
import { Lock, ChevronDown, ChevronUp, Target, TrendingUp, TrendingDown, Zap, CheckCircle2, Circle } from 'lucide-react';

const SYMBOL = 'XAUUSDc';
const QUADRANTS = [
  { tf: '1M', role: 'Entry trigger' },
  { tf: '5M', role: 'Entry trigger' },
  { tf: '15M', role: 'Structure' },
  { tf: '1H', role: 'Trend context' },
];
const CFG = { lookback: 20, retestBars: 6, atrLen: 14 };
const OB_COLOR = { '1M': '#26a69a', '5M': '#42a5f5', '15M': '#f7a600', '1H': '#ab47bc' };

const TIER_META = {
  1: { label: 'SIGNAL',    color: '#2962ff', blurb: 'Both entry timeframes agree' },
  2: { label: 'CONFIDENT', color: '#f7a600', blurb: 'Agreement + trend or order-block backing' },
  3: { label: 'A-CLASS',   color: '#089981', blurb: 'Everything lines up — trend + order block' },
};

const gatesInstance = (tf) => ({
  instanceId: `SECRET_GATES_${tf}`, id: 'SECRET_GATES', name: '3-Gate Breakout', shortName: '3-Gate',
  isStack: false, visible: true, params: CFG, styles: {}
});

// Order Blocks for THIS chart's own timeframe only — merged & unmitigated, freshest few.
const obInstance = (tf) => ({
  instanceId: `OB_${tf}`, id: 'ORDER_BLOCKS', name: 'Order Blocks', shortName: 'OB',
  isStack: false, visible: true,
  params: { tfs: [tf], colors: { [tf]: OB_COLOR[tf] || '#f7a600' }, maxZones: 3, atrLen: 14 },
  styles: {}
});

const fmt = (v) => (typeof v === 'number' && isFinite(v)) ? v.toFixed(2) : '—';

export default function SecretStrategyTab() {
  const [showRules, setShowRules] = useState(true);
  const [statuses, setStatuses] = useState({});     // per-TF badge text (closed-bar)
  const [signal, setSignal] = useState(null);        // the LOCKED signal shown on the card
  const [phase, setPhase] = useState(null);          // {g5, g15} when awaiting
  const [exec, setExec] = useState({ state: 'idle', msg: '' }); // idle|confirm|sending|done|error
  const refs = useRef(QUADRANTS.map(() => React.createRef()));
  const activeSignalRef = useRef(null);

  const dataFor = (tf) => {
    const i = QUADRANTS.findIndex(q => q.tf === tf);
    const api = i >= 0 && refs.current[i] && refs.current[i].current;
    try { return api && api.getFullData ? api.getFullData() : []; } catch (e) { return []; }
  };

  useEffect(() => {
    const evaluate = () => {
      // ---- per-chart badges (closed bars only, so they don't flicker) ----
      const next = {};
      QUADRANTS.forEach((q) => {
        const raw = dataFor(q.tf);
        const data = (raw && raw.length > 2) ? raw.slice(0, -1) : (raw || []);
        if (!data || data.length < 40) { next[q.tf] = { text: 'Loading…', color: '#8b949e', gate: 0 }; return; }
        try { next[q.tf] = gateStatus(computeThreeGates(data, CFG)); }
        catch (e) { next[q.tf] = { text: '—', color: '#8b949e', gate: 0 }; }
      });
      setStatuses(next);

      // ---- tiered confluence signal (closed bars) ----
      const cand = computeConfluence({ d5: dataFor('5M'), d15: dataFor('15M'), d1h: dataFor('1H') }, CFG);
      const full = (cand && cand.dir !== 0) ? cand : null;

      // last CLOSED 5M price for invalidation checks
      const raw5 = dataFor('5M');
      const lc = (raw5 && raw5.length > 1) ? raw5[raw5.length - 2].close : null;

      let cur = activeSignalRef.current;
      if (cur) {
        if (full && full.dir !== cur.dir) {
          cur = { ...full, lockedAt: Date.now() };                       // reversal → flip
        } else {
          let dead = false;
          if (lc != null) {
            if (cur.dir === 1 && (lc <= cur.sl || lc >= cur.tp1)) dead = true;
            if (cur.dir === -1 && (lc >= cur.sl || lc <= cur.tp1)) dead = true;
          }
          const stale = Date.now() - (cur.lockedAt || 0) > 60 * 60 * 1000; // 60-min guard
          if (dead || (stale && !full)) {
            cur = full ? { ...full, lockedAt: Date.now() } : null;         // closed out → clear/replace
          } else if (full && full.dir === cur.dir && full.tier > cur.tier) {
            cur = { ...cur, tier: full.tier, label: full.label, trendAgrees: full.trendAgrees, obConfluence: full.obConfluence, hitRate: full.hitRate, hitCount: full.hitCount, upgraded: true };
          }
          // otherwise: KEEP the locked signal unchanged (no per-tick drift)
        }
      } else if (full) {
        cur = { ...full, lockedAt: Date.now() };
      }

      // if the signal identity changed, reset any half-finished execute confirmation
      const idOf = (s) => s ? `${s.dir}|${s.entry}|${s.lockedAt}` : 'none';
      if (idOf(cur) !== idOf(activeSignalRef.current)) setExec({ state: 'idle', msg: '' });

      activeSignalRef.current = cur;
      setSignal(cur);
      setPhase(cur ? null : { g5: cand && cand.g5state, g15: cand && cand.g15state });
    };
    const t0 = setTimeout(evaluate, 3500);
    const iv = setInterval(evaluate, 4000);
    return () => { clearTimeout(t0); clearInterval(iv); };
  }, []);

  const executeSignal = async () => {
    if (!signal) return;
    setExec({ state: 'sending', msg: '' });
    try {
      const res = await fetch('/api/order/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: SYMBOL, type: signal.dir === 1 ? 'BUY' : 'SELL', volume: 0.01,
          sl: signal.sl || 0.0, tp: signal.tp1 || 0.0, comment: `TWR Secret ${signal.label}`
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Order failed');
      setExec({ state: 'done', msg: `Order #${data.order || data.deal} placed @ ${fmt(data.price)}` });
    } catch (e) { setExec({ state: 'error', msg: e.message }); }
  };

  const conf = displayConfidence(signal);
  const dirColor = signal ? (signal.dir === 1 ? '#089981' : '#f23645') : '#8b949e';
  const tierMeta = signal ? TIER_META[signal.tier] : null;
  const lockedMin = signal ? Math.max(0, Math.round((Date.now() - (signal.lockedAt || Date.now())) / 60000)) : 0;

  const Factor = ({ ok, children }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: ok ? '#c9d1d9' : '#5c6370' }}>
      {ok ? <CheckCircle2 size={12} color="#089981" /> : <Circle size={12} color="#3a3f4b" />} {children}
    </span>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0e1116', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid #1f2430', background: '#0d1117', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Lock size={16} color="#f7a600" />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: '#e6e9ef' }}>Secret Strategy — Three-Gate Breakout <span style={{ color: '#8b949e', fontWeight: 500 }}>· GOLD (XAUUSDc)</span></div>
              <div style={{ fontSize: 11, color: '#8b949e' }}>Confirm a real breakout — never fade the sweep. Entries on 1M/5M, context on 15M/1H.</div>
            </div>
          </div>
          <button onClick={() => setShowRules(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.05)', border: '1px solid #2a2e39', borderRadius: 5, color: '#b0b4be', fontSize: 11.5, padding: '5px 9px', cursor: 'pointer' }}>
            {showRules ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {showRules ? 'Hide' : 'Show'} rules
          </button>
        </div>

        {/* ======================= SIGNAL CARD ======================= */}
        <div style={{ margin: '0 14px 10px' }}>
          {signal ? (
            <div style={{
              borderRadius: 9, padding: '11px 14px',
              background: `linear-gradient(180deg, ${tierMeta.color}22, rgba(255,255,255,0.02))`,
              border: `1px solid ${tierMeta.color}`, borderLeft: `4px solid ${tierMeta.color}`,
              display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap'
            }}>
              {/* left: tier + direction */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 150 }}>
                <span style={{ alignSelf: 'flex-start', fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, color: '#0d1117', background: tierMeta.color, borderRadius: 4, padding: '2px 7px' }}>
                  {tierMeta.label}{signal.upgraded ? ' ↑' : ''}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  {signal.dir === 1 ? <TrendingUp size={20} color={dirColor} /> : <TrendingDown size={20} color={dirColor} />}
                  <span style={{ fontSize: 20, fontWeight: 800, color: dirColor }}>{signal.dir === 1 ? 'BUY' : 'SELL'} GOLD</span>
                </div>
                <span style={{ fontSize: 10.5, color: '#8b949e' }}>🔒 Locked {lockedMin === 0 ? 'just now' : `${lockedMin}m ago`} · holds until reversal or upgrade</span>
              </div>

              {/* middle: levels */}
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                <Level k="Entry" v={fmt(signal.entry)} c="#e6e9ef" />
                <Level k="Stop" v={fmt(signal.sl)} c="#f23645" />
                <Level k="TP1" v={fmt(signal.tp1)} c="#089981" />
                <Level k="TP2" v={fmt(signal.tp2)} c="#089981" />
                <Level k="R:R" v={`1:${(signal.rr || 1).toFixed(1)}`} c="#b0b4be" />
              </div>

              {/* confidence + factors */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginLeft: 'auto' }}>
                {conf && (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: tierMeta.color }}>{conf.pct}%</span>
                    <span style={{ fontSize: 10.5, color: '#8b949e' }}>{conf.measured ? `measured edge · n=${conf.n}` : 'est. · thin history'}</span>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <Factor ok={signal.gate5}>5M</Factor>
                  <Factor ok={signal.gate15}>15M</Factor>
                  <Factor ok={signal.trendAgrees}>1H trend</Factor>
                  <Factor ok={signal.obConfluence}>Order block</Factor>
                </div>
              </div>

              {/* execute */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 5, minWidth: 132 }}>
                {exec.state === 'done' ? (
                  <span style={{ fontSize: 11, color: '#089981', fontWeight: 600 }}>✓ {exec.msg}</span>
                ) : exec.state === 'error' ? (
                  <>
                    <span style={{ fontSize: 10.5, color: '#f23645' }}>{exec.msg}</span>
                    <button onClick={() => setExec({ state: 'idle', msg: '' })} style={btn('#2a2e39', '#b0b4be')}>Dismiss</button>
                  </>
                ) : exec.state === 'confirm' ? (
                  <>
                    <button onClick={executeSignal} style={btn(dirColor, '#fff')}>Confirm {signal.dir === 1 ? 'BUY' : 'SELL'} 0.01</button>
                    <button onClick={() => setExec({ state: 'idle', msg: '' })} style={btn('#2a2e39', '#b0b4be')}>Cancel</button>
                  </>
                ) : (
                  <button onClick={() => setExec({ state: 'confirm', msg: '' })} disabled={exec.state === 'sending'}
                    style={btn(tierMeta.color, '#0d1117')}>
                    <Zap size={13} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} />
                    {exec.state === 'sending' ? 'Sending…' : 'Execute 0.01'}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div style={{ borderRadius: 7, padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid #2a2e39' }}>
              <Target size={16} color="#8b949e" />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: '#8b949e' }}>
                Awaiting 5M + 15M agreement —
                <span style={{ color: phase && phase.g5 === 'setup' ? '#089981' : '#8b949e' }}> 5M: {phase ? (phase.g5 || '—') : '—'}</span> ·
                <span style={{ color: phase && phase.g15 === 'setup' ? '#089981' : '#8b949e' }}> 15M: {phase ? (phase.g15 || '—') : '—'}</span>
              </span>
            </div>
          )}
        </div>

        {showRules && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, padding: '0 14px 12px' }}>
            {[
              { g: 'Gate 1', t: 'Trend break', d: 'Price breaks a clear minor trendline in the intended direction.', c: '#42a5f5' },
              { g: 'Gate 2', t: 'Level break', d: 'Price closes through the nearest horizontal support/resistance.', c: '#f7a600' },
              { g: 'Gate 3', t: 'Retest & reject', d: 'Price pulls back to the broken level and prints a strong rejection candle closing back in the break direction. Miss any gate → skip.', c: '#089981' },
            ].map((x, i) => (
              <div key={i} style={{ background: '#131722', border: `1px solid #2a2e39`, borderLeft: `3px solid ${x.c}`, borderRadius: 6, padding: '8px 10px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: x.c }}>{x.g} · {x.t}</div>
                <div style={{ fontSize: 11, color: '#b0b4be', marginTop: 3, lineHeight: 1.45 }}>{x.d}</div>
              </div>
            ))}
            <div style={{ background: '#131722', border: '1px solid #2a2e39', borderLeft: '3px solid #2962ff', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#e6e9ef' }}>Tiers</div>
              <div style={{ fontSize: 10.5, color: '#b0b4be', marginTop: 3, lineHeight: 1.5 }}>
                <span style={{ color: '#2962ff', fontWeight: 700 }}>SIGNAL</span> 5M+15M agree · <span style={{ color: '#f7a600', fontWeight: 700 }}>CONFIDENT</span> +trend/OB · <span style={{ color: '#089981', fontWeight: 700 }}>A-CLASS</span> +both. % is the measured hit-rate of past setups.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2x2 chart grid */}
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 1, background: '#1f2430' }}>
        {QUADRANTS.map((q, i) => {
          const st = statuses[q.tf];
          return (
            <div key={q.tf} style={{ position: 'relative', background: '#0e1116', minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ position: 'absolute', top: 6, left: 8, right: 8, zIndex: 20, display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(13,17,23,0.82)', border: '1px solid #2a2e39', borderRadius: 5, padding: '3px 8px' }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#e6e9ef' }}>GOLD</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#f7a600' }}>{q.tf}</span>
                  <span style={{ fontSize: 10, color: '#8b949e' }}>{q.role}</span>
                </div>
                {st && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(13,17,23,0.82)', border: `1px solid ${st.color}`, borderRadius: 5, padding: '3px 8px', maxWidth: '70%' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: st.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: st.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.text}</span>
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <KLineChartArea
                  ref={refs.current[i]}
                  symbol={SYMBOL}
                  timeframe={q.tf}
                  indicators={[gatesInstance(q.tf), obInstance(q.tf)]}
                  signals={[]}
                  showSignals={false}
                  onPriceUpdate={() => {}}
                  watermarkText={null}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Level({ k, v, c }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 9.5, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 0.4 }}>{k}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: c }}>{v}</span>
    </div>
  );
}

function btn(bg, fg) {
  return { background: bg, color: fg, border: 'none', borderRadius: 5, fontSize: 11.5, fontWeight: 700, padding: '6px 10px', cursor: 'pointer', whiteSpace: 'nowrap' };
}
