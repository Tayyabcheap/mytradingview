"""
parity_check.py - proves the live trader and the research engine agree.
======================================================================
The research floor searches for strategies in JavaScript. The robot trades
them in Python. Two implementations of the same rule will drift apart, and a
silent drift means you are trading a strategy nobody ever backtested.

This runs both over identical bars, across several genome sets including
random ones, and fails loudly if a single entry differs.

    node tools/parity_dump.mjs        # writes tools/parity.json from the JS
    python tools/parity_check.py      # compares Python against it
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src"))
import strategy_runtime as sr  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DUMP = os.path.join(HERE, "parity.json")


def main() -> int:
    if not os.path.isfile(DUMP):
        print("No parity.json. Run:  node tools/parity_dump.mjs")
        return 2
    # A dump older than the code it is supposed to be testing proves nothing.
    root = os.path.dirname(HERE)
    watched = [os.path.join(root, "frontend", "src", "components", "myBrainsLab.js"),
               os.path.join(root, "frontend", "src", "components", "myBrainsStructure.js"),
               os.path.join(root, "src", "strategy_runtime.py"),
               os.path.join(HERE, "parity_dump.mjs")]
    dump_age = os.path.getmtime(DUMP)
    stale = [os.path.basename(f) for f in watched
             if os.path.isfile(f) and os.path.getmtime(f) > dump_age]
    if stale:
        print("parity.json is older than %s." % ", ".join(stale))
        print("It would be testing code that no longer exists. Run:  node tools/parity_dump.mjs")
        return 2

    d = json.load(open(DUMP, encoding="utf-8"))
    b = d["bars"]
    bars = sr.Bars(spread=b.get("spread", 0.26), t=b["t"], o=b["o"], h=b["h"], l=b["l"], c=b["c"])
    failures = 0
    for k, case in enumerate(d["cases"]):
        cfg = case["cfg"]

        # ---- research-only disciplines ----
        # These are not a parity comparison, they are a refusal test. The JS
        # engine fires on them; Python must return nothing on every bar AND
        # say no when asked whether it can run the strategy. The assertion
        # that JS found entries is what stops this passing vacuously.
        if case.get("researchOnly"):
            ok, why = sr.can_execute(cfg)
            ind = sr.Indicators(bars, cfg)
            fired = [i for i in range(1, len(bars))
                     if sr.entry_dir(bars, cfg, i, ind)]
            js_n = len(case["entries"])
            if ok or fired or js_n == 0:
                failures += 1
                print("case %d: REFUSAL TEST FAILED  mode=%s  can_execute=%s  py_entries=%d  js_entries=%d"
                      % (k, cfg["science"]["mode"], ok, len(fired), js_n))
            else:
                print("case %d: refused correctly (JS found %d entries, Python took none) - %s"
                      % (k, js_n, why))
            continue

        ind = sr.Indicators(bars, cfg)
        mine = []
        for i in range(1, len(bars)):
            if not sr.bar_usable(bars, cfg, i, ind):
                continue
            dd = sr.entry_dir(bars, cfg, i, ind)
            if not dd:
                continue
            if not sr.regime_ok(bars, cfg, i, ind):
                continue
            if not sr.session_allowed(bars, cfg, i):
                continue
            risk = cfg["math"]["slAtr"] * ind.atr[i]
            cost = sr.trade_cost(bars, cfg, i, ind)
            if cfg["cost"]["minEdgeMult"] > 0 and risk < cfg["cost"]["minEdgeMult"] * cost:
                continue
            mine.append([i, dd])
        theirs = [list(x) for x in case["entries"]]
        if mine == theirs:
            print("case %d: match (%d entries)" % (k, len(mine)))
        else:
            failures += 1
            print("case %d: MISMATCH  js=%d  py=%d" % (k, len(theirs), len(mine)))
            print("   only in JS:", [x for x in theirs if x not in mine][:6])
            print("   only in PY:", [x for x in mine if x not in theirs][:6])
    # ---- drift watch -----------------------------------------------------
    # Parity only proves the two engines agree. It does not notice when BOTH
    # move together - a change to the bar generator, a shared indicator or a
    # default gene shifts every discipline at once and parity still passes.
    # The fingerprint catches that.
    fp_path = os.path.join(HERE, "parity_fingerprint.json")
    base_path = os.path.join(HERE, "parity_baseline.json")
    if os.path.isfile(fp_path):
        fp = json.load(open(fp_path, encoding="utf-8"))
        if not os.path.isfile(base_path):
            json.dump(fp, open(base_path, "w", encoding="utf-8"), indent=1)
            print("\nDrift watch: baseline recorded for %d disciplines." % len(fp))
        else:
            base = json.load(open(base_path, encoding="utf-8"))
            moved = {k: (base.get(k), v) for k, v in fp.items() if base.get(k) not in (None, v)}
            added = [k for k in fp if k not in base]
            if moved:
                print("\nDRIFT: these disciplines changed their entry count with no parity failure:")
                for k, (was, now) in moved.items():
                    print("   %-24s %s -> %s" % (k, was, now))
                print("   If you changed that discipline on purpose, delete tools/parity_baseline.json")
                print("   and re-run to re-baseline. If you did not, something shared moved underneath")
                print("   it - the bar generator, an indicator, or a default gene.")
                failures += len(moved)
            elif added:
                print("\nDrift watch: %d new discipline(s) baselined: %s" % (len(added), ", ".join(added)))
                base.update(fp)
                json.dump(base, open(base_path, "w", encoding="utf-8"), indent=1)
            else:
                print("\nDrift watch: all %d disciplines unchanged." % len(fp))

    print("PARITY", "PASS" if not failures else "FAIL (%d cases)" % failures)
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
