// academyQuestions.js — the daily Trader's Gym question set.
// Claude regenerates/updates this file on request ("give me today's questions").
// Each question is fully self-contained and objectively gradable.
//
// Question kinds:
//   'mcq'        -> options[], answer = correct index
//   'clickPoint' -> candles[], answer = { index, tol }   (click a candle)
//   'clickLevel' -> candles[], answer = { price, tolPct } (click a price level)
//   'drawLine'   -> candles[], answer = { i1, i2, tol }   (click 2 swing points)
//
// candles are [{ o, h, l, c }] — deterministic, so the correct answer is fixed.

// ---- deterministic candle builder (no randomness => stable answers) ----
function build(start, segments) {
  const bars = [];
  let p = start;
  segments.forEach((seg) => {
    const step = seg.step ?? 1;
    const vol = seg.vol ?? step * 0.8;
    for (let i = 0; i < seg.n; i++) {
      const o = p;
      const wobble = Math.sin(bars.length * 1.7) * vol * 0.5;
      let c = o + seg.dir * step + wobble;
      const hi = Math.max(o, c) + Math.abs(vol) * 0.7;
      const lo = Math.min(o, c) - Math.abs(vol) * 0.7;
      bars.push({ o: +o.toFixed(2), h: +hi.toFixed(2), l: +lo.toFixed(2), c: +c.toFixed(2) });
      p = c;
    }
  });
  return bars;
}

// Reusable scenarios
const upTrend = build(2000, [{ dir: 1, n: 34, step: 3, vol: 4 }]);
const downTrend = build(2100, [{ dir: -1, n: 34, step: 3, vol: 4 }]);
// up, pullback, continue -> higher low is around the pullback bottom
const pullback = build(1980, [
  { dir: 1, n: 12, step: 4, vol: 4 },   // 0-11 up
  { dir: -1, n: 6, step: 4, vol: 4 },   // 12-17 pullback (low ~ index 17)
  { dir: 1, n: 14, step: 4, vol: 4 },   // 18-31 continue up
]);
// range then breakout up around index 24
const breakout = build(1950, [
  { dir: 0, n: 22, step: 0.4, vol: 5 }, // 0-21 range
  { dir: 1, n: 12, step: 6, vol: 4 },   // 22-33 breakout up
]);
// double top: up, peak1, down, up to peak2 (~equal), down
const doubleTop = build(1980, [
  { dir: 1, n: 8, step: 4, vol: 3 },    // rise to peak1 (~idx7)
  { dir: -1, n: 6, step: 4, vol: 3 },   // valley
  { dir: 1, n: 6, step: 4, vol: 3 },    // rise to peak2 (~idx19)
  { dir: -1, n: 10, step: 4, vol: 3 },  // fall
]);
// downtrend into support then bounce area
const supportBounce = build(2080, [
  { dir: -1, n: 16, step: 4, vol: 4 },  // down to support (~idx15)
  { dir: 1, n: 10, step: 3, vol: 4 },   // bounce
]);

