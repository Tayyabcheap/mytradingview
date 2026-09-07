"""
strategy_structure.py - multi-timeframe market structure for the live trader.
============================================================================
A line-for-line mirror of `myBrainsStructure.js`. The research floor draws
trend lines and order blocks in JavaScript; this file has to reach the same
conclusion on the same bars or the robot is trading something nobody tested.
`tools/parity_check.py` proves it.

Two rules govern everything here, and both exist because breaking them is how
multi-timeframe strategies lie about their own results:

  1. NOTHING READS THE FUTURE. Every ray carries the bar it became knowable
     on (its second anchor confirmed as a pivot) and the bar it died on. A
     line still unbroken at the right-hand edge of the chart is a survivor,
     and selecting on survivors is circular.

  2. A LINE DIES ON A HIGHER-TIMEFRAME CLOSE. An hourly poke through a
     Monthly line does not break the Monthly line. Entries are worked on the
     base chart; deaths are judged on the chart the line was drawn on.

If you change this file, change myBrainsStructure.js, and run the parity test.
"""

from __future__ import annotations
import math
from typing import Dict, List, Optional

TF_MS = {'5M': 300000, '15M': 900000, '30M': 1800000, '1H': 3600000,
         '4H': 14400000, '1D': 86400000, '1W': 604800000, '1MN': 2592000000}

TL_TFS = ['1MN', '1W', '1D', '4H']
TL_PIVOT = {'1MN': 1, '1W': 2, '1D': 3, '4H': 3}
OB_TFS = ['1D', '4H', '1H']
OB_IMPULSE = [4, 6, 8]

STRUCT_TOL = 0.35          # the "zero intersection" tolerance, in avg candle ranges
RAY_SPAN = 8               # anchor B within 8 pivots of anchor A
RAY_SPACING = 6            # two taps must be 6 candles apart to count separately
BASE_COOLDOWN = 12         # base bars between two trades off the same line
ANGLE_WINDOW_MS = 90 * 86400000


class Series:
    __slots__ = ('n', 'tfMs', 't', 'o', 'h', 'l', 'c', 'endIdx')

    def __init__(self, n, tfMs, t, o, h, l, c, endIdx):
        self.n, self.tfMs = n, tfMs
        self.t, self.o, self.h, self.l, self.c, self.endIdx = t, o, h, l, c, endIdx


def resample(bars, tf_ms: int) -> Series:
    """A higher-timeframe candle only exists once its last constituent bar
    has closed. Building them any other way lets a backtest see a Monthly
    high before the month is over."""
    t, o, h, l, c, end = [], [], [], [], [], []
    cur = None
    for i in range(len(bars.c)):
        key = math.floor(bars.t[i] / tf_ms)
        if key != cur:
            cur = key
            t.append(key * tf_ms)
            o.append(bars.o[i]); h.append(bars.h[i]); l.append(bars.l[i]); c.append(bars.c[i])
            end.append(i)
        else:
            k = len(h) - 1
            if bars.h[i] > h[k]:
                h[k] = bars.h[i]
            if bars.l[i] < l[k]:
                l[k] = bars.l[i]
            c[k] = bars.c[i]
            end[k] = i
    return Series(len(c), tf_ms, t, o, h, l, c, end)


def swings(ser: Series, w: int):
    hi, lo = [], []
    for i in range(w, ser.n - w):
        is_h = is_l = True
        for j in range(i - w, i + w + 1):
            if j == i:
                continue
            if ser.h[j] >= ser.h[i]:
                is_h = False
            if ser.l[j] <= ser.l[i]:
                is_l = False
            if not is_h and not is_l:
                break
        if is_h:
            hi.append({'i': i, 't': ser.t[i], 'p': ser.h[i], 'confirmed': i + w})
        if is_l:
            lo.append({'i': i, 't': ser.t[i], 'p': ser.l[i], 'confirmed': i + w})
    return hi, lo


