# Test-Driven Modification

## Trigger: when instructed to modify strategy logic or add new entry filters

## Rules
1. **Always write the test first.** Before modifying `config.py` or `signal_engine.py` to add a new playbook rule or fix a bug, you must navigate to `tests/test_strategy.py` and write a failing synthetic test case that isolates the expected behavior.
2. **Prove the failure.** Run `python tests/test_strategy.py` and observe the test failing.
3. **Implement the fix.** Modify the core code.
4. **Verify.** Run the test suite again to ensure 100% pass rate. No untested code should be deployed.
