import React, { useEffect, useRef, useState, useCallback } from 'react';
import { DAILY_SET } from './academyQuestions';
import { GraduationCap, CheckCircle, XCircle, ChevronRight, RotateCcw, Target, TrendingUp } from 'lucide-react';

const CW = 660, CH = 320, PAD = 12;

// Draw candles onto a canvas and return the pixel<->data mapping for click grading.
function drawChart(canvas, candles, marks) {
  if (!canvas || !candles || !candles.length) return null;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, CW, CH);
  ctx.fillStyle = '#0e1116';
  ctx.fillRect(0, 0, CW, CH);

  let lo = Infinity, hi = -Infinity;
  candles.forEach(k => { lo = Math.min(lo, k.l); hi = Math.max(hi, k.h); });
  const span = (hi - lo) || 1;
  lo -= span * 0.08; hi += span * 0.08;
  const plotW = CW - PAD * 2, plotH = CH - PAD * 2;
  const n = candles.length;
  const cw = plotW / n;
  const xOf = i => PAD + i * cw + cw / 2;
  const yOf = p => PAD + (hi - p) / (hi - lo) * plotH;

  // grid
  ctx.strokeStyle = '#1a1e28'; ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) { const y = PAD + g / 4 * plotH; ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(CW - PAD, y); ctx.stroke(); }

  candles.forEach((k, i) => {
    const up = k.c >= k.o;
    const col = up ? '#089981' : '#f23645';
    const x = xOf(i);
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, yOf(k.h)); ctx.lineTo(x, yOf(k.l)); ctx.stroke();
    ctx.fillStyle = col;
    const bw = Math.max(cw * 0.6, 1.5);
    const yO = yOf(k.o), yC = yOf(k.c);
    ctx.fillRect(x - bw / 2, Math.min(yO, yC), bw, Math.max(Math.abs(yC - yO), 1));
  });

  // overlays (user click + correct answer) rendered after grading
  (marks || []).forEach(m => {
    if (m.type === 'point') {
      const x = xOf(m.index), y = yOf(candles[m.index] ? (m.high ? candles[m.index].h : candles[m.index].l) : (hi + lo) / 2);
      ctx.strokeStyle = m.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
    } else if (m.type === 'level') {
      const y = yOf(m.price);
      ctx.strokeStyle = m.color; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
      ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(CW - PAD, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = m.color; ctx.font = '11px Inter, sans-serif';
      ctx.fillText(m.label || m.price.toFixed(1), CW - PAD - 70, y - 4);
    } else if (m.type === 'line' && m.pts && m.pts.length === 2) {
      ctx.strokeStyle = m.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(xOf(m.pts[0].index), yOf(m.pts[0].price)); ctx.lineTo(xOf(m.pts[1].index), yOf(m.pts[1].price)); ctx.stroke();
    }
  });

  return { xOf, yOf, cw, n, lo, hi, plotH,
    pxToIndex: px => Math.max(0, Math.min(n - 1, Math.round((px - PAD - cw / 2) / cw))),
    pyToPrice: py => hi - (py - PAD) / plotH * (hi - lo)
  };
}

