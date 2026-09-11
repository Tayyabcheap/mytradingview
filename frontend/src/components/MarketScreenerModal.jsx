import React, { useState, useEffect } from 'react';
import { X, Search, RefreshCw, Zap, TrendingUp, TrendingDown, Eye, Filter, ArrowUpRight } from 'lucide-react';

export default function MarketScreenerModal({ isOpen, onClose, onSelectSymbolAndGoToChart }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filterType, setFilterType] = useState('ALL'); // ALL, BUY, SELL, GOLD
  const [searchQuery, setSearchQuery] = useState('');

  const fetchScreener = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/screener/scan');
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Failed to scan markets');
      }
      setData(json);
    } catch (err) {
      console.error('Screener fetch error:', err);
      setError(err.message || 'Error fetching screener data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchScreener();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const rawResults = data?.results || [];
  const filteredResults = rawResults.filter(item => {
    if (filterType === 'BUY' && item.signal !== 'BUY') return false;
    if (filterType === 'SELL' && item.signal !== 'SELL') return false;
    if (filterType === 'GOLD' && !item.is_gold) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return item.symbol.toLowerCase().includes(q) || item.display_name.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: 20
    }}>
      <div style={{
        background: '#131722',
        border: '1px solid #2a2e39',
        borderRadius: 10,
        width: '100%',
        maxWidth: 960,
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 16px 48px rgba(0,0,0,0.8)',
        overflow: 'hidden'
      }}>
        {/* MODAL HEADER */}
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
              background: 'rgba(41, 98, 255, 0.2)',
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid rgba(41, 98, 255, 0.4)'
            }}>
              <Zap size={18} color="#2962ff" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#fff' }}>
                Algorithmic Market Screener
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: 11.5, color: '#8b949e' }}>
                Live multi-timeframe scans for Haider-Gold-Scalper and trend confluences.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={fetchScreener}
              disabled={loading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: '#1e222d',
                border: '1px solid #2a2e39',
                color: '#8b949e',
                borderRadius: 5,
                padding: '6px 10px',
                fontSize: 12,
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
            >
              <RefreshCw size={13} className={loading ? 'spin' : ''} />
              <span>{loading ? 'Scanning...' : 'Refresh'}</span>
            </button>

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
        </div>

        {/* CONTROLS BAR: SEARCH & FILTERS */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 20px',
          background: '#131722',
          borderBottom: '1px solid #1f2430'
        }}>
          {/* Search Box */}
          <div style={{ position: 'relative', width: 240 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: '#8b949e' }} />
            <input
              type="text"
              placeholder="Search symbol..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                background: '#1e222d',
                border: '1px solid #2a2e39',
                borderRadius: 5,
                padding: '6px 10px 6px 30px',
                color: '#fff',
                fontSize: 12.5
              }}
            />
          </div>

          {/* Filter Pills */}
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { id: 'ALL', label: 'All Assets' },
              { id: 'BUY', label: 'Buy Setups' },
              { id: 'SELL', label: 'Sell Setups' },
              { id: 'GOLD', label: 'Gold (XAU)' },
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setFilterType(f.id)}
                style={{
                  background: filterType === f.id ? 'var(--brand, #2962ff)' : '#1e222d',
                  border: '1px solid #2a2e39',
                  borderRadius: 4,
                  color: filterType === f.id ? '#fff' : '#8b949e',
                  padding: '4px 10px',
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* TABLE CONTENT */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px 20px' }}>
          {error ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#f23645' }}>
              {error}
            </div>
          ) : loading && !data ? (
            <div style={{ padding: 60, textAlign: 'center', color: '#8b949e' }}>
              <RefreshCw size={24} className="spin" style={{ margin: '0 auto 12px auto' }} />
              <div>Scanning markets across broker timeframes...</div>
            </div>
          ) : filteredResults.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center', color: '#8b949e' }}>
              No market setups match the active filter.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, textAlign: 'left', marginTop: 10 }}>
              <thead>
                <tr style={{ color: '#8b949e', borderBottom: '1px solid #2a2e39', fontSize: 11, textTransform: 'uppercase' }}>
                  <th style={{ padding: '8px 10px' }}>Symbol</th>
                  <th style={{ padding: '8px 10px' }}>Price</th>
                  <th style={{ padding: '8px 10px' }}>RSI</th>
                  <th style={{ padding: '8px 10px' }}>Signal & Setup</th>
                  <th style={{ padding: '8px 10px' }}>Confluence</th>
                  <th style={{ padding: '8px 10px' }}>Proposed SL / TP</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.map((item, idx) => {
                  const isBuy = item.signal === 'BUY';
                  const isSell = item.signal === 'SELL';
                  const badgeBg = isBuy ? 'rgba(8, 153, 129, 0.15)' : (isSell ? 'rgba(242, 54, 69, 0.15)' : 'rgba(255,255,255,0.05)');
                  const badgeColor = isBuy ? '#089981' : (isSell ? '#f23645' : '#8b949e');

                  return (
                    <tr 
                      key={idx}
                      style={{ 
                        borderBottom: '1px solid #1f2430',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      {/* Symbol */}
                      <td style={{ padding: '10px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 700, color: '#fff' }}>{item.display_name}</span>
                          {item.is_gold && (
                            <span style={{ background: '#f7a600', color: '#000', borderRadius: 3, padding: '1px 4px', fontSize: 9, fontWeight: 800 }}>
                              GOLD
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: 11, color: '#6e7681' }}>{item.symbol}</span>
                      </td>

                      {/* Price & Change */}
                      <td style={{ padding: '10px 10px' }}>
                        <div style={{ fontWeight: 600, color: '#fff' }}>{item.price}</div>
                        <div style={{ 
                          fontSize: 11, 
                          color: item.change_24h >= 0 ? '#089981' : '#f23645',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 2
                        }}>
                          {item.change_24h >= 0 ? '+' : ''}{item.change_24h}%
                        </div>
                      </td>

                      {/* RSI */}
                      <td style={{ padding: '10px 10px' }}>
                        <span style={{ 
                          fontWeight: 700,
                          color: item.rsi <= 33 ? '#089981' : (item.rsi >= 67 ? '#f23645' : '#8b949e')
                        }}>
                          {item.rsi}
                        </span>
                      </td>

                      {/* Signal & Setup */}
                      <td style={{ padding: '10px 10px' }}>
                        <div style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '3px 8px',
                          borderRadius: 4,
                          background: badgeBg,
                          color: badgeColor,
                          fontWeight: 700,
                          fontSize: 11.5
                        }}>
                          {isBuy && <TrendingUp size={12} />}
                          {isSell && <TrendingDown size={12} />}
                          <span>{item.signal}</span>
                        </div>
                        <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>
                          {item.signal_desc}
                        </div>
                      </td>

                      {/* Confluence Score & Grade */}
                      <td style={{ padding: '10px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ 
                            background: item.grade === 'A+' ? '#089981' : (item.grade === 'A' ? '#2962ff' : '#1e222d'),
                            color: '#fff',
                            borderRadius: 3,
                            padding: '1px 5px',
                            fontSize: 10,
                            fontWeight: 800
                          }}>
                            {item.grade}
                          </span>
                          <span style={{ fontWeight: 600 }}>{item.score}%</span>
                        </div>
                        <div style={{
                          width: 80,
                          height: 3,
                          background: '#1e222d',
                          borderRadius: 2,
                          marginTop: 4,
                          overflow: 'hidden'
                        }}>
                          <div style={{
                            width: `${item.score}%`,
                            height: '100%',
                            background: item.score >= 80 ? '#089981' : (item.score >= 60 ? '#2962ff' : '#f7a600')
                          }} />
                        </div>
                      </td>

                      {/* Proposed SL / TP */}
                      <td style={{ padding: '10px 10px', fontSize: 11.5 }}>
                        <div style={{ color: '#f23645' }}>SL: {item.sl}</div>
                        <div style={{ color: '#089981' }}>TP1: {item.tp1}</div>
                      </td>

                      {/* Action */}
                      <td style={{ padding: '10px 10px', textAlign: 'right' }}>
                        <button
                          onClick={() => {
                            if (onSelectSymbolAndGoToChart) {
                              onSelectSymbolAndGoToChart(item.symbol);
                            }
                            onClose();
                          }}
                          style={{
                            background: 'rgba(41, 98, 255, 0.15)',
                            border: '1px solid rgba(41, 98, 255, 0.3)',
                            borderRadius: 4,
                            color: 'var(--brand, #2962ff)',
                            padding: '4px 10px',
                            fontSize: 11.5,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4
                          }}
                        >
                          <span>Open</span>
                          <ArrowUpRight size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
