# Trade with Rakhi — Gold SMC Desk

A local trading desk for XAUUSD built on the rules in `rakhi_trading_playbook.pdf` v1.0.
Runs on your machine, talks to your MetaTrader 5 terminal, and is reachable from
nowhere else.

---

## Running it

Double-click **`START_TRADE_WITH_RAKHI.bat`**. It starts the server, puts a gold icon
in the tray, and opens <http://127.0.0.1:5000>.

**`STOP_SERVER.bat`** stops it. **`RUN_BACKTEST.bat`** regenerates the results files.
**`RUN_TESTS.bat`** runs the strategy tests.

First-time setup:

```
pip install -r requirements.txt
```

`edge-tts` in that list is optional but recommended — it is what makes the voice sound
like a person rather than a screen reader. Without it the browser voice is used instead
and everything else works the same.

---

## The pages

| Page | What it is for |
|---|---|
| **Chart** | Live candles, order blocks, FVGs, the current setup, and — when there is no setup — the reason why not |
| **Desk** | Position sizing from your balance, then a confirmation step before any order is sent |
| **Analytics** | Backtest results, ranked on net dollars |
| **Strategy** | Every playbook rule against what the engine is actually doing |
| **Alarms** | Eight alarm types, all of which fire |
| **Settings** | Voice, Telegram, server |

---

## Units

There is one convention and it is defined once, in `config.py`:

```
1 pip   = $0.10 of gold price movement      (playbook: "+50 pips" = $5.00)
1 point = $1.00 of gold price movement      (playbook: "4-10 points (40-100 pips)")
```

Everything in `config.py` is expressed in **US dollars of price movement**. Use
`config.pips(50)` and `config.points(1.5)` rather than multiplying by hand.

The previous version carried three incompatible definitions of a "point" across
`config.py`, `signal_engine.py` and `backtester.py`, which produced a 10x error in the
Cost-to-Cost stop price and put the supposedly risk-free stop *inside* true breakeven.

---

## Broker time vs UTC

MetaTrader stamps every bar in the **broker's server time**, not UTC. Most forex brokers
run GMT+2 in winter and GMT+3 in summer. Nothing in the data says so — the timestamps
simply look like UTC and are not.

Every session rule in the playbook is written in real UTC: the live window is
00:30–07:30, the London-open trap is 05:30, the Asian range is 00:00–06:00. Reading
those off raw bar hours shifts the entire strategy by the broker's offset.

The desk reads the offset from a live tick and carries two clocks:

| | Used for |
|---|---|
| **Broker time** | what the chart shows, and what the daily bars are cut on — so PDH/PDL match your MT5 markup |
| **True UTC** | every session gate, the London trap, the Asian range |

The Strategy page shows the detected offset and translates Rakhi's window onto your
broker's clock, so a wrong value is visible rather than silent. On a GMT+3 server her
00:30–07:30 UTC window sits at **03:30–10:30** on your MT5 chart.

Measured on 60 days of generated data, ignoring a GMT+3 offset put the engine on
21:00–04:00 UTC instead of 00:00–07:00 — three of its eight trading hours were wrong,
and it missed the London open entirely.

---

## Reading the Analytics page

Win rate is not the headline, because it cannot tell you whether a strategy makes money.

The previous dashboard reported Rakhi Core at **67.7% win rate** while the strategy lost
**$13,574** over 440 trades. Nothing was wrong with that percentage. The number that
explains it was not on the page:

```
average win     +$20
average loss   -$138
payoff ratio     0.14

at a payoff ratio of 0.14 you need to win 87% of the time to break even
the strategy won 68%
```

So the page now leads with **net dollars**, **payoff ratio**, and **the win rate your
payoff ratio demands**. A one-line verdict at the top says whether the strategy makes
money and why.

Two other things worth knowing:

- **Scratch wins** counts wins smaller than 0.5R. A win that small does not pay for a
  loss. A strategy made mostly of them looks excellent on win rate and drains the account.
- **Expectancy in R** shows `n/a` when risk per trade varies too much for R to be
  comparable. On the historical files every trade used a fixed 0.10 lots regardless of
  stop distance, so risk ranged from $4 to $667 and mean R came out at **+3.4** on a book
  that lost $13,574. Once you size positions from the Desk page, that figure starts
  meaning something.

