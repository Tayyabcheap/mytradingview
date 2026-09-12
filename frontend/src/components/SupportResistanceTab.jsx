import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Target, ChevronDown, SplitSquareVertical, SplitSquareHorizontal, 
  RefreshCw, TrendingUp, TrendingDown, Shield, Zap, Info, ArrowUpRight, 
  CheckCircle2, AlertCircle, Maximize2, Minimize2, BarChart2, DollarSign,
  Crosshair, Clock, AlertTriangle, ArrowRight, Play, Check, Compass, GitMerge,
  Sparkles, Eye, EyeOff, Layers, SlidersHorizontal, CheckSquare, Square, X
} from 'lucide-react';
import KLineChartArea from './KLineChartArea';

const TIMEFRAMES = [
  { id: '1M', label: '1m' },
  { id: '5M', label: '5m' },
  { id: '15M', label: '15m' },
  { id: '30M', label: '30m' },
  { id: '1H', label: '1h' },
  { id: '4H', label: '4h' },
  { id: '1D', label: '1D' }
];

const PRESETS = [
  { label: '15M & 1H (Intraday Confluence)', tf1: '15M', tf2: '1H' },
  { label: '5M & 15M (Scalp S/R)', tf1: '5M', tf2: '15M' },
  { label: '1H & 4H (Swing Pivots)', tf1: '1H', tf2: '4H' },
  { label: '4H & 1D (Macro Levels)', tf1: '4H', tf2: '1D' }
];

