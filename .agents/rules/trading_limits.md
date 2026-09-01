# Trading Limit Guard

## Trigger: always_on

## Rules
1. **NEVER modify `config.MAX_RISK_PERCENT` to be greater than 1.0**. The user has strict risk management rules in place. Any AI agent suggesting a risk > 1% is violating safety protocols.
2. **NEVER increase `config.MAX_LOTS` above 1.0**. This is a hard cap to prevent catastrophic slippage and margin calls on XAUUSD.
3. If the user explicitly asks to increase these limits, you must warn them of the financial danger and require a second confirmation before applying the change.
