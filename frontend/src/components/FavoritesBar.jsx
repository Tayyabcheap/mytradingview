import React from 'react';
import { GripVertical, Trash2 } from 'lucide-react';

const FAVORITE_TOOLS = [
  { id: 'segment', name: 'Trendline', icon: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <line x1="4" y1="20" x2="20" y2="4"></line><circle cx="4" cy="20" r="2"></circle><circle cx="20" cy="4" r="2"></circle>
    </svg>
  )},
  { id: 'fibonacciLine', name: 'Fib Retracement', icon: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <line x1="4" y1="6" x2="20" y2="6"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="18" x2="20" y2="18"></line>
    </svg>
  )},
  { id: 'rect', name: 'Rectangle', icon: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
    </svg>
  )},
  { id: 'longPosition', name: 'Long Position', icon: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="#089981" strokeWidth="2" fill="none">
      <rect x="4" y="4" width="16" height="8" stroke="#089981" fill="rgba(8,153,129,0.3)"></rect>
      <rect x="4" y="12" width="16" height="8" stroke="#f23645" fill="rgba(242,54,69,0.3)"></rect>
    </svg>
  )},
  { id: 'shortPosition', name: 'Short Position', icon: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="#f23645" strokeWidth="2" fill="none">
      <rect x="4" y="4" width="16" height="8" stroke="#f23645" fill="rgba(242,54,69,0.3)"></rect>
      <rect x="4" y="12" width="16" height="8" stroke="#089981" fill="rgba(8,153,129,0.3)"></rect>
    </svg>
  )},
  { id: 'simpleAnnotation', name: 'Text', icon: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line>
    </svg>
  )}
];

export default function FavoritesBar({ onSelectTool, onClearAll }) {
  return (
    <div style={{
      position: 'absolute',
      bottom: 40,
      left: 70,
      zIndex: 50,
      background: '#1e222d',
      border: '1px solid #2a2e39',
      borderRadius: 6,
      boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
      display: 'flex',
      alignItems: 'center',
      padding: '2px 6px',
      gap: 2
    }}>
      <div style={{ color: '#787b86', cursor: 'grab', display: 'flex', alignItems: 'center', padding: '0 2px' }}>
        <GripVertical size={14} />
      </div>

      {FAVORITE_TOOLS.map(tool => (
        <button
          key={tool.id}
          onClick={() => onSelectTool(tool.id)}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#d1d4dc',
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
            cursor: 'pointer',
            transition: 'background 0.15s ease'
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#2a2e39'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          title={tool.name}
        >
          {tool.icon}
        </button>
      ))}

      <div style={{ width: 1, height: 18, background: '#2a2e39', margin: '0 4px' }} />

      <button
        onClick={onClearAll}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#787b86',
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 4,
          cursor: 'pointer'
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#2a2e39'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        title="Remove All Drawings"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}
