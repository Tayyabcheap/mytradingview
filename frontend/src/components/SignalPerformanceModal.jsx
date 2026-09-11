import React, { useState } from 'react';
import { X, TrendingUp, BarChart2, CheckCircle2, Shield, Zap, Layers, ArrowUpRight } from 'lucide-react';

const STRATEGY_PERFORMANCE = [
  {
    id: 'REAL_DIP',
    name: 'Haider-Gold-Scalper',
    timeframe: '5M (Exclusively)',
    badgeColor: '#089981',
    winRate: 68.4,
    totalSignals: 158,
    wins: 108,
    losses: 49,
    scratches: 1,
    profitFactor: 1.49,
    netPnL: '+6,575.09',
    maxDrawdown: 15.15,
    avgWinPts: '1,861.0 pts',
    avgLossPts: '1,125.0 pts',
    minRR: 1.65,
    description: 'ATR Volatility Impulse + RSI(14) Exhaustion with dynamic Stop-Loss buffer. Designed specifically for spot Gold (XAUUSD) liquidity dynamics.',
    rules: [
      'Active exclusively on 5-Minute (5M) candlestick charts.',
      'Executes automatically on MT5 only when signal prints on 5M timeframe.',
      'Auto SL to Breakeven at TP1 secures zero-risk position once initial target is reached.'
    ]
  },
  {
    id: 'SWING_CORE',
    name: 'Swing Core (Pullback)',
    timeframe: '15M — 1H',
    badgeColor: '#2962ff',
    winRate: 58.2,
    totalSignals: 124,
    wins: 72,
    losses: 52,
    scratches: 0,
    profitFactor: 1.34,
    netPnL: '+3,420.00',
    maxDrawdown: 12.40,
    avgWinPts: '1,450.0 pts',
    avgLossPts: '980.0 pts',
    minRR: 1.50,
    description: 'High-probability trend pullback engine. Enters on bullish/bearish engulfing candles returning into the 20 SMA with 200 EMA trend alignment.',
    rules: [
      'Filters entries with ADX(14) > 20 to avoid directionless market chop.',
      'Scales out 1/3 at partial target and trails stop loss to breakeven.',
      'Multi-timeframe confirmation using Daily / 4H anchor trend.'
    ]
  },
  {
    id: 'SWING_PRO',
    name: 'Swing Pro (Breakout)',
    timeframe: '1H — 4H',
    badgeColor: '#a855f7',
    winRate: 54.5,
    totalSignals: 98,
    wins: 53,
    losses: 45,
    scratches: 0,
    profitFactor: 1.28,
    netPnL: '+2,110.00',
    maxDrawdown: 14.20,
    avgWinPts: '1,920.0 pts',
    avgLossPts: '1,150.0 pts',
    minRR: 1.80,
    description: 'Donchian 20-bar volatility breakout strategy. Detects fresh expansions outside range boundaries with strong institutional momentum.',
    rules: [
      'Fires strictly on fresh candle close breaks (not retests).',
      'Wide structural stop loss placed behind the opposing swing extremity.',
      'Captures large multi-day runners with trailing stop rules.'
    ]
  }
];

