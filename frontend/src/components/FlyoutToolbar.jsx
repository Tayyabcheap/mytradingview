import React, { useState, useRef, useEffect } from 'react';
import { 
  TrendingUp, Trash2, Lock, Eye, Magnet, Star, 
  ChevronRight, ArrowRight, Minus, Move 
} from 'lucide-react';

const ICONS = {
  cursor: (
    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none">
      <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L5.5 3.21z"></path>
    </svg>
  ),
  lines: (
    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none">
      <line x1="4" y1="20" x2="20" y2="4"></line><circle cx="4" cy="20" r="2"></circle><circle cx="20" cy="4" r="2"></circle>
    </svg>
  ),
  fib: (
    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none">
      <line x1="4" y1="6" x2="20" y2="6"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="18" x2="20" y2="18"></line>
    </svg>
  ),
  shapes: (
    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none">
      <rect x="4" y="6" width="16" height="12" rx="1"></rect>
    </svg>
  ),
  patterns: (
    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none">
      <polyline points="3 17 8 7 13 17 18 7 22 17"></polyline>
    </svg>
  ),
  forecasting: (
    <svg viewBox="0 0 24 24" width="18" height="18" stroke="#089981" strokeWidth="2" fill="none">
      <rect x="4" y="4" width="16" height="8" stroke="#089981" fill="rgba(8,153,129,0.2)"></rect>
      <rect x="4" y="12" width="16" height="8" stroke="#f23645" fill="rgba(242,54,69,0.2)"></rect>
    </svg>
  ),
  text: (
    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none">
      <polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line>
    </svg>
  ),
  measure: (
    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none">
      <path d="M3 8h18v8H3z"></path><line x1="7" y1="8" x2="7" y2="12"></line><line x1="11" y1="8" x2="11" y2="12"></line><line x1="15" y1="8" x2="15" y2="12"></line>
    </svg>
  )
};

// Only tools that map to a REAL, distinct KLineCharts overlay are listed.
// (Removed the aliased placeholders that previously pretended Gann / Cypher /
//  Fib-channel / Measurer tools existed by pointing them at rect/xabcd/etc.)
const TOOL_GROUPS = [
  {
    id: 'cursor', icon: ICONS.cursor, defaultTool: 'cursor',
    sections: [
      { title: 'CURSOR', tools: [
        { id: 'cursor', name: 'Crosshair', shortcut: 'Ctrl + C' }
      ]}
    ]
  },
  {
    id: 'lines', icon: ICONS.lines, defaultTool: 'segment',
    sections: [
      { title: 'LINES', tools: [
        { id: 'segment', name: 'Trendline', shortcut: 'Alt + T', favorite: true },
        { id: 'rayLine', name: 'Ray' },
        { id: 'straightLine', name: 'Extended line' },
        { id: 'horizontalStraightLine', name: 'Horizontal line', shortcut: 'Alt + H' },
        { id: 'horizontalRayLine', name: 'Horizontal ray', shortcut: 'Alt + J' },
        { id: 'horizontalSegment', name: 'Horizontal segment' },
        { id: 'verticalStraightLine', name: 'Vertical line', shortcut: 'Alt + V' },
        { id: 'verticalRayLine', name: 'Vertical ray' },
        { id: 'verticalSegment', name: 'Vertical segment' },
        { id: 'priceLine', name: 'Price line' }
      ]},
      { title: 'CHANNELS', tools: [
        { id: 'priceChannelLine', name: 'Parallel channel' },
        { id: 'parallelStraightLine', name: 'Regression trend' }
      ]}
    ]
  },
  {
    id: 'fib', icon: ICONS.fib, defaultTool: 'fibonacciLine',
    sections: [
      { title: 'FIBONACCI', tools: [
        { id: 'fibonacciLine', name: 'Fib retracement', shortcut: 'Alt + F', favorite: true }
      ]}
    ]
  },
  {
    id: 'shapes', icon: ICONS.shapes, defaultTool: 'rect',
    sections: [
      { title: 'SHAPES', tools: [
        { id: 'rect', name: 'Rectangle', shortcut: 'Alt + Shift + R', favorite: true },
        { id: 'circle', name: 'Circle' },
        { id: 'polygon', name: 'Polygon' },
        { id: 'arc', name: 'Arc' },
        { id: 'path', name: 'Path' },
        { id: 'brush', name: 'Brush' }
      ]}
    ]
  },
  {
    id: 'measure', icon: ICONS.measure, defaultTool: 'measure',
    sections: [
      { title: 'MEASURERS', tools: [
        { id: 'measure', name: 'Date and price range', favorite: true },
        { id: 'measurePrice', name: 'Price range' },
        { id: 'measureDate', name: 'Date range' }
      ]}
    ]
  },
  {
    id: 'patterns', icon: ICONS.patterns, defaultTool: 'xabcd',
    sections: [
      { title: 'CHART PATTERNS', tools: [
        { id: 'xabcd', name: 'XABCD pattern', favorite: true },
        { id: 'headAndShoulders', name: 'Head and shoulders' }
      ]},
      { title: 'ELLIOTT WAVES', tools: [
        { id: 'fiveWaves', name: 'Elliott impulse (1-2-3-4-5)', favorite: true },
        { id: 'threeWaves', name: 'Elliott correction (A-B-C)' }
      ]}
    ]
  },
  {
    id: 'forecasting', icon: ICONS.forecasting, defaultTool: 'longPosition',
    sections: [
      { title: 'FORECASTING', tools: [
        { id: 'longPosition', name: 'Long position', favorite: true },
        { id: 'shortPosition', name: 'Short position', favorite: true }
      ]}
    ]
  },
  {
    id: 'text', icon: ICONS.text, defaultTool: 'simpleAnnotation',
    sections: [
      { title: 'TEXT', tools: [
        { id: 'simpleAnnotation', name: 'Text', favorite: true },
        { id: 'simpleTag', name: 'Tag / marker' }
      ]}
    ]
  }
];

