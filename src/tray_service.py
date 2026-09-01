"""
MyFinanceAdvisor — Windows tray ticker
=======================================

Three fixes from the previous version:

  VOICE.  It called SAPI.SpVoice with no voice selected, so it used the Windows
          default — Microsoft David on a stock install. That is one of the two
          places the man's voice came from; the other was the browser client.
          A ranked female preference list is applied here, and male voices are
          excluded by name.

  SHUTDOWN.  Exit ran `Stop-Process -Name python,pythonw -Force`, terminating
          every Python process on the machine. It now stops only itself.

  NOTIFICATIONS.  `start_blinking` was wrapped in `if not self.is_blinking`, so
          the second and every later alarm produced no balloon at all until the
          user manually clicked "Stop blinking". Each alert now notifies, and
          the blink self-clears.
"""

import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

from PIL import Image, ImageDraw
import pystray

PORT = 5000
BASE = f"http://127.0.0.1:{PORT}"
POLL_SEC = 3.0
BLINK_TIMEOUT_SEC = 90

# Ranked, female only. "David" and the other male voices appear nowhere.
FEMALE_VOICES = ["Zira", "Hazel", "Eva", "Catherine", "Linda", "Susan", "Female"]
MALE_VOICES = re.compile(r"david|mark|george|james|richard|sean|male\b", re.I)

_SAFE = re.compile(r"[^A-Za-z0-9 ,.!?'\-]")


def sanitize(text: str, limit: int = 240) -> str:
    """
    Strip anything that is not plain speech before it can reach a shell.

    The old helper removed only quote characters and then interpolated the
    result straight into a PowerShell command line, leaving `$(...)` and
    backticks intact — and the string arrived from an HTTP endpoint.
    """
    return _SAFE.sub("", text or "")[:limit].strip()


# ---------------------------------------------------------------------------
# Icon
# ---------------------------------------------------------------------------

def make_icon(alert: bool = False) -> Image.Image:
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([4, 4, 60, 60], fill="#fbbf24", outline="#d99a00", width=3)
    d.ellipse([10, 10, 54, 54], fill="#f5c344", outline="#c08327", width=2)
    d.polygon([(34, 14), (24, 32), (32, 32), (28, 50), (42, 28), (34, 28)], fill="#0d1017")
    if alert:
        d.ellipse([34, 2, 62, 30], fill="#22d98a", outline="#ffffff", width=2)
        d.ellipse([42, 10, 54, 22], fill="#ffffff")
    return img


ICON_IDLE = make_icon(False)
ICON_ALERT = make_icon(True)


# ---------------------------------------------------------------------------
# Speech
# ---------------------------------------------------------------------------

_voice_token = None
_voice_resolved = False


def _resolve_voice(speaker):
    """Pick the best available female SAPI voice, once."""
    global _voice_token, _voice_resolved
    if _voice_resolved:
        return _voice_token
    _voice_resolved = True
    try:
        available = list(speaker.GetVoices())
        best, best_rank = None, len(FEMALE_VOICES)
        for v in available:
            desc = v.GetDescription()
            if MALE_VOICES.search(desc):
                continue
            for i, name in enumerate(FEMALE_VOICES):
                if name.lower() in desc.lower() and i < best_rank:
                    best, best_rank = v, i
        _voice_token = best
    except Exception:
        _voice_token = None
    return _voice_token


def speak(phrase: str) -> None:
    text = sanitize(phrase)
    if not text:
        return

    def run():
        try:
            import win32com.client
            speaker = win32com.client.Dispatch("SAPI.SpVoice")
            v = _resolve_voice(speaker)
            if v is not None:
                speaker.Voice = v
            speaker.Rate = -1          # a little slower than default
            speaker.Speak(text)
            return
        except Exception:
            pass
        try:
            # PowerShell fallback. `text` has already been stripped to
            # letters, digits and basic punctuation, so it cannot break out.
            ps = (
                "$s = New-Object -ComObject SAPI.SpVoice; "
                "$v = $s.GetVoices() | Where-Object { "
                "  $_.GetDescription() -match 'Zira|Hazel|Eva|Catherine' } | Select-Object -First 1; "
                "if ($v) { $s.Voice = $v }; "
                f"$s.Rate = -1; $s.Speak('{text}')"
            )
            subprocess.Popen(["powershell", "-WindowStyle", "Hidden", "-Command", ps],
                             creationflags=0x08000000)
        except Exception:
            pass

    threading.Thread(target=run, daemon=True).start()