def _tol_series(ser: Series, look: int = 120) -> List[float]:
    """Causal tolerance. Averaging candle range over the WHOLE series and
    using it to decide whether a line broke at candle 300 imports next year's
    volatility into last year's decision."""
    out = [0.0] * ser.n
    acc = 0.0
    for i in range(ser.n):
        acc += ser.h[i] - ser.l[i]
        if i >= look:
            acc -= ser.h[i - look] - ser.l[i - look]
        out[i] = STRUCT_TOL * (acc / min(i + 1, look))
    return out


def _map_base_to_htf(bars, ser: Series) -> List[int]:
    """base bar -> index of the last HTF candle that had definitely CLOSED.
    Strictly less-than: a candle is not closed while we are still inside it."""
    n = len(bars.c)
    out = [-1] * n
    k = 0
    for i in range(n):
        while k < ser.n and ser.endIdx[k] < i:
            k += 1
        out[i] = k - 1
    return out


def _rolling_window(ser: Series):
    n = ser.n
    hi = [0.0] * n
    lo = [0.0] * n
    i0 = [0] * n
    qh, ql = [], []
    s = 0
    for i in range(n):
        while s < i and ser.t[i] - ser.t[s] > ANGLE_WINDOW_MS:
            s += 1
        while qh and qh[0] < s:
            qh.pop(0)
        while ql and ql[0] < s:
            ql.pop(0)
        while qh and ser.h[qh[-1]] <= ser.h[i]:
            qh.pop()
        while ql and ser.l[ql[-1]] >= ser.l[i]:
            ql.pop()
        qh.append(i); ql.append(i)
        hi[i] = ser.h[qh[0]]; lo[i] = ser.l[ql[0]]; i0[i] = s
    return hi, lo, i0


def _ray_price_at(ray, t):
    return ray['p0'] + ray['slope'] * (t - ray['t0'])


def _angle_at(ray, ser, win, k):
    hi, lo, i0 = win
    rng = max(1e-9, hi[k] - lo[k])
    span = max(1, ser.t[k] - ser.t[i0[k]])
    return abs(math.atan((ray['slope'] * span) / rng) * 180 / math.pi)


