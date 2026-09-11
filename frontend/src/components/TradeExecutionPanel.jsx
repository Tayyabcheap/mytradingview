import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, TrendingDown, ShieldAlert, AlertTriangle, CheckCircle2, 
  X, RefreshCw, Layers, ArrowRight, DollarSign, Percent, Lock, Shield
} from 'lucide-react';

export default function TradeExecutionPanel({
  symbol = 'XAUUSDc',
  currentPrice,
  symbolInfo,
  onOrderExecuted,
  onOpenPositionsChange,
  activeLotSize,
  onLotSizeChange
}) {
  const [orderType, setOrderType] = useState('BUY'); // 'BUY' | 'SELL'
  const [lotSize, setLotSize] = useState(() => {
    if (activeLotSize != null) return activeLotSize;
    const saved = localStorage.getItem('twr_trade_lotSize');
    return saved ? Math.max(0.01, parseFloat(saved) || 0.01) : 0.01;
  });
  const [lotInput, setLotInput] = useState(() => {
    if (activeLotSize != null) return String(activeLotSize);
    const saved = localStorage.getItem('twr_trade_lotSize');
    return saved || '0.01';
  });
  const [enableSL, setEnableSL] = useState(true);
  const [enableTP, setEnableTP] = useState(true);
  const [slPrice, setSlPrice] = useState('');
  const [tpPrice, setTpPrice] = useState('');
  const [slPips, setSlPips] = useState(25);
  const [tpPips, setTpPips] = useState(50);
  const [autoBeAtTP1, setAutoBeAtTP1] = useState(() => localStorage.getItem('twr_auto_be_tp1') === 'true');
  const [positions, setPositions] = useState([]);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [orderError, setOrderError] = useState(null);
  const [orderSuccess, setOrderSuccess] = useState(null);
  const [preflight, setPreflight] = useState(null); // {ok, reason,...}

  // Confirmation Modals
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingCloseTicket, setPendingCloseTicket] = useState(null);

  const isGold = symbol.toUpperCase().includes('XAU') || symbol.toUpperCase().includes('GOLD');
  const maxLotAllowed = isGold ? 1.0 : (symbolInfo?.max_lot || 100.0);
  const minLotAllowed = symbolInfo?.min_lot || 0.01;
  const stepLot = symbolInfo?.step_lot || 0.01;

  // Gold lot limit violation check
  const isLotOverLimit = isGold && lotSize > 1.0;

  // Fetch active open positions
  const refreshPositions = async () => {
    try {
      setLoadingPositions(true);
      const res = await fetch('/api/positions');
      const data = await res.json();
      if (Array.isArray(data)) {
        setPositions(data);
        if (onOpenPositionsChange) onOpenPositionsChange(data);
      }
    } catch (err) {
      console.error("Error loading positions:", err);
    } finally {
      setLoadingPositions(false);
    }
  };

  useEffect(() => {
    refreshPositions();
    const interval = setInterval(refreshPositions, 2500);
    return () => clearInterval(interval);
  }, []);

  // Poll whether MT5 can actually place a trade right now (AlgoTrading on, account tradeable).
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const r = await fetch('/api/order/preflight');
        const d = await r.json();
        if (alive) setPreflight(d);
      } catch (e) { if (alive) setPreflight({ ok: false, reason: 'Cannot reach the local server' }); }
    };
    check();
    const iv = setInterval(check, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // Update SL and TP prices automatically when currentPrice or pips change
  useEffect(() => {
    if (!currentPrice || currentPrice <= 0) return;
    const digits = symbolInfo?.digits || (symbol.includes('JPY') ? 3 : 2);
    const pipMultiplier = (symbol.includes('JPY') || isGold) ? 0.01 : 0.0001;

    if (orderType === 'BUY') {
      const calculatedSl = currentPrice - (slPips * pipMultiplier);
      const calculatedTp = currentPrice + (tpPips * pipMultiplier);
      setSlPrice(calculatedSl > 0 ? calculatedSl.toFixed(digits) : '');
      setTpPrice(calculatedTp.toFixed(digits));
    } else {
      const calculatedSl = currentPrice + (slPips * pipMultiplier);
      const calculatedTp = currentPrice - (tpPips * pipMultiplier);
      setSlPrice(calculatedSl.toFixed(digits));
      setTpPrice(calculatedTp > 0 ? calculatedTp.toFixed(digits) : '');
    }
  }, [currentPrice, orderType, slPips, tpPips, symbol, symbolInfo]);

  // Sync when external activeLotSize changes
  useEffect(() => {
    if (activeLotSize != null && activeLotSize !== lotSize) {
      setLotSize(activeLotSize);
      setLotInput(String(activeLotSize));
    }
  }, [activeLotSize]);

  // Load saved lot size from database settings on mount
  useEffect(() => {
    let alive = true;
    fetch('/api/settings?key=lot_size')
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        const val = d && d.lot_size;
        if (typeof val === 'number' && val > 0) {
          const clamped = isGold ? Math.min(1.0, val) : val;
          setLotSize(clamped);
          setLotInput(clamped.toFixed(2));
          if (onLotSizeChange) onLotSizeChange(clamped);
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [isGold]);

  // Persist lot size safely to state, localStorage, and server database
  const persistLotSize = (val) => {
    let num = parseFloat(val);
    if (isNaN(num) || num < minLotAllowed) num = minLotAllowed;
    if (isGold && num > 1.0) num = 1.0;
    num = Math.round(num * 100) / 100;

    setLotSize(num);
    setLotInput(num.toFixed(2));
    localStorage.setItem('twr_trade_lotSize', String(num));

    // Save to SQLite/JSON database settings
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lot_size: num })
    }).catch(() => {});

    if (onLotSizeChange) onLotSizeChange(num);
  };

  // Modern input typing handler: does not jump or reject decimal points while typing
  const handleInputChange = (raw) => {
    const sanitized = raw.replace(/[^0-9.]/g, '');
    const parts = sanitized.split('.');
    const clean = parts[0] + (parts.length > 1 ? '.' + parts.slice(1).join('') : '');
    setLotInput(clean);

    const num = parseFloat(clean);
    if (!isNaN(num) && num > 0) {
      const clamped = isGold ? Math.min(1.0, num) : num;
      setLotSize(clamped);
      if (onLotSizeChange) onLotSizeChange(clamped);
    }
  };

  const handleInputBlur = () => {
    persistLotSize(lotInput);
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      persistLotSize(lotInput);
      e.currentTarget.blur();
    }
  };

  const handleStepLot = (delta) => {
    const next = Math.max(minLotAllowed, Math.round((lotSize + delta) * 100) / 100);
    persistLotSize(next);
  };

  // Set R:R preset
  const handleRRPreset = (rrMultiplier) => {
    setTpPips(Math.round(slPips * rrMultiplier));
  };

  // Calculate live Risk:Reward Ratio
  const currentRR = slPips > 0 ? (tpPips / slPips).toFixed(2) : '1.00';

  // Execute Order Submission to MT5
  const handleExecuteOrder = async () => {
    if (isLotOverLimit) {
      setOrderError("Safety Limit Rejection: Maximum lot size for Gold is 1.0. Please adjust lot size.");
      setShowConfirmModal(false);
      return;
    }

    setSubmitting(true);
    setOrderError(null);
    setOrderSuccess(null);

    const payload = {
      symbol,
      type: orderType,
      volume: lotSize,
      sl: enableSL ? parseFloat(slPrice) || 0.0 : 0.0,
      tp: enableTP ? parseFloat(tpPrice) || 0.0 : 0.0,
      auto_be_tp1: autoBeAtTP1,
      comment: `TWR ${orderType}`
    };
    console.log('[TWR] Executing order →', payload);

    try {
      const res = await fetch('/api/order/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      console.log('[TWR] Order response ←', res.status, data);
      if (!res.ok || data.error) {
        throw new Error(data.error || "Order execution failed");
      }

      setOrderSuccess(`Order #${data.order || data.deal} executed successfully at ${data.price || currentPrice}`);
      setShowConfirmModal(false);
      refreshPositions();
      if (onOrderExecuted) onOrderExecuted(data);
    } catch (err) {
      setOrderError(err.message);
      setShowConfirmModal(false);
    } finally {
      setSubmitting(false);
    }
  };

  // Close Position with explicit confirmation
  const handleConfirmClosePosition = async () => {
    if (!pendingCloseTicket) return;

    try {
      const res = await fetch('/api/order/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: pendingCloseTicket.ticket })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        alert(data.error || "Failed to close position");
      } else {
        setPendingCloseTicket(null);
        refreshPositions();
      }
    } catch (err) {
      alert("Error closing position: " + err.message);
    }
  };

  const currentBid = currentPrice || 0;
  const currentAsk = currentPrice ? currentPrice + (symbolInfo?.spread ? symbolInfo.spread * (symbolInfo?.point || 0.001) : 0.01) : 0;

  return (
    <div className="trade-execution-panel" style={{
      background: '#131722',
      border: '1px solid #2a2e39',
      borderRadius: 6,
      display: 'flex',
      flexDirection: 'column',
      color: '#d1d4dc',
      fontSize: 12
    }}>
      {/* HEADER */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid #1f2430',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: '#0d1117'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 700, color: '#ffffff', fontSize: 13 }}>{symbol}</span>
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '1px 5px',
            borderRadius: 3,
            background: 'rgba(41,98,255,0.15)',
            color: '#2962ff'
          }}>
            MT5 Execution
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#8b949e' }}>
          Spread: <strong style={{ color: '#ffffff' }}>{symbolInfo?.spread || 12}</strong> pts
        </div>
      </div>

      {/* BODY */}
      <div style={{ padding: '12px 14px' }}>
        {/* NOTIFICATIONS */}
        {orderSuccess && (
          <div style={{
            padding: '8px 10px',
            background: 'rgba(8,153,129,0.15)',
            border: '1px solid rgba(8,153,129,0.4)',
            borderRadius: 4,
            color: '#089981',
            fontSize: 11.5,
            marginBottom: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}>
            <CheckCircle2 size={14} />
            <span>{orderSuccess}</span>
          </div>
        )}

        {orderError && (
          <div style={{
            padding: '8px 10px',
            background: 'rgba(242,54,69,0.15)',
            border: '1px solid rgba(242,54,69,0.4)',
            borderRadius: 4,
            color: '#f23645',
            fontSize: 11.5,
            marginBottom: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}>
            <AlertTriangle size={14} />
            <span>{orderError}</span>
          </div>
        )}

        {/* MT5 TRADE-READINESS WARNING */}
        {preflight && !preflight.ok && (
          <div style={{
            padding: '8px 10px',
            background: 'rgba(242,54,69,0.12)',
            border: '1px solid rgba(242,54,69,0.45)',
            borderRadius: 4,
            color: '#ff6b76',
            fontSize: 11.5,
            marginBottom: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}>
            <ShieldAlert size={14} />
            <span><strong>Can't trade yet:</strong> {preflight.reason}</span>
          </div>
        )}

        {/* GOLD SAFETY LIMIT ALERT */}
        {isGold && (
          <div style={{
            padding: '6px 10px',
            background: 'rgba(255, 214, 0, 0.08)',
            border: '1px solid rgba(255, 214, 0, 0.3)',
            borderRadius: 4,
            color: '#ffd600',
            fontSize: 11,
            marginBottom: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}>
            <Lock size={13} />
            <span>Safety Rule: Max Gold lot size is <strong>1.00</strong></span>
          </div>
        )}

        {/* BUY / SELL DUAL BUTTONS */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          {/* SELL BUTTON */}
          <button
            onClick={() => setOrderType('SELL')}
            style={{
              padding: '10px 8px',
              borderRadius: 6,
              background: orderType === 'SELL' ? 'rgba(242, 54, 69, 0.2)' : '#1a1e29',
              border: orderType === 'SELL' ? '2px solid #f23645' : '1px solid #2a2e39',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#f23645', fontWeight: 700, fontSize: 13 }}>
              <TrendingDown size={14} /> SELL
            </div>
            <div style={{ color: '#ffffff', fontWeight: 700, fontSize: 13.5, fontVariantNumeric: 'tabular-nums' }}>
              {currentBid ? currentBid.toFixed(symbolInfo?.digits || 2) : '---'}
            </div>
          </button>

          {/* BUY BUTTON */}
          <button
            onClick={() => setOrderType('BUY')}
            style={{
              padding: '10px 8px',
              borderRadius: 6,
              background: orderType === 'BUY' ? 'rgba(8, 153, 129, 0.2)' : '#1a1e29',
              border: orderType === 'BUY' ? '2px solid #089981' : '1px solid #2a2e39',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#089981', fontWeight: 700, fontSize: 13 }}>
              <TrendingUp size={14} /> BUY
            </div>
            <div style={{ color: '#ffffff', fontWeight: 700, fontSize: 13.5, fontVariantNumeric: 'tabular-nums' }}>
              {currentAsk ? currentAsk.toFixed(symbolInfo?.digits || 2) : '---'}
            </div>
          </button>
        </div>

        {/* LOT SIZE CONTROL */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11.5, color: '#8b949e' }}>
            <span>Lot Size (Volume)</span>
            <span>Max: {maxLotAllowed.toFixed(2)}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              onClick={() => handleStepLot(-0.01)}
              style={{
                width: 34,
                height: 34,
                background: '#1e222d',
                border: '1px solid #2a2e39',
                borderRadius: 4,
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 16
              }}
            >
              -
            </button>

            <input
              type="text"
              inputMode="decimal"
              pattern="[0-9]*\.?[0-9]*"
              value={lotInput}
              onChange={e => handleInputChange(e.target.value)}
              onBlur={handleInputBlur}
              onKeyDown={handleInputKeyDown}
              placeholder="0.01"
              style={{
                flex: 1,
                height: 34,
                background: isLotOverLimit ? 'rgba(242,54,69,0.15)' : '#0e1116',
                border: isLotOverLimit ? '1px solid #f23645' : '1px solid #2a2e39',
                borderRadius: 4,
                color: isLotOverLimit ? '#f23645' : '#ffffff',
                textAlign: 'center',
                fontWeight: 700,
                fontSize: 14,
                outline: 'none',
                letterSpacing: '0.3px'
              }}
            />

            <button
              type="button"
              onClick={() => handleStepLot(0.01)}
              style={{
                width: 34,
                height: 34,
                background: '#1e222d',
                border: '1px solid #2a2e39',
                borderRadius: 4,
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 16
              }}
            >
              +
            </button>
          </div>

          {/* Quick Preset Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4, marginTop: 6 }}>
            {(isGold ? [0.01, 0.05, 0.10, 0.25, 0.50, 1.00] : [0.01, 0.05, 0.10, 0.50, 1.00, 2.00]).map(v => (
              <button
                key={v}
                type="button"
                onClick={() => persistLotSize(v)}
                style={{
                  padding: '5px 0',
                  background: Math.abs(lotSize - v) < 0.001 ? 'var(--brand, #2962ff)' : '#1e222d',
                  border: Math.abs(lotSize - v) < 0.001 ? '1px solid #2962ff' : '1px solid #2a2e39',
                  borderRadius: 4,
                  color: Math.abs(lotSize - v) < 0.001 ? '#fff' : '#8b949e',
                  fontSize: 11,
                  cursor: 'pointer',
                  fontWeight: Math.abs(lotSize - v) < 0.001 ? 700 : 500,
                  transition: 'all 0.15s ease'
                }}
              >
                {v.toFixed(2)}
              </button>
            ))}
          </div>
        </div>

        {/* STOP LOSS & TAKE PROFIT */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          {/* SL */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: '#f23645', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={enableSL}
                  onChange={e => setEnableSL(e.target.checked)}
                />
                Stop Loss
              </label>
              <span style={{ fontSize: 10, color: '#8b949e' }}>{slPips} pips</span>
            </div>
            <input
              type="number"
              disabled={!enableSL}
              value={slPrice}
              onChange={e => setSlPrice(e.target.value)}
              placeholder="SL Price"
              style={{
                width: '100%',
                padding: '6px 8px',
                background: '#0e1116',
                border: '1px solid #2a2e39',
                borderRadius: 4,
                color: '#f23645',
                fontSize: 12,
                fontWeight: 600,
                outline: 'none',
                boxSizing: 'border-box',
                opacity: enableSL ? 1 : 0.4
              }}
            />
          </div>

          {/* TP */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: '#089981', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={enableTP}
                  onChange={e => setEnableTP(e.target.checked)}
                />
                Take Profit
              </label>
              <span style={{ fontSize: 10, color: '#8b949e' }}>{tpPips} pips</span>
            </div>
            <input
              type="number"
              disabled={!enableTP}
              value={tpPrice}
              onChange={e => setTpPrice(e.target.value)}
              placeholder="TP Price"
              style={{
                width: '100%',
                padding: '6px 8px',
                background: '#0e1116',
                border: '1px solid #2a2e39',
                borderRadius: 4,
                color: '#089981',
                fontSize: 12,
                fontWeight: 600,
                outline: 'none',
                boxSizing: 'border-box',
                opacity: enableTP ? 1 : 0.4
              }}
            />
          </div>
        </div>

        {/* RISK:REWARD BAR & PRESETS */}
        <div style={{
          background: '#0e1116',
          border: '1px solid #1f2430',
          borderRadius: 4,
          padding: '6px 10px',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 11
        }}>
          <div>
            <span style={{ color: '#8b949e' }}>R:R Ratio: </span>
            <strong style={{ color: '#ffd600' }}>1 : {currentRR}</strong>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[1.5, 2.0, 3.0].map(rr => (
              <button
                key={rr}
                onClick={() => handleRRPreset(rr)}
                style={{
                  background: '#1e222d',
                  border: '1px solid #2a2e39',
                  borderRadius: 3,
                  color: '#8b949e',
                  fontSize: 10,
                  padding: '2px 5px',
                  cursor: 'pointer'
                }}
              >
                1:{rr}
              </button>
            ))}
          </div>
        </div>

        {/* SMART EXECUTION: AUTO-BE AT TP1 */}
        <div 
          onClick={() => {
            const next = !autoBeAtTP1;
            setAutoBeAtTP1(next);
            localStorage.setItem('twr_auto_be_tp1', next ? 'true' : 'false');
          }}
          style={{
            background: autoBeAtTP1 ? 'rgba(8, 153, 129, 0.08)' : '#0e1116',
            border: autoBeAtTP1 ? '1px solid rgba(8, 153, 129, 0.3)' : '1px solid #1f2430',
            borderRadius: 4,
            padding: '6px 10px',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Shield size={13} color={autoBeAtTP1 ? '#089981' : '#8b949e'} />
            <span style={{ fontSize: 11.5, fontWeight: 600, color: autoBeAtTP1 ? '#089981' : '#8b949e' }}>
              Auto SL to Breakeven at TP1
            </span>
          </div>
          <input
            type="checkbox"
            checked={autoBeAtTP1}
            onChange={(e) => {
              setAutoBeAtTP1(e.target.checked);
              localStorage.setItem('twr_auto_be_tp1', e.target.checked ? 'true' : 'false');
            }}
            style={{ accentColor: '#089981', cursor: 'pointer' }}
          />
        </div>

        {/* EXECUTE BUTTON */}
        <button
          disabled={submitting || isLotOverLimit}
          onClick={() => setShowConfirmModal(true)}
          style={{
            width: '100%',
            padding: '10px 0',
            borderRadius: 6,
            background: isLotOverLimit ? '#333' : (orderType === 'BUY' ? '#089981' : '#f23645'),
            color: '#ffffff',
            border: 'none',
            fontWeight: 800,
            fontSize: 13.5,
            cursor: (submitting || isLotOverLimit) ? 'not-allowed' : 'pointer',
            opacity: (submitting || isLotOverLimit) ? 0.6 : 1,
            boxShadow: isLotOverLimit ? 'none' : (orderType === 'BUY' ? '0 4px 14px rgba(8,153,129,0.3)' : '0 4px 14px rgba(242,54,69,0.3)'),
            transition: 'all 0.15s ease'
          }}
        >
          {submitting ? 'Executing Order...' : `Place ${orderType} (${lotSize.toFixed(2)} Lots)`}
        </button>
      </div>

      {/* OPEN POSITIONS MINI LIST */}
      <div style={{ borderTop: '1px solid #1f2430', padding: '10px 14px', background: '#0d1117' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#f0f3fa' }}>
            Open Positions ({positions.length})
          </span>
          <button
            onClick={refreshPositions}
            style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', padding: 2 }}
            title="Refresh positions"
          >
            <RefreshCw size={12} className={loadingPositions ? 'animate-spin' : ''} />
          </button>
        </div>

        {positions.length === 0 ? (
          <div style={{ fontSize: 11, color: '#6e7681', textAlign: 'center', padding: '6px 0' }}>
            No active positions
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 150, overflowY: 'auto' }}>
            {positions.map(p => {
              const pnl = p.profit || 0;
              const isProfit = pnl >= 0;

              return (
                <div
                  key={p.ticket}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 8px',
                    background: '#131722',
                    border: '1px solid #2a2e39',
                    borderRadius: 4,
                    fontSize: 11
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <strong style={{ color: '#fff' }}>{p.symbol}</strong>
                      <span style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        padding: '0 4px',
                        borderRadius: 2,
                        background: p.type_str === 'BUY' ? 'rgba(8,153,129,0.2)' : 'rgba(242,54,69,0.2)',
                        color: p.type_str === 'BUY' ? '#089981' : '#f23645'
                      }}>
                        {p.type_str} {p.volume}
                      </span>
                    </div>
                    <div style={{ color: '#8b949e', fontSize: 10, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>#{p.ticket} · Open: {p.price_open}</span>
                      {p.auto_be && (
                        <span style={{ 
                          color: p.auto_be_done ? '#089981' : '#f7a600', 
                          background: p.auto_be_done ? 'rgba(8,153,129,0.15)' : 'rgba(247,166,0,0.15)',
                          padding: '1px 4px',
                          borderRadius: 2,
                          fontWeight: 700,
                          fontSize: 9
                        }}>
                          {p.auto_be_done ? 'BE: PROTECTED' : 'BE: ARMED'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, color: isProfit ? '#089981' : '#f23645', fontVariantNumeric: 'tabular-nums' }}>
                        {isProfit ? '+' : ''}{pnl.toFixed(2)}
                      </div>
                    </div>
                    <button
                      onClick={() => setPendingCloseTicket(p)}
                      style={{
                        background: 'rgba(242,54,69,0.15)',
                        border: '1px solid rgba(242,54,69,0.3)',
                        borderRadius: 3,
                        color: '#f23645',
                        fontSize: 10,
                        padding: '3px 6px',
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                    >
                      Close
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* EXPLICIT ORDER CONFIRMATION MODAL */}
      {showConfirmModal && (
        <div className="modal-overlay" onClick={() => setShowConfirmModal(false)} style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 999999
        }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{
            width: 420,
            background: '#1e222d',
            border: '1px solid #2a2e39',
            borderRadius: 8,
            padding: '18px 20px',
            boxShadow: '0 16px 40px rgba(0,0,0,0.8)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>Confirm MT5 Order</span>
              <button onClick={() => setShowConfirmModal(false)} className="btn-icon">
                <X size={16} />
              </button>
            </div>

            <div style={{
              background: '#131722',
              borderRadius: 6,
              border: '1px solid #2a2e39',
              padding: '12px 14px',
              marginBottom: 16
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #1f2430' }}>
                <span style={{ color: '#8b949e' }}>Instrument</span>
                <strong style={{ color: '#fff' }}>{symbol}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #1f2430' }}>
                <span style={{ color: '#8b949e' }}>Action</span>
                <strong style={{ color: orderType === 'BUY' ? '#089981' : '#f23645' }}>
                  {orderType}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #1f2430' }}>
                <span style={{ color: '#8b949e' }}>Lot Size</span>
                <strong style={{ color: '#fff' }}>{lotSize.toFixed(2)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #1f2430' }}>
                <span style={{ color: '#8b949e' }}>Est. Price</span>
                <strong style={{ color: '#fff' }}>
                  {orderType === 'BUY' ? currentAsk.toFixed(symbolInfo?.digits || 2) : currentBid.toFixed(symbolInfo?.digits || 2)}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #1f2430' }}>
                <span style={{ color: '#8b949e' }}>Stop Loss</span>
                <span style={{ color: enableSL ? '#f23645' : '#8b949e' }}>
                  {enableSL ? slPrice : 'None'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}>
                <span style={{ color: '#8b949e' }}>Take Profit</span>
                <span style={{ color: enableTP ? '#089981' : '#8b949e' }}>
                  {enableTP ? tpPrice : 'None'}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setShowConfirmModal(false)}
                style={{
                  flex: 1,
                  padding: '9px 0',
                  background: '#2a2e39',
                  border: 'none',
                  borderRadius: 5,
                  color: '#d1d4dc',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteOrder}
                style={{
                  flex: 1.5,
                  padding: '9px 0',
                  background: orderType === 'BUY' ? '#089981' : '#f23645',
                  border: 'none',
                  borderRadius: 5,
                  color: '#ffffff',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Send Order to MT5
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EXPLICIT CLOSE POSITION CONFIRMATION MODAL */}
      {pendingCloseTicket && (
        <div className="modal-overlay" onClick={() => setPendingCloseTicket(null)} style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 999999
        }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{
            width: 380,
            background: '#1e222d',
            border: '1px solid #2a2e39',
            borderRadius: 8,
            padding: '18px 20px'
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff', marginBottom: 8 }}>
              Close Position Confirmation
            </div>
            <div style={{ fontSize: 12.5, color: '#8b949e', lineHeight: 1.5, marginBottom: 16 }}>
              Are you sure you want to close position <strong style={{ color: '#fff' }}>#{pendingCloseTicket.ticket}</strong> on <strong style={{ color: '#fff' }}>{pendingCloseTicket.symbol}</strong> ({pendingCloseTicket.type_str} {pendingCloseTicket.volume} Lots) at market price?
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setPendingCloseTicket(null)}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  background: '#2a2e39',
                  border: 'none',
                  borderRadius: 5,
                  color: '#d1d4dc',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmClosePosition}
                style={{
                  flex: 1.2,
                  padding: '8px 0',
                  background: '#f23645',
                  border: 'none',
                  borderRadius: 5,
                  color: '#ffffff',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Confirm Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