# ---------------------------------------------------------------------------

class Tray:
    def __init__(self):
        self.icon = None
        self.running = True
        self.alerting = False
        self.alert_since = 0.0
        self.price = None
        self.bias = "—"

    # -- menu actions -------------------------------------------------------

    def open_dashboard(self, icon=None, item=None):
        self.clear_alert()
        webbrowser.open(BASE + "/")

    def open_desk(self, icon=None, item=None):
        self.clear_alert()
        webbrowser.open(BASE + "/desk")

    def test_voice(self, icon=None, item=None):
        self.raise_alert("Test alert from the desk")
        speak("Mmm. I'm here, baby. Let's make some money.")

    def clear_alert(self, icon=None, item=None):
        self.alerting = False
        if self.icon:
            self.icon.icon = ICON_IDLE

    def quit(self, icon=None, item=None):
        """Stops this tray process. Nothing else."""
        self.running = False
        self.alerting = False
        if self.icon:
            self.icon.stop()
        sys.exit(0)

    # -- alerts -------------------------------------------------------------

    def raise_alert(self, message: str) -> None:
        # Every alert notifies. The old guard (`if not self.is_blinking`)
        # swallowed the second and all later alerts.
        self.alerting = True
        self.alert_since = time.time()
        if self.icon:
            try:
                self.icon.notify(f"{message}\nClick to open the chart.", "MyFinanceAdvisor")
            except Exception:
                pass

    def blink_loop(self):
        on = False
        while self.running:
            if self.alerting:
                if time.time() - self.alert_since > BLINK_TIMEOUT_SEC:
                    self.clear_alert()          # self-clearing, was manual only
                elif self.icon:
                    self.icon.icon = ICON_ALERT if on else ICON_IDLE
                    on = not on
                time.sleep(0.45)
            else:
                time.sleep(0.6)

    # -- polling ------------------------------------------------------------

    def _get(self, path, timeout=2.5):
        req = urllib.request.Request(BASE + path, headers={"User-Agent": "MFATray"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))

    def poll_loop(self):
        while self.running:
            try:
                s = self._get("/api/status")
                if s.get("connected"):
                    self.price = s.get("bid")
                    b = (s.get("bias") or {}).get("bias", "RANGE_BOUND")
                    self.bias = {"STRONG_BULLISH": "Bullish",
                                 "STRONG_BEARISH": "Bearish"}.get(b, "Range")
                    if self.icon:
                        self.icon.title = (f"XAUUSD {self.price:.2f} · {self.bias}\n"
                                           f"MyFinanceAdvisor")
                elif self.icon:
                    self.icon.title = "MyFinanceAdvisor — MetaTrader 5 offline"

                for a in self._get("/api/notify_tray").get("alerts", []):
                    msg = sanitize(a.get("message", ""), 300)
                    if msg:
                        self.raise_alert(msg)
                    spoken = sanitize(a.get("voice", ""))
                    if spoken:
                        speak(spoken)

            except Exception:
                if self.icon:
                    self.icon.title = "MyFinanceAdvisor — desk not running"
            time.sleep(POLL_SEC)

    # -- run ----------------------------------------------------------------

    def run(self):
        self.icon = pystray.Icon(
            "MyFinanceAdvisor", ICON_IDLE, "MyFinanceAdvisor",
            pystray.Menu(
                pystray.MenuItem("Open chart", self.open_dashboard, default=True),
                pystray.MenuItem("Open trade desk", self.open_desk),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Test voice and alert", self.test_voice),
                pystray.MenuItem("Clear alert", self.clear_alert),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Exit tray icon", self.quit),
            ))
        threading.Thread(target=self.poll_loop, daemon=True).start()
        threading.Thread(target=self.blink_loop, daemon=True).start()
        self.icon.run()


if __name__ == "__main__":
    Tray().run()
