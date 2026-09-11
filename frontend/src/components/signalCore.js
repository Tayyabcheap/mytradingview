// signalCore.js — single source of truth for on-chart trading signals.
// Supports multi-strategy selection and enforces the 5M chart constraint on Haider-Gold-Scalper.

export function computeSignalSeries(dataList, strategy = 'ALL', partialUsd = 20, timeframe = '5M') {
  const n = Array.isArray(dataList) ? dataList.length : 0;
  if (n < 30) return [];

  // Parse enabled strategies (supports string, array, or object)
  let enabledStrats = [];
  if (Array.isArray(strategy)) {
    enabledStrats = strategy;
  } else if (typeof strategy === 'object' && strategy !== null) {
    enabledStrats = Object.keys(strategy).filter(k => !!strategy[k]);
  } else if (strategy === 'ALL') {
    enabledStrats = ['REAL_DIP', 'SWING_CORE', 'SWING_PRO'];
  } else {
    enabledStrats = [strategy];
  }

  // Timeframe check: Haider-Gold-Scalper ONLY works on 5-minute chart
  const tfUpper = (timeframe || '5M').toString().toUpperCase();
  const is5M = tfUpper === '5M' || tfUpper === '5' || tfUpper === 'M5';

  const wantHaider = (enabledStrats.includes('REAL_DIP') || enabledStrats.includes('HAIDER_GOLD_SCALPER')) && is5M;
  const wantPull = enabledStrats.includes('SWING_CORE') || enabledStrats.includes('ALL');
  const wantBreak = enabledStrats.includes('SWING_PRO') || enabledStrats.includes('ALL');

  // If nothing is enabled or Haider is requested on non-5M chart with no other strategies
  if (!wantHaider && !wantPull && !wantBreak) {
    return new Array(n).fill(null).map(() => ({}));
  }

  const period = 20;         // pullback SMA
  const trendLen = 200;      // higher-timeframe trend filter (EMA)
  const atrLen = 14;         // volatility for stop distance
  const breakoutLen = 20;    // Donchian window for the breakout engine

  const closes = dataList.map(d => d.close);
  const effTrend = Math.min(trendLen, Math.max(20, Math.floor(n / 3)));
  const ke = 2 / (effTrend + 1);
  const ema = new Array(n).fill(null);
  {
    const seedN = Math.min(effTrend, n);
    let seed = 0;
    for (let i = 0; i < seedN; i++) seed += closes[i];
    let e = seed / seedN;
    for (let i = 0; i < n; i++) {
      if (i < seedN) ema[i] = e;
      else { e = closes[i] * ke + e * (1 - ke); ema[i] = e; }
    }
  }

  const atr = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const h = dataList[i].high, l = dataList[i].low;
    const pc = i > 0 ? dataList[i - 1].close : dataList[i].open;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    if (i === 0) atr[i] = tr;
    else if (i < atrLen) atr[i] = (atr[i - 1] * i + tr) / (i + 1);
    else atr[i] = (atr[i - 1] * (atrLen - 1) + tr) / atrLen;
  }

  // --- RSI(14) calculation (Wilder's RMA) ---
  const rsi = new Array(n).fill(null);
  {
    const rsiLen = 14;
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= rsiLen && i < n; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) avgGain += diff;
      else avgLoss += Math.abs(diff);
    }
    avgGain /= rsiLen;
    avgLoss /= rsiLen;
    if (n > rsiLen) {
      rsi[rsiLen] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
      for (let i = rsiLen + 1; i < n; i++) {
        const diff = closes[i] - closes[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? Math.abs(diff) : 0;
        avgGain = (avgGain * (rsiLen - 1) + gain) / rsiLen;
        avgLoss = (avgLoss * (rsiLen - 1) + loss) / rsiLen;
        rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
      }
    }
  }

  // Master signals output array
  const out = new Array(n).fill(null).map(() => ({}));

  // --- 1. HAIDER-GOLD-SCALPER (ONLY ON 5M) ---
  if (wantHaider) {
    const impulseMult = 1.0;
    const rsiBuyLevel = 35.0;
    const rsiSellLevel = 65.0;
    const targetLevel = 50.0;
    const slBuffer = 1.0;

    let setupState = 0;
    let setupBarIndex = -1;
    let setupHigh = 0, setupLow = 0, setupRange = 0;
    let tpLevel = 0, slLevel = 0;

    for (let i = 14; i < n; i++) {
      const kLine = dataList[i];
      const curAtr = atr[i] || (kLine.high - kLine.low);
      const curRsi = rsi[i];

      // Invalidate pending setup if SL touched
      if (setupState === 1 && kLine.high > slLevel) setupState = 0;
      if (setupState === -1 && kLine.low < slLevel) setupState = 0;

      // Fire signal on next candle open
      if (setupState === 1 && i > setupBarIndex) {
        const entry = kLine.open;
        const slDist = Math.max(Math.abs(slLevel - entry), 0.01);
        const tpDist = Math.max(Math.abs(entry - tpLevel), 0.01);
        out[i] = {
          signalType: 'SELL',
          strategy: 'Haider-Gold-Scalper',
          strategyId: 'REAL_DIP',
          entryPrice: entry,
          slPrice: slLevel,
          tp1Price: tpLevel,
          tp2Price: Math.max(0, entry - tpDist * 2),
          tp1_rr: +(tpDist / slDist).toFixed(2),
          tp2_rr: +(tpDist * 2 / slDist).toFixed(2),
          barHigh: kLine.high,
          barLow: kLine.low,
          riskUSD: slDist
        };
        setupState = 0;
      } else if (setupState === -1 && i > setupBarIndex) {
        const entry = kLine.open;
        const slDist = Math.max(Math.abs(entry - slLevel), 0.01);
        const tpDist = Math.max(Math.abs(tpLevel - entry), 0.01);
        out[i] = {
          signalType: 'BUY',
          strategy: 'Haider-Gold-Scalper',
          strategyId: 'REAL_DIP',
          entryPrice: entry,
          slPrice: slLevel,
          tp1Price: tpLevel,
          tp2Price: entry + tpDist * 2,
          tp1_rr: +(tpDist / slDist).toFixed(2),
          tp2_rr: +(tpDist * 2 / slDist).toFixed(2),
          barHigh: kLine.high,
          barLow: kLine.low,
          riskUSD: slDist
        };
        setupState = 0;
      }

      // Check candle i for setup formation on its close
      const candleBody = Math.abs(kLine.close - kLine.open);
      const candleRange = kLine.high - kLine.low;
      const isRealBuySetup = kLine.close < kLine.open && candleBody > (curAtr * impulseMult) && curRsi != null && curRsi < rsiBuyLevel;
      const isRealSellSetup = kLine.close > kLine.open && candleBody > (curAtr * impulseMult) && curRsi != null && curRsi > rsiSellLevel;

      if (isRealSellSetup && setupState === 0) {
        setupState = 1;
        setupBarIndex = i;
        setupHigh = kLine.high;
        setupLow = kLine.low;
        setupRange = candleRange;
        tpLevel = setupHigh - (setupRange * (targetLevel / 100));
        slLevel = setupHigh + (curAtr * slBuffer);
      } else if (isRealBuySetup && setupState === 0) {
        setupState = -1;
        setupBarIndex = i;
        setupHigh = kLine.high;
        setupLow = kLine.low;
        setupRange = candleRange;
        tpLevel = setupLow + (setupRange * (targetLevel / 100));
        slLevel = setupLow - (curAtr * slBuffer);
      }
    }
  }

  // --- 2. SWING CORE & PRO ENGINES ---
  if (wantPull || wantBreak) {
    const adx = new Array(n).fill(null);
    {
      let strP = 0, strM = 0, strTR = 0, adxPrev = null, dxCount = 0, dxSum = 0;
      for (let i = 1; i < n; i++) {
        const up = dataList[i].high - dataList[i - 1].high;
        const dn = dataList[i - 1].low - dataList[i].low;
        const plusDM = (up > dn && up > 0) ? up : 0;
        const minusDM = (dn > up && dn > 0) ? dn : 0;
        const h = dataList[i].high, l = dataList[i].low, pc = dataList[i - 1].close;
        const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
        if (i <= atrLen) { strP += plusDM; strM += minusDM; strTR += tr; }
        else {
          strP = strP - strP / atrLen + plusDM;
          strM = strM - strM / atrLen + minusDM;
          strTR = strTR - strTR / atrLen + tr;
        }
        if (i >= atrLen && strTR > 0) {
          const pDI = 100 * strP / strTR, mDI = 100 * strM / strTR;
          const denom = pDI + mDI;
          const dx = denom > 0 ? 100 * Math.abs(pDI - mDI) / denom : 0;
          if (adxPrev == null) { dxSum += dx; dxCount++; if (dxCount >= atrLen) { adxPrev = dxSum / dxCount; adx[i] = adxPrev; } }
          else { adxPrev = (adxPrev * (atrLen - 1) + dx) / atrLen; adx[i] = adxPrev; }
        }
      }
    }
    const MIN_ADX = 20;

    const mk = (kLine, isBuy, a, kind) => {
      const entry = kLine.close;
      const sl = isBuy ? Math.min(kLine.low, entry) - a * 0.5
                       : Math.max(kLine.high, entry) + a * 0.5;
      const slDist = Math.abs(entry - sl) || a;
      return {
        signalType: isBuy ? 'BUY' : 'SELL',
        strategy: kind === 'CORE' ? 'Swing Core' : 'Swing Pro',
        strategyId: kind === 'CORE' ? 'SWING_CORE' : 'SWING_PRO',
        entryPrice: entry,
        slPrice: sl,
        tp1Price: isBuy ? entry + slDist * 1.5 : entry - slDist * 1.5,
        tp2Price: isBuy ? entry + slDist * 3.0 : entry - slDist * 3.0,
        barHigh: kLine.high,
        barLow: kLine.low,
        riskUSD: slDist
      };
    };

    const startI = Math.max(period, breakoutLen);
    const cooldown = 4;
    let lastIdx = -1e9;

    for (let i = startI; i < n; i++) {
      // Don't overwrite an existing Haider signal on the same bar
      if (out[i] && out[i].signalType) continue;
      if (i - lastIdx < cooldown) continue;

      const kLine = dataList[i];
      const prev = dataList[i - 1];
      const slice = dataList.slice(i - period, i + 1);
      const sma = slice.reduce((s, b) => s + b.close, 0) / slice.length;
      const trend = ema[i];
      const a = atr[i] || Math.max(Math.abs(kLine.high - kLine.low), 4.0);
      const up = trend != null && kLine.close > trend;
      const dn = trend != null && kLine.close < trend;

      if (adx[i] != null && adx[i] < MIN_ADX) continue;

      // Engine 1: SWING_CORE
      if (wantPull) {
        const bull = kLine.close > kLine.open && prev.close < prev.open && kLine.close > prev.open && kLine.open < prev.close;
        const bear = kLine.close < kLine.open && prev.close > prev.open && kLine.close < prev.open && kLine.open > prev.close;
        if (up && bull && kLine.close > sma && kLine.low <= sma * 1.004) {
          out[i] = mk(kLine, true, a, 'CORE');
          lastIdx = i;
          continue;
        }
        if (dn && bear && kLine.close < sma && kLine.high >= sma * 0.996) {
          out[i] = mk(kLine, false, a, 'CORE');
          lastIdx = i;
          continue;
        }
      }

      // Engine 2: SWING_PRO
      if (wantBreak) {
        let hh = -Infinity, ll = Infinity;
        for (let j = i - breakoutLen; j < i; j++) {
          if (dataList[j].high > hh) hh = dataList[j].high;
          if (dataList[j].low < ll) ll = dataList[j].low;
        }
        if (up && kLine.close > hh && prev.close <= hh) {
          out[i] = mk(kLine, true, a, 'PRO');
          lastIdx = i;
          continue;
        }
        if (dn && kLine.close < ll && prev.close >= ll) {
          out[i] = mk(kLine, false, a, 'PRO');
          lastIdx = i;
          continue;
        }
      }
    }
  }

  // Resolve each signal on its own TP/SL walking forward
  for (let i = 0; i < n; i++) {
    const d = out[i];
    if (!d || !d.signalType) continue;
    const isBuy = d.signalType === 'BUY';
    let tp1Hit = false, outcome = 'OPEN', ri = n - 1;
    for (let j = i + 1; j < n; j++) {
      const hi = dataList[j].high, lo = dataList[j].low;
      if (isBuy) {
        if (lo <= d.slPrice && !tp1Hit) { outcome = 'SL'; ri = j; break; }
        if (hi >= d.tp2Price) { outcome = 'TP2'; ri = j; break; }
        if (hi >= d.tp1Price && !tp1Hit) { tp1Hit = true; ri = j; }
        if (lo <= d.slPrice && tp1Hit) { outcome = 'TP1'; ri = j; break; }
      } else {
        if (hi >= d.slPrice && !tp1Hit) { outcome = 'SL'; ri = j; break; }
        if (lo <= d.tp2Price) { outcome = 'TP2'; ri = j; break; }
        if (lo <= d.tp1Price && !tp1Hit) { tp1Hit = true; ri = j; }
        if (hi >= d.slPrice && tp1Hit) { outcome = 'TP1'; ri = j; break; }
      }
    }
    if (outcome === 'OPEN' && tp1Hit) outcome = 'TP1';
    d.outcome = outcome;
    d.drawEndIdx = ri;
  }

  return out;
}

