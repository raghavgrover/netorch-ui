/**
 * compliance.js — Vulnerability scan management view.
 *
 * API calls return { data, ok, status } — always use res.data.xxx, never res.xxx.
 *
 * Chip-select pattern mirrors runbooks.js exactly:
 *   _devices[] is the source of truth; _renderModalChips() rebuilds the
 *   container innerHTML (chips + input) on every change.
 */
'use strict';

const Compliance = (() => {
    // ── State ──────────────────────────────────────────────────────────────
    let _scans         = [];
    let _currentScanId = null;
    let _devices       = [];

    // ── Helpers ─────────────────────────────────────────────────────────────

    function _esc(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function _relTime(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        if (isNaN(d)) return iso;
        const diff = Math.round((Date.now() - d) / 1000);
        if (diff < 60)  return `${diff}s ago`;
        if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
        return d.toLocaleDateString();
    }

    function _sevBadge(sev) {
        const cls = {
            'Critical':      'sev-critical',
            'High':          'sev-high',
            'Medium':        'sev-medium',
            'Low':           'sev-low',
            'Informational': 'sev-informational',
        }[sev] || 'sev-unknown';
        return `<span class="sev-badge ${cls}">${_esc(sev || 'Unknown')}</span>`;
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
        return `<span class="badge ${map[status] || 'badge-pending'}">${_esc(status)}</span>`;
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

        const res = await API.get('/api/compliance/scans', { limit: 50, offset: 0 });
        if (!res.ok) {
            body.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="padding:24px 0;"><div class="empty-state-sub">Error loading scans: ${_esc(res.data?.error || 'API error')}</div></div></td></tr>`;
            return;
        }
        _scans = res.data.scans || [];
        const total = res.data.total || _scans.length;
        document.getElementById('comp-scan-count').textContent =
            `${total} scan${total !== 1 ? 's' : ''}`;
        try {
            _renderTable();
        } catch (err) {
            body.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="padding:24px 0;"><div class="empty-state-sub">Render error: ${_esc(String(err))}</div></div></td></tr>`;
        }
    }

    function _renderTable() {
        const body = document.getElementById('comp-scans-body');
        if (!_scans.length) {
            body.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="padding:30px 0;"><div class="empty-state-sub">No vulnerability scans yet. Click <strong>New Scan</strong> to start.</div></div></td></tr>`;
            return;
        }
        body.innerHTML = _scans.map(s => `
            <tr style="cursor:pointer;" onclick="Compliance.openResults('${_esc(s.scan_id)}')">
                <td><code style="font-size:12px;">${_esc(s.scan_id)}</code></td>
                <td>${_statusBadge(s.status)}</td>
                <td>${_esc(s.incident || '—')}</td>
                <td>${s.device_count}</td>
                <td>${_findingPills(s)}</td>
                <td>${_relTime(s.started_at)}</td>
                <td>
                    <button class="btn btn-outline" style="padding:3px 10px;font-size:11px;"
                        onclick="event.stopPropagation();Compliance.openResults('${_esc(s.scan_id)}')">
                        Results
                    </button>
                </td>
            </tr>
        `).join('');
    }

    // ── Chip-select (mirrors runbooks.js pattern exactly) ────────────────────

    function _renderModalChips() {
        const container = document.getElementById('comp-scan-devices');
        if (!container) return;

        container.innerHTML =
            _devices.map((d, i) => `
                <span style="background:#eff6ff;color:var(--hcl-blue);border:1px solid #bfdbfe;border-radius:4px;padding:3px 8px;font-size:12px;font-weight:500;display:inline-flex;align-items:center;gap:5px;">
                    ${_esc(d)}
                    <span style="cursor:pointer;opacity:0.6;display:flex;" onclick="Compliance._removeDevice(${i})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </span>
                </span>`).join('') +
            `<input type="text" id="comp-scan-device-input"
                placeholder="${_devices.length ? '' : 'Type group name or IP, press Enter to add…'}"
                style="border:none;outline:none;font-size:13px;font-family:'Inter';flex:1;min-width:160px;background:transparent;padding:2px 4px;"
                onkeydown="Compliance._deviceKeydown(event)"
                autocomplete="off" list="comp-scan-group-datalist">`;
    }

    function _deviceKeydown(event) {
        const inp = event.target;
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            const val = inp.value.trim().replace(/,$/, '');
            if (val && !_devices.includes(val)) {
                _devices.push(val);
                _renderModalChips();
            }
            setTimeout(() => document.getElementById('comp-scan-device-input')?.focus(), 0);
        }
        if (event.key === 'Backspace' && !inp.value && _devices.length) {
            _devices.pop();
            _renderModalChips();
            setTimeout(() => document.getElementById('comp-scan-device-input')?.focus(), 0);
        }
    }

    function _removeDevice(i) {
        _devices.splice(i, 1);
        _renderModalChips();
        setTimeout(() => document.getElementById('comp-scan-device-input')?.focus(), 0);
    }

    // ── New Scan modal ────────────────────────────────────────────────────────

    async function openNewScan() {
        _devices = [];
        _renderModalChips();

        document.getElementById('comp-scan-incident').value      = '';
        const btn = document.getElementById('comp-scan-submit-btn');
        btn.disabled    = false;
        btn.textContent = 'Start Scan';

        // Populate datalist with inventory groups
        const res = await API.get('/api/inventory/groups');
        if (res.ok) {
            const datalist = document.getElementById('comp-scan-group-datalist');
            if (datalist) {
                datalist.innerHTML = (res.data.groups || [])
                    .map(g => `<option value="${_esc(g)}">`)
                    .join('');
            }
        }

        openModal('comp-scan-modal');
        setTimeout(() => document.getElementById('comp-scan-device-input')?.focus(), 50);
    }

    async function submitScan() {
        // Flush any un-confirmed text still in the input
        const inp = document.getElementById('comp-scan-device-input');
        if (inp && inp.value.trim()) {
            const v = inp.value.trim();
            if (!_devices.includes(v)) _devices.push(v);
        }

        const incident = document.getElementById('comp-scan-incident').value.trim();

        if (!_devices.length) {
            alert('Please add at least one device or group.');
            return;
        }

        const btn = document.getElementById('comp-scan-submit-btn');
        btn.disabled    = true;
        btn.textContent = 'Starting…';

        const deviceEntries = _devices.map(d =>
            /^[\d.]+$/.test(d) || /^[0-9a-f:]+$/i.test(d)
                ? { host: d }
                : { group: d }
        );

        const res = await API.post('/api/compliance/scans', {
            devices:  deviceEntries,
            incident: incident || null,
        });

        if (!res.ok) {
            alert('Scan submission failed: ' + (res.data?.detail || res.data?.error || `HTTP ${res.status}`));
            btn.disabled    = false;
            btn.textContent = 'Start Scan';
            return;
        }

        closeModal('comp-scan-modal');
        showToast(`Scan ${res.data.scan_id} queued — ${res.data.device_count} device${res.data.device_count !== 1 ? 's' : ''}`, 'success');
        await refresh();
        if (res.data.scan_id) openResults(res.data.scan_id);
    }

    // ── Results modal ─────────────────────────────────────────────────────────

    async function openResults(scanId) {
        _currentScanId = scanId;
        document.getElementById('comp-results-title').textContent = `Scan Results — ${scanId}`;
        document.getElementById('comp-results-body').innerHTML =
            `<div class="empty-state"><div class="empty-state-sub">Loading results…</div></div>`;
        openModal('comp-results-modal');

        const [scanRes, resultsRes] = await Promise.all([
            API.get(`/api/compliance/scans/${scanId}`),
            API.get(`/api/compliance/scans/${scanId}/results`),
        ]);

        if (!scanRes.ok || !resultsRes.ok) {
            document.getElementById('comp-results-body').innerHTML =
                `<div class="warn-banner">Error loading results: ${_esc(scanRes.data?.error || resultsRes.data?.error || 'API error')}</div>`;
            return;
        }

        _renderResults(scanRes.data, resultsRes.data);
    }

    function _renderResults(scan, results) {
        const devices = results.devices || [];
        const summary = `
            <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:18px;align-items:center;">
                <div>${_statusBadge(scan.status)}</div>
                <div style="font-size:13px;color:var(--text-secondary);">${scan.device_count} device${scan.device_count !== 1 ? 's' : ''}</div>
                ${scan.incident ? `<div style="font-size:13px;">Incident: <strong>${_esc(scan.incident)}</strong></div>` : ''}
                ${_findingPills(scan)}
            </div>`;

        if (!devices.length) {
            document.getElementById('comp-results-body').innerHTML =
                summary + `<div class="empty-state"><div class="empty-state-sub">No device results yet — scan may still be running.</div></div>`;
            return;
        }

        const cards = devices.map((dev, i) => {
            const statusCls = dev.status === 'collected' ? 'badge-success' : 'badge-error';
            const header = `
                <div onclick="Compliance._toggleDevice('dev-body-${i}')"
                    style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;background:var(--bg-card);border-bottom:1px solid var(--border-light);">
                    <span style="font-family:monospace;font-weight:600;">${_esc(dev.host)}</span>
                    <span style="font-size:12px;color:var(--text-secondary);">${_esc(dev.platform || '')}${dev.version ? ' — v' + _esc(dev.version) : ''}</span>
                    <span class="badge ${statusCls}" style="margin-left:auto;">${_esc(dev.status)}</span>
                    ${dev.finding_count ? `<span style="font-size:12px;font-weight:600;color:#b91c1c;">${dev.finding_count} finding${dev.finding_count !== 1 ? 's' : ''}</span>` : ''}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" id="dev-chevron-${i}"><path d="M6 9l6 6 6-6"/></svg>
                </div>`;

            let body = '';
            if (dev.error) {
                body = `<div class="warn-banner" style="margin:12px;">${_esc(dev.error)}</div>`;
            } else if (!dev.findings || !dev.findings.length) {
                body = `<div style="padding:14px 16px;font-size:13px;color:var(--text-secondary);">No vulnerabilities found for this version.</div>`;
            } else {
                const rows = dev.findings.map(f => `
                    <tr>
                        <td>${_sevBadge(f.severity)}</td>
                        <td style="font-weight:600;font-size:12px;">${f.cvss_score != null ? f.cvss_score.toFixed(1) : '—'}</td>
                        <td style="font-size:12px;">${_esc(f.advisory_id)}</td>
                        <td style="font-size:12px;max-width:280px;">${_esc(f.title || '')}</td>
                        <td style="font-size:11px;">${(f.cve_list || []).join(', ') || '—'}</td>
                        <td style="font-size:11px;">${(f.first_fixed || []).join(', ') || '—'}</td>
                        <td>${f.pub_url ? `<a href="${_esc(f.pub_url)}" target="_blank" rel="noreferrer" style="font-size:11px;">Link</a>` : '—'}</td>
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
        _removeDevice,
        _toggleDevice,
    };
})();

if (typeof Nav !== 'undefined' && Nav.register) {
    Nav.register('compliance', {
        onActivate: () => Compliance.onActivate(),
    });
}
