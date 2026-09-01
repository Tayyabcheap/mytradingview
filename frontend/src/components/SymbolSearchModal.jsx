import React, { useState, useMemo, useEffect } from 'react';
import { Search, X, Star, ArrowUpRight, TrendingUp, DollarSign, Layers, Globe, Shield } from 'lucide-react';

const CATEGORIES = [
  { id: 'ALL', label: 'All', icon: Layers },
  { id: 'Forex', label: 'Forex', icon: Globe },
  { id: 'Crypto', label: 'Crypto', icon: TrendingUp },
  { id: 'Commodities', label: 'Commodities / Metals', icon: DollarSign },
  { id: 'Indices', label: 'Indices', icon: ArrowUpRight },
  { id: 'Stocks', label: 'Stocks', icon: Layers },
  { id: 'Favorites', label: 'Favorites', icon: Star },
];

export default function SymbolSearchModal({
  isOpen,
  onClose,
  symbols = [],
  currentSymbol,
  onSelectSymbol,
  brokerName = 'MT5 Broker'
}) {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [favorites, setFavorites] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('twr_fav_symbols') || '["XAUUSDc", "EURUSDc", "BTCUSDc"]');
    } catch (e) {
      return ["XAUUSDc", "EURUSDc", "BTCUSDc"];
    }
  });

  // Toggle favorite
  const toggleFavorite = (symName, e) => {
    e.stopPropagation();
    setFavorites(prev => {
      const next = prev.includes(symName) ? prev.filter(s => s !== symName) : [...prev, symName];
      try { localStorage.setItem('twr_fav_symbols', JSON.stringify(next)); } catch (err) {}
      return next;
    });
  };

  // Keyboard shortcut listener (ESC to close)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Counts per category
  const categoryCounts = useMemo(() => {
    const counts = { ALL: symbols.length, Favorites: favorites.length };
    symbols.forEach(s => {
      const cat = s.category || 'Forex';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [symbols, favorites]);

  // Filtered symbols
  const filteredSymbols = useMemo(() => {
    const q = query.trim().toLowerCase();
    return symbols.filter(s => {
      // Category filter
      if (selectedCategory === 'Favorites') {
        if (!favorites.includes(s.name)) return false;
      } else if (selectedCategory !== 'ALL') {
        if ((s.category || 'Forex').toLowerCase() !== selectedCategory.toLowerCase()) return false;
      }

      // Query filter
      if (!q) return true;
      return s.name.toLowerCase().includes(q) ||
             (s.description || '').toLowerCase().includes(q) ||
             (s.path || '').toLowerCase().includes(q);
    });
  }, [symbols, selectedCategory, query, favorites]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999
    }}>
      <div
        className="modal-content"
        onClick={e => e.stopPropagation()}
        style={{
          width: 720,
          maxWidth: '92vw',
          maxHeight: '85vh',
          background: '#131722',
          border: '1px solid #2a2e39',
          borderRadius: 8,
          boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* HEADER & SEARCH BAR */}
        <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #1f2430' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#f0f3fa' }}>Symbol Search</span>
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 4,
                background: 'rgba(41, 98, 255, 0.15)',
                color: '#2962ff',
                border: '1px solid rgba(41, 98, 255, 0.3)'
              }}>
                {brokerName}
              </span>
            </div>
            <button
              onClick={onClose}
              className="btn-icon"
              style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer' }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Search Input */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            background: '#0e1116',
            border: '1px solid #2a2e39',
            borderRadius: 6,
            padding: '8px 12px',
            gap: 10
          }}>
            <Search size={16} color="#8b949e" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search instruments (e.g. Gold, EURUSD, BTC, US30)..."
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#ffffff',
                fontSize: 14,
                width: '100%'
              }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer' }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* TRADINGVIEW CATEGORY TABS */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '8px 14px',
          background: '#0d1117',
          borderBottom: '1px solid #1f2430',
          overflowX: 'auto'
        }}>
          {CATEGORIES.map(cat => {
            const count = categoryCounts[cat.id] || 0;
            const isSel = selectedCategory === cat.id;
            const Icon = cat.icon;

            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  borderRadius: 5,
                  fontSize: 12,
                  fontWeight: isSel ? 700 : 500,
                  color: isSel ? '#ffffff' : '#8b949e',
                  background: isSel ? '#2962ff' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease'
                }}
              >
                <Icon size={13} />
                <span>{cat.label}</span>
                {count > 0 && (
                  <span style={{
                    fontSize: 10,
                    opacity: isSel ? 0.9 : 0.6,
                    background: isSel ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)',
                    padding: '1px 5px',
                    borderRadius: 8
                  }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* SYMBOLS LIST */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0', minHeight: 320, maxHeight: 450 }}>
          {filteredSymbols.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#8b949e' }}>
              <div style={{ fontSize: 14, marginBottom: 6 }}>No instruments found</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                Only symbols provided by your connected broker account ({brokerName}) are listed.
              </div>
            </div>
          ) : (
            filteredSymbols.map(s => {
              const isCurrent = s.name === currentSymbol;
              const isFav = favorites.includes(s.name);

              return (
                <div
                  key={s.name}
                  onClick={() => {
                    onSelectSymbol(s.name);
                    onClose();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 18px',
                    cursor: 'pointer',
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                    background: isCurrent ? 'rgba(41, 98, 255, 0.12)' : 'transparent',
                    borderLeft: isCurrent ? '3px solid #2962ff' : '3px solid transparent',
                    transition: 'background 0.1s ease'
                  }}
                  onMouseEnter={e => {
                    if (!isCurrent) e.currentTarget.style.background = '#1e222d';
                  }}
                  onMouseLeave={e => {
                    if (!isCurrent) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  {/* LEFT: SYMBOL & DESCRIPTION */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button
                      onClick={(e) => toggleFavorite(s.name, e)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: isFav ? '#ffd600' : '#4a5260',
                        cursor: 'pointer',
                        padding: 2,
                        display: 'flex',
                        alignItems: 'center'
                      }}
                      title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      <Star size={15} fill={isFav ? '#ffd600' : 'none'} />
                    </button>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#ffffff' }}>
                          {s.name}
                        </span>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: 3,
                          background: s.category === 'Crypto' ? 'rgba(255, 152, 0, 0.15)' :
                                      s.category === 'Commodities' ? 'rgba(255, 214, 0, 0.15)' :
                                      s.category === 'Indices' ? 'rgba(156, 39, 176, 0.15)' :
                                      'rgba(8, 153, 129, 0.15)',
                          color: s.category === 'Crypto' ? '#ff9800' :
                                 s.category === 'Commodities' ? '#ffd600' :
                                 s.category === 'Indices' ? '#ba68c8' :
                                 '#089981'
                        }}>
                          {s.category || 'Forex'}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#8b949e', marginTop: 2 }}>
                        {s.description || s.name}
                      </div>
                    </div>
                  </div>

                  {/* RIGHT: BROKER PATH & QUOTE */}
                  <div style={{ textAlign: 'right' }}>
                    {s.ask ? (
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#089981', fontVariantNumeric: 'tabular-nums' }}>
                        {s.ask.toFixed(s.digits || 2)}
                      </div>
                    ) : null}
                    <div style={{ fontSize: 11, color: '#6e7681' }}>
                      {s.path || brokerName}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* FOOTER */}
        <div style={{
          padding: '10px 18px',
          background: '#0d1117',
          borderTop: '1px solid #1f2430',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 11.5,
          color: '#8b949e'
        }}>
          <div>
            Showing <strong style={{ color: '#ffffff' }}>{filteredSymbols.length}</strong> available broker instruments
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Shield size={12} color="#089981" /> Verified MT5 Broker Feed
          </div>
        </div>
      </div>
    </div>
  );
}
