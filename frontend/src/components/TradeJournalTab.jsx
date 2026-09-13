import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, Clock, TrendingUp, TrendingDown, DollarSign, 
  Search, Filter, Download, ChevronLeft, ChevronRight, CheckCircle, 
  AlertCircle, RefreshCw, BarChart2, Layers, ShieldCheck, FileSpreadsheet, Sparkles
} from 'lucide-react';
import ScalperAuditView from './ScalperAuditView';

export default function TradeJournalTab({
  accountInfo,
  onSelectSymbolAndGoToChart
}) {
  const [trades, setTrades] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState('monthly'); // 'monthly' | 'daily' | 'weekly' | 'annual' | 'table'
  
  // Filters
  const [timeRangeDays, setTimeRangeDays] = useState(365);
  const [searchSymbol, setSearchSymbol] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedOutcome, setSelectedOutcome] = useState('ALL'); // 'ALL' | 'WIN' | 'LOSS' | 'OPEN'

  // Monthly Calendar State
  const [currentCalendarDate, setCurrentCalendarDate] = useState(new Date());
  const [selectedDayTrades, setSelectedDayTrades] = useState(null);

  // Fetch Journal Trades & Statistics
  const fetchJournalData = async () => {
    try {
      setLoading(true);
      const [tradesRes, statsRes] = await Promise.all([
        fetch(`/api/journal/trades?days=${timeRangeDays}`),
        fetch(`/api/journal/stats?days=${timeRangeDays}`)
      ]);

      const [tradesData, statsData] = await Promise.all([
        tradesRes.json(),
        statsRes.json()
      ]);

      if (Array.isArray(tradesData)) setTrades(tradesData);
      if (statsData && !statsData.error) setStats(statsData);
    } catch (err) {
      console.error("Error fetching trade journal:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJournalData();
  }, [timeRangeDays]);

  // Filtered trades list
  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      // Symbol search
      if (searchSymbol && !t.symbol.toLowerCase().includes(searchSymbol.toLowerCase())) return false;
      // Category
      if (selectedCategory !== 'ALL' && t.category !== selectedCategory) return false;
      // Outcome
      if (selectedOutcome === 'WIN' && t.net_pnl <= 0) return false;
      if (selectedOutcome === 'LOSS' && t.net_pnl >= 0) return false;
      if (selectedOutcome === 'OPEN' && t.status !== 'OPEN') return false;
      return true;
    });
  }, [trades, searchSymbol, selectedCategory, selectedOutcome]);

  // CSV Export Handler
  const exportToCSV = () => {
    if (!filteredTrades.length) return;
    const headers = ["Ticket", "Symbol", "Category", "Type", "Lots", "Open Time", "Open Price", "Close Time", "Close Price", "SL", "TP", "Exit Reason", "Commission", "Swap", "Net PnL", "Status", "Duration"];
    const rows = filteredTrades.map(t => [
      t.ticket,
      t.symbol,
      t.category,
      t.type,
      t.volume,
      `"${t.open_time_str}"`,
      t.open_price,
      `"${t.close_time_str || ''}"`,
      t.close_price || '',
      t.sl || '',
      t.tp || '',
      t.exit_reason,
      t.commission,
      t.swap,
      t.net_pnl,
      t.status,
      `"${t.duration_str}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Trade_Journal_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Calendar Helpers
  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth(); // 0-indexed

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  
  const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 is Sun
  const startingDay = (firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1); // 0 is Mon
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Group trades by date string YYYY-MM-DD
  const tradesByDay = useMemo(() => {
    const map = {};
    trades.forEach(t => {
      if (t.status !== 'CLOSED') return;
      const c_time = t.close_time || t.open_time;
      if (!c_time) return;
      const d = new Date(c_time * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!map[key]) {
        map[key] = { trades: [], pnl: 0, wins: 0, losses: 0 };
      }
      map[key].trades.push(t);
      map[key].pnl += t.net_pnl;
      if (t.net_pnl > 0) map[key].wins++;
      else if (t.net_pnl < 0) map[key].losses++;
    });
    return map;
  }, [trades]);

  // Monthly aggregated totals
  const currentMonthTotals = useMemo(() => {
    let pnl = 0;
    let totalTrades = 0;
    let wins = 0;
    let losses = 0;
    let bestDay = { date: '', pnl: 0 };
    let worstDay = { date: '', pnl: 0 };

    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayData = tradesByDay[key];
      if (dayData) {
        pnl += dayData.pnl;
        totalTrades += dayData.trades.length;
        wins += dayData.wins;
        losses += dayData.losses;
        if (dayData.pnl > bestDay.pnl) bestDay = { date: key, pnl: dayData.pnl };
        if (dayData.pnl < worstDay.pnl) worstDay = { date: key, pnl: dayData.pnl };
      }
    }

    return {
      pnl: Math.round(pnl * 100) / 100,
      totalTrades,
      winRate: totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0,
      bestDay,
      worstDay
    };
  }, [tradesByDay, year, month, daysInMonth]);

  const handlePrevMonth = () => {
    setCurrentCalendarDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentCalendarDate(new Date(year, month + 1, 1));
  };

  return (
    <div className="trade-journal-container" style={{
      padding: '20px 24px',
      overflowY: 'auto',
      height: '100%',
      boxSizing: 'border-box',
      background: '#0d1117',
      color: '#d1d4dc'
    }}>
      {/* 1. TOP HEADER & METRIC SUMMARY CARDS */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 18,
        flexWrap: 'wrap',
        gap: 12
      }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#ffffff', margin: 0 }}>
            Trade Records & Performance Journal
          </h1>
          <div style={{ fontSize: 12.5, color: '#8b949e', marginTop: 3 }}>
            Continuous real-time trade logs recorded directly from MetaTrader 5
          </div>
        </div>

        {/* Action buttons & View Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Time range */}
          <select
            value={timeRangeDays}
            onChange={e => setTimeRangeDays(parseInt(e.target.value))}
            style={{
              background: '#1e222d',
              border: '1px solid #2a2e39',
              borderRadius: 6,
              color: '#d1d4dc',
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 600,
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value={7}>Last 7 Days</option>
            <option value={30}>Last 30 Days</option>
            <option value={90}>Last 90 Days</option>
            <option value={365}>Last 1 Year</option>
            <option value={3650}>All-Time History</option>
          </select>

          {/* Export CSV */}
          <button
            onClick={exportToCSV}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: '#1e222d',
              border: '1px solid #2a2e39',
              borderRadius: 6,
              padding: '6px 12px',
              color: '#d1d4dc',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer'
            }}
            title="Export trades to CSV"
          >
            <FileSpreadsheet size={14} color="#089981" /> Export CSV
          </button>

          <button
            onClick={fetchJournalData}
            style={{
              background: '#1e222d',
              border: '1px solid #2a2e39',
              borderRadius: 6,
              padding: '6px 10px',
              color: '#d1d4dc',
              cursor: 'pointer'
            }}
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 2. TOP METRICS CARDS */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12,
        marginBottom: 20
      }}>
        {/* Net PnL */}
        <div style={{ background: '#131722', border: '1px solid #2a2e39', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 11.5, color: '#8b949e', marginBottom: 4 }}>Net Realized P&L</div>
          <div style={{
            fontSize: 20,
            fontWeight: 800,
            color: (stats?.net_pnl || 0) >= 0 ? '#089981' : '#f23645',
            fontVariantNumeric: 'tabular-nums'
          }}>
            {(stats?.net_pnl || 0) >= 0 ? '+' : ''}{(stats?.net_pnl || 0).toFixed(2)} <span style={{ fontSize: 11, color: '#8b949e' }}>{accountInfo?.currency || 'USD'}</span>
          </div>
        </div>

        {/* Win Rate */}
        <div style={{ background: '#131722', border: '1px solid #2a2e39', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 11.5, color: '#8b949e', marginBottom: 4 }}>Win Rate</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: (stats?.win_rate || 0) >= 50 ? '#089981' : '#f0f3fa' }}>
            {stats?.win_rate || 0}% <span style={{ fontSize: 11, color: '#8b949e' }}>({stats?.winning_trades || 0}W / {stats?.losing_trades || 0}L)</span>
          </div>
        </div>

        {/* Profit Factor */}
        <div style={{ background: '#131722', border: '1px solid #2a2e39', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 11.5, color: '#8b949e', marginBottom: 4 }}>Profit Factor</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: (stats?.profit_factor || 0) >= 1.5 ? '#089981' : '#ffd600' }}>
            {stats?.profit_factor || '0.00'}
          </div>
        </div>

        {/* Sharpe Ratio */}
        <div style={{ background: '#131722', border: '1px solid #2a2e39', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 11.5, color: '#8b949e', marginBottom: 4 }}>Sharpe Ratio</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: (stats?.sharpe_ratio || 0) >= 1.0 ? '#089981' : '#d1d4dc' }}>
            {stats?.sharpe_ratio || '0.00'}
          </div>
        </div>

        {/* TP vs SL Hits */}
        <div style={{ background: '#131722', border: '1px solid #2a2e39', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 11.5, color: '#8b949e', marginBottom: 4 }}>TP vs SL Hits</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>
            <span style={{ color: '#089981' }}>{stats?.tp_hits || 0} TP</span>
            <span style={{ color: '#8b949e', margin: '0 6px' }}>/</span>
            <span style={{ color: '#f23645' }}>{stats?.sl_hits || 0} SL</span>
          </div>
        </div>
      </div>

      {/* 3. VIEW SELECTION TABS */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid #1f2430',
        paddingBottom: 12,
        marginBottom: 16,
        flexWrap: 'wrap',
        gap: 10
      }}>
        {/* Navigation Tabs */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { id: 'monthly', label: 'Monthly Calendar', icon: CalendarIcon },
            { id: 'daily', label: 'Daily Breakdown', icon: Clock },
            { id: 'weekly', label: 'Weekly Summary', icon: Layers },
            { id: 'annual', label: 'Annual Matrix', icon: BarChart2 },
            { id: 'table', label: 'All Trade Records', icon: FileSpreadsheet },
            { id: 'ai_diagnostics', label: 'AI Scalper Audit & Coach', icon: Sparkles }
          ].map(tab => {
            const Icon = tab.icon;
            const isSel = activeView === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveView(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 14px',
                  borderRadius: 6,
                  fontSize: 12.5,
                  fontWeight: isSel ? 700 : 500,
                  color: isSel ? '#ffffff' : '#8b949e',
                  background: isSel ? '#2962ff' : '#131722',
                  border: isSel ? '1px solid #2962ff' : '1px solid #2a2e39',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* SEARCH & FILTERS */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            background: '#131722',
            border: '1px solid #2a2e39',
            borderRadius: 6,
            padding: '5px 10px',
            gap: 6
          }}>
            <Search size={13} color="#8b949e" />
            <input
              value={searchSymbol}
              onChange={e => setSearchSymbol(e.target.value)}
              placeholder="Search symbol..."
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#fff',
                fontSize: 12,
                width: 110
              }}
            />
          </div>

          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            style={{
              background: '#131722',
              border: '1px solid #2a2e39',
              borderRadius: 6,
              color: '#d1d4dc',
              padding: '5px 8px',
              fontSize: 12,
              outline: 'none'
            }}
          >
            <option value="ALL">All Categories</option>
            <option value="Forex">Forex</option>
            <option value="Commodities">Commodities</option>
            <option value="Crypto">Crypto</option>
            <option value="Indices">Indices</option>
          </select>

          <select
            value={selectedOutcome}
            onChange={e => setSelectedOutcome(e.target.value)}
            style={{
              background: '#131722',
              border: '1px solid #2a2e39',
              borderRadius: 6,
              color: '#d1d4dc',
              padding: '5px 8px',
              fontSize: 12,
              outline: 'none'
            }}
          >
            <option value="ALL">All Outcomes</option>
            <option value="WIN">Winning Trades</option>
            <option value="LOSS">Losing Trades</option>
            <option value="OPEN">Open Positions</option>
          </select>
        </div>
      </div>

      {/* 4. VIEW RENDERING */}

      {/* VIEW A: MONTHLY INTERACTIVE CALENDAR */}
      {activeView === 'monthly' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
          {/* Calendar Grid Box */}
          <div style={{ background: '#131722', border: '1px solid #2a2e39', borderRadius: 8, padding: '16px 18px' }}>
            {/* Calendar Controls */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#ffffff' }}>
                  {monthNames[month]} {year}
                </span>
                <button
                  onClick={() => setCurrentCalendarDate(new Date())}
                  style={{
                    background: '#1e222d',
                    border: '1px solid #2a2e39',
                    borderRadius: 4,
                    color: '#8b949e',
                    fontSize: 11,
                    padding: '2px 8px',
                    cursor: 'pointer'
                  }}
                >
                  Current Month
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={handlePrevMonth}
                  style={{ background: '#1e222d', border: '1px solid #2a2e39', borderRadius: 4, color: '#fff', padding: '4px 8px', cursor: 'pointer' }}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={handleNextMonth}
                  style={{ background: '#1e222d', border: '1px solid #2a2e39', borderRadius: 4, color: '#fff', padding: '4px 8px', cursor: 'pointer' }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            {/* Weekday Labels (Mon - Sun) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 6, textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#8b949e' }}>
              <div>MON</div><div>TUE</div><div>WED</div><div>THU</div><div>FRI</div><div>SAT</div><div>SUN</div>
            </div>

            {/* Calendar Days Matrix */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
              {/* Empty leading cells */}
              {Array.from({ length: startingDay }).map((_, idx) => (
                <div key={`empty-${idx}`} style={{ minHeight: 70, opacity: 0.2, background: '#0e1116', borderRadius: 6 }} />
              ))}

              {/* Day cells */}
              {Array.from({ length: daysInMonth }).map((_, idx) => {
                const dayNum = idx + 1;
                const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                const data = tradesByDay[dayStr];
                const hasTrades = data && data.trades.length > 0;
                const isDayProfit = hasTrades && data.pnl >= 0;

                return (
                  <div
                    key={dayStr}
                    onClick={() => hasTrades && setSelectedDayTrades({ date: dayStr, ...data })}
                    style={{
                      minHeight: 74,
                      background: !hasTrades ? '#0e1116' : (isDayProfit ? 'rgba(8, 153, 129, 0.12)' : 'rgba(242, 54, 69, 0.12)'),
                      border: !hasTrades ? '1px solid #1f2430' : (isDayProfit ? '1px solid rgba(8, 153, 129, 0.35)' : '1px solid rgba(242, 54, 69, 0.35)'),
                      borderRadius: 6,
                      padding: '6px 8px',
                      cursor: hasTrades ? 'pointer' : 'default',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={e => {
                      if (hasTrades) e.currentTarget.style.transform = 'scale(1.02)';
                    }}
                    onMouseLeave={e => {
                      if (hasTrades) e.currentTarget.style.transform = 'scale(1.0)';
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: hasTrades ? '#ffffff' : '#6e7681' }}>
                        {dayNum}
                      </span>
                      {hasTrades && (
                        <span style={{
                          fontSize: 9.5,
                          fontWeight: 700,
                          background: 'rgba(255,255,255,0.1)',
                          padding: '1px 4px',
                          borderRadius: 3,
                          color: '#d1d4dc'
                        }}>
                          {data.trades.length}T
                        </span>
                      )}
                    </div>

                    {hasTrades ? (
                      <div style={{ textAlign: 'right', marginTop: 4 }}>
                        <div style={{
                          fontSize: 12,
                          fontWeight: 800,
                          color: isDayProfit ? '#089981' : '#f23645',
                          fontVariantNumeric: 'tabular-nums'
                        }}>
                          {isDayProfit ? '+' : ''}{data.pnl.toFixed(2)}
                        </div>
                        <div style={{ fontSize: 9.5, color: '#8b949e' }}>
                          {data.wins}W / {data.losses}L
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 9.5, color: '#3b4252', textAlign: 'right' }}>--</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Month Summary Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: '#131722', border: '1px solid #2a2e39', borderRadius: 8, padding: '16px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#ffffff', marginBottom: 12 }}>
                Month Performance ({monthNames[month]})
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#8b949e' }}>Net Month P&L</span>
                  <strong style={{ color: currentMonthTotals.pnl >= 0 ? '#089981' : '#f23645' }}>
                    {currentMonthTotals.pnl >= 0 ? '+' : ''}{currentMonthTotals.pnl.toFixed(2)}
                  </strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#8b949e' }}>Total Trades</span>
                  <strong style={{ color: '#fff' }}>{currentMonthTotals.totalTrades}</strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#8b949e' }}>Win Rate</span>
                  <strong style={{ color: currentMonthTotals.winRate >= 50 ? '#089981' : '#ffd600' }}>
                    {currentMonthTotals.winRate}%
                  </strong>
                </div>

                {currentMonthTotals.bestDay.pnl > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: '#8b949e' }}>Best Day ({currentMonthTotals.bestDay.date.slice(8)})</span>
                    <strong style={{ color: '#089981' }}>+{currentMonthTotals.bestDay.pnl.toFixed(2)}</strong>
                  </div>
                )}
              </div>
            </div>

            {/* Selected Day Quick View */}
            {selectedDayTrades && (
              <div style={{ background: '#131722', border: '1px solid #2962ff', borderRadius: 8, padding: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <strong style={{ color: '#fff', fontSize: 13 }}>Day: {selectedDayTrades.date}</strong>
                  <button onClick={() => setSelectedDayTrades(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer' }}>×</button>
                </div>

                <div style={{ fontSize: 11.5, color: '#8b949e', marginBottom: 8 }}>
                  Net: <strong style={{ color: selectedDayTrades.pnl >= 0 ? '#089981' : '#f23645' }}>{selectedDayTrades.pnl.toFixed(2)}</strong> · {selectedDayTrades.trades.length} Trades
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                  {selectedDayTrades.trades.map(t => (
                    <div key={t.ticket} style={{ background: '#0e1116', padding: '6px 8px', borderRadius: 4, fontSize: 11 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span><strong>{t.symbol}</strong> ({t.type})</span>
                        <strong style={{ color: t.net_pnl >= 0 ? '#089981' : '#f23645' }}>{t.net_pnl >= 0 ? '+' : ''}{t.net_pnl.toFixed(2)}</strong>
                      </div>
                      <div style={{ color: '#8b949e', fontSize: 10 }}>{t.exit_reason} · {t.duration_str}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW B: DAILY BREAKDOWN */}
      {activeView === 'daily' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Object.entries(stats?.daily || {}).reverse().map(([dayStr, d]) => (
            <div key={dayStr} style={{ background: '#131722', border: '1px solid #2a2e39', borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ color: '#fff', fontSize: 14 }}>{dayStr}</strong>
                <div style={{ fontSize: 11.5, color: '#8b949e', marginTop: 2 }}>
                  {d.trades} Trades · {d.wins} Wins / {d.losses} Losses · Win Rate: {d.win_rate}%
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: d.pnl >= 0 ? '#089981' : '#f23645', fontVariantNumeric: 'tabular-nums' }}>
                  {d.pnl >= 0 ? '+' : ''}{d.pnl.toFixed(2)} {accountInfo?.currency || 'USD'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* VIEW C: WEEKLY SUMMARY */}
      {activeView === 'weekly' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Object.entries(stats?.weekly || {}).reverse().map(([weekStr, w]) => (
            <div key={weekStr} style={{ background: '#131722', border: '1px solid #2a2e39', borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ color: '#fff', fontSize: 14 }}>Week {weekStr}</strong>
                <div style={{ fontSize: 11.5, color: '#8b949e', marginTop: 2 }}>
                  {w.trades} Trades · {w.wins} Wins / {w.losses} Losses · Win Rate: {w.win_rate}%
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: w.pnl >= 0 ? '#089981' : '#f23645', fontVariantNumeric: 'tabular-nums' }}>
                  {w.pnl >= 0 ? '+' : ''}{w.pnl.toFixed(2)} {accountInfo?.currency || 'USD'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* VIEW D: ANNUAL MATRIX */}
      {activeView === 'annual' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {Object.entries(stats?.annual || {}).map(([yrStr, yr]) => (
            <div key={yrStr} style={{ background: '#131722', border: '1px solid #2a2e39', borderRadius: 8, padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ color: '#fff', fontSize: 16 }}>Year {yrStr}</strong>
                <div style={{ fontSize: 14, fontWeight: 800, color: yr.pnl >= 0 ? '#089981' : '#f23645' }}>
                  Total: {yr.pnl >= 0 ? '+' : ''}{yr.pnl.toFixed(2)} ({yr.trades} Trades)
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
                {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(m => {
                  const mPnl = yr.months?.[m] || 0;
                  return (
                    <div key={m} style={{ background: '#0e1116', border: '1px solid #1f2430', borderRadius: 6, padding: '8px 10px' }}>
                      <div style={{ fontSize: 11, color: '#8b949e' }}>{m}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: mPnl > 0 ? '#089981' : mPnl < 0 ? '#f23645' : '#6e7681', marginTop: 2 }}>
                        {mPnl !== 0 ? (mPnl > 0 ? `+${mPnl.toFixed(1)}` : mPnl.toFixed(1)) : '0.0'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* VIEW E: ALL TRADE RECORDS TABLE */}
      {activeView === 'table' && (
        <div style={{ background: '#131722', border: '1px solid #2a2e39', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#0d1117', borderBottom: '1px solid #2a2e39', color: '#8b949e', fontSize: 11 }}>
                  <th style={{ padding: '10px 14px' }}>Ticket</th>
                  <th style={{ padding: '10px 14px' }}>Open Time</th>
                  <th style={{ padding: '10px 14px' }}>Symbol</th>
                  <th style={{ padding: '10px 14px' }}>Type</th>
                  <th style={{ padding: '10px 14px' }}>Lots</th>
                  <th style={{ padding: '10px 14px' }}>Entry Price</th>
                  <th style={{ padding: '10px 14px' }}>Exit Price</th>
                  <th style={{ padding: '10px 14px' }}>Exit Reason</th>
                  <th style={{ padding: '10px 14px' }}>Duration</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Net P&L</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: '30px', color: '#8b949e' }}>
                      No trades match the current filter criteria.
                    </td>
                  </tr>
                ) : (
                  filteredTrades.map(t => {
                    const isWin = t.net_pnl > 0;
                    const isLoss = t.net_pnl < 0;

                    return (
                      <tr
                        key={t.ticket}
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', transition: 'background 0.1s' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#1a1e29'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={{ padding: '9px 14px', color: '#8b949e', fontFamily: 'monospace' }}>
                          #{t.ticket}
                        </td>
                        <td style={{ padding: '9px 14px', color: '#d1d4dc', whiteSpace: 'nowrap' }}>
                          {t.open_time_str}
                        </td>
                        <td style={{ padding: '9px 14px' }}>
                          <span
                            onClick={() => onSelectSymbolAndGoToChart(t.symbol)}
                            style={{ fontWeight: 700, color: '#fff', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: '#2962ff' }}
                          >
                            {t.symbol}
                          </span>
                        </td>
                        <td style={{ padding: '9px 14px' }}>
                          <span style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 3,
                            background: t.type === 'BUY' ? 'rgba(8,153,129,0.2)' : 'rgba(242,54,69,0.2)',
                            color: t.type === 'BUY' ? '#089981' : '#f23645'
                          }}>
                            {t.type}
                          </span>
                        </td>
                        <td style={{ padding: '9px 14px', fontWeight: 600 }}>
                          {t.volume.toFixed(2)}
                        </td>
                        <td style={{ padding: '9px 14px', fontVariantNumeric: 'tabular-nums' }}>
                          {t.open_price}
                        </td>
                        <td style={{ padding: '9px 14px', fontVariantNumeric: 'tabular-nums' }}>
                          {t.close_price || '---'}
                        </td>
                        <td style={{ padding: '9px 14px' }}>
                          <span style={{
                            fontSize: 10.5,
                            fontWeight: 600,
                            padding: '2px 7px',
                            borderRadius: 4,
                            background: t.exit_reason === 'TP Hit' ? 'rgba(8,153,129,0.15)' :
                                        t.exit_reason === 'SL Hit' ? 'rgba(242,54,69,0.15)' :
                                        t.exit_reason === 'OPEN' ? 'rgba(186,104,200,0.15)' : 'rgba(41,98,255,0.15)',
                            color: t.exit_reason === 'TP Hit' ? '#089981' :
                                   t.exit_reason === 'SL Hit' ? '#f23645' :
                                   t.exit_reason === 'OPEN' ? '#ba68c8' : '#2962ff'
                          }}>
                            {t.exit_reason}
                          </span>
                        </td>
                        <td style={{ padding: '9px 14px', color: '#8b949e', fontSize: 11 }}>
                          {t.duration_str}
                        </td>
                        <td style={{
                          padding: '9px 14px',
                          textAlign: 'right',
                          fontWeight: 800,
                          color: isWin ? '#089981' : isLoss ? '#f23645' : '#8b949e',
                          fontVariantNumeric: 'tabular-nums'
                        }}>
                          {isWin ? '+' : ''}{t.net_pnl.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6. AI SCALPER AUDIT & POST-MORTEM DIAGNOSTICS */}
      {activeView === 'ai_diagnostics' && (
        <ScalperAuditView onSelectSymbolAndGoToChart={onSelectSymbolAndGoToChart} />
      )}
    </div>
  );
}