// Small sample-line preview so users see what each tool draws (TradingView-style)
function toolPreview(id) {
  const st = { stroke: '#d1d4dc', strokeWidth: 1.5, fill: 'none' };
  const P = (children) => (
    <svg width="26" height="16" viewBox="0 0 26 16" style={{ flexShrink: 0, opacity: 0.85 }}>{children}</svg>
  );
  switch (id) {
    case 'segment': return P(<line x1="3" y1="13" x2="23" y2="3" {...st} />);
    case 'rayLine': return P(<><line x1="4" y1="13" x2="23" y2="3" {...st} /><circle cx="4" cy="13" r="1.8" fill="#d1d4dc" /></>);
    case 'straightLine': return P(<line x1="2" y1="13" x2="24" y2="3" {...st} strokeDasharray="1 0" />);
    case 'horizontalStraightLine': return P(<line x1="2" y1="8" x2="24" y2="8" {...st} />);
    case 'horizontalRayLine': return P(<><line x1="5" y1="8" x2="24" y2="8" {...st} /><circle cx="5" cy="8" r="1.8" fill="#d1d4dc" /></>);
    case 'verticalStraightLine': return P(<line x1="13" y1="2" x2="13" y2="14" {...st} />);
    case 'priceLine': return P(<line x1="2" y1="8" x2="24" y2="8" {...st} strokeDasharray="3 2" />);
    case 'priceChannelLine': return P(<><line x1="2" y1="11" x2="24" y2="4" {...st} /><line x1="2" y1="14" x2="24" y2="7" {...st} /></>);
    case 'parallelStraightLine': return P(<><line x1="2" y1="12" x2="24" y2="5" {...st} /><line x1="2" y1="9" x2="24" y2="2" {...st} strokeDasharray="2 2" /></>);
    case 'fibonacciLine': return P(<><line x1="2" y1="3" x2="24" y2="3" {...st} /><line x1="2" y1="8" x2="24" y2="8" {...st} /><line x1="2" y1="13" x2="24" y2="13" {...st} /></>);
    case 'rect': return P(<rect x="4" y="3" width="18" height="10" {...st} />);
    case 'circle': return P(<circle cx="13" cy="8" r="6" {...st} />);
    case 'polygon': return P(<polygon points="13,2 22,7 18,14 8,14 4,7" {...st} />);
    case 'arc': return P(<path d="M3 13 A10 10 0 0 1 23 13" {...st} />);
    case 'path': return P(<polyline points="3,13 8,5 14,10 21,3" {...st} />);
    case 'brush': return P(<path d="M3 12 q4 -10 8 -2 t8 -3" {...st} />);
    case 'horizontalSegment': return P(<><line x1="5" y1="8" x2="21" y2="8" {...st} /><circle cx="5" cy="8" r="1.6" fill="#d1d4dc" /><circle cx="21" cy="8" r="1.6" fill="#d1d4dc" /></>);
    case 'verticalRayLine': return P(<><line x1="13" y1="3" x2="13" y2="14" {...st} /><circle cx="13" cy="3" r="1.6" fill="#d1d4dc" /></>);
    case 'verticalSegment': return P(<><line x1="13" y1="3" x2="13" y2="13" {...st} /><circle cx="13" cy="3" r="1.6" fill="#d1d4dc" /><circle cx="13" cy="13" r="1.6" fill="#d1d4dc" /></>);
    case 'measure': return P(<><rect x="4" y="4" width="18" height="8" {...st} /><line x1="8" y1="4" x2="8" y2="12" {...st} strokeWidth="1" /><line x1="13" y1="4" x2="13" y2="12" {...st} strokeWidth="1" /><line x1="18" y1="4" x2="18" y2="12" {...st} strokeWidth="1" /></>);
    case 'measurePrice': return P(<><line x1="13" y1="3" x2="13" y2="13" {...st} /><line x1="10" y1="3" x2="16" y2="3" {...st} /><line x1="10" y1="13" x2="16" y2="13" {...st} /></>);
    case 'measureDate': return P(<><line x1="3" y1="8" x2="23" y2="8" {...st} /><line x1="3" y1="5" x2="3" y2="11" {...st} /><line x1="23" y1="5" x2="23" y2="11" {...st} /></>);
    case 'xabcd': return P(<polyline points="3,13 8,4 13,11 18,3 23,10" {...st} />);
    case 'headAndShoulders': return P(<polyline points="2,12 6,8 9,11 13,3 17,11 20,8 24,12" {...st} />);
    case 'fiveWaves': return P(<polyline points="3,13 7,7 10,10 14,4 17,8 23,2" {...st} />);
    case 'threeWaves': return P(<polyline points="3,12 9,5 15,10 22,4" {...st} />);
    case 'longPosition': return P(<><rect x="4" y="3" width="18" height="4.5" fill="rgba(8,153,129,0.5)" /><rect x="4" y="8" width="18" height="4.5" fill="rgba(242,54,69,0.5)" /></>);
    case 'shortPosition': return P(<><rect x="4" y="3" width="18" height="4.5" fill="rgba(242,54,69,0.5)" /><rect x="4" y="8" width="18" height="4.5" fill="rgba(8,153,129,0.5)" /></>);
    case 'simpleAnnotation': return P(<text x="9" y="12" fontSize="11" fill="#d1d4dc" fontWeight="700">T</text>);
    case 'simpleTag': return P(<><path d="M4 5 h10 l4 3 -4 3 h-10 z" {...st} /></>);
    case 'cursor': return P(<><line x1="13" y1="2" x2="13" y2="14" {...st} strokeWidth="1" /><line x1="2" y1="8" x2="24" y2="8" {...st} strokeWidth="1" /></>);
    default: return P(<line x1="3" y1="13" x2="23" y2="3" {...st} />);
  }
}