export const DAILY_SET = {
  date: '', // filled at runtime with today's date
  title: "Trader's Gym — Daily Set",
  questions: [
    {
      id: 'q1', category: 'trend', kind: 'mcq',
      prompt: 'Look at the price structure. What is the dominant trend?',
      candles: upTrend,
      options: ['Uptrend', 'Downtrend', 'Sideways / range', 'No way to tell'],
      answer: 0,
      explanation: 'Successive higher highs and higher lows = uptrend. Trade WITH this bias — favour longs on pullbacks, not shorts.'
    },
    {
      id: 'q2', category: 'structure', kind: 'clickPoint',
      prompt: 'Click the SWING HIGH you would anchor a downtrend line from.',
      candles: doubleTop,
      answer: { index: 7, tol: 2 },
      explanation: 'The first major peak is the anchor. A downtrend line connects lower highs starting from the most recent significant swing high.'
    },
    {
      id: 'q3', category: 'pattern', kind: 'mcq',
      prompt: 'Two roughly equal peaks with a valley between, after an up-move. What pattern is forming?',
      candles: doubleTop,
      options: ['Double top (bearish)', 'Bull flag (bullish)', 'Ascending triangle', 'Head & shoulders'],
      answer: 0,
      explanation: 'Two equal highs failing at the same level = double top, a reversal pattern. A break below the middle valley (neckline) confirms it.'
    },
    {
      id: 'q4', category: 'decision', kind: 'mcq',
      prompt: 'Strong uptrend. Price pulls back to rising support and prints a bullish engulfing candle. Your move?',
      candles: pullback,
      options: ['Long (buy the pullback)', 'Short (fade the move)', 'Stay out', 'Short then reverse'],
      answer: 0,
      explanation: 'Buying pullbacks to support in an uptrend is a high-probability, trend-aligned entry. Fading a strong trend is how accounts bleed.'
    },
    {
      id: 'q5', category: 'structure', kind: 'clickPoint',
      prompt: 'Click the HIGHER LOW — the pullback bottom that confirms the uptrend is intact.',
      candles: pullback,
      answer: { index: 17, tol: 2 },
      explanation: 'A higher low above the previous low confirms buyers are stepping in earlier each time — the signature of a healthy uptrend.'
    },
    {
      id: 'q6', category: 'sl_placement', kind: 'clickLevel',
      prompt: 'You went LONG at the pullback. Click the PRICE LEVEL where your stop-loss belongs.',
      candles: pullback,
      answer: { price: pullback[17].l - 6, tolPct: 0.012 },
      explanation: 'Stops go just BELOW the swing low that invalidates your idea — not at a random fixed distance. If price breaks that low, your reason to be long is gone.'
    },
    {
      id: 'q7', category: 'pattern', kind: 'mcq',
      prompt: 'A tight sideways range for many bars, then a strong candle closes decisively above the range. This is a:',
      candles: breakout,
      options: ['Range breakout', 'Double bottom', 'Bearish divergence', 'Exhaustion top'],
      answer: 0,
      explanation: 'Consolidation followed by a decisive close outside the range = breakout. Best breakouts happen in the direction of the higher-timeframe trend.'
    },
    {
      id: 'q8', category: 'structure', kind: 'clickPoint',
      prompt: 'Click the BREAKOUT candle — where a momentum long entry triggers.',
      candles: breakout,
      answer: { index: 23, tol: 2 },
      explanation: 'The entry is the candle that closes clearly beyond the range boundary, ideally on rising volume. Chasing bars later gives you a worse price and wider risk.'
    },
    {
      id: 'q9', category: 'decision', kind: 'mcq',
      prompt: 'Downtrend into a clear support zone; a strong bullish rejection wick forms at support. Lowest-risk play?',
      candles: supportBounce,
      options: ['Counter-trend long off support (small size, tight invalidation)', 'Add to shorts at support', 'Long with full size, no stop', 'Ignore price, buy because it is "cheap"'],
      answer: 0,
      explanation: 'A bounce off major support can be traded, but it is counter-trend — so small size and a tight invalidation below support. Never "no stop", never "cheap" as a reason.'
    },
    {
      id: 'q10', category: 'news', kind: 'mcq',
      prompt: 'US CPI prints much HOTTER than expected (inflation surprise to the upside). Immediate USD reaction?',
      options: ['USD strengthens (rate-hike expectations rise)', 'USD weakens', 'No effect', 'Only affects stocks, not USD'],
      answer: 0,
      explanation: 'Hot inflation => market prices higher/for-longer rates => USD typically strengthens. Gold (priced in USD) often dips on the initial spike.'
    },
    {
      id: 'q11', category: 'news', kind: 'mcq',
      prompt: 'The Fed unexpectedly CUTS interest rates. Most likely reaction in Gold (XAUUSD)?',
      options: ['Gold rises (lower yields, weaker USD)', 'Gold falls', 'Gold unaffected', 'Gold and USD both rise together'],
      answer: 0,
      explanation: 'Rate cuts lower the opportunity cost of holding non-yielding gold and tend to weaken USD — both bullish for gold.'
    },
    {
      id: 'q12', category: 'news', kind: 'mcq',
      prompt: 'Non-Farm Payrolls come in FAR above forecast (very strong US jobs). Typical first reaction for USD?',
      options: ['USD up', 'USD down', 'EUR/USD up', 'No FX impact'],
      answer: 0,
      explanation: 'A strong labour market supports tighter policy => USD strengthens, so EUR/USD usually falls. High-impact news = wider spreads and whipsaws; many pros wait for the dust to settle.'
    },
    {
      id: 'q13', category: 'risk', kind: 'mcq',
      prompt: 'You enter long at 2000.0, stop at 1990.0, target at 2020.0. What is the reward-to-risk (R:R)?',
      options: ['1 : 2', '2 : 1', '1 : 1', '1 : 0.5'],
      answer: 0,
      explanation: 'Risk = 2000−1990 = 10. Reward = 2020−2000 = 20. R:R = 20/10 = 2, i.e. you risk 1 to make 2 (written 1:2). Aim for ≥1:1.5.'
    },
    {
      id: 'q14', category: 'risk', kind: 'mcq',
      prompt: 'Account $1000, you risk 1% per trade, stop is 20 pips, and 1 pip = $1 per 0.10 lot on your gold. What position size keeps risk at 1%?',
      options: ['0.05 lot', '0.50 lot', '1.00 lot', '0.10 lot'],
      answer: 0,
      explanation: '1% of $1000 = $10 risk. At 20 pips, you can lose $10 only if each pip = $0.50 => 0.05 lot (since 0.10 lot = $1/pip). Size is DERIVED from risk, never fixed arbitrarily.'
    },
    {
      id: 'q15', category: 'decision', kind: 'mcq',
      prompt: 'Price is chopping in the middle of a wide range, no clear trend, ADX ≈ 14. Best action?',
      candles: build(2000, [{ dir: 0, n: 32, step: 0.5, vol: 6 }]),
      options: ['Stay out — no edge in the chop', 'Buy the middle', 'Short the middle', 'Trade both directions aggressively'],
      answer: 0,
      explanation: 'ADX under ~20 = no trend. Trend and breakout strategies bleed here. The winning move is often no trade — cash is a position.'
    },
    {
      id: 'q16', category: 'sl_placement', kind: 'clickLevel',
      prompt: 'Click the KEY SUPPORT level a long trade would lean on in this bounce scenario.',
      candles: supportBounce,
      answer: { price: supportBounce[15].l, tolPct: 0.012 },
      explanation: 'Support is where the down-move stalled and reversed (the swing low). It is your reference for both entry logic and stop placement.'
    },
    {
      id: 'q17', category: 'pattern', kind: 'mcq',
      prompt: 'After a strong rally, price drifts DOWN in a small tight channel against the trend on shrinking momentum. This is most likely a:',
      candles: build(1970, [{ dir: 1, n: 16, step: 4, vol: 3 }, { dir: -1, n: 10, step: 1.2, vol: 1.5 }]),
      options: ['Bull flag (continuation)', 'Double top (reversal)', 'Head & shoulders', 'Descending triangle breakdown'],
      answer: 0,
      explanation: 'A shallow, orderly pullback against a strong up-move = bull flag, usually a continuation. A break above the flag resumes the trend.'
    },
    {
      id: 'q18', category: 'decision', kind: 'mcq',
      prompt: 'You are LONG and price hits TP1 (your first target). Textbook risk management next step?',
      options: ['Bank partial profit and move stop toward breakeven', 'Add maximum size', 'Remove the stop to give it room', 'Close nothing and hope for more'],
      answer: 0,
      explanation: 'Taking partial profit and trailing/breakeven-ing the stop locks in a win and removes downside on the rest. Removing stops is how small losses become account-killers.'
    },
    {
      id: 'q19', category: 'news', kind: 'mcq',
      prompt: 'A sudden geopolitical shock hits the wires (risk-off). Most typical reaction in Gold?',
      options: ['Gold rises (safe-haven bid)', 'Gold crashes', 'Gold unaffected', 'Gold moves opposite to volatility'],
      answer: 0,
      explanation: 'Gold is a classic safe haven; risk-off / fear episodes usually bid it up. But moves are violent — spreads widen and stops can slip.'
    },
    {
      id: 'q20', category: 'trend', kind: 'mcq',
      prompt: 'ADX is reading 12 and falling. What does that tell you about trading trend/breakout setups right now?',
      options: ['Weak/absent trend — trend & breakout setups are low-probability', 'Very strong trend — press entries', 'Overbought — short everything', 'Nothing; ADX is about volume'],
      answer: 0,
      explanation: 'ADX measures trend STRENGTH, not direction. Below ~20 means no real trend, so momentum/breakout strategies underperform — exactly why your signal engine now filters these out.'
    }
  ]
};
