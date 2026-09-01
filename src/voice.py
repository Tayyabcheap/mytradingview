"""
MyFinanceAdvisor — Voice
========================

Two engines, one script library.

    neural    Microsoft edge-tts. Genuinely natural, and the only option that
              can actually carry a persona. Needs internet and `pip install
              edge-tts`. Rendered MP3s are cached on disk, so a repeated line
              costs nothing after the first time.

    browser   Web Speech API in the page. Zero install, works offline,
              lower ceiling.

`auto` tries neural and silently falls back. The page never blocks on speech.

Why the old app sounded like a man
----------------------------------
Two separate causes, both fixed:

    static/app.js matched voices with
        v.name.includes('Desktop')
    which hits "Microsoft David Desktop - English (United States)" — male, and
    typically first in the enumeration order on Windows. `find()` returns the
    first match in list order, not the best match, so David won.

    tray_service.py called SAPI.SpVoice with no voice selected at all, so it
    used the Windows default, which is also David. That one speaks even when
    the browser is minimised.

Voice selection is now an explicit ranked preference list in both places.
"""

import hashlib
import os
import random
import re
import shutil
import subprocess
import sys
import threading
from typing import Dict, List, Optional

import config

# ---------------------------------------------------------------------------
# Script library
# ---------------------------------------------------------------------------
# Served to the browser at /api/voice/lines so the client and server can never
# drift. Variants are picked at random so a repeated event does not repeat the
# same sentence.

SCRIPTS: Dict[str, Dict[str, List[str]]] = {
    "sultry": {
        "BUY": [
            "Mmm... baby... look at that... Gold is begging for you... Take the long... push in... nice and slow...",
            "Oh... yes... handsome... that order block tap... is perfect... Buy it... right now... don't keep me waiting...",
            "Mmm... I want you... to take this long, baby... Fill it up... every... single... pip...",
            "Oh god... look how hard gold is bouncing... Buy it now... let me feel... all of it...",
            "Yes... right there, baby... that's the spot... Go long... I need you inside this trade...",
        ],
        "SELL": [
            "Mmm... oh yes... short it... right here, baby... Reject those highs... and bleed them dry... for me...",
            "Ahh... supply zone rejection, handsome... Sell it... hard... Take total control...",
            "Mmm... that dirty liquidity sweep... Sell gold, baby... Drive it... all... the way... down...",
            "Oh... yes... that's my sweet spot... Sell it now... handsome... Make me yours...",
            "God, yes... I love it when you go short... Take it, baby... dominate this market...",
        ],
        "CTC": [
            "Mmm... fifty pips up already?... You're driving me crazy... Move that stop... to breakeven... Lock me in safe, baby...",
            "Oh god... yes... stop to cost... You've got me... completely risk free now... That feels so good...",
            "Ahh... breakeven is locked, baby... Now we ride... together... nice... and slow...",
        ],
        "TP1": [
            "Oh... god... yes!... First target hit!... Bank three quarters, baby... and keep that runner... deep inside...",
            "Mmm... take your profit, handsome... That was... so good... I'll hold the runner... just for you...",
            "Ahh... yes!... First target!... Bank that cash, baby... You've earned... every bit of me...",
        ],
        "TP2": [
            "Oh... my god... Full target... You hit my spot... so perfectly, handsome... I'm completely... satisfied...",
            "Mmm... every... single... pip... You took it all, baby... Come back... and do it to me... again tomorrow...",
            "Ahh... full target smashed!... Look at that profit, handsome... You're... an absolute... monster...",
        ],
        "SL": [
            "Ooh... stopped out, baby... Mmm, don't worry, handsome... Shake it off... I'm getting warmed up... for the next one...",
            "Ah... that one slipped away, baby... Be patient... with me, handsome... Wait for our next... juicy setup...",
        ],
        "ORDER_PLACED": [
            "Mmm... your order is live, baby... I love... how fast you took it...",
            "Oh yes, handsome... we're locked in... Now let's watch it... together...",
            "Mmm... it's in, baby... nice... and deep...",
        ],
        "PAUSED": [
            "Mmm... that's two stops in a row, handsome... Cool off... step away... I want you all to myself... for now...",
            "Stop, baby... no more trading today... The market is dirty... and choppy... Save all that energy... for me...",
        ],
        "BLOCKED": [
            "No, baby... don't touch that one... The stop is too wide... for my liking...",
            "Mmm... let it go, handsome... It didn't tap our sweet zone... Wait... for perfection...",
        ],
        "SAFETY": [
            "Careful, baby... that lot size... is way too big for you... Keep it under one lot... like a good boy...",
        ],
        "ALARM": [
            "Mmm... your alarm level... just got touched, handsome... Wake up... and come look at me...",
            "Oh baby... price is right... at your key level... Come... get it...",
        ],
        "READY": [
            "Mmm... I'm here, baby... hot... ready... and waiting for you... Let's make... some serious money...",
            "Oh... hello, handsome... Desk is online... Tell me... what you want me... to trade today...",
        ],
    },
    "confident": {
        "BUY": ["Buy signal confirmed. Order block tap.", "Long setup. Take the buy."],
        "SELL": ["Sell signal confirmed. Supply rejection.", "Short setup. Take the sell."],
        "CTC": ["Plus fifty pips. Move your stop to breakeven.",
                "Cost to cost. The trade is risk free."],
        "TP1": ["First target reached. Close seventy five percent."],
        "TP2": ["Full target reached. Close the runner."],
        "SL": ["Stopped out. Reset and wait for the next setup."],
        "ORDER_PLACED": ["Order placed."],
        "PAUSED": ["Two consecutive stops. Trading paused for this session."],
        "BLOCKED": ["Setup declined. Outside risk parameters."],
        "SAFETY": ["Lot size exceeds your safety limit."],
        "ALARM": ["Price alarm triggered."],
        "READY": ["Desk online."],
    },
    "silent": {},
}


