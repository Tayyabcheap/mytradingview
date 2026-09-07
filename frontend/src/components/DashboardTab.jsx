import React, { useState, useEffect } from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, Activity, ShieldCheck,
  ArrowUpRight, ArrowDownRight, ArrowRight, Zap, BookOpen, CandlestickChart,
  RefreshCw, CheckCircle2, Clock, BarChart3, Layers,
  DownloadCloud, AlertTriangle, X, GitCommit
} from 'lucide-react';

export default function DashboardTab({
  accountInfo,
  symbols = [],
  watchQuotes = {},
  onSelectSymbolAndGoToChart,
  onGoToJournal
}) {
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [signals, setSignals] = useState([]);
  const [selectedMarketCat, setSelectedMarketCat] = useState('ALL');
  const [openPositions, setOpenPositions] = useState([]);

  // ── Self-update (Check for Updates against the GitHub repo) ──
  const [updOpen, setUpdOpen] = useState(false);
  const [updLoading, setUpdLoading] = useState(false);   // checking status
  const [updRunning, setUpdRunning] = useState(false);   // pulling + rebuilding
  const [updStatus, setUpdStatus] = useState(null);      // /update-status payload
  const [updResult, setUpdResult] = useState(null);      // { ok, msg } | { error }

  const checkForUpdates = async () => {
    setUpdOpen(true); setUpdResult(null); setUpdStatus(null); setUpdLoading(true);
    try {
      const r = await fetch('/api/app/update-status');
      setUpdStatus(await r.json());
    } catch (e) {
      setUpdStatus({ ok: false, reason: 'Could not reach the local server.' });
    } finally { setUpdLoading(false); }
  };

  const runUpdate = async () => {
    setUpdRunning(true); setUpdResult(null);
    try {
      const r = await fetch('/api/app/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json();
      if (!r.ok || d.error) {
        setUpdResult({ error: d.error || 'Update failed', dirty_files: d.dirty_files, detail: d.detail || d.build_error });
      } else if (d.no_change) {
        setUpdResult({ ok: true, msg: 'Already up to date.' });
      } else {
        setUpdResult({ ok: true, msg: (d.message || 'Update downloaded.') + ' Restart the app (STOP.bat → START.bat), then hard-refresh (Ctrl+Shift+R) to finish.', build_error: d.build_error });
        setUpdStatus(s => s ? { ...s, behind: 0, up_to_date: true } : s);
      }
    } catch (e) {
      setUpdResult({ error: e.message });
    } finally { setUpdRunning(false); }
  };

  // Fetch account stats & open positions
  const fetchDashboardData = async () => {
    try {
      setLoadingStats(true);
      const [statsRes, posRes, sigRes] = await Promise.all([
        fetch('/api/journal/stats?days=30'),
        fetch('/api/positions'),
        fetch('/api/signals?symbol=XAUUSDc&timeframe=1H&strategy=ALL')
      ]);

      const [statsData, posData, sigData] = await Promise.all([
        statsRes.json(),
        posRes.json(),
        sigRes.json()
      ]);

      if (statsData && !statsData.error) setStats(statsData);
      if (Array.isArray(posData)) setOpenPositions(posData);
      if (Array.isArray(sigData)) setSignals(sigData.slice(-6).reverse());
    } catch (err) {
      console.error("Error fetching dashboard data:", err);
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 5000);
    return () => clearInterval(interval);
  }, []);

  // Filter market watch symbols by category
  const filteredSymbols = symbols.filter(s => {
    if (selectedMarketCat === 'ALL') return true;
    return (s.category || 'Forex').toLowerCase() === selectedMarketCat.toLowerCase();
  });

  const floatingProfit = accountInfo?.profit || 0;
  const isProfit = floatingProfit >= 0;

  return (
    <div className="dashboard-container" style={{
      padding: '20px 24px',
      overflowY: 'auto',
      height: '100%',
      boxSizing: 'border-box',
      background: '#0d1117',
      color: '#d1d4dc'
    }}>
      {/* 1. TOP HEADER & ACCOUNT OVERVIEW BANNER */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 20
      }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#ffffff', margin: 0 }}>
            Trading Dashboard
          </h1>
          <div style={{ fontSize: 12.5, color: '#8b949e', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Connected Broker: <strong style={{ color: '#fff' }}>{accountInfo?.company || 'Exness'}</strong></span>
            <span>·</span>
            <span>Server: <strong style={{ color: '#fff' }}>{accountInfo?.server || 'MT5 Real'}</strong></span>
            <span>·</span>
            <span>Account: <strong style={{ color: '#2962ff' }}>#{accountInfo?.login || '---'}</strong></span>
            <span>·</span>
            <span>Leverage: <strong style={{ color: '#ffd600' }}>1:{accountInfo?.leverage || 1000}</strong></span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={fetchDashboardData}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: '#1e222d',
              border: '1px solid #2a2e39',
              borderRadius: 6,
              padding: '8px 14px',
              color: '#d1d4dc',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <RefreshCw size={14} className={loadingStats ? 'animate-spin' : ''} /> Refresh Data
          </button>
          <button
            onClick={checkForUpdates}
            title="Check your GitHub repo for a newer version of the app"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: '#1e222d',
              border: '1px solid #2a3550',
              borderRadius: 6,
              padding: '8px 14px',
              color: '#7aa2ff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <DownloadCloud size={14} /> Check for Updates
          </button>
        </div>
      </div>

      {/* 2. KEY METRICS CARDS */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 14,
        marginBottom: 24
      }}>
        {/* Balance */}
        <div className="stat-card" style={{
          background: '#131722',
          border: '1px solid #2a2e39',
          borderRadius: 8,
          padding: '16px 18px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
        }}>
          <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Account Balance</span>
            <DollarSign size={15} color="#2962ff" />
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#ffffff', fontVariantNumeric: 'tabular-nums' }}>
            {(accountInfo?.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span style={{ fontSize: 13, color: '#8b949e' }}>{accountInfo?.currency || 'USD'}</span>
          </div>
        </div>

        {/* Equity */}
        <div className="stat-card" style={{
          background: '#131722',
          border: '1px solid #2a2e39',
          borderRadius: 8,
          padding: '16px 18px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
        }}>
          <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Equity (Net Worth)</span>
            <Activity size={15} color="#089981" />
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#ffffff', fontVariantNumeric: 'tabular-nums' }}>
            {(accountInfo?.equity || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span style={{ fontSize: 13, color: '#8b949e' }}>{accountInfo?.currency || 'USD'}</span>
          </div>
        </div>

        {/* Floating PnL */}
        <div className="stat-card" style={{
          background: '#131722',
          border: '1px solid #2a2e39',
          borderRadius: 8,
          padding: '16px 18px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
        }}>
          <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Floating Profit/Loss</span>
            {isProfit ? <TrendingUp size={15} color="#089981" /> : <TrendingDown size={15} color="#f23645" />}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: isProfit ? '#089981' : '#f23645', fontVariantNumeric: 'tabular-nums' }}>
            {isProfit ? '+' : ''}{(floatingProfit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span style={{ fontSize: 13, color: '#8b949e' }}>{accountInfo?.currency || 'USD'}</span>
          </div>
        </div>

        {/* Margin Level */}
        <div className="stat-card" style={{
          background: '#131722',
          border: '1px solid #2a2e39',
          borderRadius: 8,
          padding: '16px 18px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
        }}>
          <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Margin Level</span>
            <ShieldCheck size={15} color="#ffd600" />
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#ffd600', fontVariantNumeric: 'tabular-nums' }}>
            {(accountInfo?.margin_level || 0).toFixed(1)}%
          </div>
        </div>

        {/* 30D Win Rate */}
        <div className="stat-card" style={{
          background: '#131722',
          border: '1px solid #2a2e39',
          borderRadius: 8,
          padding: '16px 18px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
        }}>
          <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Win Rate (30D)</span>
            <BarChart3 size={15} color="#ba68c8" />
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: (stats?.win_rate || 0) >= 50 ? '#089981' : '#f0f3fa', fontVariantNumeric: 'tabular-nums' }}>
            {stats?.win_rate || 0}%
          </div>
        </div>
      </div>

      {/* 3. MIDDLE SECTION: MARKET OVERVIEW & PERFORMANCE METRICS */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
        gap: 18,
        marginBottom: 24
      }}>
        {/* MARKET WATCH OVERVIEW */}
        <div style={{
          background: '#131722',
          border: '1px solid #2a2e39',
          borderRadius: 8,
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CandlestickChart size={16} color="#2962ff" />
              <span style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>Broker Instruments</span>
            </div>

            {/* Category filter pills */}
            <div style={{ display: 'flex', gap: 4 }}>
              {['ALL', 'Commodities', 'Crypto', 'Forex'].map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedMarketCat(cat)}
                  style={{
                    background: selectedMarketCat === cat ? '#2962ff' : '#1e222d',
                    border: '1px solid #2a2e39',
                    borderRadius: 4,
                    color: selectedMarketCat === cat ? '#fff' : '#8b949e',
                    fontSize: 11,
                    padding: '3px 8px',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Instrument List */}
          <div style={{ flex: 1, maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filteredSymbols.slice(0, 15).map(s => {
              const q = watchQuotes[s.name];
              const price = q?.price || s.ask;
              const dir = q?.dir || 'flat';

              return (
                <div
                  key={s.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: '#0e1116',
                    border: '1px solid #1f2430',
                    borderRadius: 6
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <strong style={{ color: '#fff', fontSize: 13 }}>{s.name}</strong>
                      <span style={{
                        fontSize: 9.5,
                        fontWeight: 600,
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: 'rgba(255,255,255,0.06)',
                        color: '#8b949e'
                      }}>
                        {s.category}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#6e7681', marginTop: 2 }}>
                      {s.description}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{
                        fontWeight: 700,
                        fontSize: 13,
                        color: dir === 'up' ? '#089981' : dir === 'down' ? '#f23645' : '#ffffff',
                        fontVariantNumeric: 'tabular-nums'
                      }}>
                        {price ? price.toFixed(s.digits || 2) : '---'}
                      </div>
                      <div style={{ fontSize: 10, color: '#8b949e' }}>
                        Spread: {s.spread || 10}
                      </div>
                    </div>

                    <button
                      onClick={() => onSelectSymbolAndGoToChart(s.name)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        background: 'rgba(41,98,255,0.15)',
                        border: '1px solid rgba(41,98,255,0.3)',
                        borderRadius: 4,
                        color: '#2962ff',
                        fontSize: 11,
                        padding: '5px 8px',
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                      title="Open on Chart"
                    >
                      Chart <ArrowUpRight size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* PERFORMANCE & STATS SUMMARY */}
        <div style={{
          background: '#131722',
          border: '1px solid #2a2e39',
          borderRadius: 8,
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BookOpen size={16} color="#089981" />
              <span style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>Performance Analytics</span>
            </div>
            <button
              onClick={onGoToJournal}
              style={{
                background: 'none',
                border: 'none',
                color: '#2962ff',
                fontSize: 12,
                cursor: 'pointer',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              Full Journal <ArrowRight size={13} />
            </button>
          </div>

          {/* Stats Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div style={{ background: '#0e1116', padding: '10px 12px', borderRadius: 6, border: '1px solid #1f2430' }}>
              <div style={{ fontSize: 11, color: '#8b949e' }}>Total Trades (30D)</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#ffffff', marginTop: 2 }}>
                {stats?.total_trades || 0}
              </div>
            </div>

            <div style={{ background: '#0e1116', padding: '10px 12px', borderRadius: 6, border: '1px solid #1f2430' }}>
              <div style={{ fontSize: 11, color: '#8b949e' }}>Profit Factor</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: (stats?.profit_factor || 0) >= 1.5 ? '#089981' : '#ffd600', marginTop: 2 }}>
                {stats?.profit_factor || '0.00'}
              </div>
            </div>

            <div style={{ background: '#0e1116', padding: '10px 12px', borderRadius: 6, border: '1px solid #1f2430' }}>
              <div style={{ fontSize: 11, color: '#8b949e' }}>Payoff Ratio (Win/Loss)</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#ffffff', marginTop: 2 }}>
                {stats?.payoff_ratio || '0.00'}
              </div>
            </div>

            <div style={{ background: '#0e1116', padding: '10px 12px', borderRadius: 6, border: '1px solid #1f2430' }}>
              <div style={{ fontSize: 11, color: '#8b949e' }}>Sharpe Ratio</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: (stats?.sharpe_ratio || 0) > 1.0 ? '#089981' : '#8b949e', marginTop: 2 }}>
                {stats?.sharpe_ratio || '0.00'}
              </div>
            </div>
          </div>

          {/* Win/Loss Bar */}
          <div style={{ background: '#0e1116', padding: '12px', borderRadius: 6, border: '1px solid #1f2430' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 6 }}>
              <span>Wins: <strong style={{ color: '#089981' }}>{stats?.winning_trades || 0}</strong></span>
              <span>Losses: <strong style={{ color: '#f23645' }}>{stats?.losing_trades || 0}</strong></span>
            </div>

            <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: '#2a2e39' }}>
              <div style={{ width: `${stats?.win_rate || 0}%`, background: '#089981', transition: 'width 0.3s ease' }} />
              <div style={{ width: `${100 - (stats?.win_rate || 0)}%`, background: '#f23645', transition: 'width 0.3s ease' }} />
            </div>
          </div>
        </div>
      </div>

      {/* 4. BOTTOM SECTION: LIVE DUAL SIGNALS & ACTIVE POSITIONS */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
        gap: 18
      }}>
        {/* LIVE ALGORITHMIC SIGNALS */}
        <div style={{
          background: '#131722',
          border: '1px solid #2a2e39',
          borderRadius: 8,
          padding: '16px 18px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={16} color="#ffd600" />
              <span style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>Live Algorithmic Signals</span>
            </div>
            <span style={{ fontSize: 11, color: '#8b949e' }}>Swing Core & Swing Pro</span>
          </div>

          {signals.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: '#8b949e', fontSize: 12 }}>
              No active signals generated for current bar. Scanning MT5 feeds...
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {signals.map((sig, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: '#0e1116',
                    border: '1px solid #1f2430',
                    borderRadius: 6
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 800,
                      padding: '2px 6px',
                      borderRadius: 3,
                      background: sig.type === 'BUY' ? 'rgba(8,153,129,0.2)' : 'rgba(242,54,69,0.2)',
                      color: sig.type === 'BUY' ? '#089981' : '#f23645'
                    }}>
                      {sig.type}
                    </span>
                    <div>
                      <strong style={{ color: '#fff', fontSize: 12.5 }}>{sig.strategy || 'Swing Pro'}</strong>
                      <div style={{ fontSize: 10.5, color: '#8b949e' }}>
                        Entry: {sig.entry || sig.price} · SL: {sig.sl} · TP1: {sig.tp1 || sig.tp}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => onSelectSymbolAndGoToChart('XAUUSDc')}
                    style={{
                      background: 'rgba(255,214,0,0.15)',
                      border: '1px solid rgba(255,214,0,0.3)',
                      borderRadius: 4,
                      color: '#ffd600',
                      fontSize: 11,
                      padding: '4px 8px',
                      cursor: 'pointer',
                      fontWeight: 600
                    }}
                  >
                    View Setup
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ACTIVE OPEN POSITIONS TABLE */}
        <div style={{
          background: '#131722',
          border: '1px solid #2a2e39',
          borderRadius: 8,
          padding: '16px 18px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Layers size={16} color="#ba68c8" />
              <span style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>Active Open Positions ({openPositions.length})</span>
            </div>
            <button
              onClick={onGoToJournal}
              style={{
                background: 'none',
                border: 'none',
                color: '#8b949e',
                fontSize: 11,
                cursor: 'pointer'
              }}
            >
              View Journal
            </button>
          </div>

          {openPositions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: '#8b949e', fontSize: 12 }}>
              No open positions in MT5.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {openPositions.map(pos => {
                const isPosProfit = (pos.profit || 0) >= 0;
                return (
                  <div
                    key={pos.ticket}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: '#0e1116',
                      border: '1px solid #1f2430',
                      borderRadius: 6
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <strong style={{ color: '#fff', fontSize: 13 }}>{pos.symbol}</strong>
                        <span style={{
                          fontSize: 9.5,
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: 3,
                          background: pos.type_str === 'BUY' ? 'rgba(8,153,129,0.2)' : 'rgba(242,54,69,0.2)',
                          color: pos.type_str === 'BUY' ? '#089981' : '#f23645'
                        }}>
                          {pos.type_str} {pos.volume}
                        </span>
                      </div>
                      <div style={{ fontSize: 10.5, color: '#8b949e', marginTop: 2 }}>
                        Entry: {pos.price_open} · Current: {pos.price_current}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{
                        fontSize: 13.5,
                        fontWeight: 800,
                        color: isPosProfit ? '#089981' : '#f23645',
                        fontVariantNumeric: 'tabular-nums'
                      }}>
                        {isPosProfit ? '+' : ''}{(pos.profit || 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── CHECK-FOR-UPDATES MODAL ── */}
      {updOpen && (
        <div onClick={() => !updRunning && setUpdOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 470, maxWidth: '92vw', background: '#131722', border: '1px solid #2a2e39', borderRadius: 10, padding: '18px 20px', color: '#d1d4dc', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <DownloadCloud size={18} color="#7aa2ff" />
                <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>App Updates</span>
              </div>
              <button onClick={() => !updRunning && setUpdOpen(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: updRunning ? 'not-allowed' : 'pointer' }}><X size={18} /></button>
            </div>

            {updLoading ? (
              <div style={{ padding: '18px 0', color: '#8b949e', fontSize: 13 }}>Checking GitHub for updates…</div>
            ) : !updStatus ? null : !updStatus.ok ? (
              <div style={{ fontSize: 12.5, color: '#f0a5aa', background: 'rgba(242,54,69,0.1)', border: '1px solid rgba(242,54,69,0.3)', borderRadius: 6, padding: '10px 12px' }}>{updStatus.reason || 'Update check unavailable.'}</div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <GitCommit size={13} /> Installed: <code style={{ color: '#c9d1d9' }}>{updStatus.current?.hash || '—'}</code>
                  <span style={{ color: '#6e7681' }}>{updStatus.current?.subject ? '· ' + updStatus.current.subject.slice(0, 40) : ''}</span>
                </div>

                {updStatus.fetch_ok === false && (
                  <div style={{ fontSize: 12, color: '#ffd27a', background: 'rgba(255,214,0,0.08)', border: '1px solid rgba(255,214,0,0.25)', borderRadius: 6, padding: '9px 11px', marginBottom: 10 }}>
                    Couldn't reach GitHub (offline, or the SSH key isn't available). Showing local status only.
                  </div>
                )}

                {updStatus.up_to_date ? (
                  <div style={{ fontSize: 13, color: '#57d9a3', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <CheckCircle2 size={16} /> You're on the latest version.
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 13, color: '#e6e9ef', marginBottom: 10 }}>
                      <strong style={{ color: '#7aa2ff' }}>{updStatus.behind}</strong> update{updStatus.behind === 1 ? '' : 's'} available on GitHub.
                      {updStatus.latest?.hash && <span style={{ color: '#8b949e' }}> Latest: <code>{updStatus.latest.hash}</code>{updStatus.latest.subject ? ' · ' + updStatus.latest.subject.slice(0, 40) : ''}</span>}
                    </div>

                    {updStatus.dirty ? (
                      <div style={{ fontSize: 12.5, color: '#ffd27a', background: 'rgba(255,214,0,0.08)', border: '1px solid rgba(255,214,0,0.3)', borderRadius: 6, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 4 }}><AlertTriangle size={14} /> Local changes present — update blocked</div>
                        This folder has {updStatus.dirty_count} uncommitted change{updStatus.dirty_count === 1 ? '' : 's'}. Updating would risk your work, so it's disabled. Commit or discard them first, then check again.
                        <div style={{ marginTop: 6, maxHeight: 92, overflowY: 'auto', fontFamily: 'monospace', fontSize: 10.5, color: '#b0b4be' }}>
                          {(updStatus.dirty_files || []).slice(0, 12).map((f, i) => <div key={i}>{f}</div>)}
                          {updStatus.dirty_count > 12 && <div>…and {updStatus.dirty_count - 12} more</div>}
                        </div>
                      </div>
                    ) : (
                      <button onClick={runUpdate} disabled={updRunning}
                        style={{ display: 'flex', alignItems: 'center', gap: 7, background: updRunning ? '#2a3550' : '#2962ff', border: 'none', borderRadius: 6, padding: '10px 16px', color: '#fff', fontSize: 13, fontWeight: 700, cursor: updRunning ? 'wait' : 'pointer' }}>
                        <DownloadCloud size={15} /> {updRunning ? 'Updating… (pulling + rebuilding)' : 'Update now'}
                      </button>
                    )}
                  </>
                )}

                {updResult && (
                  <div style={{ marginTop: 12, fontSize: 12.5, borderRadius: 6, padding: '10px 12px',
                    background: updResult.error ? 'rgba(242,54,69,0.1)' : 'rgba(8,153,129,0.12)',
                    border: `1px solid ${updResult.error ? 'rgba(242,54,69,0.35)' : 'rgba(8,153,129,0.35)'}`,
                    color: updResult.error ? '#f0a5aa' : '#7ee3bd' }}>
                    {updResult.error ? (
                      <><strong>Update failed:</strong> {updResult.error}
                        {updResult.detail && <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 10.5, color: '#c9a0a3', whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto' }}>{updResult.detail}</div>}
                      </>
                    ) : (
                      <><CheckCircle2 size={13} style={{ verticalAlign: 'text-bottom' }} /> {updResult.msg}
                        {updResult.build_error && <div style={{ marginTop: 6, color: '#ffd27a' }}>Note: the rebuild reported issues — {String(updResult.build_error).slice(0, 160)}</div>}
                      </>
                    )}
                  </div>
                )}
              </>
            )}

            <div style={{ marginTop: 14, fontSize: 10.5, color: '#6e7681' }}>
              Updates come from your GitHub repo. Local edits are never overwritten.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
