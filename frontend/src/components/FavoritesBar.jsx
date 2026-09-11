import React, { useState, useEffect, useRef } from 'react';
import { GripVertical, Trash2 } from 'lucide-react';

// Master icon renderer for all KLine drawing tools
export const TOOL_ICONS = {
  segment: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <line x1="4" y1="20" x2="20" y2="4"></line><circle cx="4" cy="20" r="2"></circle><circle cx="20" cy="4" r="2"></circle>
    </svg>
  ),
  rayLine: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <line x1="4" y1="20" x2="20" y2="4"></line><circle cx="4" cy="20" r="2"></circle><path d="M16 4l4 0l0 4"></path>
    </svg>
  ),
  straightLine: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <line x1="2" y1="22" x2="22" y2="2"></line>
    </svg>
  ),
  horizontalStraightLine: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <line x1="2" y1="12" x2="22" y2="12"></line>
    </svg>
  ),
  horizontalRayLine: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <line x1="8" y1="12" x2="22" y2="12"></line><circle cx="8" cy="12" r="2"></circle>
    </svg>
  ),
  horizontalSegment: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <line x1="4" y1="12" x2="20" y2="12"></line><circle cx="4" cy="12" r="2"></circle><circle cx="20" cy="12" r="2"></circle>
    </svg>
  ),
  verticalStraightLine: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <line x1="12" y1="2" x2="12" y2="22"></line>
    </svg>
  ),
  priceLine: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="3 2">
      <line x1="2" y1="12" x2="22" y2="12"></line>
    </svg>
  ),
  priceChannelLine: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <line x1="4" y1="16" x2="20" y2="6"></line><line x1="4" y1="20" x2="20" y2="10"></line>
    </svg>
  ),
  parallelStraightLine: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <line x1="3" y1="17" x2="21" y2="7"></line><line x1="3" y1="13" x2="21" y2="3" strokeDasharray="2 2"></line>
    </svg>
  ),
  fibonacciLine: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <line x1="4" y1="6" x2="20" y2="6"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="18" x2="20" y2="18"></line>
    </svg>
  ),
  rect: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
    </svg>
  ),
  circle: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <circle cx="12" cy="12" r="9"></circle>
    </svg>
  ),
  polygon: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <polygon points="12,3 21,9 18,20 6,20 3,9"></polygon>
    </svg>
  ),
  brush: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <path d="M4 18 c4 -12 10 -2 16 -6"></path>
    </svg>
  ),
  longPosition: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="#089981" strokeWidth="2" fill="none">
      <rect x="4" y="4" width="16" height="8" stroke="#089981" fill="rgba(8,153,129,0.35)"></rect>
      <rect x="4" y="12" width="16" height="8" stroke="#f23645" fill="rgba(242,54,69,0.35)"></rect>
    </svg>
  ),
  shortPosition: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="#f23645" strokeWidth="2" fill="none">
      <rect x="4" y="4" width="16" height="8" stroke="#f23645" fill="rgba(242,54,69,0.35)"></rect>
      <rect x="4" y="12" width="16" height="8" stroke="#089981" fill="rgba(8,153,129,0.35)"></rect>
    </svg>
  ),
  simpleAnnotation: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line>
    </svg>
  ),
  measure: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <rect x="3" y="6" width="18" height="12" rx="1"></rect><line x1="8" y1="6" x2="8" y2="18"></line><line x1="13" y1="6" x2="13" y2="18"></line>
    </svg>
  ),
  xabcd: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <polyline points="3 17 8 7 13 17 18 7 22 17"></polyline>
    </svg>
  ),
  fiveWaves: (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <polyline points="3 17 7 9 11 13 15 5 19 11"></polyline>
    </svg>
  )
};