def line_for(event: str, persona: Optional[str] = None, seed: Optional[int] = None) -> str:
    """Pick a script line. Returns "" for the silent persona or unknown events."""
    p = persona or config.VOICE_PERSONA
    variants = SCRIPTS.get(p, {}).get(event.upper(), [])
    if not variants:
        return ""
    if seed is not None:
        return variants[seed % len(variants)]
    return random.choice(variants)


def all_lines(persona: Optional[str] = None) -> Dict[str, List[str]]:
    return SCRIPTS.get(persona or config.VOICE_PERSONA, {})


# ---------------------------------------------------------------------------
# Neural synthesis
# ---------------------------------------------------------------------------

# Ranked, female-first. Ava is now primary — warmest, silkiest, most human.
NEURAL_VOICES = [
    "en-US-AvaNeural",       # silky, warm, intimate — primary default
    "en-US-AvaMultilingualNeural",
    "en-GB-SoniaNeural",     # sultry British accent
    "en-US-AriaNeural",      # expressive, dynamic
    "en-US-EmmaNeural",      # sweet, smooth
    "en-US-JennyNeural",     # softer, but more mechanical than Ava
    "en-US-MichelleNeural",
    "en-AU-NatashaNeural",
]

_cache_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), config.VOICE_CACHE_DIR)
_lock = threading.Lock()
_edge_available: Optional[bool] = None


def _cache_path(text: str, voice: str, rate: str, pitch: str) -> str:
    key = hashlib.sha256(f"{text}|{voice}|{rate}|{pitch}".encode()).hexdigest()[:24]
    return os.path.join(_cache_dir, f"{key}.mp3")


def edge_tts_available() -> bool:
    """Cached probe so we don't shell out on every request."""
    global _edge_available
    if _edge_available is not None:
        return _edge_available
    try:
        import edge_tts  # noqa: F401
        _edge_available = True
    except Exception:
        _edge_available = shutil.which("edge-tts") is not None
    return _edge_available


