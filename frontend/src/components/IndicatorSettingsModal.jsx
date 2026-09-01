import React, { useState, useEffect } from 'react';
import { Settings, X, RotateCcw, Check, Palette, Sliders, Eye } from 'lucide-react';

const PRESET_COLORS = [
  '#2962ff', '#089981', '#f23645', '#f7a600', 
  '#e040fb', '#00e676', '#ff6d00', '#00bcd4', 
  '#9c27b0', '#ffeb3b', '#ffffff', '#787b86'
];

export default function IndicatorSettingsModal({ 
  isOpen, 
  onClose, 
  indicatorInstance, 
  onSaveSettings 
}) {
  const [activeTab, setActiveTab] = useState('inputs'); // 'inputs' | 'style' | 'visibility'
  const [params, setParams] = useState({});
  const [styles, setStyles] = useState({});
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (indicatorInstance) {
      setParams(JSON.parse(JSON.stringify(indicatorInstance.params || {})));
      setStyles(JSON.parse(JSON.stringify(indicatorInstance.styles || {})));
      setVisible(indicatorInstance.visible !== false);
      setActiveTab('inputs');
    }
  }, [indicatorInstance]);

  if (!isOpen || !indicatorInstance) return null;

  const { id, name, shortName, isStack } = indicatorInstance;

  const handleParamChange = (key, value) => {
    setParams(prev => ({ ...prev, [key]: value }));
  };

  const handleLineColorChange = (index, color) => {
    setStyles(prev => {
      const lines = [...(prev.lines || [])];
      if (!lines[index]) lines[index] = {};
      lines[index] = { ...lines[index], color };
      return { ...prev, lines };
    });
  };

  const handleLineSizeChange = (index, size) => {
    setStyles(prev => {
      const lines = [...(prev.lines || [])];
      if (!lines[index]) lines[index] = {};
      lines[index] = { ...lines[index], size: Number(size) };
      return { ...prev, lines };
    });
  };

  const handleLineStyleChange = (index, style) => {
    setStyles(prev => {
      const lines = [...(prev.lines || [])];
      if (!lines[index]) lines[index] = {};
      lines[index] = { ...lines[index], style };
      return { ...prev, lines };
    });
  };

  const handleResetDefaults = () => {
    if (indicatorInstance.defaultParams) {
      setParams(JSON.parse(JSON.stringify(indicatorInstance.defaultParams)));
    }
    if (indicatorInstance.defaultStyles) {
      setStyles(JSON.parse(JSON.stringify(indicatorInstance.defaultStyles)));
    }
  };

  const handleSave = () => {
    onSaveSettings(indicatorInstance.instanceId, {
      params,
      styles,
      visible
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal-content" 
        style={{ width: 520, maxWidth: '92vw', padding: 0, overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-card)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Settings size={18} color="var(--brand)" />
            <span style={{ fontSize: 15, fontWeight: 700 }}>
              {name || shortName || id} Settings
            </span>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={18}/></button>
        </div>

        {/* Tab Navigation */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--border)',
          padding: '0 20px',
          background: 'rgba(0,0,0,0.15)'
        }}>
          <button
            onClick={() => setActiveTab('inputs')}
            style={{
              padding: '10px 16px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'inputs' ? '2px solid var(--brand)' : '2px solid transparent',
              color: activeTab === 'inputs' ? 'var(--brand)' : 'var(--text-muted)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <Sliders size={14} /> Inputs
          </button>
          <button
            onClick={() => setActiveTab('style')}
            style={{
              padding: '10px 16px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'style' ? '2px solid var(--brand)' : '2px solid transparent',
              color: activeTab === 'style' ? 'var(--brand)' : 'var(--text-muted)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <Palette size={14} /> Style
          </button>
          <button
            onClick={() => setActiveTab('visibility')}
            style={{
              padding: '10px 16px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'visibility' ? '2px solid var(--brand)' : '2px solid transparent',
              color: activeTab === 'visibility' ? 'var(--brand)' : 'var(--text-muted)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <Eye size={14} /> Visibility
          </button>
        </div>

        {/* Body Content */}
        <div style={{ padding: '20px', minHeight: 220, maxHeight: '60vh', overflowY: 'auto' }}>
          {/* TAB 1: INPUTS */}
          {activeTab === 'inputs' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* EMA / SMA Multi-length */}
              {(id === 'EMA' || id === 'MA' || id === 'SMA') && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Length 1 (Blue)</label>
                      <input 
                        type="number" 
                        value={params.p1 ?? 9} 
                        onChange={e => handleParamChange('p1', Number(e.target.value))}
                        className="modal-input"
                        min="1" max="1000"
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Length 2 (Orange)</label>
                      <input 
                        type="number" 
                        value={params.p2 ?? 21} 
                        onChange={e => handleParamChange('p2', Number(e.target.value))}
                        className="modal-input"
                        min="1" max="1000"
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Length 3 (Purple)</label>
                      <input 
                        type="number" 
                        value={params.p3 ?? 50} 
                        onChange={e => handleParamChange('p3', Number(e.target.value))}
                        className="modal-input"
                        min="1" max="1000"
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Length 4 (Yellow)</label>
                      <input 
                        type="number" 
                        value={params.p4 ?? 200} 
                        onChange={e => handleParamChange('p4', Number(e.target.value))}
                        className="modal-input"
                        min="1" max="1000"
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Source</label>
                    <select 
                      value={params.source || 'close'} 
                      onChange={e => handleParamChange('source', e.target.value)}
                      className="modal-input"
                    >
                      <option value="close">Close</option>
                      <option value="open">Open</option>
                      <option value="high">High</option>
                      <option value="low">Low</option>
                      <option value="hl2">(High + Low) / 2</option>
                      <option value="hlc3">(High + Low + Close) / 3</option>
                    </select>
                  </div>
                </>
              )}

              {/* BOLLINGER BANDS */}
              {id === 'BOLL' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Length</label>
                    <input 
                      type="number" 
                      value={params.length ?? 20} 
                      onChange={e => handleParamChange('length', Number(e.target.value))}
                      className="modal-input"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>StdDev Multiplier</label>
                    <input 
                      type="number" 
                      step="0.1"
                      value={params.multiplier ?? 2.0} 
                      onChange={e => handleParamChange('multiplier', Number(e.target.value))}
                      className="modal-input"
                    />
                  </div>
                </div>
              )}

              {/* PARABOLIC SAR */}
              {id === 'SAR' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Start</label>
                    <input 
                      type="number" 
                      step="0.01"
                      value={params.start ?? 0.02} 
                      onChange={e => handleParamChange('start', Number(e.target.value))}
                      className="modal-input"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Increment (Step)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      value={params.step ?? 0.02} 
                      onChange={e => handleParamChange('step', Number(e.target.value))}
                      className="modal-input"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Maximum</label>
                    <input 
                      type="number" 
                      step="0.01"
                      value={params.max ?? 0.2} 
                      onChange={e => handleParamChange('max', Number(e.target.value))}
                      className="modal-input"
                    />
                  </div>
                </div>
              )}

              {/* SUPERTREND */}
              {id === 'SUPERTREND' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>ATR Period</label>
                    <input 
                      type="number" 
                      value={params.period ?? 10} 
                      onChange={e => handleParamChange('period', Number(e.target.value))}
                      className="modal-input"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>ATR Multiplier</label>
                    <input 
                      type="number" 
                      step="0.5"
                      value={params.multiplier ?? 3.0} 
                      onChange={e => handleParamChange('multiplier', Number(e.target.value))}
                      className="modal-input"
                    />
                  </div>
                </div>
              )}

              {/* LUXALGO SMC */}
              {id === 'LuxAlgo_SMC' && (
                <>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Swing Lookback Period</label>
                    <input 
                      type="number" 
                      value={params.period ?? 10} 
                      onChange={e => handleParamChange('period', Number(e.target.value))}
                      className="modal-input"
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={params.showOB !== false} 
                        onChange={e => handleParamChange('showOB', e.target.checked)}
                      />
                      <span>Show Bullish & Bearish Order Blocks (OB)</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={params.showBOS !== false} 
                        onChange={e => handleParamChange('showBOS', e.target.checked)}
                      />
                      <span>Show Break of Structure (BOS) / CHoCH</span>
                    </label>
                  </div>
                </>
              )}

              {/* SIGNALS */}
              {id === 'SIGNALS' && (
                <>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Signal Strategy</label>
                    <select 
                      value={params.strategy || 'ALL'} 
                      onChange={e => handleParamChange('strategy', e.target.value)}
                      className="modal-input"
                    >
                      <option value="ALL">Dual Engine (All Confirmed Signals)</option>
                      <option value="SWING_CORE">Swing Core (Trend-Pullback, High Win Rate)</option>
                      <option value="SWING_PRO">Swing Pro (Macro Reversal Breakouts)</option>
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Minimum TP1 (R:R)</label>
                      <input 
                        type="number" 
                        step="0.1"
                        value={params.minRR ?? 1.5} 
                        onChange={e => handleParamChange('minRR', Number(e.target.value))}
                        className="modal-input"
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>SL Structure Lookback</label>
                      <input 
                        type="number" 
                        value={params.slLookback ?? 20} 
                        onChange={e => handleParamChange('slLookback', Number(e.target.value))}
                        className="modal-input"
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={params.showTPLines !== false} 
                        onChange={e => handleParamChange('showTPLines', e.target.checked)}
                      />
                      <span>Show TP1, TP2 & SL Target Reference Lines</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={params.showBadges !== false} 
                        onChange={e => handleParamChange('showBadges', e.target.checked)}
                      />
                      <span>Show Buy/Sell Visual Marker Badges on Candles</span>
                    </label>
                  </div>
                </>
              )}

              {/* MULTI-TF ZONES: S/R and ORDER BLOCKS */}
              {(id === 'SR_ZONES' || id === 'ORDER_BLOCKS') && (
                <>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    Choose which timeframes’ {id === 'SR_ZONES' ? 'support/resistance' : 'order-block'} zones to display, and a colour for each. Timeframes finer than the current chart are skipped automatically.
                  </div>
                  {['5M', '15M', '1H', '4H', '1D'].map(tf => {
                    const enabled = Array.isArray(params.tfs) && params.tfs.includes(tf);
                    const col = (params.colors && params.colors[tf]) || '#f7a600';
                    return (
                      <div key={tf} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: enabled ? 8 : 0 }}>
                          <input type="checkbox" checked={enabled}
                            onChange={e => {
                              const cur = Array.isArray(params.tfs) ? [...params.tfs] : [];
                              const next = e.target.checked ? Array.from(new Set([...cur, tf])) : cur.filter(x => x !== tf);
                              handleParamChange('tfs', next);
                            }} />
                          <span style={{ fontWeight: 600 }}>{tf}</span>
                          <span style={{ width: 12, height: 12, borderRadius: 3, background: col, marginLeft: 4 }} />
                        </label>
                        {enabled && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {PRESET_COLORS.map(c => (
                              <button key={c} onClick={() => handleParamChange('colors', { ...(params.colors || {}), [tf]: c })} title={c}
                                style={{ width: 20, height: 20, borderRadius: 4, background: c, cursor: 'pointer', padding: 0, border: col === c ? '2px solid #fff' : '1px solid rgba(0,0,0,0.3)' }} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Max zones / timeframe</label>
                      <input type="number" min="1" max="8" value={params.maxZones ?? (id === 'SR_ZONES' ? 3 : 4)} onChange={e => handleParamChange('maxZones', Number(e.target.value))} className="modal-input" />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>{id === 'SR_ZONES' ? 'Pivot strength' : 'ATR impulse length'}</label>
                      <input type="number" min="1" max="50" value={id === 'SR_ZONES' ? (params.pivot ?? 3) : (params.atrLen ?? 14)} onChange={e => handleParamChange(id === 'SR_ZONES' ? 'pivot' : 'atrLen', Number(e.target.value))} className="modal-input" />
                    </div>
                  </div>
                </>
              )}

              {/* RSI */}
              {id === 'RSI' && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Length</label>
                      <input 
                        type="number" 
                        value={params.period ?? 14} 
                        onChange={e => handleParamChange('period', Number(e.target.value))}
                        className="modal-input"
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Source</label>
                      <select 
                        value={params.source || 'close'} 
                        onChange={e => handleParamChange('source', e.target.value)}
                        className="modal-input"
                      >
                        <option value="close">Close</option>
                        <option value="open">Open</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Overbought Level</label>
                      <input 
                        type="number" 
                        value={params.overbought ?? 70} 
                        onChange={e => handleParamChange('overbought', Number(e.target.value))}
                        className="modal-input"
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Oversold Level</label>
                      <input 
                        type="number" 
                        value={params.oversold ?? 30} 
                        onChange={e => handleParamChange('oversold', Number(e.target.value))}
                        className="modal-input"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* MACD */}
              {id === 'MACD' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Fast Length</label>
                    <input 
                      type="number" 
                      value={params.fast ?? 12} 
                      onChange={e => handleParamChange('fast', Number(e.target.value))}
                      className="modal-input"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Slow Length</label>
                    <input 
                      type="number" 
                      value={params.slow ?? 26} 
                      onChange={e => handleParamChange('slow', Number(e.target.value))}
                      className="modal-input"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Signal Smoothing</label>
                    <input 
                      type="number" 
                      value={params.signal ?? 9} 
                      onChange={e => handleParamChange('signal', Number(e.target.value))}
                      className="modal-input"
                    />
                  </div>
                </div>
              )}

              {/* STOCHASTIC / KDJ */}
              {id === 'KDJ' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>%K Length</label>
                    <input 
                      type="number" 
                      value={params.k ?? 9} 
                      onChange={e => handleParamChange('k', Number(e.target.value))}
                      className="modal-input"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>%D Smoothing</label>
                    <input 
                      type="number" 
                      value={params.d ?? 3} 
                      onChange={e => handleParamChange('d', Number(e.target.value))}
                      className="modal-input"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>%J Smoothing</label>
                    <input 
                      type="number" 
                      value={params.j ?? 3} 
                      onChange={e => handleParamChange('j', Number(e.target.value))}
                      className="modal-input"
                    />
                  </div>
                </div>
              )}

              {/* Fallback generic length */}
              {!['EMA', 'MA', 'SMA', 'BOLL', 'SAR', 'SUPERTREND', 'LuxAlgo_SMC', 'SIGNALS', 'RSI', 'MACD', 'KDJ', 'SR_ZONES', 'ORDER_BLOCKS'].includes(id) && (
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Period / Lookback</label>
                  <input 
                    type="number" 
                    value={params.period ?? 14} 
                    onChange={e => handleParamChange('period', Number(e.target.value))}
                    className="modal-input"
                  />
                </div>
              )}
            </div>
          )}

          {/* TAB 2: STYLE */}
          {activeTab === 'style' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Lines Style List */}
              {(styles.lines || [
                { color: '#2962ff', size: 1.5, style: 'solid', title: 'Plot 1' },
                { color: '#ff9800', size: 1.5, style: 'solid', title: 'Plot 2' },
                { color: '#9c27b0', size: 1.5, style: 'solid', title: 'Plot 3' },
                { color: '#fdd835', size: 1.5, style: 'solid', title: 'Plot 4' }
              ]).slice(0, id === 'EMA' || id === 'MA' || id === 'SMA' ? 4 : id === 'BOLL' ? 3 : 2).map((line, idx) => (
                <div 
                  key={idx} 
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span 
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          background: line.color || '#2962ff',
                          display: 'inline-block',
                          boxShadow: '0 0 6px rgba(0,0,0,0.5)'
                        }}
                      />
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {id === 'EMA' ? `EMA ${[params.p1 ?? 9, params.p2 ?? 21, params.p3 ?? 50, params.p4 ?? 200][idx]}` :
                         id === 'BOLL' ? ['Basis', 'Upper Band', 'Lower Band'][idx] :
                         `Line ${idx + 1}`}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {/* Width */}
                      <select 
                        value={line.size || 1.5}
                        onChange={e => handleLineSizeChange(idx, e.target.value)}
                        style={{
                          background: 'var(--bg-card)',
                          color: 'var(--text)',
                          border: '1px solid var(--border)',
                          borderRadius: 4,
                          padding: '3px 6px',
                          fontSize: 11
                        }}
                      >
                        <option value="1">1px (Thin)</option>
                        <option value="1.5">1.5px (Normal)</option>
                        <option value="2">2px (Medium)</option>
                        <option value="3">3px (Thick)</option>
                      </select>

                      {/* Style */}
                      <select 
                        value={line.style || 'solid'}
                        onChange={e => handleLineStyleChange(idx, e.target.value)}
                        style={{
                          background: 'var(--bg-card)',
                          color: 'var(--text)',
                          border: '1px solid var(--border)',
                          borderRadius: 4,
                          padding: '3px 6px',
                          fontSize: 11
                        }}
                      >
                        <option value="solid">Solid ───</option>
                        <option value="dashed">Dashed ╌╌╌</option>
                        <option value="dotted">Dotted ···</option>
                      </select>
                    </div>
                  </div>

                  {/* Preset Colors Palette */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {PRESET_COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => handleLineColorChange(idx, c)}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 4,
                          background: c,
                          border: (line.color === c) ? '2px solid #fff' : '1px solid rgba(0,0,0,0.3)',
                          cursor: 'pointer',
                          padding: 0,
                          transform: (line.color === c) ? 'scale(1.15)' : 'none',
                          transition: 'all 0.1s ease'
                        }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 3: VISIBILITY */}
          {activeTab === 'visibility' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 6,
                border: '1px solid var(--border)',
                cursor: 'pointer'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Eye size={18} color={visible ? 'var(--brand)' : 'var(--text-muted)'} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Show Indicator on Chart</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Toggle visibility without removing</div>
                  </div>
                </div>
                <input 
                  type="checkbox" 
                  checked={visible} 
                  onChange={e => setVisible(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: 'var(--brand)' }}
                />
              </label>

              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, padding: '0 4px' }}>
                Indicators placed on the main chart overlay the price candlesticks. Sub-pane oscillators stack cleanly below. You can toggle visibility at any time from the on-chart indicator legend bar.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 20px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-card)'
        }}>
          <button
            onClick={handleResetDefaults}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '6px 12px',
              color: 'var(--text-muted)',
              fontSize: 12,
              cursor: 'pointer'
            }}
          >
            <RotateCcw size={13} /> Reset Defaults
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '6px 16px',
                color: 'var(--text)',
                fontSize: 13,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              style={{
                background: 'var(--brand)',
                border: 'none',
                borderRadius: 4,
                padding: '6px 20px',
                color: '#fff',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <Check size={15} /> Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
