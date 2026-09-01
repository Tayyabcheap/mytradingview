---
name: doc_generator
description: A skill that reads the Python backend and auto-generates Markdown documentation for the algorithmic strategy rules.
---

# Documentation Generator

When asked to "generate docs" or "document the strategy", you must read the source code and generate a comprehensive `README.md` or `strategy_docs.md` artifact.

## Execution Steps
1. **Source Code Reading:**
   - Read `config.py` to extract the current hardcoded parameters (Session Times, Risk %, Max Stop Loss, Take Profit Ratios, Volume minimums, Wick ratios).
   - Read `signal_engine.py` to understand the flow of the `evaluate_bar` function.
2. **Document the Math:**
   - Explain how `config.MAX_RISK_PERCENT` and `SL_MAX_DISTANCE_USD` interact to calculate the dynamic lot size.
   - Explain how `TP1_MIN_RR` and `TP1_PARTIAL_CLOSE_PCT` distribute the profits.
3. **Generate Flowcharts:**
   - Use Markdown Mermaid syntax ````mermaid ... ```` to draw a decision tree of the entry gates (e.g., Session Check -> HTF Alignment -> Volume Check -> Wick Check -> Entry).
4. **Publish:**
   - Write the documentation to `docs/strategy_handbook.md` (create the directory if it doesn't exist).
   - Ensure the markdown is highly stylized with GitHub Alerts (`> [!IMPORTANT]`, etc.) to highlight the aggressive trading parameters.