def prepare_rays(bars, tf: str, pivot_w: int) -> Dict:
    ser = resample(bars, TF_MS[tf])
    prep = {'tf': tf, 'ser': ser, 'rays': [], 'events': [], 'byBase': {},
            'candles': ser.n, 'baseToHtf': _map_base_to_htf(bars, ser)}
    if ser.n < pivot_w * 3 + 8:
        return prep

    tol_a = _tol_series(ser)
    win = _rolling_window(ser)
    sw_hi, sw_lo = swings(ser, pivot_w)

    for lst, kind in ((sw_hi, 'resistance'), (sw_lo, 'support')):
        for ai in range(len(lst) - 1):
            for bi in range(ai + 1, min(len(lst), ai + 1 + RAY_SPAN)):
                A, B = lst[ai], lst[bi]
                dt = B['t'] - A['t']
                if dt <= 0:
                    continue
                slope = (B['p'] - A['p']) / dt
                # a resistance line that rises steeply is not resistance
                if kind == 'resistance' and slope > 0 and (B['p'] - A['p']) / max(1e-9, A['p']) > 0.02:
                    continue
                if kind == 'support' and slope < 0 and (A['p'] - B['p']) / max(1e-9, A['p']) > 0.02:
                    continue
                ray = {'kind': kind, 'tf': tf, 't0': A['t'], 'p0': A['p'],
                       'slope': slope, 'aIdx': A['i'], 'bIdx': B['i'],
                       'rayIdx': len(prep['rays'])}
                born = B['confirmed']
                taps = [A['i'], B['i']]
                last = B['i']
                dead = ser.n
                break_ev = None

                for k in range(B['i'] + 1, ser.n):
                    line = _ray_price_at(ray, ser.t[k])
                    tol = tol_a[k]
                    if kind == 'resistance':
                        closed_through = ser.c[k] > line + tol
                        wicked_through = ser.h[k] > line + tol
                    else:
                        closed_through = ser.c[k] < line - tol
                        wicked_through = ser.l[k] < line - tol
                    if closed_through:
                        dead = k
                        if k >= born:
                            break_ev = (k, line, 1 if kind == 'resistance' else -1)
                        break
                    if wicked_through:
                        dead = k
                        break
                    if k - last >= RAY_SPACING:
                        touched = (ser.h[k] >= line - tol) if kind == 'resistance' else (ser.l[k] <= line + tol)
                        if touched:
                            taps.append(k)
                            last = k

                if dead <= born and break_ev is None:
                    continue
                ray['bornIdx'] = born
                ray['deadIdx'] = dead
                ray['tapIdx'] = taps
                prep['rays'].append(ray)

                if break_ev is not None:
                    k, line, d = break_ev
                    prep['events'].append({
                        'type': 'break', 'dir': d, 'tf': tf, 'kind': kind,
                        'rayIdx': ray['rayIdx'], 'htfIdx': k, 'baseIdx': ser.endIdx[k],
                        'line': line, 'taps': len(taps),
                        'ageDays': (ser.t[k] - ray['t0']) / 86400000.0,
                        'angle': _angle_at(ray, ser, win, k)})

    # ---- execution on the chart in front of you ----
    # The line is a Daily line; the trade is not a Daily trade.
    btol = _tol_series_bars(bars)
    b2h = prep['baseToHtf']
    nb = len(bars.c)
    for r in prep['rays']:
        b0 = ser.endIdx[min(r['bornIdx'], ser.n - 1)]
        b1 = ser.endIdx[r['deadIdx']] if r['deadIdx'] < ser.n else nb - 1
        last_fire = -10 ** 9
        i = b0 + 1
        while i <= b1 and i < nb:
            if i - last_fire < BASE_COOLDOWN:
                i += 1
                continue
            line = _ray_price_at(r, bars.t[i])
            tol = btol[i]
            if r['kind'] == 'resistance':
                touched = (bars.h[i] >= line - tol) and (bars.h[i] <= line + tol)
                rejected = (bars.c[i] < line) and (bars.c[i] < bars.o[i])
            else:
                touched = (bars.l[i] <= line + tol) and (bars.l[i] >= line - tol)
                rejected = (bars.c[i] > line) and (bars.c[i] > bars.o[i])
            if touched and rejected:
                k = b2h[i]
                if r['bornIdx'] <= k < r['deadIdx']:
                    taps = sum(1 for ti in r['tapIdx'] if ti <= k)
                    prep['events'].append({
                        'type': 'bounce', 'dir': -1 if r['kind'] == 'resistance' else 1,
                        'tf': tf, 'kind': r['kind'], 'rayIdx': r['rayIdx'],
                        'htfIdx': k, 'baseIdx': i, 'line': line, 'taps': taps,
                        'ageDays': (bars.t[i] - r['t0']) / 86400000.0,
                        'angle': _angle_at(r, ser, win, k)})
                    last_fire = i
            i += 1

    for e in prep['events']:
        prep['byBase'].setdefault(e['baseIdx'], []).append(e)
    return prep


def _tol_series_bars(bars, look: int = 120) -> List[float]:
    n = len(bars.c)
    out = [0.0] * n
    acc = 0.0
    for i in range(n):
        acc += bars.h[i] - bars.l[i]
        if i >= look:
            acc -= bars.h[i - look] - bars.l[i - look]
        out[i] = STRUCT_TOL * (acc / min(i + 1, look))
    return out


