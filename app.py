"""
app.py — netorch Web UI
Flask application serving the UI and proxying API calls to netorch.

Design decisions:
- All routes that touch netorch data are prefixed /api/
- The UI HTML pages are served by Jinja2 templates (no SPA framework)
- SSE streams are at /api/stream/jobs/<job_id>
- Auth token for netorch is injected server-side; browser never sees it
- No Flask sessions, no cookies — stateless proxy
"""
from __future__ import annotations

import json
import logging
import os
import sys

from flask import (
    Flask,
    Response,
    jsonify,
    render_template,
    request,
    stream_with_context,
)

import netorch_client as nc
from config import cfg

# ─── App setup ────────────────────────────────────────────────────────────────

app = Flask(
    __name__,
    template_folder="templates",
    static_folder="static",
    static_url_path="/static",
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
log = logging.getLogger(__name__)


# ─── UI page routes ────────────────────────────────────────────────────────────
# Each route renders the base shell; JS then activates the correct view section.

@app.route("/")
def index():
    return render_template("base.html")


@app.route("/inventory")
def inventory():
    return render_template("base.html", initial_view="inventory")


@app.route("/hosts")
def hosts():
    return render_template("base.html", initial_view="hosts")


@app.route("/jobs")
def jobs():
    return render_template("base.html", initial_view="jobs")


@app.route("/jobs/<job_id>")
def job_detail_page(job_id: str):
    return render_template("base.html", initial_view="jobdetail", job_id=job_id)


@app.route("/jobs/new")
def new_job():
    return render_template("base.html", initial_view="newjob")


@app.route("/runbooks")
def runbooks_page():
    return render_template("base.html", initial_view="runbooks")


@app.route("/workflows")
def workflows_page():
    return render_template("base.html", initial_view="workflows")


@app.route("/discovery")
def discovery_page():
    return render_template("base.html", initial_view="discovery")


# ─── API proxy: Discovery ─────────────────────────────────────────────────────

@app.route("/api/discovery/devices")
def api_discovery_devices():
    data, status = nc.get_discovery_devices()
    return jsonify(data), status


# ─── API proxy: Health ────────────────────────────────────────────────────────

@app.route("/api/health")
def api_health():
    data, status = nc.health()
    return jsonify(data), status


# ─── API proxy: Inventory ─────────────────────────────────────────────────────

@app.route("/api/inventory/sources")
def api_inventory_sources():
    data, status = nc.inventory_sources()
    return jsonify(data), status


@app.route("/api/inventory/sources/<filename>", methods=["GET"])
def api_inventory_source_get(filename: str):
    data, status = nc.inventory_source_content(filename)
    return jsonify(data), status


@app.route("/api/inventory/sources/<filename>", methods=["PUT"])
def api_inventory_source_put(filename: str):
    body = request.get_json(silent=True) or {}
    data, status = nc.inventory_source_save(filename, body.get("content", ""))
    return jsonify(data), status


@app.route("/api/inventory/sources", methods=["POST"])
def api_inventory_source_post():
    body = request.get_json(silent=True) or {}
    data, status = nc.inventory_source_upload(
        body.get("filename", ""),
        body.get("content", ""),
    )
    return jsonify(data), status


@app.route("/api/inventory/sources/<filename>", methods=["DELETE"])
def api_inventory_source_delete(filename: str):
    data, status = nc.inventory_source_delete(filename)
    return jsonify(data), status


@app.route("/api/inventory/reload", methods=["POST"])
def api_inventory_reload():
    data, status = nc.inventory_reload()
    return jsonify(data), status


@app.route("/api/inventory/groups")
def api_inventory_groups():
    data, status = nc.inventory_groups()
    return jsonify(data), status


# ─── API proxy: Hosts — paginated ─────────────────────────────────────────────

@app.route("/api/hosts")
def api_hosts():
    """
    Paginated host list.  Query params:
      offset   int   default 0
      limit    int   default 100  (max 500 enforced server-side)
      search   str   substring match on host/IP
      platform str   filter by platform
      group    str   filter by group name
    """
    offset   = int(request.args.get("offset",   0))
    limit    = min(int(request.args.get("limit", 100)), 500)
    search   = request.args.get("search",   "")
    platform = request.args.get("platform", "")
    group    = request.args.get("group",    "")

    data, status = nc.hosts_page(
        offset=offset,
        limit=limit,
        search=search,
        platform=platform,
        group=group,
    )
    return jsonify(data), status


# ─── API proxy: Jobs ──────────────────────────────────────────────────────────

@app.route("/api/jobs")
def api_jobs_list():
    status_filter = request.args.get("status", "")
    limit  = min(int(request.args.get("limit",  50)),  200)
    offset = int(request.args.get("offset", 0))
    data, status = nc.jobs_list(
        status=status_filter, limit=limit, offset=offset
    )
    return jsonify(data), status


@app.route("/api/jobs", methods=["POST"])
def api_job_submit():
    payload = request.get_json(silent=True) or {}
    data, status = nc.job_submit(payload)
    return jsonify(data), status


@app.route("/api/jobs/<job_id>")
def api_job_get(job_id: str):
    data, status = nc.job_get(job_id)
    return jsonify(data), status


@app.route("/api/jobs/<job_id>/detail")
def api_job_detail(job_id: str):
    data, status = nc.job_detail(job_id)
    return jsonify(data), status


@app.route("/api/jobs/<job_id>", methods=["DELETE"])
def api_job_cancel(job_id: str):
    data, status = nc.job_cancel(job_id)
    return jsonify(data), status


@app.route("/api/jobs/<job_id>/log")
def api_job_log(job_id: str):
    text, status = nc.job_log_raw(job_id)
    if status != 200:
        return jsonify({"error": text}), status
    return Response(
        text,
        status=200,
        mimetype="text/plain",
        headers={
            "Content-Disposition": f'attachment; filename="netorch-{job_id}.log"'
        },
    )


# ─── API proxy: Runbooks ──────────────────────────────────────────────────────

@app.route("/api/runbooks")
def api_runbooks_list():
    data, status = nc.runbooks_list()
    return jsonify(data), status


@app.route("/api/runbooks/<name>")
def api_runbook_get(name: str):
    data, status = nc.runbook_get(name)
    return jsonify(data), status


@app.route("/api/runbooks", methods=["POST"])
def api_runbook_create():
    body = request.get_json(silent=True) or {}
    data, status = nc.runbook_create(body.get("filename", ""), body.get("content", ""))
    return jsonify(data), status


@app.route("/api/runbooks/<name>", methods=["PUT"])
def api_runbook_put(name: str):
    body = request.get_json(silent=True) or {}
    data, status = nc.runbook_save(name, body.get("content", ""))
    return jsonify(data), status


@app.route("/api/runbooks/<name>", methods=["DELETE"])
def api_runbook_delete(name: str):
    data, status = nc.runbook_delete(name)
    return jsonify(data), status


@app.route("/api/runbooks/<name>/run", methods=["POST"])
def api_runbook_run(name: str):
    payload = request.get_json(silent=True) or {}
    data, status = nc.runbook_run(name, payload)
    return jsonify(data), status


# ─── API proxy: Workflows ─────────────────────────────────────────────────────

@app.route("/api/workflows")
def api_workflows_list():
    data, status = nc.workflows_list()
    return jsonify(data), status


@app.route("/api/workflows", methods=["POST"])
def api_workflow_create():
    body = request.get_json(silent=True) or {}
    data, status = nc.workflow_create(body.get("filename", ""), body.get("content", ""))
    return jsonify(data), status


@app.route("/api/workflows/<name>")
def api_workflow_get(name: str):
    data, status = nc.workflow_get(name)
    return jsonify(data), status


@app.route("/api/workflows/<name>", methods=["PUT"])
def api_workflow_put(name: str):
    body = request.get_json(silent=True) or {}
    data, status = nc.workflow_save(name, body.get("content", ""))
    return jsonify(data), status


@app.route("/api/workflows/<name>", methods=["DELETE"])
def api_workflow_delete(name: str):
    data, status = nc.workflow_delete(name)
    return jsonify(data), status


@app.route("/api/workflows/<name>/run", methods=["POST"])
def api_workflow_run(name: str):
    payload = request.get_json(silent=True) or {}
    data, status = nc.workflow_run(name, payload)
    return jsonify(data), status


@app.route("/api/workflows/<name>/log/<job_id>")
def api_workflow_log_all(name: str, job_id: str):
    since_id = request.args.get("since_id", 0, type=int)
    data, status = nc.workflow_log_all(name, job_id, since_id)
    return jsonify(data), status


@app.route("/api/workflows/<name>/log/<job_id>/<host>")
def api_workflow_log_device(name: str, job_id: str, host: str):
    since_id = request.args.get("since_id", 0, type=int)
    data, status = nc.workflow_log_device(name, job_id, host, since_id)
    return jsonify(data), status


@app.route("/api/workflows/<name>/steps/<job_id>")
def api_workflow_steps(name: str, job_id: str):
    data, status = nc.workflow_steps(name, job_id)
    return jsonify(data), status


# ─── SSE: live job stream ──────────────────────────────────────────────────────

@app.route("/api/stream/jobs/<job_id>")
def api_stream_job(job_id: str):
    """
    Server-Sent Events endpoint.  The browser connects once and receives
    push updates every ~2 seconds until the job terminates.

    Under gunicorn+gevent the generator runs as a non-blocking greenlet —
    it does NOT consume a worker thread for each open connection.
    """
    def generate():
        yield "retry: 3000\n\n"   # tell browser to reconnect after 3s if dropped
        yield from nc.stream_job_events(job_id)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable nginx buffering if behind proxy
        },
    )


# ─── Error handlers ───────────────────────────────────────────────────────────

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "not found"}), 404


@app.errorhandler(500)
def server_error(e):
    log.exception("Internal error")
    return jsonify({"error": "internal server error"}), 500


# ─── Dev entrypoint ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(
        host=cfg.ui.host,
        port=cfg.ui.port,
        debug=cfg.ui.debug,
    )
