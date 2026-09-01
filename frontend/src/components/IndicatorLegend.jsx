import React, { useState } from 'react';
import { Eye, EyeOff, Settings, X, MoreHorizontal, Check } from 'lucide-react';

export default function IndicatorLegend({
  indicators = [],
  onToggleVisibility,
  onOpenSettings,
  onRemoveIndicator
}) {
  const [hoveredId, setHoveredId] = useState(null);

  if (!indicators || indicators.length === 0) return null;

  return (
    <div 
      className="indicator-legend"
      style={{
        position: 'absolute',
        top: 12,
        left: 14,
        zIndex: 45,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        pointerEvents: 'auto',
        maxWidth: '85%'
      }}
    >
      {indicators.map((ind) => {
        const isHovered = hoveredId === ind.instanceId;
        const isHidden = ind.visible === false;
        
        // Extract display text with parameters
        let paramsText = '';
        if (ind.id === 'EMA' || ind.id === 'MA' || ind.id === 'SMA') {
          const p1 = ind.params?.p1 ?? 9;
          const p2 = ind.params?.p2 ?? 21;
          const p3 = ind.params?.p3 ?? 50;
          const p4 = ind.params?.p4 ?? 200;
          paramsText = `(${p1}, ${p2}, ${p3}, ${p4})`;
        } else if (ind.id === 'BOLL') {
          paramsText = `(${ind.params?.length ?? 20}, ${ind.params?.multiplier ?? 2})`;
        } else if (ind.id === 'SAR') {
          paramsText = `(${ind.params?.step ?? 0.02}, ${ind.params?.max ?? 0.2})`;
        } else if (ind.id === 'SUPERTREND') {
          paramsText = `(${ind.params?.period ?? 10}, ${ind.params?.multiplier ?? 3})`;
        } else if (ind.id === 'RSI') {
          paramsText = `(${ind.params?.period ?? 14})`;
        } else if (ind.id === 'MACD') {
          paramsText = `(${ind.params?.fast ?? 12}, ${ind.params?.slow ?? 26}, ${ind.params?.signal ?? 9})`;
        } else if (ind.id === 'SIGNALS') {
          paramsText = `(${ind.params?.strategy || 'Dual Engine'})`;
        }

        const primaryColor = ind.styles?.lines?.[0]?.color || '#2962ff';

        return (
          <div
            key={ind.instanceId}
            onMouseEnter={() => setHoveredId(ind.instanceId)}
            onMouseLeave={() => setHoveredId(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              background: isHovered ? 'rgba(19, 23, 34, 0.95)' : 'rgba(19, 23, 34, 0.75)',
              backdropFilter: 'blur(6px)',
              border: `1px solid ${isHovered ? 'var(--border-focus, #363c4e)' : 'rgba(42, 46, 57, 0.6)'}`,
              borderRadius: 4,
              padding: '2px 8px',
              gap: 8,
              fontSize: 12,
              color: isHidden ? 'var(--text-muted)' : 'var(--text)',
              opacity: isHidden ? 0.65 : 1,
              transition: 'all 0.15s ease',
              width: 'fit-content'
            }}
          >
            {/* Color Dot */}
            <span 
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: isHidden ? '#787b86' : primaryColor,
                display: 'inline-block',
                flexShrink: 0
              }}
            />

            {/* Title & Params */}
            <span style={{ 
              fontWeight: 600, 
              color: isHidden ? 'var(--text-muted)' : 'var(--text)',
              textDecoration: isHidden ? 'line-through' : 'none',
              cursor: 'pointer'
            }}
            onClick={() => onOpenSettings(ind)}
            >
              {ind.name || ind.shortName || ind.id} <span style={{ fontWeight: 400, opacity: 0.85, fontSize: 11 }}>{paramsText}</span>
            </span>

            {/* Quick Action Icons (Eye, Gear, X) */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 4, 
              marginLeft: 4,
              opacity: isHovered || isHidden ? 1 : 0.4,
              transition: 'opacity 0.15s ease'
            }}>
              {/* Visibility Toggle */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisibility(ind.instanceId);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: isHidden ? '#f7a600' : 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  borderRadius: 3
                }}
                title={isHidden ? 'Show Indicator' : 'Hide Indicator'}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
                onMouseLeave={e => e.currentTarget.style.color = isHidden ? '#f7a600' : 'var(--text-muted)'}
              >
                {isHidden ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>

              {/* Settings Gear */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenSettings(ind);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  borderRadius: 3
                }}
                title="Indicator Settings"
                onMouseEnter={e => e.currentTarget.style.color = 'var(--brand)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                <Settings size={13} />
              </button>

              {/* Remove X */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveIndicator(ind.instanceId);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  borderRadius: 3
                }}
                title="Remove Indicator"
                onMouseEnter={e => e.currentTarget.style.color = '#f23645'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
