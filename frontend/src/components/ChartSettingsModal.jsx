import React, { useState } from 'react';
import { X, Sliders, Palette, Eye, Grid, Globe } from 'lucide-react';

export default function ChartSettingsModal({ isOpen, onClose, currentSettings, onSaveSettings }) {
  const [activeTab, setActiveTab] = useState('symbol');
  const [upColor, setUpColor] = useState(currentSettings.upColor || '#089981');
  const [downColor, setDownColor] = useState(currentSettings.downColor || '#f23645');
  const [showGrid, setShowGrid] = useState(currentSettings.showGrid !== false);
  const [gridColor, setGridColor] = useState(currentSettings.gridColor || '#1f2430');
  const [showPriceLine, setShowPriceLine] = useState(currentSettings.showPriceLine !== false);
  const [showWatermark, setShowWatermark] = useState(currentSettings.showWatermark || false);
  const [timezone, setTimezone] = useState(currentSettings.timezone || 'UTC');

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveSettings({
      upColor,
      downColor,
      showGrid,
      gridColor,
      showPriceLine,
      showWatermark,
      timezone
    });
    onClose();
  };

  const handleReset = () => {
    setUpColor('#089981');
    setDownColor('#f23645');
    setShowGrid(true);
    setGridColor('#1f2430');
    setShowPriceLine(true);
    setShowWatermark(false);
    setTimezone('UTC');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal-content" 
        style={{ width: 600, maxWidth: '90vw', height: 480, display: 'flex', flexDirection: 'column', padding: 0 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sliders size={20} color="var(--brand)" />
            <span style={{ fontSize: 16, fontWeight: 600 }}>Chart Settings</span>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={18}/></button>
        </div>

        {/* Body with Sidebar & Content */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Tabs Sidebar */}
          <div style={{
            width: 170,
            borderRight: '1px solid var(--border)',
            padding: '12px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4
          }}>
            {[
              { id: 'symbol', label: 'Symbol & Candles', icon: Palette },
              { id: 'appearance', label: 'Canvas & Grid', icon: Grid },
              { id: 'scales', label: 'Scales & Lines', icon: Eye },
              { id: 'timezone', label: 'Timezone', icon: Globe }
            ].map(tab => {
              const Icon = tab.icon;
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: isSelected ? 'rgba(41, 98, 255, 0.15)' : 'transparent',
                    color: isSelected ? 'var(--brand)' : 'var(--text)',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: isSelected ? 600 : 400,
                    textAlign: 'left'
                  }}
                >
                  <Icon size={16} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Content Pane */}
          <div style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
            {activeTab === 'symbol' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)' }}>CANDLESTICK PALETTE</div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13 }}>Bullish (Up) Candle Color</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input 
                      type="color" 
                      value={upColor} 
                      onChange={e => setUpColor(e.target.value)} 
                      style={{ cursor: 'pointer', border: 'none', background: 'none', width: 32, height: 32 }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{upColor}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13 }}>Bearish (Down) Candle Color</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input 
                      type="color" 
                      value={downColor} 
                      onChange={e => setDownColor(e.target.value)} 
                      style={{ cursor: 'pointer', border: 'none', background: 'none', width: 32, height: 32 }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{downColor}</span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'appearance' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)' }}>GRID & CANVAS</div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13 }}>Show Background Grid Lines</span>
                  <input 
                    type="checkbox" 
                    checked={showGrid} 
                    onChange={e => setShowGrid(e.target.checked)} 
                    style={{ cursor: 'pointer' }}
                  />
                </div>

                {showGrid && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13 }}>Grid Line Color</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input 
                        type="color" 
                        value={gridColor} 
                        onChange={e => setGridColor(e.target.value)} 
                        style={{ cursor: 'pointer', border: 'none', background: 'none', width: 32, height: 32 }}
                      />
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{gridColor}</span>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13 }}>Show Background Symbol Watermark</span>
                  <input 
                    type="checkbox" 
                    checked={showWatermark} 
                    onChange={e => setShowWatermark(e.target.checked)} 
                    style={{ cursor: 'pointer' }}
                  />
                </div>
              </div>
            )}

            {activeTab === 'scales' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)' }}>PRICE SCALES & AXIS</div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13 }}>Show Last Price Marker</span>
                  <input 
                    type="checkbox" 
                    checked={showPriceLine} 
                    onChange={e => setShowPriceLine(e.target.checked)} 
                    style={{ cursor: 'pointer' }}
                  />
                </div>
              </div>
            )}

            {activeTab === 'timezone' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)' }}>TIMEZONE SETTINGS</div>

                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
                    Select Chart Timezone
                  </label>
                  <select
                    value={timezone}
                    onChange={e => setTimezone(e.target.value)}
                    style={{
                      width: '100%',
                      background: '#1e222d',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      borderRadius: 6,
                      padding: '8px 12px',
                      fontSize: 13
                    }}
                  >
                    <option value="UTC">UTC (Universal Coordinated Time)</option>
                    <option value="America/New_York">UTC-4 (New York)</option>
                    <option value="Europe/London">UTC+1 (London)</option>
                    <option value="Asia/Dubai">UTC+4 (Dubai)</option>
                    <option value="Asia/Tokyo">UTC+9 (Tokyo)</option>
                    <option value="Asia/Singapore">UTC+8 (Singapore / Hong Kong)</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 20px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-card)'
        }}>
          <button 
            onClick={handleReset}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              borderRadius: 4,
              padding: '6px 14px',
              fontSize: 12,
              cursor: 'pointer'
            }}
          >
            Reset Defaults
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button 
              onClick={onClose}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                borderRadius: 4,
                padding: '6px 16px',
                fontSize: 12,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button 
              onClick={handleSave}
              style={{
                background: 'var(--brand)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '6px 18px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Apply Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
