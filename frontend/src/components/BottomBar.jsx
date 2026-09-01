import React, { useState } from 'react';
import { Globe, Clock } from 'lucide-react';

const RANGES = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'ALL'];

export default function BottomBar({ onSelectRange, activeRange = '1M', timezone = 'UTC' }) {
  const [isLog, setIsLog] = useState(false);
  const [isAuto, setIsAuto] = useState(true);

  return (
    <div style={{
      height: 32,
      background: '#131722',
      borderTop: '1px solid #2a2e39',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 12px',
      fontSize: 11,
      color: '#787b86',
      userSelect: 'none'
    }}>
      {/* Range Quick Selectors */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {RANGES.map(range => (
          <button
            key={range}
            onClick={() => onSelectRange && onSelectRange(range)}
            style={{
              background: activeRange === range ? 'rgba(41, 98, 255, 0.15)' : 'transparent',
              color: activeRange === range ? '#2962ff' : '#787b86',
              border: 'none',
              borderRadius: 3,
              padding: '3px 8px',
              fontSize: 11,
              fontWeight: activeRange === range ? 700 : 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => {
              if (activeRange !== range) e.currentTarget.style.color = '#d1d4dc';
            }}
            onMouseLeave={e => {
              if (activeRange !== range) e.currentTarget.style.color = '#787b86';
            }}
          >
            {range}
          </button>
        ))}
      </div>

      {/* Right Controls: Timezone + Log / Auto */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Timezone Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <Clock size={12} />
          <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({timezone})</span>
        </div>

        <div style={{ width: 1, height: 14, background: '#2a2e39' }} />

        {/* Auto / Log toggle */}
        <button
          onClick={() => setIsLog(!isLog)}
          style={{
            background: 'none',
            border: 'none',
            color: isLog ? '#2962ff' : '#787b86',
            fontWeight: 700,
            fontSize: 11,
            cursor: 'pointer'
          }}
          title="Toggle Logarithmic Scale"
        >
          log
        </button>

        <button
          onClick={() => setIsAuto(!isAuto)}
          style={{
            background: 'none',
            border: 'none',
            color: isAuto ? '#2962ff' : '#787b86',
            fontWeight: 700,
            fontSize: 11,
            cursor: 'pointer'
          }}
          title="Toggle Auto Scale"
        >
          auto
        </button>
      </div>
    </div>
  );
}
