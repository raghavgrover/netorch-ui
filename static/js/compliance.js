/**
 * compliance.js — Vulnerability scan management view.
 *
 * Views:
 *   - Scan list: table of all scans with finding severity pills
 *   - New Scan modal: enter devices/groups, submit
 *   - Results modal: per-device accordion with advisories table, CSV export
 *
 * Data flow: all API calls go to /api/compliance/* which proxies to netorch.
 */
'use strict';

const Compliance = (() => {
    // ── State ──────────────────────────────────────────────────────────────
    let _scans         = [];
    let _currentScanId = null;
    let _devices       = [];   // chip-select state for new scan modal

    // ── Helpers ─────────────────────────────────────────────────────────────

    function _sevBadge(sev) {
        const cls = {
            'Critical':      'sev-critical',
            'High':          'sev-high',
            'Medium':        'sev-medium',
            'Low':           'sev-low',
            'Informational': 'sev-informational',
        }[sev] || 'sev-unknown';
        return `<span class="sev-badge ${cls}">${Utils.esc(sev || 'Unknown')}</span>`;
    }

    function _statusBadge(status) {
        const map = {
            queued:          'badge-pending',
            running:         'badge-running',
            completed:       'badge-success',
            partial_failure: 'badge-warning',
            failed:          'badge-error',
            cancelled:       'badge-error',
        };
        return `<span class="badge ${map[status] || 'badge-pending'}">${Utils.esc(status)}</span>`;
    }

    function _findingPills(scan) {
        const parts = [];
        if (scan.critical_count > 0)
            parts.push(`<span class="finding-pill pill-critical">${scan.critical_count} Critical</span>`);
        if (scan.high_count > 0)
            parts.push(`<span class="finding-pill pill-high">${scan.high_count} High</span>`);
        if (scan.medium_count > 0)
            parts.push(`<span class="finding-pill pill-medium">${scan.medium_count} Medium</span>`);
        if (scan.low_count > 0)
            parts.push(`<span class="finding-pill pill-low">${scan.low_count} Low</span>`);
        if (scan.informational_count > 0)
            parts.push(`<span class="finding-pill pill-informational">${scan.informational_count} Info</span>`);
        if (!parts.length)
            parts.push('<span style="color:var(--text-secondary);font-size:12px;">No findings</span>');
        return `<div class="scan-finding-pills">${parts.join('')}</div>`;
    }

    // ── View activation ──────────────────────────────────────────────────────

    function onActivate() {
        document.getElementById('page-title').textContent    = 'Compliance';
        document.getElementById('page-subtitle').textContent = 'Vulnerability Scanning — Cisco PSIRT';
        refresh();
    }

    // ── Scan list ────────────────────────────────────────────────────────────

    async function refresh() {
        const body = document.getElementById('comp-scans-body');
        body.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="padding:24px 0;"><div class="empty-state-sub">Loading…</div></div></td></tr>`;

        try {
            const resp = await API.get('/api/compliance/scans?limit=50&offset=0');
            _scans = resp.scans || [];
            document.getElementById('comp-scan-count').textContent =
                `${resp.total || _scans.length} scan${(resp.total !== 1) ? 's' : ''}`;
            _renderTable();
        } catch (e) {
            body.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="padding:24px 0;"><div class="empty-state-sub">Error loading scans: ${Utils.esc(String(e))}</div></div></td></tr>`;
        }
    }

    function _renderTable() {
        const body = document.getElementById('comp-scans-body');
        if (!_scans.length) {
            body.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="padding:30px 0;"><div class="empty-state-icon">🔒</div><div class="empty-state-sub">No vulnerability scans yet. Click <strong>New Scan</strong> to start.</div></div></td></tr>`;
            return;
        }
        body.innerHTML = _scans.map(s => `
            <tr style="cursor:pointer;" onclick="Compliance.openResults('${Utils.esc(s.scan_id)}')">
                <td><code style="font-size:12px;">${Utils.esc(s.scan_id)}</code></td>
                <td>${_statusBadge(s.status)}</td>
                <td>${Utils.esc(s.incident || '—')}</td>
                <td>${s.device_count}</td>
                <td>${_findingPills(s)}</td>
                <td>${s.started_at ? Utils.relTime(s.started_at) : '—'}</td>
                <td>
                    <button class="btn btn-outline" style="padding:3px 10px;font-size:11px;"
                        onclick="event.stopPropagation();Compliance.openResults('${Utils.esc(s.scan_id)}')">
                        Results
                    </button>
                </td>
            </tr>
        `).join('');
    }

    // ── New Scan modal (chip-select) ─────────────────────────────────────────

    function openNewScan() {
        _devices = [];
        document.getElementById('comp-scan-devices').querySelectorAll('.chip').forEach(c => c.remove());
        document.getElementById('comp-scan-device-input').value = '';
        document.getElementById('comp-scan-incident').value     = '';
        document.getElementById('comp-scan-submit-btn').disabled = false;
        openModal('comp-scan-modal');
    }

    function _deviceKeydown(e) {
        const inp = e.target;
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const val = inp.value.trim().replace(/,$/, '');
            if (val) _addChip(val);
            inp.value = '';
        } else if (e.key === 'Backspace' && !inp.value) {
            _removeLastChip();
        }
    }

    function _addChip(val) {
        if (_devices.includes(val)) return;
        _devices.push(val);
        const container = document.getElementById('comp-scan-devices');
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.innerHTML = `${Utils.esc(val)}<button onclick="Compliance._removeChip('${Utils.esc(val)}',this)" style="background:none;border:none;cursor:pointer;margin-left:4px;font-size:14px;line-height:1;">×</button>`;
        container.insertBefore(chip, document.getElementById('comp-scan-device-input'));
    }

    function _removeChip(val, btn) {
        _devices = _devices.filter(d => d !== val);
        btn.closest('.chip').remove();
    }

    function _removeLastChip() {
        if (!_devices.length) return;
        const last = _devices[_devices.length - 1];
        _devices.pop();
        const chips = document.getElementById('comp-scan-devices').querySelectorAll('.chip');
        if (chips.length) chips[chips.length - 1].remove();
    }

    async function submitScan() {
        const inp      = document.getElementById('comp-scan-device-input');
        const incident = document.getElementById('comp-scan-incident').value.trim();

        // Flush any un-confirmed text in the input
        if (inp.value.trim()) _addChip(inp.value.trim());
        inp.value = '';

        if (!_devices.length) {
            alert('Please add at least one device or group.');
            return;
        }

        const btn = document.getElementById('comp-scan-submit-btn');
        btn.disabled = true;
        btn.textContent = 'Starting…';

        const deviceEntries = _devices.map(d => {
            // Heuristic: IP = host entry; otherwise treat as group
            if (/^[\d.]+$/.test(d) || /^[0-9a-f:]+$/i.test(d)) {
                return { host: d };
            }
            return { group: d };
        });

        try {
            const resp = await API.post('/api/compliance/scans', {
                devices:  deviceEntries,
                incident: incident || null,
            });
            closeModal('comp-scan-modal');
            await refresh();
            if (resp.scan_id) openResults(resp.scan_id);
        } catch (e) {
            alert('Scan submission failed: ' + (e.message || e));
            btn.disabled = false;
            btn.textContent = 'Start Scan';
        }
    }

    // ── Results modal ─────────────────────────────────────────────────────────

    async function openResults(scanId) {
        _currentScanId = scanId;
        document.getElementById('comp-results-title').textContent = `Scan Results — ${scanId}`;
        document.getElementById('comp-results-body').innerHTML =
            `<div class="empty-state"><div class="empty-state-sub">Loading results…</div></div>`;
        openModal('comp-results-modal');

        try {
            const [scan, results] = await Promise.all([
                API.get(`/api/compliance/scans/${scanId}`),
                API.get(`/api/compliance/scans/${scanId}/results`),
            ]);
            _renderResults(scan, results);
        } catch (e) {
            document.getElementById('comp-results-body').innerHTML =
                `<div class="warn-banner">Error loading results: ${Utils.esc(String(e))}</div>`;
        }
    }

    function _renderResults(scan, results) {
        const devices = results.devices || [];
        const summary = `
            <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:18px;align-items:center;">
                <div>${_statusBadge(scan.status)}</div>
                <div style="font-size:13px;color:var(--text-secondary);">${scan.device_count} device${scan.device_count !== 1 ? 's' : ''}</div>
                ${scan.incident ? `<div style="font-size:13px;">Incident: <strong>${Utils.esc(scan.incident)}</strong></div>` : ''}
                ${_findingPills(scan)}
            </div>`;

        if (!devices.length) {
            document.getElementById('comp-results-body').innerHTML =
                summary + `<div class="empty-state"><div class="empty-state-sub">No device results yet.</div></div>`;
            return;
        }

        const cards = devices.map((dev, i) => {
            const statusCls = dev.status === 'collected' ? 'badge-success' : 'badge-error';
            const header = `
                <div class="device-row-header" onclick="Compliance._toggleDevice('dev-body-${i}')"
                    style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;background:var(--bg-card);border-bottom:1px solid var(--border-light);">
                    <span style="font-family:monospace;font-weight:600;">${Utils.esc(dev.host)}</span>
                    <span style="font-size:12px;color:var(--text-secondary);">${Utils.esc(dev.platform || '')} ${dev.version ? '— v' + Utils.esc(dev.version) : ''}</span>
                    <span class="badge ${statusCls}" style="margin-left:auto;">${Utils.esc(dev.status)}</span>
                    ${dev.finding_count ? `<span style="font-size:12px;font-weight:600;color:#b91c1c;">${dev.finding_count} finding${dev.finding_count !== 1 ? 's' : ''}</span>` : ''}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" id="dev-chevron-${i}"><path d="M6 9l6 6 6-6"/></svg>
                </div>`;

            let body = '';
            if (dev.error) {
                body = `<div class="warn-banner" style="margin:12px;">${Utils.esc(dev.error)}</div>`;
            } else if (!dev.findings || !dev.findings.length) {
                body = `<div style="padding:14px 16px;font-size:13px;color:var(--text-secondary);">No vulnerabilities found for this version.</div>`;
            } else {
                const rows = dev.findings.map(f => `
                    <tr>
                        <td>${_sevBadge(f.severity)}</td>
                        <td style="font-weight:600;font-size:12px;">${f.cvss_score != null ? f.cvss_score.toFixed(1) : '—'}</td>
                        <td style="font-size:12px;">${Utils.esc(f.advisory_id)}</td>
                        <td style="font-size:12px;max-width:280px;">${Utils.esc(f.title || '')}</td>
                        <td style="font-size:11px;">${(f.cve_list || []).join(', ') || '—'}</td>
                        <td style="font-size:11px;">${(f.first_fixed || []).join(', ') || '—'}</td>
                        <td>${f.pub_url ? `<a href="${Utils.esc(f.pub_url)}" target="_blank" rel="noreferrer" style="font-size:11px;">Link</a>` : '—'}</td>
                    </tr>`).join('');
                body = `
                    <table style="font-size:12px;">
                        <thead><tr><th>Severity</th><th>CVSS</th><th>Advisory ID</th><th>Title</th><th>CVEs</th><th>First Fixed</th><th>Advisory</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>`;
            }

            return `
                <div class="device-row" style="margin-bottom:8px;">
                    ${header}
                    <div id="dev-body-${i}" style="display:none;">${body}</div>
                </div>`;
        }).join('');

        document.getElementById('comp-results-body').innerHTML = summary + cards;
    }

    function _toggleDevice(bodyId) {
        const el = document.getElementById(bodyId);
        if (!el) return;
        const visible = el.style.display !== 'none';
        el.style.display = visible ? 'none' : 'block';
        const idx = bodyId.split('-').pop();
        const chev = document.getElementById(`dev-chevron-${idx}`);
        if (chev) chev.style.transform = visible ? '' : 'rotate(180deg)';
    }

    function downloadCSV() {
        if (!_currentScanId) return;
        window.location.href = `/api/compliance/scans/${_currentScanId}/results/csv`;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    return {
        onActivate,
        refresh,
        openNewScan,
        submitScan,
        openResults,
        downloadCSV,
        _deviceKeydown,
        _removeChip,
        _toggleDevice,
    };
})();

// Register with Nav system
if (typeof Nav !== 'undefined' && Nav.register) {
    Nav.register('compliance', {
        onActivate: () => Compliance.onActivate(),
    });
}
