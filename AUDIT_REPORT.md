# Trade with Rakhi — Full Application Audit
Scope: backend (Flask/MT5), frontend (React/klinecharts), indicators, Pine engine,
trade execution, journal, dashboard, design system, accessibility.
Method: full code read + `py_compile` (all Python OK) + Babel parse (19/19 frontend files OK)
+ pytest (24 pass / 5 fail — all 5 are "MT5 not connected" environmental, not code bugs)
+ Flask test-client security tests.

Note on verification: the React UI could NOT be run in the review environment (Linux
bridge can't run Windows-built node_modules). Logic, syntax, and the backend were tested;
live rendering was not. Items marked (needs live test) are yours to confirm on Windows.

---

## Verdict: NOT yet "ready" — but close, and much stronger after this pass.

One critical security hole was found and FIXED. One correctness inconsistency (pip
convention) is left for YOUR decision because it changes trading math. The rest are
polish. This is a genuinely capable app; the blockers below are specific, not vague.

---

## CRITICAL — fixed in this pass

### C1. Money-moving endpoints had zero authentication + open CORS  ✅ FIXED
`/api/order/send` and `/api/order/close` place/close real MT5 trades. They had no auth,
and `CORS(app)` allowed every origin. Any website open in your browser could POST to
`http://127.0.0.1:5000/api/order/send` and trade your account (drive-by CSRF against a
local money server). Your README's own `.desk_token` model was not implemented.
**Fix applied:** CORS restricted to the app's own local origins; a cross-origin guard on
both order endpoints returns 403 to browser requests from any other site. Verified with
Flask test client: evil origin → 403; same-origin and non-browser scripts → allowed.
**You should still:** re-test placing/closing a trade from the app itself on Windows to
confirm the legit path still works end-to-end.

---

## HIGH — needs your decision (NOT auto-changed: it alters trading math)

### H1. Two incompatible "pip" definitions in the codebase
- `config.py` / backtester: **1 gold pip = $0.10** (playbook: "+50 pips" = $5.00).
- `TradeExecutionPanel.jsx` (line 67) and `journal_engine.py`: **1 gold pip = $0.01**.
Effect: the execution panel's "25 pip SL" = $0.25 (a far tighter stop than the strategy
means), and the journal's pip numbers are 10× the strategy's. This is exactly the
"incompatible point definitions" your README warned about, resurfacing across new code.
**Decide one convention and make all three agree.** I did not change it because picking
0.01 vs 0.10 changes how large every stop/target is — that's your call, not mine.

---

## MEDIUM

### M1. Gold safety check is gated behind the MT5 connection (send_order)
The `volume > 1.0` gold rejection runs AFTER `init_mt5()`, so it can't be reached (or
unit-tested) when MT5 is down. It's a safety check — move it before `init_mt5()` so it
fails fast and is testable. (This is why `test_gold_safety_limit_rejection` fails in CI.)

### M2. `/api/symbols` calls `symbol_info_tick` for every visible symbol per request
On a broker with hundreds of visible symbols this is slow. It's called on load. Cache it,
or drop the per-symbol tick (the watchlist already polls `/api/quotes`).

### M3. `datetime.fromtimestamp` on MT5 times uses the machine's local timezone
Journal open/close times are stamped in broker-server time; displaying them via naive
`fromtimestamp` shifts them by your local offset. Consistent with the broker-time caveat
already documented — worth normalizing.

### M4. Several independent polling loops
positions (2.5s) + quotes (2.5s) + dashboard ×3 (5s) + chart history (2s) run
concurrently. Fine for localhost, but consider a single shared poller to cut redundant
MT5 calls.

---

## DESIGN SYSTEM

Good: a real token set exists in `index.css` (`--bg/--surface/--text/--brand/--up/--down`).
Problem: components almost entirely bypass it with hardcoded hex — `#089981` appears 84×
instead of `var(--up)`, `#f23645` 66× instead of `var(--down)`, etc. Worse, a second
muted gray `#8b949e` (84×) is used everywhere but isn't a token, drifting from
`--text-muted`; and 5+ near-black surfaces (`#0e1116`, `#0d1117`, `#131722`, `#1a1e29`,
`#1f2430`) are used interchangeably. This is a maintainability tax: changing the theme
means a find-and-replace across 20 files. Recommendation: route inline colors through the
tokens (or a shared JS `colors` object), and consolidate the grays/darks to 3–4 values.

---

## ACCESSIBILITY (WCAG 2.1 AA)

Fixed this pass:
- ✅ **2.4.7 Focus visible** — no keyboard focus indicator existed on the (inline-styled)
  buttons/inputs. Added a global `:focus-visible` outline.
- ✅ **1.4.3 Contrast** — `--text-muted #787b86` was 4.24:1 (fails AA for normal text).
  Raised to `#8b949e` (5.82:1, passes).

Still open:
- **1.4.3** brand blue `#2962ff` as small text = 3.65:1 (fails AA normal; ok for large/UI).
  Used for active-tab labels and some values. Use it for large text / borders only, or
  lighten for text.
- **1.4.3** `#6e7681` (3.9:1) on dark for timestamps/empty states — fails normal text.
- **2.1.2 / focus trap** — modals (order confirm, close confirm, pine, backtest) are not
  focus-trapped and not all close on Escape.
- **2.5.5 Touch targets** — lot steppers (32px), preset chips (~20px) are below 44px.
  Acceptable for a desktop app, noted for completeness.
- **3.3.2 Labels** — the lot-size and SL/TP number inputs have no associated `<label>`
  (screen readers announce them generically). SL/TP checkboxes are labelled (good).
- **4.1.2** icon-only buttons mostly have `title` (good); a few lack `aria-label`.

---

## WHAT'S GOOD (credit where due)

- `journal_engine.py` — proper round-trip reconstruction from MT5 deals, exit-reason
  classification, honest metrics (profit factor, payoff, Sharpe, drawdown, daily→annual).
- `validate.py` — walk-forward validation that resists curve-fitting. Rare and correct.
- TradeExecutionPanel — explicit confirmation modals before send AND close, gold safety
  limit enforced client- and server-side, live R:R.
- Single-server one-click model works; relative API URLs are consistent (0 hardcoded).
- Test suite exists and the logic tests pass.

---

## Bottom line
Fix H1 (pick one pip convention) and re-test the trade path on Windows after the security
fix. Do M1 (safety-check ordering) while you're in there. Design-system and remaining a11y
items are quality, not blockers. After H1 + a live smoke test, I'd call the core ready.
