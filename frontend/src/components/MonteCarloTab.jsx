import React, { useState, useEffect, useMemo } from 'react';
import { 
  ShieldAlert, 
  TrendingUp, 
  Play, 
  RefreshCw, 
  HelpCircle, 
  AlertTriangle, 
  CheckCircle2, 
  Sliders, 
  Zap, 
  Layers, 
  BarChart3,
  DollarSign,
  Scale
} from 'lucide-react';

export default function MonteCarloTab({ accountInfo, onSelectSymbolAndGoToChart }) {
  // Simulation Inputs
  const [initialBalance, setInitialBalance] = useState(() => accountInfo?.balance || 10000);
  const [simulations, setSimulations] = useState(1000);
  const [numTrades, setNumTrades] = useState(100);
  const [winRate, setWinRate] = useState(62);
  const [rewardRisk, setRewardRisk] = useState(1.5);
  const [lotSize, setLotSize] = useState(0.10);
  const [ruinThresholdPct, setRuinThresholdPct] = useState(20);
  const [riskPerTrade, setRiskPerTrade] = useState(100);

  // Status & Results
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  const [activeGuideCard, setActiveGuideCard] = useState('fan_chart');
  const [hoveredTradeIdx, setHoveredTradeIdx] = useState(null);

  // Sync initial balance if accountInfo loads
  useEffect(() => {
    if (accountInfo?.balance && accountInfo.balance > 0) {
      setInitialBalance(Math.round(accountInfo.balance));
    }
  }, [accountInfo?.balance]);

  // Adjust riskPerTrade dynamically when lotSize changes (assuming ~25 pip stop loss on Gold = $25/0.10 lot)
  const handleLotChange = (val) => {
    const clamped = Math.max(0.01, Math.min(1.0, parseFloat(val) || 0.01));
    setLotSize(clamped);
    setRiskPerTrade(Math.round(clamped * 1000)); // rough benchmark
  };

  const runSimulation = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/stress_test/monte_carlo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initial_balance: initialBalance,
          simulations: simulations,
          num_trades: numTrades,
          win_rate: winRate,
          reward_risk: rewardRisk,
          risk_per_trade: riskPerTrade,
          lot_size: lotSize,
          ruin_threshold_pct: ruinThresholdPct
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Simulation failed');
      }
      setResults(data);
    } catch (err) {
      console.error('Monte Carlo Error:', err);
      setError(err.message || 'Error running simulation');
    } finally {
      setLoading(false);
    }
  };

  // Run initial simulation on mount
  useEffect(() => {
    runSimulation();
  }, []);

  // Pre-calculate SVG coordinates for fan chart
  const chartData = useMemo(() => {
    if (!results?.curves) return null;
    const { p95, p50, p05, worst, best, samples } = results.curves;
    const len = p95.length;
    if (len === 0) return null;

    // Find min and max across all plotted curves
    let minVal = Math.min(...p05, ...worst, initialBalance * 0.7);
    let maxVal = Math.max(...p95, ...best, initialBalance * 1.3);
    const padding = (maxVal - minVal) * 0.08;
    minVal = Math.max(0, minVal - padding);
    maxVal = maxVal + padding;

    const width = 640;
    const height = 280;

    const getX = (i) => (i / (len - 1)) * width;
    const getY = (v) => height - ((v - minVal) / (maxVal - minVal)) * height;

    const toSvgPath = (arr) => {
      return arr.map((val, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx).toFixed(1)} ${getY(val).toFixed(1)}`).join(' ');
    };

    // Shaded area between p95 and p05
    const areaPath = () => {
      const top = p95.map((v, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getY(v).toFixed(1)}`).join(' ');
      const bottom = p05.slice().reverse().map((v, i) => `L ${getX(len - 1 - i).toFixed(1)} ${getY(v).toFixed(1)}`).join(' ');
      return `${top} ${bottom} Z`;
    };

    return {
      width,
      height,
      minVal,
      maxVal,
      p95Path: toSvgPath(p95),
      p50Path: toSvgPath(p50),
      p05Path: toSvgPath(p05),
      worstPath: toSvgPath(worst),
      bestPath: toSvgPath(best),
      areaPath: areaPath(),
      samplesPaths: samples ? samples.map(s => toSvgPath(s)) : [],
      p95, p50, p05, worst,
      getX, getY
    };
  }, [results, initialBalance]);

  return (
    <div style={{
      display: 'flex',
      height: '100%',
      width: '100%',
      background: '#0d1117',
      color: '#e6edf3',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      overflow: 'hidden'
    }}>
      {/* ─── LEFT PANEL: THE SIMULATION LAB ────────────────────────────────── */}
      <div style={{
        flex: '1 1 58%',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid #2a2e39',
        overflowY: 'auto',
        padding: '20px 24px',
        gap: 18
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                background: 'linear-gradient(135deg, rgba(41, 98, 255, 0.2), rgba(8, 153, 129, 0.2))',
                padding: '6px 8px',
                borderRadius: 8,
                border: '1px solid rgba(41, 98, 255, 0.3)'
              }}>
                <Sliders size={20} color="#2962ff" />
              </div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>
                Monte Carlo Stress Lab
              </h2>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: 12.5, color: '#8b949e' }}>
              Vectorized sequence-of-returns permutations and drawdown risk profiling.
            </p>
          </div>

          <button
            onClick={runSimulation}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: loading ? '#2a2e39' : 'var(--brand, #2962ff)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
              boxShadow: '0 2px 8px rgba(41, 98, 255, 0.3)'
            }}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            {loading ? 'Simulating...' : 'Run Stress Test'}
          </button>
        </div>

        {/* Input Parameters Controls Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          background: '#131722',
          border: '1px solid #1f2430',
          borderRadius: 8,
          padding: 14
        }}>
          {/* Starting Balance */}
          <div>
            <label style={{ fontSize: 11, color: '#8b949e', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              INITIAL BALANCE ($)
            </label>
            <input
              type="number"
              value={initialBalance}
              onChange={(e) => setInitialBalance(Math.max(100, parseFloat(e.target.value) || 100))}
              style={{
                width: '100%',
                background: '#1e222d',
                border: '1px solid #2a2e39',
                borderRadius: 4,
                color: '#fff',
                padding: '6px 8px',
                fontSize: 13,
                fontWeight: 600
              }}
            />
          </div>

          {/* Lot Size */}
          <div>
            <label style={{ fontSize: 11, color: '#8b949e', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              LOT SIZE (GOLD CAP ≤ 1.0)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max="1.0"
              value={lotSize}
              onChange={(e) => handleLotChange(e.target.value)}
              style={{
                width: '100%',
                background: '#1e222d',
                border: lotSize > 1.0 ? '1px solid #f23645' : '1px solid #2a2e39',
                borderRadius: 4,
                color: '#fff',
                padding: '6px 8px',
                fontSize: 13,
                fontWeight: 600
              }}
            />
          </div>

          {/* Win Rate */}
          <div>
            <label style={{ fontSize: 11, color: '#8b949e', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              WIN RATE (%)
            </label>
            <input
              type="number"
              min="10"
              max="95"
              value={winRate}
              onChange={(e) => setWinRate(Math.max(10, Math.min(95, parseFloat(e.target.value) || 50)))}
              style={{
                width: '100%',
                background: '#1e222d',
                border: '1px solid #2a2e39',
                borderRadius: 4,
                color: '#fff',
                padding: '6px 8px',
                fontSize: 13,
                fontWeight: 600
              }}
            />
          </div>

          {/* R:R Ratio */}
          <div>
            <label style={{ fontSize: 11, color: '#8b949e', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              PAYOFF RATIO (R:R)
            </label>
            <input
              type="number"
              step="0.1"
              min="0.5"
              max="10"
              value={rewardRisk}
              onChange={(e) => setRewardRisk(Math.max(0.5, parseFloat(e.target.value) || 1.0))}
              style={{
                width: '100%',
                background: '#1e222d',
                border: '1px solid #2a2e39',
                borderRadius: 4,
                color: '#fff',
                padding: '6px 8px',
                fontSize: 13,
                fontWeight: 600
              }}
            />
          </div>

          {/* Simulations Count */}
          <div>
            <label style={{ fontSize: 11, color: '#8b949e', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              SIMULATIONS (PATHS)
            </label>
            <div style={{ display: 'flex', gap: 4 }}>
              {[500, 1000, 2000].map(n => (
                <button
                  key={n}
                  onClick={() => setSimulations(n)}
                  style={{
                    flex: 1,
                    background: simulations === n ? 'var(--brand, #2962ff)' : '#1e222d',
                    border: '1px solid #2a2e39',
                    borderRadius: 4,
                    color: simulations === n ? '#fff' : '#8b949e',
                    padding: '4px 0',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Trades Count */}
          <div>
            <label style={{ fontSize: 11, color: '#8b949e', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              SEQUENCE LENGTH
            </label>
            <div style={{ display: 'flex', gap: 4 }}>
              {[50, 100, 200].map(n => (
                <button
                  key={n}
                  onClick={() => setNumTrades(n)}
                  style={{
                    flex: 1,
                    background: numTrades === n ? 'var(--brand, #2962ff)' : '#1e222d',
                    border: '1px solid #2a2e39',
                    borderRadius: 4,
                    color: numTrades === n ? '#fff' : '#8b949e',
                    padding: '4px 0',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Ruin Threshold */}
          <div>
            <label style={{ fontSize: 11, color: '#8b949e', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              RUIN THRESHOLD (%)
            </label>
            <input
              type="number"
              min="10"
              max="80"
              value={ruinThresholdPct}
              onChange={(e) => setRuinThresholdPct(Math.max(10, Math.min(80, parseFloat(e.target.value) || 20)))}
              style={{
                width: '100%',
                background: '#1e222d',
                border: '1px solid #2a2e39',
                borderRadius: 4,
                color: '#fff',
                padding: '6px 8px',
                fontSize: 13,
                fontWeight: 600
              }}
            />
          </div>

          {/* Quick presets */}
          <div>
            <label style={{ fontSize: 11, color: '#8b949e', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              QUICK STRATEGY PRESET
            </label>
            <button
              onClick={() => {
                setWinRate(64);
                setRewardRisk(1.6);
                setLotSize(0.10);
                setRiskPerTrade(100);
              }}
              style={{
                width: '100%',
                background: 'rgba(8, 153, 129, 0.15)',
                border: '1px solid rgba(8, 153, 129, 0.3)',
                borderRadius: 4,
                color: '#089981',
                padding: '6px 8px',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Haider-Gold-Scalper
            </button>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div style={{
            background: 'rgba(242, 54, 69, 0.12)',
            border: '1px solid #f23645',
            borderRadius: 6,
            padding: '10px 14px',
            color: '#ff8282',
            fontSize: 13
          }}>
            {error}
          </div>
        )}

        {/* Stress Metrics Cards */}
        {results?.stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            {/* Survivability Grade */}
            <div style={{
              background: '#131722',
              border: `1px solid ${results.stats.grade_color}`,
              borderRadius: 6,
              padding: '10px 12px'
            }}>
              <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 600 }}>SURVIVABILITY GRADE</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: results.stats.grade_color, marginTop: 4 }}>
                {results.stats.grade}
              </div>
              <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {results.stats.grade_desc}
              </div>
            </div>

            {/* Risk of Ruin */}
            <div style={{
              background: '#131722',
              border: '1px solid #1f2430',
              borderRadius: 6,
              padding: '10px 12px'
            }}>
              <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 600 }}>RISK OF RUIN</div>
              <div style={{ 
                fontSize: 20, 
                fontWeight: 800, 
                color: results.stats.risk_of_ruin_pct === 0 ? '#089981' : (results.stats.risk_of_ruin_pct < 2 ? '#f7a600' : '#f23645'),
                marginTop: 4 
              }}>
                {results.stats.risk_of_ruin_pct}%
              </div>
              <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2 }}>
                {results.stats.risk_of_ruin_pct === 0 ? 'Mathematically Safe' : 'Capital at Risk'}
              </div>
            </div>

            {/* 95% Max DD */}
            <div style={{
              background: '#131722',
              border: '1px solid #1f2430',
              borderRadius: 6,
              padding: '10px 12px'
            }}>
              <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 600 }}>95% MAX DRAWDOWN</div>
              <div style={{ 
                fontSize: 20, 
                fontWeight: 800, 
                color: results.stats.dd_95 <= 10 ? '#089981' : (results.stats.dd_95 <= 18 ? '#f7a600' : '#f23645'),
                marginTop: 4 
              }}>
                {results.stats.dd_95}%
              </div>
              <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2 }}>
                Avg DD: {results.stats.dd_avg}%
              </div>
            </div>

            {/* Max Losing Streak */}
            <div style={{
              background: '#131722',
              border: '1px solid #1f2430',
              borderRadius: 6,
              padding: '10px 12px'
            }}>
              <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 600 }}>WORST LOSING STREAK</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#e6edf3', marginTop: 4 }}>
                {results.stats.mcl_95} <span style={{ fontSize: 12, fontWeight: 400, color: '#8b949e' }}>trades</span>
              </div>
              <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2 }}>
                Worst in pool: {results.stats.mcl_max}
              </div>
            </div>

            {/* Recommended Lot Size */}
            <div style={{
              background: 'rgba(41, 98, 255, 0.08)',
              border: '1px solid rgba(41, 98, 255, 0.3)',
              borderRadius: 6,
              padding: '10px 12px'
            }}>
              <div style={{ fontSize: 11, color: '#2962ff', fontWeight: 700 }}>RECOMMENDED LOT</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginTop: 4 }}>
                {results.stats.recommended_lot} <span style={{ fontSize: 12, fontWeight: 500, color: '#8b949e' }}>Lots</span>
              </div>
              <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2 }}>
                Target &lt; 10% Drawdown
              </div>
            </div>
          </div>
        )}

        {/* Visual Equity Curves Fan Chart */}
        <div style={{
          background: '#131722',
          border: '1px solid #1f2430',
          borderRadius: 8,
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <TrendingUp size={16} color="var(--brand, #2962ff)" />
              <span style={{ fontSize: 13, fontWeight: 700 }}>Simulated Equity Curves (Fan Chart)</span>
            </div>

            {/* Chart Legend */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 12, height: 3, background: '#089981', borderRadius: 2 }} />
                <span>95th% Bull Case</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 12, height: 3, background: '#2962ff', borderRadius: 2 }} />
                <span>50th% Median</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 12, height: 3, background: '#f7a600', borderRadius: 2 }} />
                <span>5th% Bear Case</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 12, height: 2, background: '#f23645', borderTop: '1px dashed #f23645' }} />
                <span>Worst Path</span>
              </div>
            </div>
          </div>

          {/* SVG Chart Rendering */}
          {chartData ? (
            <div style={{ width: '100%', height: 240, position: 'relative' }}>
              <svg 
                viewBox={`0 0 ${chartData.width} ${chartData.height}`} 
                style={{ width: '100%', height: '100%', overflow: 'visible' }}
              >
                <defs>
                  <linearGradient id="fanGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(41, 98, 255, 0.25)" />
                    <stop offset="100%" stopColor="rgba(41, 98, 255, 0.02)" />
                  </linearGradient>
                </defs>

                {/* Horizontal Baseline / Grid lines */}
                {[0.25, 0.5, 0.75].map((fraction, idx) => {
                  const y = chartData.height * fraction;
                  const val = chartData.minVal + (1 - fraction) * (chartData.maxVal - chartData.minVal);
                  return (
                    <g key={idx}>
                      <line x1="0" y1={y} x2={chartData.width} y2={y} stroke="#1f2430" strokeDasharray="3 3" />
                      <text x="4" y={y - 4} fill="#6e7681" fontSize="10" fontFamily="monospace">
                        ${Math.round(val).toLocaleString()}
                      </text>
                    </g>
                  );
                })}

                {/* Shaded Area between 95th and 5th percentile */}
                <path d={chartData.areaPath} fill="url(#fanGradient)" />

                {/* Background Sample Lines */}
                {chartData.samplesPaths.map((p, i) => (
                  <path key={i} d={p} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                ))}

                {/* Worst Path */}
                <path d={chartData.worstPath} fill="none" stroke="#f23645" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.8" />

                {/* 5th Percentile Curve */}
                <path d={chartData.p05Path} fill="none" stroke="#f7a600" strokeWidth="2" />

                {/* 50th Percentile Curve (Median) */}
                <path d={chartData.p50Path} fill="none" stroke="#2962ff" strokeWidth="2.5" />

                {/* 95th Percentile Curve */}
                <path d={chartData.p95Path} fill="none" stroke="#089981" strokeWidth="2" />
              </svg>
            </div>
          ) : (
            <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e' }}>
              Calculating simulation curves...
            </div>
          )}
        </div>

        {/* Drawdown Probability Density Histogram */}
        {results?.histogram && (
          <div style={{
            background: '#131722',
            border: '1px solid #1f2430',
            borderRadius: 8,
            padding: '14px 18px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <BarChart3 size={15} color="var(--brand, #2962ff)" />
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>Drawdown Distribution (% Probability)</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 90 }}>
              {results.histogram.map((bin, idx) => {
                const maxPct = Math.max(...results.histogram.map(h => h.pct), 1);
                const barHeight = Math.max(8, (bin.pct / maxPct) * 70);
                const isDangerous = idx >= 4;
                const barColor = isDangerous ? '#f23645' : (idx >= 2 ? '#f7a600' : '#089981');

                return (
                  <div key={idx} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: barColor }}>{bin.pct}%</span>
                    <div style={{
                      width: '100%',
                      height: barHeight,
                      background: barColor,
                      borderRadius: '3px 3px 0 0',
                      opacity: 0.85
                    }} />
                    <span style={{ fontSize: 9.5, color: '#8b949e', whiteSpace: 'nowrap' }}>{bin.range}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ─── RIGHT PANEL: INTERACTIVE EDUCATIONAL & TACTICAL GUIDE ──────────── */}
      <div style={{
        flex: '1 1 42%',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        padding: '20px 24px',
        gap: 16,
        background: '#0b0e14'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            background: 'rgba(8, 153, 129, 0.15)',
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid rgba(8, 153, 129, 0.3)'
          }}>
            <HelpCircle size={20} color="#089981" />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>
              How to Understand This Lab
            </h3>
            <p style={{ margin: '2px 0 0 0', fontSize: 12, color: '#8b949e' }}>
              A professional quantitative guide to interpreting simulation numbers.
            </p>
          </div>
        </div>

        {/* Interactive Guide Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          
          {/* Card 1: Sequence of Returns */}
          <div 
            onClick={() => setActiveGuideCard('sequence')}
            style={{
              background: '#131722',
              border: activeGuideCard === 'sequence' ? '1px solid var(--brand, #2962ff)' : '1px solid #1f2430',
              borderRadius: 8,
              padding: 14,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ 
                  background: 'rgba(41, 98, 255, 0.2)', 
                  color: '#2962ff', 
                  borderRadius: 4, 
                  padding: '2px 6px', 
                  fontSize: 10, 
                  fontWeight: 800 
                }}>
                  RULE 1
                </span>
                <span style={{ fontWeight: 700, fontSize: 13.5 }}>Why Win Rate Alone is an Illusion</span>
              </div>
            </div>
            <p style={{ margin: '8px 0 0 0', fontSize: 12, color: '#c9d1d9', lineHeight: 1.5 }}>
              A trader with a <strong>65% win rate</strong> can still blow an account. In any series of 100 trades, mathematics guarantees that losing trades will <em>cluster</em>. If 7 losses happen in a row early on, an oversized lot will destroy the account before the edge materializes.
            </p>
          </div>

          {/* Card 2: Decoding Fan Chart */}
          <div 
            onClick={() => setActiveGuideCard('fan_chart')}
            style={{
              background: '#131722',
              border: activeGuideCard === 'fan_chart' ? '1px solid var(--brand, #2962ff)' : '1px solid #1f2430',
              borderRadius: 8,
              padding: 14,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ 
                background: 'rgba(8, 153, 129, 0.2)', 
                color: '#089981', 
                borderRadius: 4, 
                padding: '2px 6px', 
                fontSize: 10, 
                fontWeight: 800 
              }}>
                RULE 2
              </span>
              <span style={{ fontWeight: 700, fontSize: 13.5 }}>How to Read the Fan Chart Lines</span>
            </div>
            <div style={{ margin: '10px 0 0 0', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ color: '#089981', fontWeight: 700 }}>● Green (95th%):</span>
                <span style={{ color: '#8b949e' }}>The high-luck universe where trades align favorably. Never plan your expenses around this!</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ color: '#2962ff', fontWeight: 700 }}>● Blue (50th% Median):</span>
                <span style={{ color: '#8b949e' }}>The realistic statistical expectation. This is your baseline growth target.</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ color: '#f7a600', fontWeight: 700 }}>● Yellow (5th% Adverse):</span>
                <span style={{ color: '#8b949e' }}>The tough storm. If you cannot psychologically survive this drawdown curve, reduce your lot size immediately.</span>
              </div>
            </div>
          </div>

          {/* Card 3: Risk of Ruin Benchmark */}
          <div 
            onClick={() => setActiveGuideCard('ruin')}
            style={{
              background: '#131722',
              border: activeGuideCard === 'ruin' ? '1px solid var(--brand, #2962ff)' : '1px solid #1f2430',
              borderRadius: 8,
              padding: 14,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ 
                background: 'rgba(242, 54, 69, 0.2)', 
                color: '#f23645', 
                borderRadius: 4, 
                padding: '2px 6px', 
                fontSize: 10, 
                fontWeight: 800 
              }}>
                RULE 3
              </span>
              <span style={{ fontWeight: 700, fontSize: 13.5 }}>The 0.0% Risk of Ruin Standard</span>
            </div>
            <p style={{ margin: '8px 0 0 0', fontSize: 12, color: '#c9d1d9', lineHeight: 1.5 }}>
              Institutional prop desks and hedge funds require a <strong>Risk of Ruin &lt; 0.5%</strong>. If your simulation shows a Risk of Ruin &gt; 2%, you are gambling, not trading. Adjust lot size until Risk of Ruin displays <strong>0.0%</strong>.
            </p>
          </div>

          {/* Card 4: Consecutive Losses Mental Shield */}
          <div 
            onClick={() => setActiveGuideCard('losses')}
            style={{
              background: '#131722',
              border: activeGuideCard === 'losses' ? '1px solid var(--brand, #2962ff)' : '1px solid #1f2430',
              borderRadius: 8,
              padding: 14,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ 
                background: 'rgba(247, 166, 0, 0.2)', 
                color: '#f7a600', 
                borderRadius: 4, 
                padding: '2px 6px', 
                fontSize: 10, 
                fontWeight: 800 
              }}>
                RULE 4
              </span>
              <span style={{ fontWeight: 700, fontSize: 13.5 }}>Conquering the Expected Losing Streak</span>
            </div>
            <p style={{ margin: '8px 0 0 0', fontSize: 12, color: '#c9d1d9', lineHeight: 1.5 }}>
              If the simulation projects a worst losing streak of <strong>{results?.stats?.mcl_95 || 5} consecutive losses</strong>, you won't panic or revenge trade when 3 or 4 losses occur in real life. You already know it is a completely normal variance anomaly.
            </p>
          </div>

          {/* Card 5: Action Checklist for Gold */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(41, 98, 255, 0.08), rgba(8, 153, 129, 0.08))',
            border: '1px solid rgba(41, 98, 255, 0.25)',
            borderRadius: 8,
            padding: 14
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <CheckCircle2 size={16} color="#089981" />
              <span style={{ fontWeight: 700, fontSize: 13, color: '#fff' }}>Your Capital Protection Protocol</span>
            </div>
            <div style={{ fontSize: 12, color: '#8b949e', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div>1. <strong>Hard Cap on Gold</strong>: Never execute &gt; 1.0 lot on XAUUSD.</div>
              <div>2. <strong>Set Lot to Recommended</strong>: Use <strong>{results?.stats?.recommended_lot || '0.10'}</strong> Lots for maximum safety.</div>
              <div>3. <strong>Auto-Breakeven</strong>: Check "Auto BE at TP1" in Trade Execution so winning trades can never turn into losses.</div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
