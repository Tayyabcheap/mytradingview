---
name: qa_deploy
description: A deployment checklist to run QA tests, linters, and verification checks before finalizing any major strategy update.
---

# QA & Deployment Runbook

When asked to "run QA" or "deploy", you must execute this checklist strictly. Do not skip steps.

## Step 1: Code Linting
1. Run `python -m flake8 . --count --select=E9,F63,F7,F82 --show-source --statistics` to check for syntax errors.
2. Fix any syntax errors you find.

## Step 2: Unit Testing
1. Run the test suite: `python tests/test_strategy.py`
2. If any test fails, STOP. You must debug the failing test. The strategy cannot be deployed with a failing test. 

## Step 3: Math Sanity Check
1. Run a fast 7-day backtest: `python backtester.py --days 7`
2. Verify that the output does not throw Python tracebacks or `KeyError` exceptions (meaning the data processing pipeline is intact).

## Step 4: UI Verification
1. Check that the `START_MY_FINANCE_ADVISOR.bat` script has the correct paths and commands to start the backend and frontend.

## Step 5: Final Report
Write a short markdown summary indicating that the MyFinanceAdvisor engine is 100% green and ready for live trading.
