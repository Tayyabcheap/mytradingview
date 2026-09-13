import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldAlert, ShieldCheck, Zap, AlertTriangle, TrendingUp, TrendingDown,
  FileSpreadsheet, FileText, RefreshCw, CheckCircle2, XCircle, Search,
  ArrowUpRight, ArrowDownRight, Compass, Target, Info, Sparkles, Sliders
} from 'lucide-react';

export default function ScalperAuditView({ onSelectSymbolAndGoToChart }) {
  const [report, setReport] = useState(null);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lookbackDays, setLookbackDays] = useState(7);
  const [selectedVerdict, setSelectedVerdict] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [inspectTrade, setInspectTrade] = useState(null);

  // Fetch report and audited trades
  const fetchData = async () => {
    try {
      setLoading(true);
      const [repRes, tradesRes] = await Promise.all([
        fetch(`/api/scalper/audit/report?days=${lookbackDays}`),
        fetch(`/api/scalper/audit/trades?days=${lookbackDays}`)
      ]);
      const repData = await repRes.json();
      const trData = await tradesRes.json();

      if (repData && !repData.error) setReport(repData);
      if (Array.isArray(trData)) setTrades(trData);
    } catch (err) {
      console.error('[SCALPER_AUDIT] Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [lookbackDays]);

  // Sync historical candles / backtest forward trajectory
  const handleSync = async () => {
    try {
      setSyncing(true);
      const res = await fetch('/api/scalper/audit/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: 'XAUUSD', bars: 2000 })
      });
      const data = await res.json();
      if (data.success) {
        await fetchData();
      }
    } catch (err) {
      console.error('[SCALPER_AUDIT] Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  // Download Markdown Coaching Report
  const handleExportMarkdown = () => {
    if (!report) return;
    const nowStr = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
    const lines = [
      `# Haider-Gold-Scalper Weekly AI Coaching & Diagnostic Report`,
      `Generated: ${nowStr} | Lookback: Last ${lookbackDays} Days | Sample Size: ${report.sample_size || 0} Closed Trades`,
      '',
      `## 1. Executive Performance Scorecard`,
      `| Metric | Result | Potential with Optimized SL/TP | Edge Recovery |`,
      `|---|---|---|---|`,
      `| **Win Rate** | ${report.win_rate || 0}% (${report.wins || 0}W / ${report.losses || 0}L) | ${report.recoverable_win_rate || 0}% | +${((report.recoverable_win_rate || 0) - (report.win_rate || 0)).toFixed(1)}% |`,
      `| **Profit Factor** | ${report.profit_factor || 0} | ${((report.profit_factor || 0) * 1.35).toFixed(2)} (est) | +35% Efficiency |`,
      `| **Net Realized PnL** | $${(report.total_pnl_usd || 0).toFixed(2)} | $${((report.total_pnl_usd || 0) + (report.sl_hunt_loss_usd || 0)).toFixed(2)} | +$${(report.sl_hunt_loss_usd || 0).toFixed(2)} |`,
      `| **Total Net Pips** | ${(report.total_pnl_pips || 0).toFixed(1)} pips | ${((report.total_pnl_pips || 0) + (report.pips_left_on_table || 0)).toFixed(1)} pips | +${(report.pips_left_on_table || 0).toFixed(1)} pips |`,
      '',
      `## 2. Decision Attribution & Mistake Diagnostics ("The Game")`,
      `### A. Premature Stop-Loss Hunts (Inaccurate SL Placement)`,
      `- Occurrences: ${report.sl_hunt_count || 0} trades were stopped out prematurely.`,
      `- Direct Capital Cost: $${(report.sl_hunt_loss_usd || 0).toFixed(2)} lost on trades that subsequently hit TP.`,
      `- Median SL Overshoot: ${report.median_overshoot_pips || 0} pips (Price only exceeded SL by this distance before reversing!).`,
      `- Diagnosis: Adding a +${((report.median_overshoot_pips || 0) + 3.0).toFixed(1)} pip buffer behind swing wicks would recover these wins.`,
      '',
      `### B. Money Left on the Table (Undersized TP Targets)`,
      `- Occurrences: ${report.runners_missed_count || 0} winning trades exploded past TP1.`,
      `- Unrealized Pip Extension: +${report.pips_left_on_table || 0} pips left on the table.`,
      '',
      `## 3. Prescriptive AI Algorithmic Recommendations`
    ];
    (report.recommendations || []).forEach(r => lines.push(`- ${r}`));
    lines.push('', '## 4. Trade Post-Mortem Audit Records', '| ID | Time | Dir | Entry | SL | TP | Exit Reason | PnL | Verdict | Note |', '|---|---|---|---|---|---|---|---|---|---|');
    trades.forEach(t => {
      const diag = t.post_exit_analysis || {};
      lines.push(`| ${t.id} | ${t.entry_time_str} | ${t.direction} | $${t.entry_price} | $${t.planned_sl} | $${t.planned_tp1} | ${t.exit_reason} | $${t.pnl_usd} | ${diag.diagnosis_verdict || 'PENDING'} | ${diag.actionable_coaching_note || ''} |`);
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Weekly_Scalper_Coaching_Report_${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered trades
  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const sym = (t.symbol || '').toLowerCase();
        const id = (t.id || '').toLowerCase();
        if (!sym.includes(q) && !id.includes(q)) return false;
      }
      if (selectedVerdict !== 'ALL') {
        const v = (t.post_exit_analysis || {}).diagnosis_verdict || '';
        if (v !== selectedVerdict) return false;
      }
      return true;
    });
  }, [trades, searchQuery, selectedVerdict]);

  const renderVerdictBadge = (verdict, note) => {
    switch (verdict) {
      case 'PREMATURE_SL_HUNT':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            borderRadius: 4,
            background: 'rgba(239, 68, 68, 0.15)',
            color: '#f87171',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            fontSize: 11,
            fontWeight: 700
          }}>
            <AlertTriangle size={12} /> SL HUNTED
          </span>
        );
      case 'RUNNER_LEFT_ON_TABLE':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            borderRadius: 4,
            background: 'rgba(245, 158, 11, 0.15)',
            color: '#fbbf24',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            fontSize: 11,
            fontWeight: 700
          }}>
            <Zap size={12} /> RUNNER MISSED
          </span>
        );
      case 'CLEAN_WIN':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            borderRadius: 4,
            background: 'rgba(16, 185, 129, 0.15)',
            color: '#34d399',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            fontSize: 11,
            fontWeight: 700
          }}>
            <CheckCircle2 size={12} /> CLEAN TARGET
          </span>
        );
      case 'VALID_INVALIDATION':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            borderRadius: 4,
            background: 'rgba(107, 114, 128, 0.2)',
            color: '#9ca3af',
            border: '1px solid rgba(107, 114, 128, 0.4)',
            fontSize: 11,
            fontWeight: 700
          }}>
            <ShieldCheck size={12} /> VALID STOP
          </span>
        );
      case 'PREMATURE_MANUAL_EXIT':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            borderRadius: 4,
            background: 'rgba(217, 119, 6, 0.18)',
            color: '#f59e0b',
            border: '1px solid rgba(217, 119, 6, 0.35)',
            fontSize: 11,
            fontWeight: 700
          }}>
            <Sliders size={12} /> EARLY EXIT
          </span>
        );
      default:
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            borderRadius: 4,
            background: '#1e222d',
            color: '#8b949e',
            fontSize: 11
          }}>
            {verdict || 'PENDING'}
          </span>
        );
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* 1. TOP HEADER & ACTION CONTROLS */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        background: 'linear-gradient(135deg, rgba(26, 31, 46, 0.8) 0%, rgba(13, 17, 23, 0.9) 100%)',
        border: '1px solid #2a2e39',
        borderRadius: 10,
        padding: '16px 20px'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              background: 'linear-gradient(90deg, #f59e0b 0%, #ec4899 100%)',
              color: '#000000',
              fontSize: 11,
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: 4,
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              AI Post-Mortem Engine
            </span>
            <h2 style={{ fontSize: 19, fontWeight: 800, color: '#ffffff', margin: 0 }}>
              Haider-Gold-Scalper Trade & Mistake Diagnostics
            </h2>
          </div>
          <div style={{ fontSize: 12.5, color: '#8b949e', marginTop: 4 }}>
            Evaluating decisions: Identifying premature Stop-Loss hunts, undersized targets, and edge recovery potentials.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Lookback Selector */}
          <select
            value={lookbackDays}
            onChange={e => setLookbackDays(parseInt(e.target.value))}
            style={{
              background: '#1e222d',
              border: '1px solid #2a2e39',
              borderRadius: 6,
              color: '#d1d4dc',
              padding: '7px 12px',
              fontSize: 12,
              fontWeight: 600,
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value={7}>Last 7 Days</option>
            <option value={14}>Last 14 Days</option>
            <option value={30}>Last 30 Days</option>
            <option value={90}>Last 90 Days</option>
            <option value={365}>All History</option>
          </select>

          {/* Sync Forward Trajectory Button */}
          <button
            onClick={handleSync}
            disabled={syncing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: '#1e222d',
              border: '1px solid #3b82f6',
              borderRadius: 6,
              padding: '7px 12px',
              color: '#60a5fa',
              fontSize: 12,
              fontWeight: 600,
              cursor: syncing ? 'not-allowed' : 'pointer'
            }}
            title="Re-evaluates forward 40 bars to detect SL hunts & runners"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Evaluating Trajectory...' : 'Sync Trajectory'}
          </button>

          {/* Download Weekly Markdown Coaching Report */}
          <button
            onClick={handleExportMarkdown}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'linear-gradient(135deg, #089981 0%, #056656 100%)',
              border: 'none',
              borderRadius: 6,
              padding: '7px 14px',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(8, 153, 129, 0.3)'
            }}
            title="Download full weekly analysis Markdown for the AI Assistant"
          >
            <FileText size={14} /> Export Coaching Report (.md)
          </button>
        </div>
      </div>

      {/* 2. EXECUTIVE SCORECARD BANNER */}
      {report && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12
        }}>
          {/* Win Rate vs Recoverable Win Rate */}
          <div style={{
            background: '#131722',
            border: '1px solid #2a2e39',
            borderRadius: 8,
            padding: '16px 18px',
            position: 'relative',
            overflow: 'hidden'
          }}>
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
              <span>Win Rate & Edge Recovery</span>
              <span style={{ color: '#34d399', fontWeight: 700 }}>
                +{((report.recoverable_win_rate || 0) - (report.win_rate || 0)).toFixed(1)}% Potential
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#ffffff' }}>
                {report.win_rate || 0}%
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#089981' }}>
                → {report.recoverable_win_rate || 0}%
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: '#8b949e', marginTop: 4 }}>
              If premature SL hunts had a +{((report.median_overshoot_pips || 7) + 3).toFixed(1)} pip buffer
            </div>
          </div>

          {/* Premature SL Hunts */}
          <div style={{
            background: '#131722',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 8,
            padding: '16px 18px'
          }}>
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
              <span>Premature SL Hunts</span>
              <span style={{ color: '#f87171', fontWeight: 700 }}>
                -${(report.sl_hunt_loss_usd || 0).toFixed(0)} Lost
              </span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#f87171' }}>
              {report.sl_hunt_count || 0} <span style={{ fontSize: 13, color: '#8b949e' }}>trades</span>
            </div>
            <div style={{ fontSize: 11.5, color: '#8b949e', marginTop: 4 }}>
              Median overshoot: <b style={{ color: '#ffd600' }}>{report.median_overshoot_pips || 0} pips</b> before reversing to TP
            </div>
          </div>

          {/* Missed Runners (Undersized Targets) */}
          <div style={{
            background: '#131722',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: 8,
            padding: '16px 18px'
          }}>
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
              <span>Money Left on Table</span>
              <span style={{ color: '#fbbf24', fontWeight: 700 }}>
                +{report.pips_left_on_table || 0} pips
              </span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#fbbf24' }}>
              {report.runners_missed_count || 0} <span style={{ fontSize: 13, color: '#8b949e' }}>runners</span>
            </div>
            <div style={{ fontSize: 11.5, color: '#8b949e', marginTop: 4 }}>
              Impulse continued 25–80 pips past initial TP1
            </div>
          </div>

          {/* Net Realized PnL & Profit Factor */}
          <div style={{
            background: '#131722',
            border: '1px solid #2a2e39',
            borderRadius: 8,
            padding: '16px 18px'
          }}>
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
              <span>Realized Net P&L</span>
              <span style={{ color: '#8b949e' }}>PF: {report.profit_factor || 0}</span>
            </div>
            <div style={{
              fontSize: 24,
              fontWeight: 800,
              color: (report.total_pnl_usd || 0) >= 0 ? '#089981' : '#f23645'
            }}>
              {(report.total_pnl_usd || 0) >= 0 ? '+' : ''}${(report.total_pnl_usd || 0).toFixed(2)}
            </div>
            <div style={{ fontSize: 11.5, color: '#8b949e', marginTop: 4 }}>
              Total Net Pips: <b style={{ color: '#ffffff' }}>{(report.total_pnl_pips || 0).toFixed(1)} pips</b>
            </div>
          </div>
        </div>
      )}

      {/* 3. PRESCRIPTIVE AI COACHING RECOMMENDATIONS */}
      {report && report.recommendations && report.recommendations.length > 0 && (
        <div style={{
          background: 'rgba(30, 41, 59, 0.4)',
          border: '1px solid #334155',
          borderRadius: 8,
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#38bdf8', fontWeight: 700, fontSize: 14 }}>
            <Sparkles size={16} /> Prescriptive Algorithmic Optimization & Weekly Coaching Rules
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            {report.recommendations.map((rec, idx) => (
              <div
                key={idx}
                style={{
                  fontSize: 12.5,
                  color: '#cbd5e1',
                  background: 'rgba(15, 23, 42, 0.6)',
                  padding: '10px 14px',
                  borderRadius: 6,
                  borderLeft: '3px solid #38bdf8',
                  lineHeight: '1.5'
                }}
                dangerouslySetInnerHTML={{
                  __html: rec.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #ffffff">$1</strong>')
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* 4. FILTER CONTROLS & VERDICT TABS */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 10,
        paddingBottom: 4
      }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { id: 'ALL', label: `All Signals (${trades.length})` },
            { id: 'PREMATURE_SL_HUNT', label: `⚠️ SL Hunts (${trades.filter(t => (t.post_exit_analysis || {}).diagnosis_verdict === 'PREMATURE_SL_HUNT').length})` },
            { id: 'RUNNER_LEFT_ON_TABLE', label: `💰 Missed Runners (${trades.filter(t => (t.post_exit_analysis || {}).diagnosis_verdict === 'RUNNER_LEFT_ON_TABLE').length})` },
            { id: 'CLEAN_WIN', label: `🎯 Clean Wins (${trades.filter(t => (t.post_exit_analysis || {}).diagnosis_verdict === 'CLEAN_WIN').length})` },
            { id: 'VALID_INVALIDATION', label: `🛑 Valid Stops (${trades.filter(t => (t.post_exit_analysis || {}).diagnosis_verdict === 'VALID_INVALIDATION').length})` },
            { id: 'PREMATURE_MANUAL_EXIT', label: `⚠️ Early Manual (${trades.filter(t => (t.post_exit_analysis || {}).diagnosis_verdict === 'PREMATURE_MANUAL_EXIT').length})` }
          ].map(btn => {
            const isSel = selectedVerdict === btn.id;
            return (
              <button
                key={btn.id}
                onClick={() => setSelectedVerdict(btn.id)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: isSel ? 700 : 500,
                  background: isSel ? '#2962ff' : '#1e222d',
                  color: isSel ? '#ffffff' : '#8b949e',
                  border: isSel ? '1px solid #2962ff' : '1px solid #2a2e39',
                  cursor: 'pointer'
                }}
              >
                {btn.label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div style={{ position: 'relative', width: 200 }}>
          <Search size={14} color="#8b949e" style={{ position: 'absolute', left: 10, top: 9 }} />
          <input
            type="text"
            placeholder="Filter by symbol/ID..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              background: '#1e222d',
              border: '1px solid #2a2e39',
              borderRadius: 6,
              padding: '6px 10px 6px 30px',
              color: '#d1d4dc',
              fontSize: 12,
              outline: 'none'
            }}
          />
        </div>
      </div>

      {/* 5. AUDIT LOG TABLE */}
      <div style={{
        background: '#131722',
        border: '1px solid #2a2e39',
        borderRadius: 8,
        overflow: 'hidden'
      }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#181d28', borderBottom: '1px solid #2a2e39', color: '#8b949e' }}>
                <th style={{ padding: '10px 14px' }}>Ticket / Signal</th>
                <th style={{ padding: '10px 14px' }}>Time</th>
                <th style={{ padding: '10px 14px' }}>Symbol</th>
                <th style={{ padding: '10px 14px' }}>Type</th>
                <th style={{ padding: '10px 14px' }}>Entry</th>
                <th style={{ padding: '10px 14px' }}>SL / TP</th>
                <th style={{ padding: '10px 14px' }}>Exit Reason</th>
                <th style={{ padding: '10px 14px' }}>PnL ($ / Pips)</th>
                <th style={{ padding: '10px 14px' }}>Diagnostic Verdict</th>
                <th style={{ padding: '10px 14px' }}>Post-Mortem Findings</th>
                <th style={{ padding: '10px 14px', textAlign: 'center' }}>Inspect</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ padding: 30, textAlign: 'center', color: '#8b949e' }}>
                    No audit records matching criteria. Sync backtest or place new trades to populate records.
                  </td>
                </tr>
              ) : (
                filteredTrades.map((t, idx) => {
                  const diag = t.post_exit_analysis || {};
                  const isBuy = (t.direction || '').toUpperCase() === 'BUY';
                  const pnlVal = parseFloat(t.pnl_usd || 0);

                  return (
                    <tr
                      key={t.id || idx}
                      style={{
                        borderBottom: '1px solid #1f2430',
                        background: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.015)'
                      }}
                    >
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: '#ffffff' }}>
                        {(t.id || '').replace('HGS_', '').slice(0, 16)}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#8b949e', whiteSpace: 'nowrap' }}>
                        {t.entry_time_str || ''}
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: '#ffd600' }}>
                        {t.symbol}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: isBuy ? 'rgba(8, 153, 129, 0.2)' : 'rgba(242, 54, 69, 0.2)',
                          color: isBuy ? '#089981' : '#f23645',
                          fontWeight: 700,
                          fontSize: 11
                        }}>
                          {t.direction}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', fontVariantNumeric: 'tabular-nums' }}>
                        ${t.entry_price?.toFixed(2)}
                      </td>
                      <td style={{ padding: '10px 14px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        <span style={{ color: '#f87171' }}>SL: ${t.planned_sl?.toFixed(2)}</span>
                        <br />
                        <span style={{ color: '#34d399' }}>TP: ${t.planned_tp1?.toFixed(2)}</span>
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{
                          fontSize: 11,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: '#1e222d',
                          color: t.exit_reason === 'TP_HIT' ? '#34d399' : (t.exit_reason === 'SL_HIT' ? '#f87171' : '#d1d4dc')
                        }}>
                          {t.exit_reason || 'CLOSED'}
                        </span>
                      </td>
                      <td style={{
                        padding: '10px 14px',
                        fontWeight: 700,
                        color: pnlVal >= 0 ? '#089981' : '#f23645',
                        fontVariantNumeric: 'tabular-nums'
                      }}>
                        {pnlVal >= 0 ? '+' : ''}${pnlVal.toFixed(2)}
                        <br />
                        <span style={{ fontSize: 10.5, color: '#8b949e' }}>
                          {t.pnl_pips >= 0 ? '+' : ''}{t.pnl_pips} pips
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        {renderVerdictBadge(diag.diagnosis_verdict, diag.actionable_coaching_note)}
                      </td>
                      <td style={{
                        padding: '10px 14px',
                        color: '#94a3b8',
                        fontSize: 11.5,
                        maxWidth: 280,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }} title={diag.actionable_coaching_note}>
                        {diag.actionable_coaching_note || 'Trajectory within bounds'}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <button
                          onClick={() => setInspectTrade(t)}
                          style={{
                            background: '#1e222d',
                            border: '1px solid #2a2e39',
                            color: '#38bdf8',
                            borderRadius: 4,
                            padding: '4px 8px',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 6. INSPECT POST-MORTEM MODAL */}
      {inspectTrade && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(5px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: 20
        }}>
          <div style={{
            background: '#131722',
            border: '1px solid #2a2e39',
            borderRadius: 12,
            width: '100%',
            maxWidth: 620,
            padding: 24,
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase' }}>
                  Post-Mortem Diagnostic Breakdown
                </span>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: '#ffffff', margin: '4px 0 0 0' }}>
                  Trade #{inspectTrade.id} ({inspectTrade.symbol})
                </h3>
              </div>
              <button
                onClick={() => setInspectTrade(null)}
                style={{
                  background: '#1e222d',
                  border: 'none',
                  color: '#8b949e',
                  borderRadius: 6,
                  padding: '6px 12px',
                  cursor: 'pointer'
                }}
              >
                ✕ Close
              </button>
            </div>

            {/* Verdict Badge */}
            <div style={{ padding: '8px 12px', borderRadius: 6, background: '#181d28', border: '1px solid #2a2e39', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: '#8b949e', fontSize: 12 }}>Diagnostic Status:</span>
              {renderVerdictBadge((inspectTrade.post_exit_analysis || {}).diagnosis_verdict)}
            </div>

            {/* Trade Metrics Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 10,
              background: '#0d1117',
              padding: 14,
              borderRadius: 8,
              border: '1px solid #1f2430'
            }}>
              <div>
                <div style={{ fontSize: 11, color: '#8b949e' }}>Entry Price</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#ffffff' }}>${inspectTrade.entry_price?.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#8b949e' }}>Planned Stop Loss</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#f87171' }}>${inspectTrade.planned_sl?.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#8b949e' }}>Planned Target (TP1)</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#34d399' }}>${inspectTrade.planned_tp1?.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#8b949e' }}>Exit Price</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#ffffff' }}>${inspectTrade.exit_price?.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#8b949e' }}>Realized P&L</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: inspectTrade.pnl_usd >= 0 ? '#089981' : '#f23645' }}>
                  ${inspectTrade.pnl_usd?.toFixed(2)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#8b949e' }}>Exit Reason</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#ffd600' }}>{inspectTrade.exit_reason}</div>
              </div>
            </div>

            {/* Trajectory Evaluation */}
            <div style={{
              background: 'rgba(30, 41, 59, 0.4)',
              border: '1px solid #334155',
              borderRadius: 8,
              padding: 14
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8', marginBottom: 6 }}>
                📈 Subsequent 40-Bar Trajectory Evaluation
              </div>
              <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: '1.6' }}>
                {(inspectTrade.post_exit_analysis || {}).actionable_coaching_note || 'Trajectory conformed to planned risk boundaries.'}
              </div>

              {(inspectTrade.post_exit_analysis || {}).sl_hunt_detected && (
                <div style={{
                  marginTop: 10,
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  fontSize: 11.5,
                  color: '#f87171'
                }}>
                  ⚠️ <b>Premature Stop-Out Analysis:</b> Price overshot SL by only{' '}
                  <b>{(inspectTrade.post_exit_analysis || {}).sl_overshoot_pips} pips</b> before rallying to target.
                  Adding a +{(((inspectTrade.post_exit_analysis || {}).sl_overshoot_pips || 0) + 3).toFixed(1)} pip buffer would have preserved this setup.
                </div>
              )}

              {(inspectTrade.post_exit_analysis || {}).runner_left_on_table && (
                <div style={{
                  marginTop: 10,
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'rgba(245, 158, 11, 0.12)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  fontSize: 11.5,
                  color: '#fbbf24'
                }}>
                  💰 <b>Runner Left on Table:</b> Price exploded an additional{' '}
                  <b>+{(inspectTrade.post_exit_analysis || {}).money_left_on_table_pips} pips</b> beyond TP1.
                  Consider a 2-stage exit: close 50% at TP1 and trail the remainder with an ATR trailing stop.
                </div>
              )}
            </div>

            <button
              onClick={() => {
                if (onSelectSymbolAndGoToChart) {
                  onSelectSymbolAndGoToChart(inspectTrade.symbol);
                }
                setInspectTrade(null);
              }}
              style={{
                background: '#2962ff',
                border: 'none',
                color: '#ffffff',
                borderRadius: 6,
                padding: '10px 16px',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Open Chart for {inspectTrade.symbol}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
