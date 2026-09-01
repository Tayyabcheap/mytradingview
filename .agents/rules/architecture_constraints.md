# Core Architecture Constraints

## Trigger: when editing `signal_engine.py` or `indicators.py`

## Rules
1. **Stateless Signal Engine:** `SignalEngine` MUST remain completely stateless. It should rely solely on the DataFrame passed to it. Do not introduce global state, caching mechanisms, or class-level state variables that mutate between evaluations.
2. **Immutable Indicators:** Do not mutate `indicators.py` data structures from within `signal_engine.py`. The indicators layer provides data; the signal engine consumes it. 
3. **Purity:** Ensure that running the backtester across a time series forward yields the exact same signals as running it backward or in chunks.
