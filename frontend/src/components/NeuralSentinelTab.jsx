import React, { useState, useEffect, useRef } from 'react';
import { 
  Zap, Activity, Shield, TrendingUp, AlertTriangle, CheckCircle2, 
  RefreshCw, Play, Square, ArrowUpRight, ArrowDownRight, Award,
  Cpu, Crosshair, ChevronRight, Lock, Eye, Sparkles, Layers,
  Sliders, Plus, Trash2, Check, ShieldCheck, DollarSign, Search, Compass, X
} from 'lucide-react';
import BrokerSymbolPickerModal from './BrokerSymbolPickerModal';

export default function NeuralSentinelTab({ accountInfo, symbols: propSymbols, onSelectSymbolAndGoToChart }) {
  const [telemetry, setTelemetry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const pollIntervalRef = useRef(null);

  // Strategy Configuration & Instruments State
  const [strategyConfig, setStrategyConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('haider_strategy_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.symbols) && parsed.symbols.length > 0) {
          return parsed;
        }
      }
    } catch (e) {}
    return {
      enabled: false,
      symbols: ['XAUUSDc'],
      symbol_lot_sizes: { 'XAUUSDc': 0.10 }
    };
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [newSymbolInput, setNewSymbolInput] = useState('');
  const [botStatus, setBotStatus] = useState(null);

  // Broker Symbols & Modal State
  const [brokerSymbols, setBrokerSymbols] = useState(propSymbols || []);
  const [showSymbolPicker, setShowSymbolPicker] = useState(false);
  const [feedbackToast, setFeedbackToast] = useState(null);
  const toastTimeoutRef = useRef(null);

  // Keep broker symbols synced with prop or fallback to API
  useEffect(() => {
    if (propSymbols && propSymbols.length > 0) {
      setBrokerSymbols(propSymbols);
    } else {
      fetch('/api/symbols')
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data) && data.length > 0) {
            setBrokerSymbols(data);
          }
        })
        .catch(() => {});
    }
  }, [propSymbols]);

  const triggerToast = (text, type = 'success') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setFeedbackToast({ text, type });
    toastTimeoutRef.current = setTimeout(() => {
      setFeedbackToast(null);
    }, 3200);
  };

  const resolveBrokerSymbol = (rawSym) => {
    if (!rawSym) return '';
    const clean = (s) => (s || '').replace(/(\.m|\.c|_i|m\.raw|c\.raw|pro|raw|[cmk])$/i, '').toUpperCase();
    const raw = rawSym.trim().toUpperCase();
    if (!brokerSymbols || !brokerSymbols.length) return raw;

    // 1. Exact match
    const exact = brokerSymbols.find(s => {
      const name = typeof s === 'string' ? s : s.name;
      return name && name.toUpperCase() === raw;
    });
    if (exact) return typeof exact === 'string' ? exact : exact.name;

    // 2. Base match
    const base = clean(raw);
    const baseMatch = brokerSymbols.find(s => {
      const name = typeof s === 'string' ? s : s.name;
      return name && clean(name) === base;
    });
    if (baseMatch) return typeof baseMatch === 'string' ? baseMatch : baseMatch.name;

    // 3. Prefix match
    const prefixMatch = brokerSymbols.find(s => {
      const name = typeof s === 'string' ? s : s.name;
      return name && name.toUpperCase().startsWith(base);
    });
    if (prefixMatch) return typeof prefixMatch === 'string' ? prefixMatch : prefixMatch.name;

    return raw;
  };

  const fetchBotConfig = async () => {
    try {
      const res = await fetch('/api/scalper/bot/strategy-config');
      let backendCfg = null;
      if (res.ok) {
        const data = await res.json();
        backendCfg = data.HAIDER_ENHANCED || data.haider_enhanced || (data.strategy_configs && data.strategy_configs.HAIDER_ENHANCED);
      }
      const bRes = await fetch('/api/scalper/bot/status');
      let bStatus = null;
      if (bRes.ok) {
        bStatus = await bRes.json();
        setBotStatus(bStatus);
      }
      if (backendCfg && Array.isArray(backendCfg.symbols) && backendCfg.symbols.length > 0) {
        const isMasterBotOn = Boolean(bStatus?.enabled && (bStatus?.strategy === 'HAIDER_ENHANCED' || !bStatus?.champion_scalper?.enabled));
        const effectiveEnabled = backendCfg.enabled || isMasterBotOn;
        const mergedCfg = { ...backendCfg, enabled: effectiveEnabled };
        setStrategyConfig(mergedCfg);
        try { localStorage.setItem('haider_strategy_config', JSON.stringify(mergedCfg)); } catch (e) {}
      }
    } catch (e) {
      console.error('Error fetching strategy config:', e);
    }
  };

  useEffect(() => {
    fetchBotConfig();
    const interval = setInterval(fetchBotConfig, 3000);
    return () => clearInterval(interval);
  }, []);

  const saveConfig = async (newCfg) => {
    setStrategyConfig(newCfg);
    try { localStorage.setItem('haider_strategy_config', JSON.stringify(newCfg)); } catch (e) {}
    setSavingConfig(true);
    try {
      const res = await fetch('/api/scalper/bot/strategy-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy: 'HAIDER_ENHANCED',
          enabled: newCfg.enabled,
          symbols: newCfg.symbols,
          symbol_lot_sizes: newCfg.symbol_lot_sizes
        })
      });
      if (res.ok) {
        const data = await res.json();
        const cfg = data.HAIDER_ENHANCED || data.haider_enhanced || (data.strategy_configs && data.strategy_configs.HAIDER_ENHANCED);
        if (cfg && Array.isArray(cfg.symbols) && cfg.symbols.length > 0) {
          setStrategyConfig(cfg);
          try { localStorage.setItem('haider_strategy_config', JSON.stringify(cfg)); } catch (e) {}
        }
      }
      const bRes = await fetch('/api/scalper/bot/status');
      if (bRes.ok) {
        setBotStatus(await bRes.json());
      }
    } catch (e) {
      console.error('Error updating config:', e);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleToggleAutoTrade = () => {
    const isCurrentlyActive = Boolean(strategyConfig.enabled || botStatus?.enabled);
    const updated = { ...strategyConfig, enabled: !isCurrentlyActive };
    saveConfig(updated);
  };

  const handleUpdateLot = (sym, newLot) => {
    const isGold = sym.toUpperCase().includes('XAU') || sym.toUpperCase().includes('GOLD');
    let clamped = Math.max(0.01, +(newLot).toFixed(2));
    if (isGold) clamped = Math.min(1.0, clamped);
    const updatedLots = { ...(strategyConfig.symbol_lot_sizes || {}), [sym]: clamped };
    const updated = { ...strategyConfig, symbol_lot_sizes: updatedLots };
    saveConfig(updated);
  };

  const handleAddSymbol = (symToAdd) => {
    const rawInput = (symToAdd !== undefined ? symToAdd : newSymbolInput).trim();
    if (!rawInput) {
      // Empty input -> Open broker symbol picker modal so user can pick!
      setShowSymbolPicker(true);
      triggerToast('Select an instrument from the broker directory', 'info');
      return;
    }

    const resolved = resolveBrokerSymbol(rawInput);
    if (!resolved) {
      triggerToast('Please provide a valid instrument symbol', 'warn');
      return;
    }

    if (strategyConfig.symbols?.includes(resolved)) {
      triggerToast(`"${resolved}" is already active in Haider Scalper`, 'warn');
      setNewSymbolInput('');
      return;
    }

    const isGold = resolved.includes('XAU') || resolved.includes('GOLD');
    const updatedSymbols = [...(strategyConfig.symbols || []), resolved];
    const updatedLots = { ...(strategyConfig.symbol_lot_sizes || {}), [resolved]: isGold ? 0.10 : 0.10 };
    saveConfig({ ...strategyConfig, symbols: updatedSymbols, symbol_lot_sizes: updatedLots });
    triggerToast(`✓ Added ${resolved} to Haider Scalper (Lot: 0.10)`, 'success');
    setNewSymbolInput('');
  };

  const handleRemoveSymbol = (symToRemove) => {
    const updatedSymbols = (strategyConfig.symbols || []).filter(s => s !== symToRemove);
    const updatedLots = { ...(strategyConfig.symbol_lot_sizes || {}) };
    delete updatedLots[symToRemove];
    saveConfig({ ...strategyConfig, symbols: updatedSymbols, symbol_lot_sizes: updatedLots });
    triggerToast(`Removed ${symToRemove} from strategy`, 'info');
  };

  // Poll Neural Sentinel Telemetry
  const fetchTelemetry = async () => {
    try {
      const res = await fetch('/api/scalper/neural/status');
      if (res.ok) {
        const data = await res.json();
        setTelemetry(data);
        setLastUpdated(new Date());

        // Check if simulated ticket is in active trades
        const hasSim = data.active_trades?.some(t => t.ticket === 999901);
        setIsSimulating(hasSim);

        // Auto-select first active trade if not selected
        if (data.active_trades && data.active_trades.length > 0) {
          if (!selectedTicket || !data.active_trades.some(t => t.ticket === selectedTicket)) {
            setSelectedTicket(data.active_trades[0].ticket);
          }
        } else {
          setSelectedTicket(null);
        }
      }
    } catch (err) {
      console.error("Neural telemetry poll error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    pollIntervalRef.current = setInterval(fetchTelemetry, 1500);
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [selectedTicket]);

  // Toggle Live Simulated Trade
  const handleToggleSimulation = async () => {
    setActionLoading(true);
    try {
      if (isSimulating) {
        await fetch('/api/scalper/neural/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'clear' })
        });
        setIsSimulating(false);
      } else {
        await fetch('/api/scalper/neural/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: 'XAUUSDc', direction: 1 })
        });
        setIsSimulating(true);
      }
      await fetchTelemetry();
    } catch (err) {
      console.error("Error toggling simulation:", err);
    } finally {
      setActionLoading(false);
    }
  };

  // Trigger manual operator action
  const handleOperatorAction = async (ticket, action) => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/scalper/neural/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket, action })
      });
      if (res.ok) {
        await fetchTelemetry();
      }
    } catch (err) {
      console.error("Error executing operator action:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const isAutonomousActive = Boolean(strategyConfig.enabled || botStatus?.enabled || (botStatus?.is_running && botStatus?.strategy === 'HAIDER_ENHANCED'));
  const isTrackingTrade = Boolean(telemetry?.neurons_active && telemetry?.active_trades?.length > 0);
  const isLive = isTrackingTrade || isAutonomousActive;
  const activeTrade = telemetry?.active_trades?.find(t => t.ticket === selectedTicket) || telemetry?.active_trades?.[0];
  const neurons = activeTrade?.neurons || {};

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#0a0d14',
      color: '#e6edf3',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      overflowY: 'auto',
      padding: '24px 28px 48px',
      boxSizing: 'border-box',
      gap: 20
    }}>
      {/* ─────────────────────────────────────────────────────────────
          1. HEADER BAR & STATUS RADAR
      ───────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 16,
        padding: '16px 22px',
        background: 'linear-gradient(135deg, rgba(22, 27, 34, 0.92) 0%, rgba(13, 17, 23, 0.98) 100%)',
        borderRadius: 12,
        border: isTrackingTrade 
          ? '1px solid rgba(0, 255, 136, 0.5)'
          : isAutonomousActive 
          ? '1px solid rgba(0, 240, 255, 0.45)' 
          : '1px solid rgba(48, 54, 61, 0.7)',
        boxShadow: isTrackingTrade 
          ? '0 0 25px rgba(0, 255, 136, 0.2)' 
          : isAutonomousActive 
          ? '0 0 25px rgba(0, 240, 255, 0.15)' 
          : '0 4px 20px rgba(0, 0, 0, 0.3)',
        backdropFilter: 'blur(12px)',
        position: 'relative',
        flexShrink: 0
      }}>
        {/* Animated accent gradient strip */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: isTrackingTrade
            ? 'linear-gradient(90deg, #00ff88, #00f0ff, #8a2be2, #00ff88)'
            : isAutonomousActive
            ? 'linear-gradient(90deg, #00f0ff, #00ff88, #00f0ff)'
            : 'linear-gradient(90deg, #30363d, #484f58, #30363d)',
          backgroundSize: '200% 100%',
          animation: isLive ? 'radarSweep 3s linear infinite' : 'none'
        }} />

        {/* Left: Branding & Core Objective */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: isTrackingTrade 
              ? 'rgba(0, 255, 136, 0.18)' 
              : isAutonomousActive 
              ? 'rgba(0, 240, 255, 0.15)' 
              : 'rgba(110, 118, 129, 0.12)',
            border: isTrackingTrade 
              ? '1px solid #00ff88' 
              : isAutonomousActive 
              ? '1px solid #00f0ff' 
              : '1px solid #30363d',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: isTrackingTrade 
              ? '0 0 15px rgba(0, 255, 136, 0.35)' 
              : isAutonomousActive 
              ? '0 0 15px rgba(0, 240, 255, 0.3)' 
              : 'none'
          }}>
            <Cpu size={24} color={isTrackingTrade ? '#00ff88' : isAutonomousActive ? '#00f0ff' : '#8b949e'} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '0.3px', color: '#ffffff' }}>
                Haider-Scalper-Enhanced <span style={{ color: '#00f0ff', fontWeight: 800 }}>// NEURAL SENTINEL</span>
              </h1>
              <span style={{
                fontSize: 10.5,
                fontWeight: 700,
                padding: '3px 9px',
                borderRadius: 20,
                background: isTrackingTrade 
                  ? 'rgba(0, 255, 136, 0.18)' 
                  : isAutonomousActive 
                  ? 'rgba(0, 240, 255, 0.18)' 
                  : 'rgba(110, 118, 129, 0.15)',
                color: isTrackingTrade 
                  ? '#00ff88' 
                  : isAutonomousActive 
                  ? '#00f0ff' 
                  : '#8b949e',
                border: isTrackingTrade 
                  ? '1px solid rgba(0, 255, 136, 0.45)' 
                  : isAutonomousActive 
                  ? '1px solid rgba(0, 240, 255, 0.45)' 
                  : '1px solid rgba(110, 118, 129, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}>
                <span style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: isTrackingTrade ? '#00ff88' : isAutonomousActive ? '#00f0ff' : '#8b949e',
                  boxShadow: isTrackingTrade 
                    ? '0 0 8px #00ff88' 
                    : isAutonomousActive 
                    ? '0 0 8px #00f0ff' 
                    : 'none'
                }} />
                {isTrackingTrade 
                  ? '5 LIVE NEURONS FIRING' 
                  : isAutonomousActive 
                  ? 'AUTONOMOUS ACTIVE // SENTINEL SCANNING' 
                  : 'STANDBY // DORMANT'}
              </span>
            </div>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: '#8b949e' }}>
              Adaptive Post-TP2 Mathematical Ratchet Engine • Multi-Neuron Extended Trend Harvester
            </p>
          </div>
        </div>

        {/* Right: Quick Controls & Live Telemetry */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Latency badge */}
          <div style={{
            fontSize: 11.5,
            color: '#8b949e',
            background: '#0d1117',
            padding: '5px 10px',
            borderRadius: 6,
            border: '1px solid #21262d',
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}>
            <Activity size={13} color="#00f0ff" />
            <span>Synapse: <strong style={{ color: '#00f0ff' }}>{telemetry?.synapse_speed_ms || 28}ms</strong></span>
          </div>

          {/* Simulate Live Trade Toggle */}
          <button
            onClick={handleToggleSimulation}
            disabled={actionLoading}
            style={{
              background: isSimulating ? 'rgba(242, 54, 69, 0.18)' : 'rgba(0, 240, 255, 0.12)',
              border: isSimulating ? '1px solid #f23645' : '1px solid rgba(0, 240, 255, 0.5)',
              color: isSimulating ? '#ff7b72' : '#00f0ff',
              padding: '7px 14px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.15s ease'
            }}
            title="Demonstrate 5 live neurons firing with a realistic simulated Gold runner"
          >
            {isSimulating ? <Square size={13} /> : <Play size={13} fill="#00f0ff" />}
            {isSimulating ? 'End Simulation' : 'Simulate Live Surge'}
          </button>

          {/* Refresh Telemetry */}
          <button
            onClick={fetchTelemetry}
            style={{
              background: '#161b22',
              border: '1px solid #30363d',
              color: '#c9d1d9',
              padding: '7px 10px',
              borderRadius: 6,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 12
            }}
            title="Refresh neural telemetry"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          1.5. HAIDER-SCALPER ISOLATED INSTRUMENTS & LOT SIZING MANAGER
      ───────────────────────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(180deg, rgba(22, 27, 34, 0.95) 0%, rgba(13, 17, 23, 0.95) 100%)',
        borderRadius: 12,
        border: isAutonomousActive ? '1px solid rgba(8, 153, 129, 0.45)' : '1px solid rgba(48, 54, 61, 0.7)',
        padding: '18px 22px',
        boxShadow: isAutonomousActive ? '0 0 20px rgba(8, 153, 129, 0.12)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        position: 'relative'
      }}>
        {/* Floating Feedback Notification Banner */}
        {feedbackToast && (
          <div style={{
            position: 'absolute',
            top: 14,
            right: 22,
            padding: '7px 14px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            zIndex: 30,
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.6)',
            background: feedbackToast.type === 'warn' ? '#fbbf24' :
                        feedbackToast.type === 'info' ? '#38bdf8' :
                        feedbackToast.type === 'error' ? '#f87171' : '#10b981',
            color: '#0a0d14'
          }}>
            {feedbackToast.type === 'warn' ? <AlertTriangle size={14} /> :
             feedbackToast.type === 'info' ? <Activity size={14} /> :
             <CheckCircle2 size={14} />}
            <span>{feedbackToast.text}</span>
          </div>
        )}
        {/* Top bar: Strategy Title & Master Auto-Trade Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: isAutonomousActive ? 'rgba(8, 153, 129, 0.2)' : 'rgba(110, 118, 129, 0.12)',
              border: isAutonomousActive ? '1px solid #089981' : '1px solid #30363d',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Sliders size={18} color={isAutonomousActive ? '#089981' : '#8b949e'} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>
                  Haider-Scalper Instruments & Lot Allocation
                </span>
                <span style={{
                  fontSize: 10,
                  fontWeight: 800,
                  padding: '2px 7px',
                  borderRadius: 4,
                  background: 'rgba(0, 240, 255, 0.12)',
                  color: '#00f0ff',
                  border: '1px solid rgba(0, 240, 255, 0.3)'
                }}>
                  ISOLATED STRATEGY
                </span>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#8b949e' }}>
                Trades <strong>ONLY</strong> on the instruments configured below with their respective lot sizes. Does not interfere with other strategies.
              </p>
            </div>
          </div>

          {/* Auto-Trade Switch */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {savingConfig && (
              <span style={{ fontSize: 11, color: '#00f0ff', display: 'flex', alignItems: 'center', gap: 4 }}>
                <RefreshCw size={11} className="animate-spin" /> Saving...
              </span>
            )}
            <button
              onClick={handleToggleAutoTrade}
              style={{
                background: isAutonomousActive ? 'rgba(8, 153, 129, 0.2)' : 'rgba(48, 54, 61, 0.3)',
                border: isAutonomousActive ? '1px solid #089981' : '1px solid #30363d',
                color: isAutonomousActive ? '#00ff88' : '#8b949e',
                padding: '8px 16px',
                borderRadius: 8,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: isAutonomousActive ? '0 0 14px rgba(8, 153, 129, 0.3)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <Zap size={14} fill={isAutonomousActive ? '#00ff88' : 'none'} />
              <span>Auto-Trade Haider Scalper: <strong>{isAutonomousActive ? 'ON' : 'OFF'}</strong></span>
            </button>
          </div>
        </div>

        {/* Instruments Table & Lot Size Steppers */}
        <div style={{
          background: '#0d1117',
          borderRadius: 8,
          border: '1px solid #21262d',
          overflow: 'hidden'
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#161b22', color: '#8b949e', borderBottom: '1px solid #21262d', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Active Instrument</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Asset Class</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'center' }}>Lot Sizing & Steppers</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Safety Rule</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(strategyConfig.symbols || []).map((sym, idx) => {
                const isGold = sym.toUpperCase().includes('XAU') || sym.toUpperCase().includes('GOLD');
                const lot = strategyConfig.symbol_lot_sizes?.[sym] || 0.10;
                return (
                  <tr key={sym} style={{
                    borderBottom: idx === strategyConfig.symbols.length - 1 ? 'none' : '1px solid rgba(48, 54, 61, 0.4)',
                    background: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.015)'
                  }}>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        onClick={() => onSelectSymbolAndGoToChart && onSelectSymbolAndGoToChart(sym)}
                        style={{
                          fontWeight: 700,
                          color: isGold ? '#fbbf24' : '#58a6ff',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          textDecorationColor: 'rgba(255,255,255,0.2)'
                        }}
                        title="View on Chart"
                      >
                        {sym}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: isGold ? '#fbbf24' : '#8b949e', fontSize: 11.5 }}>
                      {isGold ? 'Gold Commodity' : 'Forex Major'}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <button
                          onClick={() => handleUpdateLot(sym, lot - 0.01)}
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 4,
                            background: '#21262d',
                            border: '1px solid #30363d',
                            color: '#c9d1d9',
                            cursor: 'pointer',
                            fontSize: 14,
                            fontWeight: 800,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          max={isGold ? 1.0 : 50.0}
                          value={lot}
                          onChange={(e) => handleUpdateLot(sym, parseFloat(e.target.value) || 0.01)}
                          style={{
                            width: 60,
                            textAlign: 'center',
                            background: '#161b22',
                            border: '1px solid #30363d',
                            borderRadius: 4,
                            color: '#ffffff',
                            fontWeight: 700,
                            fontSize: 12.5,
                            padding: '3px 4px'
                          }}
                        />
                        <button
                          onClick={() => handleUpdateLot(sym, lot + 0.01)}
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 4,
                            background: '#21262d',
                            border: '1px solid #30363d',
                            color: '#c9d1d9',
                            cursor: 'pointer',
                            fontSize: 14,
                            fontWeight: 800,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          +
                        </button>
                        {/* Quick preset lot buttons */}
                        <div style={{ display: 'flex', gap: 3, marginLeft: 6 }}>
                          {[0.01, 0.05, 0.10, 0.50, 1.00].map(p => (
                            <button
                              key={p}
                              onClick={() => handleUpdateLot(sym, p)}
                              style={{
                                background: lot === p ? 'rgba(0, 240, 255, 0.2)' : 'rgba(48, 54, 61, 0.4)',
                                border: lot === p ? '1px solid #00f0ff' : '1px solid #30363d',
                                color: lot === p ? '#00f0ff' : '#8b949e',
                                padding: '2px 5px',
                                borderRadius: 3,
                                fontSize: 10,
                                fontWeight: 700,
                                cursor: 'pointer'
                              }}
                            >
                              {p.toFixed(2)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {isGold ? (
                        <span style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          padding: '2px 7px',
                          borderRadius: 4,
                          background: 'rgba(234, 179, 8, 0.12)',
                          color: '#fbbf24',
                          border: '1px solid rgba(234, 179, 8, 0.3)'
                        }}>
                          Strict Hard Cap: ≤ 1.0 Lot
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#8b949e' }}>Standard Risk</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                      <button
                        onClick={() => handleRemoveSymbol(sym)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#8b949e',
                          cursor: 'pointer',
                          padding: 4
                        }}
                        title="Remove pair"
                        onMouseEnter={e => e.currentTarget.style.color = '#f23645'}
                        onMouseLeave={e => e.currentTarget.style.color = '#8b949e'}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {(!strategyConfig.symbols || strategyConfig.symbols.length === 0) && (
                <tr>
                  <td colSpan={5} style={{ padding: '16px', textAlign: 'center', color: '#8b949e' }}>
                    No instruments selected for Haider Scalper. Add one below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Add Instrument Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, paddingTop: 6 }}>
          {/* Dynamic Quick Add Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#8b949e', fontWeight: 600 }}>Quick Add:</span>
            {['XAUUSDm', 'EURUSDm', 'GBPUSDm', 'USDJPYm', 'GBPJPYm', 'BTCUSDm'].map(raw => {
              const qs = resolveBrokerSymbol(raw);
              const isAdded = strategyConfig.symbols?.includes(qs);
              return (
                <button
                  key={qs}
                  onClick={() => handleAddSymbol(qs)}
                  disabled={isAdded}
                  style={{
                    background: isAdded ? 'rgba(48, 54, 61, 0.18)' : 'rgba(255, 255, 255, 0.05)',
                    border: isAdded ? '1px solid #21262d' : '1px solid #30363d',
                    color: isAdded ? '#484f58' : '#c9d1d9',
                    padding: '3px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: isAdded ? 'default' : 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => {
                    if (!isAdded) {
                      e.currentTarget.style.borderColor = '#00f0ff';
                      e.currentTarget.style.color = '#00f0ff';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isAdded) {
                      e.currentTarget.style.borderColor = '#30363d';
                      e.currentTarget.style.color = '#c9d1d9';
                    }
                  }}
                >
                  {isAdded ? `✓ ${qs}` : `+ ${qs}`}
                </button>
              );
            })}
          </div>

          {/* Symbol Input, Smart Add Button & Full Broker Browser Button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Broker symbol (e.g. EURUSDm)..."
                value={newSymbolInput}
                onChange={e => setNewSymbolInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddSymbol()}
                style={{
                  background: '#161b22',
                  border: '1px solid #30363d',
                  borderRadius: 6,
                  color: '#ffffff',
                  padding: '5px 24px 5px 10px',
                  fontSize: 12,
                  width: 170,
                  outline: 'none'
                }}
                onFocus={e => e.target.style.borderColor = '#00f0ff'}
                onBlur={e => e.target.style.borderColor = '#30363d'}
              />
              {newSymbolInput && (
                <button
                  onClick={() => setNewSymbolInput('')}
                  style={{
                    position: 'absolute',
                    right: 6,
                    background: 'none',
                    border: 'none',
                    color: '#8b949e',
                    cursor: 'pointer',
                    padding: 2
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Smart Add Button: Adds typed symbol OR opens symbol picker if empty */}
            <button
              onClick={() => handleAddSymbol()}
              title={newSymbolInput.trim() ? `Add ${newSymbolInput.trim().toUpperCase()} to Haider Scalper` : "Click to browse and add from 350+ broker instruments"}
              style={{
                background: newSymbolInput.trim() ? 'rgba(0, 240, 255, 0.22)' : 'rgba(0, 240, 255, 0.12)',
                border: '1px solid #00f0ff',
                color: '#00f0ff',
                padding: '5px 12px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                boxShadow: newSymbolInput.trim() ? '0 0 12px rgba(0, 240, 255, 0.3)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <Plus size={13} />
              <span>{newSymbolInput.trim() ? `Add ${newSymbolInput.trim().toUpperCase()}` : '+ Add / Browse'}</span>
            </button>

            {/* Dedicated Browse All Symbols Button */}
            <button
              onClick={() => setShowSymbolPicker(true)}
              title="Open full broker symbol directory"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid #30363d',
                color: '#8b949e',
                padding: '5px 10px',
                borderRadius: 6,
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#c9d1d9'; e.currentTarget.style.borderColor = '#8b949e'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#8b949e'; e.currentTarget.style.borderColor = '#30363d'; }}
            >
              <Search size={12} />
              <span>Browse All ({brokerSymbols.length || '350+'})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Interactive Broker Symbol Picker Modal */}
      <BrokerSymbolPickerModal
        isOpen={showSymbolPicker}
        onClose={() => setShowSymbolPicker(false)}
        strategyName="Haider Scalper Neural"
        activeSymbols={strategyConfig.symbols || []}
        brokerSymbols={brokerSymbols}
        onAddSymbol={(sym) => handleAddSymbol(sym)}
        accentColor="#00f0ff"
      />

      {/* ─────────────────────────────────────────────────────────────
          2. ACTIVE TRADE BANNER OR STANDBY RADAR
      ───────────────────────────────────────────────────────────── */}
      {isLive && activeTrade ? (
        <div style={{
          background: 'linear-gradient(180deg, #161b22 0%, #0d1117 100%)',
          borderRadius: 12,
          border: '1px solid rgba(0, 255, 136, 0.3)',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)'
        }}>
          {/* Top Row: Ticket Info, Milestone Pill & Extra Profit Counter */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                background: activeTrade.direction === 'BUY' ? 'rgba(8, 153, 129, 0.2)' : 'rgba(242, 54, 69, 0.2)',
                color: activeTrade.direction === 'BUY' ? '#089981' : '#f23645',
                border: `1px solid ${activeTrade.direction === 'BUY' ? '#089981' : '#f23645'}`,
                padding: '6px 12px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}>
                {activeTrade.direction === 'BUY' ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                {activeTrade.direction} {activeTrade.symbol} #{activeTrade.ticket}
              </div>

              <div>
                <span style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Current Milestone</span>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'rgba(138, 43, 226, 0.15)',
                  border: '1px solid rgba(138, 43, 226, 0.4)',
                  color: '#d2a8ff',
                  padding: '2px 10px',
                  borderRadius: 20,
                  fontSize: 11.5,
                  fontWeight: 700,
                  marginLeft: 8
                }}>
                  <Sparkles size={12} color="#d2a8ff" />
                  {activeTrade.milestone || 'SURGE_RUNNER'}
                </div>
              </div>
            </div>

            {/* Extra Profit Beyond TP2 Hero Counter */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              background: 'rgba(0, 255, 136, 0.08)',
              border: '1px solid rgba(0, 255, 136, 0.3)',
              borderRadius: 10,
              padding: '10px 18px'
            }}>
              <div>
                <div style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase' }}>
                  EXTRA PROFIT CAPTURED BEYOND TP2
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#00ff88', fontVariantNumeric: 'tabular-nums' }}>
                  +${Number(activeTrade.extra_profit_captured || 0).toFixed(2)}
                </div>
              </div>
              <div style={{
                height: 36,
                width: 1,
                background: 'rgba(255, 255, 255, 0.1)'
              }} />
              <div>
                <div style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase' }}>RATCHET EXECUTIONS</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#ffffff', fontVariantNumeric: 'tabular-nums' }}>
                  {activeTrade.ratchet_count || 0}
                </div>
              </div>
            </div>
          </div>

          {/* Middle Row: Price Trajectory Progress Matrix */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: 12,
            background: '#0a0d14',
            padding: '14px 16px',
            borderRadius: 8,
            border: '1px solid #21262d'
          }}>
            <div>
              <div style={{ fontSize: 11, color: '#8b949e' }}>Entry Price</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#ffffff', fontVariantNumeric: 'tabular-nums' }}>
                {Number(activeTrade.entry_price || 0).toFixed(activeTrade.symbol?.includes('JPY') ? 3 : 2)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#8b949e' }}>TP1 (BE Target)</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#58a6ff', fontVariantNumeric: 'tabular-nums' }}>
                {Number(activeTrade.tp1 || 0).toFixed(activeTrade.symbol?.includes('JPY') ? 3 : 2)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#8b949e' }}>TP2 Milestone</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#bc8cff', fontVariantNumeric: 'tabular-nums' }}>
                {Number(activeTrade.tp2 || 0).toFixed(activeTrade.symbol?.includes('JPY') ? 3 : 2)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#8b949e' }}>Peak Price</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#00ff88', fontVariantNumeric: 'tabular-nums' }}>
                {Number(activeTrade.peak_price || activeTrade.current_price || 0).toFixed(activeTrade.symbol?.includes('JPY') ? 3 : 2)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#8b949e' }}>Current Market Price</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#ffffff', fontVariantNumeric: 'tabular-nums' }}>
                {Number(activeTrade.current_price || 0).toFixed(activeTrade.symbol?.includes('JPY') ? 3 : 2)}
              </div>
            </div>
            <div style={{
              background: 'rgba(0, 240, 255, 0.08)',
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid rgba(0, 240, 255, 0.25)'
            }}>
              <div style={{ fontSize: 11, color: '#00f0ff', fontWeight: 600 }}>Ratchet Stop Loss</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#00f0ff', fontVariantNumeric: 'tabular-nums' }}>
                {Number(activeTrade.proposed_sl || activeTrade.current_sl || 0).toFixed(activeTrade.symbol?.includes('JPY') ? 3 : 2)}
              </div>
            </div>
          </div>

          {/* Bottom Row: Manual Operator Action Controls */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            paddingTop: 4
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#8b949e' }}>
              <Lock size={14} color="#00ff88" />
              <span>Mathematical Invariant: <strong>Stop Loss moves strictly in profit direction</strong></span>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => handleOperatorAction(activeTrade.ticket, 'lock_tp2')}
                disabled={actionLoading}
                style={{
                  background: 'rgba(188, 140, 255, 0.12)',
                  border: '1px solid rgba(188, 140, 255, 0.4)',
                  color: '#d2a8ff',
                  padding: '6px 14px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Lock TP2 Milestone (90%)
              </button>
              <button
                onClick={() => handleOperatorAction(activeTrade.ticket, 'tighten')}
                disabled={actionLoading}
                style={{
                  background: 'rgba(0, 240, 255, 0.12)',
                  border: '1px solid rgba(0, 240, 255, 0.4)',
                  color: '#00f0ff',
                  padding: '6px 14px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Emergency Leash Snap (0.25x ATR)
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* STANDBY RADAR WHEN NO TRADE IS OPEN */
        <div style={{
          background: 'linear-gradient(180deg, #131722 0%, #0d1117 100%)',
          borderRadius: 12,
          border: '1px dashed #30363d',
          padding: '28px 24px',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12
        }}>
          <div style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            background: 'rgba(0, 240, 255, 0.08)',
            border: '1px solid rgba(0, 240, 255, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Crosshair size={26} color="#00f0ff" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#ffffff' }}>
              Neural Sentinel is in Passive Standby Mode
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#8b949e', maxWidth: 620, lineHeight: 1.5 }}>
              The 5 specialized neurons remain dormant until a trade is executed by <strong>Haider-Scalper-Enhanced</strong> on MT5.
              Once open, all 5 neurons wake up instantly, taking over the runner and ratcheting profits forward to harvest extended trend runs.
            </p>
          </div>
          <button
            onClick={handleToggleSimulation}
            style={{
              marginTop: 6,
              background: 'rgba(0, 240, 255, 0.15)',
              border: '1px solid #00f0ff',
              color: '#00f0ff',
              padding: '8px 18px',
              borderRadius: 6,
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <Play size={14} fill="#00f0ff" />
            Launch Live Simulated Trade Demo
          </button>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          3. THE 5 LIVE NEURONS MATRIX (DEEP-DIVE CARDS)
      ───────────────────────────────────────────────────────────── */}
      <div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Layers size={17} color="#00f0ff" />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#ffffff' }}>
              The 5 Active Neural Evaluators
            </h2>
          </div>
          <span style={{ fontSize: 11.5, color: '#8b949e' }}>
            {isLive ? '🟢 High-frequency real-time continuous evaluation' : '⚪ Synchronized to 5M candle triggers'}
          </span>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16
        }}>
          {/* NEURON 1: VEV */}
          <div style={{
            background: '#131722',
            borderRadius: 10,
            border: isLive ? '1px solid rgba(0, 240, 255, 0.3)' : '1px solid #21262d',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 10
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  background: 'rgba(0, 240, 255, 0.15)',
                  color: '#00f0ff',
                  fontWeight: 800,
                  fontSize: 11,
                  padding: '2px 6px',
                  borderRadius: 4
                }}>N1: VEV</span>
                <strong style={{ fontSize: 13, color: '#ffffff' }}>Volatility Expansion</strong>
              </div>
              <span style={{
                fontSize: 11,
                color: neurons.vev?.mode === 'EXPANDING_SURGE' ? '#00ff88' : '#8b949e',
                fontWeight: 600
              }}>
                {neurons.vev?.mode || 'MONITORING'}
              </span>
            </div>

            <p style={{ margin: 0, fontSize: 12, color: '#8b949e', lineHeight: 1.4 }}>
              Evaluates fast vs slow ATR ratio to dynamically adjust trailing leash breathing room.
            </p>

            <div style={{
              background: '#0a0d14',
              padding: '10px 12px',
              borderRadius: 6,
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12
            }}>
              <div>
                <span style={{ color: '#8b949e' }}>ATR Ratio: </span>
                <strong style={{ color: '#ffffff' }}>{neurons.vev?.ratio || '1.00'}x</strong>
              </div>
              <div>
                <span style={{ color: '#8b949e' }}>Leash Mult: </span>
                <strong style={{ color: '#00f0ff' }}>{neurons.vev?.adaptive_multiplier || '1.00'}x</strong>
              </div>
            </div>
          </div>

          {/* NEURON 2: TVV */}
          <div style={{
            background: '#131722',
            borderRadius: 10,
            border: isLive ? '1px solid rgba(0, 255, 136, 0.3)' : '1px solid #21262d',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 10
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  background: 'rgba(0, 255, 136, 0.15)',
                  color: '#00ff88',
                  fontWeight: 800,
                  fontSize: 11,
                  padding: '2px 6px',
                  borderRadius: 4
                }}>N2: TVV</span>
                <strong style={{ fontSize: 13, color: '#ffffff' }}>Trend Velocity</strong>
              </div>
              <span style={{
                fontSize: 11,
                color: neurons.tvv?.surge_clearance ? '#00ff88' : '#8b949e',
                fontWeight: 600
              }}>
                {neurons.tvv?.velocity_label || 'NORMAL'}
              </span>
            </div>

            <p style={{ margin: 0, fontSize: 12, color: '#8b949e', lineHeight: 1.4 }}>
              Computes EMA 9/21 angular trajectory slope to confirm surge momentum clearance.
            </p>

            <div style={{
              background: '#0a0d14',
              padding: '10px 12px',
              borderRadius: 6,
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12
            }}>
              <div>
                <span style={{ color: '#8b949e' }}>Angular Slope: </span>
                <strong style={{ color: '#ffffff' }}>{neurons.tvv?.slope_degrees || '0.0'}°</strong>
              </div>
              <div>
                <span style={{ color: '#8b949e' }}>Surge Clear: </span>
                <strong style={{ color: neurons.tvv?.surge_clearance ? '#00ff88' : '#e6edf3' }}>
                  {neurons.tvv?.surge_clearance ? 'PASSED' : 'PENDING'}
                </strong>
              </div>
            </div>
          </div>

          {/* NEURON 3: CEV */}
          <div style={{
            background: '#131722',
            borderRadius: 10,
            border: isLive ? '1px solid rgba(255, 123, 114, 0.3)' : '1px solid #21262d',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 10
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  background: 'rgba(255, 123, 114, 0.15)',
                  color: '#ff7b72',
                  fontWeight: 800,
                  fontSize: 11,
                  padding: '2px 6px',
                  borderRadius: 4
                }}>N3: CEV</span>
                <strong style={{ fontSize: 13, color: '#ffffff' }}>Climax Exhaustion</strong>
              </div>
              <span style={{
                fontSize: 11,
                color: neurons.cev?.climax_score >= 80 ? '#f23645' : '#8b949e',
                fontWeight: 600
              }}>
                {neurons.cev?.risk_level || 'LOW'}
              </span>
            </div>

            <p style={{ margin: 0, fontSize: 12, color: '#8b949e', lineHeight: 1.4 }}>
              Monitors Wilder RSI (&gt; 82 / &lt; 18) and Bollinger 2.2σ envelope stretches for blow-off reversals.
            </p>

            <div style={{
              background: '#0a0d14',
              padding: '10px 12px',
              borderRadius: 6,
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12
            }}>
              <div>
                <span style={{ color: '#8b949e' }}>Climax Risk: </span>
                <strong style={{ color: neurons.cev?.climax_score >= 80 ? '#f23645' : '#00ff88' }}>
                  {neurons.cev?.climax_score ? `${neurons.cev.climax_score}/100` : '15/100'}
                </strong>
              </div>
              <div>
                <span style={{ color: '#8b949e' }}>Action: </span>
                <strong style={{ color: '#ffffff' }}>{neurons.cev?.action || 'PERMIT_RUN'}</strong>
              </div>
            </div>
          </div>

          {/* NEURON 4: LTS */}
          <div style={{
            background: '#131722',
            borderRadius: 10,
            border: isLive ? '1px solid rgba(210, 168, 255, 0.3)' : '1px solid #21262d',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 10
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  background: 'rgba(210, 168, 255, 0.15)',
                  color: '#d2a8ff',
                  fontWeight: 800,
                  fontSize: 11,
                  padding: '2px 6px',
                  borderRadius: 4
                }}>N4: LTS</span>
                <strong style={{ fontSize: 13, color: '#ffffff' }}>Liquidity Trap Sentinel</strong>
              </div>
              <span style={{
                fontSize: 11,
                color: neurons.lts?.trap_detected ? '#f23645' : '#00ff88',
                fontWeight: 600
              }}>
                {neurons.lts?.threat_level || 'CLEAR'}
              </span>
            </div>

            <p style={{ margin: 0, fontSize: 12, color: '#8b949e', lineHeight: 1.4 }}>
              Detects counter-order flow institutional absorption wicks (≥ 38%) to lock in profits before traps.
            </p>

            <div style={{
              background: '#0a0d14',
              padding: '10px 12px',
              borderRadius: 6,
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12
            }}>
              <div>
                <span style={{ color: '#8b949e' }}>Wick Ratio: </span>
                <strong style={{ color: '#ffffff' }}>{neurons.lts?.wick_ratio ? `${(neurons.lts.wick_ratio * 100).toFixed(0)}%` : '0%'}</strong>
              </div>
              <div>
                <span style={{ color: '#8b949e' }}>Trap Defense: </span>
                <strong style={{ color: '#00ff88' }}>ACTIVE</strong>
              </div>
            </div>
          </div>

          {/* NEURON 5: PPLR */}
          <div style={{
            background: '#131722',
            borderRadius: 10,
            border: isLive ? '1px solid rgba(0, 240, 255, 0.5)' : '1px solid #21262d',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            gridColumn: '1 / -1'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  background: 'linear-gradient(90deg, #00f0ff, #00ff88)',
                  color: '#0a0d14',
                  fontWeight: 900,
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 4
                }}>N5: PPLR</span>
                <strong style={{ fontSize: 14, color: '#ffffff' }}>Parabolic Profit Ratchet (Master Synthesizer)</strong>
              </div>
              <span style={{
                fontSize: 11.5,
                color: '#00ff88',
                fontWeight: 700
              }}>
                {neurons.pplr?.ratchet_reason || 'SYNTHESIZING_VECTORS'}
              </span>
            </div>

            <p style={{ margin: 0, fontSize: 12, color: '#8b949e', lineHeight: 1.4 }}>
              Synthesizes Neurons 1–4 into a continuous non-decreasing stop loss level.
              When TP2 is passed, rather than terminating the trade, PPLR steps SL to TP1+15%, then to 85% of TP2, and finally unleashes dynamic Chandelier trailing!
            </p>

            <div style={{
              background: '#0a0d14',
              padding: '12px 16px',
              borderRadius: 6,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
              fontSize: 12
            }}>
              <div>
                <span style={{ color: '#8b949e' }}>Proposed SL: </span>
                <strong style={{ color: '#00f0ff', fontSize: 13 }}>
                  {neurons.pplr?.proposed_sl ? Number(neurons.pplr.proposed_sl).toFixed(3) : 'HOLD'}
                </strong>
              </div>
              <div>
                <span style={{ color: '#8b949e' }}>Mathematical Milestone: </span>
                <strong style={{ color: '#d2a8ff' }}>{neurons.pplr?.milestone || 'INITIAL'}</strong>
              </div>
              <div>
                <span style={{ color: '#8b949e' }}>Locked Extra Profit: </span>
                <strong style={{ color: '#00ff88', fontSize: 13 }}>
                  +${Number(neurons.pplr?.extra_profit_locked || 0).toFixed(2)}
                </strong>
              </div>
              <div>
                <span style={{ color: '#8b949e' }}>MT5 Synced Ratchets: </span>
                <strong style={{ color: '#ffffff' }}>{neurons.pplr?.ratchet_count || 0} updates</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          4. RECENT CLOSED RUNNERS HISTORY
      ───────────────────────────────────────────────────────────── */}
      {telemetry?.history_closed && telemetry.history_closed.length > 0 && (
        <div style={{
          background: '#131722',
          borderRadius: 10,
          border: '1px solid #21262d',
          padding: 16
        }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#ffffff' }}>
            Recent Neural Runner Histories
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: '#8b949e', borderBottom: '1px solid #21262d', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>Ticket</th>
                  <th style={{ padding: '8px 10px' }}>Symbol</th>
                  <th style={{ padding: '8px 10px' }}>Direction</th>
                  <th style={{ padding: '8px 10px' }}>Final Milestone</th>
                  <th style={{ padding: '8px 10px' }}>Ratchets</th>
                  <th style={{ padding: '8px 10px' }}>Extra Profit Locked</th>
                </tr>
              </thead>
              <tbody>
                {telemetry.history_closed.map((h, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '8px 10px', color: '#ffffff', fontWeight: 600 }}>#{h.ticket}</td>
                    <td style={{ padding: '8px 10px', color: '#00f0ff' }}>{h.symbol}</td>
                    <td style={{ padding: '8px 10px', color: h.direction === 1 ? '#089981' : '#f23645' }}>
                      {h.direction === 1 ? 'BUY' : 'SELL'}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#d2a8ff' }}>{h.milestone}</td>
                    <td style={{ padding: '8px 10px', color: '#ffffff' }}>{h.ratchet_count || 0}</td>
                    <td style={{ padding: '8px 10px', color: '#00ff88', fontWeight: 700 }}>
                      +${Number(h.extra_profit_captured || 0).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
