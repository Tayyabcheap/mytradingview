import React, { useState } from 'react';
import { Search, Star, X, Check, Activity, TrendingUp, Cpu, Sparkles, Zap, Plus } from 'lucide-react';

const INDICATOR_LIBRARY = [
  // Algorithmic Signals & Strategies
  {
    id: 'SIGNALS',
    name: 'Dual-Strategy Algorithmic Signals',
    shortName: 'Signals',
    category: 'Strategies',
    desc: 'Live Pullback (Swing Core) & Breakout (Swing Pro) Buy/Sell execution signals with SL/TP targets',
    isStack: false,
    isOverlay: true,
    author: 'Quant Engine'
  },
  {
    id: 'GOLD_SCALPER',
    name: 'Gold Scalper Pro (EMA Cross + RSI + ATR)',
    shortName: 'Gold Scalper',
    category: 'Strategies',
    desc: 'EMA 21/50 crossover with RSI momentum filter, session window, and ATR-based SL/TP. Ported from the Gold Scalper Pro Pine strategy',
    isStack: false,
    isOverlay: true,
    author: 'Ported (Pine v6)'
  },
  // Smart Money Concepts
  {
    id: 'LuxAlgo_SMC',
    name: 'Smart Money Concepts [LuxAlgo]',
    shortName: 'Lux SMC',
    category: 'Smart Money Concepts',
    desc: 'Real-time Order Blocks, Break of Structure (BOS), and Change of Character (CHoCH)',
    isStack: false,
    isOverlay: true,
    author: 'LuxAlgo',
    boost: 99999
  },
  {
    id: 'SR_ZONES',
    name: 'Support & Resistance Zones (Multi-TF)',
    shortName: 'S/R Zones',
    category: 'Smart Money Concepts',
    desc: 'Shaded S/R zones from swing pivots across 5M-1D; choose timeframes & colors in settings',
    isStack: false,
    isOverlay: true,
    author: 'Zone Engine',
    boost: 99998
  },
  {
    id: 'ORDER_BLOCKS',
    name: 'Order Block Zones (Multi-TF)',
    shortName: 'Order Blocks',
    category: 'Smart Money Concepts',
    desc: 'Bullish/bearish institutional order-block zones across 5M-1D; timeframes & colors in settings',
    isStack: false,
    isOverlay: true,
    author: 'Zone Engine',
    boost: 99997
  },
  // Trend / Moving Averages (Main Chart Overlays)
  {
    id: 'EMA',
    name: 'Moving Average Exponential (Multi)',
    shortName: 'EMA',
    category: 'Technicals',
    desc: 'Exponential Moving Average (customizable periods e.g. 9, 21, 50, 200)',
    isStack: false,
    isOverlay: true
  },
  {
    id: 'MA',
    name: 'Moving Average Simple (Multi)',
    shortName: 'SMA',
    category: 'Technicals',
    desc: 'Simple Moving Average over specified lookback periods (e.g. 20, 50, 100, 200)',
    isStack: false,
    isOverlay: true
  },
  {
    id: 'BOLL',
    name: 'Bollinger Bands',
    shortName: 'BB',
    category: 'Technicals',
    desc: 'Volatility bands placed above and below a moving average',
    isStack: false,
    isOverlay: true
  },
  {
    id: 'SUPERTREND',
    name: 'Supertrend ATR Indicator',
    shortName: 'Supertrend',
    category: 'Technicals',
    desc: 'Trend-following overlay using Average True Range (ATR) stops',
    isStack: false,
    isOverlay: true
  },
  {
    id: 'SAR',
    name: 'Parabolic SAR',
    shortName: 'SAR',
    category: 'Technicals',
    desc: 'Stop and Reverse indicator identifying potential reversals',
    isStack: false,
    isOverlay: true
  },
  {
    id: 'VWAP',
    name: 'Volume Weighted Average Price',
    shortName: 'VWAP',
    category: 'Technicals',
    desc: 'Intraday benchmark price based on total volume and price',
    isStack: false,
    isOverlay: true
  },
  // Oscillators (Sub-panes)
  {
    id: 'RSI',
    name: 'Relative Strength Index',
    shortName: 'RSI',
    category: 'Oscillators',
    desc: 'Momentum oscillator measuring speed and change of price movements (70/30 bands)',
    isStack: true,
    isOverlay: false
  },
  {
    id: 'MACD',
    name: 'Moving Average Convergence Divergence',
    shortName: 'MACD',
    category: 'Oscillators',
    desc: 'Trend-following momentum indicator showing relationship between two EMAs and histogram',
    isStack: true,
    isOverlay: false
  },
  {
    id: 'VOL',
    name: 'Volume',
    shortName: 'VOL',
    category: 'Oscillators',
    desc: 'Tick volume histogram showing trading intensity',
    isStack: true,
    isOverlay: false
  },
  {
    id: 'KDJ',
    name: 'Stochastic Oscillator (KDJ)',
    shortName: 'KDJ',
    category: 'Oscillators',
    desc: 'Momentum indicator comparing closing price to a price range',
    isStack: true,
    isOverlay: false
  },
  {
    id: 'CCI',
    name: 'Commodity Channel Index',
    shortName: 'CCI',
    category: 'Oscillators',
    desc: 'Oscillator identifying cyclical trends and overbought/oversold levels',
    isStack: true,
    isOverlay: false
  },
  {
    id: 'OBV',
    name: 'On Balance Volume',
    shortName: 'OBV',
    category: 'Oscillators',
    desc: 'Cumulative volume indicator relating price change to volume',
    isStack: true,
    isOverlay: false
  },
  {
    id: 'WR',
    name: "Williams %R",
    shortName: '%R',
    category: 'Oscillators',
    desc: 'Momentum indicator that measures overbought and oversold levels',
    isStack: true,
    isOverlay: false
  },
  {
    id: 'AO',
    name: 'Awesome Oscillator',
    shortName: 'AO',
    category: 'Oscillators',
    desc: 'Market momentum indicator using 34 and 5 period simple moving averages',
    isStack: true,
    isOverlay: false
  }
,
  // ── Premium / Volatility additions ──────────────────────────────
  {
    id: 'ATR', name: 'Average True Range (Volatility)', shortName: 'ATR', category: 'Oscillators',
    desc: 'Measures market volatility — the average range price travels per bar. Great for sizing stops.',
    isStack: true, isOverlay: false, author: 'Premium'
  },
  {
    id: 'ICHIMOKU', name: 'Ichimoku Cloud', shortName: 'Ichimoku', category: 'Technicals',
    desc: 'Full Ichimoku Kinko Hyo — Tenkan, Kijun, and a shaded leading-span cloud for trend, support & momentum',
    isStack: false, isOverlay: true, author: 'Premium'
  },
  {
    id: 'KELTNER', name: 'Keltner Channels', shortName: 'Keltner', category: 'Technicals',
    desc: 'ATR-based volatility channels around an EMA basis — breakout and mean-reversion zones',
    isStack: false, isOverlay: true, author: 'Premium'
  },
  {
    id: 'DONCHIAN', name: 'Donchian Channels', shortName: 'Donchian', category: 'Technicals',
    desc: 'Highest-high / lowest-low channel — the classic turtle breakout indicator',
    isStack: false, isOverlay: true, author: 'Premium'
  },
  {
    id: 'STOCHRSI', name: 'Stochastic RSI', shortName: 'StochRSI', category: 'Oscillators',
    desc: 'Stochastic applied to RSI — a faster, more sensitive overbought/oversold oscillator',
    isStack: true, isOverlay: false, author: 'Premium'
  },
  {
    id: 'DMI', name: 'ADX / DMI (Trend Strength)', shortName: 'ADX', category: 'Oscillators',
    desc: 'Directional Movement Index with ADX — measures how strong a trend is (not its direction)',
    isStack: true, isOverlay: false, author: 'Premium'
  },
  {
    id: 'TRIX', name: 'TRIX Oscillator', shortName: 'TRIX', category: 'Oscillators',
    desc: 'Triple-smoothed EMA rate-of-change — filters market noise to show the underlying trend',
    isStack: true, isOverlay: false
  },
  {
    id: 'BBI', name: 'Bull & Bear Index (BBI)', shortName: 'BBI', category: 'Technicals',
    desc: 'Average of four moving averages — a smoothed trend line balancing short and long term',
    isStack: false, isOverlay: true
  }
];

