import React, { useState, useEffect } from 'react';
import { 
  X, Award, Brain, Compass, ShieldAlert, TrendingUp, TrendingDown, 
  Activity, Clock, Layers, ArrowUpRight, BarChart2, Zap, RefreshCw, AlertTriangle
} from 'lucide-react';

export default function QuantIntelligenceModal({ 
  isOpen, 
  onClose, 
  symbol = "XAUUSDc", 
  timeframe = "5M" 
}) {
  const [activeTab, setActiveTab] = useState('council'); // 'council' | 'predictor' | 'quant' | 'macro'
  const [loading, setLoading] = useState(false);
  const [intelData, setIntelData] = useState(null);
  const [error, setError] = useState(null);

  const fetchIntelligence = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/intelligence/summary?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`);
      const data = await res.json();
      setIntelData(data);
    } catch (err) {
      setError("Unable to load intelligence metrics: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchIntelligence();
    }
  }, [isOpen, symbol, timeframe]);

  if (!isOpen) return null;

  const council = intelData?.council;
  const projections = intelData?.projections;
  const hurst = intelData?.hurst;
  const kelly = intelData?.kelly;
  const zscore = intelData?.zscore;
  const macro = intelData?.macro;
  const fixes = intelData?.fixes;

  return (
    <div 
      className="modal-overlay" 
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16
      }}
    >
      <div 
        className="modal-content" 
        onClick={e => e.stopPropagation()}
        style={{
          width: 780,
          maxWidth: '96vw',
          maxHeight: '90vh',
          background: '#161922',
          border: '1px solid #2a2e39',
          borderRadius: 10,
          boxShadow: '0 25px 60px rgba(0,0,0,0.85)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: '1px solid #2a2e39',
          background: '#131722'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Award size={20} color="#f7a600" />
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>Council of Champions & Quant Intelligence Hub</span>
                <span style={{ fontSize: 11, background: 'rgba(8,153,129,0.15)', color: '#089981', padding: '1px 7px', borderRadius: 4, border: '1px solid rgba(8,153,129,0.3)' }}>
                  {symbol} • {timeframe}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Synthesized insights from World-Class Trading Champions, Quant Math & Macro Sentinel
              </div>
            </div>
          </div>
          <button 
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#787b86', cursor: 'pointer', padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{
          display: 'flex',
          background: '#131722',
          borderBottom: '1px solid #2a2e39',
          padding: '0 16px'
        }}>
          {[
            { id: 'council', label: 'Council of Champions', icon: Award },
            { id: 'predictor', label: 'Price Predictor (Cone & FVGs)', icon: Compass },
            { id: 'quant', label: 'Quant Lab (Hurst & Kelly)', icon: Brain },
            { id: 'macro', label: 'Macro Sentinel & Fixes', icon: ShieldAlert }
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 16px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: active ? '2px solid var(--brand, #2962ff)' : '2px solid transparent',
                  color: active ? '#fff' : 'var(--text-muted)',
                  fontWeight: active ? 700 : 500,
                  fontSize: 12.5,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <Icon size={15} color={active ? 'var(--brand, #2962ff)' : 'currentColor'} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Body Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: 10, color: 'var(--text-muted)' }}>
              <RefreshCw size={20} className="spin-icon" style={{ animation: 'spin 1s linear infinite' }} />
              <span>Analyzing market microstructure & calculating mathematical models…</span>
            </div>
          )}

          {error && (
            <div style={{ background: 'rgba(242,54,69,0.1)', border: '1px solid rgba(242,54,69,0.3)', padding: 12, borderRadius: 6, color: '#f23645', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          {!loading && intelData && (
            <>
              {/* TAB 1: COUNCIL OF CHAMPIONS */}
              {activeTab === 'council' && (
                <div>
                  {/* Consensus Banner */}
                  <div style={{
                    background: council?.consensus === 'BULLISH_BIAS' ? 'rgba(8,153,129,0.12)' : council?.consensus === 'BEARISH_BIAS' ? 'rgba(242,54,69,0.12)' : 'rgba(247,166,0,0.12)',
                    border: `1px solid ${council?.color || '#2a2e39'}`,
                    borderRadius: 8,
                    padding: '14px 18px',
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: council?.color || '#fff', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                        Council Collective Stance
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginTop: 4 }}>
                        {council?.headline}
                      </div>
                    </div>
                    <div style={{
                      padding: '4px 10px',
                      borderRadius: 4,
                      background: council?.color || 'var(--brand)',
                      color: '#fff',
                      fontWeight: 800,
                      fontSize: 12
                    }}>
                      {council?.consensus}
                    </div>
                  </div>

                  {/* 3 Champions Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                    {council?.champions?.map((champ) => (
                      <div key={champ.id} style={{
                        background: '#1a1e29',
                        border: '1px solid #2a2e39',
                        borderRadius: 8,
                        padding: 14,
                        display: 'flex',
                        flexDirection: 'column'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--brand)', background: 'rgba(41,98,255,0.12)', padding: '2px 6px', borderRadius: 3 }}>
                            {champ.badge}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: champ.confidence >= 75 ? '#089981' : '#f7a600' }}>
                            {champ.confidence}% Conf.
                          </span>
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 2 }}>
                          {champ.name}
                        </div>
                        <div style={{ fontSize: 11, color: '#787b86', marginBottom: 10 }}>
                          {champ.timeframe}
                        </div>
                        <div style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: 3,
                          background: champ.verdict.includes('BULLISH') || champ.verdict.includes('ACCUMULATE') ? 'rgba(8,153,129,0.15)' : champ.verdict.includes('BEARISH') || champ.verdict.includes('DISTRIBUTE') ? 'rgba(242,54,69,0.15)' : 'rgba(120,123,134,0.15)',
                          color: champ.verdict.includes('BULLISH') || champ.verdict.includes('ACCUMULATE') ? '#089981' : champ.verdict.includes('BEARISH') || champ.verdict.includes('DISTRIBUTE') ? '#f23645' : '#d1d4dc',
                          marginBottom: 8,
                          display: 'inline-block'
                        }}>
                          {champ.verdict}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45, marginTop: 'auto' }}>
                          {champ.action}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Institutional Fix Times Strip */}
                  <div style={{
                    marginTop: 16,
                    background: '#131722',
                    border: '1px solid #2a2e39',
                    borderRadius: 8,
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 10
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Clock size={15} color="#f7a600" />
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>Gold Liquidity Fixes (UTC):</span>
                    </div>
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                      {fixes?.fixes?.map((f, i) => (
                        <div key={i} style={{ fontSize: 12 }}>
                          <span style={{ color: '#787b86' }}>{f.name} ({f.time_utc}): </span>
                          <strong style={{ color: f.is_imminent ? '#f23645' : '#089981' }}>in {f.countdown}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: PRICE PREDICTOR */}
              {activeTab === 'predictor' && (
                <div>
                  {/* Probabilistic Target Cone Cards */}
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#787b86', textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5 }}>
                    Geometric Brownian Motion Probability Cone (12 Forward Candles)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
                    <div style={{ background: '#1a1e29', border: '1px solid #2a2e39', borderRadius: 8, padding: 14 }}>
                      <div style={{ fontSize: 11, color: '#089981', fontWeight: 700 }}>P80 Upper Target (Realistic TP)</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#089981', marginTop: 4 }}>
                        {projections?.p80_high}
                      </div>
                      <div style={{ fontSize: 11, color: '#787b86', marginTop: 2 }}>80% probability upper boundary</div>
                    </div>

                    <div style={{ background: '#1a1e29', border: '1px solid #2a2e39', borderRadius: 8, padding: 14 }}>
                      <div style={{ fontSize: 11, color: '#f23645', fontWeight: 700 }}>P80 Lower Target (Realistic SL)</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#f23645', marginTop: 4 }}>
                        {projections?.p80_low}
                      </div>
                      <div style={{ fontSize: 11, color: '#787b86', marginTop: 2 }}>80% probability lower boundary</div>
                    </div>

                    <div style={{ background: '#1a1e29', border: '1px solid #2a2e39', borderRadius: 8, padding: 14 }}>
                      <div style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 700 }}>Markov Volatility Explosion</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--brand)', marginTop: 4 }}>
                        {projections?.markov_expansion_prob}%
                      </div>
                      <div style={{ fontSize: 11, color: '#787b86', marginTop: 2 }}>Probability of breakout in next 10 bars</div>
                    </div>
                  </div>

                  {/* Detected Fair Value Gaps (FVGs) */}
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#787b86', textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5 }}>
                    Unmitigated Fair Value Gaps (FVG) Magnetic Pull Targets
                  </div>
                  {projections?.fvgs?.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {projections.fvgs.map((g, idx) => (
                        <div key={idx} style={{
                          background: '#1a1e29',
                          borderLeft: `4px solid ${g.type === 'BULLISH_FVG' ? '#089981' : '#f23645'}`,
                          borderRadius: '0 6px 6px 0',
                          padding: '10px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: 12.5
                        }}>
                          <div>
                            <strong style={{ color: g.type === 'BULLISH_FVG' ? '#089981' : '#f23645' }}>
                              {g.type === 'BULLISH_FVG' ? '▲ Bullish Discount FVG' : '▼ Bearish Premium FVG'}
                            </strong>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                              Zone: {g.bottom} — {g.top}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 10, color: '#787b86' }}>Magnet Median</div>
                            <strong style={{ color: '#fff', fontSize: 14 }}>{g.mid}</strong>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: 16, background: '#1a1e29', borderRadius: 6, color: '#787b86', fontSize: 12.5, textAlign: 'center' }}>
                      No fresh unmitigated Fair Value Gaps detected in recent lookback. Price is balanced.
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: QUANT LAB */}
              {activeTab === 'quant' && (
                <div>
                  {/* Hurst Exponent Meter */}
                  <div style={{
                    background: '#1a1e29',
                    border: '1px solid #2a2e39',
                    borderRadius: 8,
                    padding: 16,
                    marginBottom: 16
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 800, color: '#787b86', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          Hurst Exponent (R/S Volatility Memory)
                        </div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: hurst?.color || '#fff', marginTop: 4 }}>
                          H = {hurst?.hurst}
                        </div>
                      </div>
                      <div style={{
                        padding: '4px 12px',
                        borderRadius: 4,
                        background: hurst?.color || '#2962ff',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: 12
                      }}>
                        {hurst?.regime}
                      </div>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
                      {hurst?.interpretation}
                    </div>
                  </div>

                  {/* Kelly Criterion Position Sizing */}
                  <div style={{
                    background: '#1a1e29',
                    border: '1px solid #2a2e39',
                    borderRadius: 8,
                    padding: 16,
                    marginBottom: 16
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#787b86', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                      Kelly Criterion Optimal Risk Sizing
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, textAlign: 'center', marginBottom: 12 }}>
                      <div style={{ background: '#131722', padding: 10, borderRadius: 6, border: '1px solid #2a2e39' }}>
                        <div style={{ fontSize: 11, color: '#787b86' }}>Quarter Kelly (Safe)</div>
                        <strong style={{ fontSize: 16, color: '#089981' }}>{kelly?.quarter_kelly_pct}%</strong>
                      </div>
                      <div style={{ background: '#131722', padding: 10, borderRadius: 6, border: '1px solid #2a2e39' }}>
                        <div style={{ fontSize: 11, color: '#787b86' }}>Half Kelly (Moderate)</div>
                        <strong style={{ fontSize: 16, color: '#f7a600' }}>{kelly?.half_kelly_pct}%</strong>
                      </div>
                      <div style={{ background: '#131722', padding: 10, borderRadius: 6, border: '1px solid #2a2e39' }}>
                        <div style={{ fontSize: 11, color: '#787b86' }}>Full Kelly (Max Log)</div>
                        <strong style={{ fontSize: 16, color: '#f23645' }}>{kelly?.full_kelly_pct}%</strong>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: '#d1d4dc' }}>
                      {kelly?.recommendation}
                    </div>
                  </div>

                  {/* Price Z-Score Exhaustion */}
                  <div style={{ background: '#1a1e29', border: '1px solid #2a2e39', borderRadius: 8, padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 11, color: '#787b86', fontWeight: 700 }}>20-Period Price Z-Score</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginTop: 2 }}>
                        Z = {zscore?.z_score} ({zscore?.status})
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#787b86', maxWidth: 300, textAlign: 'right' }}>
                      |Z| &gt; 2.0 flags 95% statistical boundary; signals high mean-reversion exhaustion probability.
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: MACRO SENTINEL */}
              {activeTab === 'macro' && (
                <div>
                  <div style={{
                    background: '#1a1e29',
                    border: '1px solid #2a2e39',
                    borderRadius: 8,
                    padding: 16,
                    marginBottom: 16
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#787b86', textTransform: 'uppercase' }}>Global Macro Regime</span>
                      <span style={{ background: 'rgba(8,153,129,0.15)', color: '#089981', padding: '2px 8px', borderRadius: 4, fontWeight: 700, fontSize: 11 }}>
                        {macro?.macro_regime}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: '#d1d4dc', lineHeight: 1.5 }}>
                      {macro?.geopolitical_notes}
                    </div>
                  </div>

                  <div style={{ fontSize: 12, fontWeight: 800, color: '#787b86', textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5 }}>
                    Red Folder High-Impact Economic Protocol
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {macro?.red_folder_events?.map((ev, i) => (
                      <div key={i} style={{
                        background: '#1a1e29',
                        border: '1px solid #2a2e39',
                        borderRadius: 6,
                        padding: '10px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: 12.5
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ background: '#f23645', color: '#fff', fontSize: 9.5, fontWeight: 800, padding: '2px 6px', borderRadius: 3 }}>
                            {ev.impact}
                          </span>
                          <strong style={{ color: '#fff' }}>{ev.name}</strong>
                        </div>
                        <span style={{ color: '#f7a600', fontWeight: 600 }}>{ev.rule}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid #2a2e39',
          background: '#131722',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <button
            onClick={fetchIntelligence}
            disabled={loading}
            style={{
              background: 'transparent',
              border: '1px solid #2a2e39',
              color: '#d1d4dc',
              padding: '6px 14px',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <RefreshCw size={13} className={loading ? 'spin-icon' : ''} />
            Recalculate
          </button>

          <button
            onClick={onClose}
            style={{
              background: 'var(--brand, #2962ff)',
              border: 'none',
              color: '#fff',
              padding: '7px 18px',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
