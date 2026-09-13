import React, { useState, useMemo } from 'react';
import { X, Search, Check, Layers, ShieldAlert, Sparkles, Sliders, CheckCircle2 } from 'lucide-react';

const COMMON_INSTRUMENT_CATEGORIES = {
  "Metals": [
    { symbol: "XAUUSDc", alt: "XAUUSD", name: "Gold / US Dollar", badge: "Core Default", isGold: true },
    { symbol: "XAGUSDc", alt: "XAGUSD", name: "Silver / US Dollar" }
  ],
  "Major Forex": [
    { symbol: "EURUSDc", alt: "EURUSD", name: "Euro / US Dollar" },
    { symbol: "GBPUSDc", alt: "GBPUSD", name: "British Pound / US Dollar" },
    { symbol: "USDJPYc", alt: "USDJPY", name: "US Dollar / Japanese Yen" },
    { symbol: "USDCADc", alt: "USDCAD", name: "US Dollar / Canadian Dollar" },
    { symbol: "USDCHFc", alt: "USDCHF", name: "US Dollar / Swiss Franc" },
    { symbol: "AUDUSDc", alt: "AUDUSD", name: "Australian Dollar / US Dollar" },
    { symbol: "NZDUSDc", alt: "NZDUSD", name: "New Zealand Dollar / US Dollar" }
  ],
  "Cross & Minor Forex": [
    { symbol: "EURJPYc", alt: "EURJPY", name: "Euro / Japanese Yen" },
    { symbol: "GBPJPYc", alt: "GBPJPY", name: "British Pound / Japanese Yen" },
    { symbol: "EURGBPc", alt: "EURGBP", name: "Euro / British Pound" },
    { symbol: "AUDJPYc", alt: "AUDJPY", name: "Australian Dollar / Japanese Yen" },
    { symbol: "CADJPYc", alt: "CADJPY", name: "Canadian Dollar / Japanese Yen" },
    { symbol: "EURAUDc", alt: "EURAUD", name: "Euro / Australian Dollar" }
  ],
  "Crypto & Energy": [
    { symbol: "BTCUSDc", alt: "BTCUSD", name: "Bitcoin / US Dollar" },
    { symbol: "ETHUSDc", alt: "ETHUSD", name: "Ethereum / US Dollar" },
    { symbol: "USOILc",  alt: "USOIL",  name: "WTI Crude Oil" }
  ]
};

const MAX_INSTRUMENTS = 10;

