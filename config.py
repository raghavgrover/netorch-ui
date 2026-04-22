"""
config.py — Loads netorch-ui.toml and exposes a typed Config object.

Search order for config file:
  1. NETORCH_UI_CONFIG environment variable
  2. /opt/netorch-ui/netorch-ui.toml  (production)
  3. ./netorch-ui.toml                 (development / current directory)
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import toml


def _find_config() -> Path:
    env = os.environ.get("NETORCH_UI_CONFIG")
    if env:
        p = Path(env)
        if p.exists():
            return p
        sys.exit(f"[config] NETORCH_UI_CONFIG set but file not found: {env}")

    candidates = [
        Path("/opt/netorch-ui/netorch-ui.toml"),
        Path("netorch-ui.toml"),
    ]
    for c in candidates:
        if c.exists():
            return c

    sys.exit(
        "[config] No config file found. "
        "Copy netorch-ui.toml to /opt/netorch-ui/ or set NETORCH_UI_CONFIG."
    )


def _load() -> dict:
    path = _find_config()
    try:
        return toml.load(str(path))
    except Exception as e:
        sys.exit(f"[config] Failed to parse {path}: {e}")


_raw = _load()


class _UI:
    port:     int  = _raw["ui"]["port"]
    host:     str  = _raw["ui"]["host"]
    workers:  int  = _raw["ui"]["workers"]
    debug:    bool = _raw["ui"]["debug"]


class _Netorch:
    api_url:         str = _raw["netorch"]["api_url"]
    auth_token:      str = _raw["netorch"]["auth_token"]
    request_timeout: int = _raw["netorch"]["request_timeout"]
    stream_timeout:  int = _raw["netorch"]["stream_timeout"]

    @property
    def headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.auth_token}",
            "Content-Type": "application/json",
        }


class _Cache:
    inventory_ttl: int = _raw["cache"]["inventory_ttl"]
    hosts_ttl:     int = _raw["cache"]["hosts_ttl"]
    groups_ttl:    int = _raw["cache"]["groups_ttl"]
    max_entries:   int = _raw["cache"]["max_entries"]


class Config:
    ui      = _UI()
    netorch = _Netorch()
    cache   = _Cache()


cfg = Config()