---

## Regenerating the backtest

Every result file is stamped with `strategy_fingerprint()` — a hash of every parameter
that affects signal generation. The Analytics page compares it against the running engine
and warns when they disagree.

This matters because it already went wrong once. The files shipped with the previous
version were generated with a +12 pip CTC and 30/55 pip targets, while the engine
alongside them used +40/60/120 and a minimum stop of 4.50 — it was arithmetically
incapable of producing a single row in the files the dashboard was reporting.

Change anything in `config.py`, then:

```
RUN_BACKTEST.bat
```

MetaTrader 5 must be running and logged in.

---

## Where the rules live

`config.py` is the only place a strategy parameter is defined, and each one cites the
playbook section it comes from. The Strategy page renders that live, so the two cannot
drift apart silently.

A few worth knowing about:

| Setting | Effect |
|---|---|
| `ALLOW_SWEEP_ONLY_ENTRIES` | `False`. Entry requires an order block or FVG tap. A raw PDH/PDL sweep sets bias — playbook §2, "never chase expansion". 96% of historical trades entered on the sweep branch, and lost $13,367. |
| `CONFIRMATION_REQUIRES_WICK_AND_CLOSE` | `True`. Green close **and** ≥30% wick. The old code used **or**, and 68% of entries came in below the wick minimum. |
| `SL_MAX_DISTANCE_USD` | `$10.00`, the playbook ceiling. A setup needing more is **declined**, not clamped — clamping would put the stop inside structure. Historical stops reached $207.57. |
| `SESSION_WINDOWS_UTC` | `00:30–07:30 UTC`, matching Rakhi's stated 06:00–13:00 IST. Set `ENABLE_US_NEWS_SESSION = True` to add the US block. |
| `MAX_TRADES_PER_SESSION` | `3`, and `CONSECUTIVE_STOPS_TO_PAUSE = 2` trips a four-hour pause. Playbook §4; never previously implemented. |

Expect **far fewer signals** than before. That is the intent — most of what the old
engine fired on were entries the playbook forbids.

---

## Security

- The server binds to `127.0.0.1`. It previously bound to `0.0.0.0`, which exposed an
  unauthenticated order-execution endpoint to every device on your network.
- Every endpoint that can move money requires a token from `.desk_token`, generated on
  first run. Do not commit that file.
- **Restart** and **Shut down** terminate only the processes this app started, by PID.
  They previously ran `Stop-Process -Name python,pythonw -Force`, which killed every
  Python process on the machine.
- Telegram tokens are stored in `telegram_config.json` and never sent back to the page.

---

## Layout

```
config.py           every strategy parameter, with playbook citations
indicators.py       market structure — POIs, bias, Asian range, candle geometry
signal_engine.py    Rakhi Core (strict playbook) and Custom Pro (confluence-scored)
risk.py             position sizing, session cap, circuit breaker
metrics.py          honest performance reporting
voice.py            neural TTS with a browser fallback, and the script library
backtester.py       full trade management: TP1 partial, trail, CTC, discipline
app.py              Flask server, MT5 bridge, API
tray_service.py     Windows tray icon and speech
templates/          one shell, six pages
static/css/         one stylesheet, responsive from 360px, WCAG AA throughout
static/js/core/     api, formatting, shell, voice, alarms
static/js/pages/    one entry point per page
static/vendor/      lightweight-charts and fonts, vendored so no internet is required
tests/              strategy unit tests
```

`static/index.html`, `static/app.js` and `static/styles.css` from the previous version
are no longer used. They are safe to delete.

---

## Known gaps

- **The news protocol (playbook §5) is not implemented.** There is no economic calendar
  wired in, so pre-news position handling and the 15-minute post-release wait are on you.
  Scaffolding is in `config.NEWS_EVENTS_UTC`.
- **The backtest has not been re-run against live history yet.** Do that before trusting
  any number on the Analytics page.
- Custom Pro is not from the playbook. It is an in-house strategy and is marked as such
  everywhere it appears.