export default function ScalperPairSelectorModal({
  isOpen,
  onClose,
  activeSymbols = ["XAUUSDc"],
  availableSymbols = [],
  onSaveSymbols
}) {
  const [selected, setSelected] = useState(() => {
    return Array.isArray(activeSymbols) && activeSymbols.length > 0 
      ? activeSymbols.slice(0, MAX_INSTRUMENTS) 
      : ["XAUUSDc"];
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  // Match broker symbols if available
  const matchBrokerSymbol = (target) => {
    if (!availableSymbols || !availableSymbols.length) return target;
    const found = availableSymbols.find(s => {
      const name = (s.name || s).toUpperCase();
      return name === target.toUpperCase() || name.startsWith(target.toUpperCase().slice(0, 6));
    });
    return found ? (found.name || found) : target;
  };

  const handleToggleSymbol = (sym) => {
    const isSelected = selected.includes(sym);
    if (isSelected) {
      // Must keep at least 1 instrument active
      if (selected.length <= 1) return;
      setSelected(prev => prev.filter(s => s !== sym));
    } else {
      if (selected.length >= MAX_INSTRUMENTS) return;
      setSelected(prev => [...prev, sym]);
    }
  };

  const applyPreset = (presetList) => {
    const matched = presetList.map(s => matchBrokerSymbol(s)).slice(0, MAX_INSTRUMENTS);
    setSelected(matched);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (onSaveSymbols) {
        await onSaveSymbols(selected);
      }
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const q = searchQuery.trim().toLowerCase();

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.78)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999,
      padding: 20
    }}>
      <div style={{
        background: '#131722',
        border: '1px solid #2a2e39',
        borderRadius: 10,
        width: '100%',
        maxWidth: 680,
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.85)',
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
              background: 'rgba(0, 242, 254, 0.15)',
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid rgba(0, 242, 254, 0.3)'
            }}>
              <Layers size={18} color="#00f2fe" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#fff' }}>
                  Autonomous Scalper Instruments
                </h3>
                <span style={{
                  fontSize: 11,
                  fontWeight: 800,
                  padding: '2px 7px',
                  borderRadius: 4,
                  background: selected.length === MAX_INSTRUMENTS ? 'rgba(242,54,69,0.2)' : 'rgba(0,242,254,0.18)',
                  color: selected.length === MAX_INSTRUMENTS ? '#f87171' : '#00f2fe',
                  border: `1px solid ${selected.length === MAX_INSTRUMENTS ? 'rgba(242,54,69,0.4)' : 'rgba(0,242,254,0.35)'}`
                }}>
                  {selected.length} / {MAX_INSTRUMENTS} Active
                </span>
              </div>
              <p style={{ margin: '2px 0 0 0', fontSize: 11.5, color: '#8b949e' }}>
                Monitors 5M candles 24/5 in background. Instantly executes 2-tranche trades when setups form.
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

        {/* PRESETS BAR */}
        <div style={{
          padding: '10px 20px',
          background: '#171b26',
          borderBottom: '1px solid #1f2430',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap'
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#8b949e' }}>Quick Presets:</span>
          
          <button
            onClick={() => applyPreset(["XAUUSDc"])}
            style={{
              background: '#1f2430',
              border: '1px solid #2a2e39',
              color: '#fff',
              borderRadius: 4,
              padding: '4px 10px',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Gold Only (Default)
          </button>

          <button
            onClick={() => applyPreset(["XAUUSDc", "EURUSDc", "GBPUSDc", "USDJPYc", "AUDUSDc"])}
            style={{
              background: '#1f2430',
              border: '1px solid #2a2e39',
              color: '#00f2fe',
              borderRadius: 4,
              padding: '4px 10px',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Top 5 Majors
          </button>

          <button
            onClick={() => applyPreset([
              "XAUUSDc", "EURUSDc", "GBPUSDc", "USDJPYc", "USDCADc",
              "AUDUSDc", "NZDUSDc", "EURJPYc", "GBPJPYc", "BTCUSDc"
            ])}
            style={{
              background: '#1f2430',
              border: '1px solid #2a2e39',
              color: '#a855f7',
              borderRadius: 4,
              padding: '4px 10px',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Full 10 Basket (Max)
          </button>
        </div>

        {/* SEARCH BAR */}
        <div style={{ padding: '12px 20px 6px 20px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            background: '#0e1116',
            border: '1px solid #2a2e39',
            borderRadius: 6,
            padding: '6px 12px',
            gap: 8
          }}>
            <Search size={15} color="#8b949e" />
            <input
              type="text"
              placeholder="Search pairs by symbol or name (e.g., EUR, Gold, JPY)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                background: 'none',
                border: 'none',
                color: '#fff',
                fontSize: 12.5,
                outline: 'none',
                width: '100%'
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', padding: 0 }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* INSTRUMENT LIST */}
        <div style={{ padding: '8px 20px 16px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {Object.entries(COMMON_INSTRUMENT_CATEGORIES).map(([catName, items]) => {
            const filteredItems = items.filter(it => {
              if (!q) return true;
              return it.symbol.toLowerCase().includes(q) || 
                     (it.alt && it.alt.toLowerCase().includes(q)) || 
                     it.name.toLowerCase().includes(q);
            });

            if (!filteredItems.length) return null;

            return (
              <div key={catName}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#787b86', textTransform: 'uppercase', marginBottom: 6, letterSpacing: 0.6 }}>
                  {catName}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                  {filteredItems.map(item => {
                    const resolvedSym = matchBrokerSymbol(item.symbol);
                    const isChecked = selected.includes(resolvedSym) || selected.includes(item.symbol) || (item.alt && selected.includes(item.alt));
                    const isAtMax = selected.length >= MAX_INSTRUMENTS && !isChecked;

                    return (
                      <div
                        key={item.symbol}
                        onClick={() => !isAtMax && handleToggleSymbol(resolvedSym)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          background: isChecked ? 'rgba(0, 242, 254, 0.08)' : '#1e222d',
                          border: isChecked ? '1px solid rgba(0, 242, 254, 0.4)' : '1px solid #2a2e39',
                          borderRadius: 6,
                          cursor: isAtMax ? 'not-allowed' : 'pointer',
                          opacity: isAtMax ? 0.4 : 1,
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 700, fontSize: 13, color: isChecked ? '#00f2fe' : '#fff' }}>
                              {resolvedSym}
                            </span>
                            {item.isGold && (
                              <span style={{
                                fontSize: 9,
                                fontWeight: 800,
                                padding: '1px 5px',
                                borderRadius: 3,
                                background: 'rgba(247,166,0,0.2)',
                                color: '#f7a600',
                                border: '1px solid rgba(247,166,0,0.4)'
                              }}>
                                CORE
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: 11, color: '#8b949e', marginTop: 1 }}>
                            {item.name}
                          </span>
                        </div>

                        <div style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          border: isChecked ? '1px solid #00f2fe' : '1px solid #555d6e',
                          background: isChecked ? '#00f2fe' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          {isChecked && <Check size={12} color="#000" strokeWidth={3} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* FOOTER */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          borderTop: '1px solid #1f2430',
          background: '#0d1117'
        }}>
          <div style={{ fontSize: 11.5, color: '#8b949e' }}>
            {selected.length === 1 ? '1 pair actively monitored' : `${selected.length} pairs simultaneously monitored 24/5`}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onClose}
              style={{
                background: '#1e222d',
                border: '1px solid #2a2e39',
                color: '#fff',
                borderRadius: 5,
                padding: '7px 16px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>

            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                background: '#00f2fe',
                border: 'none',
                color: '#000',
                borderRadius: 5,
                padding: '7px 18px',
                fontSize: 12.5,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              {saving ? 'Saving…' : `Activate ${selected.length} Pair(s)`}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
