import React, { useState } from 'react';
import { LayoutDashboard, CandlestickChart, BookOpen, Plus, X, Activity, Bell, Sliders, Zap, Settings, Layers, Target, Cpu } from 'lucide-react';

export default function TopTabBar({
  tabs = [],
  activeTabId,
  onSelectTab,
  onAddTab,
  onCloseTab,
  onReorderTab,
  accountInfo,
  unreadCount = 0,
  onToggleNotifications,
  onOpenScreener,
  onOpenNotificationSettings
}) {
  const [dragId, setDragId] = useState(null);
  return (
    <div className="top-tab-bar" style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      background: '#131722',
      borderBottom: '1px solid #2a2e39',
      padding: '0 8px',
      height: 38,
      userSelect: 'none',
      overflowX: 'auto',
      zIndex: 100
    }}>
      {/* LEFT: TABS LIST */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0, overflowX: 'auto' }}>
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId;
          let Icon = CandlestickChart;
          if (tab.type === 'dashboard') Icon = LayoutDashboard;
          else if (tab.type === 'journal') Icon = BookOpen;
          else if (tab.type === 'monte_carlo') Icon = Sliders;
          else if (tab.type === 'order_blocks') Icon = Layers;
          else if (tab.type === 'support_resistance') Icon = Target;
          else if (tab.type === 'neural_sentinel') Icon = Cpu;

          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              draggable
              onDragStart={() => setDragId(tab.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragId && dragId !== tab.id && onReorderTab) onReorderTab(dragId, tab.id); setDragId(null); }}
              onDragEnd={() => setDragId(null)}
              className={`workspace-tab ${isActive ? 'active' : ''}`}
              style={{
                opacity: dragId === tab.id ? 0.4 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '6px 12px',
                fontSize: 12.5,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? '#ffffff' : '#8b949e',
                background: isActive ? '#1e222d' : 'transparent',
                borderRadius: '6px 6px 0 0',
                borderTop: isActive ? '2px solid var(--brand, #2962ff)' : '2px solid transparent',
                borderLeft: isActive ? '1px solid #2a2e39' : '1px solid transparent',
                borderRight: isActive ? '1px solid #2a2e39' : '1px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
                position: 'relative'
              }}
            >
              <Icon size={14} color={isActive ? 'var(--brand, #2962ff)' : '#8b949e'} />
              <span>{tab.title}</span>

              {/* Close Tab Button (for custom added tabs) */}
              {tab.closable && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 2,
                    marginLeft: 4,
                    cursor: 'pointer',
                    color: '#6e7681',
                    borderRadius: 3,
                    display: 'flex',
                    alignItems: 'center'
                  }}
                  title="Close tab"
                  onMouseEnter={e => e.currentTarget.style.color = '#f23645'}
                  onMouseLeave={e => e.currentTarget.style.color = '#6e7681'}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}

        {/* ADD TAB BUTTON */}
        <button
          onClick={onAddTab}
          className="btn-icon"
          style={{
            height: 26,
            width: 26,
            marginLeft: 4,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 4,
            color: '#8b949e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
          title="Add New Chart Tab"
          onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'var(--brand, #2962ff)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#8b949e'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* RIGHT: BROKER ACCOUNT STATUS PILL & QUICK TOOLS */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 12 }}>
        {/* Market Screener quick button */}
        {onOpenScreener && (
          <button
            onClick={onOpenScreener}
            title="Open Market Screener"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              background: 'rgba(41, 98, 255, 0.12)',
              border: '1px solid rgba(41, 98, 255, 0.3)',
              borderRadius: 4,
              padding: '3px 8px',
              color: '#2962ff',
              fontSize: 11.5,
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            <Zap size={13} />
            <span>Screener</span>
          </button>
        )}

        {/* Discord / Push Notifications Settings */}
        {onOpenNotificationSettings && (
          <button
            onClick={onOpenNotificationSettings}
            title="Notification channels (Discord & Desktop)"
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
            <Settings size={15} />
          </button>
        )}

        {/* Signal notifications bell */}
        <button
          onClick={onToggleNotifications}
          title="Signal notifications"
          style={{ position: 'relative', background: 'none', border: 'none', color: unreadCount > 0 ? '#f7a600' : '#8b949e', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
        >
          <Bell size={17} />
          {unreadCount > 0 && (
            <span style={{ position: 'absolute', top: -2, right: -3, minWidth: 15, height: 15, padding: '0 3px', borderRadius: 8, background: '#f23645', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        {accountInfo ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            background: '#131722',
            padding: '4px 10px',
            borderRadius: 5,
            border: '1px solid #2a2e39'
          }}>
            {/* Live Indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: accountInfo.connected ? '#089981' : '#f23645',
                boxShadow: accountInfo.connected ? '0 0 8px #089981' : 'none',
                display: 'inline-block'
              }} />
              <span style={{ color: '#d1d4dc', fontWeight: 600, fontSize: 11.5 }}>
                {accountInfo.company || 'MT5'} ({accountInfo.server || 'Real'})
              </span>
            </div>

            <div style={{ width: 1, height: 14, background: '#2a2e39' }} />

            {/* Account Login */}
            <span style={{ color: '#8b949e', fontSize: 11.5 }}>
              #{accountInfo.login}
            </span>

            <div style={{ width: 1, height: 14, background: '#2a2e39' }} />

            {/* Equity */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: '#8b949e', fontSize: 11 }}>Eq:</span>
              <span style={{
                color: (accountInfo.profit || 0) >= 0 ? '#089981' : '#f23645',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums'
              }}>
                {(accountInfo.equity || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {accountInfo.currency || 'USD'}
              </span>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: '#8b949e', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Activity size={13} className="animate-spin" /> Connecting MT5...
          </div>
        )}
      </div>
    </div>
  );
}
