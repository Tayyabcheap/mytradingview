import React from 'react';
import { Play, Pause, SkipForward, X, RotateCcw, FastForward } from 'lucide-react';

export default function ReplayBar({ isPlaying, speed, onTogglePlay, onStepForward, onReset, onChangeSpeed, onExit }) {
  return (
    <div style={{
      position: 'absolute',
      top: 14,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 50,
      background: '#1e222d',
      border: '1px solid #2a2e39',
      borderRadius: 8,
      boxShadow: '0 8px 30px rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      padding: '4px 12px',
      gap: 10,
      animation: 'slideDown 0.25s ease'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#f7a600', fontSize: 12, fontWeight: 700 }}>
        <RotateCcw size={15} /> REPLAY MODE
      </div>

      <div style={{ width: 1, height: 20, background: '#2a2e39' }} />

      {/* Play / Pause */}
      <button
        onClick={onTogglePlay}
        style={{
          background: isPlaying ? '#f23645' : '#089981',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          width: 30,
          height: 30,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer'
        }}
        title={isPlaying ? 'Pause Replay' : 'Play Replay'}
      >
        {isPlaying ? <Pause size={16} /> : <Play size={16} />}
      </button>

      {/* Step 1 Bar Forward */}
      <button
        onClick={onStepForward}
        style={{
          background: 'transparent',
          color: '#d1d4dc',
          border: '1px solid #2a2e39',
          borderRadius: 4,
          width: 30,
          height: 30,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer'
        }}
        title="Forward 1 Bar"
      >
        <SkipForward size={16} />
      </button>

      {/* Speed Selector */}
      <select
        value={speed}
        onChange={e => onChangeSpeed(Number(e.target.value))}
        style={{
          background: '#131722',
          border: '1px solid #2a2e39',
          color: '#d1d4dc',
          borderRadius: 4,
          padding: '4px 8px',
          fontSize: 12,
          cursor: 'pointer'
        }}
      >
        <option value={1}>1x Speed</option>
        <option value={2}>2x Speed</option>
        <option value={3}>3x Speed</option>
        <option value={5}>5x Speed</option>
      </select>

      {/* Reset */}
      <button
        onClick={onReset}
        style={{
          background: 'none',
          border: 'none',
          color: '#787b86',
          cursor: 'pointer',
          padding: 4
        }}
        title="Reset Replay"
      >
        <RotateCcw size={16} />
      </button>

      <div style={{ width: 1, height: 20, background: '#2a2e39' }} />

      {/* Exit */}
      <button
        onClick={onExit}
        style={{
          background: 'none',
          border: 'none',
          color: '#787b86',
          cursor: 'pointer',
          padding: 4
        }}
        title="Exit Replay"
      >
        <X size={18} />
      </button>
    </div>
  );
}