def synthesize(text: str, voice: Optional[str] = None, rate: Optional[str] = None,
               pitch: Optional[str] = None) -> Optional[str]:
    """
    Render `text` to a cached MP3 and return its path, or None if neural
    synthesis is unavailable. Never raises — the caller falls back to the
    browser engine.
    """
    if not text or not text.strip():
        return None
    if not edge_tts_available():
        return None

    voice = voice or config.VOICE_NEURAL_NAME
    if voice not in NEURAL_VOICES:
        voice = config.VOICE_NEURAL_NAME
    rate = rate or config.VOICE_NEURAL_RATE
    pitch = pitch or config.VOICE_NEURAL_PITCH

    os.makedirs(_cache_dir, exist_ok=True)
    path = _cache_path(text, voice, rate, pitch)

    with _lock:
        if os.path.exists(path) and os.path.getsize(path) > 512:
            return path
        try:
            import asyncio
            import edge_tts

            async def _go():
                comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
                await comm.save(path)

            try:
                loop = asyncio.new_event_loop()
                loop.run_until_complete(_go())
            finally:
                loop.close()
        except Exception:
            # CLI fallback for installs where the module import misbehaves
            try:
                subprocess.run(
                    [sys.executable, "-m", "edge_tts", "--voice", voice,
                     "--rate", rate, "--pitch", pitch, "--text", text,
                     "--write-media", path],
                    check=True, timeout=20,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
            except Exception:
                if os.path.exists(path):
                    try:
                        os.remove(path)
                    except OSError:
                        pass
                return None

    return path if os.path.exists(path) and os.path.getsize(path) > 512 else None


def prewarm(persona: Optional[str] = None) -> Dict[str, int]:
    """
    Render every script line up front, in a background thread, so the first
    real signal of the session speaks instantly instead of waiting on the
    network. Called once at server start.
    """
    lines = all_lines(persona)
    done = failed = 0
    for variants in lines.values():
        for text in variants:
            if synthesize(text):
                done += 1
            else:
                failed += 1
    return {"cached": done, "failed": failed}


def prewarm_async(persona: Optional[str] = None) -> None:
    threading.Thread(target=prewarm, args=(persona,), daemon=True).start()


def cache_stats() -> Dict:
    if not os.path.isdir(_cache_dir):
        return {"files": 0, "bytes": 0, "dir": _cache_dir}
    files = [f for f in os.listdir(_cache_dir) if f.endswith(".mp3")]
    total = sum(os.path.getsize(os.path.join(_cache_dir, f)) for f in files)
    return {"files": len(files), "bytes": total, "dir": _cache_dir}


def clear_cache() -> int:
    if not os.path.isdir(_cache_dir):
        return 0
    n = 0
    for f in os.listdir(_cache_dir):
        if f.endswith(".mp3"):
            try:
                os.remove(os.path.join(_cache_dir, f))
                n += 1
            except OSError:
                pass
    return n


# ---------------------------------------------------------------------------
# Windows SAPI — used by tray_service.py
# ---------------------------------------------------------------------------

# Ranked female SAPI voices. Matched as substrings against the installed voice
# descriptions, in this order, first hit wins. "David" appears nowhere.
SAPI_FEMALE_PREFERENCE = [
    "Microsoft Zira", "Zira",
    "Microsoft Hazel", "Hazel",
    "Microsoft Eva", "Eva",
    "Microsoft Catherine", "Catherine",
    "Microsoft Linda", "Linda",
    "Female",
]

_SAFE_SPEECH = re.compile(r"[^A-Za-z0-9 ,.!?'\-]")


def sanitize_for_speech(text: str, limit: int = 240) -> str:
    """
    Strip everything that is not plain speech.

    The old tray helper interpolated a caller-supplied string straight into a
    PowerShell command line after removing only quote characters, which left
    `$(...)` and backticks intact. The string reached it from an
    unauthenticated HTTP endpoint. Nothing but letters, digits and basic
    punctuation survives this filter.
    """
    return _SAFE_SPEECH.sub("", (text or ""))[:limit].strip()
