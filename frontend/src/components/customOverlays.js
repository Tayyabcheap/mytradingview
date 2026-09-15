import { registerOverlay, registerIndicator } from 'klinecharts';
import { runPineById, getPineResult } from './pineEngine';
import { computeSignalSeries } from './signalCore';

// 1. RECTANGLE OVERLAY
const rectOverlay = {
  name: 'rect',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length >= 2) {
      const p1 = coordinates[0];
      const p2 = coordinates[1];
      return [
        {
          type: 'polygon',
          attrs: {
            coordinates: [
              p1,
              { x: p2.x, y: p1.y },
              p2,
              { x: p1.x, y: p2.y }
            ]
          },
          styles: {
            style: 'stroke_fill',
            color: 'rgba(41, 98, 255, 0.15)',
            borderColor: '#2962ff',
            borderWidth: 1
          }
        }
      ];
    }
    return [];
  }
};

// 2. LONG POSITION TOOL (Risk / Reward)
const longPositionOverlay = {
  name: 'longPosition',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, overlay }) => {
    if (coordinates.length >= 2) {
      const entry = coordinates[0];
      const target = coordinates[1];
      const stop = coordinates[2] || { x: target.x, y: entry.y + Math.abs(target.y - entry.y) * 0.5 };
      
      const width = Math.max(Math.abs(target.x - entry.x), 120);
      const rightX = entry.x + width;

      const points = overlay.points || [];
      const entryPrice = points[0]?.value || 0;
      const targetPrice = points[1]?.value || 0;
      const stopPrice = points[2]?.value || (entryPrice - Math.abs(targetPrice - entryPrice) * 0.5);
      const reward = Math.abs(targetPrice - entryPrice);
      const risk = Math.abs(entryPrice - stopPrice);
      const rr = risk > 0 ? (reward / risk).toFixed(2) : '1.00';

      return [
        // Target (Green) Area
        {
          type: 'polygon',
          attrs: {
            coordinates: [
              { x: entry.x, y: target.y },
              { x: rightX, y: target.y },
              { x: rightX, y: entry.y },
              { x: entry.x, y: entry.y }
            ]
          },
          styles: {
            style: 'stroke_fill',
            color: 'rgba(8, 153, 129, 0.2)',
            borderColor: '#089981',
            borderWidth: 1
          }
        },
        // Stop Loss (Red) Area
        {
          type: 'polygon',
          attrs: {
            coordinates: [
              { x: entry.x, y: entry.y },
              { x: rightX, y: entry.y },
              { x: rightX, y: stop.y },
              { x: entry.x, y: stop.y }
            ]
          },
          styles: {
            style: 'stroke_fill',
            color: 'rgba(242, 54, 69, 0.2)',
            borderColor: '#f23645',
            borderWidth: 1
          }
        },
        // Middle Entry Line
        {
          type: 'line',
          attrs: {
            coordinates: [
              { x: entry.x, y: entry.y },
              { x: rightX, y: entry.y }
            ]
          },
          styles: {
            color: '#787b86',
            size: 1,
            style: 'dashed'
          }
        },
        // Stats Label
        {
          type: 'text',
          attrs: {
            x: entry.x + 8,
            y: target.y + 16,
            text: `Target: ${targetPrice.toFixed(2)} | R:R: ${rr}`
          },
          styles: {
            color: '#089981',
            size: 11,
            family: 'Inter, sans-serif'
          }
        },
        {
          type: 'text',
          attrs: {
            x: entry.x + 8,
            y: stop.y - 6,
            text: `Stop: ${stopPrice.toFixed(2)} | Risk: ${risk.toFixed(2)}`
          },
          styles: {
            color: '#f23645',
            size: 11,
            family: 'Inter, sans-serif'
          }
        }
      ];
    }
    return [];
  }
};

// 3. SHORT POSITION TOOL (Risk / Reward)
const shortPositionOverlay = {
  name: 'shortPosition',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, overlay }) => {
    if (coordinates.length >= 2) {
      const entry = coordinates[0];
      const stop = coordinates[1];
      const target = coordinates[2] || { x: stop.x, y: entry.y + Math.abs(stop.y - entry.y) * 2 };
      
      const width = Math.max(Math.abs(stop.x - entry.x), 120);
      const rightX = entry.x + width;

      const points = overlay.points || [];
      const entryPrice = points[0]?.value || 0;
      const stopPrice = points[1]?.value || 0;
      const targetPrice = points[2]?.value || (entryPrice - Math.abs(stopPrice - entryPrice) * 2);
      const risk = Math.abs(stopPrice - entryPrice);
      const reward = Math.abs(entryPrice - targetPrice);
      const rr = risk > 0 ? (reward / risk).toFixed(2) : '2.00';

      return [
        {
          type: 'polygon',
          attrs: {
            coordinates: [
              { x: entry.x, y: stop.y },
              { x: rightX, y: stop.y },
              { x: rightX, y: entry.y },
              { x: entry.x, y: entry.y }
            ]
          },
          styles: {
            style: 'stroke_fill',
            color: 'rgba(242, 54, 69, 0.2)',
            borderColor: '#f23645',
            borderWidth: 1
          }
        },
        {
          type: 'polygon',
          attrs: {
            coordinates: [
              { x: entry.x, y: entry.y },
              { x: rightX, y: entry.y },
              { x: rightX, y: target.y },
              { x: entry.x, y: target.y }
            ]
          },
          styles: {
            style: 'stroke_fill',
            color: 'rgba(8, 153, 129, 0.2)',
            borderColor: '#089981',
            borderWidth: 1
          }
        },
        {
          type: 'line',
          attrs: {
            coordinates: [
              { x: entry.x, y: entry.y },
              { x: rightX, y: entry.y }
            ]
          },
          styles: {
            color: '#787b86',
            size: 1,
            style: 'dashed'
          }
        },
        {
          type: 'text',
          attrs: {
            x: entry.x + 8,
            y: stop.y + 16,
            text: `Stop: ${stopPrice.toFixed(2)} | Risk: ${risk.toFixed(2)}`
          },
          styles: {
            color: '#f23645',
            size: 11,
            family: 'Inter, sans-serif'
          }
        },
        {
          type: 'text',
          attrs: {
            x: entry.x + 8,
            y: target.y - 6,
            text: `Target: ${targetPrice.toFixed(2)} | R:R: ${rr}`
          },
          styles: {
            color: '#089981',
            size: 11,
            family: 'Inter, sans-serif'
          }
        }
      ];
    }
    return [];
  }
};

// 4. XABCD HARMONIC PATTERN
const xabcdOverlay = {
  name: 'xabcd',
  totalStep: 6,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length >= 2) {
      const labels = ['X', 'A', 'B', 'C', 'D'];
      const figures = [];

      for (let i = 0; i < coordinates.length - 1; i++) {
        figures.push({
          type: 'line',
          attrs: {
            coordinates: [coordinates[i], coordinates[i + 1]]
          },
          styles: {
            color: '#2962ff',
            size: 2
          }
        });
      }

      if (coordinates.length >= 3) {
        figures.push({
          type: 'polygon',
          attrs: {
            coordinates: [coordinates[0], coordinates[1], coordinates[2]]
          },
          styles: {
            style: 'fill',
            color: 'rgba(41, 98, 255, 0.12)'
          }
        });
      }
      if (coordinates.length >= 5) {
        figures.push({
          type: 'polygon',
          attrs: {
            coordinates: [coordinates[2], coordinates[3], coordinates[4]]
          },
          styles: {
            style: 'fill',
            color: 'rgba(255, 109, 0, 0.12)'
          }
        });
      }

      coordinates.forEach((c, idx) => {
        if (labels[idx]) {
          figures.push({
            type: 'text',
            attrs: {
              x: c.x - 4,
              y: c.y - 10,
              text: labels[idx]
            },
            styles: {
              color: '#ffffff',
              size: 13,
              weight: 'bold'
            }
          });
        }
      });

      return figures;
    }
    return [];
  }
};

// 5. ELLIOTT IMPULSE WAVE (1-2-3-4-5)
const fiveWavesOverlay = {
  name: 'fiveWaves',
  totalStep: 7,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length >= 2) {
      const labels = ['(0)', '(1)', '(2)', '(3)', '(4)', '(5)'];
      const figures = [];

      for (let i = 0; i < coordinates.length - 1; i++) {
        figures.push({
          type: 'line',
          attrs: {
            coordinates: [coordinates[i], coordinates[i + 1]]
          },
          styles: {
            color: '#f7a600',
            size: 2
          }
        });
      }

      coordinates.forEach((c, idx) => {
        if (labels[idx]) {
          figures.push({
            type: 'text',
            attrs: {
              x: c.x - 8,
              y: c.y - 10,
              text: labels[idx]
            },
            styles: {
              color: '#f7a600',
              size: 12,
              weight: 'bold'
            }
          });
        }
      });

      return figures;
    }
    return [];
  }
};

