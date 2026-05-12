"""
netorch_client.py — Proxy layer between the UI and the netorch API.

All HTTP calls to port 64321 go through here.  Responses that are safe to
cache (inventory, hosts, groups) are stored in a TTLCache so that 50 browser
tabs hitting the UI simultaneously issue at most one upstream request per TTL
window — keeping the relay server load flat regardless of connected users.

Write/mutating calls (POST, PUT, DELETE) are never cached and always bypass
the cache, then invalidate the relevant cached entries.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any, Generator

import requests
from cachetools import TTLCache
from requests.exceptions import RequestException

from config import cfg

log = logging.getLogger(__name__)

# ─── Cache instances ──────────────────────────────────────────────────────────
# Separate caches per data type so TTLs can be tuned independently and
# invalidation can be surgical (only clear what changed).

_inv_cache   = TTLCache(maxsize=16,                  ttl=cfg.cache.inventory_ttl)
_hosts_cache = TTLCache(maxsize=cfg.cache.max_entries, ttl=cfg.cache.hosts_ttl)
_group_cache = TTLCache(maxsize=16,                  ttl=cfg.cache.groups_ttl)


# ─── Internal helpers ────────────────────────────────────────────────────────

def _url(path: str) -> str:
    """Build full netorch API URL."""
    return f"{cfg.netorch.api_url}{path}"


def _get(path: str, params: dict | None = None) -> tuple[Any, int]:
    """
    Perform a GET against the netorch API.
    Returns (parsed_json, status_code).
    On network error returns ({"error": "..."}, 502).
    """
    try:
        r = requests.get(
            _url(path),
            headers=cfg.netorch.headers,
            params=params,
            timeout=cfg.netorch.request_timeout,
        )
        return r.json(), r.status_code
    except RequestException as e:
        log.error("netorch GET %s failed: %s", path, e)
        return {"error": str(e)}, 502


def _post(path: str, body: dict | None = None) -> tuple[Any, int]:
    try:
        r = requests.post(
            _url(path),
            headers=cfg.netorch.headers,
            json=body or {},
            timeout=cfg.netorch.request_timeout,
        )
        return r.json(), r.status_code
    except RequestException as e:
        log.error("netorch POST %s failed: %s", path, e)
        return {"error": str(e)}, 502


def _put(path: str, body: dict | None = None) -> tuple[Any, int]:
    try:
        r = requests.put(
            _url(path),
            headers=cfg.netorch.headers,
            json=body or {},
            timeout=cfg.netorch.request_timeout,
        )
        return r.json(), r.status_code
    except RequestException as e:
        log.error("netorch PUT %s failed: %s", path, e)
        return {"error": str(e)}, 502


def _delete(path: str) -> tuple[Any, int]:
    try:
        r = requests.delete(
            _url(path),
            headers=cfg.netorch.headers,
            timeout=cfg.netorch.request_timeout,
        )
        return r.json(), r.status_code
    except RequestException as e:
        log.error("netorch DELETE %s failed: %s", path, e)
        return {"error": str(e)}, 502


# ─── Health ───────────────────────────────────────────────────────────────────

def health() -> tuple[Any, int]:
    return _get("/health")


# ─── Inventory ───────────────────────────────────────────────────────────────

def inventory_sources() -> tuple[Any, int]:
    """List all inventory source files with host/group counts. Cached."""
    key = "sources"
    if key not in _inv_cache:
        data, status = _get("/inventory/sources")
        if status == 200:
            _inv_cache[key] = (data, status)
        return data, status
    return _inv_cache[key]


def inventory_source_content(filename: str) -> tuple[Any, int]:
    """Return the raw text content of a single inventory file."""
    return _get(f"/inventory/sources/{filename}")


def inventory_source_save(filename: str, content: str) -> tuple[Any, int]:
    """Create or overwrite an inventory file. Invalidates sources cache."""
    data, status = _put(
        f"/inventory/sources/{filename}",
        {"content": content},
    )
    if status in (200, 201):
        _inv_cache.clear()
    return data, status


def inventory_source_upload(filename: str, content: str) -> tuple[Any, int]:
    """Upload a new inventory file. Invalidates sources cache."""
    data, status = _post(
        "/inventory/sources",
        {"filename": filename, "content": content},
    )
    if status in (200, 201):
        _inv_cache.clear()
    return data, status


def inventory_source_delete(filename: str) -> tuple[Any, int]:
    """Delete an inventory file. Invalidates sources cache."""
    data, status = _delete(f"/inventory/sources/{filename}")
    if status == 200:
        _inv_cache.clear()
    return data, status


def inventory_reload() -> tuple[Any, int]:
    """Reload all inventory files from disk (POST /inventory/reload)."""
    data, status = _post("/inventory/reload")
    if status == 200:
        _inv_cache.clear()
        _hosts_cache.clear()
        _group_cache.clear()
    return data, status


def inventory_hosts() -> tuple[Any, int]:
    """Return flat host list (no pagination — used for group population)."""
    return _get("/inventory/hosts")


def inventory_groups() -> tuple[Any, int]:
    """Return group list. Cached."""
    key = "groups"
    if key not in _group_cache:
        data, status = _get("/inventory/groups")
        if status == 200:
            _group_cache[key] = (data, status)
        return data, status
    return _group_cache[key]


# ─── Hosts — paginated ───────────────────────────────────────────────────────

def hosts_page(
    *,
    offset: int = 0,
    limit: int = 100,
    search: str = "",
    platform: str = "",
    group: str = "",
) -> tuple[Any, int]:
    """
    Fetch one page of hosts from netorch, with optional server-side
    search/filter.  Results are cached per unique (offset, limit, search,
    platform, group) combination.

    With 50 000 hosts, pagination is critical — never pull the full list.
    """
    cache_key = f"hosts:{offset}:{limit}:{search}:{platform}:{group}"
    if cache_key not in _hosts_cache:
        params: dict[str, Any] = {"offset": offset, "limit": limit}
        if search:   params["search"]   = search
        if platform: params["platform"] = platform
        if group:    params["group"]    = group
        data, status = _get("/inventory/hosts", params=params)
        if status == 200:
            _hosts_cache[cache_key] = (data, status)
        return data, status
    return _hosts_cache[cache_key]


# ─── Jobs ─────────────────────────────────────────────────────────────────────

def jobs_list(
    *,
    status: str = "",
    limit: int = 50,
    offset: int = 0,
) -> tuple[Any, int]:
    """List jobs — NOT cached (jobs change rapidly)."""
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    if status:
        params["status"] = status
    return _get("/jobs", params=params)


def job_get(job_id: str) -> tuple[Any, int]:
    """Get a single job's status."""
    return _get(f"/jobs/{job_id}")


