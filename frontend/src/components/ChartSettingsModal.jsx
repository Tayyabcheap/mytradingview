import React, { useState } from 'react';
import { 
  X, Sliders, Palette, Eye, Grid, Globe, Zap, Check, 
  Layers, Target, BookOpen, ExternalLink, Activity, 
  Flame, Trophy, Cpu, ShieldCheck 
} from 'lucide-react';

export default function ChartSettingsModal({ 
  isOpen, 
  onClose, 
  currentSettings = {}, 
  onSaveSettings,
  activeSignalStrategies = {},
  onToggleSignalStrategy,
  botStatus = null,
  autoTradeSignals = true,
  onToggleAutoTrade,
  onNavigateToTab,
  initialTab = 'signals'
}) {
  const [activeTab, setActiveTab] = useState(initialTab || 'signals');
  const [upColor, setUpColor] = useState(currentSettings.upColor || '#089981');
  const [downColor, setDownColor] = useState(currentSettings.downColor || '#f23645');
  const [showGrid, setShowGrid] = useState(currentSettings.showGrid !== false);
  const [gridColor, setGridColor] = useState(currentSettings.gridColor || '#1f2430');
  const [showPriceLine, setShowPriceLine] = useState(currentSettings.showPriceLine !== false);
  const [showWatermark, setShowWatermark] = useState(currentSettings.showWatermark || false);
  const [timezone, setTimezone] = useState(currentSettings.timezone || 'UTC');

  if (!isOpen) return null;

  const handleSave = () => {
    if (onSaveSettings) {
      onSaveSettings({
        upColor,
        downColor,
        showGrid,
        gridColor,
        showPriceLine,
        showWatermark,
        timezone
      });
    }
    onClose();
  };

  const handleReset = () => {
    setUpColor('#089981');
    setDownColor('#f23645');
    setShowGrid(true);
    setGridColor('#1f2430');
    setShowPriceLine(true);
    setShowWatermark(false);
    setTimezone('UTC');
  };

  const activeCount = [
    activeSignalStrategies.TAYYAB_ENHANCED,
    activeSignalStrategies.CHAMPION_SCALPER,
    activeSignalStrategies.HAIDER_ENHANCED
  ].filter(Boolean).length;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 100050 }}>
      <div 
        className="modal-content" 
        style={{ 
          width: 760, 
          maxWidth: '94vw', 
          height: 560, 
          maxHeight: '90vh',
          display: 'flex', 
          flexDirection: 'column', 
          padding: 0,
          background: '#131722',
          border: '1px solid #2a2e39',
          borderRadius: 8,
          boxShadow: '0 16px 48px rgba(0,0,0,0.75)',
          overflow: 'hidden'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid #2a2e39',
          background: '#1a1e29'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sliders size={20} color="var(--brand, #2962ff)" />
            <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Chart Settings & Engines</span>
            {activeCount > 0 && (
              <span style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 12,
                background: 'rgba(16, 185, 129, 0.18)',
                color: '#10b981',
                border: '1px solid rgba(16, 185, 129, 0.4)'
              }}>
                {activeCount} Engine{activeCount > 1 ? 's' : ''} Live on MT5
              </span>
            )}
          </div>
          <button className="btn-icon" onClick={onClose}><X size={18}/></button>
        </div>

        {/* Body with Sidebar & Content */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Tabs Sidebar */}
          <div style={{
            width: 200,
            borderRight: '1px solid #2a2e39',
            padding: '14px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            background: '#151924'
          }}>
            {[
              { id: 'signals', label: 'Signals & Auto-Trade', icon: Zap, badge: 'Live MT5' },
              { id: 'modules', label: 'Analysis Tools & Tabs', icon: Layers },
              { id: 'symbol', label: 'Candles & Palette', icon: Palette },
              { id: 'appearance', label: 'Canvas & Grid', icon: Grid },
              { id: 'scales', label: 'Scales & Lines', icon: Eye },
              { id: 'timezone', label: 'Timezone', icon: Globe }
            ].map(tab => {
              const Icon = tab.icon;
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: 6,
                    border: isSelected ? '1px solid rgba(41, 98, 255, 0.4)' : '1px solid transparent',
                    background: isSelected ? 'rgba(41, 98, 255, 0.15)' : 'transparent',
                    color: isSelected ? '#fff' : '#8b949e',
                    cursor: 'pointer',
                    fontSize: 12.5,
                    fontWeight: isSelected ? 600 : 500,
                    textAlign: 'left',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#1e222d'; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <Icon size={15} color={isSelected ? 'var(--brand, #2962ff)' : '#6e7681'} />
                    <span>{tab.label}</span>
                  </div>
                  {tab.badge && (
                    <span style={{
                      fontSize: 9,
                      fontWeight: 800,
                      padding: '1px 5px',
                      borderRadius: 3,
                      background: 'rgba(16, 185, 129, 0.2)',
                      color: '#10b981',
                      border: '1px solid rgba(16, 185, 129, 0.4)'
                    }}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Content Pane */}
          <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto', background: '#131722' }}>
            
            {/* 1. SIGNALS & AUTO-TRADE SECTION */}
            {activeTab === 'signals' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Zap size={18} color="#00f2fe" />
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Autonomous Scalper Signals & MT5 Execution
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.5 }}>
                    Tick any strategy below. Checking a box <strong style={{ color: '#00f2fe' }}>immediately begins autonomous trading on MT5</strong> using your configured lot sizes, instruments, and timeframes.
                  </div>
                </div>

                {/* Status Bar */}
                <div style={{
                  padding: '12px 14px',
                  borderRadius: 6,
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid #2a2e39',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: activeCount > 0 ? '#10b981' : '#f59e0b',
                      boxShadow: activeCount > 0 ? '0 0 10px #10b981' : 'none'
                    }} />
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#d1d4dc' }}>
                        MT5 Bot Status: {activeCount > 0 ? <span style={{ color: '#10b981' }}>LIVE & EXECUTING</span> : <span style={{ color: '#f59e0b' }}>STANDBY</span>}
                      </div>
                      <div style={{ fontSize: 11, color: '#8b949e' }}>
                        {activeCount} of 3 scalper engines active for auto-execution
                      </div>
                    </div>
                  </div>

                  {onToggleAutoTrade && (
                    <button
                      onClick={onToggleAutoTrade}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 4,
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                        background: autoTradeSignals ? 'rgba(16, 185, 129, 0.2)' : 'rgba(242, 54, 69, 0.15)',
                        border: autoTradeSignals ? '1px solid #10b981' : '1px solid #f23645',
                        color: autoTradeSignals ? '#10b981' : '#f23645'
                      }}
                    >
                      {autoTradeSignals ? 'Auto-Trade: ON' : 'Auto-Trade: PAUSED'}
                    </button>
                  )}
                </div>

                {/* 3 Strategy Cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  
                  {/* ENGINE 1: Tayyab Scalper (94%+ WR) */}
                  <div 
                    style={{
                      padding: '14px 16px',
                      borderRadius: 6,
                      background: activeSignalStrategies.TAYYAB_ENHANCED ? 'rgba(168, 85, 247, 0.08)' : '#181c27',
                      border: activeSignalStrategies.TAYYAB_ENHANCED ? '1px solid rgba(168, 85, 247, 0.5)' : '1px solid #2a2e39',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <label 
                        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                        onClick={() => onToggleSignalStrategy && onToggleSignalStrategy('TAYYAB_ENHANCED')}
                      >
                        <div style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          border: activeSignalStrategies.TAYYAB_ENHANCED ? '1px solid #a855f7' : '1px solid #555d6e',
                          background: activeSignalStrategies.TAYYAB_ENHANCED ? '#a855f7' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer'
                        }}>
                          {activeSignalStrategies.TAYYAB_ENHANCED && <Check size={13} color="#fff" strokeWidth={3} />}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Flame size={17} color="#a855f7" />
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>Tayyab Scalper</span>
                          <span style={{
                            fontSize: 9.5,
                            fontWeight: 800,
                            padding: '1px 6px',
                            borderRadius: 3,
                            background: 'rgba(168, 85, 247, 0.25)',
                            color: '#c084fc',
                            border: '1px solid rgba(168, 85, 247, 0.4)'
                          }}>
                            94%+ WR
                          </span>
                        </div>
                      </label>

                      <div style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 4,
                        background: activeSignalStrategies.TAYYAB_ENHANCED ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                        color: activeSignalStrategies.TAYYAB_ENHANCED ? '#c084fc' : '#6e7681',
                        border: activeSignalStrategies.TAYYAB_ENHANCED ? '1px solid #a855f7' : '1px solid transparent'
                      }}>
                        {activeSignalStrategies.TAYYAB_ENHANCED ? '● LIVE TRADING ON MT5' : 'STANDBY / OFF'}
                      </div>
                    </div>

                    <div style={{ fontSize: 11.5, color: '#8b949e', marginBottom: 10, paddingLeft: 28 }}>
                      Anti-Hunt Dynamic SL (0.18) + 18% Wick Rejection + 4-Bar Liquidity Sweep. Instant auto-trade on signal generation.
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 28, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <span style={{ fontSize: 11, color: '#6e7681' }}>
                        Multiple Timeframes & Lots Configurable
                      </span>
                      {onNavigateToTab && (
                        <button
                          onClick={() => onNavigateToTab('tayyab_scalper')}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#a855f7',
                            fontSize: 11.5,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4
                          }}
                        >
                          Configure Lots & Timeframes <ExternalLink size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ENGINE 2: Champion Scalper (93%+ WR) */}
                  <div 
                    style={{
                      padding: '14px 16px',
                      borderRadius: 6,
                      background: activeSignalStrategies.CHAMPION_SCALPER ? 'rgba(16, 185, 129, 0.08)' : '#181c27',
                      border: activeSignalStrategies.CHAMPION_SCALPER ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid #2a2e39',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <label 
                        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                        onClick={() => onToggleSignalStrategy && onToggleSignalStrategy('CHAMPION_SCALPER')}
                      >
                        <div style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          border: activeSignalStrategies.CHAMPION_SCALPER ? '1px solid #10b981' : '1px solid #555d6e',
                          background: activeSignalStrategies.CHAMPION_SCALPER ? '#10b981' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer'
                        }}>
                          {activeSignalStrategies.CHAMPION_SCALPER && <Check size={13} color="#000" strokeWidth={3} />}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Trophy size={17} color="#10b981" />
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>Champion Scalper</span>
                          <span style={{
                            fontSize: 9.5,
                            fontWeight: 800,
                            padding: '1px 6px',
                            borderRadius: 3,
                            background: 'rgba(16, 185, 129, 0.25)',
                            color: '#34d399',
                            border: '1px solid rgba(16, 185, 129, 0.4)'
                          }}>
                            93%+ WR
                          </span>
                        </div>
                      </label>

                      <div style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 4,
                        background: activeSignalStrategies.CHAMPION_SCALPER ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                        color: activeSignalStrategies.CHAMPION_SCALPER ? '#34d399' : '#6e7681',
                        border: activeSignalStrategies.CHAMPION_SCALPER ? '1px solid #10b981' : '1px solid transparent'
                      }}>
                        {activeSignalStrategies.CHAMPION_SCALPER ? '● LIVE TRADING ON MT5' : 'STANDBY / OFF'}
                      </div>
                    </div>

                    <div style={{ fontSize: 11.5, color: '#8b949e', marginBottom: 10, paddingLeft: 28 }}>
                      Liquidity Sweep + Bollinger 2.5 Extremes + EMA 50 Trend Alignment. Instant auto-trade on signal generation.
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 28, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <span style={{ fontSize: 11, color: '#6e7681' }}>
                        Multiple Timeframes & Lots Configurable
                      </span>
                      {onNavigateToTab && (
                        <button
                          onClick={() => onNavigateToTab('champion_scalper')}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#10b981',
                            fontSize: 11.5,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4
                          }}
                        >
                          Configure Lots & Timeframes <ExternalLink size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ENGINE 3: Haider Scalper Neural (90%+ WR) */}
                  <div 
                    style={{
                      padding: '14px 16px',
                      borderRadius: 6,
                      background: activeSignalStrategies.HAIDER_ENHANCED ? 'rgba(0, 242, 254, 0.08)' : '#181c27',
                      border: activeSignalStrategies.HAIDER_ENHANCED ? '1px solid rgba(0, 242, 254, 0.5)' : '1px solid #2a2e39',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <label 
                        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                        onClick={() => onToggleSignalStrategy && onToggleSignalStrategy('HAIDER_ENHANCED')}
                      >
                        <div style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          border: activeSignalStrategies.HAIDER_ENHANCED ? '1px solid #00f2fe' : '1px solid #555d6e',
                          background: activeSignalStrategies.HAIDER_ENHANCED ? '#00f2fe' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer'
                        }}>
                          {activeSignalStrategies.HAIDER_ENHANCED && <Check size={13} color="#000" strokeWidth={3} />}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Cpu size={17} color="#00f2fe" />
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>Haider Scalper Neural</span>
                          <span style={{
                            fontSize: 9.5,
                            fontWeight: 800,
                            padding: '1px 6px',
                            borderRadius: 3,
                            background: 'rgba(0, 242, 254, 0.25)',
                            color: '#00f2fe',
                            border: '1px solid rgba(0, 242, 254, 0.4)'
                          }}>
                            90%+ WR
                          </span>
                        </div>
                      </label>

                      <div style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 4,
                        background: activeSignalStrategies.HAIDER_ENHANCED ? 'rgba(0, 242, 254, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                        color: activeSignalStrategies.HAIDER_ENHANCED ? '#00f2fe' : '#6e7681',
                        border: activeSignalStrategies.HAIDER_ENHANCED ? '1px solid #00f2fe' : '1px solid transparent'
                      }}>
                        {activeSignalStrategies.HAIDER_ENHANCED ? '● LIVE TRADING ON MT5' : 'STANDBY / OFF'}
                      </div>
                    </div>

                    <div style={{ fontSize: 11.5, color: '#8b949e', marginBottom: 10, paddingLeft: 28 }}>
                      Anti-Hunt Dynamic SL + 18% Wick Rejection + Auto-BE Runner. Instant auto-trade on signal generation.
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 28, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <span style={{ fontSize: 11, color: '#6e7681' }}>
                        Multiple Timeframes & Lots Configurable
                      </span>
                      {onNavigateToTab && (
                        <button
                          onClick={() => onNavigateToTab('neural_sentinel')}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#00f2fe',
                            fontSize: 11.5,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4
                          }}
                        >
                          Configure Lots & Timeframes <ExternalLink size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                </div>
              </div>
            )}

            {/* 2. MODULES & ANALYSIS TOOLS TAB */}
            {activeTab === 'modules' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Layers size={18} color="#38bdf8" />
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Workspace Analysis Tools & Tabs
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.5 }}>
                    Open any of the specialized analysis modules below. These tabs provide in-depth smart money analysis, order flow, historical trade logs, and quantitative stress tests.
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  
                  {/* Tool 1: Gold Order Blocks */}
                  <div style={{
                    padding: '14px',
                    borderRadius: 6,
                    background: '#181c27',
                    border: '1px solid #2a2e39',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Layers size={16} color="#ffd700" />
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Gold Order Blocks</span>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#ffd700', background: 'rgba(255,215,0,0.15)', padding: '1px 6px', borderRadius: 3 }}>
                          SMC / Order Flow
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: '#8b949e', lineHeight: 1.4, marginBottom: 12 }}>
                        Smart money institutional order blocks, liquidity voids, and Fair Value Gaps (FVG) for Gold & Forex.
                      </div>
                    </div>
                    <button
                      onClick={() => onNavigateToTab && onNavigateToTab('gold_order_blocks')}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 4,
                        background: 'rgba(255, 215, 0, 0.12)',
                        border: '1px solid rgba(255, 215, 0, 0.3)',
                        color: '#ffd700',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6
                      }}
                    >
                      Open Gold Order Blocks <ExternalLink size={13} />
                    </button>
                  </div>

                  {/* Tool 2: Support & Resistance */}
                  <div style={{
                    padding: '14px',
                    borderRadius: 6,
                    background: '#181c27',
                    border: '1px solid #2a2e39',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Target size={16} color="#38bdf8" />
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Support & Resistance</span>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#38bdf8', background: 'rgba(56,189,248,0.15)', padding: '1px 6px', borderRadius: 3 }}>
                          Key Levels
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: '#8b949e', lineHeight: 1.4, marginBottom: 12 }}>
                        Multi-timeframe swing high/low clusters, structural pivots, and major liquidity sweep zones.
                      </div>
                    </div>
                    <button
                      onClick={() => onNavigateToTab && onNavigateToTab('support_resistance')}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 4,
                        background: 'rgba(56, 189, 248, 0.12)',
                        border: '1px solid rgba(56, 189, 248, 0.3)',
                        color: '#38bdf8',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6
                      }}
                    >
                      Open S&R Analysis <ExternalLink size={13} />
                    </button>
                  </div>

                  {/* Tool 3: Trade Journal */}
                  <div style={{
                    padding: '14px',
                    borderRadius: 6,
                    background: '#181c27',
                    border: '1px solid #2a2e39',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <BookOpen size={16} color="#34d399" />
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Trade Journal</span>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#34d399', background: 'rgba(52,211,153,0.15)', padding: '1px 6px', borderRadius: 3 }}>
                          Audit / Logs
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: '#8b949e', lineHeight: 1.4, marginBottom: 12 }}>
                        MT5 real-time trade logs, execution histories, win rate statistics, and net PnL accounting.
                      </div>
                    </div>
                    <button
                      onClick={() => onNavigateToTab && onNavigateToTab('journal')}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 4,
                        background: 'rgba(52, 211, 153, 0.12)',
                        border: '1px solid rgba(52, 211, 153, 0.3)',
                        color: '#34d399',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6
                      }}
                    >
                      Open Trade Journal <ExternalLink size={13} />
                    </button>
                  </div>

                  {/* Tool 4: Monte Carlo Stress Lab */}
                  <div style={{
                    padding: '14px',
                    borderRadius: 6,
                    background: '#181c27',
                    border: '1px solid #2a2e39',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Sliders size={16} color="#c084fc" />
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Monte Carlo Stress Lab</span>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#c084fc', background: 'rgba(192,132,252,0.15)', padding: '1px 6px', borderRadius: 3 }}>
                          Quant Lab
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: '#8b949e', lineHeight: 1.4, marginBottom: 12 }}>
                        5,000-iteration Monte Carlo permutation stress lab, drawdown distribution, and risk of ruin model.
                      </div>
                    </div>
                    <button
                      onClick={() => onNavigateToTab && onNavigateToTab('monte_carlo')}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 4,
                        background: 'rgba(192, 132, 252, 0.12)',
                        border: '1px solid rgba(192, 132, 252, 0.3)',
                        color: '#c084fc',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6
                      }}
                    >
                      Open Stress Lab <ExternalLink size={13} />
                    </button>
                  </div>

                </div>
              </div>
            )}

            {/* 3. SYMBOL & CANDLESTICK PALETTE */}
            {activeTab === 'symbol' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)' }}>CANDLESTICK PALETTE</div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13 }}>Bullish (Up) Candle Color</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input 
                      type="color" 
                      value={upColor} 
                      onChange={e => setUpColor(e.target.value)} 
                      style={{ cursor: 'pointer', border: 'none', background: 'none', width: 32, height: 32 }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{upColor}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13 }}>Bearish (Down) Candle Color</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input 
                      type="color" 
                      value={downColor} 
                      onChange={e => setDownColor(e.target.value)} 
                      style={{ cursor: 'pointer', border: 'none', background: 'none', width: 32, height: 32 }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{downColor}</span>
                  </div>
                </div>
              </div>
            )}

            {/* 4. CANVAS & GRID */}
            {activeTab === 'appearance' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)' }}>GRID & CANVAS</div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13 }}>Show Background Grid Lines</span>
                  <input 
                    type="checkbox" 
                    checked={showGrid} 
                    onChange={e => setShowGrid(e.target.checked)} 
                    style={{ cursor: 'pointer' }}
                  />
                </div>

                {showGrid && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13 }}>Grid Line Color</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input 
                        type="color" 
                        value={gridColor} 
                        onChange={e => setGridColor(e.target.value)} 
                        style={{ cursor: 'pointer', border: 'none', background: 'none', width: 32, height: 32 }}
                      />
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{gridColor}</span>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13 }}>Show Background Symbol Watermark</span>
                  <input 
                    type="checkbox" 
                    checked={showWatermark} 
                    onChange={e => setShowWatermark(e.target.checked)} 
                    style={{ cursor: 'pointer' }}
                  />
                </div>
              </div>
            )}

            {/* 5. SCALES & LINES */}
            {activeTab === 'scales' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)' }}>PRICE SCALES & AXIS</div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13 }}>Show Last Price Marker</span>
                  <input 
                    type="checkbox" 
                    checked={showPriceLine} 
                    onChange={e => setShowPriceLine(e.target.checked)} 
                    style={{ cursor: 'pointer' }}
                  />
                </div>
              </div>
            )}

            {/* 6. TIMEZONE */}
            {activeTab === 'timezone' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)' }}>TIMEZONE SETTINGS</div>

                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
                    Select Chart Timezone
                  </label>
                  <select
                    value={timezone}
                    onChange={e => setTimezone(e.target.value)}
                    style={{
                      width: '100%',
                      background: '#1e222d',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      borderRadius: 6,
                      padding: '8px 12px',
                      fontSize: 13
                    }}
                  >
                    <option value="UTC">UTC (Universal Coordinated Time)</option>
                    <option value="America/New_York">UTC-4 (New York)</option>
                    <option value="Europe/London">UTC+1 (London)</option>
                    <option value="Asia/Dubai">UTC+4 (Dubai)</option>
                    <option value="Asia/Tokyo">UTC+9 (Tokyo)</option>
                    <option value="Asia/Singapore">UTC+8 (Singapore / Hong Kong)</option>
                  </select>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 20px',
          borderTop: '1px solid #2a2e39',
          background: '#1a1e29'
        }}>
          <button 
            onClick={handleReset}
            style={{
              background: 'transparent',
              border: '1px solid #2a2e39',
              color: 'var(--text-muted)',
              borderRadius: 4,
              padding: '6px 14px',
              fontSize: 12,
              cursor: 'pointer'
            }}
          >
            Reset Defaults
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button 
              onClick={onClose}
              style={{
                background: 'transparent',
                border: '1px solid #2a2e39',
                color: 'var(--text)',
                borderRadius: 4,
                padding: '6px 16px',
                fontSize: 12,
                cursor: 'pointer'
              }}
            >
              Close
            </button>
            <button 
              onClick={handleSave}
              style={{
                background: 'var(--brand, #2962ff)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '6px 18px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Apply Visual Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