// 6. ELLIOTT CORRECTION WAVE (A-B-C)
const threeWavesOverlay = {
  name: 'threeWaves',
  totalStep: 5,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length >= 2) {
      const labels = ['(0)', '(A)', '(B)', '(C)'];
      const figures = [];

      for (let i = 0; i < coordinates.length - 1; i++) {
        figures.push({
          type: 'line',
          attrs: {
            coordinates: [coordinates[i], coordinates[i + 1]]
          },
          styles: {
            color: '#e040fb',
            size: 2
          }
        });
      }

      coordinates.forEach((c, idx) => {
        if (labels[idx]) {
          figures.push({
            type: 'text',
            attrs: {
              x: c.x - 8,
              y: c.y - 10,
              text: labels[idx]
            },
            styles: {
              color: '#e040fb',
              size: 12,
              weight: 'bold'
            }
          });
        }
      });

      return figures;
    }
    return [];
  }
};

// 7. HEAD AND SHOULDERS PATTERN
const headAndShouldersOverlay = {
  name: 'headAndShoulders',
  totalStep: 8,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length >= 2) {
      const labels = ['LS', 'Neck 1', 'Head', 'Neck 2', 'RS', 'Breakout'];
      const figures = [];

      for (let i = 0; i < coordinates.length - 1; i++) {
        figures.push({
          type: 'line',
          attrs: {
            coordinates: [coordinates[i], coordinates[i + 1]]
          },
          styles: {
            color: '#00e676',
            size: 2
          }
        });
      }

      coordinates.forEach((c, idx) => {
        if (labels[idx]) {
          figures.push({
            type: 'text',
            attrs: {
              x: c.x - 12,
              y: c.y - 10,
              text: labels[idx]
            },
            styles: {
              color: '#00e676',
              size: 11,
              weight: 'bold'
            }
          });
        }
      });

      return figures;
    }
    return [];
  }
};

// 7b. MEASURE TOOLS (TradingView-style ruler)
// Drag two points; shows price change (abs + %), bar count and elapsed time.
// Three variants share one renderer: price-only, date-only, and both.
function _fmtTime(ms) {
  const mins = Math.round(ms / 60000);
  if (mins >= 1440) return (mins / 1440).toFixed(mins % 1440 ? 1 : 0) + 'd';
  if (mins >= 60) return (mins / 60).toFixed(mins % 60 ? 1 : 0) + 'h';
  return mins + 'm';
}
function _measureFigures({ coordinates, overlay }, mode) {
  if (coordinates.length < 2) return [];
  const p1 = coordinates[0], p2 = coordinates[1];
  const pts = overlay.points || [];
  const v1 = pts[0] && typeof pts[0].value === 'number' ? pts[0].value : 0;
  const v2 = pts[1] && typeof pts[1].value === 'number' ? pts[1].value : 0;
  const diff = v2 - v1;
  const pct = v1 ? (diff / v1) * 100 : 0;
  const up = diff >= 0;
  const color = up ? '#089981' : '#f23645';
  const fill = up ? 'rgba(8,153,129,0.15)' : 'rgba(242,54,69,0.15)';
  const i1 = pts[0] && pts[0].dataIndex, i2 = pts[1] && pts[1].dataIndex;
  const bars = (typeof i1 === 'number' && typeof i2 === 'number') ? Math.abs(i2 - i1) : null;
  const t1 = pts[0] && pts[0].timestamp, t2 = pts[1] && pts[1].timestamp;
  const timeStr = (t1 && t2) ? _fmtTime(Math.abs(t2 - t1)) : '';

  const leftX = Math.min(p1.x, p2.x), rightX = Math.max(p1.x, p2.x);
  const topY = Math.min(p1.y, p2.y), botY = Math.max(p1.y, p2.y);
  const midX = (leftX + rightX) / 2;
  const priceLine = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}  (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
  const dateLine = `${bars != null ? bars + ' bars' : ''}${bars != null && timeStr ? ',  ' : ''}${timeStr}`;

  const figs = [];
  figs.push({
    type: 'polygon',
    attrs: { coordinates: [{ x: leftX, y: topY }, { x: rightX, y: topY }, { x: rightX, y: botY }, { x: leftX, y: botY }] },
    styles: { style: 'stroke_fill', color: fill, borderColor: color, borderSize: 1, borderStyle: 'solid' }
  });
  if (mode === 'price') {
    figs.push({ type: 'line', attrs: { coordinates: [{ x: midX, y: p1.y }, { x: midX, y: p2.y }] }, styles: { color, size: 2, style: 'solid' } });
  } else if (mode === 'date') {
    figs.push({ type: 'line', attrs: { coordinates: [{ x: p1.x, y: (topY + botY) / 2 }, { x: p2.x, y: (topY + botY) / 2 }] }, styles: { color, size: 2, style: 'solid' } });
  } else {
    figs.push({ type: 'line', attrs: { coordinates: [{ x: p1.x, y: p1.y }, { x: p2.x, y: p2.y }] }, styles: { color, size: 2, style: 'solid' } });
  }
  const showPrice = mode !== 'date';
  const showDate = mode !== 'price';
  let ly = topY - 6;
  if (showDate && dateLine) {
    figs.push({
      type: 'text',
      attrs: { x: midX, y: ly, text: dateLine, align: 'center', baseline: 'bottom' },
      styles: { style: 'fill', color: '#ffffff', size: 10, family: 'Inter, sans-serif', backgroundColor: 'rgba(19,23,34,0.85)', borderColor: color, borderSize: 1, borderRadius: 3, paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2 }
    });
    ly -= 20;
  }
  if (showPrice) {
    figs.push({
      type: 'text',
      attrs: { x: midX, y: ly, text: priceLine, align: 'center', baseline: 'bottom' },
      styles: { style: 'fill', color: '#ffffff', size: 12, weight: 'bold', family: 'Inter, sans-serif', backgroundColor: color, borderRadius: 3, paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3 }
    });
  }
  return figs;
}
const measureOverlay = {
  name: 'measure', totalStep: 3,
  needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true,
  createPointFigures: (p) => _measureFigures(p, 'both')
};
const measurePriceOverlay = {
  name: 'measurePrice', totalStep: 3,
  needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true,
  createPointFigures: (p) => _measureFigures(p, 'price')
};
const measureDateOverlay = {
  name: 'measureDate', totalStep: 3,
  needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true,
  createPointFigures: (p) => _measureFigures(p, 'date')
};

// 8. MULTI-LINE EXPONENTIAL MOVING AVERAGE (EMA)
const customEMAIndicator = {
  name: 'EMA',
  shortName: 'EMA',
  series: 'price',
  calcParams: [9, 21, 50, 200],
  figures: [
    { key: 'ema1', title: 'EMA9: ', type: 'line' },
    { key: 'ema2', title: 'EMA21: ', type: 'line' },
    { key: 'ema3', title: 'EMA50: ', type: 'line' },
    { key: 'ema4', title: 'EMA200: ', type: 'line' }
  ],
  styles: {
    lines: [
      { color: '#2962ff', size: 1.5, style: 'solid' },
      { color: '#ff9800', size: 1.5, style: 'solid' },
      { color: '#9c27b0', size: 1.5, style: 'solid' },
      { color: '#fdd835', size: 1.5, style: 'solid' }
    ]
  },
  calc: (dataList, { calcParams }) => {
    const p1 = calcParams[0] || 9;
    const p2 = calcParams[1] || 21;
    const p3 = calcParams[2] || 50;
    const p4 = calcParams[3] || 200;

    const calcEmaArray = (period) => {
      const k = 2 / (period + 1);
      let prev = null;
      return dataList.map((d, i) => {
        if (i === 0) {
          prev = d.close;
          return d.close;
        }
        const val = d.close * k + prev * (1 - k);
        prev = val;
        return val;
      });
    };

    const ema1Arr = calcEmaArray(p1);
    const ema2Arr = calcEmaArray(p2);
    const ema3Arr = calcEmaArray(p3);
    const ema4Arr = calcEmaArray(p4);

    return dataList.map((_, i) => ({
      ema1: ema1Arr[i],
      ema2: ema2Arr[i],
      ema3: ema3Arr[i],
      ema4: ema4Arr[i]
    }));
  }
};

