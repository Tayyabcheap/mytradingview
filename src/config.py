"""
MyFinanceAdvisor - System Specification
=======================================
Single source of truth for every strategy parameter for authentic Swing Trading.
"""

from typing import List, Tuple

# ---------------------------------------------------------------------------
# Unit conversion helpers
# ---------------------------------------------------------------------------

USD_PER_PIP = 0.10
USD_PER_POINT = 1.00

def pips(n: float) -> float:
    return n * USD_PER_PIP

def points(n: float) -> float:
    return n * USD_PER_POINT

def to_pips(usd: float) -> float:
    return usd / USD_PER_PIP

# ---------------------------------------------------------------------------
# Asset
# ---------------------------------------------------------------------------

SYMBOL = "XAUUSDc"
FALLBACK_SYMBOL = "XAUUSD"
PRICE_DECIMALS = 3

TYPICAL_SPREAD_USD = 0.26

# ---------------------------------------------------------------------------
# Timeframe hierarchy 
# ---------------------------------------------------------------------------

TIMEFRAME_HTF = "1D"          # Macro trend (200 EMA)
TIMEFRAME_ITF = "4H"          # Pullback & Momentum (MACD, RSI)
TIMEFRAME_LTF = "1H"          # Entry confirmation trigger (Candlestick)
TIMEFRAME_LTF_FALLBACK = "1H"

# ---------------------------------------------------------------------------
# Authentic Swing Indicators
# ---------------------------------------------------------------------------

# Moving Averages
EMA_MACRO_PERIOD = 200
EMA_SWING_PERIOD = 50

# MACD (Momentum)
MACD_FAST = 12
MACD_SLOW = 26
MACD_SIGNAL = 9

# RSI (Pullbacks)
RSI_PERIOD = 14
RSI_OVERSOLD = 45   # Buy the dip (oversold in an uptrend)
RSI_OVERBOUGHT = 55 # Sell the rally (overbought in a downtrend)

# ---------------------------------------------------------------------------
# Stop loss
# ---------------------------------------------------------------------------

SL_STRUCTURE_BUFFER_USD = points(1.5)      # $1.50 behind the POI extreme
SL_MIN_DISTANCE_USD = points(4.0)          # $4.00 
SL_MAX_DISTANCE_USD = points(15.0)         # $15.00 max cap (wider for swing)

SL_LOOKBACK_BARS = 12

REJECT_SETUP_IF_SL_EXCEEDS_MAX = True
SL_MIN_ATR_MULTIPLE = 1.2

# ---------------------------------------------------------------------------
# Take profit
# ---------------------------------------------------------------------------

TP1_MIN_RR = 1.0
TP2_FALLBACK_RR = 2.0                  
TP2_MIN_RR = 1.5                       
TP2_MAX_RR = 4.0
TP2_MIN_SEPARATION_R = 0.5

TP1_PARTIAL_CLOSE_PCT = 0.75
TP2_RUNNER_PCT = 0.25

# ---------------------------------------------------------------------------
# Cost-to-Cost
# ---------------------------------------------------------------------------
CTC_TRIGGER_USD = pips(800)            # $8.00 / 80 pips (Swing trades need more room)
CTC_EXTRA_BUFFER_USD = 0.04

TRAIL_AFTER_TP1 = True
TRAIL_SWING_LOOKBACK_BARS = 20
TRAIL_BUFFER_USD = points(1.5)

# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

SESSION_WINDOWS_UTC: List[Tuple[float, float]] = [
    (0.0, 23.0),
]

ENABLE_US_NEWS_SESSION = False
US_NEWS_SESSION_UTC: Tuple[float, float] = (12.5, 15.5)

LONDON_TRAP_START_UTC = 5.5            
LONDON_TRAP_BUFFER_MINUTES = 10
FRIDAY_MAX_HOUR_UTC = 14

# ---------------------------------------------------------------------------
# Classical support and resistance
# ---------------------------------------------------------------------------

SR_ENABLED = True
SR_TIMEFRAME = "1D"                # Major Daily levels
SR_PIVOT_LEFT = 3
SR_PIVOT_RIGHT = 3
SR_CLUSTER_ATR = 0.55
SR_MIN_TOUCHES = 2                 
SR_LOOKBACK_BARS = 200             
SR_MAX_AGE_HOURS = 800             
SR_MAX_ZONES = 8

SR_USE_AS_TP2 = True

# ---------------------------------------------------------------------------
# Risk and session discipline
# ---------------------------------------------------------------------------

MAX_RISK_PERCENT = 1.0

LOT_SIZE_TIERS: List[Tuple[float, float]] = [
    (0.0,     0.01),
    (200.0,   0.02),
    (500.0,   0.05),
    (1000.0,  0.07),
    (5000.0,  0.10),
    (10000.0, 0.20),
]

DEFAULT_LOTS = 0.01
MAX_LOTS = 1.00                        

MAX_TRADES_PER_SESSION = 2            # Highly selective
MAX_OPEN_TRADES = 2
CONSECUTIVE_STOPS_TO_PAUSE = 2         # Strict capital protection
PAUSE_DURATION_MINUTES = 1440          # Pause for a day (swing trading)

SIGNAL_COOLDOWN_BARS = 3
MAX_BAR_HOLDING_LTF = 200              

# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------

HOST = "127.0.0.1"
PORT = 5000

REQUIRE_AUTH_FOR_TRADING = True
STATUS_POLL_MS = 1000                   
CHART_POLL_MS = 3000                   
CHART_CACHE_TTL_SEC = 2.5              

# ---------------------------------------------------------------------------
# Voice
# ---------------------------------------------------------------------------

VOICE_ENABLED = True
VOICE_PERSONA = "confident"            
VOICE_ENGINE = "auto"                  
VOICE_NEURAL_NAME = "en-US-AriaNeural" # Professional AI voice
VOICE_NEURAL_RATE = "0%"             
VOICE_NEURAL_PITCH = "0Hz"            
VOICE_BROWSER_RATE = 1.0
VOICE_BROWSER_PITCH = 1.0
VOICE_CACHE_DIR = ".voice_cache"
VOICE_MIN_REPEAT_SEC = 20

def strategy_fingerprint() -> str:
    import hashlib
    import json
    tracked = {
        k: v for k, v in sorted(globals().items())
        if k.isupper() and isinstance(v, (int, float, str, bool, list, tuple))
    }
    blob = json.dumps(tracked, default=str, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:12]
