import React, { useState, useMemo } from 'react';
import { Search, X, CheckCircle2, Plus, Sparkles, Filter, Compass } from 'lucide-react';

export default function BrokerSymbolPickerModal({
  isOpen,
  onClose,
  strategyName = 'Strategy',
  activeSymbols = [],
  brokerSymbols = [],
  onAddSymbol,
  accentColor = '#00f0ff'
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Categorization helper
  const getSymbolCategory = (item) => {
    const rawName = (typeof item === 'string' ? item : item.name || '').toUpperCase();
    const rawCat = (typeof item === 'object' && item.category ? item.category : '').toUpperCase();

    if (rawCat.includes('CRYPTO') || /BTC|ETH|SOL|XRP|LTC|ADA|DOGE|BNB/i.test(rawName)) return 'CRYPTO';
    if (rawCat.includes('METAL') || /XAU|GOLD|XAG|SILV|PLAT|XPT|XPD/i.test(rawName)) return 'METALS';
    if (rawCat.includes('ENERGY') || rawCat.includes('COMMOD') || /OIL|BRENT|WTI|GAS/i.test(rawName)) return 'COMMODITIES';
    if (rawCat.includes('INDEX') || rawCat.includes('INDICES') || /US30|USTEC|US500|DE40|DE30|NAS|SPX|DJI|UK100|JP225/i.test(rawName)) return 'INDICES';
    return 'FOREX';
  };

  const categories = [
    { id: 'ALL', label: 'All Instruments' },
    { id: 'FOREX', label: 'Forex Majors & Minors' },
    { id: 'METALS', label: 'Metals & Gold' },
    { id: 'CRYPTO', label: 'Crypto' },
    { id: 'COMMODITIES', label: 'Energy & Oil' },
    { id: 'INDICES', label: 'Indices' }
  ];

  // Normalized list of broker symbols
  const normalizedSymbols = useMemo(() => {
    if (!brokerSymbols || !brokerSymbols.length) {
      // Fallback default list if broker list not yet populated
      const fallback = [
        { name: 'XAUUSDm', description: 'Gold vs US Dollar', category: 'METALS' },
        { name: 'EURUSDm', description: 'Euro vs US Dollar', category: 'FOREX' },
        { name: 'GBPUSDm', description: 'Great Britain Pound vs US Dollar', category: 'FOREX' },
        { name: 'USDJPYm', description: 'US Dollar vs Japanese Yen', category: 'FOREX' },
        { name: 'GBPJPYm', description: 'Great Britain Pound vs Japanese Yen', category: 'FOREX' },
        { name: 'BTCUSDm', description: 'Bitcoin vs US Dollar', category: 'CRYPTO' },
        { name: 'ETHUSDm', description: 'Ethereum vs US Dollar', category: 'CRYPTO' },
        { name: 'USOILm', description: 'US Crude Oil (WTI)', category: 'COMMODITIES' },
        { name: 'USTECm', description: 'US Tech 100 Index', category: 'INDICES' },
        { name: 'US30m', description: 'Wall Street 30 Index', category: 'INDICES' }
      ];
      return fallback;
    }

    return brokerSymbols.map(s => {
      if (typeof s === 'string') {
        return {
          name: s,
          description: '',
          category: getSymbolCategory(s)
        };
      }
      return {
        name: s.name,
        description: s.description || '',
        category: getSymbolCategory(s),
        spread: s.spread,
        min_lot: s.min_lot,
        max_lot: s.max_lot
      };
    });
  }, [brokerSymbols]);

  // Filtered symbols based on category & search query
  const filteredSymbols = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return normalizedSymbols.filter(s => {
      const matchCat = selectedCategory === 'ALL' || s.category === selectedCategory;
      if (!matchCat) return false;
      if (!q) return true;
      const matchName = s.name.toLowerCase().includes(q);
      const matchDesc = (s.description || '').toLowerCase().includes(q);
      return matchName || matchDesc;
    });
  }, [normalizedSymbols, selectedCategory, searchQuery]);

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(5, 8, 15, 0.78)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: 16
    }}>
      <div style={{
        width: '100%',
        maxWidth: 720,
        maxHeight: '85vh',
        background: 'linear-gradient(180deg, #131722 0%, #0c1017 100%)',
        border: `1px solid ${accentColor}40`,
        borderRadius: 14,
        boxShadow: `0 20px 60px rgba(0, 0, 0, 0.7), 0 0 30px ${accentColor}15`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        animation: 'fadeIn 0.15s ease'
      }}>
        {/* Modal Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid #21262d',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(22, 27, 34, 0.7)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: `${accentColor}20`,
              border: `1px solid ${accentColor}60`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Compass size={17} color={accentColor} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#ffffff' }}>
                Add Broker Instrument to {strategyName}
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#8b949e' }}>
                Select from {normalizedSymbols.length} active MT5 broker symbols. Isolated to this strategy.
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
              padding: 6,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#ffffff'}
            onMouseLeave={e => e.currentTarget.style.color = '#8b949e'}
          >
            <X size={18} />
          </button>
        </div>

        {/* Search Bar */}
        <div style={{ padding: '14px 20px 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            width: '100%'
          }}>
            <Search size={16} color="#8b949e" style={{ position: 'absolute', left: 12 }} />
            <input
              type="text"
              autoFocus
              placeholder="Search symbol, currency, or asset (e.g. XAU, EUR, BTC, OIL, US30)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: 8,
                padding: '10px 14px 10px 38px',
                fontSize: 13,
                color: '#ffffff',
                outline: 'none',
                boxSizing: 'border-box'
              }}
              onFocus={e => e.target.style.borderColor = accentColor}
              onBlur={e => e.target.style.borderColor = '#30363d'}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: 12,
                  background: 'none',
                  border: 'none',
                  color: '#8b949e',
                  cursor: 'pointer',
                  padding: 2
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Category Filter Pills */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            overflowX: 'auto',
            paddingBottom: 4
          }}>
            {categories.map(cat => {
              const active = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  style={{
                    background: active ? `${accentColor}25` : 'rgba(48, 54, 61, 0.25)',
                    border: active ? `1px solid ${accentColor}` : '1px solid #30363d',
                    color: active ? accentColor : '#8b949e',
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Symbols List Table */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 20px 10px',
          minHeight: 260
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{
                position: 'sticky',
                top: 0,
                background: '#131722',
                color: '#8b949e',
                borderBottom: '1px solid #21262d',
                textAlign: 'left',
                zIndex: 2
              }}>
                <th style={{ padding: '8px 10px', fontWeight: 600 }}>Instrument</th>
                <th style={{ padding: '8px 10px', fontWeight: 600 }}>Description</th>
                <th style={{ padding: '8px 10px', fontWeight: 600 }}>Category</th>
                <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>Status / Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredSymbols.slice(0, 100).map((s, idx) => {
                const isConfigured = activeSymbols.includes(s.name);
                const isGold = s.name.toUpperCase().includes('XAU') || s.name.toUpperCase().includes('GOLD');
                const isBtc = s.name.toUpperCase().includes('BTC');

                return (
                  <tr
                    key={s.name}
                    style={{
                      borderBottom: '1px solid rgba(48, 54, 61, 0.3)',
                      background: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.015)'
                    }}
                  >
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{
                        fontWeight: 700,
                        color: isGold ? '#fbbf24' : isBtc ? '#f97316' : '#58a6ff'
                      }}>
                        {s.name}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', color: '#c9d1d9', fontSize: 11.5 }}>
                      {s.description || 'Broker Tradable Instrument'}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'rgba(110, 118, 129, 0.15)',
                        color: '#8b949e',
                        border: '1px solid #30363d'
                      }}>
                        {s.category}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      {isConfigured ? (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#089981',
                          padding: '3px 8px',
                          borderRadius: 4,
                          background: 'rgba(8, 153, 129, 0.15)'
                        }}>
                          <CheckCircle2 size={13} /> Active
                        </span>
                      ) : (
                        <button
                          onClick={() => onAddSymbol(s.name)}
                          style={{
                            background: `${accentColor}18`,
                            border: `1px solid ${accentColor}`,
                            color: accentColor,
                            padding: '4px 10px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            transition: 'all 0.15s ease'
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = accentColor;
                            e.currentTarget.style.color = '#000000';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = `${accentColor}18`;
                            e.currentTarget.style.color = accentColor;
                          }}
                        >
                          <Plus size={12} /> Add to Strategy
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {filteredSymbols.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: '30px 10px', textAlign: 'center', color: '#8b949e' }}>
                    No matching instruments found for "{searchQuery}".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Modal Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid #21262d',
          background: 'rgba(13, 17, 23, 0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 11.5,
          color: '#8b949e'
        }}>
          <div>
            Showing {Math.min(100, filteredSymbols.length)} of {filteredSymbols.length} matches ({normalizedSymbols.length} total broker instruments)
          </div>
          <button
            onClick={onClose}
            style={{
              background: '#21262d',
              border: '1px solid #30363d',
              color: '#ffffff',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