// 9. MULTI-LINE SIMPLE MOVING AVERAGE (SMA / MA)
const customSMAIndicator = {
  name: 'MA',
  shortName: 'SMA',
  series: 'price',
  calcParams: [20, 50, 100, 200],
  figures: [
    { key: 'ma1', title: 'SMA20: ', type: 'line' },
    { key: 'ma2', title: 'SMA50: ', type: 'line' },
    { key: 'ma3', title: 'SMA100: ', type: 'line' },
    { key: 'ma4', title: 'SMA200: ', type: 'line' }
  ],
  styles: {
    lines: [
      { color: '#2962ff', size: 1.5, style: 'solid' },
      { color: '#ff9800', size: 1.5, style: 'solid' },
      { color: '#9c27b0', size: 1.5, style: 'solid' },
      { color: '#fdd835', size: 1.5, style: 'solid' }
    ]
  },
  calc: (dataList, { calcParams }) => {
    const p1 = calcParams[0] || 20;
    const p2 = calcParams[1] || 50;
    const p3 = calcParams[2] || 100;
    const p4 = calcParams[3] || 200;

    const calcSmaArray = (period) => {
      let sum = 0;
      return dataList.map((d, i) => {
        sum += d.close;
        if (i >= period) {
          sum -= dataList[i - period].close;
          return sum / period;
        }
        return sum / (i + 1);
      });
    };

    const ma1Arr = calcSmaArray(p1);
    const ma2Arr = calcSmaArray(p2);
    const ma3Arr = calcSmaArray(p3);
    const ma4Arr = calcSmaArray(p4);

    return dataList.map((_, i) => ({
      ma1: ma1Arr[i],
      ma2: ma2Arr[i],
      ma3: ma3Arr[i],
      ma4: ma4Arr[i]
    }));
  }
};

// 10. LUXALGO SMART MONEY CONCEPTS (SMC) CUSTOM INDICATOR
const luxAlgoSMCIndicator = {
  name: 'LuxAlgo_SMC',
  shortName: 'Lux SMC',
  series: 'price',
  calcParams: [10],
  figures: [
    { key: 'obBullTop', title: 'Bullish OB: ', type: 'line' },
    { key: 'obBullBottom', title: '', type: 'line' },
    { key: 'obBearTop', title: 'Bearish OB: ', type: 'line' },
    { key: 'obBearBottom', title: '', type: 'line' }
  ],
  styles: {
    lines: [
      { color: '#089981', size: 1.5, style: 'dashed' },
      { color: '#089981', size: 1.5, style: 'solid' },
      { color: '#f23645', size: 1.5, style: 'dashed' },
      { color: '#f23645', size: 1.5, style: 'solid' }
    ]
  },
  calc: (dataList, { calcParams }) => {
    const period = calcParams[0] || 10;
    return dataList.map((kLine, i) => {
      if (i < period) return {};
      
      const slice = dataList.slice(Math.max(0, i - period), i + 1);
      const high = Math.max(...slice.map(d => d.high));
      const low = Math.min(...slice.map(d => d.low));
      
      const isBull = kLine.close > kLine.open;
      return {
        obBullTop: isBull ? low + (high - low) * 0.25 : undefined,
        obBullBottom: isBull ? low : undefined,
        obBearTop: !isBull ? high : undefined,
        obBearBottom: !isBull ? high - (high - low) * 0.25 : undefined
      };
    });
  }
};

// 11. SUPERTREND CUSTOM INDICATOR
const supertrendIndicator = {
  name: 'SUPERTREND',
  shortName: 'Supertrend',
  series: 'price',
  calcParams: [10, 3],
  figures: [
    { key: 'upTrend', title: 'Up: ', type: 'line' },
    { key: 'downTrend', title: 'Down: ', type: 'line' }
  ],
  styles: {
    lines: [
      { color: '#089981', size: 2, style: 'solid' },
      { color: '#f23645', size: 2, style: 'solid' }
    ]
  },
  calc: (dataList, { calcParams }) => {
    const period = calcParams[0] || 10;
    const multiplier = calcParams[1] || 3;
    const n = dataList.length;
    // FIX: use a proper Wilder ATR over `period`, not the single-bar true range.
    const atrArr = _rma(_tr(dataList), period);

    let trend = 1, prevFinalUp = 0, prevFinalDown = 0, started = false;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const atr = atrArr[i];
      if (atr == null || i === 0) { out[i] = {}; continue; }
      const kLine = dataList[i];
      const prevClose = dataList[i - 1].close;
      const hl2 = (kLine.high + kLine.low) / 2;
      const basicUp = hl2 - multiplier * atr;    // lower band (support in uptrend)
      const basicDown = hl2 + multiplier * atr;  // upper band (resistance in downtrend)

      const finalUp = (!started || basicUp > prevFinalUp || prevClose < prevFinalUp) ? basicUp : prevFinalUp;
      const finalDown = (!started || basicDown < prevFinalDown || prevClose > prevFinalDown) ? basicDown : prevFinalDown;

      if (!started) { trend = kLine.close >= hl2 ? 1 : -1; started = true; }
      else if (trend === 1 && kLine.close < prevFinalUp) trend = -1;
      else if (trend === -1 && kLine.close > prevFinalDown) trend = 1;

      prevFinalUp = finalUp;
      prevFinalDown = finalDown;
      out[i] = {
        upTrend: trend === 1 ? finalUp : undefined,
        downTrend: trend === -1 ? finalDown : undefined
      };
    }
    return out;
  }
};

