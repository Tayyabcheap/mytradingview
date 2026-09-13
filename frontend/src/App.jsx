import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  LineChart, Settings, Camera, Search, Maximize, X, 
  Bell, RotateCcw, ChevronDown, Download, Check, Zap, 
  TrendingUp, TrendingDown, Layers, LayoutDashboard, BookOpen, 
  CandlestickChart, Plus, DollarSign, BarChart2, Award
} from 'lucide-react';
import TopTabBar from './components/TopTabBar';
import DashboardTab from './components/DashboardTab';
import TradeJournalTab from './components/TradeJournalTab';
import TradeExecutionPanel from './components/TradeExecutionPanel';
import SymbolSearchModal from './components/SymbolSearchModal';
import KLineChartArea from './components/KLineChartArea';
import MonteCarloTab from './components/MonteCarloTab';
import GoldOrderBlocksTab from './components/GoldOrderBlocksTab';
import SupportResistanceTab from './components/SupportResistanceTab';
import MarketScreenerModal from './components/MarketScreenerModal';
import NotificationSettingsModal from './components/NotificationSettingsModal';
import SignalPerformanceModal from './components/SignalPerformanceModal';
import UpdateModal from './components/UpdateModal';
import QuantIntelligenceModal from './components/QuantIntelligenceModal';
import { computeSignalSeries, scoreSignalSeries } from './components/signalCore';

import FlyoutToolbar from './components/FlyoutToolbar';
import IndicatorsModal from './components/IndicatorsModal';
import IndicatorSettingsModal from './components/IndicatorSettingsModal';
import IndicatorLegend from './components/IndicatorLegend';
import AlertsPanel from './components/AlertsPanel';
import ChartSettingsModal from './components/ChartSettingsModal';
import ReplayBar from './components/ReplayBar';
import FavoritesBar from './components/FavoritesBar';
import BottomBar from './components/BottomBar';
import { pineMeta, registerPineScript } from './components/pineEngine';
import './index.css';

// --- Lightweight localStorage persistence ---
const LS_PREFIX = 'twr_';
function loadLS(key, fallback) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}
function saveLS(key, value) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch (e) {}
}

const CHART_TYPES = [
  { id: 'candle_solid', label: 'Candles', icon: '🕯️' },
  { id: 'candle_stroke', label: 'Hollow Candles', icon: '🪔' },
  { id: 'ohlc', label: 'Bars (OHLC)', icon: '📊' },
  { id: 'area', label: 'Area / Line', icon: '📈' }
];

const WATCHLIST_SYMBOLS = ["XAUUSDc", "EURUSDc", "GBPUSDc", "USDJPYc", "BTCUSDc"];

const DEFAULT_PINE = `//@version=6
indicator("My Script", overlay=true)
fast = ta.ema(close, 21)
slow = ta.ema(close, 50)
plot(fast, "Fast EMA", color=color.yellow, linewidth=2)
plot(slow, "Slow EMA", color=color.orange, linewidth=2)
buy = ta.crossover(fast, slow)
sell = ta.crossunder(fast, slow)
plotshape(buy, style=shape.triangleup, location=location.belowbar, color=color.green, text="BUY")
plotshape(sell, style=shape.triangledown, location=location.abovebar, color=color.red, text="SELL")`;

const REAL_DIP_PINE = `//@version=6
indicator("Haider-Gold-Scalper [SL Buffer]", overlay=true, max_labels_count=500)

// ==========================================
// 1. INPUTS
// ==========================================
grp_settings = "Strategy Settings"
atrLen = input.int(14, "ATR Length", group=grp_settings)
impulseMult = input.float(1.0, "Big Candle Size (x ATR)", step=0.1, group=grp_settings)

grp_rsi = "RSI Filter (Finding Real Dips)"
rsiLen = input.int(14, "RSI Length", group=grp_rsi)
rsiBuyLevel = input.float(35.0, "RSI Oversold (Buy Zone)", group=grp_rsi)
rsiSellLevel = input.float(65.0, "RSI Overbought (Sell Zone)", group=grp_rsi)

grp_levels = "Risk Management"
targetLevel = input.float(50.0, "Target Level % (TP)", step=1.0, group=grp_levels)
slBuffer = input.float(1.0, "SL Buffer (x ATR)", step=0.1, group=grp_levels)

// ==========================================
// 2. DETECT THE "BIG CANDLE" + EXHAUSTION
// ==========================================
float currentAtr = ta.atr(atrLen)
float candleBody = math.abs(close - open)
float candleRange = high - low

float rsi = ta.rsi(close, rsiLen)

bool isRealBuySetup = close < open and candleBody > (currentAtr * impulseMult) and rsi < rsiBuyLevel
bool isRealSellSetup = close > open and candleBody > (currentAtr * impulseMult) and rsi > rsiSellLevel

var int setupState = 0 
var int setupBarIndex = na
var float setupHigh = na
var float setupLow = na
var float setupRange = na
var float tpLevel = na      
var float slLevel = na      

// ==========================================
// 3. STATE MACHINE LOGIC (CONFIRMED CLOSE ONLY)
// ==========================================
if setupState == 1 and high > slLevel
    setupState := 0
if setupState == -1 and low < slLevel
    setupState := 0

if barstate.isconfirmed
    if isRealSellSetup and setupState == 0
        setupState := 1
        setupBarIndex := bar_index
        setupHigh := high
        setupLow := low
        setupRange := candleRange
        tpLevel := setupHigh - (setupRange * (targetLevel / 100))
        slLevel := setupHigh + (currentAtr * slBuffer) 

    else if isRealBuySetup and setupState == 0
        setupState := -1
        setupBarIndex := bar_index
        setupHigh := high
        setupLow := low
        setupRange := candleRange
        tpLevel := setupLow + (setupRange * (targetLevel / 100))
        slLevel := setupLow - (currentAtr * slBuffer) 

// ==========================================
// 4. SIGNAL GENERATION (NEXT CANDLE AFTER CLOSE)
// ==========================================
bool buySignal = false
bool sellSignal = false
float entry = na

if setupState == 1 and bar_index > setupBarIndex
    sellSignal := true
    entry := open
    setupState := 0 

if setupState == -1 and bar_index > setupBarIndex
    buySignal := true
    entry := open
    setupState := 0 

// ==========================================
// 5. VISUALS (SHAPES + LEVEL LINES)
// ==========================================
plot(setupState != 0 ? tpLevel : na, color=color.blue, linewidth=2, title="TP", style=plot.style_linebr)
plot(setupState != 0 ? slLevel : na, color=color.red, linewidth=1, title="SL (Buffered)", style=plot.style_linebr)

bgcolor(isRealBuySetup ? color.new(color.green, 90) : isRealSellSetup ? color.new(color.red, 90) : na)

plotshape(buySignal, title="Buy Signal", text="BUY", style=shape.labelup, location=location.belowbar, color=color.green, textcolor=color.white, size=size.large)
plotshape(sellSignal, title="Sell Signal", text="SELL", style=shape.labeldown, location=location.abovebar, color=color.red, textcolor=color.white, size=size.large)`;

// Initial default active indicators
const INITIAL_INDICATORS = [
  {
    instanceId: 'LuxAlgo_SMC_default',
    id: 'LuxAlgo_SMC',
    name: 'Smart Money Concepts [LuxAlgo]',
    shortName: 'Lux SMC',
    isStack: false,
    visible: true,
    params: { period: 10, showOB: true, showBOS: true },
    styles: {
      lines: [
        { color: '#089981', size: 1, style: 'dashed' },
        { color: '#089981', size: 1, style: 'solid' },
        { color: '#f23645', size: 1, style: 'dashed' },
        { color: '#f23645', size: 1, style: 'solid' }
      ]
    }
  },
  {
    instanceId: 'EMA_default',
    id: 'EMA',
    name: 'Moving Average Exponential',
    shortName: 'EMA',
    isStack: false,
    visible: true,
    params: { p1: 9, p2: 21, p3: 50, p4: 200, source: 'close' },
    styles: {
      lines: [
        { color: '#2962ff', size: 1.5, style: 'solid' },
        { color: '#ff9800', size: 1.5, style: 'solid' },
        { color: '#9c27b0', size: 1.5, style: 'solid' },
        { color: '#fdd835', size: 1.5, style: 'solid' }
      ]
    }
  },
  {
    instanceId: 'SIGNALS_default',
    id: 'SIGNALS',
    name: 'Dual-Strategy Algorithmic Signals',
    shortName: 'Signals',
    isStack: false,
    visible: true,
    params: { strategy: 'ALL', minRR: 1.5, slLookback: 20, showTPLines: true, showBadges: true },
    styles: {
      lines: [
        { color: 'transparent', size: 1, style: 'solid' },
        { color: 'transparent', size: 1, style: 'solid' },
        { color: '#089981', size: 1, style: 'dashed' },
        { color: '#f23645', size: 1, style: 'dashed' }
      ]
    }
  }
];

const INITIAL_WORKSPACE_TABS = [
  { id: 'dashboard', title: 'Dashboard', type: 'dashboard', closable: false },
  { id: 'chart-main', title: 'Chart: XAUUSDc', type: 'chart', symbol: 'XAUUSDc', timeframe: '1H', closable: false },
  { id: 'gold_order_blocks', title: 'Gold Order Blocks', type: 'order_blocks', closable: false },
  { id: 'support_resistance', title: 'Support & Resistance', type: 'support_resistance', closable: false },
  { id: 'journal', title: 'Trade Journal', type: 'journal', closable: false },
  { id: 'monte_carlo', title: 'Monte Carlo Stress Lab', type: 'monte_carlo', closable: false }
];