const CATEGORIES = [
  { id: 'all', label: 'All Indicators', icon: Sparkles },
  { id: 'Strategies', label: 'Signals & Strategies', icon: Zap },
  { id: 'Smart Money Concepts', label: 'Smart Money Concepts', icon: Cpu },
  { id: 'Technicals', label: 'Main Chart Overlays', icon: TrendingUp },
  { id: 'Oscillators', label: 'Sub-Pane Oscillators', icon: Activity },
  { id: 'active', label: 'Active on Chart', icon: Check }
];

export default function IndicatorsModal({ 
  isOpen, 
  onClose, 
  activeIndicators = [], 
  onToggleIndicator 
}) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [favorites, setFavorites] = useState(['SIGNALS', 'LuxAlgo_SMC', 'EMA', 'BOLL', 'RSI']);

  if (!isOpen) return null;

  const toggleFavorite = (id, e) => {
    e.stopPropagation();
    setFavorites(prev => 
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    );
  };

  // Check if indicator is active (handles both list of objects and list of string IDs)
  const isIndicatorActive = (indId) => {
    return activeIndicators.some(item => 
      typeof item === 'string' ? item === indId : item.id === indId
    );
  };

  const filteredIndicators = INDICATOR_LIBRARY.filter(ind => {
    const matchesSearch = ind.name.toLowerCase().includes(search.toLowerCase()) || 
                          ind.shortName.toLowerCase().includes(search.toLowerCase());
    if (selectedCategory === 'all') return matchesSearch;
    if (selectedCategory === 'active') return matchesSearch && isIndicatorActive(ind.id);
    return matchesSearch && ind.category === selectedCategory;
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal-content" 
        style={{ width: 800, maxWidth: '92vw', height: 580, display: 'flex', flexDirection: 'column', padding: 0 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Activity size={20} color="var(--brand)" />
            <span style={{ fontSize: 16, fontWeight: 700 }}>Indicators, Signals & Strategies</span>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={18}/></button>
        </div>

        {/* Search Bar */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '8px 12px',
            gap: 10
          }}>
            <Search size={16} color="var(--text-muted)" />
            <input
              type="text"
              placeholder="Search indicators, signals, overlays, oscillators (e.g. Signals, EMA, SMC, RSI)..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text)',
                fontSize: 14,
                width: '100%'
              }}
            />
            {search && (
              <button className="btn-icon" onClick={() => setSearch('')} style={{ padding: 2 }}>
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Main Body with Sidebar + List */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Categories Sidebar */}
          <div style={{
            width: 230,
            borderRight: '1px solid var(--border)',
            padding: '12px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4
          }}>
            {CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const isSelected = selectedCategory === cat.id;
              const count = cat.id === 'active' ? activeIndicators.length : null;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: isSelected ? 'rgba(41, 98, 255, 0.15)' : 'transparent',
                    color: isSelected ? 'var(--brand)' : 'var(--text)',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: isSelected ? 600 : 400,
                    textAlign: 'left'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon size={16} />
                    <span>{cat.label}</span>
                  </div>
                  {count !== null && count > 0 && (
                    <span style={{
                      background: 'var(--brand)',
                      color: '#fff',
                      borderRadius: 10,
                      padding: '1px 6px',
                      fontSize: 11,
                      fontWeight: 700
                    }}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Indicators List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
            {filteredIndicators.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                No indicators found matching "{search}"
              </div>
            ) : (
              filteredIndicators.map(ind => {
                const isActive = isIndicatorActive(ind.id);
                const isFav = favorites.includes(ind.id);
                return (
                  <div
                    key={ind.id}
                    onClick={() => onToggleIndicator(ind)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderRadius: 6,
                      marginBottom: 4,
                      background: isActive ? 'rgba(8, 153, 129, 0.08)' : 'transparent',
                      border: isActive ? '1px solid rgba(8, 153, 129, 0.3)' : '1px solid transparent',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={e => {
                      if (!isActive) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                    }}
                    onMouseLeave={e => {
                      if (!isActive) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <button 
                        onClick={e => toggleFavorite(ind.id, e)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          color: isFav ? '#f7a600' : 'var(--text-muted)',
                          display: 'flex'
                        }}
                      >
                        <Star size={16} fill={isFav ? '#f7a600' : 'none'} />
                      </button>

                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                            {ind.name}
                          </span>
                          <span style={{
                            background: ind.isOverlay ? 'rgba(41, 98, 255, 0.15)' : 'rgba(255, 109, 0, 0.15)',
                            color: ind.isOverlay ? 'var(--brand)' : '#ff6d00',
                            padding: '1px 6px',
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 700
                          }}>
                            {ind.isOverlay ? 'Main Overlay' : 'Sub-Pane'}
                          </span>
                          {ind.author && (
                            <span style={{ color: 'var(--brand)', fontSize: 11, fontWeight: 600 }}>
                              by {ind.author}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {ind.desc}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {isActive ? (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6
                        }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            color: '#089981',
                            fontSize: 12,
                            fontWeight: 600
                          }}>
                            <Check size={14} strokeWidth={3} />
                            <span>Applied</span>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleIndicator({ ...ind, forceAdd: true });
                            }}
                            style={{
                              background: 'rgba(255,255,255,0.08)',
                              border: 'none',
                              color: 'var(--text)',
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontSize: 11,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 2
                            }}
                            title="Add another instance"
                          >
                            <Plus size={11} /> Add More
                          </button>
                        </div>
                      ) : (
                        <button
                          style={{
                            background: 'rgba(41, 98, 255, 0.12)',
                            color: 'var(--brand)',
                            border: '1px solid rgba(41, 98, 255, 0.3)',
                            padding: '4px 10px',
                            borderRadius: 4,
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          + Add to Chart
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 20px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-card)',
          fontSize: 12,
          color: 'var(--text-muted)'
        }}>
          <div>
            Active: <strong style={{ color: 'var(--text)' }}>{activeIndicators.length}</strong> indicator{activeIndicators.length !== 1 ? 's' : ''} on chart (Max: 10)
          </div>
          <button 
            onClick={onClose}
            style={{
              background: 'var(--brand)',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '6px 18px',
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