// 12. SIGNALS DUAL-STRATEGY OVERLAY WITH DIRECT ON-CANDLE DRAW
const signalsIndicator = {
  name: 'SIGNALS',
  shortName: 'Signals',
  series: 'price',
  calcParams: ['ALL'],
  figures: [ { key: 'entryPrice', title: 'Signals: ', type: 'line' } ],
  styles: { lines: [ { color: 'transparent', size: 0 } ] },
  calc: (dataList, { calcParams }) => computeSignalSeries(
    dataList, 
    (calcParams && calcParams[0]) || 'ALL', 
    20, 
    (calcParams && calcParams[1]) || '5M'
  ),
  draw: ({ ctx, indicator, xAxis, yAxis }) => {
    const result = indicator.result || [];
    if (!result.length) return true;
    const W = (ctx.canvas && ctx.canvas.width) || 4000;
    const H = (ctx.canvas && ctx.canvas.height) || 2000;
    const STATUS = {
      OPEN: { t: 'In Process',       bg: '#2962ff' },
      SL:   { t: 'SL Hit',           bg: '#f23645' },
      TP1:  { t: 'TP 50% Achieved',  bg: 'rgba(8,153,129,0.9)' },
      TP2:  { t: 'TP 100% Achieved', bg: '#089981' }
    };

    result.forEach((d, idx) => {
      if (!d || !d.signalType) return;
      const x = xAxis.convertToPixel(idx);
      if (x < -40 || x > W + 40) return;
      const isBuy = d.signalType === 'BUY';
      const accent = isBuy ? '#089981' : '#f23645';
      const st = STATUS[d.outcome] || STATUS.OPEN;
      const yHigh = yAxis.convertToPixel(d.barHigh);
      const yLow = yAxis.convertToPixel(d.barLow);

      // Small arrow just outside the entry candle wick (does not cover the body)
      ctx.save();
      ctx.fillStyle = accent;
      const ay = isBuy ? yLow + 6 : yHigh - 6;
      ctx.beginPath();
      if (isBuy) { ctx.moveTo(x, ay - 7); ctx.lineTo(x - 5, ay + 2); ctx.lineTo(x + 5, ay + 2); }
      else { ctx.moveTo(x, ay + 7); ctx.lineTo(x - 5, ay - 2); ctx.lineTo(x + 5, ay - 2); }
      ctx.closePath(); ctx.fill();
      ctx.restore();

      // Format card rows to 3 decimal places
      const isChamp = d.strategyId === 'CHAMPION_SCALPER' || d.isChampion;
      const isEnh = d.strategyId === 'HAIDER_ENHANCED' || d.isEnhanced;
      const cardTitle = isChamp
        ? `${isBuy ? '\u25B2 BUY [CHAMPION]' : '\u25BC SELL [CHAMPION]'}  ${d.entryPrice.toFixed(3)}`
        : (isEnh 
          ? `${isBuy ? '\u25B2 BUY [ENHANCED]' : '\u25BC SELL [ENHANCED]'}  ${d.entryPrice.toFixed(3)}`
          : `${isBuy ? '\u25B2 BUY' : '\u25BC SELL'}  ${d.entryPrice.toFixed(3)}`);

      const tp1Pips = d.tp1_pips ?? +(Math.abs(d.tp1Price - d.entryPrice) * 10).toFixed(1);
      const tp1Usd = d.tp1_usd ?? +(tp1Pips * 1.0).toFixed(2);
      const slPips = d.sl_pips ?? +(Math.abs(d.entryPrice - d.slPrice) * 10).toFixed(1);
      const slUsd = d.sl_usd ?? +(slPips * 1.0).toFixed(2);
      const hasTp2 = d.tp2Price && Math.abs(d.tp2Price - d.tp1Price) > 0.001;
      const tp2Pips = hasTp2 ? (d.tp2_pips ?? +(Math.abs(d.tp2Price - d.entryPrice) * 10).toFixed(1)) : 0;
      const tp2Usd = hasTp2 ? (d.tp2_usd ?? +(tp2Pips * 1.0).toFixed(2)) : 0;

      const titleColor = isChamp ? '#10b981' : (isEnh ? '#00f2fe' : accent);
      const rows = [
        { t: cardTitle, c: titleColor, bold: true },
        { t: `TP1  ${d.tp1Price.toFixed(3)} (+${tp1Pips}p / +$${tp1Usd})`, c: '#2ea88f' },
        ...(hasTp2 ? [{ t: `TP2  ${d.tp2Price.toFixed(3)} (+${tp2Pips}p / +$${tp2Usd})`, c: '#089981' }] : []),
        { t: `SL   ${d.slPrice.toFixed(3)} (-${slPips}p / -$${slUsd})`, c: '#f23645' },
        { t: st.t, badge: true, bg: st.bg }
      ];
      ctx.font = 'bold 10px Inter, sans-serif';
      let cw = 0; rows.forEach(r => { cw = Math.max(cw, ctx.measureText(r.t).width); });
      cw += 14;
      const lh = 14, padY = 5, ch = rows.length * lh + padY * 2;

      const gap = 22;
      let cy = isBuy ? (yLow + gap) : (yHigh - gap - ch);
      cy = Math.max(4, Math.min(cy, H - ch - 4));
      let cx = Math.max(4, Math.min(x - cw / 2, W - cw - 4));

      // Dotted leader line marking WHICH candle the signal started from
      ctx.save();
      ctx.setLineDash([2, 3]); ctx.strokeStyle = isEnh ? '#00f2fe' : accent; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
      ctx.beginPath();
      if (isBuy) { ctx.moveTo(x, ay + 2); ctx.lineTo(x, cy); }
      else { ctx.moveTo(x, ay - 2); ctx.lineTo(x, cy + ch); }
      ctx.stroke();
      ctx.restore();

      // Card
      ctx.save();
      ctx.fillStyle = 'rgba(19,23,34,0.96)';
      ctx.strokeStyle = isEnh ? '#00f2fe' : accent; ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(cx, cy, cw, ch, 5); else ctx.rect(cx, cy, cw, ch);
      ctx.fill(); ctx.stroke();
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      rows.forEach((r, i) => {
        const ry = cy + padY + lh * i + lh / 2;
        if (r.badge) {
          ctx.fillStyle = r.bg;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(cx + 5, ry - lh / 2 + 2, cw - 10, lh - 4, 3);
          else ctx.rect(cx + 5, ry - lh / 2 + 2, cw - 10, lh - 4);
          ctx.fill();
          ctx.fillStyle = '#fff'; ctx.font = 'bold 9px Inter, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(r.t, cx + cw / 2, ry + 1); ctx.textAlign = 'left';
        } else {
          ctx.fillStyle = r.c;
          ctx.font = r.bold ? 'bold 10.5px Inter, sans-serif' : '10px Inter, sans-serif';
          ctx.fillText(r.t, cx + 8, ry);
        }
      });
      ctx.restore();

      // --- ON-CHART HORIZONTAL TP / SL / ENTRY LINES & PRICE PILL BADGES ---
      const endIdx = d.drawEndIdx != null && d.drawEndIdx > idx ? d.drawEndIdx : Math.min(idx + 24, result.length - 1);
      let xEnd = xAxis.convertToPixel(endIdx);
      if (xEnd <= x + 20) xEnd = x + 70;
      xEnd = Math.min(xEnd, W - 8);

      const yEntry = yAxis.convertToPixel(d.entryPrice);
      const yTp1 = yAxis.convertToPixel(d.tp1Price);
      const ySl = yAxis.convertToPixel(d.slPrice);

      // 1. Shaded Risk / Reward zones (subtle fill)
      ctx.save();
      ctx.fillStyle = 'rgba(8, 153, 129, 0.07)';
      ctx.fillRect(x, Math.min(yEntry, yTp1), xEnd - x, Math.abs(yEntry - yTp1));
      ctx.fillStyle = 'rgba(242, 54, 69, 0.07)';
      ctx.fillRect(x, Math.min(yEntry, ySl), xEnd - x, Math.abs(yEntry - ySl));
      ctx.restore();

      // 2. Entry Line
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, yEntry);
      ctx.lineTo(xEnd, yEntry);
      ctx.stroke();
      ctx.restore();

      // Helper function to draw pill badge on line
      const drawLevelBadge = (label, text, px, py, bgColor) => {
        ctx.save();
        ctx.font = 'bold 9.5px Inter, sans-serif';
        const str = `${label} ${text}`;
        const tw = ctx.measureText(str).width;
        const bw = tw + 10;
        const bh = 16;
        const bx = Math.min(px + 4, W - bw - 4);
        const by = py - bh / 2;

        ctx.fillStyle = bgColor;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 3);
        else ctx.rect(bx, by, bw, bh);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(str, bx + bw / 2, py + 0.5);
        ctx.restore();
      };

      // 3. Take Profit 1 Line & Badge
      ctx.save();
      ctx.strokeStyle = '#089981';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x, yTp1);
      ctx.lineTo(xEnd, yTp1);
      ctx.stroke();
      ctx.restore();
      drawLevelBadge('TP1', `${d.tp1Price.toFixed(3)} (+${tp1Pips}p)`, xEnd, yTp1, '#089981');

      // 4. Take Profit 2 Line & Badge (if defined and distinct)
      if (hasTp2) {
        const yTp2 = yAxis.convertToPixel(d.tp2Price);
        ctx.save();
        ctx.strokeStyle = '#26a69a';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(x, yTp2);
        ctx.lineTo(xEnd, yTp2);
        ctx.stroke();
        ctx.restore();
        drawLevelBadge('TP2', `${d.tp2Price.toFixed(3)} (+${tp2Pips}p)`, xEnd, yTp2, '#26a69a');
      }

      // 5. Stop Loss Line & Badge
      ctx.save();
      ctx.strokeStyle = '#f23645';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x, ySl);
      ctx.lineTo(xEnd, ySl);
      ctx.stroke();
      ctx.restore();
      drawLevelBadge('SL', `${d.slPrice.toFixed(3)} (-${slPips}p)`, xEnd, ySl, '#f23645');
    });
    return true;
  }
};

// 13. VOLUME WEIGHTED AVERAGE PRICE (VWAP)
const vwapIndicator = {
  name: 'VWAP',
  shortName: 'VWAP',
  series: 'price',
  calcParams: [],
  figures: [
    { key: 'vwap', title: 'VWAP: ', type: 'line' },
    { key: 'upper', title: 'Upper Band: ', type: 'line' },
    { key: 'lower', title: 'Lower Band: ', type: 'line' }
  ],
  styles: {
    lines: [
      { color: '#f7a600', size: 2, style: 'solid' },
      { color: 'rgba(247, 166, 0, 0.4)', size: 1, style: 'dashed' },
      { color: 'rgba(247, 166, 0, 0.4)', size: 1, style: 'dashed' }
    ]
  },
  calc: (dataList) => {
    // FIX: session-anchored VWAP (resets each UTC day on intraday data) with
    // REAL volume-weighted standard-deviation bands (previous version reset
    // never and used a fake 1-bar "std").
    let tpv = 0, vv = 0, tp2v = 0, dayKey = null;
    return dataList.map((kLine, i) => {
      const ts = kLine.timestamp || 0;
      const d = new Date(ts);
      const key = d.getUTCFullYear() + '-' + d.getUTCMonth() + '-' + d.getUTCDate();
      const prevTs = i > 0 ? (dataList[i - 1].timestamp || ts) : ts;
      const intraday = (ts - prevTs) < 23 * 3600 * 1000;   // daily+ charts don't reset
      if (intraday && key !== dayKey) { tpv = 0; vv = 0; tp2v = 0; }
      dayKey = key;
      const tp = (kLine.high + kLine.low + kLine.close) / 3;
      const vol = kLine.volume || 1;
      tpv += tp * vol; vv += vol; tp2v += tp * tp * vol;
      const vwap = vv > 0 ? tpv / vv : tp;
      const variance = vv > 0 ? Math.max(0, tp2v / vv - vwap * vwap) : 0;
      const sd = Math.sqrt(variance);
      return { vwap, upper: vwap + 1.5 * sd, lower: vwap - 1.5 * sd };
    });
  }
};