export default function FlyoutToolbar({ onSelectTool, onClearAll }) {
  const [activeFlyout, setActiveFlyout] = useState(null);
  const [activeGroup, setActiveGroup] = useState('cursor');
  const [selectedTools, setSelectedTools] = useState({
    cursor: 'cursor',
    lines: 'segment',
    fib: 'fibonacciLine',
    shapes: 'brush',
    measure: 'measure',
    patterns: 'xabcd',
    forecasting: 'longPosition',
    text: 'simpleAnnotation'
  });
  const [magnet, setMagnet] = useState(false);
  const [lockAll, setLockAll] = useState(false);
  const [hideAll, setHideAll] = useState(false);

  const toolbarRef = useRef(null);

  // Close flyout on outside click
  useEffect(() => {
    const handleOutside = (e) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target)) {
        setActiveFlyout(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const handleToolClick = (group, toolId) => {
    setSelectedTools(prev => ({ ...prev, [group.id]: toolId }));
    setActiveGroup(group.id);
    setActiveFlyout(null);
    onSelectTool(toolId);
  };

  const toggleFlyout = (groupId, e) => {
    e.stopPropagation();
    setActiveFlyout(prev => prev === groupId ? null : groupId);
  };

  return (
    <div 
      ref={toolbarRef}
      className="left-toolbar" 
      style={{ 
        position: 'relative', 
        width: 52, 
        zIndex: 100, 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center',
        padding: '6px 0',
        gap: 4,
        background: '#131722',
        borderRight: '1px solid #2a2e39'
      }}
    >
      {TOOL_GROUPS.map((group) => {
        const isOpen = activeFlyout === group.id;
        const isCurrentGroup = activeGroup === group.id;

        return (
          <div key={group.id} style={{ position: 'relative', width: 44, height: 38 }}>
            <div 
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                height: '100%',
                borderRadius: 4,
                background: isOpen || isCurrentGroup ? '#2a2e39' : 'transparent',
                transition: 'background 0.15s ease'
              }}
            >
              {/* Main Button (Activates Current Selected Tool) */}
              <button
                style={{
                  flex: 1,
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'none',
                  border: 'none',
                  color: isCurrentGroup ? '#2962ff' : '#d1d4dc',
                  cursor: 'pointer',
                  padding: 0
                }}
                onClick={() => {
                  const currentTool = selectedTools[group.id] || group.defaultTool;
                  setActiveGroup(group.id);
                  onSelectTool(currentTool);
                }}
                title={group.id.toUpperCase()}
              >
                {group.icon}
              </button>

              {/* Dedicated Arrow Button (Reliably opens/closes Flyout) */}
              <button
                onClick={(e) => toggleFlyout(group.id, e)}
                style={{
                  width: 14,
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  color: isOpen ? '#2962ff' : '#787b86'
                }}
                title="More Tools"
              >
                <div style={{
                  width: 0,
                  height: 0,
                  borderTop: '3px solid transparent',
                  borderBottom: '3px solid transparent',
                  borderLeft: `4px solid ${isOpen ? '#2962ff' : '#787b86'}`
                }} />
              </button>
            </div>

            {/* FLYOUT POPUP MENU */}
            {isOpen && (
              <div
                style={{
                  position: 'absolute',
                  left: 48,
                  top: 0,
                  background: '#1e222d',
                  border: '1px solid #2a2e39',
                  borderRadius: 6,
                  boxShadow: '0 8px 30px rgba(0,0,0,0.8)',
                  width: 270,
                  zIndex: 99999,
                  padding: '6px 0',
                  maxHeight: '85vh',
                  overflowY: 'auto'
                }}
              >
                {group.sections.map((sec, sIdx) => (
                  <div key={sIdx}>
                    <div style={{
                      padding: '8px 16px 4px 16px',
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#787b86',
                      letterSpacing: 0.5
                    }}>
                      {sec.title}
                    </div>

                    {sec.tools.map((t, tIdx) => {
                      const isSelected = selectedTools[group.id] === t.id;
                      return (
                        <div
                          key={tIdx}
                          onClick={() => handleToolClick(group, t.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 16px',
                            cursor: 'pointer',
                            fontSize: 13,
                            color: isSelected ? '#2962ff' : '#d1d4dc',
                            background: isSelected ? 'rgba(41, 98, 255, 0.15)' : 'transparent',
                            transition: 'background 0.15s ease'
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) e.currentTarget.style.background = '#2a2e39';
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {toolPreview(t.id)}
                            <span style={{ fontWeight: isSelected ? 600 : 400 }}>{t.name}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {t.shortcut && (
                              <span style={{ fontSize: 11, color: '#787b86' }}>
                                {t.shortcut}
                              </span>
                            )}
                            {t.favorite && (
                              <Star size={14} fill="#f7a600" color="#f7a600" />
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {sIdx < group.sections.length - 1 && (
                      <div style={{ height: 1, background: '#2a2e39', margin: '6px 0' }} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ width: 32, height: 1, background: '#2a2e39', margin: '4px 0' }} />

      {/* Bottom Utility Tools */}
      <button 
        className="btn-icon" 
        onClick={() => setMagnet(!magnet)}
        title="Magnet Mode"
        style={{ color: magnet ? '#2962ff' : '#787b86' }}
      >
        <Magnet size={18} />
      </button>

      <button 
        className="btn-icon" 
        onClick={() => setLockAll(!lockAll)}
        title="Lock All Drawing Tools"
        style={{ color: lockAll ? '#f7a600' : '#787b86' }}
      >
        <Lock size={18} />
      </button>

      <button 
        className="btn-icon" 
        onClick={() => setHideAll(!hideAll)}
        title="Hide All Drawings"
        style={{ color: hideAll ? '#f23645' : '#787b86' }}
      >
        <Eye size={18} />
      </button>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 4 }}>
        <button 
          className="btn-icon" 
          onClick={onClearAll} 
          title="Remove All Drawings"
        >
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  );
}
