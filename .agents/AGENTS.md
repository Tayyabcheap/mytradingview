# MyFinanceAdvisor Agent Guidelines

Welcome to **MyFinanceAdvisor**. Review this document and the associated memory before working on this repository.

## Master Context & Memory
- Detailed project architecture, runtime specifications, git setup, and VM deployment steps are documented in [`PROJECT_MEMORY.md`](file:///e:/MyPersonalProjects/MyFinanceAdvisor/.agents/PROJECT_MEMORY.md).

## Core Principles
1. **Trading Limits & Safety**:
   - Max risk per trade: <= 1.0%.
   - Hard lot cap for Gold (`XAUUSD`, `XAUUSDc`): strictly <= 1.0.
   - Demo accounts only unless explicitly overriden.
2. **Architecture & Parity Invariants**:
   - Python runtime (`src/strategy_runtime.py`) and JavaScript frontend (`frontend/src/components/myBrainsLab.js`) must remain in lockstep.
   - Always run `python tools/parity_check.py` and `python -m pytest` after modifying strategy evaluation logic.
3. **Git & Security Hygiene**:
   - Do NOT commit screenshots, credentials, internal handover files, or account numbers.
   - Keep `.gitignore` strictly enforced.