// 14. GOLD SCALPER PRO — EMA(21/50) crossover + RSI momentum + ATR SL/TP + session
// Ported from the "Gold Scalper Pro - Intraday Strategy" Pine v6 strategy.
// calcParams: [fastLen, slowLen, rsiLen, atrLen, slMult, tpMult, sessStartHourUTC, sessEndHourUTC]
const goldScalperIndicator = {
  name: 'GOLD_SCALPER',
  shortName: 'Gold Scalper',
  series: 'price',
  calcParams: [21, 50, 14, 14, 1.5, 2.5, 8, 12],
  figures: [
    { key: 'emaFast', title: 'EMA Fast: ', type: 'line' },
    { key: 'emaSlow', title: 'EMA Slow: ', type: 'line' }
  ],
  styles: {
    lines: [
      { color: '#ffd600', size: 2, style: 'solid' },
      { color: '#ff9800', size: 2, style: 'solid' }
    ]
  },
  calc: (dataList, { calcParams }) => {
    const fastLen = calcParams[0] ?? 21;
    const slowLen = calcParams[1] ?? 50;
    const rsiLen  = calcParams[2] ?? 14;
    const atrLen  = calcParams[3] ?? 14;
    const slMult  = calcParams[4] ?? 1.5;
    const tpMult  = calcParams[5] ?? 2.5;
    const sessStart = calcParams[6] ?? 8;   // UTC hour inclusive
    const sessEnd   = calcParams[7] ?? 12;  // UTC hour exclusive
    const rsiOB = 70, rsiOS = 30;

    const n = dataList.length;
    if (n === 0) return [];
    const closes = dataList.map(d => d.close);

    // EMA
    const emaOf = (arr, len) => {
      const k = 2 / (len + 1);
      const out = new Array(arr.length);
      let prev = arr[0];
      for (let i = 0; i < arr.length; i++) {
        prev = i === 0 ? arr[0] : arr[i] * k + prev * (1 - k);
        out[i] = prev;
      }
      return out;
    };
    const emaF = emaOf(closes, fastLen);
    const emaS = emaOf(closes, slowLen);

    // Wilder RSI
    const rsi = new Array(n).fill(undefined);
    let avgG = 0, avgL = 0;
    for (let i = 1; i < n; i++) {
      const ch = closes[i] - closes[i - 1];
      const g = ch > 0 ? ch : 0;
      const l = ch < 0 ? -ch : 0;
      if (i <= rsiLen) {
        avgG += g; avgL += l;
        if (i === rsiLen) { avgG /= rsiLen; avgL /= rsiLen; rsi[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL); }
      } else {
        avgG = (avgG * (rsiLen - 1) + g) / rsiLen;
        avgL = (avgL * (rsiLen - 1) + l) / rsiLen;
        rsi[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
      }
    }

    // Wilder ATR
    const tr = new Array(n);
    for (let i = 0; i < n; i++) {
      const d = dataList[i];
      tr[i] = i === 0 ? (d.high - d.low)
        : Math.max(d.high - d.low, Math.abs(d.high - closes[i - 1]), Math.abs(d.low - closes[i - 1]));
    }
    const atr = new Array(n).fill(undefined);
    let seed = 0;
    for (let i = 0; i < n; i++) {
      if (i < atrLen) { seed += tr[i]; if (i === atrLen - 1) atr[i] = seed / atrLen; }
      else atr[i] = (atr[i - 1] * (atrLen - 1) + tr[i]) / atrLen;
    }

    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const row = { emaFast: emaF[i], emaSlow: emaS[i] };
      const r = rsi[i], a = atr[i];
      if (i > 0 && r !== undefined && a !== undefined) {
        const crossUp = emaF[i] > emaS[i] && emaF[i - 1] <= emaS[i - 1];
        const crossDn = emaF[i] < emaS[i] && emaF[i - 1] >= emaS[i - 1];
        const bull = r > 50 && r < rsiOB;
        const bear = r < 50 && r > rsiOS;
        const h = new Date(dataList[i].timestamp).getUTCHours();
        const inSession = h >= sessStart && h < sessEnd;
        const c = closes[i];
        if (crossUp && bull && inSession) {
          row.signalType = 'BUY';
          row.entryPrice = c;
          row.slPrice = c - a * slMult;
          row.tpPrice = c + a * tpMult;
          row.rr = (a * tpMult) / (a * slMult);
        } else if (crossDn && bear && inSession) {
          row.signalType = 'SELL';
          row.entryPrice = c;
          row.slPrice = c + a * slMult;
          row.tpPrice = c - a * tpMult;
          row.rr = (a * tpMult) / (a * slMult);
        }
      }
      out[i] = row;
    }
    return out;
  },
  draw: ({ ctx, indicator, xAxis, yAxis }) => {
    const result = indicator.result || [];
    if (!result.length) return true;

    result.forEach((d, idx) => {
      if (!d || !d.signalType) return;
      const x = xAxis.convertToPixel(idx);
      if (x < -100 || x > 6000) return;
      const isBuy = d.signalType === 'BUY';
      const color = isBuy ? '#089981' : '#f23645';
      const yEntry = yAxis.convertToPixel(d.entryPrice);
      const ySL = yAxis.convertToPixel(d.slPrice);
      const yTP = yAxis.convertToPixel(d.tpPrice);

      ctx.save();

      // SL / TP short dashed guide lines to the right of the signal
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#f23645';
      ctx.beginPath(); ctx.moveTo(x, ySL); ctx.lineTo(x + 46, ySL); ctx.stroke();
      ctx.strokeStyle = '#089981';
      ctx.beginPath(); ctx.moveTo(x, yTP); ctx.lineTo(x + 46, yTP); ctx.stroke();
      ctx.setLineDash([]);

      // Arrow
      const ay = isBuy ? yEntry + 14 : yEntry - 14;
      ctx.fillStyle = color;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      if (isBuy) { ctx.moveTo(x, ay - 8); ctx.lineTo(x - 7, ay + 5); ctx.lineTo(x + 7, ay + 5); }
      else { ctx.moveTo(x, ay + 8); ctx.lineTo(x - 7, ay - 5); ctx.lineTo(x + 7, ay - 5); }
      ctx.closePath(); ctx.fill();

      // Badge
      const text = `${isBuy ? '▲ BUY' : '▼ SELL'} ${d.entryPrice ? d.entryPrice.toFixed(3) : ''}`;
      ctx.font = 'bold 10px Inter, sans-serif';
      const bw = ctx.measureText(text).width + 10;
      const bh = 18;
      const bx = x - bw / 2;
      const by = isBuy ? ay + 8 : ay - 8 - bh;
      ctx.fillStyle = isBuy ? 'rgba(8,153,129,0.95)' : 'rgba(242,54,69,0.95)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 4); else ctx.rect(bx, by, bw, bh);
      ctx.fill();
      ctx.strokeStyle = color; ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, x, by + bh / 2);

      ctx.restore();
    });

    return true;
  }
};

// 15. PINE — runs a pasted Pine Script (subset) on the chart.
// The script source lives in the engine registry (keyed by calcParams[0]);
// plots become line figures, plotshape/strategy.entry become drawn markers.
const pineIndicator = {
  name: 'PINE',
  shortName: 'Pine',
  series: 'price',
  calcParams: [''],
  figures: [
    { key: 'plot0', title: 'P1: ', type: 'line' },
    { key: 'plot1', title: 'P2: ', type: 'line' },
    { key: 'plot2', title: 'P3: ', type: 'line' },
    { key: 'plot3', title: 'P4: ', type: 'line' },
    { key: 'plot4', title: 'P5: ', type: 'line' },
    { key: 'plot5', title: 'P6: ', type: 'line' }
  ],
  styles: {
    lines: [
      { color: '#2962ff', size: 1 }, { color: '#ff9800', size: 1 }, { color: '#9c27b0', size: 1 },
      { color: '#00bcd4', size: 1 }, { color: '#ffd600', size: 1 }, { color: '#e040fb', size: 1 }
    ]
  },
  calc: (dataList, { calcParams }) => {
    const id = calcParams && calcParams[0];
    let res = null;
    try { res = id ? runPineById(id, dataList) : null; } catch (e) { res = null; }
    const plots = res ? res.plots : [];
    return dataList.map((_, i) => {
      const row = {};
      for (let pi = 0; pi < plots.length && pi < 6; pi++) row['plot' + pi] = plots[pi].data[i];
      return row;
    });
  },
  draw: ({ ctx, indicator, xAxis, yAxis }) => {
    const id = indicator.calcParams && indicator.calcParams[0];
    const res = id ? getPineResult(id) : null;
    if (!res) return true;
    const w = (ctx.canvas && ctx.canvas.width) || 4000;
    ctx.save();

    // horizontal lines (hline)
    (res.hlines || []).forEach(hl => {
      if (hl.value === undefined || isNaN(hl.value)) return;
      const y = yAxis.convertToPixel(hl.value);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = hl.color || '#787b86';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    });
    ctx.setLineDash([]);

    // signal markers (plotshape / strategy.entry)
    (res.shapes || []).forEach(sh => {
      const x = xAxis.convertToPixel(sh.i);
      if (x < -50 || x > w + 50) return;
      if (sh.price === undefined || isNaN(sh.price)) return;
      const y0 = yAxis.convertToPixel(sh.price);
      const up = sh.dir === 'up';
      const y = up ? y0 + 14 : y0 - 14;
      ctx.fillStyle = sh.color || (up ? '#089981' : '#f23645');
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (up) { ctx.moveTo(x, y - 8); ctx.lineTo(x - 7, y + 5); ctx.lineTo(x + 7, y + 5); }
      else { ctx.moveTo(x, y + 8); ctx.lineTo(x - 7, y - 5); ctx.lineTo(x + 7, y - 5); }
      ctx.closePath(); ctx.fill();
      if (sh.text) {
        ctx.font = 'bold 10px Inter, sans-serif';
        const tw = ctx.measureText(sh.text).width + 8;
        const bh = 16, bx = x - tw / 2, by = up ? y + 8 : y - 8 - bh;
        ctx.fillStyle = sh.color || (up ? 'rgba(8,153,129,0.95)' : 'rgba(242,54,69,0.95)');
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, by, tw, bh, 3); else ctx.rect(bx, by, tw, bh);
        ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(sh.text, x, by + bh / 2);
      }
    });

    ctx.restore();
    return true;
  }
};

