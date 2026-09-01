import React, { useState } from 'react';
import { Bell, Plus, Trash2, Volume2, AlertTriangle, CheckCircle, Clock } from 'lucide-react';

export default function AlertsPanel({ currentSymbol, currentPrice, alerts, setAlerts, alertLogs }) {
  const [showCreate, setShowCreate] = useState(false);
  const [targetPrice, setTargetPrice] = useState(currentPrice || '');
  const [condition, setCondition] = useState('crossing');
  const [message, setMessage] = useState('');
  const [alertName, setAlertName] = useState('');
  const [trigger, setTrigger] = useState('once'); // 'once' | 'repeat'
  const [expiry, setExpiry] = useState('');

  const handleCreate = (e) => {
    e.preventDefault();
    if (!targetPrice) return;

    const newAlert = {
      id: Date.now(),
      symbol: currentSymbol,
      targetPrice: parseFloat(targetPrice),
      condition,
      name: alertName.trim(),
      trigger,
      expiry: expiry ? new Date(expiry).getTime() : null,
      lastFired: null,
      message: message || `${currentSymbol} ${condition} ${targetPrice}`,
      active: true,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setAlerts(prev => [newAlert, ...prev]);
    setShowCreate(false);
    setMessage('');
    setAlertName('');
    setExpiry('');
  };

  const toggleAlert = (id) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, active: !a.active } : a));
  };

  const deleteAlert = (id) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '12px 14px' }}>
      {/* Create Alert CTA */}
      <button
        onClick={() => {
          setTargetPrice(currentPrice || '');
          setShowCreate(true);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          background: 'var(--brand)',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          padding: '10px 14px',
          fontWeight: 600,
          fontSize: 13,
          cursor: 'pointer',
          marginBottom: 12,
          boxShadow: '0 2px 8px rgba(41, 98, 255, 0.3)'
        }}
      >
        <Plus size={16} /> Create Alert on {currentSymbol}
      </button>

      {/* Modal / Inline Creator */}
      {showCreate && (
        <form 
          onSubmit={handleCreate}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 12,
            marginBottom: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
            NEW PRICE ALERT
          </div>

          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Alert name (optional)</label>
            <input
              type="text"
              value={alertName}
              onChange={e => setAlertName(e.target.value)}
              placeholder="e.g. Gold breakout"
              style={{ width: '100%', background: '#1e222d', border: '1px solid var(--border)', color: 'var(--text)',
                borderRadius: 4, padding: '6px 8px', fontSize: 12, boxSizing: 'border-box' }}
            />
          </div>

          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Condition</label>
            <select
              value={condition}
              onChange={e => setCondition(e.target.value)}
              style={{ width: '100%', background: '#1e222d', border: '1px solid var(--border)', color: 'var(--text)',
                borderRadius: 4, padding: '6px 8px', fontSize: 12 }}
            >
              <option value="crossing">Crossing (either direction)</option>
              <option value="crossing_up">Crossing Up</option>
              <option value="crossing_down">Crossing Down</option>
              <option value="greater">Greater Than (&gt;=)</option>
              <option value="less">Less Than (&lt;=)</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Trigger</label>
              <select
                value={trigger}
                onChange={e => setTrigger(e.target.value)}
                style={{ width: '100%', background: '#1e222d', border: '1px solid var(--border)', color: 'var(--text)',
                  borderRadius: 4, padding: '6px 8px', fontSize: 12 }}
              >
                <option value="once">Only Once</option>
                <option value="repeat">Every Time</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Expires (optional)</label>
              <input
                type="datetime-local"
                value={expiry}
                onChange={e => setExpiry(e.target.value)}
                style={{ width: '100%', background: '#1e222d', border: '1px solid var(--border)', color: 'var(--text)',
                  borderRadius: 4, padding: '5px 6px', fontSize: 11.5, boxSizing: 'border-box' }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Target Price</label>
            <input
              type="number"
              step="any"
              value={targetPrice}
              onChange={e => setTargetPrice(e.target.value)}
              placeholder="e.g. 4580.50"
              required
              style={{
                width: '100%',
                background: '#1e222d',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                borderRadius: 4,
                padding: '6px 8px',
                fontSize: 13,
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Note / Message</label>
            <input
              type="text"
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="e.g. OB Retest / Take Profit"
              style={{
                width: '100%',
                background: '#1e222d',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                borderRadius: 4,
                padding: '6px 8px',
                fontSize: 12,
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              type="submit"
              style={{
                flex: 1,
                background: 'var(--brand)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '6px 0',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Save Alert
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                borderRadius: 4,
                padding: '6px 12px',
                fontSize: 12,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Alerts List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: 0.5 }}>
          ACTIVE ALERTS ({alerts.filter(a => a.active).length})
        </div>

        {alerts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)', fontSize: 12 }}>
            <Bell size={28} style={{ opacity: 0.3, marginBottom: 8 }} />
            <div>No alerts set</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>Create an alert to get notified on price changes</div>
          </div>
        ) : (
          alerts.map(a => (
            <div
              key={a.id}
              style={{
                background: a.active ? 'var(--bg-card)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${a.active ? 'var(--border)' : 'transparent'}`,
                borderRadius: 6,
                padding: '10px 12px',
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                opacity: a.active ? 1 : 0.5
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 13, color: 'var(--text)' }}>{a.symbol}</strong>
                  <span style={{ fontSize: 12, color: 'var(--brand)', fontWeight: 600 }}>
                    {({ crossing: '⇋', crossing_up: '↗', crossing_down: '↘', greater: '≥', less: '≤' }[a.condition]) || '⇋'} {a.targetPrice}
                  </span>
                  {a.trigger === 'repeat' && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#f7a600', background: 'rgba(247,166,0,0.15)', borderRadius: 3, padding: '1px 4px' }}>REPEAT</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {a.name ? a.name + ' · ' : ''}{a.message}
                  {a.expiry ? ` · expires ${new Date(a.expiry).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={a.active}
                  onChange={() => toggleAlert(a.id)}
                  title={a.active ? 'Deactivate' : 'Activate'}
                  style={{ cursor: 'pointer' }}
                />
                <button
                  onClick={() => deleteAlert(a.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: 2
                  }}
                  title="Delete Alert"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}

        {/* Triggered Logs */}
        {alertLogs && alertLogs.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: 0.5 }}>
              TRIGGER LOGS
            </div>
            {alertLogs.map((log, idx) => (
              <div
                key={idx}
                style={{
                  background: 'rgba(8, 153, 129, 0.1)',
                  border: '1px solid rgba(8, 153, 129, 0.2)',
                  borderRadius: 4,
                  padding: '6px 10px',
                  marginBottom: 6,
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <CheckCircle size={12} color="#089981" />
                <span style={{ color: 'var(--text)' }}>{log.text}</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{log.time}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
