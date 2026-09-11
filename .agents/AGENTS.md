# MyTradingView Agent Guidelines

Welcome to **MyTradingView**. Review this document and the associated memory before working on this repository.

## Master Context & Memory
- Detailed project architecture, runtime specifications, git setup, and VM deployment steps are documented in [`PROJECT_MEMORY.md`](file:///e:/MyPersonalProjects/MyTradingView/.agents/PROJECT_MEMORY.md).

## Core Principles
1. **Trading Limits & Safety**:
   - Max risk per trade: <= 1.0%.
   - Hard lot cap for Gold (`XAUUSD`, `XAUUSDc`): strictly <= 1.0.
   - Demo accounts only unless explicitly overriden.
2. **Quality & Test Invariants**:
   - Always run `python -m unittest discover tests` and ensure `npm run build` succeeds after modifying core logic.
3. **Git & Security Hygiene**:
   - Do NOT commit screenshots, credentials, internal handover files, or account numbers.
   - Keep `.gitignore` strictly enforced.