// ─── Premium indicator helpers ───────────────────────────────────────────────
function _ema(vals, len) { const k = 2 / (len + 1); let p; return vals.map((v, i) => { p = i === 0 ? v : v * k + p * (1 - k); return p; }); }
function _rma(vals, len) { const out = new Array(vals.length).fill(null); let p, seed = 0; for (let i = 0; i < vals.length; i++) { const v = vals[i]; if (i < len) { seed += v; if (i === len - 1) { p = seed / len; out[i] = p; } } else { p = (p * (len - 1) + v) / len; out[i] = p; } } return out; }
function _sma(vals, len) { const out = new Array(vals.length).fill(null); let sum = 0; for (let i = 0; i < vals.length; i++) { sum += vals[i]; if (i >= len) sum -= vals[i - len]; if (i >= len - 1) out[i] = sum / len; } return out; }
function _hh(arr, len, i) { let m = -Infinity; for (let j = Math.max(0, i - len + 1); j <= i; j++) m = Math.max(m, arr[j]); return m; }
function _ll(arr, len, i) { let m = Infinity; for (let j = Math.max(0, i - len + 1); j <= i; j++) m = Math.min(m, arr[j]); return m; }
function _tr(dataList) { return dataList.map((d, i) => i === 0 ? d.high - d.low : Math.max(d.high - d.low, Math.abs(d.high - dataList[i - 1].close), Math.abs(d.low - dataList[i - 1].close))); }
function _wilderRsi(closes, len) { const n = closes.length, out = new Array(n).fill(null); let ag = 0, al = 0; for (let i = 1; i < n; i++) { const ch = closes[i] - closes[i - 1], g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0; if (i <= len) { ag += g; al += l; if (i === len) { ag /= len; al /= len; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } } else { ag = (ag * (len - 1) + g) / len; al = (al * (len - 1) + l) / len; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } } return out; }

// ATR — Average True Range (Volatility), sub-pane
const atrIndicator = {
  name: 'ATR', shortName: 'ATR', calcParams: [14],
  figures: [{ key: 'atr', title: 'ATR: ', type: 'line' }],
  styles: { lines: [{ color: '#f7a600', size: 1.5 }] },
  calc: (dataList, { calcParams }) => {
    const len = (calcParams && calcParams[0]) || 14;
    const atr = _rma(_tr(dataList), len);
    return dataList.map((_, i) => ({ atr: atr[i] == null ? undefined : atr[i] }));
  }
};

// Keltner Channels — EMA mid ± mult*ATR (overlay)
const keltnerIndicator = {
  name: 'KELTNER', shortName: 'Keltner', series: 'price', calcParams: [20, 10, 2],
  figures: [
    { key: 'upper', title: 'Upper: ', type: 'line' },
    { key: 'mid', title: 'Basis: ', type: 'line' },
    { key: 'lower', title: 'Lower: ', type: 'line' }
  ],
  styles: { lines: [{ color: 'rgba(41,98,255,0.6)', size: 1 }, { color: '#2962ff', size: 1.5 }, { color: 'rgba(41,98,255,0.6)', size: 1 }] },
  calc: (dataList, { calcParams }) => {
    const emaLen = (calcParams && calcParams[0]) || 20, atrLen = (calcParams && calcParams[1]) || 10, mult = (calcParams && calcParams[2]) || 2;
    const mid = _ema(dataList.map(d => d.close), emaLen);
    const atr = _rma(_tr(dataList), atrLen);
    return dataList.map((_, i) => atr[i] == null ? { mid: mid[i] } : { mid: mid[i], upper: mid[i] + mult * atr[i], lower: mid[i] - mult * atr[i] });
  }
};

// Donchian Channels — highest high / lowest low (overlay)
const donchianIndicator = {
  name: 'DONCHIAN', shortName: 'Donchian', series: 'price', calcParams: [20],
  figures: [
    { key: 'upper', title: 'Upper: ', type: 'line' },
    { key: 'mid', title: 'Mid: ', type: 'line' },
    { key: 'lower', title: 'Lower: ', type: 'line' }
  ],
  styles: { lines: [{ color: '#089981', size: 1 }, { color: 'rgba(135,135,150,0.7)', size: 1, style: 'dashed' }, { color: '#f23645', size: 1 }] },
  calc: (dataList, { calcParams }) => {
    const len = (calcParams && calcParams[0]) || 20;
    const highs = dataList.map(d => d.high), lows = dataList.map(d => d.low);
    return dataList.map((_, i) => { if (i < len - 1) return {}; const u = _hh(highs, len, i), l = _ll(lows, len, i); return { upper: u, lower: l, mid: (u + l) / 2 }; });
  }
};

// Stochastic RSI — sub-pane oscillator (K & D)
const stochRsiIndicator = {
  name: 'STOCHRSI', shortName: 'StochRSI', calcParams: [14, 14, 3, 3],
  figures: [
    { key: 'k', title: '%K: ', type: 'line' },
    { key: 'd', title: '%D: ', type: 'line' }
  ],
  styles: { lines: [{ color: '#2962ff', size: 1.5 }, { color: '#f7a600', size: 1.5 }] },
  calc: (dataList, { calcParams }) => {
    const rsiLen = (calcParams && calcParams[0]) || 14, stochLen = (calcParams && calcParams[1]) || 14, kS = (calcParams && calcParams[2]) || 3, dS = (calcParams && calcParams[3]) || 3;
    const rsi = _wilderRsi(dataList.map(d => d.close), rsiLen);
    const stoch = rsi.map((r, i) => {
      if (r == null) return null;
      let hi = -Infinity, lo = Infinity, ok = false;
      for (let j = Math.max(0, i - stochLen + 1); j <= i; j++) { if (rsi[j] == null) continue; ok = true; hi = Math.max(hi, rsi[j]); lo = Math.min(lo, rsi[j]); }
      if (!ok || hi === lo) return 0;
      return (r - lo) / (hi - lo) * 100;
    });
    const kArr = _sma(stoch.map(v => v == null ? 0 : v), kS);
    const dArr = _sma(kArr.map(v => v == null ? 0 : v), dS);
    return dataList.map((_, i) => ({ k: rsi[i] == null ? undefined : kArr[i], d: rsi[i] == null ? undefined : dArr[i] }));
  }
};

