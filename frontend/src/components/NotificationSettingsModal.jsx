import React, { useState, useEffect } from 'react';
import { X, Bell, Send, CheckCircle2, AlertCircle, Volume2, ShieldCheck } from 'lucide-react';

export default function NotificationSettingsModal({ isOpen, onClose }) {
  const [discordUrl, setDiscordUrl] = useState('');
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [browserPerm, setBrowserPerm] = useState(() => {
    return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported';
  });

  // Load saved config
  useEffect(() => {
    if (isOpen) {
      fetch('/api/notifications/discord/config')
        .then(r => r.json())
        .then(data => {
          if (data) {
            setDiscordUrl(data.discord_webhook_url || '');
            setDiscordEnabled(!!data.discord_enabled);
          }
        })
        .catch(err => console.error('Error loading notification config:', err));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    try {
      setSaving(true);
      await fetch('/api/notifications/discord/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discord_webhook_url: discordUrl.trim(),
          discord_enabled: discordEnabled,
          notify_on_signals: true,
          notify_on_trades: true,
          notify_on_auto_be: true
        })
      });
      setTestResult({ ok: true, msg: 'Notification preferences saved!' });
      setTimeout(() => setTestResult(null), 3000);
    } catch (e) {
      setTestResult({ ok: false, msg: 'Failed to save configuration.' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestDiscord = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      const res = await fetch('/api/notifications/discord/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_url: discordUrl.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({ ok: true, msg: 'Test message sent to Discord successfully!' });
      } else {
        setTestResult({ ok: false, msg: data.message || 'Error sending to Discord' });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: e.message || 'Network error' });
    } finally {
      setTesting(false);
    }
  };

  const requestBrowserPermission = async () => {
    if (!('Notification' in window)) {
      alert('Desktop notifications are not supported in this browser.');
      return;
    }
    const perm = await Notification.requestPermission();
    setBrowserPerm(perm);
    if (perm === 'granted') {
      new Notification('MyTradingView Alert Sentinel', {
        body: 'Desktop notifications are active! You will receive instant trade and signal alerts.',
        icon: 'https://img.icons8.com/color/96/bullish.png'
      });
    }
  };

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
        maxWidth: 580,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 16px 48px rgba(0,0,0,0.8)',
        overflow: 'hidden'
      }}>
        {/* HEADER */}
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
              background: 'rgba(247, 166, 0, 0.15)',
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid rgba(247, 166, 0, 0.3)'
            }}>
              <Bell size={18} color="#f7a600" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#fff' }}>
                Alert & Notification Channels
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: 11.5, color: '#8b949e' }}>
                Universal alert delivery via Discord Webhooks and Windows Desktop Push.
              </p>
            </div>
          </div>

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

        {/* BODY */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* SECTION 1: DISCORD WEBHOOK */}
          <div style={{
            background: '#1e222d',
            border: '1px solid #2a2e39',
            borderRadius: 8,
            padding: 16
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>🎮</span>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>Discord Webhook Alerts</span>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: '#c9d1d9' }}>
                <input
                  type="checkbox"
                  checked={discordEnabled}
                  onChange={(e) => setDiscordEnabled(e.target.checked)}
                  style={{ accentColor: '#2962ff' }}
                />
                <span>Enable Discord Alerts</span>
              </label>
            </div>

            <p style={{ fontSize: 11.5, color: '#8b949e', margin: '0 0 12px 0', lineHeight: 1.4 }}>
              Since Telegram is restricted, Discord Webhooks deliver instant trade signals and Auto-Breakeven events directly to any Discord channel with zero bot setup.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 11, color: '#8b949e', fontWeight: 600 }}>
                DISCORD WEBHOOK URL
              </label>
              <input
                type="text"
                placeholder="https://discord.com/api/webhooks/..."
                value={discordUrl}
                onChange={(e) => setDiscordUrl(e.target.value)}
                style={{
                  width: '100%',
                  background: '#131722',
                  border: '1px solid #2a2e39',
                  borderRadius: 5,
                  padding: '8px 10px',
                  color: '#fff',
                  fontSize: 12.5
                }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <button
                onClick={handleTestDiscord}
                disabled={testing || !discordUrl}
                style={{
                  background: 'rgba(41, 98, 255, 0.15)',
                  border: '1px solid rgba(41, 98, 255, 0.3)',
                  color: '#2962ff',
                  borderRadius: 4,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: testing || !discordUrl ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <Send size={13} />
                <span>{testing ? 'Sending...' : 'Test Discord Webhook'}</span>
              </button>
            </div>
          </div>

          {/* SECTION 2: BROWSER / DESKTOP PUSH NOTIFICATIONS */}
          <div style={{
            background: '#1e222d',
            border: '1px solid #2a2e39',
            borderRadius: 8,
            padding: 16
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>💻</span>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>Windows Desktop Push Notifications</span>
              </div>
              <span style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                background: browserPerm === 'granted' ? 'rgba(8, 153, 129, 0.15)' : 'rgba(255,255,255,0.06)',
                color: browserPerm === 'granted' ? '#089981' : '#8b949e'
              }}>
                {browserPerm === 'granted' ? 'Active' : (browserPerm === 'denied' ? 'Blocked' : 'Needs Permission')}
              </span>
            </div>

            <p style={{ fontSize: 11.5, color: '#8b949e', margin: '0 0 12px 0', lineHeight: 1.4 }}>
              Native browser notifications pop up in Windows even when the workstation is minimized or running in the background. 100% local, immune to any country ISP filter.
            </p>

            {browserPerm !== 'granted' ? (
              <button
                onClick={requestBrowserPermission}
                style={{
                  background: 'var(--brand, #2962ff)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Enable Desktop Notifications
              </button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#089981', fontSize: 12 }}>
                <ShieldCheck size={16} />
                <span>Desktop notifications are fully enabled and ready.</span>
              </div>
            )}
          </div>

          {/* STATUS NOTIFICATION FEEDBACK */}
          {testResult && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 6,
              background: testResult.ok ? 'rgba(8, 153, 129, 0.15)' : 'rgba(242, 54, 69, 0.15)',
              border: testResult.ok ? '1px solid #089981' : '1px solid #f23645',
              color: testResult.ok ? '#089981' : '#ff8282',
              fontSize: 12
            }}>
              {testResult.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              <span>{testResult.msg}</span>
            </div>
          )}

        </div>

        {/* FOOTER */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 10,
          padding: '12px 20px',
          borderTop: '1px solid #1f2430',
          background: '#0d1117'
        }}>
          <button
            onClick={onClose}
            style={{
              background: '#1e222d',
              border: '1px solid #2a2e39',
              color: '#8b949e',
              borderRadius: 5,
              padding: '6px 14px',
              fontSize: 12.5,
              cursor: 'pointer'
            }}
          >
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              background: 'var(--brand, #2962ff)',
              color: '#fff',
              border: 'none',
              borderRadius: 5,
              padding: '6px 16px',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer'
            }}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>

      </div>
    </div>
  );
}