export const TOOL_NAMES = {
  segment: 'Trendline',
  rayLine: 'Ray',
  straightLine: 'Extended line',
  horizontalStraightLine: 'Horizontal line',
  horizontalRayLine: 'Horizontal ray',
  horizontalSegment: 'Horizontal segment',
  verticalStraightLine: 'Vertical line',
  priceLine: 'Price line',
  priceChannelLine: 'Parallel channel',
  parallelStraightLine: 'Regression trend',
  fibonacciLine: 'Fib retracement',
  rect: 'Rectangle',
  circle: 'Circle',
  polygon: 'Polygon',
  brush: 'Brush',
  longPosition: 'Long Position',
  shortPosition: 'Short Position',
  simpleAnnotation: 'Text',
  measure: 'Date & Price range',
  xabcd: 'XABCD Pattern',
  fiveWaves: 'Elliott Impulse'
};

export default function FavoritesBar({ 
  favoriteToolIds = ['segment', 'horizontalStraightLine', 'rect', 'longPosition', 'shortPosition', 'simpleAnnotation'], 
  onSelectTool, 
  onClearAll 
}) {
  const [pos, setPos] = useState(() => {
    try {
      const saved = localStorage.getItem('twr_fav_bar_pos');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          return parsed;
        }
      }
    } catch (e) {}
    return { x: 70, y: typeof window !== 'undefined' ? window.innerHeight - 100 : 600 };
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const barRef = useRef(null);

  // Drag listeners
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      const newX = Math.max(10, Math.min(window.innerWidth - 120, e.clientX - dragOffsetRef.current.x));
      const newY = Math.max(40, Math.min(window.innerHeight - 60, e.clientY - dragOffsetRef.current.y));
      setPos({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        try {
          localStorage.setItem('twr_fav_bar_pos', JSON.stringify(pos));
        } catch (e) {}
      }
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, pos]);

  const handleMouseDown = (e) => {
    // Only start drag from the grip handle or background
    if (e.target.closest('button')) return;
    setIsDragging(true);
    dragOffsetRef.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y
    };
    e.preventDefault();
  };

  // If no tools favorited, hide or show minimal hint
  if (!favoriteToolIds || favoriteToolIds.length === 0) {
    return null;
  }

  return (
    <div
      ref={barRef}
      onMouseDown={handleMouseDown}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 999,
        background: '#1e222d',
        border: '1px solid #2a2e39',
        borderRadius: 6,
        boxShadow: isDragging ? '0 12px 36px rgba(0,0,0,0.85), 0 0 0 1px rgba(41,98,255,0.4)' : '0 6px 20px rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        padding: '2px 6px',
        gap: 2,
        userSelect: 'none',
        cursor: isDragging ? 'grabbing' : 'default',
        transition: isDragging ? 'none' : 'box-shadow 0.15s ease'
      }}
    >
      {/* DRAG HANDLE */}
      <div 
        style={{ 
          color: isDragging ? 'var(--brand, #2962ff)' : '#787b86', 
          cursor: isDragging ? 'grabbing' : 'grab', 
          display: 'flex', 
          alignItems: 'center', 
          padding: '0 3px' 
        }}
        title="Drag to reposition toolbar"
      >
        <GripVertical size={14} />
      </div>

      {/* DYNAMIC FAVORITED TOOLS */}
      {favoriteToolIds.map(toolId => {
        const icon = TOOL_ICONS[toolId] || TOOL_ICONS.segment;
        const name = TOOL_NAMES[toolId] || toolId;

        return (
          <button
            key={toolId}
            onClick={() => onSelectTool && onSelectTool(toolId)}
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
            title={name}
          >
            {icon}
          </button>
        );
      })}

      <div style={{ width: 1, height: 18, background: '#2a2e39', margin: '0 4px' }} />

      {/* CLEAR ALL DRAWINGS */}
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
        onMouseEnter={e => { e.currentTarget.style.background = '#2a2e39'; e.currentTarget.style.color = '#f23645'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#787b86'; }}
        title="Remove All Drawings"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}