export default function AcademyTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [qs] = useState(() => (DAILY_SET.questions || []).map(q => ({ ...q })));
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState(null);      // mcq index
  const [clicks, setClicks] = useState([]);            // chart clicks
  const [answered, setAnswered] = useState(false);
  const [wasCorrect, setWasCorrect] = useState(false);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [stats, setStats] = useState(null);
  const canvasRef = useRef(null);
  const mapRef = useRef(null);

  const q = qs[idx];
  const hasChart = !!(q && q.candles && q.candles.length);   // show a chart whenever one is provided
  const isInteractive = !!(q && q.kind !== 'mcq');           // only these kinds accept clicks

  const redraw = useCallback(() => {
    if (!hasChart || !canvasRef.current) return;
    const marks = [];
    // user clicks
    if (q.kind === 'clickLevel' && clicks[0]) marks.push({ type: 'level', price: clicks[0].price, color: '#2962ff', label: 'you' });
    if ((q.kind === 'clickPoint') && clicks[0]) marks.push({ type: 'point', index: clicks[0].index, color: '#2962ff', high: q.answer.high });
    if (q.kind === 'drawLine' && clicks.length) marks.push({ type: 'line', color: '#2962ff', pts: clicks.slice(0, 2) });
    // reveal correct answer after grading
    if (answered) {
      if (q.kind === 'clickLevel') marks.push({ type: 'level', price: q.answer.price, color: '#089981', label: 'correct' });
      if (q.kind === 'clickPoint') marks.push({ type: 'point', index: q.answer.index, color: '#089981', high: q.answer.high });
      if (q.kind === 'drawLine') marks.push({ type: 'line', color: '#089981', pts: [{ index: q.answer.i1, price: q.candles[q.answer.i1].l }, { index: q.answer.i2, price: q.candles[q.answer.i2].h }] });
    }
    mapRef.current = drawChart(canvasRef.current, q.candles, marks);
  }, [q, clicks, answered, hasChart]);

  useEffect(() => { redraw(); }, [redraw]);

  const onCanvasClick = (e) => {
    if (!isInteractive || answered || !mapRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const index = mapRef.current.pxToIndex(px);
    const price = mapRef.current.pyToPrice(py);
    if (q.kind === 'drawLine') {
      setClicks(prev => (prev.length >= 2 ? [{ index, price }] : [...prev, { index, price }]));
    } else {
      setClicks([{ index, price }]);
    }
  };

  const grade = () => {
    let correct = false;
    if (q.kind === 'mcq') correct = selected === q.answer;
    else if (q.kind === 'clickPoint') correct = clicks[0] && Math.abs(clicks[0].index - q.answer.index) <= (q.answer.tol ?? 2);
    else if (q.kind === 'clickLevel') correct = clicks[0] && Math.abs(clicks[0].price - q.answer.price) / q.answer.price <= (q.answer.tolPct ?? 0.012);
    else if (q.kind === 'drawLine') {
      if (clicks.length >= 2) {
        const a = clicks[0].index, b = clicks[1].index, tol = q.answer.tol ?? 3;
        correct = (Math.abs(a - q.answer.i1) <= tol && Math.abs(b - q.answer.i2) <= tol) ||
                  (Math.abs(a - q.answer.i2) <= tol && Math.abs(b - q.answer.i1) <= tol);
      }
    }
    setWasCorrect(correct);
    setAnswered(true);
    if (correct) setScore(s => s + 1);
    // log to backend
    try {
      fetch('/api/academy/log', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: today, category: q.category, kind: q.kind, questionId: q.id,
          correct, userAnswer: q.kind === 'mcq' ? selected : clicks[0] || null,
          correctAnswer: q.kind === 'mcq' ? q.answer : q.answer
        })
      }).catch(() => {});
    } catch (e) { /* offline */ }
  };

  const next = () => {
    if (idx + 1 >= qs.length) {
      setDone(true);
      fetch('/api/academy/stats').then(r => r.json()).then(setStats).catch(() => {});
      return;
    }
    setIdx(i => i + 1); setSelected(null); setClicks([]); setAnswered(false); setWasCorrect(false);
  };

  const restart = () => { setIdx(0); setSelected(null); setClicks([]); setAnswered(false); setWasCorrect(false); setScore(0); setDone(false); setStats(null); };

  const canSubmit = q && (q.kind === 'mcq' ? selected !== null : (q.kind === 'drawLine' ? clicks.length >= 2 : clicks.length >= 1));

  const CAT_LABEL = { trend: 'Trend', structure: 'Market Structure', pattern: 'Patterns', decision: 'Decision', news: 'News / Fundamentals', risk: 'Risk & Sizing', sl_placement: 'Stop Placement', misc: 'General' };

  if (!qs.length) {
    return <div style={{ padding: 40, color: 'var(--text-muted)' }}>No questions loaded. Ask Claude for today's set.</div>;
  }

  if (done) {
    const pct = Math.round(score / qs.length * 100);
    return (
      <div style={{ height: '100%', overflowY: 'auto', padding: '28px 24px', color: 'var(--text)' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <GraduationCap size={40} color="#2962ff" />
            <h2 style={{ margin: '10px 0 4px' }}>Session Complete</h2>
            <div style={{ fontSize: 42, fontWeight: 800, color: pct >= 70 ? '#089981' : pct >= 50 ? '#f7a600' : '#f23645' }}>{score}/{qs.length}</div>
            <div style={{ color: 'var(--text-muted)' }}>{pct}% correct today</div>
          </div>

          {stats && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}><TrendingUp size={16} /> Your Knowledge Profile (all-time)</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 12 }}>Overall: {stats.correct}/{stats.total} · {stats.accuracy}% accuracy across {Object.keys(stats.by_date || {}).length} day(s)</div>
              {Object.entries(stats.by_category || {}).sort((a, b) => a[1].accuracy - b[1].accuracy).map(([cat, c]) => (
                <div key={cat} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
                    <span>{CAT_LABEL[cat] || cat}</span>
                    <span style={{ color: c.accuracy >= 70 ? '#089981' : c.accuracy >= 50 ? '#f7a600' : '#f23645', fontWeight: 700 }}>{c.accuracy}% <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({c.correct}/{c.total})</span></span>
                  </div>
                  <div style={{ height: 6, background: '#1a1e28', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${c.accuracy}%`, height: '100%', background: c.accuracy >= 70 ? '#089981' : c.accuracy >= 50 ? '#f7a600' : '#f23645' }} />
                  </div>
                </div>
              ))}
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
                Your weakest categories are at the top — that's where to focus. Tell Claude "give me today's questions, focus on {Object.entries(stats.by_category || {}).sort((a, b) => a[1].accuracy - b[1].accuracy)[0]?.[0] || 'patterns'}" to drill them.
              </div>
            </div>
          )}
          <button onClick={restart} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 auto', background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 18px', fontWeight: 600, cursor: 'pointer' }}>
            <RotateCcw size={16} /> Replay today's set
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '20px 24px', color: 'var(--text)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <GraduationCap size={22} color="#2962ff" />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Trader's Gym</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{today} · daily skills assessment</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Question {idx + 1} / {qs.length}</div>
            <div style={{ fontSize: 12, color: '#089981', fontWeight: 700 }}>Score {score}</div>
          </div>
        </div>
        {/* Progress */}
        <div style={{ height: 5, background: '#1a1e28', borderRadius: 3, marginBottom: 18, overflow: 'hidden' }}>
          <div style={{ width: `${(idx) / qs.length * 100}%`, height: '100%', background: 'var(--brand)', transition: 'width .2s' }} />
        </div>

        {/* Category chip + prompt */}
        <div style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: '#2962ff', background: 'rgba(41,98,255,0.12)', borderRadius: 4, padding: '3px 8px', marginBottom: 10 }}>
          {CAT_LABEL[q.category] || q.category}
        </div>
        <div style={{ fontSize: 15.5, fontWeight: 600, lineHeight: 1.45, marginBottom: 16 }}>{q.prompt}</div>

        {/* Chart — shown for any question that provides candles */}
        {hasChart && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <canvas
                ref={canvasRef} width={CW} height={CH}
                onClick={onCanvasClick}
                style={{ display: 'block', cursor: (isInteractive && !answered) ? 'crosshair' : 'default' }}
              />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>
              {isInteractive
                ? ((q.kind === 'drawLine' ? 'Click two points to draw your line.' : q.kind === 'clickLevel' ? 'Click on the chart at the price level.' : 'Click the candle.') + (clicks.length > 0 && !answered ? ' — tap again to change.' : ''))
                : 'Study the chart above, then choose your answer.'}
            </div>
          </div>
        )}

        {/* MCQ options */}
        {q.kind === 'mcq' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {q.options.map((opt, i) => {
              const chosen = selected === i;
              const showCorrect = answered && i === q.answer;
              const showWrong = answered && chosen && i !== q.answer;
              return (
                <button key={i} disabled={answered} onClick={() => setSelected(i)}
                  style={{
                    textAlign: 'left', padding: '11px 14px', borderRadius: 6, fontSize: 13.5, cursor: answered ? 'default' : 'pointer',
                    background: showCorrect ? 'rgba(8,153,129,0.15)' : showWrong ? 'rgba(242,54,69,0.15)' : chosen ? 'rgba(41,98,255,0.15)' : 'var(--bg-card)',
                    border: `1px solid ${showCorrect ? '#089981' : showWrong ? '#f23645' : chosen ? 'var(--brand)' : 'var(--border)'}`,
                    color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10
                  }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-muted)' }}>{String.fromCharCode(65 + i)}</span>
                  <span style={{ flex: 1 }}>{opt}</span>
                  {showCorrect && <CheckCircle size={16} color="#089981" />}
                  {showWrong && <XCircle size={16} color="#f23645" />}
                </button>
              );
            })}
          </div>
        )}

        {/* Explanation */}
        {answered && (
          <div style={{ background: wasCorrect ? 'rgba(8,153,129,0.08)' : 'rgba(242,54,69,0.08)', border: `1px solid ${wasCorrect ? 'rgba(8,153,129,0.35)' : 'rgba(242,54,69,0.35)'}`, borderRadius: 8, padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: wasCorrect ? '#089981' : '#f23645', marginBottom: 6 }}>
              {wasCorrect ? <CheckCircle size={16} /> : <XCircle size={16} />}
              {wasCorrect ? 'Correct' : 'Not quite'}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text)' }}>{q.explanation}</div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          {!answered ? (
            <button onClick={grade} disabled={!canSubmit}
              style={{ background: canSubmit ? 'var(--brand)' : '#2a2e39', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 20px', fontWeight: 600, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
              Submit
            </button>
          ) : (
            <button onClick={next}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 20px', fontWeight: 600, cursor: 'pointer' }}>
              {idx + 1 >= qs.length ? 'Finish' : 'Next'} <ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