def job_detail(job_id: str) -> tuple[Any, int]:
    """Get per-device results for a job."""
    return _get(f"/jobs/{job_id}/detail")


def job_submit(payload: dict) -> tuple[Any, int]:
    """Submit a new job."""
    return _post("/jobs", payload)


def job_cancel(job_id: str) -> tuple[Any, int]:
    """Cancel (DELETE) a running job."""
    return _delete(f"/jobs/{job_id}")


def job_log_raw(job_id: str) -> tuple[Any, int]:
    """Download raw log text for a job."""
    try:
        r = requests.get(
            _url(f"/logs/{job_id}/raw"),
            headers=cfg.netorch.headers,
            timeout=cfg.netorch.request_timeout,
        )
        return r.text, r.status_code
    except RequestException as e:
        log.error("netorch GET /logs/%s/raw failed: %s", job_id, e)
        return str(e), 502


# ─── SSE job stream ───────────────────────────────────────────────────────────

TERMINAL_STATUSES = {"completed", "failed", "partial_failure", "cancelled"}


def stream_job_events(job_id: str) -> Generator[str, None, None]:
    """
    Generator that yields Server-Sent Event strings for a job.

    Polls GET /jobs/{id}/detail every 2 seconds and pushes a JSON event
    to the browser.  Stops when the job reaches a terminal status or after
    stream_timeout seconds.

    This runs inside a gevent greenlet — the blocking requests.get() call
    is automatically patched to be non-blocking by gunicorn+gevent, so it
    will NOT block other requests.
    """
    deadline = time.monotonic() + cfg.netorch.stream_timeout
    last_payload: str = ""

    while time.monotonic() < deadline:
        try:
            data, status = job_detail(job_id)

            if status != 200:
                yield f"event: error\ndata: {json.dumps({'error': data})}\n\n"
                break

            payload = json.dumps(data)

            # Only push if something changed (avoid redundant browser redraws)
            if payload != last_payload:
                yield f"data: {payload}\n\n"
                last_payload = payload

            job_status = data.get("status", "")
            if job_status in TERMINAL_STATUSES:
                yield "event: done\ndata: {}\n\n"
                break

        except Exception as e:
            log.error("SSE stream error for job %s: %s", job_id, e)
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
            break

        time.sleep(2)
    else:
        yield "event: timeout\ndata: {}\n\n"


# ─── Runbooks ─────────────────────────────────────────────────────────────────

def runbooks_list() -> tuple:
    return _get("/runbooks")


def runbook_get(name: str) -> tuple:
    return _get(f"/runbooks/{name}")


def runbook_run(name: str, payload: dict) -> tuple:
    return _post(f"/runbooks/{name}/run", payload)


def runbook_save(name: str, content: str) -> tuple:
    return _put(f"/runbooks/{name}", {"content": content})


def runbook_create(filename: str, content: str) -> tuple:
    return _post("/runbooks", {"filename": filename, "content": content})


# ─── Workflows ────────────────────────────────────────────────────────────────

def workflows_list() -> tuple:
    return _get("/workflows")


def workflow_create(filename: str, content: str) -> tuple:
    return _post("/workflows", {"filename": filename, "content": content})


def workflow_save(name: str, content: str) -> tuple:
    return _put(f"/workflows/{name}", {"content": content})


def workflow_get(name: str) -> tuple:
    return _get(f"/workflows/{name}")


def workflow_run(name: str, payload: dict) -> tuple:
    return _post(f"/workflows/{name}/run", payload)


def workflow_log_all(name: str, job_id: str, since_id: int = 0) -> tuple:
    return _get(f"/workflows/{name}/log/{job_id}", params={"since_id": since_id})


def workflow_log_device(name: str, job_id: str, host: str, since_id: int = 0) -> tuple:
    return _get(f"/workflows/{name}/log/{job_id}/{host}", params={"since_id": since_id})