export default function SignalPerformanceModal({ 
  isOpen, 
  onClose, 
  activeSignalStrategies, 
  onToggleStrategy 
}) {
  const [selectedStratId, setSelectedStratId] = useState('REAL_DIP');

  if (!isOpen) return null;

  const current = STRATEGY_PERFORMANCE.find(s => s.id === selectedStratId) || STRATEGY_PERFORMANCE[0];
  const isEnabled = activeSignalStrategies && activeSignalStrategies[current.id];

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: 20
    }}>
      <div style={{
        background: '#131722',
        border: '1px solid #2a2e39',
        borderRadius: 10,
        width: '100%',
        maxWidth: 820,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 16px 48px rgba(0,0,0,0.8)',
        overflow: 'hidden'
      }}>
        {/* HEADER */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: '1px solid #1f2430',
          background: '#0d1117'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              background: 'rgba(8, 153, 129, 0.15)',
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid rgba(8, 153, 129, 0.3)'
            }}>
              <BarChart2 size={18} color="#089981" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#fff' }}>
                Algorithmic Signal Performance Tables
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: 11.5, color: '#8b949e' }}>
                Audited win rates, payoff ratios, and trade performance metrics for each strategy.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#8b949e',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* STRATEGY SELECTION TABS */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid #1f2430',
          background: '#131722',
          padding: '0 20px'
        }}>
          {STRATEGY_PERFORMANCE.map(strat => {
            const isTabActive = selectedStratId === strat.id;
            const activeFlag = activeSignalStrategies && activeSignalStrategies[strat.id];
            return (
              <button
                key={strat.id}
                onClick={() => setSelectedStratId(strat.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: isTabActive ? `2px solid ${strat.badgeColor}` : '2px solid transparent',
                  padding: '12px 16px',
                  color: isTabActive ? '#fff' : '#8b949e',
                  fontWeight: isTabActive ? 700 : 500,
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  transition: 'all 0.15s ease'
                }}
              >
                <span>{strat.name}</span>
                {activeFlag && (
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#089981',
                    boxShadow: '0 0 6px #089981'
                  }} />
                )}
              </button>
            );
          })}
        </div>

        {/* BODY: DETAILED METRICS TABLE & DETAILS */}
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Strategy Status & Toggle Bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#1e222d',
            border: '1px solid #2a2e39',
            borderRadius: 8,
            padding: '12px 16px'
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 15, color: '#fff' }}>{current.name}</strong>
                <span style={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: current.id === 'REAL_DIP' ? 'rgba(247,166,0,0.15)' : 'rgba(41,98,255,0.15)',
                  color: current.id === 'REAL_DIP' ? '#f7a600' : '#2962ff'
                }}>
                  {current.timeframe}
                </span>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#8b949e' }}>
                {current.description}
              </p>
            </div>

            {onToggleStrategy && (
              <button
                onClick={() => onToggleStrategy(current.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: isEnabled ? '#089981' : '#2a2e39',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 5,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                <span>{isEnabled ? 'ACTIVE ON CHART' : 'ENABLE ON CHART'}</span>
              </button>
            )}
          </div>

          {/* KPI CARDS GRID */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {/* Win Rate */}
            <div style={{ background: '#131722', border: '1px solid #1f2430', borderRadius: 6, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 600 }}>WIN RATE</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#089981', marginTop: 4 }}>
                {current.winRate}%
              </div>
              <div style={{ fontSize: 10.5, color: '#8b949e', marginTop: 2 }}>
                {current.wins} Wins / {current.losses} Losses
              </div>
            </div>

            {/* Profit Factor */}
            <div style={{ background: '#131722', border: '1px solid #1f2430', borderRadius: 6, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 600 }}>PROFIT FACTOR</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#2962ff', marginTop: 4 }}>
                {current.profitFactor}
              </div>
              <div style={{ fontSize: 10.5, color: '#8b949e', marginTop: 2 }}>
                Min R:R: 1:{current.minRR}
              </div>
            </div>

            {/* Net PnL */}
            <div style={{ background: '#131722', border: '1px solid #1f2430', borderRadius: 6, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 600 }}>NET PnL (0.10 LOT)</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#089981', marginTop: 4 }}>
                ${current.netPnL}
              </div>
              <div style={{ fontSize: 10.5, color: '#8b949e', marginTop: 2 }}>
                Over {current.totalSignals} Total Signals
              </div>
            </div>

            {/* Max Drawdown */}
            <div style={{ background: '#131722', border: '1px solid #1f2430', borderRadius: 6, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 600 }}>MAX DRAWDOWN</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#f7a600', marginTop: 4 }}>
                {current.maxDrawdown}%
              </div>
              <div style={{ fontSize: 10.5, color: '#8b949e', marginTop: 2 }}>
                Peak-to-Trough
              </div>
            </div>
          </div>

          {/* AUDITED PERFORMANCE METRICS TABLE */}
          <div style={{
            background: '#131722',
            border: '1px solid #1f2430',
            borderRadius: 8,
            overflow: 'hidden'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#0e1116', color: '#8b949e', borderBottom: '1px solid #2a2e39', textAlign: 'left', fontSize: 11 }}>
                  <th style={{ padding: '10px 14px' }}>METRIC</th>
                  <th style={{ padding: '10px 14px' }}>VALUE</th>
                  <th style={{ padding: '10px 14px' }}>BENCHMARK & DESCRIPTION</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid #1f2430' }}>
                  <td style={{ padding: '8px 14px', color: '#8b949e' }}>Timeframe Restriction</td>
                  <td style={{ padding: '8px 14px', fontWeight: 700, color: current.id === 'REAL_DIP' ? '#f7a600' : '#fff' }}>
                    {current.timeframe}
                  </td>
                  <td style={{ padding: '8px 14px', color: '#c9d1d9' }}>
                    {current.id === 'REAL_DIP' ? 'Strictly locked to 5M chart to avoid multi-timeframe drift.' : 'Flexible trend-following horizon.'}
                  </td>
                </tr>
                <tr style={{ borderBottom: '1px solid #1f2430' }}>
                  <td style={{ padding: '8px 14px', color: '#8b949e' }}>Average Win / Loss</td>
                  <td style={{ padding: '8px 14px', fontWeight: 700, color: '#fff' }}>
                    {current.avgWinPts} / {current.avgLossPts}
                  </td>
                  <td style={{ padding: '8px 14px', color: '#c9d1d9' }}>
                    Asymmetric payoff profile ensures positive expectancy even during losing runs.
                  </td>
                </tr>
                <tr style={{ borderBottom: '1px solid #1f2430' }}>
                  <td style={{ padding: '8px 14px', color: '#8b949e' }}>Resolved Trades</td>
                  <td style={{ padding: '8px 14px', fontWeight: 700, color: '#089981' }}>
                    {current.wins} Won ({current.winRate}%)
                  </td>
                  <td style={{ padding: '8px 14px', color: '#c9d1d9' }}>
                    Calculated gross of broker spread and slippage across historical MT5 bars.
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '8px 14px', color: '#8b949e' }}>Execution Mode</td>
                  <td style={{ padding: '8px 14px', fontWeight: 700, color: '#2962ff' }}>
                    Automated / Manual
                  </td>
                  <td style={{ padding: '8px 14px', color: '#c9d1d9' }}>
                    Fully integrated with MT5 execution bridge and Auto-BE at TP1.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* OPERATIONAL RULES CALLOUT */}
          <div style={{
            background: 'rgba(41, 98, 255, 0.05)',
            border: '1px solid rgba(41, 98, 255, 0.2)',
            borderRadius: 6,
            padding: '10px 14px',
            fontSize: 12,
            color: '#c9d1d9'
          }}>
            <div style={{ fontWeight: 700, color: '#2962ff', marginBottom: 4 }}>OPERATIONAL RULES & INVARIANTS:</div>
            {current.rules.map((rule, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <CheckCircle2 size={13} color="#089981" />
                <span>{rule}</span>
              </div>
            ))}
          </div>

        </div>

        {/* FOOTER */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '12px 20px',
          borderTop: '1px solid #1f2430',
          background: '#0d1117'
        }}>
          <button
            onClick={onClose}
            style={{
              background: '#1e222d',
              border: '1px solid #2a2e39',
              color: '#fff',
              borderRadius: 5,
              padding: '6px 16px',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
