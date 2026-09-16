import React, { useState, useEffect } from 'react';
import { Bookmark, Save, Trash2, Check, RefreshCw, X } from 'lucide-react';

export default function PresetBar({ strategyKey, currentConfig, onPresetApplied, accentColor = '#a855f7', triggerToast }) {
  const [presets, setPresets] = useState([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);

  // Fetch presets on mount
  const fetchPresets = async () => {
    try {
      const res = await fetch('/api/scalper/bot/presets');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.presets)) {
          setPresets(data.presets);
        }
      }
    } catch (e) {
      console.error('Error loading presets:', e);
    }
  };

  useEffect(() => {
    fetchPresets();
  }, []);

  // Apply chosen preset
  const handleApplyPreset = async (presetId) => {
    if (!presetId) return;
    setSelectedPresetId(presetId);
    setLoading(true);
    try {
      const res = await fetch('/api/scalper/bot/presets/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: presetId })
      });
      if (res.ok) {
        const data = await res.json();
        const found = presets.find(p => p.id === presetId);
        const presetName = found ? found.name : 'Preset';

        // Extract configuration for this specific strategy
        const stratCfg = data[strategyKey] ||
                         (data.strategy_configs && data.strategy_configs[strategyKey]) ||
                         data[strategyKey.toLowerCase()];

        if (stratCfg && onPresetApplied) {
          onPresetApplied(stratCfg);
        }
        if (triggerToast) {
          triggerToast(`✓ Loaded preset: ${presetName}`, 'success');
        }
      } else {
        if (triggerToast) triggerToast('Failed to apply preset', 'error');
      }
    } catch (e) {
      console.error('Error applying preset:', e);
      if (triggerToast) triggerToast('Error applying preset', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Save current settings as a new preset
  const handleSaveCurrentAsPreset = async (e) => {
    if (e) e.preventDefault();
    const name = presetNameInput.trim();
    if (!name) {
      if (triggerToast) triggerToast('Please enter a preset name', 'warn');
      return;
    }

    setSavingPreset(true);
    try {
      const res = await fetch('/api/scalper/bot/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          strategy: strategyKey,
          config: currentConfig
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.presets) {
          setPresets(data.presets);
        }
        if (data.preset?.id) {
          setSelectedPresetId(data.preset.id);
        }
        setShowSaveModal(false);
        setPresetNameInput('');
        if (triggerToast) triggerToast(`✓ Saved preset "${name}" to database!`, 'success');
      } else {
        if (triggerToast) triggerToast('Failed to save preset', 'error');
      }
    } catch (e) {
      console.error('Error saving preset:', e);
      if (triggerToast) triggerToast('Error saving preset', 'error');
    } finally {
      setSavingPreset(false);
    }
  };

  // Delete a custom preset
  const handleDeletePreset = async (presetId, e) => {
    if (e) e.stopPropagation();
    if (!presetId) return;
    if (!window.confirm('Delete this saved preset from the database?')) return;

    try {
      const res = await fetch(`/api/scalper/bot/presets/${presetId}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        if (data.presets) setPresets(data.presets);
        if (selectedPresetId === presetId) setSelectedPresetId('');
        if (triggerToast) triggerToast('Preset deleted', 'info');
      }
    } catch (e) {
      console.error('Error deleting preset:', e);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 10,
      background: 'rgba(13, 17, 23, 0.75)',
      padding: '8px 14px',
      borderRadius: 8,
      border: '1px solid rgba(48, 54, 61, 0.6)',
      fontSize: 12
    }}>
      {/* Left: Preset Selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: accentColor, fontWeight: 700 }}>
          <Bookmark size={14} />
          <span>Presets:</span>
        </div>

        <select
          value={selectedPresetId}
          onChange={(e) => handleApplyPreset(e.target.value)}
          disabled={loading}
          style={{
            background: '#161b22',
            border: `1px solid ${selectedPresetId ? accentColor : '#30363d'}`,
            color: '#f0f6fc',
            padding: '5px 10px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            minWidth: 200,
            outline: 'none'
          }}
        >
          <option value="" disabled>-- Select Database Preset --</option>
          {presets.map(p => (
            <option key={p.id} value={p.id}>
              {p.is_default ? '★ ' : '• '} {p.name} {p.is_default ? '(Default)' : ''}
            </option>
          ))}
        </select>

        {loading && (
          <span style={{ fontSize: 11, color: accentColor, display: 'flex', alignItems: 'center', gap: 4 }}>
            <RefreshCw size={11} className="animate-spin" /> Applying...
          </span>
        )}

        {/* Delete current selected preset button (if not default) */}
        {selectedPresetId && !presets.find(p => p.id === selectedPresetId)?.is_default && (
          <button
            onClick={(e) => handleDeletePreset(selectedPresetId, e)}
            style={{
              background: 'none',
              border: 'none',
              color: '#8b949e',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 4
            }}
            title="Delete this custom preset"
            onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
            onMouseLeave={e => e.currentTarget.style.color = '#8b949e'}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Right: Save Manual Settings Button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => {
            setPresetNameInput(`Manual Setup (${new Date().toLocaleDateString()})`);
            setShowSaveModal(true);
          }}
          style={{
            background: `rgba(255, 255, 255, 0.04)`,
            border: `1px solid ${accentColor}`,
            color: '#f0f6fc',
            padding: '5px 12px',
            borderRadius: 6,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontWeight: 700,
            fontSize: 11.5,
            transition: 'all 0.15s ease'
          }}
          title="Save current pairs, lots, and timeframes to database"
        >
          <Save size={13} color={accentColor} />
          <span>Save Manual Settings to DB</span>
        </button>
      </div>

      {/* Save Preset Modal */}
      {showSaveModal && (
        <div style={{
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
          zIndex: 9999
        }}>
          <div style={{
            background: '#0d1117',
            border: `1px solid ${accentColor}`,
            borderRadius: 12,
            padding: '20px 24px',
            width: 420,
            boxShadow: `0 0 30px rgba(0, 0, 0, 0.9)`,
            display: 'flex',
            flexDirection: 'column',
            gap: 14
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Bookmark size={16} color={accentColor} />
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#ffffff' }}>Save Preset to Database</h3>
              </div>
              <button
                onClick={() => setShowSaveModal(false)}
                style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </div>

            <p style={{ margin: 0, fontSize: 12, color: '#8b949e', lineHeight: 1.4 }}>
              This saves your current instruments, lot sizing, and multi-timeframe configurations permanently into your database.
            </p>

            <form onSubmit={handleSaveCurrentAsPreset} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#c9d1d9', display: 'block', marginBottom: 5 }}>
                  Preset Name:
                </label>
                <input
                  type="text"
                  autoFocus
                  value={presetNameInput}
                  onChange={(e) => setPresetNameInput(e.target.value)}
                  placeholder="e.g. High Volatility Gold, Multi-TF Swing, etc."
                  style={{
                    width: '100%',
                    background: '#161b22',
                    border: '1px solid #30363d',
                    borderRadius: 6,
                    padding: '8px 10px',
                    color: '#ffffff',
                    fontSize: 13,
                    boxSizing: 'border-box',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setShowSaveModal(false)}
                  style={{
                    background: '#21262d',
                    border: '1px solid #30363d',
                    color: '#c9d1d9',
                    padding: '6px 14px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 12
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPreset}
                  style={{
                    background: accentColor,
                    border: 'none',
                    color: '#ffffff',
                    padding: '6px 16px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 700,
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  {savingPreset ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                  <span>{savingPreset ? 'Saving...' : 'Save to DB'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