// Ichimoku Cloud — conversion/base/leading spans with a filled cloud (overlay)
const ichimokuIndicator = {
  name: 'ICHIMOKU', shortName: 'Ichimoku', series: 'price', calcParams: [9, 26, 52],
  figures: [
    { key: 'conversion', title: 'Tenkan: ', type: 'line' },
    { key: 'base', title: 'Kijun: ', type: 'line' },
    { key: 'spanA', title: 'Senkou A: ', type: 'line' },
    { key: 'spanB', title: 'Senkou B: ', type: 'line' }
  ],
  styles: { lines: [
    { color: '#2962ff', size: 1 }, { color: '#f23645', size: 1 },
    { color: 'rgba(8,153,129,0.9)', size: 1 }, { color: 'rgba(242,54,69,0.9)', size: 1 }
  ] },
  calc: (dataList, { calcParams }) => {
    const p1 = (calcParams && calcParams[0]) || 9, p2 = (calcParams && calcParams[1]) || 26, p3 = (calcParams && calcParams[2]) || 52;
    const highs = dataList.map(d => d.high), lows = dataList.map(d => d.low);
    const conv = dataList.map((_, i) => i < p1 - 1 ? null : (_hh(highs, p1, i) + _ll(lows, p1, i)) / 2);
    const base = dataList.map((_, i) => i < p2 - 1 ? null : (_hh(highs, p2, i) + _ll(lows, p2, i)) / 2);
    return dataList.map((_, i) => {
      const row = {};
      if (conv[i] != null) row.conversion = conv[i];
      if (base[i] != null) row.base = base[i];
      // Leading spans displaced forward p2 bars: value at i comes from i-p2
      const src = i - p2;
      if (src >= 0 && conv[src] != null && base[src] != null) row.spanA = (conv[src] + base[src]) / 2;
      if (src >= p3 - 1) row.spanB = (_hh(highs, p3, src) + _ll(lows, p3, src)) / 2;
      return row;
    });
  },
  draw: ({ ctx, indicator, xAxis, yAxis }) => {
    const r = indicator.result || [];
    ctx.save();
    for (let i = 1; i < r.length; i++) {
      const a0 = r[i - 1] && r[i - 1].spanA, b0 = r[i - 1] && r[i - 1].spanB;
      const a1 = r[i] && r[i].spanA, b1 = r[i] && r[i].spanB;
      if (a0 == null || b0 == null || a1 == null || b1 == null) continue;
      const x0 = xAxis.convertToPixel(i - 1), x1 = xAxis.convertToPixel(i);
      const ya0 = yAxis.convertToPixel(a0), yb0 = yAxis.convertToPixel(b0);
      const ya1 = yAxis.convertToPixel(a1), yb1 = yAxis.convertToPixel(b1);
      ctx.fillStyle = (a1 >= b1) ? 'rgba(8,153,129,0.12)' : 'rgba(242,54,69,0.12)';
      ctx.beginPath();
      ctx.moveTo(x0, ya0); ctx.lineTo(x1, ya1); ctx.lineTo(x1, yb1); ctx.lineTo(x0, yb0);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    return true;
  }
};

// ─── Multi-timeframe ZONE indicators: Support/Resistance & Order Blocks ───────
const TF_MS = { '1M': 60000, '5M': 300000, '15M': 900000, '30M': 1800000, '1H': 3600000, '4H': 14400000, '1D': 86400000 };
const SR_DEFAULT = { tfs: ['15M'], colors: { '5M': '#26a69a', '15M': '#38bdf8', '1H': '#f59e0b', '4H': '#a855f7', '1D': '#ef5350' }, maxZones: 1, filterMode: 'nearest', pivot: 3 };
const OB_DEFAULT = { tfs: ['15M'], colors: { '5M': '#26a69a', '15M': '#38bdf8', '1H': '#f59e0b', '4H': '#a855f7', '1D': '#ef5350' }, maxZones: 1, filterMode: 'nearest', atrLen: 14 };

function _median(a) { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; }
function _barSpacing(d) { const n = d.length, dt = []; for (let i = Math.max(1, n - 60); i < n; i++) dt.push((d[i].timestamp || 0) - (d[i - 1].timestamp || 0)); return _median(dt) || 60000; }
function _aggregate(d, bucketMs) {
  const out = []; let cur = null;
  for (const k of d) {
    const b = Math.floor((k.timestamp || 0) / bucketMs) * bucketMs;
    if (!cur || cur.bucket !== b) { if (cur) out.push(cur); cur = { bucket: b, timestamp: b, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume || 0 }; }
    else { cur.high = Math.max(cur.high, k.high); cur.low = Math.min(cur.low, k.low); cur.close = k.close; cur.volume += (k.volume || 0); }
  }
  if (cur) out.push(cur); return out;
}
function _hexA(color, alpha) {
  if (typeof color !== 'string') return `rgba(120,120,120,${alpha})`;
  if (color.startsWith('rgb')) return color;
  let h = color.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(isNaN)) return `rgba(120,120,120,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}
function _srZones(c, pivot, maxPerSide, lastClose) {
  const hs = [], ls = [];
  for (let i = pivot; i < c.length - pivot; i++) {
    let ph = true, pl = true;
    for (let j = i - pivot; j <= i + pivot; j++) { if (c[j].high > c[i].high) ph = false; if (c[j].low < c[i].low) pl = false; }
    if (ph) hs.push(c[i].high); if (pl) ls.push(c[i].low);
  }
  const hi = Math.max(...c.map(x => x.high)), lo = Math.min(...c.map(x => x.low));
  const range = Math.max(1e-9, hi - lo), tol = range * 0.004;
  const cluster = (vals) => { const srt = [...vals].sort((a, b) => a - b), g = []; for (const v of srt) { const t = g[g.length - 1]; if (t && v - t.max <= tol * 2) { t.max = Math.max(t.max, v); t.min = Math.min(t.min, v); t.n++; t.sum += v; } else g.push({ min: v, max: v, n: 1, sum: v }); } return g; };
  const mk = (groups) => groups.map(g => ({ top: g.max + tol, bottom: g.min - tol, mid: g.sum / g.n, n: g.n }));
  
  const allGroups = [...mk(cluster(hs)), ...mk(cluster(ls))];
  allGroups.sort((a, b) => b.n - a.n || Math.abs(a.mid - lastClose) - Math.abs(b.mid - lastClose));
  
  const res = [], sup = [];
  for (const g of allGroups) {
    if (g.mid >= lastClose) {
      if (res.length < maxPerSide) res.push({ ...g, kind: 'R', side: 'RESISTANCE' });
    } else {
      if (sup.length < maxPerSide) sup.push({ ...g, kind: 'S', side: 'SUPPORT' });
    }
  }
  return [...res, ...sup];
}
function _obZones(c, atrLen, maxZones) {
  const atr = _rma(_tr(c), atrLen), n = c.length;
  let raw = [];
  // 1) Detect: an opposite-colour candle immediately before a strong impulse that breaks its extreme.
  for (let i = 1; i < n - 1; i++) {
    const a = atr[i]; if (a == null) continue; const nx = c[i + 1];
    if (c[i].close < c[i].open && nx.close > nx.open && (nx.close - nx.open) > 1.2 * a && nx.close > c[i].high)
      raw.push({ top: c[i].high, bottom: c[i].low, kind: 'BULL', idx: i });
    if (c[i].close > c[i].open && nx.close < nx.open && (nx.open - nx.close) > 1.2 * a && nx.close < c[i].low)
      raw.push({ top: c[i].high, bottom: c[i].low, kind: 'BEAR', idx: i });
  }
  // 2) Mitigation: a zone is "spent" once a later candle CLOSES through it. Keep only fresh (unmitigated) zones.
  raw = raw.filter(z => {
    for (let j = z.idx + 2; j < n; j++) {
      if (z.kind === 'BULL' && c[j].close < z.bottom) return false;
      if (z.kind === 'BEAR' && c[j].close > z.top) return false;
    }
    return true;
  });
  // 3) Merge overlapping/touching zones of the SAME kind into a single band (kills the stacked-duplicate look).
  raw.sort((p, q) => p.idx - q.idx);
  const merged = [];
  for (const z of raw) {
    const m = merged.find(w => w.kind === z.kind && z.bottom <= w.top && z.top >= w.bottom);
    if (m) { m.top = Math.max(m.top, z.top); m.bottom = Math.min(m.bottom, z.bottom); m.idx = Math.max(m.idx, z.idx); }
    else merged.push({ top: z.top, bottom: z.bottom, kind: z.kind, idx: z.idx });
  }
  // 4) Freshest first, capped.
  merged.sort((p, q) => q.idx - p.idx);
  return merged.slice(0, maxZones);
}
const _zoneCache = new Map();   // mode -> { key, zones }  (avoids recomputing on every intra-bar tick)
function _computeZones(dataList, cfg, mode) {
  const spacing = _barSpacing(dataList);
  const lastClose = dataList[dataList.length - 1].close;

  // Resolve the chart's chosen timeframe
  const derivedTf = spacing >= 70000000 ? '1D' : spacing >= 10000000 ? '4H' : spacing >= 3000000 ? '1H' : spacing >= 1500000 ? '30M' : spacing >= 800000 ? '15M' : spacing >= 240000 ? '5M' : '1M';
  const targetTf = (cfg.chartTimeframe || cfg.tf || (cfg.tfs && cfg.tfs.length === 1 ? cfg.tfs[0] : null) || derivedTf).toUpperCase();

  let allDetected = [];

  // A. If authoritative backend zones are provided, strictly filter to match targetTf!
  if (Array.isArray(cfg.zones) && cfg.zones.length > 0) {
    allDetected = cfg.zones
      .filter(z => !z.timeframe || z.timeframe.toUpperCase() === targetTf)
      .map(z => {
        const top = Number(z.top ?? (z.level ? z.level + 1.0 : 0));
        const bottom = Number(z.bottom ?? (z.level ? z.level - 1.0 : 0));
        const mid = Number(z.mid ?? (z.level || (top + bottom) / 2));
        const isBear = (z.side === 'RESISTANCE' || z.type === 'BEAR' || z.type === 'RES' || mid >= lastClose);
        const kind = isBear ? (mode === 'SR' ? 'R' : 'BEAR') : (mode === 'SR' ? 'S' : 'BULL');
        const side = isBear ? (mode === 'SR' ? 'RESISTANCE' : 'SUPPLY') : (mode === 'SR' ? 'SUPPORT' : 'DEMAND');
        const color = isBear ? '#f43f5e' : '#10b981';
        const tf = (z.timeframe || targetTf).toUpperCase();
        const zId = z.id || `${tf}_${kind}_${Math.round(top)}_${Math.round(bottom)}`;
        return {
          ...z,
          id: zId,
          top,
          bottom,
          mid,
          tf,
          kind,
          side,
          color,
          dist: Math.abs(mid - lastClose)
        };
      });
  } else {
    // B. Calculate from local chart data ONLY for targetTf:
    const tfsToRun = [targetTf];
    tfsToRun.forEach(tf => {
      const ms = TF_MS[tf]; if (!ms || ms < spacing * 0.9) return;
      const cands = ms <= spacing * 1.5 ? dataList : _aggregate(dataList, ms);
      if (cands.length < 10) return;
      const zs = mode === 'SR' ? _srZones(cands, cfg.pivot || 3, cfg.maxZones || 4, lastClose) : _obZones(cands, cfg.atrLen || 14, cfg.maxZones || 4);
      zs.forEach(z => {
        const isBear = (z.kind === 'R' || z.kind === 'BEAR' || z.mid >= lastClose);
        const color = isBear ? '#f43f5e' : '#10b981';
        const zId = `${tf}_${z.kind}_${Math.round(z.top)}_${Math.round(z.bottom)}`;
        allDetected.push({ ...z, tf, color, id: zId, dist: Math.abs(z.mid - lastClose) });
      });
    });
  }

  // 1. If user passed a specific list of activeZoneIds, show ONLY those zones!
  if (Array.isArray(cfg.activeZoneIds) && cfg.activeZoneIds.length > 0) {
    const idSet = new Set(cfg.activeZoneIds);
    return allDetected.filter(z => idSet.has(z.id));
  }

  // 2. Filter mode: 'nearest' (Default!) shows strictly 1 nearest above and 1 nearest below!
  const filterMode = cfg.filterMode || 'nearest';

  if (filterMode === 'nearest' || filterMode === 'nearest2') {
    const maxPerSide = filterMode === 'nearest' ? 1 : 2;
    // Above price (Resistance / Bearish Supply)
    const above = allDetected.filter(z => (z.mid >= lastClose || z.bottom >= lastClose));
    above.sort((a, b) => a.dist - b.dist);

    // Below price (Support / Bullish Demand)
    const below = allDetected.filter(z => (z.mid < lastClose || z.top <= lastClose));
    below.sort((a, b) => a.dist - b.dist);

    const pickedAbove = above.slice(0, maxPerSide).map(z => ({ ...z, isNearest: true }));
    const pickedBelow = below.slice(0, maxPerSide).map(z => ({ ...z, isNearest: true }));
    return [...pickedAbove, ...pickedBelow];
  }

  return allDetected;
}

function _buildZones(dataList, cfg, mode) {
  const out = dataList.map(() => ({}));
  try {
    if (dataList.length < 20) return out;
    const lastTs = dataList[dataList.length - 1].timestamp || 0;
    const zonesLen = (cfg.zones || []).length;
    const spacing = _barSpacing(dataList);
    const derivedTf = spacing >= 70000000 ? '1D' : spacing >= 10000000 ? '4H' : spacing >= 3000000 ? '1H' : spacing >= 1500000 ? '30M' : spacing >= 800000 ? '15M' : spacing >= 240000 ? '5M' : '1M';
    const targetTf = (cfg.chartTimeframe || cfg.tf || (cfg.tfs && cfg.tfs.length === 1 ? cfg.tfs[0] : null) || derivedTf).toUpperCase();

    const key = [
      mode,
      targetTf,
      dataList.length,
      lastTs,
      cfg.filterMode || 'nearest',
      (cfg.activeZoneIds || []).join(','),
      cfg.maxZones || 0,
      zonesLen,
      cfg.pivot || 0,
      cfg.atrLen || 0
    ].join('|');
    const cacheId = mode + '|' + targetTf + '|' + (cfg.filterMode || 'nearest') + '|' + ((cfg.activeZoneIds || []).join(',')) + '|' + zonesLen;
    const cached = _zoneCache.get(cacheId);
    let zones;
    if (cached && cached.key === key) zones = cached.zones;
    else { zones = _computeZones(dataList, cfg, mode); _zoneCache.set(cacheId, { key, zones }); }
    if (out.length) out[out.length - 1].__zones = zones;
  } catch (e) { /* never break the chart */ }
  return out;
}

function _drawZones(ctx, indicator, yAxis) {
  try {
    const result = indicator.result || [];
    const last = result[result.length - 1];
    const zones = last && last.__zones;
    if (!zones || !zones.length) return true;
    const W = (ctx.canvas && ctx.canvas.width) || 4000;
    ctx.save();
    ctx.font = 'bold 10px Inter, system-ui, sans-serif';
    
    zones.forEach(z => {
      const yTop = yAxis.convertToPixel(z.top), yBot = yAxis.convertToPixel(z.bottom);
      const y = Math.min(yTop, yBot), h = Math.max(3, Math.abs(yBot - yTop));
      const isBear = (z.kind === 'R' || z.kind === 'BEAR' || z.side === 'RESISTANCE' || z.side === 'SUPPLY');
      const color = isBear ? '#f43f5e' : '#10b981';
      
      // Semi-transparent clean fill (subtle so candles remain 100% visible)
      ctx.fillStyle = _hexA(color, 0.08);
      ctx.fillRect(0, y, W, h);
      
      // Subtle dashed border
      ctx.strokeStyle = _hexA(color, 0.65);
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(0.5, y + 0.5, W - 1, Math.max(1, h - 1));
      ctx.setLineDash([]);
      
      // Right-aligned pill tag (positioned before right price scale)
      const tag = z.kind === 'R' ? 'Res' : (z.kind === 'S' ? 'Sup' : (z.kind === 'BULL' ? 'Demand' : (z.kind === 'BEAR' ? 'Supply' : z.kind)));
      const nearestBadge = z.isNearest ? ' ★ NEAREST' : '';
      const midVal = z.mid || (z.top + z.bottom) / 2;
      const label = `${z.tf || ''} ${tag} $${midVal.toFixed(2)}${nearestBadge}`.trim();
      
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(label).width + 12;
      const tagH = 17;
      const tagY = y + h / 2 - tagH / 2;
      const rightX = Math.max(120, W - 70);
      
      ctx.fillStyle = _hexA(color, 0.90);
      ctx.fillRect(rightX - tw, tagY, tw, tagH);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, rightX - 6, y + h / 2 + 0.5);
    });
    ctx.restore();
  } catch (e) {
    try { ctx.restore(); } catch (_) {}
  }
  return true;
}

const srZonesIndicator = {
  name: 'SR_ZONES', shortName: 'S/R Zones', series: 'price',
  calcParams: [],
  extendData: SR_DEFAULT,
  figures: [{ key: '_z', title: '', type: 'line' }],
  styles: { lines: [{ color: 'transparent', size: 0 }] },
  calc: (dataList, ind) => _buildZones(dataList, { ...SR_DEFAULT, ...((ind && ind.extendData) || {}) }, 'SR'),
  draw: ({ ctx, indicator, yAxis }) => _drawZones(ctx, indicator, yAxis)
};
const orderBlockIndicator = {
  name: 'ORDER_BLOCKS', shortName: 'Order Blocks', series: 'price',
  calcParams: [],
  extendData: OB_DEFAULT,
  figures: [{ key: '_z', title: '', type: 'line' }],
  styles: { lines: [{ color: 'transparent', size: 0 }] },
  calc: (dataList, ind) => _buildZones(dataList, { ...OB_DEFAULT, ...((ind && ind.extendData) || {}) }, 'OB'),
  draw: ({ ctx, indicator, yAxis }) => _drawZones(ctx, indicator, yAxis)
};

// Register all custom overlays and indicators
export function initCustomOverlaysAndIndicators() {
  try {
    registerOverlay(rectOverlay);
    registerOverlay(longPositionOverlay);
    registerOverlay(shortPositionOverlay);
    registerOverlay(xabcdOverlay);
    registerOverlay(fiveWavesOverlay);
    registerOverlay(threeWavesOverlay);
    registerOverlay(headAndShouldersOverlay);
    registerOverlay(measureOverlay);
    registerOverlay(measurePriceOverlay);
    registerOverlay(measureDateOverlay);
    
    registerIndicator(customEMAIndicator);
    registerIndicator(customSMAIndicator);
    registerIndicator(luxAlgoSMCIndicator);
    registerIndicator(supertrendIndicator);
    registerIndicator(signalsIndicator);
    registerIndicator(vwapIndicator);
    registerIndicator(goldScalperIndicator);
    registerIndicator(pineIndicator);
    registerIndicator(atrIndicator);
    registerIndicator(keltnerIndicator);
    registerIndicator(donchianIndicator);
    registerIndicator(stochRsiIndicator);
    registerIndicator(ichimokuIndicator);
    registerIndicator(srZonesIndicator);
    registerIndicator(orderBlockIndicator);
  } catch (e) {
    console.warn("Overlays registration notice:", e);
  }
}