def prepare_blocks(bars, tf: str, pivot_w: int, impulse: int) -> Dict:
    ser = resample(bars, TF_MS[tf])
    prep = {'tf': tf, 'ser': ser, 'blocks': [], 'events': [], 'byBase': {},
            'candles': ser.n, 'baseToHtf': _map_base_to_htf(bars, ser)}
    n = ser.n
    if n < pivot_w * 3 + 10:
        return prep
    sw_hi, sw_lo = swings(ser, pivot_w)
    nb = len(bars.c)

    def prior_swing(lst, i):
        best = None
        for p in lst:
            if p['confirmed'] < i:
                if best is None or p['i'] > best['i']:
                    best = p
            else:
                break
        return best

    i = pivot_w + 1
    while i < n - 3:
        down = ser.c[i] < ser.o[i]
        up = ser.c[i] > ser.o[i]
        if not down and not up:
            i += 1
            continue
        if i + 2 >= n:
            break

        # Filter 2 - displacement: a real gap between candle 1 and candle 3
        fvg = (ser.l[i + 2] - ser.h[i]) if down else (ser.l[i] - ser.h[i + 2])
        if not (fvg > 0):
            i += 1
            continue

        # Filter 1 - structure: a CLOSE past the prior swing, recorded at the
        # exact candle it happened on. Taking the best close over the whole
        # impulse window and stamping the block two candles later is a
        # look-ahead of up to six candles.
        sref = prior_swing(sw_hi if down else sw_lo, i)
        if sref is None:
            i += 1
            continue
        bos = -1
        end = min(n - 1, i + impulse)
        for j in range(i + 1, end + 1):
            if (ser.c[j] > sref['p']) if down else (ser.c[j] < sref['p']):
                bos = j
                break
        if bos < 0:
            i += 1
            continue

        k = i
        for j in range(i, max(0, i - 5), -1):
            if j < 1:
                break
            if (not (ser.c[j] < ser.o[j])) if down else (not (ser.c[j] > ser.o[j])):
                break
            if (ser.l[j] < ser.l[k]) if down else (ser.h[j] > ser.h[k]):
                k = j
        formed = max(bos, i + 2)
        ob = {'kind': 'bullish' if down else 'bearish', 'i': k, 't': ser.t[k],
              'top': ser.h[k], 'bottom': ser.l[k], 'bosAt': sref['p'],
              'bosIdx': bos, 'fvg': fvg, 'formedIdx': formed, 'tf': tf,
              'obIdx': len(prep['blocks']), 'mitigatedIdx': None}

        for j in range(formed + 1, n):
            touched = (ser.l[j] <= ob['top']) if ob['kind'] == 'bullish' else (ser.h[j] >= ob['bottom'])
            if touched:
                ob['mitigatedIdx'] = j
                break

        # the entry is worked on the base chart the moment price steps in
        ob['entryBase'] = None
        fb = ser.endIdx[formed]
        for bi in range(fb + 1, nb):
            in_zone = (bars.l[bi] <= ob['top']) if ob['kind'] == 'bullish' else (bars.h[bi] >= ob['bottom'])
            if not in_zone:
                continue
            d = 1 if ob['kind'] == 'bullish' else -1
            ob['entryBase'] = bi
            prep['events'].append({
                'dir': d, 'tf': tf, 'obIdx': ob['obIdx'], 'htfIdx': formed,
                'baseIdx': bi, 'zoneTop': ob['top'], 'zoneBottom': ob['bottom'],
                'kind': ob['kind'], 'ageDays': (bars.t[bi] - ob['t']) / 86400000.0,
                'fvg': fvg,
                'closedBack': (bars.c[bi] > ob['top']) if d > 0 else (bars.c[bi] < ob['bottom'])})
            break
        prep['blocks'].append(ob)
        i = end + 1

    for e in prep['events']:
        prep['byBase'].setdefault(e['baseIdx'], []).append(e)
    return prep


_CACHE: Dict = {}


def struct_for(bars, kind: str, tf: str, pivot_w: int, impulse: int = 0, key: str = '') -> Dict:
    """Structure is identical for every strategy looking at the same chart,
    so it is built once and shared. The A+ thresholds are genes, applied when
    the event is read - which is what keeps this cache small."""
    ck = '%s|%s|%s|%s|%s|%d' % (key, kind, tf, pivot_w, impulse, len(bars.c))
    hit = _CACHE.get(ck)
    if hit is not None and hit[0] == bars.t[-1]:
        return hit[1]
    prep = prepare_rays(bars, tf, pivot_w) if kind == 'ray' else prepare_blocks(bars, tf, pivot_w, impulse)
    _CACHE[ck] = (bars.t[-1], prep)
    if len(_CACHE) > 48:
        for k in list(_CACHE.keys())[:16]:
            _CACHE.pop(k, None)
    return prep


def clear_cache():
    _CACHE.clear()
