"""
Timeframe resolution and fallback tests.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src'))

import config
import timeframes


class FakeMT5:
    TIMEFRAME_M1, TIMEFRAME_M3, TIMEFRAME_M5 = 1, 3, 5
    TIMEFRAME_M15, TIMEFRAME_M30 = 15, 30
    TIMEFRAME_H1, TIMEFRAME_H4, TIMEFRAME_D1 = 16385, 16388, 16408


timeframes.mt5 = FakeMT5


def probe_for(serves):
    calls = []
    def probe(c):
        calls.append(c)
        return [1, 2, 3] if c in serves else None
    return probe, calls


class TestTimeframes(unittest.TestCase):
    def test_broker_serves_3m(self):
        timeframes.clear_cache()
        p, _ = probe_for({FakeMT5.TIMEFRAME_M3, FakeMT5.TIMEFRAME_M5})
        self.assertEqual(timeframes.resolve("3M", p, scope="t1"), ("3M", FakeMT5.TIMEFRAME_M3))

    def test_broker_fallback_5m(self):
        timeframes.clear_cache()
        p, _ = probe_for({FakeMT5.TIMEFRAME_M5, FakeMT5.TIMEFRAME_M15, FakeMT5.TIMEFRAME_H1, FakeMT5.TIMEFRAME_D1})
        name, const = timeframes.resolve("3M", p, scope="t2")
        self.assertEqual((name, const), ("5M", FakeMT5.TIMEFRAME_M5))

    def test_probe_caching(self):
        timeframes.clear_cache()
        p, calls = probe_for({FakeMT5.TIMEFRAME_M5})
        for _ in range(20):
            timeframes.resolve("3M", p, scope="t4")
        self.assertEqual(len(calls), 2)

    def test_bars_per_day(self):
        bad = [n for n in timeframes.CHAIN
               if n not in timeframes.BARS_PER_DAY
               or timeframes.BARS_PER_DAY[n] * timeframes.MINUTES[n] != 1440]
        self.assertEqual(len(bad), 0)


if __name__ == '__main__':
    unittest.main()
