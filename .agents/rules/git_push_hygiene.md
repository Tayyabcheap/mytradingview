# Git Push & Repository Hygiene

## Trigger: always_on

## Rules
1. **Mandatory Files Only**: When staging files for commit and push, only stage application source code, tests, documentation, and configuration templates.
2. **Exclude Non-Mandatory & Sensitive Files**:
   - NEVER commit credentials, tokens, or local configurations (`secrets.local.json`, `credentials.json`, `telegram_config.json`, `.desk_token`, `autotrader_state.json`, `approved_strategy.json`).
   - NEVER commit screenshots, image dumps (`Claude outputs/`), or temporary backup files (`*.prepool`, `*.prebook`, `*.bak`).
   - NEVER commit internal handover notes or documents containing account IDs, passwords, or sensitive infrastructure notes (`HANDOVER.md`, `README_AUTONOMY.md`, `CODE_REVIEW_*.md`).
3. **Account Sanitization**: Never commit real broker account numbers. Ensure all UI copy and documentation refer to "configured demo account".
4. **Remote Target**: Ensure git remote pushes to `git@github-personal:haider2804/mytradingview.git` using personal SSH keys.
5. **Pre-Push Validation**: Always execute `python -m unittest discover tests` and ensure `npm run build` succeeds in frontend to confirm zero regression before pushing.