export default function SupportResistanceTab({ 
  accountInfo, 
  onSelectSymbolAndGoToChart,
  defaultSymbol = "XAUUSDc" 
}) {
  // Resolve symbol
  const activeSymbol = defaultSymbol || "XAUUSDc";

  const [tf1, setTf1] = useState('15M');
  const [tf2, setTf2] = useState('1H');
  const [layout, setLayout] = useState('side-by-side'); // 'side-by-side' | 'stacked' | 'chart1-only' | 'chart2-only'
  const [showDrawer, setShowDrawer] = useState(true);
  const [activeDrawerTab, setActiveDrawerTab] = useState('confluence'); // 'confluence' | 'tf1' | 'tf2'
  
  // Zone visibility & filtering state - DEFAULT TO 'nearest' TO ELIMINATE CLUTTER
  const [zoneFilterMode, setZoneFilterMode] = useState('nearest'); // 'nearest' | 'nearest2' | 'all' | 'custom'
  const [activeZoneIds, setActiveZoneIds] = useState(null); // Array of string IDs when custom
  const [showZonePickerModal, setShowZonePickerModal] = useState(false);

  // Real-time Support and Resistance API state
  const [srData, setSrData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPrice, setCurrentPrice] = useState(null);

  const chart1Ref = useRef(null);
  const chart2Ref = useRef(null);

  const tf1Zones = useMemo(() => srData?.tf1?.all_zones || [], [srData?.tf1?.all_zones]);
  const tf2Zones = useMemo(() => srData?.tf2?.all_zones || [], [srData?.tf2?.all_zones]);

  // Indicators configurations for each chart pane using SR_ZONES overlay
  const indicators1 = useMemo(() => [
    {
      instanceId: `SR_${tf1}`,
      id: 'SR_ZONES',
      name: `S/R Zones (${tf1})`,
      shortName: 'S/R',
      isStack: false,
      visible: true,
      params: { 
        tf: tf1,
        tfs: [tf1], 
        zones: tf1Zones,
        filterMode: zoneFilterMode, 
        maxZones: zoneFilterMode === 'nearest' ? 1 : (zoneFilterMode === 'nearest2' ? 2 : 5),
        activeZoneIds: activeZoneIds,
        pivot: 3 
      }
    }
  ], [tf1, tf1Zones, zoneFilterMode, activeZoneIds]);

  const indicators2 = useMemo(() => [
    {
      instanceId: `SR_${tf2}`,
      id: 'SR_ZONES',
      name: `S/R Zones (${tf2})`,
      shortName: 'S/R',
      isStack: false,
      visible: true,
      params: { 
        tf: tf2,
        tfs: [tf2], 
        zones: tf2Zones,
        filterMode: zoneFilterMode, 
        maxZones: zoneFilterMode === 'nearest' ? 1 : (zoneFilterMode === 'nearest2' ? 2 : 5),
        activeZoneIds: activeZoneIds,
        pivot: 3 
      }
    }
  ], [tf2, tf2Zones, zoneFilterMode, activeZoneIds]);

  const fetchSupportResistance = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/support_resistance?symbol=${encodeURIComponent(activeSymbol)}&tf1=${tf1}&tf2=${tf2}`);
      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        throw new Error(`Server returned non-JSON HTTP ${res.status}`);
      }
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to calculate Support and Resistance');
      }
      setSrData(data);
      if (data.current_price) setCurrentPrice(data.current_price);
    } catch (err) {
      console.warn("Support & Resistance fetch note:", err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSupportResistance();
    const timer = setInterval(fetchSupportResistance, 10000); // 10-second refresh for fresh live bars
    return () => clearInterval(timer);
  }, [activeSymbol, tf1, tf2]);

  const [lotSize, setLotSize] = useState(() => {
    try {
      const saved = localStorage.getItem('twr_lot_size');
      return saved ? Math.min(1.0, parseFloat(saved) || 0.10) : 0.10;
    } catch { return 0.10; }
  });
  const [executingTrade, setExecutingTrade] = useState(false);
  const [tradeFeedback, setTradeFeedback] = useState(null);

  const handleLotChange = (val) => {
    const isGold = activeSymbol.toUpperCase().includes('XAU');
    const maxAllowed = isGold ? 1.0 : 10.0;
    const clamped = Math.max(0.01, Math.min(maxAllowed, Math.round(val * 100) / 100));
    setLotSize(clamped);
    try { localStorage.setItem('twr_lot_size', clamped.toString()); } catch {}
  };

  const handleExecuteTrade = async (rawSetup) => {
    const setup = rawSetup?.trade_setup || rawSetup;
    if (!setup || !setup.action) return;
    setExecutingTrade(true);
    setTradeFeedback(null);
    try {
      const res = await fetch('/api/order/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: activeSymbol,
          type: setup.action,
          volume: lotSize,
          sl: setup.sl,
          tp: setup.tp1,
          comment: `SR-${setup.action}`
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to send order to MT5');
      }
      setTradeFeedback({
        type: 'success',
        text: `Order Executed! Ticket #${data.ticket || data.order_id || 'OK'} (${setup.action} ${lotSize.toFixed(2)} Lot @ $${setup.entry ? setup.entry.toFixed(3) : ''})`
      });
      setTimeout(() => setTradeFeedback(null), 6000);
    } catch (err) {
      setTradeFeedback({ type: 'error', text: err.message });
      setTimeout(() => setTradeFeedback(null), 7000);
    } finally {
      setExecutingTrade(false);
    }
  };

  const [customTradeSetup, setCustomTradeSetup] = useState(null);

  const confluences = srData?.confluences || [];
  const confirmations = srData?.confirmations || [];
  const primaryConfirmation = srData?.primary_confirmation || (confirmations.length > 0 ? confirmations[0] : null);

  const defaultSetup = (primaryConfirmation && primaryConfirmation.status === 'CONFIRMED' && primaryConfirmation.bars_ago <= 4)
    ? {
        action: primaryConfirmation.action,
        entry: primaryConfirmation.entry,
        sl: primaryConfirmation.sl,
        sl_note: primaryConfirmation.action === 'BUY' ? `Indecision Lowest Wick ($${primaryConfirmation.sl.toFixed(3)})` : `Indecision Highest Wick ($${primaryConfirmation.sl.toFixed(3)})`,
        tp1: primaryConfirmation.tp1,
        tp2: primaryConfirmation.tp2,
        risk_pts: primaryConfirmation.risk_pts,
        risk_pips: primaryConfirmation.risk_pips,
        reward_pts: primaryConfirmation.reward_pts,
        reward_pips: primaryConfirmation.reward_pips,
        rr_ratio: primaryConfirmation.rr_ratio
      }
    : (srData?.primary_setup?.trade_setup || confluences[0]?.trade_setup || null);

  const activeTradeSetup = customTradeSetup || defaultSetup;
  const primarySetup = srData?.primary_setup || confluences[0] || null;
  const isTriggerReady = primarySetup?.condition?.state === 'TRIGGER_READY' || primaryConfirmation?.status === 'CONFIRMED';

  const nearestSupport = srData?.nearest_support || srData?.tf1?.nearest_support || null;
  const nearestResistance = srData?.nearest_resistance || srData?.tf1?.nearest_resistance || null;

  const handleApplyConfirmation = (conf) => {
    setCustomTradeSetup({
      action: conf.action,
      entry: conf.entry,
      sl: conf.sl,
      sl_note: conf.action === 'BUY' ? `Indecision Lowest Wick ($${conf.sl.toFixed(3)})` : `Indecision Highest Wick ($${conf.sl.toFixed(3)})`,
      tp1: conf.tp1,
      tp2: conf.tp2,
      risk_pts: conf.risk_pts,
      risk_pips: conf.risk_pips,
      reward_pts: conf.reward_pts,
      reward_pips: conf.reward_pips,
      rr_ratio: conf.rr_ratio
    });
  };

  const allAvailableZones = useMemo(() => {
    return [...tf1Zones, ...tf2Zones];
  }, [tf1Zones, tf2Zones]);

  const toggleZoneVisibility = (zoneId) => {
    setZoneFilterMode('custom');
    setActiveZoneIds(prev => {
      let cur;
      if (prev) {
        cur = [...prev];
      } else if (zoneFilterMode === 'nearest') {
        cur = [nearestSupport?.id, nearestResistance?.id].filter(Boolean);
      } else {
        cur = allAvailableZones.map(z => z.id);
      }
      if (cur.includes(zoneId)) {
        return cur.filter(x => x !== zoneId);
      } else {
        return [...cur, zoneId];
      }
    });
  };

  const isZoneVisible = (z) => {
    const zId = z.id || `${z.timeframe || tf1}_${z.side === 'SUPPORT' ? 'S' : 'R'}_${Math.round(z.top)}_${Math.round(z.bottom)}`;
    if (zoneFilterMode === 'nearest') {
      return (nearestSupport && z.id === nearestSupport.id) || (nearestResistance && z.id === nearestResistance.id);
    }
    if (zoneFilterMode === 'nearest2') {
      const top2Supp = tf1Zones.filter(x => x.side === 'SUPPORT').slice(0, 2);
      const top2Res = tf1Zones.filter(x => x.side === 'RESISTANCE').slice(0, 2);
      return top2Supp.some(x => x.id === z.id) || top2Res.some(x => x.id === z.id);
    }
    if (zoneFilterMode === 'custom' && activeZoneIds) {
      return activeZoneIds.includes(zId);
    }
    return true;
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '100%',
      background: '#0a0e17',
      color: '#e6edf3',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      overflow: 'hidden'
    }}>
      {/* ─── TOP CONTROL BAR ────────────────────────────────────────────── */}
      <div style={{
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        background: '#131722',
        borderBottom: '1px solid #2a2e39',
        zIndex: 10,
        gap: 12
      }}>
        {/* LEFT: Title & Symbol Asset Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontWeight: 800,
            fontSize: 14,
            color: '#38bdf8',
            letterSpacing: '0.3px'
          }}>
            <Target size={18} color="#38bdf8" />
            <span>SUPPORT & RESISTANCE RADAR</span>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(56, 189, 248, 0.12)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            padding: '3px 10px',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 700,
            color: '#38bdf8'
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#38bdf8' }} />
            {activeSymbol}
            {currentPrice && (
              <span style={{ color: '#fff', marginLeft: 4 }}>
                ${currentPrice.toFixed(2)}
              </span>
            )}
          </div>
        </div>

        {/* CENTER: Preset Timeframe Buttons & ZONE VISIBILITY FILTER */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10.5, color: '#787b86', fontWeight: 600, marginRight: 2 }}>PRESETS:</span>
            {PRESETS.map((p, idx) => {
              const isActive = tf1 === p.tf1 && tf2 === p.tf2;
              return (
                <button
                  key={idx}
                  onClick={() => { setTf1(p.tf1); setTf2(p.tf2); }}
                  style={{
                    background: isActive ? '#0284c7' : 'rgba(255, 255, 255, 0.05)',
                    border: isActive ? '1px solid #38bdf8' : '1px solid #2a2e39',
                    color: isActive ? '#fff' : '#b2b5be',
                    padding: '3px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {p.label.split(' ')[0]}
                </button>
              );
            })}
          </div>

          {/* ⚡ ZONE VISIBILITY SELECTOR: NEAREST ONLY VS CHOOSE ZONES */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 4, 
            background: 'rgba(0, 0, 0, 0.45)', 
            padding: '2px 5px', 
            borderRadius: 5, 
            border: '1px solid #2a2e39' 
          }}>
            <span style={{ fontSize: 10, color: '#38bdf8', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 3, padding: '0 4px' }}>
              <Eye size={12} color="#38bdf8" />
              LEVELS:
            </span>

            <button
              onClick={() => { setZoneFilterMode('nearest'); setActiveZoneIds(null); }}
              title="Show strictly the 1 Nearest Support and 1 Nearest Resistance"
              style={{
                background: zoneFilterMode === 'nearest' ? 'rgba(8, 153, 129, 0.3)' : 'transparent',
                border: zoneFilterMode === 'nearest' ? '1px solid #089981' : '1px solid transparent',
                color: zoneFilterMode === 'nearest' ? '#4ade80' : '#8b949e',
                padding: '3px 8px',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                transition: 'all 0.15s ease'
              }}
            >
              <Zap size={11} />
              Nearest Only
            </button>

            <button
              onClick={() => { setZoneFilterMode('nearest2'); setActiveZoneIds(null); }}
              title="Show 2 Nearest Support and 2 Nearest Resistance"
              style={{
                background: zoneFilterMode === 'nearest2' ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                border: zoneFilterMode === 'nearest2' ? '1px solid #38bdf8' : '1px solid transparent',
                color: zoneFilterMode === 'nearest2' ? '#38bdf8' : '#8b949e',
                padding: '3px 7px',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              Top 2
            </button>

            <button
              onClick={() => { setZoneFilterMode('all'); setActiveZoneIds(null); }}
              title="Show all detected support and resistance levels"
              style={{
                background: zoneFilterMode === 'all' ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                border: zoneFilterMode === 'all' ? '1px solid #787b86' : '1px solid transparent',
                color: zoneFilterMode === 'all' ? '#fff' : '#8b949e',
                padding: '3px 7px',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              All
            </button>

            <button
              onClick={() => setShowZonePickerModal(true)}
              title="Selectively choose which order blocks and S/R levels to display"
              style={{
                background: zoneFilterMode === 'custom' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(255, 255, 255, 0.05)',
                border: zoneFilterMode === 'custom' ? '1px solid #f59e0b' : '1px solid #30363d',
                color: zoneFilterMode === 'custom' ? '#fbbf24' : '#c9d1d9',
                padding: '3px 8px',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                transition: 'all 0.15s ease'
              }}
            >
              <SlidersHorizontal size={11} />
              Choose Zones {activeZoneIds ? `(${activeZoneIds.length})` : ''}
            </button>
          </div>
        </div>

        {/* RIGHT: Layout & Drawer Toggles */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.04)', borderRadius: 4, padding: 2, border: '1px solid #2a2e39' }}>
            <button
              onClick={() => setLayout('side-by-side')}
              title="Side-by-Side (50/50 Split)"
              style={{
                background: layout === 'side-by-side' ? '#2a2e39' : 'transparent',
                border: 'none',
                color: layout === 'side-by-side' ? '#fff' : '#787b86',
                padding: '4px 8px',
                borderRadius: 3,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <SplitSquareHorizontal size={15} />
            </button>
            <button
              onClick={() => setLayout('stacked')}
              title="Stacked (Top/Bottom Split)"
              style={{
                background: layout === 'stacked' ? '#2a2e39' : 'transparent',
                border: 'none',
                color: layout === 'stacked' ? '#fff' : '#787b86',
                padding: '4px 8px',
                borderRadius: 3,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <SplitSquareVertical size={15} />
            </button>
          </div>

          <button
            onClick={() => setShowDrawer(!showDrawer)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: showDrawer ? 'rgba(56, 189, 248, 0.18)' : 'rgba(255, 255, 255, 0.05)',
              border: showDrawer ? '1px solid #38bdf8' : '1px solid #2a2e39',
              color: showDrawer ? '#38bdf8' : '#b2b5be',
              padding: '4px 10px',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <Compass size={14} />
            S/R Intelligence {confluences.length > 0 && `(${confluences.length} Confluences)`}
          </button>

          <button
            onClick={fetchSupportResistance}
            title="Recalculate Support & Resistance"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#787b86',
              cursor: 'pointer',
              padding: 4
            }}
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* ─── MAIN WORKSPACE: DUAL CHARTS + DRAWER ────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        
        {/* CHARTS CONTAINER */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: layout === 'stacked' ? 'column' : 'row',
          gap: 4,
          background: '#131722',
          padding: 4,
          overflow: 'hidden'
        }}>
          
          {/* CHART 1: LOWER TIMEFRAME (DEFAULT 15M) */}
          {(layout === 'side-by-side' || layout === 'stacked' || layout === 'chart1-only') && (
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              background: '#0d1117',
              borderRadius: 6,
              border: '1px solid #1f2430',
              overflow: 'hidden',
              position: 'relative'
            }}>
              {/* Header for Chart 1 */}
              <div style={{
                height: 34,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 10px',
                background: '#161b22',
                borderBottom: '1px solid #21262d'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8' }}>
                    CHART 1: {activeSymbol}
                  </span>
                  
                  {/* Timeframe selector for Chart 1 */}
                  <div style={{ display: 'flex', gap: 2 }}>
                    {TIMEFRAMES.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setTf1(t.id)}
                        style={{
                          background: tf1 === t.id ? '#0284c7' : 'transparent',
                          border: 'none',
                          color: tf1 === t.id ? '#fff' : '#8b949e',
                          padding: '2px 6px',
                          borderRadius: 3,
                          fontSize: 11,
                          fontWeight: tf1 === t.id ? 700 : 500,
                          cursor: 'pointer'
                        }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#8b949e' }}>
                  <span style={{ color: '#089981' }}>{tf1Zones.filter(z => z.side === 'SUPPORT').length} Support</span>
                  <span>•</span>
                  <span style={{ color: '#f23645' }}>{tf1Zones.filter(z => z.side === 'RESISTANCE').length} Resistance</span>
                </div>
              </div>

              {/* Chart 1 Canvas */}
              <div style={{ flex: 1, position: 'relative' }}>
                <KLineChartArea
                  ref={chart1Ref}
                  symbol={activeSymbol}
                  timeframe={tf1}
                  indicators={indicators1}
                  onPriceUpdate={(p) => setCurrentPrice(p)}
                />
              </div>
            </div>
          )}

          {/* CHART 2: HIGHER TIMEFRAME (DEFAULT 1H) */}
          {(layout === 'side-by-side' || layout === 'stacked' || layout === 'chart2-only') && (
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              background: '#0d1117',
              borderRadius: 6,
              border: '1px solid #1f2430',
              overflow: 'hidden',
              position: 'relative'
            }}>
              {/* Header for Chart 2 */}
              <div style={{
                height: 34,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 10px',
                background: '#161b22',
                borderBottom: '1px solid #21262d'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b' }}>
                    CHART 2: {activeSymbol}
                  </span>
                  
                  {/* Timeframe selector for Chart 2 */}
                  <div style={{ display: 'flex', gap: 2 }}>
                    {TIMEFRAMES.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setTf2(t.id)}
                        style={{
                          background: tf2 === t.id ? '#d97706' : 'transparent',
                          border: 'none',
                          color: tf2 === t.id ? '#fff' : '#8b949e',
                          padding: '2px 6px',
                          borderRadius: 3,
                          fontSize: 11,
                          fontWeight: tf2 === t.id ? 700 : 500,
                          cursor: 'pointer'
                        }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#8b949e' }}>
                  <span style={{ color: '#089981' }}>{tf2Zones.filter(z => z.side === 'SUPPORT').length} Support</span>
                  <span>•</span>
                  <span style={{ color: '#f23645' }}>{tf2Zones.filter(z => z.side === 'RESISTANCE').length} Resistance</span>
                </div>
              </div>

              {/* Chart 2 Canvas */}
              <div style={{ flex: 1, position: 'relative' }}>
                <KLineChartArea
                  ref={chart2Ref}
                  symbol={activeSymbol}
                  timeframe={tf2}
                  indicators={indicators2}
                />
              </div>
            </div>
          )}

        </div>

        {/* ─── RIGHT SIDEBAR: S/R INTELLIGENCE & CONFLUENCE RADAR ─────────── */}
        {showDrawer && (
          <div style={{
            width: 390,
            minWidth: 360,
            background: '#0d1117',
            borderLeft: '1px solid #1f2430',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto'
          }}>
            {/* ─── LIVE SIGNAL RADAR & TRIGGER BOX ─── */}
            <div style={{
              background: isTriggerReady 
                ? 'linear-gradient(180deg, rgba(8, 153, 129, 0.22) 0%, rgba(13, 17, 23, 0.98) 100%)'
                : 'linear-gradient(180deg, rgba(56, 189, 248, 0.12) 0%, rgba(13, 17, 23, 0.98) 100%)',
              borderBottom: '1px solid #1f2430',
              padding: '14px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}>
              {/* Radar Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    background: isTriggerReady ? '#089981' : (primarySetup?.condition?.state === 'APPROACHING' ? '#eab308' : '#38bdf8'),
                    boxShadow: isTriggerReady 
                      ? '0 0 10px #089981, 0 0 18px #089981' 
                      : (primarySetup?.condition?.state === 'APPROACHING' ? '0 0 8px #eab308' : '0 0 6px #38bdf8')
                  }} />
                  <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.5px', color: '#e6edf3' }}>
                    LIVE S/R SIGNAL RADAR
                  </span>
                </div>

                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 12,
                  background: isTriggerReady ? 'rgba(8, 153, 129, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                  color: isTriggerReady ? '#089981' : '#8b949e',
                  border: isTriggerReady ? '1px solid rgba(8, 153, 129, 0.4)' : '1px solid #2a2e39'
                }}>
                  {primarySetup?.role || `${tf1}/${tf2} Confluence`}
                </span>
              </div>

              {/* What is it waiting for / Trigger State Card */}
              <div style={{
                background: isTriggerReady 
                  ? 'rgba(8, 153, 129, 0.12)' 
                  : 'rgba(22, 27, 34, 0.9)',
                border: isTriggerReady 
                  ? '1px solid rgba(8, 153, 129, 0.5)' 
                  : (primarySetup?.condition?.state === 'APPROACHING' ? '1px solid rgba(234, 179, 8, 0.4)' : '1px solid #21262d'),
                borderRadius: 6,
                padding: '10px 12px'
              }}>
                <div style={{
                  fontSize: 11.5,
                  fontWeight: 800,
                  color: isTriggerReady 
                    ? '#26a69a' 
                    : (primarySetup?.condition?.state === 'APPROACHING' ? '#f59e0b' : '#38bdf8'),
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 4
                }}>
                  {isTriggerReady ? <Zap size={14} /> : (primarySetup?.condition?.state === 'APPROACHING' ? <Crosshair size={14} /> : <Clock size={14} />)}
                  {primarySetup?.condition?.title || 'Scanning Key Pivot Levels...'}
                </div>

                <div style={{
                  fontSize: 11,
                  color: '#c9d1d9',
                  lineHeight: 1.5,
                  marginBottom: 8
                }}>
                  {primarySetup?.condition?.description || 'Waiting for price to test confirmed classical support or resistance.'}
                </div>

                {/* Distance Metric Strip */}
                {primarySetup?.condition?.distance_pips !== undefined && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 10.5,
                    background: 'rgba(0, 0, 0, 0.35)',
                    padding: '5px 8px',
                    borderRadius: 4,
                    color: '#8b949e'
                  }}>
                    <span>Distance to Zone:</span>
                    <strong style={{ 
                      color: isTriggerReady ? '#26a69a' : (primarySetup.condition.distance_pips <= 10 ? '#f59e0b' : '#fff'),
                      fontSize: 11 
                    }}>
                      {isTriggerReady ? '0.0 pips (Testing Level)' : `${primarySetup.condition.distance_pips} pips ($${primarySetup.condition.distance_usd})`}
                    </strong>
                  </div>
                )}
              </div>

              {/* Nearest Floor & Ceiling Quick Strip */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 6
              }}>
                <div style={{
                  background: 'rgba(8, 153, 129, 0.08)',
                  border: '1px solid rgba(8, 153, 129, 0.25)',
                  borderRadius: 4,
                  padding: '6px 8px'
                }}>
                  <div style={{ fontSize: 9.5, color: '#8b949e', fontWeight: 600 }}>NEAREST SUPPORT</div>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: '#4ade80' }}>
                    {nearestSupport ? `$${nearestSupport.level.toFixed(2)}` : 'Scanning...'}
                  </div>
                  {nearestSupport && (
                    <div style={{ fontSize: 9, color: '#8b949e' }}>
                      {nearestSupport.distance_pips} pips away ({nearestSupport.touches} touches)
                    </div>
                  )}
                </div>

                <div style={{
                  background: 'rgba(242, 54, 69, 0.08)',
                  border: '1px solid rgba(242, 54, 69, 0.25)',
                  borderRadius: 4,
                  padding: '6px 8px'
                }}>
                  <div style={{ fontSize: 9.5, color: '#8b949e', fontWeight: 600 }}>NEAREST RESISTANCE</div>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: '#f87171' }}>
                    {nearestResistance ? `$${nearestResistance.level.toFixed(2)}` : 'Scanning...'}
                  </div>
                  {nearestResistance && (
                    <div style={{ fontSize: 9, color: '#8b949e' }}>
                      {nearestResistance.distance_pips} pips away ({nearestResistance.touches} touches)
                    </div>
                  )}
                </div>
              </div>

              {/* ─── CANDLESTICK CONFIRMATION CARD (DOJI S/R RULES) ─── */}
              <div style={{
                background: primaryConfirmation?.status === 'CONFIRMED'
                  ? (primaryConfirmation.action === 'BUY'
                      ? 'linear-gradient(135deg, rgba(8, 153, 129, 0.16) 0%, rgba(22, 27, 34, 0.95) 100%)'
                      : 'linear-gradient(135deg, rgba(242, 54, 69, 0.16) 0%, rgba(22, 27, 34, 0.95) 100%)')
                  : 'rgba(22, 27, 34, 0.85)',
                border: primaryConfirmation?.status === 'CONFIRMED'
                  ? (primaryConfirmation.action === 'BUY' ? '1px solid rgba(8, 153, 129, 0.5)' : '1px solid rgba(242, 54, 69, 0.5)')
                  : (primaryConfirmation?.status === 'PENDING' ? '1px solid rgba(234, 179, 8, 0.4)' : '1px solid #21262d'),
                borderRadius: 6,
                padding: '10px 12px'
              }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Sparkles size={14} color={primaryConfirmation?.status === 'CONFIRMED' ? (primaryConfirmation.action === 'BUY' ? '#4ade80' : '#f87171') : '#38bdf8'} />
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#e6edf3', letterSpacing: '0.4px' }}>
                      CANDLESTICK CONFIRMATION
                    </span>
                  </div>

                  <span style={{
                    fontSize: 9.5,
                    fontWeight: 800,
                    padding: '2px 7px',
                    borderRadius: 10,
                    background: primaryConfirmation?.status === 'CONFIRMED'
                      ? (primaryConfirmation.action === 'BUY' ? 'rgba(8, 153, 129, 0.25)' : 'rgba(242, 54, 69, 0.25)')
                      : (primaryConfirmation?.status === 'PENDING' ? 'rgba(234, 179, 8, 0.2)' : 'rgba(255, 255, 255, 0.06)'),
                    color: primaryConfirmation?.status === 'CONFIRMED'
                      ? (primaryConfirmation.action === 'BUY' ? '#4ade80' : '#f87171')
                      : (primaryConfirmation?.status === 'PENDING' ? '#fbbf24' : '#8b949e'),
                    border: primaryConfirmation?.status === 'CONFIRMED'
                      ? (primaryConfirmation.action === 'BUY' ? '1px solid rgba(8, 153, 129, 0.5)' : '1px solid rgba(242, 54, 69, 0.5)')
                      : (primaryConfirmation?.status === 'PENDING' ? '1px solid rgba(234, 179, 8, 0.4)' : '1px solid #30363d')
                  }}>
                    {primaryConfirmation ? primaryConfirmation.badge : 'SCANNING FOR 15M INDECISION'}
                  </span>
                </div>

                {/* Pattern Details or Scanning Status */}
                {primaryConfirmation ? (
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: primaryConfirmation.status === 'CONFIRMED' ? (primaryConfirmation.action === 'BUY' ? '#4ade80' : '#f87171') : '#fbbf24', marginBottom: 4 }}>
                      {primaryConfirmation.title}
                    </div>

                    <div style={{ fontSize: 10.5, color: '#c9d1d9', lineHeight: 1.4, marginBottom: 8 }}>
                      {primaryConfirmation.description}
                    </div>

                    {/* Indecision High & Low (SL Anchor) Metrics Strip */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 6,
                      background: 'rgba(0, 0, 0, 0.35)',
                      padding: '6px 8px',
                      borderRadius: 4,
                      marginBottom: 8
                    }}>
                      <div>
                        <div style={{ fontSize: 9, color: primaryConfirmation.action === 'SELL' ? '#f87171' : '#8b949e', fontWeight: 600 }}>
                          {primaryConfirmation.action === 'SELL' ? 'INDECISION HIGH WICK (SL)' : 'INDECISION HIGH WICK'}
                        </div>
                        <div style={{ fontSize: 11.5, fontWeight: 800, color: primaryConfirmation.action === 'SELL' ? '#f87171' : '#38bdf8', fontFamily: 'monospace' }}>
                          ${primaryConfirmation.doji_high.toFixed(3)}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: 9, color: primaryConfirmation.action === 'BUY' ? '#f87171' : '#8b949e', fontWeight: 700 }}>
                          {primaryConfirmation.action === 'BUY' ? 'INDECISION LOW WICK (SL)' : 'INDECISION LOW WICK'}
                        </div>
                        <div style={{ fontSize: 11.5, fontWeight: 800, color: primaryConfirmation.action === 'BUY' ? '#f87171' : '#38bdf8', fontFamily: 'monospace' }}>
                          ${primaryConfirmation.doji_low.toFixed(3)}
                        </div>
                      </div>
                    </div>

                    {/* Dominance Quality Pill */}
                    {primaryConfirmation.candle_quality && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: primaryConfirmation.action === 'BUY' ? 'rgba(8, 153, 129, 0.12)' : 'rgba(242, 54, 69, 0.12)',
                        border: primaryConfirmation.action === 'BUY' ? '1px solid rgba(8, 153, 129, 0.35)' : '1px solid rgba(242, 54, 69, 0.35)',
                        borderRadius: 4,
                        padding: '4px 8px',
                        marginBottom: 8,
                        fontSize: 9.5,
                        fontWeight: 700,
                        color: primaryConfirmation.action === 'BUY' ? '#4ade80' : '#f87171'
                      }}>
                        <span>Breakout Quality:</span>
                        <span>⚡ {primaryConfirmation.candle_quality}</span>
                      </div>
                    )}

                    {/* Quick Apply Confirmation Button */}
                    {primaryConfirmation.status === 'CONFIRMED' && (
                      <button
                        onClick={() => handleApplyConfirmation(primaryConfirmation)}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          borderRadius: 4,
                          border: primaryConfirmation.action === 'BUY' ? '1px solid rgba(8, 153, 129, 0.5)' : '1px solid rgba(242, 54, 69, 0.5)',
                          background: primaryConfirmation.action === 'BUY' ? 'rgba(8, 153, 129, 0.2)' : 'rgba(242, 54, 69, 0.2)',
                          color: primaryConfirmation.action === 'BUY' ? '#4ade80' : '#f87171',
                          fontSize: 10.5,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 5,
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <Zap size={12} />
                        Apply Indecision {primaryConfirmation.action === 'BUY' ? 'Buy' : 'Sell'} Setup (SL locked @ ${primaryConfirmation.sl.toFixed(3)})
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 10.5, color: '#8b949e', lineHeight: 1.4 }}>
                    Monitoring live 15M candle formations at key S/R zones. Full body close above indecision candle's highest wick with more body & less wick triggers BUY (SL: lowest wick); full body close below lowest wick triggers SELL (SL: highest wick). Wick spikes without body close are ignored.
                  </div>
                )}

                {/* 4-point Checklist */}
                <div style={{
                  marginTop: 8,
                  paddingTop: 6,
                  borderTop: '1px dashed #21262d',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  fontSize: 9.5,
                  color: '#8b949e'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: (nearestSupport && nearestSupport.distance_pips <= 15) || (nearestResistance && nearestResistance.distance_pips <= 15) ? '#4ade80' : '#8b949e' }}>
                    <CheckCircle2 size={11} color={(nearestSupport && nearestSupport.distance_pips <= 15) || (nearestResistance && nearestResistance.distance_pips <= 15) ? '#4ade80' : '#555'} />
                    <span>Key Level Tested ({primaryConfirmation?.level_tested ? `$${primaryConfirmation.level_tested.toFixed(2)}` : (nearestSupport ? `$${nearestSupport.level.toFixed(2)}` : 'Scanning')})</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: primaryConfirmation ? '#4ade80' : '#8b949e' }}>
                    <CheckCircle2 size={11} color={primaryConfirmation ? '#4ade80' : '#555'} />
                    <span>15M Indecision Candle Formed</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: primaryConfirmation?.status === 'CONFIRMED' ? (primaryConfirmation.action === 'BUY' ? '#4ade80' : '#f87171') : '#8b949e' }}>
                    <CheckCircle2 size={11} color={primaryConfirmation?.status === 'CONFIRMED' ? (primaryConfirmation.action === 'BUY' ? '#4ade80' : '#f87171') : '#555'} />
                    <span>
                      {primaryConfirmation?.status === 'CONFIRMED'
                        ? (primaryConfirmation.action === 'BUY' 
                            ? `Decisive Body Closed Above High Wick (${primaryConfirmation.body_pct ? `${primaryConfirmation.body_pct}% Body` : 'More Body than Wick'})` 
                            : `Decisive Body Closed Below Low Wick (${primaryConfirmation.body_pct ? `${primaryConfirmation.body_pct}% Body` : 'More Body than Wick'})`)
                        : 'Awaiting Full Body Close (More Body, Less Wick; Spikes Ignored)'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: primaryConfirmation?.status === 'CONFIRMED' ? (primaryConfirmation.action === 'BUY' ? '#4ade80' : '#f87171') : '#8b949e' }}>
                    <CheckCircle2 size={11} color={primaryConfirmation?.status === 'CONFIRMED' ? (primaryConfirmation.action === 'BUY' ? '#4ade80' : '#f87171') : '#555'} />
                    <span>
                      {primaryConfirmation?.status === 'CONFIRMED'
                        ? (primaryConfirmation.action === 'BUY' ? `Stop Loss Set to Indecision Lowest Wick ($${primaryConfirmation.sl.toFixed(3)})` : `Stop Loss Set to Indecision Highest Wick ($${primaryConfirmation.sl.toFixed(3)})`)
                        : 'Stop Loss Anchors to Indecision Wick Extrema'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Trade Setup Parameters (Entry, SL, TP1, TP2) */}
              {activeTradeSetup && (
                <div style={{
                  background: 'rgba(22, 27, 34, 0.7)',
                  border: '1px solid #21262d',
                  borderRadius: 6,
                  padding: 10
                }}>
                  {/* Action Banner */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 10,
                    paddingBottom: 8,
                    borderBottom: '1px solid #21262d'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        fontSize: 12,
                        fontWeight: 900,
                        padding: '3px 8px',
                        borderRadius: 4,
                        background: activeTradeSetup.action === 'BUY' ? '#089981' : '#f23645',
                        color: '#fff',
                        letterSpacing: '0.5px'
                      }}>
                        {activeTradeSetup.action} SETUP
                      </span>
                      <span style={{ fontSize: 11, color: '#8b949e' }}>
                        R:R {activeTradeSetup.rr_ratio}
                      </span>
                    </div>

                    <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 600 }}>
                      {activeTradeSetup.sl_note ? 'Doji Confirmed Entry' : '50% Zone Equilibrium'}
                    </div>
                  </div>

                  {/* 4-Box Levels Grid with 3-decimal display */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                    marginBottom: 10
                  }}>
                    {/* ENTRY */}
                    <div style={{
                      background: 'rgba(0, 0, 0, 0.35)',
                      borderRadius: 4,
                      padding: '6px 8px',
                      borderLeft: '3px solid #38bdf8'
                    }}>
                      <div style={{ fontSize: 9.5, color: '#8b949e', fontWeight: 600 }}>ENTRY</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#38bdf8', fontFamily: 'monospace' }}>
                        ${activeTradeSetup.entry.toFixed(3)}
                      </div>
                    </div>

                    {/* STOP LOSS */}
                    <div style={{
                      background: 'rgba(0, 0, 0, 0.35)',
                      borderRadius: 4,
                      padding: '6px 8px',
                      borderLeft: '3px solid #f23645'
                    }}>
                      <div style={{ fontSize: 9.5, color: '#8b949e', fontWeight: 600 }}>
                        STOP LOSS (-{activeTradeSetup.risk_pips} pips)
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#f87171', fontFamily: 'monospace' }}>
                        ${activeTradeSetup.sl.toFixed(3)}
                      </div>
                      {activeTradeSetup.sl_note && (
                        <div style={{ fontSize: 8.5, color: '#fbbf24', fontWeight: 700, marginTop: 2 }}>
                          {activeTradeSetup.sl_note}
                        </div>
                      )}
                    </div>

                    {/* TAKE PROFIT 1 */}
                    <div style={{
                      background: 'rgba(0, 0, 0, 0.35)',
                      borderRadius: 4,
                      padding: '6px 8px',
                      borderLeft: '3px solid #089981'
                    }}>
                      <div style={{ fontSize: 9.5, color: '#8b949e', fontWeight: 600 }}>
                        TP 1 (+{activeTradeSetup.reward_pips} pips • 1:2)
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#4ade80', fontFamily: 'monospace' }}>
                        ${activeTradeSetup.tp1.toFixed(3)}
                      </div>
                    </div>

                    {/* TAKE PROFIT 2 */}
                    <div style={{
                      background: 'rgba(0, 0, 0, 0.35)',
                      borderRadius: 4,
                      padding: '6px 8px',
                      borderLeft: '3px solid #10b981'
                    }}>
                      <div style={{ fontSize: 9.5, color: '#8b949e', fontWeight: 600 }}>
                        TP 2 (Runner • 1:3.5)
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#34d399', fontFamily: 'monospace' }}>
                        ${activeTradeSetup.tp2.toFixed(3)}
                      </div>
                    </div>
                  </div>

                  {/* Lot Size Selector */}
                  <div style={{
                    marginBottom: 10,
                    background: 'rgba(0, 0, 0, 0.25)',
                    padding: '8px 10px',
                    borderRadius: 4,
                    border: '1px solid #1f2430'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 10.5, color: '#8b949e', fontWeight: 600 }}>
                        LOT SIZE:
                      </span>
                      <span style={{ fontSize: 10, color: '#eab308' }}>
                        {activeSymbol.toUpperCase().includes('XAU') ? 'Max 1.00 Lot (Gold Safety Cap)' : 'Position Size'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="number"
                        min="0.01"
                        max={activeSymbol.toUpperCase().includes('XAU') ? 1.0 : 10.0}
                        step="0.01"
                        value={lotSize}
                        onChange={(e) => handleLotChange(parseFloat(e.target.value) || 0.01)}
                        style={{
                          width: 65,
                          background: '#0d1117',
                          border: '1px solid #30363d',
                          borderRadius: 4,
                          color: '#fff',
                          padding: '4px 6px',
                          fontSize: 12,
                          fontWeight: 700,
                          textAlign: 'center'
                        }}
                      />
                      <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                        {[0.01, 0.05, 0.10, 0.50, 1.00].map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => handleLotChange(v)}
                            style={{
                              flex: 1,
                              background: lotSize === v ? '#0284c7' : 'rgba(255, 255, 255, 0.05)',
                              border: lotSize === v ? '1px solid #38bdf8' : '1px solid #21262d',
                              borderRadius: 3,
                              color: lotSize === v ? '#fff' : '#8b949e',
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '4px 0',
                              cursor: 'pointer'
                            }}
                          >
                            {v.toFixed(2)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Feedback Message */}
                  {tradeFeedback && (
                    <div style={{
                      padding: '6px 10px',
                      borderRadius: 4,
                      marginBottom: 8,
                      fontSize: 11,
                      fontWeight: 600,
                      background: tradeFeedback.type === 'success' ? 'rgba(8, 153, 129, 0.2)' : 'rgba(242, 54, 69, 0.2)',
                      border: tradeFeedback.type === 'success' ? '1px solid #089981' : '1px solid #f23645',
                      color: tradeFeedback.type === 'success' ? '#4ade80' : '#f87171',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}>
                      {tradeFeedback.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                      <span>{tradeFeedback.text}</span>
                    </div>
                  )}

                  {/* Trade Action Trigger Button */}
                  <button
                    onClick={() => handleExecuteTrade(activeTradeSetup)}
                    disabled={executingTrade}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: 5,
                      border: 'none',
                      background: isTriggerReady
                        ? (activeTradeSetup.action === 'BUY' ? '#089981' : '#f23645')
                        : (activeTradeSetup.action === 'BUY' ? 'linear-gradient(135deg, #089981 0%, #056656 100%)' : 'linear-gradient(135deg, #f23645 0%, #9e1b26 100%)'),
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: 800,
                      letterSpacing: '0.4px',
                      cursor: executingTrade ? 'wait' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 7,
                      boxShadow: isTriggerReady 
                        ? (activeTradeSetup.action === 'BUY' ? '0 0 16px rgba(8, 153, 129, 0.6)' : '0 0 16px rgba(242, 54, 69, 0.6)')
                        : 'none',
                      opacity: executingTrade ? 0.7 : 1,
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {executingTrade ? (
                      <>
                        <RefreshCw size={14} className="spin" />
                        <span>Sending to MT5...</span>
                      </>
                    ) : isTriggerReady ? (
                      <>
                        <Zap size={14} />
                        <span>OPEN {activeTradeSetup.action} NOW @ ${activeTradeSetup.entry.toFixed(3)}</span>
                      </>
                    ) : (
                      <>
                        <ArrowUpRight size={14} />
                        <span>OPEN {activeTradeSetup.action} WITH SL & TP</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Drawer Sub-Header Tabs */}
            <div style={{
              display: 'flex',
              borderBottom: '1px solid #1f2430',
              background: '#161b22'
            }}>
              <button
                onClick={() => setActiveDrawerTab('confirmations')}
                style={{
                  flex: 1,
                  padding: '10px 3px',
                  background: activeDrawerTab === 'confirmations' ? '#0d1117' : 'transparent',
                  border: 'none',
                  borderBottom: activeDrawerTab === 'confirmations' ? '2px solid #4ade80' : '2px solid transparent',
                  color: activeDrawerTab === 'confirmations' ? '#4ade80' : '#8b949e',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Confirmations ({confirmations.length})
              </button>
              <button
                onClick={() => setActiveDrawerTab('confluence')}
                style={{
                  flex: 1,
                  padding: '10px 3px',
                  background: activeDrawerTab === 'confluence' ? '#0d1117' : 'transparent',
                  border: 'none',
                  borderBottom: activeDrawerTab === 'confluence' ? '2px solid #38bdf8' : '2px solid transparent',
                  color: activeDrawerTab === 'confluence' ? '#38bdf8' : '#8b949e',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Confluence ({confluences.length})
              </button>
              <button
                onClick={() => setActiveDrawerTab('tf1')}
                style={{
                  flex: 1,
                  padding: '10px 3px',
                  background: activeDrawerTab === 'tf1' ? '#0d1117' : 'transparent',
                  border: 'none',
                  borderBottom: activeDrawerTab === 'tf1' ? '2px solid #2962ff' : '2px solid transparent',
                  color: activeDrawerTab === 'tf1' ? '#2962ff' : '#8b949e',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                {tf1} ({tf1Zones.length})
              </button>
              <button
                onClick={() => setActiveDrawerTab('tf2')}
                style={{
                  flex: 1,
                  padding: '10px 3px',
                  background: activeDrawerTab === 'tf2' ? '#0d1117' : 'transparent',
                  border: 'none',
                  borderBottom: activeDrawerTab === 'tf2' ? '2px solid #f59e0b' : '2px solid transparent',
                  color: activeDrawerTab === 'tf2' ? '#f59e0b' : '#8b949e',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                {tf2} ({tf2Zones.length})
              </button>
            </div>

            {/* TAB CONTENT: CONFIRMATIONS */}
            {activeDrawerTab === 'confirmations' && (
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {confirmations.length > 0 ? (
                  confirmations.map((c, i) => (
                    <div key={i} style={{
                      background: c.status === 'CONFIRMED' ? 'rgba(8, 153, 129, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                      border: c.status === 'CONFIRMED' ? '1px solid rgba(8, 153, 129, 0.35)' : '1px solid #21262d',
                      borderRadius: 6,
                      padding: 10
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                        <span style={{
                          fontSize: 10.5,
                          fontWeight: 800,
                          padding: '2px 6px',
                          borderRadius: 3,
                          background: c.badge_color || '#089981',
                          color: '#fff'
                        }}>
                          {c.action} • {c.badge}
                        </span>
                        <span style={{ fontSize: 10, color: '#8b949e' }}>
                          {c.timeframe} ({c.bars_ago !== undefined ? `${c.bars_ago} bars ago` : 'recent'})
                        </span>
                      </div>

                      <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
                        {c.title}
                      </div>

                      <div style={{ fontSize: 10.5, color: '#c9d1d9', lineHeight: 1.4, marginBottom: 8 }}>
                        {c.description}
                      </div>

                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 6,
                        background: 'rgba(0, 0, 0, 0.3)',
                        padding: '6px 8px',
                        borderRadius: 4,
                        marginBottom: 8,
                        fontSize: 10.5,
                        fontFamily: 'monospace'
                      }}>
                        <div>
                          <span style={{ color: c.action === 'SELL' ? '#f87171' : '#8b949e', fontSize: 9, fontWeight: c.action === 'SELL' ? 700 : 500 }}>
                            {c.action === 'SELL' ? 'SL (High Wick): ' : 'Doji High: '}
                          </span>
                          <span style={{ color: c.action === 'SELL' ? '#f87171' : '#38bdf8', fontWeight: c.action === 'SELL' ? 700 : 500 }}>${c.doji_high?.toFixed(3)}</span>
                        </div>
                        <div>
                          <span style={{ color: c.action === 'BUY' ? '#f87171' : '#8b949e', fontSize: 9, fontWeight: c.action === 'BUY' ? 700 : 500 }}>
                            {c.action === 'BUY' ? 'SL (Lowest Wick): ' : 'Doji Low: '}
                          </span>
                          <span style={{ color: c.action === 'BUY' ? '#f87171' : '#38bdf8', fontWeight: c.action === 'BUY' ? 700 : 500 }}>${c.doji_low?.toFixed(3)}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          handleApplyConfirmation(c);
                          if (c.status === 'CONFIRMED') {
                            handleExecuteTrade(c);
                          }
                        }}
                        disabled={executingTrade}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          borderRadius: 4,
                          border: 'none',
                          background: c.action === 'BUY' ? '#089981' : '#f23645',
                          color: '#fff',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        Trade {c.action} with Doji SL (${c.sl?.toFixed(3)})
                      </button>
                    </div>
                  ))
                ) : (
                  <div style={{
                    padding: 20,
                    textAlign: 'center',
                    background: 'rgba(255, 255, 255, 0.02)',
                    borderRadius: 6,
                    border: '1px dashed #2a2e39',
                    color: '#8b949e',
                    fontSize: 12
                  }}>
                    <Info size={20} style={{ margin: '0 auto 6px', color: '#787b86', display: 'block' }} />
                    No Doji candlestick confirmations currently active. Monitoring support/resistance bounces in real-time.
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: CONFLUENCE */}
            {activeDrawerTab === 'confluence' && (
              <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {confluences.length > 0 ? (
                  confluences.map((c, i) => (
                    <div key={i} style={{
                      background: 'rgba(56, 189, 248, 0.08)',
                      border: '1px solid rgba(56, 189, 248, 0.35)',
                      borderRadius: 6,
                      padding: 12
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 800,
                          padding: '2px 6px',
                          borderRadius: 3,
                          background: c.action === 'BUY' ? '#089981' : '#f23645',
                          color: '#fff'
                        }}>
                          {c.action === 'BUY' ? 'SUPPORT CONFLUENCE' : 'RESISTANCE CONFLUENCE'}
                        </span>
                        <span style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700 }}>
                          {c.quality}
                        </span>
                      </div>

                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
                        Confluence Band: ${c.confluence_range}
                      </div>

                      <div style={{ fontSize: 11, color: '#8b949e', display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
                        <div>• {c.tf_lower} Level: ${c.lower_zone}</div>
                        <div>• {c.tf_higher} Level: ${c.higher_zone}</div>
                        <div>• 50% Equilibrium: ${c.midpoint}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>• Touches: <strong>{c.touches}</strong></span>
                          {c.flipped && (
                            <span style={{ 
                              background: 'rgba(245, 158, 11, 0.2)', 
                              color: '#fbbf24', 
                              padding: '1px 5px', 
                              borderRadius: 3, 
                              fontSize: 9.5, 
                              fontWeight: 700 
                            }}>
                              POLARITY FLIP
                            </span>
                          )}
                        </div>
                      </div>

                      {c.condition && (
                        <div style={{
                          fontSize: 10.5,
                          background: 'rgba(0, 0, 0, 0.3)',
                          padding: '4px 8px',
                          borderRadius: 4,
                          marginBottom: 8,
                          color: c.condition.state === 'TRIGGER_READY' ? '#4ade80' : '#cbd5e1'
                        }}>
                          {c.condition.title} ({c.condition.distance_pips} pips away)
                        </div>
                      )}

                      {c.trade_setup && (
                        <div style={{
                          background: 'rgba(0, 0, 0, 0.4)',
                          borderRadius: 4,
                          padding: '6px 8px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, fontFamily: 'monospace' }}>
                            <span style={{ color: '#38bdf8' }}>Entry: ${c.trade_setup.entry.toFixed(3)}</span>
                            <span style={{ color: '#f87171' }}>SL: ${c.trade_setup.sl.toFixed(3)}</span>
                            <span style={{ color: '#4ade80' }}>TP: ${c.trade_setup.tp1.toFixed(3)}</span>
                          </div>
                          <button
                            onClick={() => handleExecuteTrade(c.trade_setup)}
                            disabled={executingTrade}
                            style={{
                              width: '100%',
                              padding: '5px 8px',
                              borderRadius: 3,
                              border: 'none',
                              background: c.trade_setup.action === 'BUY' ? '#089981' : '#f23645',
                              color: '#fff',
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                          >
                            Trade {c.trade_setup.action} {lotSize.toFixed(2)} Lot (SL & TP)
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div style={{
                    padding: 24,
                    textAlign: 'center',
                    background: 'rgba(255, 255, 255, 0.02)',
                    borderRadius: 6,
                    border: '1px dashed #2a2e39',
                    color: '#8b949e',
                    fontSize: 12.5
                  }}>
                    <Info size={22} style={{ margin: '0 auto 8px', color: '#787b86', display: 'block' }} />
                    No overlapping {tf1} & {tf2} S/R zones currently detected. Levels are operating at different structural prices.
                  </div>
                )}

                {/* S/R Strategy Guidelines Box */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid #1f2430',
                  borderRadius: 6,
                  padding: 12,
                  marginTop: 6
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Shield size={14} color="#38bdf8" /> Classical S/R Playbook Rules:
                  </div>
                  <ul style={{ fontSize: 11, color: '#8b949e', margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                    <li><strong>Rule of Touches:</strong> 2 to 3 touches confirm a valid level. Beyond 4 touches, breakthrough probability increases.</li>
                    <li><strong>Polarity Flip Dynamics:</strong> Broken resistance acts as powerful new support; broken support flips to resistance.</li>
                    <li><strong>Volatility Cushion:</strong> Always buffer stop loss 1.5 to 2.5 points outside zone wicks to protect against liquidity sweeps.</li>
                  </ul>
                </div>
              </div>
            )}

            {/* TAB CONTENT: TF1 ZONES */}
            {activeDrawerTab === 'tf1' && (
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#8b949e', marginBottom: 2 }}>
                  ACTIVE {tf1} S/R LEVELS:
                </div>
                {tf1Zones.map((z, i) => (
                  <div key={i} style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderLeft: `3px solid ${z.color}`,
                    borderRadius: '0 4px 4px 0',
                    padding: '8px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: z.color }}>
                        {z.side === 'SUPPORT' ? 'Support Floor' : (z.side === 'RESISTANCE' ? 'Resistance Ceiling' : 'Active Pivot')}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          fontSize: 10,
                          padding: '1px 5px',
                          borderRadius: 3,
                          background: z.grade === 'MAJOR' ? 'rgba(8, 153, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                          color: z.grade === 'MAJOR' ? '#089981' : '#8b949e',
                          fontWeight: 700
                        }}>
                          {z.grade} ({z.touches} touches)
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleZoneVisibility(z.id || `${z.timeframe || tf1}_${z.side === 'SUPPORT' ? 'S' : 'R'}_${Math.round(z.top)}_${Math.round(z.bottom)}`);
                          }}
                          title={isZoneVisible(z) ? "Hide this level from chart" : "Show this level on chart"}
                          style={{
                            background: isZoneVisible(z) ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                            border: isZoneVisible(z) ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid #30363d',
                            color: isZoneVisible(z) ? '#38bdf8' : '#8b949e',
                            borderRadius: 3,
                            padding: '2px 5px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 3,
                            fontSize: 10
                          }}
                        >
                          {isZoneVisible(z) ? <Eye size={11} /> : <EyeOff size={11} />}
                          <span>{isZoneVisible(z) ? 'Chart' : 'Off'}</span>
                        </button>
                      </div>
                    </div>

                    <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>
                      Level: ${z.level} (${z.bottom} - ${z.top})
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#8b949e' }}>
                      <span>Highs: {z.highs} • Lows: {z.lows}</span>
                      <span>{z.distance_pips} pips away</span>
                      <span>{z.age_bars} bars ago</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* TAB CONTENT: TF2 ZONES */}
            {activeDrawerTab === 'tf2' && (
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#8b949e', marginBottom: 2 }}>
                  ACTIVE {tf2} S/R LEVELS:
                </div>
                {tf2Zones.map((z, i) => (
                  <div key={i} style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderLeft: `3px solid ${z.color}`,
                    borderRadius: '0 4px 4px 0',
                    padding: '8px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: z.color }}>
                        {z.side === 'SUPPORT' ? 'Support Floor' : (z.side === 'RESISTANCE' ? 'Resistance Ceiling' : 'Active Pivot')}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          fontSize: 10,
                          padding: '1px 5px',
                          borderRadius: 3,
                          background: z.grade === 'MAJOR' ? 'rgba(8, 153, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                          color: z.grade === 'MAJOR' ? '#089981' : '#8b949e',
                          fontWeight: 700
                        }}>
                          {z.grade} ({z.touches} touches)
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleZoneVisibility(z.id || `${z.timeframe || tf2}_${z.side === 'SUPPORT' ? 'S' : 'R'}_${Math.round(z.top)}_${Math.round(z.bottom)}`);
                          }}
                          title={isZoneVisible(z) ? "Hide this level from chart" : "Show this level on chart"}
                          style={{
                            background: isZoneVisible(z) ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                            border: isZoneVisible(z) ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid #30363d',
                            color: isZoneVisible(z) ? '#38bdf8' : '#8b949e',
                            borderRadius: 3,
                            padding: '2px 5px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 3,
                            fontSize: 10
                          }}
                        >
                          {isZoneVisible(z) ? <Eye size={11} /> : <EyeOff size={11} />}
                          <span>{isZoneVisible(z) ? 'Chart' : 'Off'}</span>
                        </button>
                      </div>
                    </div>

                    <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>
                      Level: ${z.level} (${z.bottom} - ${z.top})
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#8b949e' }}>
                      <span>Highs: {z.highs} • Lows: {z.lows}</span>
                      <span>{z.distance_pips} pips away</span>
                      <span>{z.age_bars} bars ago</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>
        )}

      </div>

      {/* ─── MODAL: CHOOSE SPECIFIC S/R ZONES TO DISPLAY ─── */}
      {showZonePickerModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20
        }} onClick={() => setShowZonePickerModal(false)}>
          <div style={{
            background: '#131722',
            border: '1px solid #30363d',
            borderRadius: 10,
            width: 520,
            maxWidth: '100%',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 40px rgba(0,0,0,0.8)',
            overflow: 'hidden'
          }} onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{
              padding: '14px 18px',
              borderBottom: '1px solid #21262d',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#161b22'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <SlidersHorizontal size={18} color="#38bdf8" />
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: '#fff' }}>
                    Choose S/R Zones & Order Blocks on Chart
                  </div>
                  <div style={{ fontSize: 10.5, color: '#8b949e' }}>
                    Check or uncheck the exact levels you want visible on Chart 1 & Chart 2.
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setShowZonePickerModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Quick Action Buttons Strip */}
            <div style={{
              padding: '8px 18px',
              background: 'rgba(255, 255, 255, 0.02)',
              borderBottom: '1px solid #21262d',
              display: 'flex',
              gap: 8
            }}>
              <button
                onClick={() => {
                  setZoneFilterMode('nearest');
                  setActiveZoneIds(null);
                  setShowZonePickerModal(false);
                }}
                style={{
                  background: 'rgba(8, 153, 129, 0.2)',
                  border: '1px solid #089981',
                  color: '#4ade80',
                  borderRadius: 4,
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5
                }}
              >
                <Zap size={12} />
                Reset to Nearest Only (1+1)
              </button>
              <button
                onClick={() => {
                  const allIds = allAvailableZones.map(z => z.id || `${z.timeframe || tf1}_${z.side === 'SUPPORT' ? 'S' : 'R'}_${Math.round(z.top)}_${Math.round(z.bottom)}`);
                  setActiveZoneIds(allIds);
                  setZoneFilterMode('custom');
                }}
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid #30363d',
                  color: '#e6edf3',
                  borderRadius: 4,
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Select All
              </button>
              <button
                onClick={() => {
                  setActiveZoneIds([]);
                  setZoneFilterMode('custom');
                }}
                style={{
                  background: 'rgba(242, 54, 69, 0.1)',
                  border: '1px solid rgba(242, 54, 69, 0.3)',
                  color: '#f87171',
                  borderRadius: 4,
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Clear All
              </button>
            </div>

            {/* List of Detected Levels */}
            <div style={{ padding: 14, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {allAvailableZones.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#8b949e', fontSize: 12 }}>
                  Scanning for active Support & Resistance levels...
                </div>
              ) : (
                allAvailableZones.map((z, idx) => {
                  const zId = z.id || `${z.timeframe || tf1}_${z.side === 'SUPPORT' ? 'S' : 'R'}_${Math.round(z.top)}_${Math.round(z.bottom)}`;
                  const isVisible = isZoneVisible(z);
                  const isNearest = (nearestSupport && z.id === nearestSupport.id) || (nearestResistance && z.id === nearestResistance.id);

                  return (
                    <div
                      key={idx}
                      onClick={() => toggleZoneVisibility(zId)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        borderRadius: 6,
                        background: isVisible ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.01)',
                        border: isVisible ? `1px solid ${z.color}50` : '1px solid #21262d',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <input
                          type="checkbox"
                          checked={isVisible}
                          onChange={() => toggleZoneVisibility(zId)}
                          style={{ cursor: 'pointer' }}
                        />
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{
                              fontSize: 10,
                              fontWeight: 800,
                              padding: '1px 5px',
                              borderRadius: 3,
                              background: z.side === 'SUPPORT' ? 'rgba(8, 153, 129, 0.2)' : 'rgba(242, 54, 69, 0.2)',
                              color: z.color
                            }}>
                              {z.timeframe || (idx < tf1Zones.length ? tf1 : tf2)} {z.side}
                            </span>
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>
                              ${z.level.toFixed(2)}
                            </span>
                            {isNearest && (
                              <span style={{
                                fontSize: 9.5,
                                fontWeight: 800,
                                background: '#38bdf8',
                                color: '#000',
                                padding: '1px 5px',
                                borderRadius: 3
                              }}>
                                NEAREST
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2 }}>
                            Range: ${z.bottom.toFixed(2)} - ${z.top.toFixed(2)} • {z.touches} touches • {z.distance_pips} pips away
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleZoneVisibility(zId);
                        }}
                        style={{
                          background: isVisible ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                          border: isVisible ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid #30363d',
                          color: isVisible ? '#38bdf8' : '#8b949e',
                          borderRadius: 4,
                          padding: '4px 8px',
                          fontSize: 10.5,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                      >
                        {isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
                        {isVisible ? 'Visible' : 'Hidden'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '10px 18px',
              borderTop: '1px solid #21262d',
              background: '#161b22',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span style={{ fontSize: 11, color: '#8b949e' }}>
                Active Mode: <strong style={{ color: '#38bdf8' }}>{zoneFilterMode.toUpperCase()}</strong>
              </span>
              <button
                onClick={() => setShowZonePickerModal(false)}
                style={{
                  background: '#0284c7',
                  border: 'none',
                  color: '#fff',
                  borderRadius: 4,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Apply & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