export function scoreSignalSeries(series) {
  const sigs = (series || []).filter(d => d && d.signalType);
  const rMap = { TP2: 3, TP1: 1.5, SL: -1 };
  let wins = 0, losses = 0, resolved = 0, totalR = 0, winR = 0, unresolved = 0;
  sigs.forEach(d => {
    if (d.outcome === 'OPEN' || d.outcome == null) { unresolved++; return; }
    resolved++;
    const r = d.outcome === 'SL' ? -1
            : d.outcome === 'TP2' ? (d.tp2_rr ?? 3)
            : (d.tp1_rr ?? (rMap[d.outcome] ?? 0));
    totalR += r;
    if (r > 0) { wins++; winR += r; } else losses++;
  });
  const win_rate = resolved ? +(wins / resolved * 100).toFixed(1) : 0;
  const avgWinR = wins ? winR / wins : 0;
  const break_even_win_rate = avgWinR > 0 ? +(100 / (1 + avgWinR)).toFixed(1) : 0;
  const expectancy_R = resolved ? +(totalR / resolved).toFixed(3) : 0;
  const verdict = resolved < 20 ? 'NOT ENOUGH SIGNALS TO JUDGE'
    : expectancy_R > 0.05 ? 'POSITIVE EDGE (gross)'
    : expectancy_R < -0.05 ? 'NEGATIVE — NO EDGE'
    : 'FLAT / MARGINAL';
  return {
    total_signals: sigs.length,
    resolved,
    unresolved,
    wins,
    losses,
    win_rate,
    break_even_win_rate,
    expectancy_R,
    verdict,
  };
}
