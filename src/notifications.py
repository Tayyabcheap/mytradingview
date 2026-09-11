"""
Notification Dispatcher for MyTradingView
Supports universal Discord Webhook delivery and notification configuration.
"""

import json
import os
import urllib.request
import datetime

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "notifications_config.json")


def get_discord_config():
    """Retrieve saved Discord notification configuration."""
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "discord_webhook_url": "",
        "discord_enabled": False,
        "notify_on_signals": True,
        "notify_on_trades": True,
        "notify_on_auto_be": True,
    }


def save_discord_config(cfg):
    """Save Discord notification configuration."""
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    return cfg


def send_discord_alert(title, description, color=0x2962FF, fields=None, webhook_url=None):
    """
    Send an asynchronous embed message to a Discord webhook channel.
    
    Args:
        title (str): Title of the embed.
        description (str): Markdown description.
        color (int): Hex color integer (e.g., 0x089981 for green, 0xF23645 for red).
        fields (list[dict]|None): Key/value pairs [{"name": "Symbol", "value": "XAUUSD", "inline": True}].
        webhook_url (str|None): Optional explicit URL override.
    """
    if not webhook_url:
        cfg = get_discord_config()
        if not cfg.get("discord_enabled"):
            return False, "Discord notifications are disabled in settings."
        webhook_url = cfg.get("discord_webhook_url", "").strip()

    if not webhook_url or not webhook_url.startswith("https://discord.com/api/webhooks/"):
        return False, "Invalid or unconfigured Discord Webhook URL."

    embed = {
        "title": title,
        "description": description,
        "color": color,
        "fields": fields or [],
        "footer": {
            "text": "MyTradingView Workstation • Automated Sentinel"
        },
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z"
    }

    payload = {
        "username": "MyTradingView Sentinel",
        "avatar_url": "https://img.icons8.com/color/96/bullish.png",
        "embeds": [embed]
    }

    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            webhook_url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "MyTradingView/1.0"
            }
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status in (200, 204):
                return True, "Alert sent successfully to Discord."
            return False, f"Discord returned status {response.status}"
    except Exception as e:
        return False, f"Failed to send to Discord: {str(e)}"