function App() {
  // Top Workspace Tabs
  const [workspaceTabs, setWorkspaceTabs] = useState(() => {
    const loaded = loadLS('workspaceTabs', INITIAL_WORKSPACE_TABS);
    if (!loaded.some(t => t.id === 'monte_carlo')) {
      loaded.push({ id: 'monte_carlo', title: 'Monte Carlo Stress Lab', type: 'monte_carlo', closable: false });
    }
    if (!loaded.some(t => t.id === 'gold_order_blocks')) {
      loaded.push({ id: 'gold_order_blocks', title: 'Gold Order Blocks', type: 'order_blocks', closable: false });
    }
    if (!loaded.some(t => t.id === 'support_resistance')) {
      loaded.push({ id: 'support_resistance', title: 'Support & Resistance', type: 'support_resistance', closable: false });
    }
    return loaded;
  });
  const [activeTabId, setActiveTabId] = useState(() => loadLS('activeTabId', 'chart-main'));

  // Current Chart state
  const [symbol, setSymbol] = useState(() => loadLS('symbol', 'XAUUSDc'));
  const [timeframe, setTimeframe] = useState(() => loadLS('timeframe', '1H'));
  const [chartType, setChartType] = useState(() => loadLS('chartType', 'candle_solid'));
  const [showChartTypeMenu, setShowChartTypeMenu] = useState(false);
  const [showSymbolSearch, setShowSymbolSearch] = useState(false);
  
  // Backtest state
  const [showBacktest, setShowBacktest] = useState(false);
  const [btStrategy, setBtStrategy] = useState(() => loadLS('btStrategy', 'real_dip'));
  const [btData, setBtData] = useState(null);
  const [btLoading, setBtLoading] = useState(false);
  const [btError, setBtError] = useState(null);
  const [btOffset, setBtOffset] = useState(() => loadLS('btOffset', 0));
  const [btBars, setBtBars] = useState(() => loadLS('btBars', 3000));
  const [showSigAccuracy, setShowSigAccuracy] = useState(false);
  const [sigAcc, setSigAcc] = useState(null);
  const [sigAccLoading, setSigAccLoading] = useState(false);
  const [sigAccError, setSigAccError] = useState(null);

  // Pine Script State
  const [showPineEditor, setShowPineEditor] = useState(false);
  const [pineSource, setPineSource] = useState(() => loadLS('pineSource', DEFAULT_PINE));
  const [pineResult, setPineResult] = useState(null);

  // Modals
  const [showIndicatorsModal, setShowIndicatorsModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showSnapshotModal, setShowSnapshotModal] = useState(false);
  const [snapshotUrl, setSnapshotUrl] = useState(null);
  const [showScreenerModal, setShowScreenerModal] = useState(false);
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [showSignalPerformanceModal, setShowSignalPerformanceModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showIntelligenceModal, setShowIntelligenceModal] = useState(false);
  const [appVersion, setAppVersion] = useState("v2.5.0");
  const [hasUpdateAvailable, setHasUpdateAvailable] = useState(false);

  // Query application version and background update status on startup
  useEffect(() => {
    fetch('/api/system/version')
      .then(r => r.json())
      .then(d => {
        if (d && d.version) setAppVersion(d.version);
      })
      .catch(() => {});

    fetch('/api/app/update-status')
      .then(r => r.json())
      .then(d => {
        if (d && d.behind > 0) setHasUpdateAvailable(true);
      })
      .catch(() => {});
  }, []);

  // Indicators State
  const [indicators, setIndicators] = useState(() => loadLS('indicators', INITIAL_INDICATORS));
  const [editingIndicator, setEditingIndicator] = useState(null);

  // Signals State (Haider-Gold-Scalper & Haider-Scalper-Enhanced)
  const DEFAULT_SIGNAL_STRATEGIES = {
    REAL_DIP: true,
    HAIDER_ENHANCED: false
  };
  const [signalsEnabled, setSignalsEnabled] = useState(() => loadLS('signalsEnabled', true));
  const [activeSignalStrategies, setActiveSignalStrategies] = useState(() => {
    const saved = loadLS('activeSignalStrategies', null);
    if (saved && typeof saved === 'object') {
      return { REAL_DIP: !!saved.REAL_DIP, HAIDER_ENHANCED: !!saved.HAIDER_ENHANCED };
    }
    return { REAL_DIP: true, HAIDER_ENHANCED: false };
  });
  const [showSignalsMenu, setShowSignalsMenu] = useState(false);
  const [signalsList, setSignalsList] = useState([]);

  // Dynamic Favorites Bar State (Tools favorited in menu appear in draggable bar)
  const DEFAULT_FAVORITE_TOOLS = ['segment', 'horizontalStraightLine', 'rect', 'longPosition', 'shortPosition', 'simpleAnnotation'];
  const [favoriteToolIds, setFavoriteToolIds] = useState(() => loadLS('favoriteToolIds', DEFAULT_FAVORITE_TOOLS));

  const handleToggleFavoriteTool = (toolId) => {
    setFavoriteToolIds(prev => {
      const next = prev.includes(toolId) ? prev.filter(id => id !== toolId) : [...prev, toolId];
      saveLS('favoriteToolIds', next);
      return next;
    });
  };

  // MT5 Data State
  const [symbols, setSymbols] = useState([]);
  const [accountInfo, setAccountInfo] = useState(null);
  const [activeSidebarTab, setActiveSidebarTab] = useState('trade'); // 'trade' | 'watchlist' | 'alerts'
  const [currentPrice, setCurrentPrice] = useState(null);
  const [watchQuotes, setWatchQuotes] = useState({});
  const [watchlist, setWatchlist] = useState(() => loadLS('watchlist', WATCHLIST_SYMBOLS));
  const [wlQuery, setWlQuery] = useState('');
  const wlLoadedRef = useRef(false);
  const [activeRange, setActiveRange] = useState('1M');

  // Chart Settings
  const [chartSettings, setChartSettings] = useState(() => loadLS('chartSettings', {
    upColor: '#089981',
    downColor: '#f23645',
    showGrid: true,
    gridColor: '#1f2430',
    showPriceLine: true,
    showWatermark: false,
    timezone: 'UTC'
  }));

  // Replay Mode State
  const [isReplayMode, setIsReplayMode] = useState(false);
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [replayIndex, setReplayIndex] = useState(0);

  // Alerts State
  const [alerts, setAlerts] = useState(() => loadLS('alerts', [
    { id: 1, symbol: 'XAUUSDc', targetPrice: 4600.00, condition: 'greater', message: 'XAUUSD Major Breakout', active: true, createdAt: '10:30 AM' }
  ]));
  const [alertLogs, setAlertLogs] = useState([]);
  const [alertToast, setAlertToast] = useState(null);
  const prevPriceRef = useRef(null);
  const beepCtxRef = useRef(null);
  const sigToastTimerRef = useRef(null);
  const notifiedSigRef = useRef(loadLS('notifiedSig', {}));
  const autoTradedSigRef = useRef(loadLS('autoTradedSig', {}));
  const [signalToast, setSignalToast] = useState(null);
  const [signalToastLot, setSignalToastLot] = useState('0.01');
  const [signalNotifications, setSignalNotifications] = useState(() => loadLS('signalNotifications', []));
  const [showNotifications, setShowNotifications] = useState(false);

  // Active lot size synchronized across trade panel, signals, and database settings
  const [activeLotSize, setActiveLotSize] = useState(() => {
    const saved = localStorage.getItem('twr_trade_lotSize');
    return saved ? Math.max(0.01, parseFloat(saved) || 0.01) : 0.01;
  });
  const [autoTradeSignals, setAutoTradeSignals] = useState(() => loadLS('autoTradeSignals', true));

  // Sync lot size from database settings on mount
  useEffect(() => {
    fetch('/api/settings?key=lot_size')
      .then(r => r.json())
      .then(d => {
        if (d && typeof d.lot_size === 'number' && d.lot_size > 0) {
          setActiveLotSize(d.lot_size);
        }
      })
      .catch(() => {});
  }, []);

  const chartRef = useRef();
  const replayTimerRef = useRef(null);

  // Load account info & broker symbols from backend
  const fetchAccountAndSymbols = () => {
    fetch('/api/account')
      .then(r => r.json())
      .then(data => {
        if (data && !data.error) setAccountInfo(data);
      })
      .catch(() => {});

    fetch('/api/symbols')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setSymbols(data);
          // Auto-align symbol if the currently selected symbol does not exist on this broker account
          setSymbol(curr => {
            if (data.some(s => s.name === curr)) return curr;
            const goldMatch = data.find(s => {
              const u = s.name.toUpperCase();
              return u.startsWith('XAUUSD') || u.includes('GOLD');
            });
            const matched = goldMatch ? goldMatch.name : (data[0]?.name || curr);
            setWorkspaceTabs(tabs => tabs.map(t => (t.type === 'chart' && !data.some(s => s.name === t.symbol))
              ? { ...t, symbol: matched, title: `Chart: ${matched}` }
              : t
            ));
            return matched;
          });
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchAccountAndSymbols();
    const interval = setInterval(fetchAccountAndSymbols, 10000);
    return () => clearInterval(interval);
  }, []);

  // Fetch Signals from backend
  useEffect(() => {
    if (!signalsEnabled) return;
    const activeKeys = Object.entries(activeSignalStrategies).filter(([_, on]) => on).map(([k]) => k).join(',');
    fetch(`/api/signals?symbol=${symbol}&timeframe=${timeframe}&strategy=${activeKeys || 'ALL'}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSignalsList(data);
        }
      })
      .catch(err => console.error("Error fetching signals:", err));
  }, [symbol, timeframe, activeSignalStrategies, signalsEnabled]);

  // Persist state to localStorage
  useEffect(() => { saveLS('workspaceTabs', workspaceTabs); }, [workspaceTabs]);

  // Ensure workspace tabs reflect current structure and purge deleted tabs (academy, secret, brains, manual)
  useEffect(() => {
    setWorkspaceTabs(prev => {
      let next = prev.filter(t => !['academy', 'secret', 'brains', 'brainsactivity', 'brainsperf', 'manual'].includes(t.type));
      return next;
    });
    setActiveTabId(curr => (['secret', 'academy', 'brains', 'brainsactivity', 'brainsperf', 'manual'].includes(curr) ? 'chart-main' : curr));
  }, []);

  // Log a timestamped snapshot of the current signals for future analysis.
  const signalLogKeyRef = useRef('');
  useEffect(() => {
    if (!signalsEnabled) return;
    const activeKeys = Object.entries(activeSignalStrategies).filter(([_, on]) => on).map(([k]) => k).join(',');
    const key = `${symbol}|${timeframe}|${activeKeys}|${new Date().toISOString().slice(0, 10)}`;
    if (signalLogKeyRef.current === key) return;
    const t = setTimeout(() => {
      try {
        const data = (chartRef.current && chartRef.current.getFullData) ? chartRef.current.getFullData() : [];
        if (!data || data.length < 60) return;
        const series = computeSignalSeries(data, activeSignalStrategies, 20, timeframe);
        const summary = scoreSignalSeries(series);
        const sigs = [];
        series.forEach((d, i) => {
          if (d && d.signalType) sigs.push({
            t: data[i] ? data[i].timestamp : null, type: d.signalType,
            entry: d.entryPrice, sl: d.slPrice, tp1: d.tp1Price, tp2: d.tp2Price,
            outcome: d.outcome, strategy: d.strategy
          });
        });
        signalLogKeyRef.current = key;
        fetch('/api/signals/log', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, timeframe, strategy: activeKeys, signals: sigs, summary })
        }).catch(() => {});
      } catch (e) { /* offline */ }
    }, 4000);
    return () => clearTimeout(t);
  }, [symbol, timeframe, activeSignalStrategies, signalsEnabled]);
  useEffect(() => { saveLS('activeTabId', activeTabId); }, [activeTabId]);
  useEffect(() => { saveLS('symbol', symbol); }, [symbol]);
  useEffect(() => { saveLS('timeframe', timeframe); }, [timeframe]);
  useEffect(() => { saveLS('chartType', chartType); }, [chartType]);
  useEffect(() => { saveLS('indicators', indicators); }, [indicators]);
  useEffect(() => { saveLS('chartSettings', chartSettings); }, [chartSettings]);
  useEffect(() => { saveLS('alerts', alerts); }, [alerts]);
  useEffect(() => { saveLS('signalNotifications', signalNotifications); }, [signalNotifications]);
  useEffect(() => { saveLS('signalsEnabled', signalsEnabled); }, [signalsEnabled]);
  useEffect(() => { saveLS('activeSignalStrategies', activeSignalStrategies); }, [activeSignalStrategies]);
  useEffect(() => { saveLS('favoriteToolIds', favoriteToolIds); }, [favoriteToolIds]);

  // Keep SIGNALS indicator updated with current timeframe and active strategies
  useEffect(() => {
    setIndicators(prev => prev.map(ind => ind.id === 'SIGNALS' ? {
      ...ind,
      params: { ...ind.params, strategy: activeSignalStrategies, timeframe }
    } : ind));
  }, [timeframe, activeSignalStrategies]);

  // Evaluate price alerts on each tick: crossing / crossing up / crossing down / >= / <=,
  // 'once' vs 'repeat' trigger, and optional expiry.
  useEffect(() => {
    const price = currentPrice;
    if (price == null) return;
    const prev = prevPriceRef.current;
    prevPriceRef.current = price;
    if (prev == null || prev === price) return;
    const now = Date.now();
    const fired = [];
    let changed = false;
    const updated = alerts.map(a => {
      if (!a.active || a.symbol !== symbol) return a;
      if (a.expiry && now > a.expiry) { changed = true; return { ...a, active: false }; }
      const t = a.targetPrice;
      let hit = false;
      if (a.condition === 'greater') hit = price >= t;
      else if (a.condition === 'less') hit = price <= t;
      else if (a.condition === 'crossing_up') hit = prev < t && price >= t;
      else if (a.condition === 'crossing_down') hit = prev > t && price <= t;
      else hit = (prev < t && price >= t) || (prev > t && price <= t);
      if (!hit) return a;
      if (a.trigger === 'repeat' && a.lastFired && now - a.lastFired < 5000) return a;
      fired.push(a);
      changed = true;
      return a.trigger === 'repeat' ? { ...a, lastFired: now } : { ...a, active: false, lastFired: now };
    });
    if (changed) setAlerts(updated);
    if (fired.length) {
      const lbl = { greater: '≥', less: '≤', crossing_up: 'crossed up through', crossing_down: 'crossed down through', crossing: 'crossed' };
      const logs = fired.map(a => ({
        text: `🔔 ${a.name ? a.name + ' — ' : ''}${a.symbol} ${lbl[a.condition] || 'hit'} ${a.targetPrice} @ ${price.toFixed(2)}`,
        time: new Date().toLocaleTimeString()
      }));
      setAlertLogs(l => [...logs, ...l].slice(0, 30));
      setAlertToast(logs[0].text);
      playBeep(880, 0.16); setTimeout(() => playBeep(1150, 0.16), 150);
      setTimeout(() => setAlertToast(null), 6000);
    }
  }, [currentPrice, symbol, alerts]);

  // Live quotes polling
  useEffect(() => {
    const syms = Array.from(new Set([...watchlist, symbol]));
    let cancelled = false;
    const poll = () => {
      fetch(`/api/quotes?symbols=${syms.join(',')}`)
        .then(r => r.json())
        .then(rows => {
          if (cancelled || !Array.isArray(rows)) return;
          setWatchQuotes(prev => {
            const next = { ...prev };
            rows.forEach(row => {
              if (row.price == null) return;
              const old = prev[row.symbol];
              let dir = old?.dir || 'flat';
              if (old && typeof old.price === 'number') {
                if (row.price > old.price) dir = 'up';
                else if (row.price < old.price) dir = 'down';
              }
              next[row.symbol] = { price: row.price, dir };
            });
            return next;
          });
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol, watchlist]);

  // Load watchlist from the backend store (survives browser clear / restart)
  useEffect(() => {
    fetch('/api/watchlist')
      .then(r => r.json())
      .then(list => { if (Array.isArray(list) && list.length) setWatchlist(list); })
      .catch(() => {})
      .finally(() => { wlLoadedRef.current = true; });
  }, []);

  // Persist watchlist changes (only after the initial load, to avoid clobbering it)
  useEffect(() => {
    if (!wlLoadedRef.current) return;
    saveLS('watchlist', watchlist);
    fetch('/api/watchlist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: watchlist })
    }).catch(() => {});
  }, [watchlist]);

  const addToWatchlist = (sym) => { setWatchlist(prev => prev.includes(sym) ? prev : [...prev, sym]); setWlQuery(''); };
  const removeFromWatchlist = (sym) => { setWatchlist(prev => prev.filter(s => s !== sym)); };

  // Active workspace tab
  const activeTab = useMemo(() => {
    return workspaceTabs.find(t => t.id === activeTabId) || workspaceTabs[0];
  }, [workspaceTabs, activeTabId]);

  // Tab Handlers
  const handleSelectWorkspaceTab = (tabId) => {
    setActiveTabId(tabId);
    const target = workspaceTabs.find(t => t.id === tabId);
    if (target && target.type === 'chart' && target.symbol) {
      setSymbol(target.symbol);
      if (target.timeframe) setTimeframe(target.timeframe);
    }
  };

  const handleAddChartTab = (initialSymbol = 'EURUSDc', initialTf = '1H') => {
    const newId = `chart-${Date.now()}`;
    const newTab = {
      id: newId,
      title: `Chart: ${initialSymbol}`,
      type: 'chart',
      symbol: initialSymbol,
      timeframe: initialTf,
      closable: true
    };
    setWorkspaceTabs(prev => [...prev, newTab]);
    setActiveTabId(newId);
    setSymbol(initialSymbol);
    setTimeframe(initialTf);
  };

  const handleCloseWorkspaceTab = (tabId) => {
    setWorkspaceTabs(prev => {
      const filtered = prev.filter(t => t.id !== tabId);
      if (activeTabId === tabId) {
        setActiveTabId(filtered[filtered.length - 1]?.id || 'dashboard');
      }
      return filtered;
    });
  };

  // Drag-to-reorder workspace tabs
  const handleReorderTab = (fromId, toId) => {
    setWorkspaceTabs(prev => {
      const arr = [...prev];
      const fromIdx = arr.findIndex(t => t.id === fromId);
      const toIdx = arr.findIndex(t => t.id === toId);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return prev;
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return arr;
    });
  };

  // Switch symbol & jump to chart
  const handleSelectSymbolAndGoToChart = (newSym) => {
    setSymbol(newSym);
    // Find first chart tab or activate current
    const chartTab = workspaceTabs.find(t => t.type === 'chart');
    if (chartTab) {
      setActiveTabId(chartTab.id);
      setWorkspaceTabs(prev => prev.map(t => t.id === chartTab.id ? { ...t, symbol: newSym, title: `Chart: ${newSym}` } : t));
    } else {
      handleAddChartTab(newSym, '1H');
    }
  };

  const handleSelectSymbol = (newSym) => {
    setSymbol(newSym);
    setWorkspaceTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, symbol: newSym, title: `Chart: ${newSym}` } : t));
  };

  // Drawing Tool selection
  const handleSelectTool = (toolName) => {
    if (chartRef.current && toolName !== 'cursor') {
      chartRef.current.createDrawing(toolName);
    }
  };

  const handleClearDrawings = () => {
    if (chartRef.current) {
      chartRef.current.clearDrawings();
    }
  };

  // Global Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      const tag = (el && el.tagName ? el.tagName : '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (el && el.isContentEditable)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowSymbolSearch(true);
        return;
      }
      if (e.altKey) {
        if (e.shiftKey && e.key.toLowerCase() === 'r') { e.preventDefault(); handleSelectTool('rect'); return; }
        const map = {
          t: 'segment',
          h: 'horizontalStraightLine',
          j: 'horizontalRayLine',
          v: 'verticalStraightLine',
          f: 'fibonacciLine'
        };
        const tool = map[e.key.toLowerCase()];
        if (tool) { e.preventDefault(); handleSelectTool(tool); return; }
      }
      if (e.key === 'Escape') {
        setShowSymbolSearch(false);
        setShowIndicatorsModal(false);
        setShowSettingsModal(false);
        setShowChartTypeMenu(false);
        setShowSignalsMenu(false);
        setShowSnapshotModal(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSelectChartType = (typeId) => {
    setChartType(typeId);
    setShowChartTypeMenu(false);
    chartRef.current?.setCandleType(typeId);
  };

  // Indicators Handlers
  const handleToggleIndicator = (indicatorMeta) => {
    const existingIndex = indicators.findIndex(i => i.id === indicatorMeta.id);
    if (existingIndex !== -1 && !indicatorMeta.forceAdd) {
      setIndicators(prev => prev.filter(i => i.id !== indicatorMeta.id));
      if (indicatorMeta.id === 'SIGNALS') setSignalsEnabled(false);
    } else {
      if (indicators.length >= 10) {
        alert("Maximum of 10 indicators reached on the chart.");
        return;
      }
      const newInstanceId = `${indicatorMeta.id}_${Date.now()}`;
      let defaultParams = { period: 14 };
      let defaultStyles = {};

      if (indicatorMeta.id === 'EMA' || indicatorMeta.id === 'MA' || indicatorMeta.id === 'SMA') {
        defaultParams = { p1: 9, p2: 21, p3: 50, p4: 200, source: 'close' };
        defaultStyles = {
          lines: [
            { color: '#2962ff', size: 1.5, style: 'solid' },
            { color: '#ff9800', size: 1.5, style: 'solid' },
            { color: '#9c27b0', size: 1.5, style: 'solid' },
            { color: '#fdd835', size: 1.5, style: 'solid' }
          ]
        };
      } else if (indicatorMeta.id === 'LuxAlgo_SMC') {
        defaultParams = { period: 10, showOB: true, showBOS: true };
      } else if (indicatorMeta.id === 'SIGNALS') {
        defaultParams = { strategy: 'ALL', minRR: 1.5, slLookback: 20, showTPLines: true, showBadges: true };
        setSignalsEnabled(true);
      } else if (indicatorMeta.id === 'SR_ZONES') {
        defaultParams = { tf: timeframe || '15M', tfs: [timeframe || '15M'], filterMode: 'nearest', maxZones: 1, pivot: 3 };
      } else if (indicatorMeta.id === 'ORDER_BLOCKS') {
        defaultParams = { tf: timeframe || '15M', tfs: [timeframe || '15M'], filterMode: 'nearest', maxZones: 1, atrLen: 14 };
      }

      const newIndicator = {
        instanceId: newInstanceId,
        id: indicatorMeta.id,
        name: indicatorMeta.name,
        shortName: indicatorMeta.shortName || indicatorMeta.id,
        isStack: indicatorMeta.isStack || false,
        visible: true,
        params: defaultParams,
        defaultParams,
        styles: defaultStyles,
        defaultStyles
      };
      setIndicators(prev => [...prev, newIndicator]);
    }
  };

  const handleToggleIndicatorVisibility = (instanceId) => {
    setIndicators(prev => prev.map(ind => {
      if (ind.instanceId === instanceId) {
        const nextVisible = !ind.visible;
        if (ind.id === 'SIGNALS') setSignalsEnabled(nextVisible);
        return { ...ind, visible: nextVisible };
      }
      return ind;
    }));
  };

  const handleSaveIndicatorSettings = (instanceId, { params, styles, visible }) => {
    setIndicators(prev => prev.map(ind => ind.instanceId === instanceId ? { ...ind, params, styles, visible } : ind));
  };

  const handleRemoveIndicator = (instanceId) => {
    setIndicators(prev => {
      const target = prev.find(i => i.instanceId === instanceId);
      if (target && target.id === 'SIGNALS') setSignalsEnabled(false);
      return prev.filter(i => i.instanceId !== instanceId);
    });
  };

  const handleToggleSignals = () => {
    const nextState = !signalsEnabled;
    setSignalsEnabled(nextState);
    const signalsInd = indicators.find(i => i.id === 'SIGNALS');
    if (nextState) {
      const hasAny = Object.values(activeSignalStrategies).some(Boolean);
      const strats = hasAny ? activeSignalStrategies : { REAL_DIP: true };
      if (!hasAny) setActiveSignalStrategies(strats);
      if (signalsInd) {
        setIndicators(prev => prev.map(i => i.id === 'SIGNALS' ? { ...i, visible: true, params: { ...i.params, strategy: strats, timeframe } } : i));
      } else {
        handleToggleIndicator({
          id: 'SIGNALS',
          name: 'Haider-Gold-Scalper Signals',
          shortName: 'Signals',
          isStack: false,
          isOverlay: true
        });
      }
    } else {
      if (signalsInd) {
        setIndicators(prev => prev.map(i => i.id === 'SIGNALS' ? { ...i, visible: false } : i));
      }
    }
  };

  const runSignalAccuracy = () => {
    setSigAccLoading(true); setSigAccError(null); setSigAcc(null);
    setShowSigAccuracy(true); setShowSignalsMenu(false);
    // Measure the SAME engine that draws the on-chart signals, on the exact
    // data currently loaded on the chart -> the accuracy report always matches
    // what you see (one engine, no backend mismatch).
    try {
      const data = (chartRef.current && chartRef.current.getFullData) ? chartRef.current.getFullData() : [];
      if (!data || data.length < 60) {
        setSigAccError('Not enough chart data loaded yet - open a chart, let it load, then retry.');
        setSigAccLoading(false);
        return;
      }
      const hasAny = Object.values(activeSignalStrategies || {}).some(Boolean);
      const stratsToTest = hasAny ? activeSignalStrategies : { HAIDER_ENHANCED: true, REAL_DIP: true };
      const series = computeSignalSeries(data, stratsToTest, 20, timeframe);
      const combined = scoreSignalSeries(series);
      const longs = scoreSignalSeries(series.filter(d => !d || d.signalType !== 'SELL'));
      const shorts = scoreSignalSeries(series.filter(d => !d || d.signalType !== 'BUY'));
      const fmt = ts => { try { return new Date(ts).toISOString().slice(0, 10); } catch (e) { return ''; } };
      setSigAcc({
        from: fmt(data[0].timestamp),
        to: fmt(data[data.length - 1].timestamp),
        bars: data.length,
        combined,
        by_strategy: { 'Longs (BUY)': longs, 'Shorts (SELL)': shorts }
      });
    } catch (e) {
      setSigAccError(String(e));
    }
    setSigAccLoading(false);
  };

  const handleToggleSignalStrategy = (strategyKey) => {
    setActiveSignalStrategies(prev => {
      const next = { ...prev, [strategyKey]: !prev[strategyKey] };
      saveLS('activeSignalStrategies', next);
      const hasAny = Object.values(next).some(Boolean);
      setSignalsEnabled(hasAny);
      setIndicators(indList => indList.map(ind => ind.id === 'SIGNALS' ? {
        ...ind,
        visible: hasAny,
        params: { ...ind.params, strategy: next, timeframe }
      } : ind));
      return next;
    });
  };

  const handleSelectAllSignalStrategies = (enableAll = true) => {
    const next = { REAL_DIP: enableAll, HAIDER_ENHANCED: enableAll };
    setActiveSignalStrategies(next);
    saveLS('activeSignalStrategies', next);
    setSignalsEnabled(enableAll);
    setIndicators(indList => indList.map(ind => ind.id === 'SIGNALS' ? {
      ...ind,
      visible: enableAll,
      params: { ...ind.params, strategy: next, timeframe }
    } : ind));
  };

  const handleTakeSnapshot = () => {
    const url = chartRef.current?.takeSnapshot();
    if (url) {
      setSnapshotUrl(url);
      setShowSnapshotModal(true);
    }
  };

  // Replay handlers
  const handleToggleReplay = () => {
    if (!isReplayMode) {
      const startIdx = chartRef.current?.enterReplay();
      setReplayIndex(startIdx || 0);
      setIsReplayMode(true);
      setIsReplayPlaying(false);
    } else {
      if (replayTimerRef.current) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
      chartRef.current?.exitReplay();
      setIsReplayMode(false);
      setIsReplayPlaying(false);
    }
  };

  const handleToggleReplayPlay = () => setIsReplayPlaying(prev => !prev);
  const handleStepForward = () => {
    const res = chartRef.current?.replayStep();
    if (res) {
      setReplayIndex(res.index);
      if (res.done) setIsReplayPlaying(false);
    }
  };
  const handleResetReplay = () => {
    setIsReplayPlaying(false);
    const startIdx = chartRef.current?.enterReplay();
    setReplayIndex(startIdx || 0);
  };

  useEffect(() => {
    if (!isReplayMode || !isReplayPlaying) {
      if (replayTimerRef.current) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
      return;
    }
    const intervalMs = Math.max(80, 900 / (replaySpeed || 1));
    replayTimerRef.current = setInterval(() => {
      const res = chartRef.current?.replayStep();
      if (res) {
        setReplayIndex(res.index);
        if (res.done) setIsReplayPlaying(false);
      }
    }, intervalMs);
    return () => {
      if (replayTimerRef.current) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    };
  }, [isReplayMode, isReplayPlaying, replaySpeed]);

  const handlePriceUpdate = (price) => {
    setCurrentPrice(price);
  };

  // Short audio 'ring' (WebAudio, no asset file needed) for alerts & signals.
  const playBeep = (freq = 880, dur = 0.18) => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = beepCtxRef.current || (beepCtxRef.current = new AC());
      if (ctx.state === 'suspended') ctx.resume();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.start(); o.stop(ctx.currentTime + dur);
    } catch (e) { /* audio unavailable */ }
  };

  // Request #1: create a price alert from a line drawn on the chart.
  const handleCreateLineAlert = ({ price, name }) => {
    const newAlert = {
      id: Date.now(), symbol, targetPrice: price, condition: 'crossing',
      name: `Line: ${name}`, trigger: 'once', expiry: null, lastFired: null,
      message: `Price touched your line at ${price}`, active: true,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setAlerts(prev => [newAlert, ...prev]);
    setAlertToast(`🔔 Alert set on ${symbol} @ ${price} — rings when price touches this line`);
    playBeep(1000, 0.12);
    setTimeout(() => setAlertToast(null), 3000);
  };

  // Request #3: one-click execute a REAL order from the signal toast.
  const executeSignalTrade = async () => {
    if (!signalToast) return;
    const t = signalToast;
    const body = { symbol: t.symbol, type: t.type, volume: parseFloat(signalToastLot) || 0.01,
      sl: +Number(t.sl).toFixed(2), tp: +Number(t.tp1).toFixed(2), comment: 'Signal-Execute' };
    setSignalToast(null);
    if (sigToastTimerRef.current) clearTimeout(sigToastTimerRef.current);
    try {
      const res = await fetch('/api/order/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (d && d.error) setAlertToast('Order failed: ' + d.error);
      else setAlertToast(`Executed ${body.type} ${body.symbol} ${body.volume} lot @ ${d.price} (SL ${body.sl} / TP ${body.tp})`);
    } catch (e) { setAlertToast('Order error: ' + String(e)); }
    setTimeout(() => setAlertToast(null), 6000);
  };

  // Notifications: jump the chart to a past signal, and read/unread toggles.
  const openSignalNotification = (nt) => {
    setSignalNotifications(prev => prev.map(x => x.id === nt.id ? { ...x, read: true } : x));
    setShowNotifications(false);
    const needSwitch = nt.symbol !== symbol || (nt.timeframe && nt.timeframe !== timeframe);
    if (nt.symbol !== symbol) setSymbol(nt.symbol);
    if (nt.timeframe && nt.timeframe !== timeframe) setTimeframe(nt.timeframe);
    setTimeout(() => { try { chartRef.current && chartRef.current.scrollToTimestamp && chartRef.current.scrollToTimestamp(nt.ts); } catch (e) {} }, needSwitch ? 1300 : 250);
  };
  const toggleNotifRead = (id) => setSignalNotifications(prev => prev.map(x => x.id === id ? { ...x, read: !x.read } : x));
  const markAllNotifsRead = () => setSignalNotifications(prev => prev.map(x => ({ ...x, read: true })));

  // Watch for freshly-released signal at right edge: toast notification and auto-execute on MT5
  useEffect(() => {
    if (!signalsEnabled) return;
    const check = async () => {
      try {
        const data = (chartRef.current && chartRef.current.getFullData) ? chartRef.current.getFullData() : [];
        if (!data || data.length < 60) return;
        const series = computeSignalSeries(data, activeSignalStrategies, 20, timeframe);
        let li = -1;
        for (let i = series.length - 1; i >= 0; i--) { if (series[i] && series[i].signalType) { li = i; break; } }
        if (li < 0 || li < series.length - 3) return;   // only the most recent (right-edge) signal
        const ts = data[li] ? data[li].timestamp : li;
        const sig = series[li];

        // STRICT USER DIRECTIVE: Haider Scalper strategies ONLY work on 5M and ONLY execute on 5M chart
        const isHaiderSig = sig.strategyId === 'REAL_DIP' || sig.strategy === 'Haider-Gold-Scalper';
        const isEnhancedSig = sig.strategyId === 'HAIDER_ENHANCED' || sig.strategy === 'Haider-Scalper-Enhanced';
        if ((isHaiderSig || isEnhancedSig) && timeframe.toUpperCase() !== '5M') {
          return; // Strictly abort: Haider scalper strategies only execute on 5-minute chart
        }

        const key = `${symbol}|${timeframe}`;

        // 1. Toast and notification history (once per signal candle)
        if (notifiedSigRef.current[key] !== ts) {
          notifiedSigRef.current[key] = ts;
          saveLS('notifiedSig', notifiedSigRef.current);
          const notif = {
            id: `${symbol}|${timeframe}|${ts}`,
            symbol,
            timeframe,
            type: sig.signalType,
            entry: sig.entryPrice,
            sl: sig.slPrice,
            tp1: sig.tp1Price,
            tp2: sig.tp2Price,
            strategy: sig.strategy || 'Signal',
            ts,
            read: false,
            at: Date.now()
          };
          setSignalNotifications(prev => (prev[0] && prev[0].id === notif.id) ? prev : [notif, ...prev].slice(0, 50));
          setSignalToast({ symbol, timeframe, type: sig.signalType, entry: sig.entryPrice, sl: sig.slPrice, tp1: sig.tp1Price, tp2: sig.tp2Price, ts, strategy: notif.strategy });
          playBeep(760, 0.16); setTimeout(() => playBeep(1010, 0.16), 130);
          if (sigToastTimerRef.current) clearTimeout(sigToastTimerRef.current);
          sigToastTimerRef.current = setTimeout(() => setSignalToast(null), 10000);
        }

        // 2. Automatic MT5 Trade Execution when enabled
        if (autoTradeSignals && autoTradedSigRef.current[key] !== ts) {
          autoTradedSigRef.current[key] = ts;
          saveLS('autoTradedSig', autoTradedSigRef.current);

          const isGoldSym = symbol.toUpperCase().includes('XAU') || symbol.toUpperCase().includes('GOLD');
          // Enforce Gold safety constraint: strictly <= 1.0 lot
          const safeLot = isGoldSym ? Math.min(1.0, activeLotSize) : activeLotSize;

          const tradeComment = isEnhancedSig ? 'Haider-Scalper-Enhanced' : (isHaiderSig ? 'Haider-Gold-Scalper' : (sig.strategy || 'MT5-Auto-Trade'));

          const tradePayload = {
            symbol: symbol,
            type: sig.signalType,
            volume: safeLot,
            sl: parseFloat(sig.slPrice.toFixed(3)),
            tp: parseFloat(sig.tp1Price.toFixed(3)),
            comment: tradeComment
          };

          try {
            const res = await fetch('/api/order/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(tradePayload)
            });
            const d = await res.json();
            if (res.ok && !d.error) {
              const successMsg = `⚡ ${tradeComment}: Auto-Opened ${tradePayload.type} ${tradePayload.volume} Lots on ${symbol} @ ${(d.price || sig.entryPrice).toFixed(3)} (SL: ${tradePayload.sl.toFixed(3)}, TP: ${tradePayload.tp.toFixed(3)})`;
              setAlertToast(successMsg);
              playBeep(1050, 0.22);
              fetchAccountAndSymbols();
            } else {
              setAlertToast(`⚠️ Auto-Trade Rejected: ${d.error || 'Check MT5 AlgoTrading status'}`);
            }
          } catch (err) {
            setAlertToast(`⚠️ Auto-Trade Network Error: ${err.message}`);
          }
          setTimeout(() => setAlertToast(null), 9000);
        }
      } catch (e) { /* ignore */ }
    };
    const t0 = setTimeout(check, 3500);
    const iv = setInterval(check, 5000);
    return () => { clearTimeout(t0); clearInterval(iv); };
  }, [signalsEnabled, symbol, timeframe, activeSignalStrategies, autoTradeSignals, activeLotSize]);

  const handleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleAddPineScript = () => {
    let meta;
    try { meta = pineMeta(pineSource); }
    catch (e) { setPineResult({ errors: ['Engine error: ' + String(e)], warnings: [], plots: [] }); return; }
    setPineResult(meta);
    saveLS('pineSource', pineSource);
    if (meta.errors && meta.errors.length) return; // keep editor open to show errors
    const scriptId = 'pine_' + Date.now();
    registerPineScript(scriptId, pineSource);
    const lines = (meta.plots && meta.plots.length ? meta.plots : [{ color: '#2962ff', width: 1 }])
      .map(pl => ({ color: pl.color, size: pl.width || 1, style: 'solid' }));
    const newInd = {
      instanceId: 'PINE_' + Date.now(), id: 'PINE',
      name: meta.title || 'Pine Script', shortName: 'Pine',
      isStack: meta.overlay === false, visible: true,
      params: { scriptId, pineSrc: pineSource }, styles: { lines }
    };
    setIndicators(prev => (prev.length >= 10 ? prev : [...prev, newInd]));
    setShowPineEditor(false);
  };

  const runBacktest = (targetStrat) => {
    const strat = targetStrat || btStrategy;
    setBtLoading(true);
    setBtError(null);
    const url = strat === 'haider_enhanced'
      ? `/api/backtest/haider_enhanced?symbol=${symbol}&timeframe=${timeframe}&bars=${btBars}`
      : strat === 'real_dip'
      ? `/api/backtest/real_dip?symbol=${symbol}&timeframe=${timeframe}&bars=${btBars}`
      : `/api/backtest/gold_scalper?symbol=${symbol}&timeframe=${timeframe}&bars=${btBars}&utc_offset=${btOffset}`;
    fetch(url)
      .then(r => r.json())
      .then(d => {
        setBtLoading(false);
        if (d.error) setBtError(d.error);
        else setBtData({ ...d, _strat: strat });
      })
      .catch(err => {
        setBtLoading(false);
        setBtError(err.message || 'Failed to run backtest');
      });
  };

  const currentSymbolInfo = useMemo(() => {
    return symbols.find(s => s.name === symbol) || null;
  }, [symbols, symbol]);

  return (
    <div className="tradingview-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0e1116', overflow: 'hidden' }}>
      {/* ALERT TOAST */}
      {alertToast && (
        <div style={{ position: 'fixed', top: 52, right: 20, zIndex: 100000, background: '#f7a600', color: '#131722',
          padding: '12px 18px', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', fontWeight: 700, fontSize: 13,
          maxWidth: 380, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>{alertToast}</span>
          <button onClick={() => setAlertToast(null)} aria-label="Dismiss alert"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#131722', display: 'flex', padding: 0 }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* SIGNAL RELEASE TOAST (auto-dismiss 3s) — one-click execute */}
      {signalToast && (
        <div style={{ position: 'fixed', bottom: 46, right: 20, zIndex: 100001, width: 280,
          background: '#1e222d', border: `1px solid ${signalToast.type === 'BUY' ? '#089981' : '#f23645'}`,
          borderRadius: 10, boxShadow: '0 12px 34px rgba(0,0,0,0.65)', padding: '12px 14px', color: '#d1d4dc' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontWeight: 800, fontSize: 14 }}>
              {signalToast.symbol.includes('XAU') ? 'GOLD' : signalToast.symbol.replace(/c$/, '')}
            </span>
            <span style={{ fontWeight: 800, fontSize: 12, color: '#fff', background: signalToast.type === 'BUY' ? '#089981' : '#f23645', borderRadius: 4, padding: '2px 8px' }}>
              {signalToast.type}
            </span>
          </div>
          {[['Entry', signalToast.entry, 'var(--text-muted)'], ['SL', signalToast.sl, '#f23645'], ['TP1', signalToast.tp1, '#2ea88f'], ['TP2', signalToast.tp2, '#089981']].map(([k, v, col], i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
              <span style={{ color: col }}>{k}</span><span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{Number(v).toFixed(2)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 9 }}>
            <select value={signalToastLot} onChange={e => setSignalToastLot(e.target.value)} title="Lot size"
              style={{ background: '#131722', color: '#d1d4dc', border: '1px solid #2a2e39', borderRadius: 4, padding: '6px', fontSize: 12 }}>
              <option value="0.01">0.01</option><option value="0.05">0.05</option><option value="0.10">0.10</option><option value="0.50">0.50</option><option value="1.00">1.00</option>
            </select>
            <button onClick={executeSignalTrade}
              style={{ flex: 1, background: signalToast.type === 'BUY' ? '#089981' : '#f23645', color: '#fff', border: 'none', borderRadius: 5, padding: '8px 0', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
              Execute {signalToast.type}
            </button>
            <button onClick={() => setSignalToast(null)} aria-label="Dismiss"
              style={{ background: 'none', border: '1px solid #2a2e39', color: 'var(--text-muted)', borderRadius: 5, padding: '8px', cursor: 'pointer', display: 'flex' }}>
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* SIGNAL NOTIFICATIONS PANEL */}
      {showNotifications && (
        <>
          <div onClick={() => setShowNotifications(false)} style={{ position: 'fixed', inset: 0, zIndex: 100040 }} />
          <div style={{ position: 'fixed', top: 42, right: 12, width: 322, maxHeight: '72vh', overflowY: 'auto', zIndex: 100041, background: '#1e222d', border: '1px solid #2a2e39', borderRadius: 8, boxShadow: '0 12px 34px rgba(0,0,0,0.6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid #2a2e39', position: 'sticky', top: 0, background: '#1e222d' }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: '#d1d4dc' }}>Signal Notifications</span>
              <button onClick={markAllNotifsRead} style={{ background: 'none', border: 'none', color: '#2962ff', fontSize: 11.5, cursor: 'pointer' }}>Mark all read</button>
            </div>
            {signalNotifications.length === 0 ? (
              <div style={{ padding: '26px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>No signals received yet</div>
            ) : signalNotifications.map(nt => (
              <div key={nt.id} onClick={() => openSignalNotification(nt)}
                style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', background: nt.read ? 'transparent' : 'rgba(41,98,255,0.07)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0, background: nt.read ? '#3a3f4b' : '#2962ff' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <strong style={{ fontSize: 12.5, color: '#d1d4dc' }}>{nt.symbol.includes('XAU') ? 'GOLD' : nt.symbol.replace(/c$/, '')}</strong>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#fff', background: nt.type === 'BUY' ? '#089981' : '#f23645', borderRadius: 3, padding: '1px 6px' }}>{nt.type}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{nt.timeframe}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Entry {Number(nt.entry).toFixed(2)} · SL {Number(nt.sl).toFixed(2)} · TP1 {Number(nt.tp1).toFixed(2)}</div>
                  <div style={{ fontSize: 10, color: '#6e7681', marginTop: 2 }}>{new Date(nt.at || nt.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); toggleNotifRead(nt.id); }} title={nt.read ? 'Mark as unread' : 'Mark as read'}
                  style={{ background: 'none', border: '1px solid #2a2e39', borderRadius: 4, color: 'var(--text-muted)', fontSize: 10, padding: '3px 6px', cursor: 'pointer', flexShrink: 0 }}>
                  {nt.read ? 'Unread' : 'Read'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 1. TOP TAB BAR (TV STYLE MULTI-TABS & ACCOUNT STATUS) */}
      <TopTabBar
        tabs={workspaceTabs}
        unreadCount={signalNotifications.filter(n => !n.read).length}
        onToggleNotifications={() => setShowNotifications(v => !v)}
        activeTabId={activeTabId}
        onSelectTab={handleSelectWorkspaceTab}
        onAddTab={() => handleAddChartTab('EURUSDc', '1H')}
        onCloseTab={handleCloseWorkspaceTab}
        onReorderTab={handleReorderTab}
        accountInfo={accountInfo}
        onOpenSymbolSearch={() => setShowSymbolSearch(true)}
        onOpenScreener={() => setShowScreenerModal(true)}
        onOpenNotificationSettings={() => setShowNotificationModal(true)}
      />

      {/* 2. TAB 1: DASHBOARD VIEW */}
      {activeTab.type === 'dashboard' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <DashboardTab
            accountInfo={accountInfo}
            symbols={symbols}
            watchQuotes={watchQuotes}
            onSelectSymbolAndGoToChart={handleSelectSymbolAndGoToChart}
            onGoToJournal={() => setActiveTabId('journal')}
          />
        </div>
      )}

      {/* 3. TAB 2: CHART VIEW (TECHNICAL TOOLS & TRADE EXECUTION) */}
      {activeTab.type === 'chart' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* CHART TOP TOOLBAR */}
          <div className="top-bar">
            {/* Symbol Search Trigger */}
            <button className="symbol-search" onClick={() => setShowSymbolSearch(true)} title="Search Symbols (Ctrl+K)">
              <span>{symbol}</span> <Search size={14} style={{ opacity: 0.6 }} />
            </button>

            <div style={{ width: 1, height: 24, background: 'var(--border)' }} />

            {/* Timeframes */}
            <div style={{ display: 'flex', gap: 2 }}>
              {['1M', '5M', '15M', '1H', '4H', '1D'].map(tf => (
                <button 
                  key={tf}
                  className="top-btn" 
                  style={{ 
                    color: timeframe === tf ? 'var(--brand)' : 'var(--text)',
                    fontWeight: timeframe === tf ? 700 : 500
                  }}
                  onClick={() => setTimeframe(tf)}
                >
                  {tf}
                </button>
              ))}
            </div>

            <div style={{ width: 1, height: 24, background: 'var(--border)' }} />

            {/* Chart Type Dropdown */}
            <div style={{ position: 'relative' }}>
              <button 
                className="top-btn"
                onClick={() => setShowChartTypeMenu(!showChartTypeMenu)}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                title="Chart Type"
              >
                <span>{CHART_TYPES.find(c => c.id === chartType)?.icon}</span>
                <span>{CHART_TYPES.find(c => c.id === chartType)?.label}</span>
                <ChevronDown size={14} />
              </button>

              {showChartTypeMenu && (
                <div style={{
                  position: 'absolute',
                  top: 36,
                  left: 0,
                  background: '#1e222d',
                  border: '1px solid #2a2e39',
                  borderRadius: 6,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.7)',
                  width: 170,
                  zIndex: 9999,
                  padding: '4px 0'
                }}>
                  {CHART_TYPES.map(ct => (
                    <div
                      key={ct.id}
                      onClick={() => handleSelectChartType(ct.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        fontSize: 13,
                        cursor: 'pointer',
                        color: chartType === ct.id ? 'var(--brand)' : 'var(--text)',
                        background: chartType === ct.id ? 'rgba(41, 98, 255, 0.15)' : 'transparent'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{ct.icon}</span>
                        <span>{ct.label}</span>
                      </div>
                      {chartType === ct.id && <Check size={14} />}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
            
            {/* Indicators Trigger */}
            <button 
              className="top-btn"
              onClick={() => setShowIndicatorsModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: showIndicatorsModal ? 'rgba(41, 98, 255, 0.15)' : 'transparent',
                color: indicators.length > 0 ? 'var(--brand)' : 'var(--text)',
                fontWeight: 600
              }}
            >
              <LineChart size={16}/> Indicators
              {indicators.length > 0 && (
                <span style={{
                  background: 'var(--brand)',
                  color: '#fff',
                  borderRadius: 8,
                  padding: '1px 5px',
                  fontSize: 10,
                  fontWeight: 700
                }}>
                  {indicators.length}
                </span>
              )}
            </button>

            {/* Pine Script Trigger */}
            <button
              className="top-btn"
              onClick={() => setShowPineEditor(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              title="Add a Pine Script indicator to chart"
            >
              <LineChart size={16} /> Pine
            </button>

            {/* Signals Trigger */}
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button 
                  className="top-btn"
                  onClick={handleToggleSignals}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: signalsEnabled ? 'rgba(8, 153, 129, 0.18)' : 'transparent',
                    color: signalsEnabled ? '#089981' : 'var(--text)',
                    border: signalsEnabled ? '1px solid rgba(8, 153, 129, 0.4)' : '1px solid transparent',
                    borderRadius: showSignalsMenu ? '4px 0 0 4px' : '4px',
                    fontWeight: 700,
                    padding: '4px 10px'
                  }}
                >
                  <Zap size={15} fill={signalsEnabled ? '#089981' : 'none'} color={signalsEnabled ? '#089981' : 'currentColor'} />
                  <span>Signals</span>
                  {signalsEnabled && (
                    <span style={{ background: '#089981', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 800 }}>
                      ON
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setShowSignalsMenu(!showSignalsMenu)}
                  style={{
                    background: signalsEnabled ? 'rgba(8, 153, 129, 0.18)' : 'transparent',
                    color: signalsEnabled ? '#089981' : 'var(--text-muted)',
                    border: signalsEnabled ? '1px solid rgba(8, 153, 129, 0.4)' : '1px solid transparent',
                    borderLeft: 'none',
                    borderRadius: '0 4px 4px 0',
                    padding: '4px 4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  <ChevronDown size={14} />
                </button>
              </div>

              {showSignalsMenu && (
                <div style={{
                  position: 'absolute',
                  top: 36,
                  left: 0,
                  background: '#1e222d',
                  border: '1px solid #2a2e39',
                  borderRadius: 6,
                  boxShadow: '0 8px 28px rgba(0,0,0,0.75)',
                  width: 270,
                  zIndex: 9999,
                  padding: '6px 0',
                  userSelect: 'none'
                }}>
                  <div style={{
                    padding: '4px 12px 6px 12px',
                    fontSize: 10.5,
                    fontWeight: 800,
                    color: '#787b86',
                    textTransform: 'uppercase',
                    letterSpacing: 0.8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <span>Signals</span>
                    <span 
                      onClick={() => setShowSignalModal(true)}
                      style={{ color: 'var(--brand)', cursor: 'pointer', fontSize: 11, fontWeight: 600, textTransform: 'none' }}
                    >
                      Performance
                    </span>
                  </div>

                  {/* 1. Haider-Gold-Scalper (5M ONLY) */}
                  <div
                    onClick={() => handleToggleSignalStrategy('REAL_DIP')}
                    style={{
                      padding: '8px 12px',
                      fontSize: 13,
                      cursor: 'pointer',
                      color: activeSignalStrategies.REAL_DIP ? '#089981' : 'var(--text)',
                      background: activeSignalStrategies.REAL_DIP ? 'rgba(8, 153, 129, 0.12)' : 'transparent',
                      borderLeft: activeSignalStrategies.REAL_DIP ? '3px solid #089981' : '3px solid transparent',
                      transition: 'background 0.15s ease'
                    }}
                    onMouseEnter={e => { if (!activeSignalStrategies.REAL_DIP) e.currentTarget.style.background = '#2a2e39'; }}
                    onMouseLeave={e => { if (!activeSignalStrategies.REAL_DIP) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 700 }}>Haider-Gold-Scalper</span>
                        <span style={{
                          fontSize: 9,
                          fontWeight: 800,
                          padding: '1px 5px',
                          borderRadius: 3,
                          background: timeframe.toUpperCase() === '5M' ? 'rgba(8,153,129,0.25)' : 'rgba(247,166,0,0.2)',
                          color: timeframe.toUpperCase() === '5M' ? '#089981' : '#f7a600',
                          border: `1px solid ${timeframe.toUpperCase() === '5M' ? 'rgba(8,153,129,0.5)' : 'rgba(247,166,0,0.5)'}`
                        }}>
                          5M ONLY
                        </span>
                      </div>
                      <div style={{
                        width: 16, height: 16, borderRadius: 3,
                        border: activeSignalStrategies.REAL_DIP ? '1px solid #089981' : '1px solid #555d6e',
                        background: activeSignalStrategies.REAL_DIP ? '#089981' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        {activeSignalStrategies.REAL_DIP && <Check size={12} color="#fff" strokeWidth={3} />}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      ATR Impulse + RSI Exhaustion {timeframe.toUpperCase() !== '5M' && activeSignalStrategies.REAL_DIP && '• Chart not 5M'}
                    </div>
                  </div>

                  {/* 2. Haider-Scalper-Enhanced (90%+ WR) */}
                  <div
                    onClick={() => handleToggleSignalStrategy('HAIDER_ENHANCED')}
                    style={{
                      padding: '8px 12px',
                      fontSize: 13,
                      cursor: 'pointer',
                      color: activeSignalStrategies.HAIDER_ENHANCED ? '#00f2fe' : 'var(--text)',
                      background: activeSignalStrategies.HAIDER_ENHANCED ? 'rgba(0, 242, 254, 0.12)' : 'transparent',
                      borderLeft: activeSignalStrategies.HAIDER_ENHANCED ? '3px solid #00f2fe' : '3px solid transparent',
                      transition: 'background 0.15s ease',
                      marginTop: 2
                    }}
                    onMouseEnter={e => { if (!activeSignalStrategies.HAIDER_ENHANCED) e.currentTarget.style.background = '#2a2e39'; }}
                    onMouseLeave={e => { if (!activeSignalStrategies.HAIDER_ENHANCED) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 700 }}>Haider-Scalper-Enhanced</span>
                        <span style={{
                          fontSize: 9,
                          fontWeight: 800,
                          padding: '1px 5px',
                          borderRadius: 3,
                          background: 'rgba(0, 242, 254, 0.22)',
                          color: '#00f2fe',
                          border: '1px solid rgba(0, 242, 254, 0.5)'
                        }}>
                          90%+ WR
                        </span>
                      </div>
                      <div style={{
                        width: 16, height: 16, borderRadius: 3,
                        border: activeSignalStrategies.HAIDER_ENHANCED ? '1px solid #00f2fe' : '1px solid #555d6e',
                        background: activeSignalStrategies.HAIDER_ENHANCED ? '#00f2fe' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        {activeSignalStrategies.HAIDER_ENHANCED && <Check size={12} color="#000" strokeWidth={3} />}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      Anti-Hunt SL + 18% Wick + Auto-BE {timeframe.toUpperCase() !== '5M' && activeSignalStrategies.HAIDER_ENHANCED && '• Chart not 5M'}
                    </div>
                  </div>

                  <div style={{ height: 1, background: '#2a2e39', margin: '6px 0' }} />

                  {/* AUTO-TRADE TOGGLE */}
                  <div
                    onClick={() => {
                      const next = !autoTradeSignals;
                      setAutoTradeSignals(next);
                      saveLS('autoTradeSignals', next);
                      fetch('/api/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ auto_trade: next })
                      }).catch(() => {});
                    }}
                    style={{
                      padding: '8px 12px',
                      fontSize: 12.5,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: autoTradeSignals ? 'rgba(8,153,129,0.12)' : 'transparent',
                      color: autoTradeSignals ? '#089981' : 'var(--text-muted)',
                      transition: 'background 0.15s ease'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = autoTradeSignals ? 'rgba(8,153,129,0.18)' : '#2a2e39'}
                    onMouseLeave={e => e.currentTarget.style.background = autoTradeSignals ? 'rgba(8,153,129,0.12)' : 'transparent'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Zap size={14} color={autoTradeSignals ? '#089981' : 'var(--text-muted)'} />
                      <span style={{ fontWeight: 600 }}>Auto-Trade on MT5</span>
                    </div>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 800,
                      padding: '2px 6px',
                      borderRadius: 3,
                      background: autoTradeSignals ? '#089981' : '#2a2e39',
                      color: '#fff'
                    }}>
                      {autoTradeSignals ? 'ON' : 'OFF'}
                    </span>
                  </div>

                  <div style={{ height: 1, background: '#2a2e39', margin: '6px 0' }} />

                  {/* SIGNAL PERFORMANCE TABLES */}
                  <div
                    onClick={() => {
                      setShowSignalPerformanceModal(true);
                      setShowSignalsMenu(false);
                    }}
                    style={{
                      padding: '8px 12px',
                      fontSize: 13,
                      cursor: 'pointer',
                      color: 'var(--text)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      transition: 'background 0.15s ease'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#2a2e39'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <BarChart2 size={14} color="#089981" />
                    <span style={{ fontWeight: 600 }}>Signal Performance Tables…</span>
                  </div>

                  {/* CHECK SIGNAL ACCURACY */}
                  <div
                    onClick={runSignalAccuracy}
                    style={{
                      padding: '8px 12px',
                      fontSize: 13,
                      cursor: 'pointer',
                      color: 'var(--text)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      transition: 'background 0.15s ease'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#2a2e39'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <LineChart size={14} />
                    <span style={{ fontWeight: 600 }}>Check signal accuracy…</span>
                  </div>
                </div>
              )}
            </div>

            {/* Replay */}
            <button 
              className="top-btn"
              onClick={handleToggleReplay}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: isReplayMode ? '#f7a600' : 'var(--text)',
                background: isReplayMode ? 'rgba(247, 166, 0, 0.15)' : 'transparent'
              }}
            >
              <RotateCcw size={15} /> Replay
            </button>

            {/* Strategy Backtest */}
            <button
              className="top-btn"
              onClick={() => { setShowBacktest(true); if (!btData && !btLoading) runBacktest(); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <LineChart size={15} /> Backtest
            </button>

            {/* Quick Open Trade Panel Toggle */}
            <button
              className="top-btn"
              onClick={() => setActiveSidebarTab(prev => prev === 'trade' ? 'watchlist' : 'trade')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: activeSidebarTab === 'trade' ? 'rgba(41, 98, 255, 0.2)' : 'transparent',
                color: activeSidebarTab === 'trade' ? 'var(--brand)' : 'var(--text)',
                border: activeSidebarTab === 'trade' ? '1px solid rgba(41, 98, 255, 0.4)' : '1px solid transparent',
                fontWeight: 700
              }}
            >
              <DollarSign size={15} /> Trade MT5
            </button>

            {/* Champions Council & Quant Intelligence Terminal */}
            <button
              className="top-btn"
              onClick={() => setShowIntelligenceModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.18), rgba(239, 68, 68, 0.15))',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                color: '#f59e0b',
                fontWeight: 700
              }}
              title="Trading Champions Council, Quant Lab & Price Predictor"
            >
              <Award size={15} /> Council & Quant
            </button>
            
            <div style={{ flex: 1 }} />

            {/* Live Price Badge */}
            {currentPrice && (
              <div style={{
                fontSize: 13,
                fontWeight: 700,
                color: '#089981',
                background: 'rgba(8, 153, 129, 0.1)',
                padding: '4px 10px',
                borderRadius: 4,
                border: '1px solid rgba(8, 153, 129, 0.2)',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#089981', display: 'inline-block' }} />
                {symbol}: {currentPrice.toFixed(currentSymbolInfo?.digits || 2)}
              </div>
            )}

            {/* App Version & Check for Updates Badge */}
            <button 
              className="top-btn" 
              onClick={() => setShowUpdateModal(true)}
              title={`MyTradingView ${appVersion} — Click to check for updates`}
              style={{
                fontSize: 11,
                padding: '4px 8px',
                borderRadius: 4,
                background: hasUpdateAvailable ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                border: hasUpdateAvailable ? '1px solid #ef4444' : '1px solid var(--border)',
                color: hasUpdateAvailable ? '#f87171' : 'var(--text-muted)',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 5
              }}
            >
              {hasUpdateAvailable && (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
              )}
              {appVersion}
            </button>

            {/* Utilities */}
            <button className="btn-icon" onClick={() => chartRef.current?.resetView()} title="Reset chart view (fit & scroll to latest)">
              <RotateCcw size={18} />
            </button>
            <button className="btn-icon" onClick={handleTakeSnapshot} title="Take Screenshot">
              <Camera size={18} />
            </button>
            <button className="btn-icon" onClick={() => setShowSettingsModal(true)} title="Chart Settings">
              <Settings size={18} />
            </button>
            <button className="btn-icon" onClick={handleFullscreen} title="Fullscreen">
              <Maximize size={18} />
            </button>
          </div>

          {/* MAIN CHART AREA & SIDEBAR */}
          <div className="main-area" style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>
            {/* LEFT FLYOUT DRAWING TOOLBAR */}
            <FlyoutToolbar 
              onSelectTool={handleSelectTool} 
              onClearAll={handleClearDrawings} 
              favoriteToolIds={favoriteToolIds}
              onToggleFavorite={handleToggleFavoriteTool}
              onCheckUpdates={() => setShowUpdateModal(true)}
              appVersion={appVersion}
              hasUpdate={hasUpdateAvailable}
              onSelectDrawingColor={(c) => chartRef.current?.setActiveDrawingColor(c)}
            />

            {/* CHART VIEWPORT */}
            <div className="chart-container" style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
              <IndicatorLegend 
                indicators={indicators}
                onToggleVisibility={handleToggleIndicatorVisibility}
                onOpenSettings={(ind) => setEditingIndicator(ind)}
                onRemoveIndicator={handleRemoveIndicator}
              />

              {isReplayMode && (
                <ReplayBar
                  isPlaying={isReplayPlaying}
                  speed={replaySpeed}
                  onTogglePlay={handleToggleReplayPlay}
                  onStepForward={handleStepForward}
                  onReset={handleResetReplay}
                  onChangeSpeed={setReplaySpeed}
                  onExit={() => setIsReplayMode(false)}
                />
              )}

              <FavoritesBar 
                favoriteToolIds={favoriteToolIds}
                onSelectTool={handleSelectTool} 
                onClearAll={handleClearDrawings} 
              />

              <div style={{ flex: 1, position: 'relative' }}>
                <KLineChartArea 
                  ref={chartRef} 
                  symbol={symbol} 
                  timeframe={timeframe} 
                  indicators={indicators}
                  signals={signalsList}
                  showSignals={signalsEnabled}
                  onPriceUpdate={handlePriceUpdate}
                  onCreateLineAlert={handleCreateLineAlert}
                  watermarkText={chartSettings.showWatermark ? symbol : null}
                />
              </div>

              <BottomBar 
                activeRange={activeRange}
                onSelectRange={setActiveRange}
                timezone={chartSettings.timezone}
              />
            </div>

            {/* RIGHT SIDEBAR (TRADE EXECUTION PANEL / WATCHLIST / ALERTS) */}
            <div className="right-panel" style={{ width: 330, background: '#131722', borderLeft: '1px solid #1f2430', display: 'flex', flexDirection: 'column' }}>
              <div className="tabs" style={{ display: 'flex', borderBottom: '1px solid #1f2430' }}>
                <div 
                  className={`tab ${activeSidebarTab === 'trade' ? 'active' : ''}`}
                  onClick={() => setActiveSidebarTab('trade')}
                  style={{ flex: 1, textAlign: 'center', padding: '10px 0', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
                >
                  Trade MT5
                </div>
                <div 
                  className={`tab ${activeSidebarTab === 'watchlist' ? 'active' : ''}`}
                  onClick={() => setActiveSidebarTab('watchlist')}
                  style={{ flex: 1, textAlign: 'center', padding: '10px 0', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
                >
                  Watchlist
                </div>
                <div 
                  className={`tab ${activeSidebarTab === 'alerts' ? 'active' : ''}`}
                  onClick={() => setActiveSidebarTab('alerts')}
                  style={{ flex: 1, textAlign: 'center', padding: '10px 0', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
                >
                  Alerts
                </div>
              </div>

              {/* TAB 1: MT5 TRADE EXECUTION PANEL */}
              {activeSidebarTab === 'trade' && (
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  <TradeExecutionPanel
                    symbol={symbol}
                    currentPrice={currentPrice}
                    symbolInfo={currentSymbolInfo}
                    activeLotSize={activeLotSize}
                    onLotSizeChange={(newLot) => {
                      setActiveLotSize(newLot);
                    }}
                    onOrderExecuted={() => {
                      fetchAccountAndSymbols();
                    }}
                  />
                </div>
              )}

              {/* TAB 2: WATCHLIST (search / add / remove, persisted) */}
              {activeSidebarTab === 'watchlist' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', position: 'relative' }}>
                    <input
                      value={wlQuery}
                      onChange={e => setWlQuery(e.target.value)}
                      placeholder="Add symbol (search)…"
                      aria-label="Search a symbol to add to the watchlist"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', background: '#0e1116',
                        border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12.5, outline: 'none' }}
                    />
                    {wlQuery.trim() && (
                      <div style={{ position: 'absolute', left: 10, right: 10, top: 44, zIndex: 30, background: '#1e222d',
                        border: '1px solid var(--border)', borderRadius: 6, maxHeight: 240, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.6)' }}>
                        {(() => {
                          const qy = wlQuery.trim().toLowerCase();
                          const matches = symbols.filter(s => !watchlist.includes(s.name))
                            .filter(s => s.name.toLowerCase().includes(qy) || (s.description || '').toLowerCase().includes(qy))
                            .slice(0, 30);
                          if (matches.length === 0) return <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)' }}>No matches (or already added)</div>;
                          return matches.map(s => (
                            <div key={s.name} onClick={() => addToWatchlist(s.name)}
                              style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 12.5, display: 'flex', justifyContent: 'space-between' }}
                              onMouseEnter={e => e.currentTarget.style.background = '#2a2e39'}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                              <strong>{s.name}</strong>
                              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>+ Add</span>
                            </div>
                          ));
                        })()}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {watchlist.length === 0 && (
                      <div style={{ padding: '18px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                        Watchlist empty — search above to add symbols.
                      </div>
                    )}
                    {watchlist.map(sym => {
                      const q = watchQuotes[sym];
                      const digits = sym.includes('JPY') ? 3 : 2;
                      const priceStr = q && typeof q.price === 'number'
                        ? q.price.toFixed(digits)
                        : (symbol === sym && currentPrice ? currentPrice.toFixed(digits) : '---');
                      const priceColor = q?.dir === 'up' ? '#089981'
                        : q?.dir === 'down' ? '#f23645'
                        : (symbol === sym ? 'var(--brand)' : 'var(--text-muted)');
                      return (
                        <div
                          key={sym}
                          className={`watchlist-item ${symbol === sym ? 'active' : ''}`}
                          onClick={() => handleSelectSymbol(sym)}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '10px 14px', cursor: 'pointer',
                            background: symbol === sym ? 'rgba(41, 98, 255, 0.12)' : 'transparent',
                            borderLeft: symbol === sym ? '3px solid var(--brand)' : '3px solid transparent' }}
                        >
                          <span className="wl-symbol" style={{ fontWeight: symbol === sym ? 700 : 500 }}>{sym}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="wl-price" style={{ color: priceColor, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                              {priceStr}
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); removeFromWatchlist(sym); }}
                              title={`Remove ${sym} from watchlist`}
                              aria-label={`Remove ${sym} from watchlist`}
                              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, display: 'flex' }}
                              onMouseEnter={e => e.currentTarget.style.color = '#f23645'}
                              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                            >
                              <X size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB 3: ALERTS */}
              {activeSidebarTab === 'alerts' && (
                <AlertsPanel 
                  currentSymbol={symbol} 
                  currentPrice={currentPrice} 
                  alerts={alerts} 
                  setAlerts={setAlerts} 
                  alertLogs={alertLogs} 
                />
              )}
            </div>
          </div>
        </div>
      )}



      {activeTab.type === 'journal' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <TradeJournalTab
            accountInfo={accountInfo}
            onSelectSymbolAndGoToChart={handleSelectSymbolAndGoToChart}
          />
        </div>
      )}

      {/* 4. TAB 4: MONTE CARLO STRESS LAB VIEW */}
      {activeTab.type === 'monte_carlo' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <MonteCarloTab
            accountInfo={accountInfo}
            onSelectSymbolAndGoToChart={handleSelectSymbolAndGoToChart}
          />
        </div>
      )}

      {/* 5. TAB 5: GOLD DUAL-TIMEFRAME ORDER BLOCKS (SMC) VIEW */}
      {activeTab.type === 'order_blocks' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <GoldOrderBlocksTab
            accountInfo={accountInfo}
            onSelectSymbolAndGoToChart={handleSelectSymbolAndGoToChart}
            defaultSymbol={symbol}
          />
        </div>
      )}

      {/* 6. TAB 6: SUPPORT AND RESISTANCE (MULTI-TF) VIEW */}
      {activeTab.type === 'support_resistance' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <SupportResistanceTab
            accountInfo={accountInfo}
            onSelectSymbolAndGoToChart={handleSelectSymbolAndGoToChart}
            defaultSymbol={symbol}
          />
        </div>
      )}

      {/* 5. GLOBAL MODALS */}

      {/* MARKET SCREENER MODAL */}
      <MarketScreenerModal
        isOpen={showScreenerModal}
        onClose={() => setShowScreenerModal(false)}
        onSelectSymbolAndGoToChart={handleSelectSymbolAndGoToChart}
      />

      {/* NOTIFICATION CHANNELS MODAL (DISCORD & DESKTOP) */}
      <NotificationSettingsModal
        isOpen={showNotificationModal}
        onClose={() => setShowNotificationModal(false)}
      />

      {/* SYMBOL SEARCH MODAL (TRADINGVIEW CATEGORIZED BROKER SYMBOLS) */}
      <SymbolSearchModal
        isOpen={showSymbolSearch}
        onClose={() => setShowSymbolSearch(false)}
        symbols={symbols}
        currentSymbol={symbol}
        onSelectSymbol={handleSelectSymbol}
        brokerName={accountInfo?.company || 'MT5 Broker'}
      />

      {/* INDICATORS MODAL */}
      <IndicatorsModal 
        isOpen={showIndicatorsModal}
        onClose={() => setShowIndicatorsModal(false)}
        activeIndicators={indicators}
        onToggleIndicator={handleToggleIndicator}
      />

      {/* INDICATOR SETTINGS MODAL */}
      <IndicatorSettingsModal
        isOpen={!!editingIndicator}
        onClose={() => setEditingIndicator(null)}
        indicatorInstance={editingIndicator}
        onSaveSettings={handleSaveIndicatorSettings}
      />

      {/* CHART SETTINGS MODAL */}
      <ChartSettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        currentSettings={chartSettings}
        onSaveSettings={(newSettings) => {
          setChartSettings(newSettings);
          chartRef.current?.applyCustomStyles(newSettings);
        }}
      />

      {/* SNAPSHOT MODAL */}
      {showSnapshotModal && snapshotUrl && (
        <div className="modal-overlay" onClick={() => setShowSnapshotModal(false)}>
          <div className="modal-content" style={{ width: 680, maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              Chart Snapshot Preview
              <button className="btn-icon" onClick={() => setShowSnapshotModal(false)}><X size={18}/></button>
            </div>
            <div className="modal-body" style={{ textAlign: 'center' }}>
              <img 
                src={snapshotUrl} 
                alt="Chart Snapshot" 
                style={{ maxWidth: '100%', borderRadius: 6, border: '1px solid var(--border)', marginBottom: 16 }} 
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <a
                  href={snapshotUrl}
                  download={`${symbol}_${timeframe}_snapshot.png`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'var(--brand)',
                    color: '#fff',
                    padding: '8px 18px',
                    borderRadius: 4,
                    textDecoration: 'none',
                    fontWeight: 600,
                    fontSize: 13
                  }}
                >
                  <Download size={16} /> Download PNG
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PINE SCRIPT EDITOR MODAL */}
      {showPineEditor && (
        <div className="modal-overlay" onClick={() => setShowPineEditor(false)}>
          <div className="modal-content" style={{ width: 720, maxWidth: '95vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              Pine Script Editor
              <button className="btn-icon" onClick={() => setShowPineEditor(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <textarea
                value={pineSource}
                onChange={e => setPineSource(e.target.value)}
                spellCheck={false}
                style={{
                  width: '100%', height: 300, boxSizing: 'border-box', resize: 'vertical',
                  fontFamily: 'Consolas, Menlo, monospace', fontSize: 13, lineHeight: 1.5,
                  background: '#0e1116', color: '#d1d4dc', border: '1px solid var(--border)',
                  borderRadius: 6, padding: 12, outline: 'none', whiteSpace: 'pre', overflow: 'auto'
                }}
              />
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                <button className="top-btn" onClick={handleAddPineScript}
                  style={{ background: 'var(--brand)', color: '#fff', fontWeight: 700, padding: '8px 18px' }}>
                  Add to Chart
                </button>
                <button className="top-btn" onClick={() => { setPineSource(REAL_DIP_PINE); setPineResult(null); }}
                  style={{ background: 'rgba(8,153,129,0.18)', color: '#089981', border: '1px solid #089981', fontWeight: 600, padding: '8px 14px' }}>
                  Load Haider-Gold-Scalper
                </button>
                <button className="top-btn" onClick={() => { setPineSource(DEFAULT_PINE); setPineResult(null); }}
                  style={{ color: 'var(--text-muted)' }}>
                  Reset to example
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SIGNAL ACCURACY MODAL */}
      {showSigAccuracy && (
        <div className="modal-overlay" onClick={() => setShowSigAccuracy(false)}>
          <div className="modal-content" style={{ width: 520, maxWidth: '94vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              Signal Accuracy — Backtest
              <button className="btn-icon" onClick={() => setShowSigAccuracy(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                {symbol} · {timeframe} · strategy: {
                  Object.keys(activeSignalStrategies || {})
                    .filter(k => activeSignalStrategies[k])
                    .map(k => k === 'HAIDER_ENHANCED' ? 'Haider-Scalper-Enhanced' : (k === 'REAL_DIP' ? 'Haider-Gold-Scalper' : k))
                    .join(', ') || 'Haider-Gold-Scalper'
                }
              </div>
              {sigAccLoading && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Running backtest on MT5 history…</div>}
              {sigAccError && (
                <div style={{ padding: 12, background: 'rgba(242,54,69,0.12)', border: '1px solid rgba(242,54,69,0.4)', borderRadius: 6, color: '#f23645', fontSize: 13 }}>
                  {sigAccError.includes('MT5') ? 'MT5 not connected — start MetaTrader 5 (logged in), then retry.' : sigAccError}
                </div>
              )}
              {sigAcc && !sigAccError && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>{sigAcc.from} → {sigAcc.to} · {sigAcc.bars} bars</div>
                  {[['Combined', sigAcc.combined], ...Object.entries(sigAcc.by_strategy || {})].map(([name, c]) => c ? (
                    <div key={name} style={{ marginBottom: 14, background: '#0e1116', border: '1px solid #1f2430', borderRadius: 6, padding: '10px 12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <strong style={{ color: '#fff' }}>{name}</strong>
                        <span style={{ fontSize: 11, fontWeight: 700, color: (c.expectancy_R ?? 0) > 0 ? '#089981' : '#f23645' }}>{c.verdict || 'EVALUATED'}</span>
                      </div>
                      {[
                        ['Signals', c.signals ?? c.total_signals ?? 0],
                        ['Resolved (hit TP1 or SL)', c.resolved ?? 0],
                        ['Win rate', `${c.win_rate ?? 0}%  (break-even ${c.break_even_win_rate ?? 0}%)`],
                        ['Avg trades / day', `${c.avg_trades_per_day ?? 0} trades / day`],
                        ['P/L pips / day', `${(c.pips_per_day ?? 0) > 0 ? '+' : ''}${c.pips_per_day ?? 0} pips/day (${(c.usd_per_day ?? 0) > 0 ? '+$' : '$'}${c.usd_per_day ?? 0}/day @ 0.10 lot)`],
                        ['Avg TP size / trade', `+${c.avg_tp_pips ?? 0} pips (+$${(c.avg_tp_pips ?? 0).toFixed(2)})`],
                        ['Avg SL risk / trade', `-${c.avg_sl_pips ?? 0} pips (-$${(c.avg_sl_pips ?? 0).toFixed(2)})`],
                        ['Expectancy', `${(c.expectancy_R ?? 0) > 0 ? '+' : ''}${c.expectancy_R ?? 0} R / trade`],
                        ['Total net pips', `${(c.net_pips ?? 0) > 0 ? '+' : ''}${c.net_pips ?? 0} pips (${(c.total_R ?? 0) > 0 ? '+' : ''}${c.total_R ?? 0} R)`],
                        ['Scale-out plan / trade', `${(c.scaled_expectancy_R ?? 0) > 0 ? '+' : ''}${c.scaled_expectancy_R ?? 0} R`],
                        ['Scale-out plan total', `${(c.scaled_total_R ?? 0) > 0 ? '+' : ''}${c.scaled_total_R ?? 0} R`],
                        ['Unresolved', c.unresolved ?? 0]
                      ].map(([k, v], i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0' }}>
                          <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                          <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  ) : null)}
                  <div style={{ fontSize: 11, color: '#f7a600', background: 'rgba(247,166,0,0.08)', border: '1px solid rgba(247,166,0,0.3)', borderRadius: 6, padding: 10, marginTop: 4, lineHeight: 1.5 }}>
                    ⚠ Gross of spread/commission/slippage — real results are worse. Scored TP1-vs-SL, stop-first on ties.
                    Positive expectancy here is a starting point, not a guarantee. Forward-test on a demo account before risking real money.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* BACKTEST MODAL */}
      {showBacktest && (
        <div className="modal-overlay" onClick={() => setShowBacktest(false)}>
          <div className="modal-content" style={{ width: 480, maxWidth: '94vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              Strategy Backtest — MT5 Data
              <button className="btn-icon" onClick={() => setShowBacktest(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              {/* Strategy Selector */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, background: '#131722', padding: 4, borderRadius: 6, border: '1px solid var(--border)' }}>
                {[
                  { id: 'haider_enhanced', label: 'Haider-Scalper-Enhanced (90%+)' },
                  { id: 'real_dip', label: 'Haider-Gold-Scalper' },
                  { id: 'gold_scalper', label: 'Gold Scalper Pro' }
                ].map(s => (
                  <button
                    key={s.id}
                    onClick={() => { setBtStrategy(s.id); saveLS('btStrategy', s.id); setBtData(null); }}
                    style={{
                      flex: 1, padding: '6px 10px', fontSize: 11.5, fontWeight: 600, borderRadius: 4, border: 'none', cursor: 'pointer',
                      background: btStrategy === s.id ? 'var(--brand)' : 'transparent',
                      color: btStrategy === s.id ? '#fff' : 'var(--text-muted)'
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {symbol} · {timeframe} · {btBars} bars
                </div>
                <div style={{ flex: 1 }} />
                <button className="top-btn" onClick={() => runBacktest()} disabled={btLoading}
                  style={{ background: 'var(--brand)', color: '#fff', fontWeight: 700, padding: '6px 14px', opacity: btLoading ? 0.6 : 1 }}>
                  {btLoading ? 'Running…' : 'Run Backtest'}
                </button>
              </div>

              {btError && (
                <div style={{ color: '#f23645', fontSize: 13, padding: 8, background: 'rgba(242,54,69,0.1)', borderRadius: 4, marginBottom: 10 }}>
                  {btError}
                </div>
              )}

              {btData && !btError && (
                <div>
                  <div style={{
                    textAlign: 'center', padding: '10px', borderRadius: 6, marginBottom: 12, fontWeight: 800, fontSize: 15,
                    background: (btData.verdict && (btData.verdict.startsWith('MAKES') || btData.win_rate >= 50)) ? 'rgba(8,153,129,0.15)' : 'rgba(242,54,69,0.15)',
                    color: (btData.verdict && (btData.verdict.startsWith('MAKES') || btData.win_rate >= 50)) ? '#089981' : '#f23645'
                  }}>
                    {btData.verdict || (btData.win_rate >= 50 ? 'POSITIVE EDGE' : 'CAUTION')}
                  </div>

                  {btData.total_signals !== undefined ? (
                    <div>
                      {[
                        ['Total Signals', btData.total_signals],
                        ['Wins (Hit TP)', btData.win_count],
                        ['Losses (Hit SL)', btData.loss_count],
                        ['Win Rate', `${btData.win_rate}%`],
                        ['Profit Factor', btData.profit_factor ?? 'n/a'],
                        ['Net PnL (0.10 lot)', `${btData.net_pnl >= 0 ? '+' : ''}$${btData.net_pnl?.toFixed(2)}`],
                        ['Max Drawdown', `${btData.max_drawdown}%`],
                        ['Partial Moves (10-30%)', btData.partial_moves],
                        ['Overshot TP (50-100%+)', btData.overshot_tp],
                        ['Min Win Pts', `${btData.min_win_pts?.toFixed(0)} pts`],
                        ['Max Win Pts', `${btData.max_win_pts?.toFixed(0)} pts`],
                        ['Avg Win Pts', `${btData.avg_win_pts?.toFixed(1)} pts`],
                        ['Median Win Pts', `${btData.median_win_pts?.toFixed(1)} pts`]
                      ].map(([k, v], i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 4px', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>
                          <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                          <strong style={{ color: typeof v === 'string' && v.startsWith('+') ? '#089981' : '#fff' }}>{v}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div>
                      {[
                        ['Net return', `${btData.net_return_pct > 0 ? '+' : ''}${btData.net_return_pct}%`],
                        ['Trades', btData.trades],
                        ['Win rate', `${btData.win_rate}%`],
                        ['Profit factor', btData.profit_factor ?? 'n/a']
                      ].map(([k, v], i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 4px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                          <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                          <strong style={{ color: '#fff' }}>{v}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SIGNAL PERFORMANCE MODAL */}
      <SignalPerformanceModal
        isOpen={showSignalPerformanceModal}
        onClose={() => setShowSignalPerformanceModal(false)}
        activeSignalStrategies={activeSignalStrategies}
        onToggleStrategy={handleToggleSignalStrategy}
      />

      {/* CHECK FOR UPDATES MODAL */}
      <UpdateModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        appVersion={appVersion}
      />

      {/* QUANT & CHAMPIONS COUNCIL INTELLIGENCE TERMINAL */}
      <QuantIntelligenceModal
        isOpen={showIntelligenceModal}
        onClose={() => setShowIntelligenceModal(false)}
        symbol={symbol}
        timeframe={timeframe}
      />
    </div>
  );
}

export default App;
