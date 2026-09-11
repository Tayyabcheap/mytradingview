import React, { useState, useEffect, useRef } from 'react';
import { 
  Layers, ChevronDown, SplitSquareVertical, SplitSquareHorizontal, 
  RefreshCw, TrendingUp, TrendingDown, Target, Shield, Zap, Info, ArrowUpRight, 
  CheckCircle2, AlertCircle, Maximize2, Minimize2, BarChart2, DollarSign,
  Crosshair, Clock, AlertTriangle, ArrowRight, Play, Check
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
  { label: '5M & 15M (Default SMC)', tf1: '5M', tf2: '15M' },
  { label: '1M & 5M (Scalp Flow)', tf1: '1M', tf2: '5M' },
  { label: '15M & 1H (Intraday Trend)', tf1: '15M', tf2: '1H' },
  { label: '1H & 4H (Macro Swing)', tf1: '1H', tf2: '4H' }
];

export default function GoldOrderBlocksTab({ 
  accountInfo, 
  onSelectSymbolAndGoToChart,
  defaultSymbol = "XAUUSDc" 
}) {
  // Always lock to Gold (resolving broker symbol with or without suffix)
  const goldSymbol = defaultSymbol.toUpperCase().includes('XAU') ? defaultSymbol : 'XAUUSDc';

  const [tf1, setTf1] = useState('5M');
  const [tf2, setTf2] = useState('15M');
  const [layout, setLayout] = useState('side-by-side'); // 'side-by-side' | 'stacked' | 'chart1-only' | 'chart2-only'
  const [showDrawer, setShowDrawer] = useState(true);
  const [activeDrawerTab, setActiveDrawerTab] = useState('confluence'); // 'confluence' | 'tf1' | 'tf2'
  
  // Real-time Order Blocks API state
  const [obData, setObData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentGoldPrice, setCurrentGoldPrice] = useState(null);

  const chart1Ref = useRef(null);
  const chart2Ref = useRef(null);

  // Indicators configurations for each chart pane
  const indicators1 = [
    {
      instanceId: `OB_${tf1}`,
      id: 'ORDER_BLOCKS',
      name: `Order Blocks (${tf1})`,
      shortName: 'OB',
      isStack: false,
      visible: true,
      params: { tfs: [tf1], maxZones: 5, atrLen: 14 }
    }
  ];

  const indicators2 = [
    {
      instanceId: `OB_${tf2}`,
      id: 'ORDER_BLOCKS',
      name: `Order Blocks (${tf2})`,
      shortName: 'OB',
      isStack: false,
      visible: true,
      params: { tfs: [tf2], maxZones: 5, atrLen: 14 }
    }
  ];

  const fetchOrderBlocks = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/order_blocks?symbol=${encodeURIComponent(goldSymbol)}&tf1=${tf1}&tf2=${tf2}`);
      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        throw new Error(`Server returned non-JSON HTTP ${res.status}`);
      }
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to calculate Order Blocks');
      }
      setObData(data);
      if (data.current_price) setCurrentGoldPrice(data.current_price);
    } catch (err) {
      console.warn("Order Blocks fetch note:", err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrderBlocks();
    const timer = setInterval(fetchOrderBlocks, 10000); // 10-second refresh for fresh live bars
    return () => clearInterval(timer);
  }, [goldSymbol, tf1, tf2]);

  const [lotSize, setLotSize] = useState(() => {
    try {
      const saved = localStorage.getItem('twr_lot_size');
      return saved ? Math.min(1.0, parseFloat(saved) || 0.10) : 0.10;
    } catch { return 0.10; }
  });
  const [executingTrade, setExecutingTrade] = useState(false);
  const [tradeFeedback, setTradeFeedback] = useState(null);

  const handleLotChange = (val) => {
    const clamped = Math.max(0.01, Math.min(1.0, Math.round(val * 100) / 100));
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
          symbol: goldSymbol,
          type: setup.action,
          volume: lotSize,
          sl: setup.sl,
          tp: setup.tp1,
          comment: `Gold-OB-${setup.action}`
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to send order to MT5');
      }
      setTradeFeedback({
        type: 'success',
        text: `Order Sent! Ticket #${data.ticket || data.order_id || 'OK'} (${setup.action} ${lotSize.toFixed(2)} Lot @ $${setup.entry ? setup.entry.toFixed(3) : ''})`
      });
      setTimeout(() => setTradeFeedback(null), 6000);
    } catch (err) {
      setTradeFeedback({ type: 'error', text: err.message });
      setTimeout(() => setTradeFeedback(null), 7000);
    } finally {
      setExecutingTrade(false);
    }
  };

  const confluences = obData?.confluences || [];
  const primarySetup = obData?.primary_setup || confluences[0] || null;
  const isTriggerReady = primarySetup?.condition?.state === 'TRIGGER_READY';
  const tf1Zones = obData?.tf1?.all_zones || [];
  const tf2Zones = obData?.tf2?.all_zones || [];

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
        {/* LEFT: Title & Gold Asset Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontWeight: 800,
            fontSize: 14,
            color: '#f59e0b',
            letterSpacing: '0.3px'
          }}>
            <Layers size={18} />
            <span>GOLD DUAL-ORDER BLOCKS</span>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            padding: '3px 10px',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 700,
            color: '#fbbf24'
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fbbf24' }} />
            {goldSymbol} (Gold Only)
            {currentGoldPrice && (
              <span style={{ color: '#fff', marginLeft: 4 }}>
                ${currentGoldPrice.toFixed(2)}
              </span>
            )}
          </div>
        </div>

        {/* CENTER: Preset Timeframe Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#787b86', fontWeight: 600, marginRight: 2 }}>PRESETS:</span>
          {PRESETS.map((p, idx) => {
            const isActive = tf1 === p.tf1 && tf2 === p.tf2;
            return (
              <button
                key={idx}
                onClick={() => { setTf1(p.tf1); setTf2(p.tf2); }}
                style={{
                  background: isActive ? '#2962ff' : 'rgba(255, 255, 255, 0.05)',
                  border: isActive ? '1px solid #2962ff' : '1px solid #2a2e39',
                  color: isActive ? '#fff' : '#b2b5be',
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {p.label}
              </button>
            );
          })}
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
              background: showDrawer ? 'rgba(41, 98, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              border: showDrawer ? '1px solid #2962ff' : '1px solid #2a2e39',
              color: showDrawer ? '#2962ff' : '#b2b5be',
              padding: '4px 10px',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <Zap size={14} />
            SMC Intelligence {confluences.length > 0 && `(${confluences.length} Confluences)`}
          </button>

          <button
            onClick={fetchOrderBlocks}
            title="Recalculate Order Blocks"
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
          
          {/* CHART 1: LOWER TIMEFRAME (DEFAULT 5M) */}
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
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b' }}>
                    CHART 1: {goldSymbol}
                  </span>
                  
                  {/* Timeframe selector for Chart 1 */}
                  <div style={{ display: 'flex', gap: 2 }}>
                    {TIMEFRAMES.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setTf1(t.id)}
                        style={{
                          background: tf1 === t.id ? '#2962ff' : 'transparent',
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
                  <span style={{ color: '#089981' }}>{tf1Zones.filter(z => z.type === 'BULL').length} Bull OB</span>
                  <span>•</span>
                  <span style={{ color: '#f23645' }}>{tf1Zones.filter(z => z.type === 'BEAR').length} Bear OB</span>
                </div>
              </div>

              {/* Chart 1 Canvas */}
              <div style={{ flex: 1, position: 'relative' }}>
                <KLineChartArea
                  ref={chart1Ref}
                  symbol={goldSymbol}
                  timeframe={tf1}
                  indicators={indicators1}
                  onPriceUpdate={(p) => setCurrentGoldPrice(p)}
                />
              </div>
            </div>
          )}

          {/* CHART 2: HIGHER TIMEFRAME (DEFAULT 15M) */}
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
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8' }}>
                    CHART 2: {goldSymbol}
                  </span>
                  
                  {/* Timeframe selector for Chart 2 */}
                  <div style={{ display: 'flex', gap: 2 }}>
                    {TIMEFRAMES.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setTf2(t.id)}
                        style={{
                          background: tf2 === t.id ? '#38bdf8' : 'transparent',
                          border: 'none',
                          color: tf2 === t.id ? '#0d1117' : '#8b949e',
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
                  <span style={{ color: '#089981' }}>{tf2Zones.filter(z => z.type === 'BULL').length} Bull OB</span>
                  <span>•</span>
                  <span style={{ color: '#f23645' }}>{tf2Zones.filter(z => z.type === 'BEAR').length} Bear OB</span>
                </div>
              </div>

              {/* Chart 2 Canvas */}
              <div style={{ flex: 1, position: 'relative' }}>
                <KLineChartArea
                  ref={chart2Ref}
                  symbol={goldSymbol}
                  timeframe={tf2}
                  indicators={indicators2}
                />
              </div>
            </div>
          )}

        </div>

        {/* ─── RIGHT SIDEBAR: SMC INTELLIGENCE & CONFLUENCE RADAR ─────────── */}
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
                ? 'linear-gradient(180deg, rgba(8, 153, 129, 0.2) 0%, rgba(13, 17, 23, 0.98) 100%)'
                : 'linear-gradient(180deg, rgba(245, 158, 11, 0.12) 0%, rgba(13, 17, 23, 0.98) 100%)',
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
                    LIVE SIGNAL RADAR
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
                  {primarySetup?.source_label || (primarySetup?.tf_lower && primarySetup?.tf_higher ? `${primarySetup.tf_lower}/${primarySetup.tf_higher} Confluence` : `${tf1}/${tf2}`)}
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
                    : (primarySetup?.condition?.state === 'APPROACHING' ? '#f59e0b' : '#58a6ff'),
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 4
                }}>
                  {isTriggerReady ? <Zap size={14} /> : (primarySetup?.condition?.state === 'APPROACHING' ? <Crosshair size={14} /> : <Clock size={14} />)}
                  {primarySetup?.condition?.title || 'Scanning Gold Liquidity Zones...'}
                </div>

                <div style={{
                  fontSize: 11,
                  color: '#c9d1d9',
                  lineHeight: 1.5,
                  marginBottom: 8
                }}>
                  {primarySetup?.condition?.description || 'Waiting for price to enter confirmed institutional footprints.'}
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
                      {isTriggerReady ? '0.0 pips (Active Inside Zone)' : `${primarySetup.condition.distance_pips} pips ($${primarySetup.condition.distance_usd})`}
                    </strong>
                  </div>
                )}
              </div>

              {/* Trade Setup Parameters (Entry, SL, TP1, TP2) */}
              {primarySetup?.trade_setup && (
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
                        background: primarySetup.trade_setup.action === 'BUY' ? '#089981' : '#f23645',
                        color: '#fff',
                        letterSpacing: '0.5px'
                      }}>
                        {primarySetup.trade_setup.action} SETUP
                      </span>
                      <span style={{ fontSize: 11, color: '#8b949e' }}>
                        R:R {primarySetup.trade_setup.rr_ratio}
                      </span>
                    </div>

                    <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>
                      50% EQ Entry
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
                      <div style={{ fontSize: 9.5, color: '#8b949e', fontWeight: 600 }}>ENTRY (50% EQ)</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#38bdf8', fontFamily: 'monospace' }}>
                        ${primarySetup.trade_setup.entry.toFixed(3)}
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
                        STOP LOSS (-{primarySetup.trade_setup.risk_pips} pips)
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#f87171', fontFamily: 'monospace' }}>
                        ${primarySetup.trade_setup.sl.toFixed(3)}
                      </div>
                    </div>

                    {/* TAKE PROFIT 1 */}
                    <div style={{
                      background: 'rgba(0, 0, 0, 0.35)',
                      borderRadius: 4,
                      padding: '6px 8px',
                      borderLeft: '3px solid #089981'
                    }}>
                      <div style={{ fontSize: 9.5, color: '#8b949e', fontWeight: 600 }}>
                        TP 1 (+{primarySetup.trade_setup.reward_pips} pips • 1:2)
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#4ade80', fontFamily: 'monospace' }}>
                        ${primarySetup.trade_setup.tp1.toFixed(3)}
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
                        ${primarySetup.trade_setup.tp2.toFixed(3)}
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
                        Max 1.00 Lot (Gold Safety Cap)
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="number"
                        min="0.01"
                        max="1.0"
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
                              background: lotSize === v ? '#2962ff' : 'rgba(255, 255, 255, 0.05)',
                              border: lotSize === v ? '1px solid #2962ff' : '1px solid #21262d',
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
                    onClick={() => handleExecuteTrade(primarySetup.trade_setup)}
                    disabled={executingTrade}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: 5,
                      border: 'none',
                      background: isTriggerReady
                        ? (primarySetup.trade_setup.action === 'BUY' ? '#089981' : '#f23645')
                        : (primarySetup.trade_setup.action === 'BUY' ? 'linear-gradient(135deg, #089981 0%, #056656 100%)' : 'linear-gradient(135deg, #f23645 0%, #9e1b26 100%)'),
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
                        ? (primarySetup.trade_setup.action === 'BUY' ? '0 0 16px rgba(8, 153, 129, 0.6)' : '0 0 16px rgba(242, 54, 69, 0.6)')
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
                        <span>OPEN {primarySetup.trade_setup.action} NOW @ ${primarySetup.trade_setup.entry.toFixed(3)}</span>
                      </>
                    ) : (
                      <>
                        <ArrowUpRight size={14} />
                        <span>OPEN {primarySetup.trade_setup.action} WITH SL & TP</span>
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
                onClick={() => setActiveDrawerTab('confluence')}
                style={{
                  flex: 1,
                  padding: '10px 4px',
                  background: activeDrawerTab === 'confluence' ? '#0d1117' : 'transparent',
                  border: 'none',
                  borderBottom: activeDrawerTab === 'confluence' ? '2px solid #f59e0b' : '2px solid transparent',
                  color: activeDrawerTab === 'confluence' ? '#f59e0b' : '#8b949e',
                  fontSize: 11.5,
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
                  padding: '10px 4px',
                  background: activeDrawerTab === 'tf1' ? '#0d1117' : 'transparent',
                  border: 'none',
                  borderBottom: activeDrawerTab === 'tf1' ? '2px solid #2962ff' : '2px solid transparent',
                  color: activeDrawerTab === 'tf1' ? '#2962ff' : '#8b949e',
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                {tf1} Zones ({tf1Zones.length})
              </button>
              <button
                onClick={() => setActiveDrawerTab('tf2')}
                style={{
                  flex: 1,
                  padding: '10px 4px',
                  background: activeDrawerTab === 'tf2' ? '#0d1117' : 'transparent',
                  border: 'none',
                  borderBottom: activeDrawerTab === 'tf2' ? '2px solid #38bdf8' : '2px solid transparent',
                  color: activeDrawerTab === 'tf2' ? '#38bdf8' : '#8b949e',
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                {tf2} Zones ({tf2Zones.length})
              </button>
            </div>

            {/* TAB CONTENT: CONFLUENCE */}
            {activeDrawerTab === 'confluence' && (
              <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {confluences.length > 0 ? (
                  confluences.map((c, i) => (
                    <div key={i} style={{
                      background: 'rgba(245, 158, 11, 0.08)',
                      border: '1px solid rgba(245, 158, 11, 0.35)',
                      borderRadius: 6,
                      padding: 12
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 800,
                          padding: '2px 6px',
                          borderRadius: 3,
                          background: c.type === 'BULL' ? '#089981' : '#f23645',
                          color: '#fff'
                        }}>
                          {c.type === 'BULL' ? 'INSTITUTIONAL DEMAND' : 'INSTITUTIONAL SUPPLY'}
                        </span>
                        <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>
                          {c.quality}
                        </span>
                      </div>

                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
                        Confluence Zone: ${c.confluence_range}
                      </div>

                      <div style={{ fontSize: 11, color: '#8b949e', display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
                        <div>• {c.tf_lower} Order Block: ${c.lower_zone}</div>
                        <div>• {c.tf_higher} Order Block: ${c.higher_zone}</div>
                        <div>• 50% Equilibrium: ${c.midpoint}</div>
                        <div>• State: <strong style={{ color: c.status === 'UNMITIGATED' ? '#089981' : '#f7a600' }}>{c.status}</strong></div>
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
                    No overlapping {tf1} & {tf2} order blocks currently detected. Both timeframes are operating in independent liquidity bands.
                  </div>
                )}

                {/* SMC Strategy Guidelines Box */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid #1f2430',
                  borderRadius: 6,
                  padding: 12,
                  marginTop: 6
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Shield size={14} color="#f59e0b" /> Gold SMC Playbook Rules:
                  </div>
                  <ul style={{ fontSize: 11, color: '#8b949e', margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                    <li><strong>Dual Timeframe Alignment:</strong> Only enter when 5M reacts inside a confirmed 15M Order Block.</li>
                    <li><strong>Virgin Zones:</strong> Unmitigated zones possess 3x higher reversal probability than tested zones.</li>
                    <li><strong>50% Equilibrium:</strong> Institutional limit orders cluster at the exact midpoint of the Order Block.</li>
                  </ul>
                </div>
              </div>
            )}

            {/* TAB CONTENT: TF1 ZONES */}
            {activeDrawerTab === 'tf1' && (
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#8b949e', marginBottom: 2 }}>
                  ACTIVE {tf1} GOLD ORDER BLOCKS:
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
                        {z.type === 'BULL' ? 'Bullish Demand' : 'Bearish Supply'}
                      </span>
                      <span style={{
                        fontSize: 10,
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: z.status === 'UNMITIGATED' ? 'rgba(8, 153, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                        color: z.status === 'UNMITIGATED' ? '#089981' : '#8b949e',
                        fontWeight: 700
                      }}>
                        {z.status}
                      </span>
                    </div>

                    <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>
                      ${z.bottom} - ${z.top}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#8b949e' }}>
                      <span>Mid: ${z.mid}</span>
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
                  ACTIVE {tf2} GOLD ORDER BLOCKS:
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
                        {z.type === 'BULL' ? 'Bullish Demand' : 'Bearish Supply'}
                      </span>
                      <span style={{
                        fontSize: 10,
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: z.status === 'UNMITIGATED' ? 'rgba(8, 153, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                        color: z.status === 'UNMITIGATED' ? '#089981' : '#8b949e',
                        fontWeight: 700
                      }}>
                        {z.status}
                      </span>
                    </div>

                    <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>
                      ${z.bottom} - ${z.top}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#8b949e' }}>
                      <span>Mid: ${z.mid}</span>
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
    </div>
  );
}
