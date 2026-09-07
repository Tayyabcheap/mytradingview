import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { init, dispose } from 'klinecharts';
import { initCustomOverlaysAndIndicators } from './customOverlays';
import { registerPineScript } from './pineEngine';

// Initialize custom geometric tools and SMC / Signal indicators
initCustomOverlaysAndIndicators();

const API_BASE = '';

const TF_TO_PERIOD = {
  '1M': { type: 'minute', span: 1 },
  '5M': { type: 'minute', span: 5 },
  '15M': { type: 'minute', span: 15 },
  '30M': { type: 'minute', span: 30 },
  '1H': { type: 'hour', span: 1 },
  '4H': { type: 'hour', span: 4 },
  '1D': { type: 'day', span: 1 },
  '1W': { type: 'week', span: 1 },
};

// Convert a KLineCharts period object back to our timeframe string
function periodToTf(period) {
  if (!period) return '1H';
  for (const [k, v] of Object.entries(TF_TO_PERIOD)) {
    if (v.type === period.type && v.span === period.span) return k;
  }
  return '1H';
}

// Fast tick poll (responsive price + forming candle) and slower bar poll (new-bar rollover)
const QUOTE_POLL_MS = 700;
const BARS_POLL_MS = 3000;

const KLineChartArea = forwardRef(({
  symbol,
  timeframe,
  onPriceUpdate,
  watermarkText,
  indicators = [],
  signals = [],
  showSignals = false,
  onSelectSignal,
  onCreateLineAlert
}, ref) => {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const fullDataRef = useRef([]);
  const appliedIndicatorsRef = useRef(new Map());

  // Live feed + replay coordination
  const liveTimerRef = useRef(null);          // slow bar-rollover poll
  const quoteTimerRef = useRef(null);         // fast tick/price poll
  const barCallbackRef = useRef(null);        // subscribeBar callback (used by live feed AND replay)
  const liveSubRef = useRef(null);            // { ticker, tfStr } currently subscribed
  const replayRef = useRef({ active: false, index: 0 }); // replay state read inside getBars
  const overlaysRef = useRef(new Map()); // id -> { name, points } for drawing persistence
  const persistTimerRef = useRef(null); // debounce backend drawing saves

  const [loading, setLoading] = useState(true);
  const [selectedSignalInfo, setSelectedSignalInfo] = useState(null);
  const [selDrawing, setSelDrawing] = useState(null); // floating edit toolbar for a selected drawing

  // ---- Live feed helpers -------------------------------------------------
  const stopLiveFeed = () => {
    if (liveTimerRef.current) { clearInterval(liveTimerRef.current); liveTimerRef.current = null; }
    if (quoteTimerRef.current) { clearInterval(quoteTimerRef.current); quoteTimerRef.current = null; }
  };

  const startLiveFeed = (ticker, tfStr) => {
    stopLiveFeed();
    if (replayRef.current.active) return; // never poll live while replaying

    // (a) Fast tick poll — quote gives the freshest bid/ask, so the price tag and
    // the forming candle update ~every 700ms (much smoother than the old 2s).
    const pollQuote = async () => {
      if (replayRef.current.active) return;
      try {
        const res = await fetch(`${API_BASE}/api/quote?symbol=${ticker}`);
        const q = await res.json();
        if (!q || q.error) return;
        const price = (typeof q.bid === 'number' && q.bid > 0) ? q.bid
                      : (typeof q.ask === 'number' ? q.ask : null);
        if (price === null || isNaN(price)) return;
        const fd = fullDataRef.current;
        if (fd.length && typeof barCallbackRef.current === 'function') {
          const last = fd[fd.length - 1];
          const updated = { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) };
          fd[fd.length - 1] = updated;
          barCallbackRef.current(updated);
        }
        if (onPriceUpdate) onPriceUpdate(price);
      } catch (err) { /* transient */ }
    };

    // (b) Slower bar poll — MT5 supplies the real bar timestamp, so new candles
    // roll over correctly (no broker-offset math). count=2 includes the forming bar.
    const pollBars = async () => {
      if (replayRef.current.active) return;
      try {
        const res = await fetch(`${API_BASE}/api/history?symbol=${ticker}&timeframe=${tfStr}&count=2`);
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) return;
        const d = data[data.length - 1];
        const bar = { timestamp: d.time * 1000, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.value };
        if (typeof barCallbackRef.current === 'function') barCallbackRef.current(bar);
        const fd = fullDataRef.current;
        if (fd.length && fd[fd.length - 1].timestamp === bar.timestamp) fd[fd.length - 1] = bar;
        else if (fd.length && bar.timestamp > fd[fd.length - 1].timestamp) fd.push(bar);
      } catch (err) { /* transient */ }
    };

    quoteTimerRef.current = setInterval(pollQuote, QUOTE_POLL_MS);
    liveTimerRef.current = setInterval(pollBars, BARS_POLL_MS);
    pollBars();
    pollQuote();
  };

  // ---- Drawing persistence ---------------------------------------------
  const drawingsKey = () => `twr_drawings_${symbol}`;
  const persistDrawings = () => {
    const arr = Array.from(overlaysRef.current.values());
    try { localStorage.setItem(drawingsKey(), JSON.stringify(arr)); } catch (e) { /* offline cache */ }
    // Debounced save to the backend store (survives app close / browser clear / restart)
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    const sym = symbol;
    persistTimerRef.current = setTimeout(() => {
      fetch('/api/drawings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, overlays: arr })
      }).catch(() => { /* backend offline — localStorage still has it */ });
    }, 600);
  };
  const overlayCallbacks = () => ({
    onDrawEnd: (e) => { const o = e.overlay; overlaysRef.current.set(o.id, { name: o.name, points: o.points, styles: o.styles }); persistDrawings(); return false; },
    onPressedMoveEnd: (e) => { const o = e.overlay; const prev = overlaysRef.current.get(o.id) || {}; overlaysRef.current.set(o.id, { name: o.name, points: o.points, styles: o.styles || prev.styles }); persistDrawings(); return false; },
    onRemoved: (e) => { const o = e.overlay; overlaysRef.current.delete(o.id); persistDrawings(); return false; },
    onSelected: (e) => {
      const o = e.overlay;
      const entry = overlaysRef.current.get(o.id);
      const st = (entry && entry.styles) || o.styles || {};
      const color = (st.line && st.line.color) || '#2962ff';
      const size = (st.line && st.line.size) || 1;
      setSelDrawing({ id: o.id, x: e.x ?? 40, y: e.y ?? 40, color, size });
      return false;
    },
    onDeselected: () => { setSelDrawing(null); return false; }
  });

  // Build an overlay-styles object that colors/sizes whatever figure type the overlay uses
  const drawingStyleObj = (color, size) => ({
    line: { color, size },
    rect: { borderColor: color, borderSize: size },
    circle: { borderColor: color, borderSize: size },
    polygon: { borderColor: color, borderSize: size },
    arc: { color },
    text: { color }
  });
  const applyDrawingStyle = (colorArg, sizeArg) => {
    if (!chartRef.current || !selDrawing) return;
    const color = colorArg || selDrawing.color;
    const size = sizeArg || selDrawing.size;
    const st = drawingStyleObj(color, size);
    chartRef.current.overrideOverlay({ id: selDrawing.id, styles: st });
    const entry = overlaysRef.current.get(selDrawing.id);
    if (entry) { entry.styles = st; persistDrawings(); }
    setSelDrawing(prev => (prev ? { ...prev, color, size } : prev));
  };
  const deleteSelectedDrawing = () => {
    if (!chartRef.current || !selDrawing) return;
    chartRef.current.removeOverlay({ id: selDrawing.id });
    overlaysRef.current.delete(selDrawing.id);
    persistDrawings();
    setSelDrawing(null);
  };

  // Create a price alert from the currently-selected line/level drawing.
  const alertOnSelectedLine = () => {
    if (!selDrawing) return;
    const entry = overlaysRef.current.get(selDrawing.id);
    const pts = (entry && entry.points) || [];
    const vals = pts.map(pt => (pt && typeof pt.value === 'number') ? pt.value : null).filter(v => v != null);
    if (!vals.length) return;
    const price = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (typeof onCreateLineAlert === 'function') onCreateLineAlert({ price: +price.toFixed(2), name: (entry && entry.name) || 'Line' });
    setSelDrawing(null);
  };

  // Sync indicators with KLineCharts
  const syncIndicators = () => {
    if (!chartRef.current) return;
    const chart = chartRef.current;

    const currentActiveIds = new Set();

    indicators.forEach(ind => {
      currentActiveIds.add(ind.instanceId);

      let calcParams = ind.calcParams;
      let extendData;
      if (!calcParams) {
        if (ind.id === 'EMA' || ind.id === 'MA' || ind.id === 'SMA') {
          calcParams = [
            ind.params?.p1 ?? 9,
            ind.params?.p2 ?? 21,
            ind.params?.p3 ?? 50,
            ind.params?.p4 ?? 200
          ];
        } else if (ind.id === 'BOLL') {
          calcParams = [ind.params?.length ?? 20, ind.params?.multiplier ?? 2];
        } else if (ind.id === 'SAR') {
          calcParams = [ind.params?.start ?? 0.02, ind.params?.step ?? 0.02, ind.params?.max ?? 0.2];
        } else if (ind.id === 'SUPERTREND') {
          calcParams = [ind.params?.period ?? 10, ind.params?.multiplier ?? 3];
        } else if (ind.id === 'LuxAlgo_SMC') {
          calcParams = [ind.params?.period ?? 10];
        } else if (ind.id === 'RSI') {
          calcParams = [ind.params?.period ?? 14];
        } else if (ind.id === 'MACD') {
          calcParams = [ind.params?.fast ?? 12, ind.params?.slow ?? 26, ind.params?.signal ?? 9];
        } else if (ind.id === 'KDJ') {
          calcParams = [ind.params?.k ?? 9, ind.params?.d ?? 3, ind.params?.j ?? 3];
        } else if (ind.id === 'PINE') {
          if (ind.params?.pineSrc && ind.params?.scriptId) {
            try { registerPineScript(ind.params.scriptId, ind.params.pineSrc); } catch (e) { /* ignore */ }
          }
          calcParams = [ind.params?.scriptId || ''];
        } else if (ind.id === 'GOLD_SCALPER') {
          calcParams = [
            ind.params?.fastLen ?? 21, ind.params?.slowLen ?? 50, ind.params?.rsiLen ?? 14,
            ind.params?.atrLen ?? 14, ind.params?.slMult ?? 1.5, ind.params?.tpMult ?? 2.5,
            ind.params?.sessStart ?? 8, ind.params?.sessEnd ?? 12
          ];
        } else if (ind.id === 'SIGNALS') {
          calcParams = [ind.params?.strategy || 'ALL'];
        } else if (ind.id === 'SR_ZONES' || ind.id === 'ORDER_BLOCKS') {
          extendData = ind.params || {};
          calcParams = [];
        }
      }

      const isVisible = ind.visible !== false;
      const styles = isVisible ? ind.styles : {
        lines: [
          { color: 'transparent', size: 0 },
          { color: 'transparent', size: 0 },
          { color: 'transparent', size: 0 },
          { color: 'transparent', size: 0 }
        ]
      };

      const isOverlay = !ind.isStack;
      const targetPaneId = isOverlay ? 'candle_pane' : undefined;

      // Resolve the REAL pane id klinecharts assigned to this indicator.
      // Overlays live on 'candle_pane'; sub-pane indicators (RSI, MACD, ATR,
      // StochRSI, ...) get an auto-generated pane id like 'indicator_pane_1'.
      // We MUST track that real id, because passing paneId:undefined into
      // overrideIndicator makes klinecharts merge `undefined` onto the
      // indicator's paneId, move it out of its real pane, delete that now-empty
      // pane, and file it under a non-existent pane -- so the indicator
      // vanishes on the next sync (e.g. after toggling Signals). Never let a
      // sub-pane indicator's paneId be undefined once it exists.
      const findRealPaneId = (indId) => {
        try {
          if (!chart.getIndicators) return targetPaneId;
          const all = chart.getIndicators({ name: ind.id });
          if (!Array.isArray(all) || all.length === 0) return targetPaneId;
          const match = indId ? all.find(x => x.id === indId) : null;
          return ((match || all[0]).paneId) || targetPaneId;
        } catch (e) { return targetPaneId; }
      };

      // Self-heal: trust klinecharts' actual state, not just our Map. If the
      // Map thinks this indicator exists but the chart no longer has it with a
      // valid pane (a stale/orphaned entry from an earlier bug or race),
      // recreate it instead of overriding a non-existent indicator (which
      // would no-op and leave it permanently missing).
      if (appliedIndicatorsRef.current.has(ind.instanceId)) {
        let existsOnChart = true;
        try {
          if (chart.getIndicators) {
            const found = chart.getIndicators({ name: ind.id });
            existsOnChart = Array.isArray(found) && found.some(x => x.paneId != null);
          }
        } catch (e) { existsOnChart = true; }
        if (!existsOnChart) appliedIndicatorsRef.current.delete(ind.instanceId);
      }

      if (!appliedIndicatorsRef.current.has(ind.instanceId)) {
        // isStack=true ALWAYS: in klinecharts v10 `addIndicator`, isStack=false
        // first runs `removeIndicator({ paneId })`, which WIPES every other
        // indicator already on that pane. All overlays share 'candle_pane', so
        // isStack=false made each new overlay delete the previous ones.
        // isStack=true stacks instead; a sub-pane indicator (paneId undefined)
        // still gets its own fresh auto-generated pane.
        // calcParams passed as-is (undefined keeps the registered defaults).
        const indId = chart.createIndicator(
          {
            name: ind.id,
            paneId: targetPaneId,
            calcParams: calcParams,
            extendData: extendData,
            styles: styles || undefined,
            visible: isVisible
          },
          true
        );
        const realPaneId = findRealPaneId(indId);
        appliedIndicatorsRef.current.set(ind.instanceId, { name: ind.id, paneId: realPaneId, indId });
      } else {
        // Always target the REAL pane id, and NEVER include paneId:undefined
        // in the override object (that is what orphans sub-pane indicators).
        const info = appliedIndicatorsRef.current.get(ind.instanceId);
        const realPaneId = (info && info.paneId) || findRealPaneId(info && info.indId);
        const overrideObj = {
          name: ind.id,
          calcParams: calcParams,
          extendData: extendData,
          styles: styles || undefined,
          visible: isVisible
        };
        if (realPaneId) overrideObj.paneId = realPaneId;
        chart.overrideIndicator(overrideObj);
        if (info && realPaneId && info.paneId !== realPaneId) info.paneId = realPaneId;
      }
    });

    for (const [instanceId, indInfo] of appliedIndicatorsRef.current.entries()) {
      if (!currentActiveIds.has(instanceId)) {
        chart.removeIndicator({ name: indInfo.name, paneId: indInfo.paneId });
        appliedIndicatorsRef.current.delete(instanceId);
      }
    }
  };

  // Expose methods to App
  useImperativeHandle(ref, () => ({
    createDrawing: (name) => {
      if (chartRef.current) chartRef.current.createOverlay({ name, ...overlayCallbacks() });
    },
    clearDrawings: () => {
      if (chartRef.current) chartRef.current.removeOverlay();
      overlaysRef.current.clear();
      persistDrawings();
    },
    addIndicator: (name, isStack = false) => {
      if (chartRef.current) {
        const targetPane = isStack ? undefined : { id: 'candle_pane' };
        chartRef.current.createIndicator(name, isStack, targetPane);
      }
    },
    removeIndicator: (name) => {
      if (chartRef.current) chartRef.current.removeIndicator({ name });
    },
    setCandleType: (type) => {
      if (!chartRef.current) return;
      if (type === 'area') {
        chartRef.current.setStyles({
          candle: {
            type: 'area',
            area: {
              lineColor: '#2962ff',
              lineSize: 2,
              backgroundColor: [
                { offset: 0, color: 'rgba(41, 98, 255, 0.35)' },
                { offset: 1, color: 'rgba(41, 98, 255, 0)' }
              ]
            }
          }
        });
      } else {
        chartRef.current.setStyles({ candle: { type } });
      }
    },
    applyCustomStyles: (settings) => {
      if (!chartRef.current) return;
      chartRef.current.setStyles({
        grid: {
          horizontal: { color: settings.showGrid ? (settings.gridColor || '#1f2430') : 'transparent' },
          vertical: { color: settings.showGrid ? (settings.gridColor || '#1f2430') : 'transparent' }
        },
        candle: {
          bar: {
            upColor: settings.upColor || '#089981',
            downColor: settings.downColor || '#f23645',
            upBorderColor: settings.upColor || '#089981',
            downBorderColor: settings.downColor || '#f23645',
            upWickColor: settings.upColor || '#089981',
            downWickColor: settings.downColor || '#f23645'
          },
          priceMark: {
            last: {
              show: settings.showPriceLine !== false,
              upColor: settings.upColor || '#089981',
              downColor: settings.downColor || '#f23645'
            }
          }
        }
      });
      if (settings.timezone) chartRef.current.setTimezone(settings.timezone);
    },
    takeSnapshot: () => {
      if (chartRef.current) return chartRef.current.getConvertPictureUrl(true, 'png', '#131722');
      return null;
    },
    getFullData: () => fullDataRef.current,

    // Jump the chart to the bar at (or nearest after) a timestamp — used by the
    // notification list to take the user straight to a past signal.
    scrollToTimestamp: (ts) => {
      if (!chartRef.current) return;
      const data = fullDataRef.current || [];
      if (!data.length) return;
      let idx = -1;
      for (let i = 0; i < data.length; i++) { if (data[i].timestamp >= ts) { idx = i; break; } }
      if (idx < 0) idx = data.length - 1;
      try { chartRef.current.scrollToDataIndex(idx, 300); } catch (e) { /* ignore */ }
    },

    // Reset the chart to a clean, logical view: default zoom + scroll to latest.
    resetView: () => {
      if (!chartRef.current) return;
      try {
        chartRef.current.setBarSpace(8);
        chartRef.current.scrollToRealTime(200);
      } catch (e) { /* ignore */ }
    },
    refreshIndicators: () => syncIndicators(),

    // ---- Replay API ------------------------------------------------------
    // startIndex = how many bars are visible when replay begins.
    enterReplay: (startIndex) => {
      if (!chartRef.current) return 0;
      const total = fullDataRef.current.length;
      if (total === 0) return 0;
      const idx = Math.max(10, Math.min(startIndex ?? Math.floor(total * 0.6), total));
      replayRef.current = { active: true, index: idx };
      stopLiveFeed();
      // Re-seed the chart with just the first `idx` bars. getBars reads
      // replayRef and returns the slice; subscribeBar re-fires afterwards.
      chartRef.current.resetData();
      return idx;
    },
    replayStep: () => {
      if (!replayRef.current.active) return { index: 0, done: true };
      const full = fullDataRef.current;
      const i = replayRef.current.index;
      if (i >= full.length) return { index: i, done: true };
      const bar = full[i];
      if (typeof barCallbackRef.current === 'function') barCallbackRef.current(bar);
      replayRef.current.index = i + 1;
      if (onPriceUpdate) onPriceUpdate(bar.close);
      return { index: replayRef.current.index, done: replayRef.current.index >= full.length };
    },
    exitReplay: () => {
      if (!replayRef.current.active) return;
      replayRef.current = { active: false, index: 0 };
      if (chartRef.current) chartRef.current.resetData(); // reload full live data
    },
    isReplayActive: () => replayRef.current.active,
    getReplayState: () => ({ ...replayRef.current, total: fullDataRef.current.length })
  }));

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = init(chartContainerRef.current);
    if (!chart) return;

    chart.setStyles({
      grid: {
        horizontal: { color: '#1f2430' },
        vertical: { color: '#1f2430' }
      },
      candle: {
        type: 'candle_solid',
        bar: {
          upColor: '#089981',
          downColor: '#f23645',
          noChangeColor: '#888888',
          upBorderColor: '#089981',
          downBorderColor: '#f23645',
          noChangeBorderColor: '#888888',
          upWickColor: '#089981',
          downWickColor: '#f23645',
          noChangeWickColor: '#888888'
        },
        priceMark: {
          last: {
            upColor: '#089981',
            downColor: '#f23645',
            noChangeColor: '#888888'
          }
        }
      },
      xAxis: {
        axisLine: { color: '#2a2e39' },
        tickLine: { color: '#2a2e39' },
        tickText: { color: '#787b86' }
      },
      yAxis: {
        inside: true,
        axisLine: { color: '#2a2e39' },
        tickLine: { color: '#2a2e39' },
        tickText: { color: '#787b86' }
      }
    });

    chart.setDataLoader({
      getBars: async ({ type, timestamp, symbol: symInfo, period, callback }) => {
        const ticker = symInfo?.ticker || 'XAUUSDc';
        const tfStr = periodToTf(period);
        const mapBar = (d) => ({
          timestamp: d.time * 1000,
          open: d.open, high: d.high, low: d.low, close: d.close, volume: d.value
        });

        // Replay mode: serve a slice of already-loaded data, no network.
        if (replayRef.current.active) {
          const slice = fullDataRef.current.slice(0, replayRef.current.index);
          callback(slice, false);
          if (onPriceUpdate && slice.length > 0) onPriceUpdate(slice[slice.length - 1].close);
          return;
        }

        // Paging: 'forward' = user scrolled left, load OLDER bars before `timestamp`.
        if (type === 'forward' && timestamp) {
          try {
            const toSec = Math.floor(timestamp / 1000);
            const res = await fetch(`${API_BASE}/api/history?symbol=${ticker}&timeframe=${tfStr}&count=500&to=${toSec}`);
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
              const older = data.map(mapBar).filter(b => b.timestamp < timestamp);
              fullDataRef.current = [...older, ...fullDataRef.current];
              callback(older, older.length > 0 ? { forward: true, backward: false } : false);
            } else {
              callback([], false); // reached start of history — stop paging
            }
          } catch (err) {
            callback([], false);
          }
          return;
        }

        // init (first load)
        setLoading(true);
        try {
          let res = await fetch(`${API_BASE}/api/history?symbol=${ticker}&timeframe=${tfStr}&count=1500`);
          let data = await res.json();
          // If empty (e.g. fresh MT5 terminal still synchronizing history with broker), wait and retry once
          if (!Array.isArray(data) || data.length === 0) {
            await new Promise(r => setTimeout(r, 1200));
            res = await fetch(`${API_BASE}/api/history?symbol=${ticker}&timeframe=${tfStr}&count=1500`);
            data = await res.json();
          }
          if (Array.isArray(data) && data.length > 0) {
            const klineData = data.map(mapBar);
            fullDataRef.current = klineData;
            // more:{forward:true} lets KLineCharts request older bars on left-scroll
            callback(klineData, { forward: true, backward: false });
            if (onPriceUpdate && klineData.length > 0) {
              onPriceUpdate(klineData[klineData.length - 1].close);
            }
          } else {
            callback([], false);
          }
        } catch (err) {
          console.error('Error loading bars:', err);
          callback([], false);
        } finally {
          setLoading(false);
        }
      },
      // Realtime: KLineCharts calls this after each init load and hands us a
      // callback that updates the forming candle / appends new ones.
      subscribeBar: ({ symbol: symInfo, period, callback }) => {
        barCallbackRef.current = callback;
        const ticker = symInfo?.ticker || 'XAUUSDc';
        const tfStr = periodToTf(period);
        liveSubRef.current = { ticker, tfStr };
        if (!replayRef.current.active) startLiveFeed(ticker, tfStr);
      },
      unsubscribeBar: () => {
        stopLiveFeed();
        barCallbackRef.current = null;
        liveSubRef.current = null;
      }
    });

    chartRef.current = chart;

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      stopLiveFeed();
      dispose(chartContainerRef.current);
    };
  }, []);

  // Update symbol and period when props change
  useEffect(() => {
    if (!chartRef.current) return;
    const period = TF_TO_PERIOD[timeframe] || { type: 'hour', span: 1 };

    // Changing symbol/timeframe leaves replay mode.
    replayRef.current = { active: false, index: 0 };

    chartRef.current.setSymbol({
      ticker: symbol,
      pricePrecision: symbol.includes('JPY') ? 3 : symbol.includes('BTC') ? 2 : 2,
      volumePrecision: 2
    });
    chartRef.current.setPeriod(period);
  }, [symbol, timeframe]);

  // Restore saved drawings when the symbol changes (drawings are per-symbol,
  // and persist across timeframe changes for the same symbol).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.removeOverlay();
    overlaysRef.current.clear();
    let cancelled = false;
    const applyDrawings = (arr) => {
      if (cancelled || !chartRef.current || !Array.isArray(arr)) return;
      arr.forEach(d => {
        if (!d || !d.name) return;
        const id = chartRef.current.createOverlay({ name: d.name, points: d.points, styles: d.styles, ...overlayCallbacks() });
        if (id) overlaysRef.current.set(id, { name: d.name, points: d.points });
      });
    };
    const fromLocal = () => {
      try { const raw = localStorage.getItem(`twr_drawings_${symbol}`); if (raw) applyDrawings(JSON.parse(raw)); } catch (e) { /* ignore */ }
    };
    const t = setTimeout(() => {
      // Backend store is the source of truth; localStorage is the offline fallback.
      fetch(`/api/drawings?symbol=${encodeURIComponent(symbol)}`)
        .then(r => r.json())
        .then(arr => { if (Array.isArray(arr) && arr.length) applyDrawings(arr); else fromLocal(); })
        .catch(fromLocal);
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [symbol]);

  // Sync indicators whenever the indicators prop changes
  useEffect(() => {
    syncIndicators();
  }, [indicators, symbol, timeframe]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {watermarkText && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          fontSize: '10vw',
          fontWeight: 900,
          color: 'rgba(255, 255, 255, 0.025)',
          userSelect: 'none',
          pointerEvents: 'none',
          zIndex: 1,
          letterSpacing: 4
        }}>
          {watermarkText}
        </div>
      )}

      {loading && (
        <div style={{
          position: 'absolute',
          zIndex: 50,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(19, 23, 34, 0.85)',
          padding: '8px 16px',
          borderRadius: 4,
          border: '1px solid var(--border)',
          color: 'var(--text)',
          fontSize: 13,
          pointerEvents: 'none'
        }}>
          Loading {symbol} ({timeframe})...
        </div>
      )}

      {selectedSignalInfo && (
        <div style={{
          position: 'absolute',
          bottom: 40,
          right: 20,
          zIndex: 60,
          background: 'rgba(19, 23, 34, 0.95)',
          border: `1px solid ${selectedSignalInfo.type === 'BUY' ? '#089981' : '#f23645'}`,
          borderRadius: 8,
          padding: 14,
          boxShadow: '0 8px 30px rgba(0,0,0,0.7)',
          width: 280,
          animation: 'fadeIn 0.2s ease'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{
              background: selectedSignalInfo.type === 'BUY' ? '#089981' : '#f23645',
              color: '#fff',
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 12
            }}>
              {selectedSignalInfo.type} SIGNAL
            </span>
            <button
              onClick={() => setSelectedSignalInfo(null)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
            {selectedSignalInfo.strategy || 'Dual Strategy Engine'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            Entry: <strong style={{ color: 'var(--text)' }}>${selectedSignalInfo.entry_price || selectedSignalInfo.entryPrice}</strong>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11, background: 'rgba(255,255,255,0.03)', padding: 8, borderRadius: 4 }}>
            <div>TP1: <strong style={{ color: '#089981' }}>${selectedSignalInfo.tp1 || selectedSignalInfo.tp1Price}</strong></div>
            <div>SL: <strong style={{ color: '#f23645' }}>${selectedSignalInfo.sl || selectedSignalInfo.slPrice}</strong></div>
            <div>R:R: <strong>1:{selectedSignalInfo.tp1_rr || '1.5'}</strong></div>
            <div>Risk: <strong>${selectedSignalInfo.risk_usd || selectedSignalInfo.riskUSD || '12.00'}</strong></div>
          </div>
          {selectedSignalInfo.reasons && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
              Triggers: {Array.isArray(selectedSignalInfo.reasons) ? selectedSignalInfo.reasons.join(', ') : selectedSignalInfo.reasons}
            </div>
          )}
        </div>
      )}

      {/* FLOATING DRAWING EDIT TOOLBAR (appears when a drawing is selected) */}
      {selDrawing && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', zIndex: 70,
            left: Math.max(8, (selDrawing.x || 40) - 120),
            top: Math.max(8, (selDrawing.y || 40) - 48),
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#1e222d', border: '1px solid #2a2e39', borderRadius: 6,
            padding: '5px 8px', boxShadow: '0 6px 20px rgba(0,0,0,0.6)'
          }}
        >
          {['#2962ff', '#089981', '#f23645', '#ff9800', '#ffd600', '#ffffff'].map(c => (
            <button key={c} onClick={() => applyDrawingStyle(c, null)}
              title={`Colour ${c}`} aria-label={`Set drawing colour ${c}`}
              style={{ width: 16, height: 16, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
                border: selDrawing.color === c ? '2px solid #fff' : '1px solid #2a2e39' }} />
          ))}
          <div style={{ width: 1, height: 18, background: '#2a2e39' }} />
          {[1, 2, 3].map(w => (
            <button key={w} onClick={() => applyDrawingStyle(null, w)}
              title={`Line width ${w}`} aria-label={`Set line width ${w}`}
              style={{ width: 24, height: 22, background: selDrawing.size === w ? '#2962ff' : '#131722',
                border: '1px solid #2a2e39', borderRadius: 4, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 14, height: w, background: '#d1d4dc', borderRadius: 1 }} />
            </button>
          ))}
          <div style={{ width: 1, height: 18, background: '#2a2e39' }} />
          <button onClick={alertOnSelectedLine} title="Alert when price touches this line" aria-label="Alert on this line"
            style={{ background: 'none', border: 'none', color: '#f7a600', cursor: 'pointer', padding: 2, display: 'flex' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </button>
          <div style={{ width: 1, height: 18, background: '#2a2e39' }} />
          <button onClick={deleteSelectedDrawing} title="Delete drawing" aria-label="Delete drawing"
            style={{ background: 'none', border: 'none', color: '#f23645', cursor: 'pointer', padding: 2, display: 'flex' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        </div>
      )}

      <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
});

export default KLineChartArea;
