import React, { useState, useEffect } from 'react';
import { X, RefreshCw, GitBranch, CheckCircle2, ArrowDownCircle, AlertTriangle, ShieldCheck, Terminal } from 'lucide-react';

export default function UpdateModal({ isOpen, onClose, appVersion = "v2.5.0" }) {
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [updateResult, setUpdateResult] = useState(null);

  const checkUpdates = async () => {
    setChecking(true);
    setError(null);
    setUpdateResult(null);
    try {
      const res = await fetch('/api/app/update-status');
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      setError("Failed to contact local update service: " + err.message);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      checkUpdates();
    }
  }, [isOpen]);

  const applyUpdate = async () => {
    setUpdating(true);
    setError(null);
    try {
      const res = await fetch('/api/app/update', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Update failed to apply cleanly.");
      } else {
        setUpdateResult(data);
        setTimeout(() => {
          window.location.reload();
        }, 2200);
      }
    } catch (err) {
      setError("Update network error: " + err.message);
    } finally {
      setUpdating(false);
    }
  };

  if (!isOpen) return null;

  const isUpToDate = status && status.up_to_date;
  const hasUpdates = status && status.behind > 0;
  const isDirty = status && status.dirty;

  return (
    <div 
      className="modal-overlay" 
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16
      }}
    >
      <div 
        className="modal-content" 
        onClick={e => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: '95vw',
          background: '#181b24',
          border: '1px solid #2a2e39',
          borderRadius: 10,
          boxShadow: '0 20px 50px rgba(0,0,0,0.85)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 18px',
          borderBottom: '1px solid #2a2e39',
          background: '#131722'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <GitBranch size={18} color="var(--brand, #2962ff)" />
            <span style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>
              MyTradingView System Updates
            </span>
            <span style={{
              fontSize: 10,
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: 4,
              background: 'rgba(41, 98, 255, 0.15)',
              color: 'var(--brand, #2962ff)',
              border: '1px solid rgba(41, 98, 255, 0.3)'
            }}>
              {status?.version || appVersion}
            </span>
          </div>
          <button 
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#787b86',
              cursor: 'pointer',
              display: 'flex',
              padding: 4
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 18, fontSize: 13, color: 'var(--text)' }}>
          {/* Version Specs Card */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#1e222d',
            border: '1px solid #2a2e39',
            borderRadius: 6,
            padding: '12px 14px',
            marginBottom: 14
          }}>
            <div>
              <div style={{ fontSize: 11, color: '#787b86', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
                Target Repository
              </div>
              <div style={{ fontWeight: 600, color: '#d1d4dc', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>github.com/haider2804/mytradingview</span>
                <span style={{ fontSize: 11, color: 'var(--brand)', background: 'rgba(41,98,255,0.1)', padding: '1px 5px', borderRadius: 3 }}>
                  branch: main
                </span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#787b86', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
                Build ID
              </div>
              <div style={{ fontWeight: 700, color: '#089981', marginTop: 2 }}>
                {status?.build || "2026.09.11"}
              </div>
            </div>
          </div>

          {/* Checking Spinner */}
          {checking && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: '24px 0',
              color: '#787b86'
            }}>
              <RefreshCw size={18} className="spin-icon" style={{ animation: 'spin 1s linear infinite' }} />
              <span>Contacting GitHub repository & verifying commit tree…</span>
            </div>
          )}

          {/* Success / Up-to-date State */}
          {!checking && isUpToDate && !hasUpdates && !updateResult && (
            <div style={{
              background: 'rgba(8, 153, 129, 0.08)',
              border: '1px solid rgba(8, 153, 129, 0.3)',
              borderRadius: 6,
              padding: '16px',
              textAlign: 'center',
              marginBottom: 14
            }}>
              <CheckCircle2 size={32} color="#089981" style={{ margin: '0 auto 8px' }} />
              <div style={{ fontWeight: 700, fontSize: 14, color: '#089981' }}>
                Application is Up to Date
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Local commit matches origin/main ({status?.current?.hash || "latest"}). No new commits detected on GitHub.
              </div>
            </div>
          )}

          {/* New Updates Available State */}
          {!checking && hasUpdates && !updateResult && (
            <div style={{
              background: 'rgba(41, 98, 255, 0.08)',
              border: '1px solid rgba(41, 98, 255, 0.3)',
              borderRadius: 6,
              padding: '16px',
              marginBottom: 14
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <ArrowDownCircle size={22} color="var(--brand)" />
                <div>
                  <div style={{ fontWeight: 700, color: '#fff', fontSize: 13.5 }}>
                    {status.behind} New Update{status.behind > 1 ? 's' : ''} Available on GitHub!
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Incoming latest commit on origin/main:
                  </div>
                </div>
              </div>

              {status?.latest && (
                <div style={{
                  background: '#131722',
                  border: '1px solid #2a2e39',
                  borderRadius: 4,
                  padding: '8px 10px',
                  fontSize: 12,
                  marginTop: 6
                }}>
                  <div style={{ fontWeight: 600, color: '#d1d4dc' }}>
                    {status.latest.subject || "Repository update"}
                  </div>
                  <div style={{ fontSize: 11, color: '#787b86', marginTop: 2 }}>
                    Commit: {status.latest.hash} • {status.latest.date}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Update In Progress or Result */}
          {updating && (
            <div style={{
              background: 'rgba(41, 98, 255, 0.1)',
              border: '1px solid rgba(41, 98, 255, 0.3)',
              borderRadius: 6,
              padding: '18px',
              textAlign: 'center',
              marginBottom: 14
            }}>
              <RefreshCw size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px', color: 'var(--brand)' }} />
              <div style={{ fontWeight: 700, color: '#fff' }}>Applying Updates from GitHub…</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                Pulling commits via git pull origin main and compiling production bundle…
              </div>
            </div>
          )}

          {updateResult && (
            <div style={{
              background: 'rgba(8, 153, 129, 0.15)',
              border: '1px solid rgba(8, 153, 129, 0.4)',
              borderRadius: 6,
              padding: '16px',
              textAlign: 'center',
              marginBottom: 14
            }}>
              <ShieldCheck size={32} color="#089981" style={{ margin: '0 auto 8px' }} />
              <div style={{ fontWeight: 700, color: '#089981', fontSize: 14 }}>
                Update Applied Successfully!
              </div>
              <div style={{ fontSize: 12, color: '#d1d4dc', marginTop: 4 }}>
                {updateResult.message} Reloading application…
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div style={{
              background: 'rgba(242, 54, 69, 0.1)',
              border: '1px solid rgba(242, 54, 69, 0.3)',
              borderRadius: 6,
              padding: '10px 14px',
              color: '#f23645',
              fontSize: 12,
              marginBottom: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}>
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Current Commit Details */}
          {status?.current && (
            <div style={{
              background: '#131722',
              borderRadius: 6,
              padding: '10px 12px',
              border: '1px solid #2a2e39',
              fontSize: 11.5
            }}>
              <div style={{ color: '#787b86', marginBottom: 2 }}>Current Local Revision:</div>
              <div style={{ color: '#d1d4dc', fontWeight: 600 }}>{status.current.subject || "Initial commit"}</div>
              <div style={{ color: '#555d6e', marginTop: 2 }}>
                Hash: {status.current.hash} • Date: {status.current.date}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 18px',
          borderTop: '1px solid #2a2e39',
          background: '#131722',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <button
            onClick={checkUpdates}
            disabled={checking || updating}
            style={{
              background: 'transparent',
              border: '1px solid #2a2e39',
              color: '#d1d4dc',
              padding: '6px 14px',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              cursor: (checking || updating) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <RefreshCw size={13} className={checking ? 'spin-icon' : ''} />
            Check Again
          </button>

          {hasUpdates && !updateResult && (
            <button
              onClick={applyUpdate}
              disabled={updating}
              style={{
                background: '#089981',
                border: 'none',
                color: '#fff',
                padding: '7px 18px',
                borderRadius: 4,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: updating ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 2px 10px rgba(8,153,129,0.3)'
              }}
            >
              <ArrowDownCircle size={15} />
              {updating ? 'Pulling & Rebuilding…' : 'Update & Rebuild Now'}
            </button>
          )}

          {(!hasUpdates || updateResult) && (
            <button
              onClick={onClose}
              style={{
                background: 'var(--brand, #2962ff)',
                border: 'none',
                color: '#fff',
                padding: '7px 16px',
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
