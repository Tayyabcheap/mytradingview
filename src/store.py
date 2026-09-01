"""
Lightweight persistent store (single JSON file) for app state that must survive
app close / laptop restart / browser-data clear: chart drawings, watchlist, etc.
Stored at data/app_store.json. Chosen over SQLite for robustness on any filesystem
(no file-locking / journal requirements).
"""
import os
import json
import time
import threading

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STORE_PATH = os.path.join(os.path.dirname(BASE_DIR), "data", "app_store.json")
_lock = threading.RLock()


def _load() -> dict:
    try:
        with open(STORE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, ValueError, OSError):
        return {}


def _save(data: dict) -> None:
    os.makedirs(os.path.dirname(STORE_PATH), exist_ok=True)
    tmp = STORE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, STORE_PATH)  # atomic on the same filesystem


def get(kind: str, key: str, default=None):
    with _lock:
        data = _load()
        return data.get(kind, {}).get(key, default)


def put(kind: str, key: str, value) -> None:
    with _lock:
        data = _load()
        data.setdefault(kind, {})[key] = value
        data.setdefault("_meta", {})[f"{kind}:{key}"] = int(time.time())
        _save(data)


def delete(kind: str, key: str) -> None:
    with _lock:
        data = _load()
        if kind in data and key in data[kind]:
            del data[kind][key]
            _save(data)
