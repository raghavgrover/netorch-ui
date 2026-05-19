/**
 * discovery.js — BigFix Asset Discovery page.
 *
 * Phase 1: Read-only table of unmanaged assets with filters and sorting.
 * Phase 2: Checkbox selection + "Add to Inventory" modal.
 */
'use strict';

const Discovery = (() => {
    let _devices     = [];   // full result set from API
    let _filtered    = [];   // after client-side filters
    let _sortCol     = 'ip';
    let _sortAsc     = true;
    let _lastMeta    = { bigfix_server: '', scan_time: '', total: 0 };
    let _selected    = new Set();  // IPs of checked rows

    // Platform options for inline dropdown in the modal
    const _PLATFORMS = [
        'cisco_ios', 'cisco_xe', 'cisco_xr', 'cisco_nxos',
        'juniper_junos', 'fortinet', 'linux', 'unknown',
    ];

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    async function load() {
        _selected.clear();
        _updateAddBtn();
        const wrap = $id('disc-table-wrap');
        if (wrap) wrap.innerHTML = '<div class="loading-row">Querying BigFix Asset Discovery…</div>';
        _setStatus('Fetching…', '');

        const res = await API.get('/api/discovery/devices');

        if (!res.ok) {
            if (wrap) wrap.innerHTML =
                `<div class="empty-state"><p>API error: ${res.data?.error || 'Unknown error'}</p></div>`;
            _setStatus('Error', '');
            return;
        }

        const data = res.data;

        if (data.error) {
            if (wrap) wrap.innerHTML = `
                <div class="empty-state" style="max-width:540px;margin:0 auto;padding:40px 20px;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40" style="color:var(--text-secondary);margin-bottom:12px;">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <p style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">BigFix Asset Discovery not available</p>
                    <p style="font-size:12px;color:var(--text-secondary);line-height:1.6;">${escHtml(data.error)}</p>
                    <p style="font-size:12px;color:var(--text-secondary);margin-top:12px;">
                        Configure BigFix credentials in <code>netorch.toml [bigfix]</code> section, then click <strong>Refresh</strong>.
                    </p>
                </div>`;
            _setStatus('Not configured', data.bigfix_server || '');
            return;
        }

        _devices = data.devices || [];

        const scanTimes = _devices.map(d => d.scan_time).filter(Boolean).sort();
        _lastMeta = {
            bigfix_server: data.bigfix_server || '',
            scan_time:     scanTimes[scanTimes.length - 1] || '',
            total:         data.total || _devices.length,
        };

        _populateFilterDropdowns();
        applyFilters();
    }

    // ── Status bar ────────────────────────────────────────────────────────────

    function _setStatus(msg, server) {
        const el = $id('disc-status');
        if (!el) return;
        el.textContent = msg + (server ? ` · BigFix: ${server}` : '');
    }

    function _updateStatus() {
        const el = $id('disc-status');
        if (!el) return;
        const sel  = _selected.size;
        const parts = [
            `${_filtered.length} of ${_devices.length} device${_devices.length !== 1 ? 's' : ''}`,
        ];
        if (sel > 0) parts.push(`${sel} selected`);
        if (_lastMeta.scan_time) parts.push(`Last scan: ${_lastMeta.scan_time}`);
        if (_lastMeta.bigfix_server) parts.push(`BigFix: ${_lastMeta.bigfix_server}`);
        el.textContent = parts.join(' · ');
    }

    // ── Add-to-inventory button state ─────────────────────────────────────────

    function _updateAddBtn() {
        const btn = $id('disc-add-btn');
        if (!btn) return;
        const n = _selected.size;
        btn.disabled = (n === 0);
        btn.textContent = n > 0 ? `📥 Add ${n} to Inventory` : '📥 Add to Inventory';
    }

    // ── Filters ───────────────────────────────────────────────────────────────

    function _populateFilterDropdowns() {
        const types     = [...new Set(_devices.map(d => d.device_type).filter(Boolean))].sort();
        const platforms = [...new Set(_devices.map(d => d.inferred_platform).filter(Boolean))].sort();

        const typeEl = $id('disc-filter-type');
        if (typeEl) {
            const cur = typeEl.value;
            typeEl.innerHTML = '<option value="">All Device Types</option>' +
                types.map(t => `<option value="${escHtml(t)}" ${t===cur?'selected':''}>${escHtml(t)}</option>`).join('');
        }

        const platEl = $id('disc-filter-platform');
        if (platEl) {
            const cur = platEl.value;
            platEl.innerHTML = '<option value="">All Platforms</option>' +
                platforms.map(p => `<option value="${escHtml(p)}" ${p===cur?'selected':''}>${escHtml(p)}</option>`).join('');
        }
    }

    function applyFilters() {
        const typeFilter = ($id('disc-filter-type')?.value   || '').toLowerCase();
        const platFilter = ($id('disc-filter-platform')?.value || '').toLowerCase();
        const invFilter  = $id('disc-filter-inv')?.value   || '';
        const search     = ($id('disc-filter-search')?.value || '').toLowerCase();

        _filtered = _devices.filter(d => {
            if (typeFilter && d.device_type.toLowerCase() !== typeFilter) return false;
            if (platFilter && d.inferred_platform.toLowerCase() !== platFilter) return false;
            if (invFilter === 'new'   &&  d.in_inventory) return false;
            if (invFilter === 'known' && !d.in_inventory) return false;
            if (search) {
                const haystack = `${d.ip} ${d.hostname} ${d.os} ${d.mac}`.toLowerCase();
                if (!haystack.includes(search)) return false;
            }
            return true;
        });

        _sortAndRender();
        _updateStatus();
    }

    // ── Sorting ───────────────────────────────────────────────────────────────

    function sortBy(col) {
        if (_sortCol === col) {
            _sortAsc = !_sortAsc;
        } else {
            _sortCol = col;
            _sortAsc = true;
        }
        _sortAndRender();
    }

    function _sortAndRender() {
        const col = _sortCol;
        const asc = _sortAsc;
        _filtered = [..._filtered].sort((a, b) => {
            const va = String(a[col] ?? '').toLowerCase();
            const vb = String(b[col] ?? '').toLowerCase();
            if (va < vb) return asc ? -1 : 1;
            if (va > vb) return asc ? 1  : -1;
            return 0;
        });
        _render();
    }

    // ── Checkbox handling ─────────────────────────────────────────────────────

    function _toggleRow(ip, checked) {
        if (checked) _selected.add(ip);
        else         _selected.delete(ip);
        _updateAddBtn();
        _updateStatus();
        // keep header checkbox in sync
        const headerCb = $id('disc-cb-all');
        if (headerCb) {
            const visibleIps = _filtered.map(d => d.ip);
            headerCb.checked       = visibleIps.length > 0 && visibleIps.every(ip => _selected.has(ip));
            headerCb.indeterminate = visibleIps.some(ip => _selected.has(ip)) && !headerCb.checked;
        }
    }

    function _toggleAll(checked) {
        _filtered.forEach(d => checked ? _selected.add(d.ip) : _selected.delete(d.ip));
        // Re-render to update individual checkboxes
        _render();
        _updateAddBtn();
        _updateStatus();
    }

    // ── Table render ──────────────────────────────────────────────────────────

    const _COLS = [
        { key: 'ip',                label: 'IP Address',   width: '130px' },
        { key: 'hostname',          label: 'Hostname',     width: '' },
        { key: 'mac',               label: 'MAC Address',  width: '145px' },
        { key: 'device_type',       label: 'Device Type',  width: '110px' },
        { key: 'os',                label: 'OS',           width: '140px' },
        { key: 'open_ports',        label: 'Scan Point',   width: '145px' },
        { key: 'inferred_platform', label: 'Platform',     width: '110px' },
        { key: 'in_inventory',      label: 'In Inventory', width: '100px' },
        { key: 'scan_time',         label: 'Scan Time',    width: '175px' },
    ];

    function _arrow(col) {
        if (_sortCol !== col) return '<span style="opacity:.3;">⇅</span>';
        return _sortAsc ? '↑' : '↓';
    }

    function _platformBadge(platform) {
        const map = {
            cisco_ios:      ['plat-ios',     'Cisco IOS'],
            cisco_xe:       ['plat-xe',      'IOS-XE'],
            cisco_xr:       ['plat-xr',      'IOS-XR'],
            cisco_nxos:     ['plat-xr',      'NX-OS'],
            linux:          ['plat-linux',   'Linux'],
            juniper_junos:  ['plat-xe',      'Juniper'],
            fortinet:       ['plat-ios',     'FortiOS'],
            unsupported:    ['plat-unknown', 'Unsupported'],
            unknown:        ['plat-unknown', 'Unknown'],
        };
        const [cls, label] = map[platform] || ['plat-unknown', platform || '—'];
        return `<span class="plat-badge ${cls}">${escHtml(label)}</span>`;
    }

    function _render() {
        const wrap = $id('disc-table-wrap');
        if (!wrap) return;

        if (!_filtered.length) {
            wrap.innerHTML = `
                <div class="empty-state">
                    <p style="font-size:14px;font-weight:600;color:var(--text-primary);">No devices match the current filters</p>
                    <p style="font-size:12px;color:var(--text-secondary);">Total discovered: ${_devices.length}</p>
                </div>`;
            return;
        }

        const allChecked = _filtered.length > 0 && _filtered.every(d => _selected.has(d.ip));
        const someChecked = _filtered.some(d => _selected.has(d.ip));
        const thStyle = 'cursor:pointer;user-select:none;white-space:nowrap;';

        const cbHeader = `<th style="width:36px;">
            <input type="checkbox" id="disc-cb-all"
                ${allChecked ? 'checked' : ''}
                onchange="Discovery._toggleAll(this.checked)"
                title="Select all">
        </th>`;

        const headers = cbHeader + _COLS.map(c =>
            `<th style="${c.width ? `width:${c.width};` : ''}${thStyle}"
                onclick="Discovery.sortBy('${c.key}')">${escHtml(c.label)} ${_arrow(c.key)}</th>`
        ).join('');

        const rows = _filtered.map(d => {
            const chk = _selected.has(d.ip) ? 'checked' : '';
            return `
            <tr class="${_selected.has(d.ip) ? 'row-selected' : ''}">
                <td><input type="checkbox" ${chk}
                    onchange="Discovery._toggleRow('${escHtml(d.ip)}', this.checked)"></td>
                <td style="font-weight:600;font-family:monospace;">${escHtml(d.ip)}</td>
                <td style="font-size:12px;">${escHtml(d.hostname || '—')}</td>
                <td style="font-size:12px;font-family:monospace;color:var(--text-secondary);white-space:nowrap;">${escHtml(d.mac || '—')}</td>
                <td style="font-size:12px;white-space:nowrap;">${escHtml(d.device_type || '—')}</td>
                <td style="font-size:12px;white-space:nowrap;">${escHtml(d.os || '—')}</td>
                <td style="font-size:11px;color:var(--text-secondary);white-space:nowrap;">${escHtml(d.open_ports || '—')}</td>
                <td>${_platformBadge(d.inferred_platform)}</td>
                <td style="text-align:center;">${d.in_inventory
                    ? '<span class="badge b-green" style="font-size:11px;">✓ Yes</span>'
                    : ''}</td>
                <td style="font-size:11px;color:var(--text-secondary);white-space:nowrap;max-width:170px;overflow:hidden;text-overflow:ellipsis;" title="${escHtml(d.scan_time || '')}">${escHtml(d.scan_time || '—')}</td>
            </tr>`;
        }).join('');

        wrap.innerHTML = `
            <div style="overflow-x:auto;">
                <table class="data-table" style="min-width:900px;">
                    <thead><tr>${headers}</tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;

        // Restore indeterminate state on header checkbox
        const headerCb = $id('disc-cb-all');
        if (headerCb && someChecked && !allChecked) headerCb.indeterminate = true;
    }

    // ── Add to Inventory modal ────────────────────────────────────────────────

    async function openAddModal() {
        if (_selected.size === 0) return;

        // Default group name: discovered_YYYY-MM-DD
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '_');
        const groupInput = $id('disc-add-group');
        if (groupInput) groupInput.value = `discovered_${today}`;

        // Reset radio to "existing"
        const radioExisting = $id('disc-radio-existing');
        if (radioExisting) radioExisting.checked = true;
        toggleTarget();

        // Clear error messages
        const modalErr = $id('disc-add-modal-err');
        if (modalErr) modalErr.style.display = 'none';
        const groupErr = $id('disc-add-group-err');
        if (groupErr) groupErr.style.display = 'none';

        // Reset submit button
        const btn = $id('disc-add-submit-btn');
        if (btn) { btn.disabled = false; btn.textContent = `Add ${_selected.size} Device${_selected.size !== 1 ? 's' : ''}`; }

        // Populate selected devices list
        _renderDevicesList();

        // Fetch inventory sources for the dropdown
        await _loadInventoryFiles();

        openModal('modal-discovery-add');
    }

    function _renderDevicesList() {
        const container = $id('disc-add-devices-list');
        if (!container) return;

        const selectedDevices = _devices.filter(d => _selected.has(d.ip));

        if (!selectedDevices.length) {
            container.innerHTML = '<div style="padding:12px;font-size:12px;color:var(--text-secondary);">No devices selected.</div>';
            return;
        }

        const platOptions = _PLATFORMS.map(p => `<option value="${p}">${p}</option>`).join('');

        container.innerHTML = `
            <table style="width:100%;border-collapse:collapse;">
                <thead>
                    <tr style="background:var(--bg-hover);">
                        <th style="padding:8px 12px;font-size:11px;font-weight:600;text-align:left;color:var(--text-secondary);text-transform:uppercase;">IP</th>
                        <th style="padding:8px 12px;font-size:11px;font-weight:600;text-align:left;color:var(--text-secondary);text-transform:uppercase;">Hostname</th>
                        <th style="padding:8px 12px;font-size:11px;font-weight:600;text-align:left;color:var(--text-secondary);text-transform:uppercase;">Platform</th>
                    </tr>
                </thead>
                <tbody>
                    ${selectedDevices.map((d, i) => `
                        <tr style="border-top:1px solid var(--border-light);">
                            <td style="padding:8px 12px;font-size:13px;font-weight:600;font-family:monospace;">${escHtml(d.ip)}</td>
                            <td style="padding:8px 12px;font-size:12px;color:var(--text-secondary);">${escHtml(d.hostname || '—')}</td>
                            <td style="padding:8px 12px;">
                                <select class="form-control disc-add-plat-sel" style="font-size:12px;padding:4px 6px;"
                                    data-ip="${escHtml(d.ip)}">
                                    ${_PLATFORMS.map(p =>
                                        `<option value="${p}" ${p === d.inferred_platform ? 'selected' : ''}>${p}</option>`
                                    ).join('')}
                                </select>
                            </td>
                        </tr>`).join('')}
                </tbody>
            </table>`;
    }

    async function _loadInventoryFiles() {
        const sel = $id('disc-add-file-select');
        if (!sel) return;
        sel.innerHTML = '<option value="">Loading…</option>';
        const res = await API.get('/api/inventory/sources');
        if (!res.ok || !res.data.sources) {
            sel.innerHTML = '<option value="">Failed to load files</option>';
            return;
        }
        const sources = res.data.sources;
        if (!sources.length) {
            sel.innerHTML = '<option value="">No inventory files found</option>';
            return;
        }
        sel.innerHTML = sources.map(s =>
            `<option value="${escHtml(s.file)}">${escHtml(s.file)} (${s.hosts} hosts)</option>`
        ).join('');
    }

    function toggleTarget() {
        const isExisting = $id('disc-radio-existing')?.checked;
        const existingWrap = $id('disc-add-existing-wrap');
        const newWrap      = $id('disc-add-new-wrap');
        if (existingWrap) existingWrap.style.display = isExisting ? '' : 'none';
        if (newWrap)      newWrap.style.display      = isExisting ? 'none' : '';
    }

    async function submitAddToInventory() {
        // Collect platform overrides from dropdowns
        const platformMap = {};
        document.querySelectorAll('.disc-add-plat-sel').forEach(sel => {
            platformMap[sel.dataset.ip] = sel.value;
        });

        const selectedDevices = _devices
            .filter(d => _selected.has(d.ip))
            .map(d => ({
                ip:       d.ip,
                hostname: d.hostname || '',
                platform: platformMap[d.ip] || d.inferred_platform || 'unknown',
                port:     22,
            }));

        const isExisting = $id('disc-radio-existing')?.checked;
        const groupName  = ($id('disc-add-group')?.value || '').trim();

        // Client-side validation
        const groupErr = $id('disc-add-group-err');
        const modalErr = $id('disc-add-modal-err');
        if (groupErr) groupErr.style.display = 'none';
        if (modalErr) modalErr.style.display = 'none';

        if (!groupName || !/^[a-zA-Z0-9_-]+$/.test(groupName)) {
            if (groupErr) {
                groupErr.textContent = 'Group name must contain only letters, digits, underscores, or hyphens.';
                groupErr.style.display = '';
            }
            return;
        }

        const payload = {
            devices:   selectedDevices,
            target:    isExisting ? 'existing' : 'new',
            group_name: groupName,
        };

        if (isExisting) {
            payload.inventory_file = $id('disc-add-file-select')?.value || '';
            if (!payload.inventory_file) {
                if (modalErr) { modalErr.textContent = 'Please select an inventory file.'; modalErr.style.display = ''; }
                return;
            }
        } else {
            payload.new_filename = ($id('disc-add-new-filename')?.value || '').trim();
            if (!payload.new_filename) {
                if (modalErr) { modalErr.textContent = 'Please enter a filename.'; modalErr.style.display = ''; }
                return;
            }
        }

        const btn = $id('disc-add-submit-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }

        const res = await API.post('/api/discovery/add-to-inventory', payload);

        if (btn) { btn.disabled = false; btn.textContent = `Add ${selectedDevices.length} Device${selectedDevices.length !== 1 ? 's' : ''}`; }

        if (res.ok) {
            const d = res.data;
            closeModal('modal-discovery-add');
            showToast(`${d.added} device${d.added !== 1 ? 's' : ''} added to ${d.file} [${d.group}]`, 'success');
            _selected.clear();
            _updateAddBtn();
            // Refresh so in_inventory flags update
            load();
        } else {
            const msg = res.data?.detail || res.data?.error || 'Unknown error';
            if (modalErr) { modalErr.textContent = `Error: ${msg}`; modalErr.style.display = ''; }
        }
    }

    // ── Trigger Scan modal ────────────────────────────────────────────────────

    async function openScanModal() {
        // Reset modal state
        $id('disc-scan-subnet').value = '';
        const resultEl = $id('disc-scan-result');
        if (resultEl) resultEl.style.display = 'none';

        // Restore footer to initial state
        const footer = $id('disc-scan-footer');
        if (footer) {
            footer.innerHTML = `
                <button class="btn btn-outline" onclick="closeModal('modal-discovery-scan')">Cancel</button>
                <button class="btn btn-primary" id="disc-scan-submit-btn" onclick="Discovery.submitTriggerScan()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                    Trigger Scan
                </button>`;
        }

        openModal('modal-discovery-scan');

        // Fetch and display scan_point_id
        const spEl = $id('disc-scan-point-id');
        if (spEl) spEl.textContent = '…';
        try {
            const res = await API.get('/api/discovery/config');
            if (res.ok) {
                const scanPointId = res.data.scan_point_id || 0;
                if (spEl) spEl.textContent = scanPointId || 'not configured';

                // Warn if scan_point_id is 0
                if (!scanPointId) {
                    const btn = $id('disc-scan-submit-btn');
                    if (btn) btn.disabled = true;
                    const hintEl = $id('disc-scan-hint');
                    if (hintEl) {
                        hintEl.innerHTML =
                            '<span style="color:var(--color-danger,#e53e3e);">⚠ scan_point_id is not configured in netorch.toml — please set it before triggering scans.</span>';
                    }
                }
            }
        } catch (_) { /* non-fatal */ }
    }

    async function submitTriggerScan() {
        const subnet = ($id('disc-scan-subnet')?.value || '').trim();

        // Basic client-side format check
        if (!subnet || !/^[\d.:/\-]+$/.test(subnet)) {
            _showScanResult('error', 'Please enter a valid subnet or IP range (e.g. 10.0.1.0/24).');
            return;
        }

        const submitBtn  = $id('disc-scan-submit-btn');
        const cancelBtn  = $id('disc-scan-footer')?.querySelector('.btn-outline');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Triggering…'; }
        if (cancelBtn) cancelBtn.disabled = true;

        const res = await API.post('/api/discovery/trigger-scan', { subnet });

        if (submitBtn) { submitBtn.disabled = false; }
        if (cancelBtn) cancelBtn.disabled = false;

        if (!res.ok) {
            _showScanResult('error', res.data?.detail || res.data?.error || 'Unknown error');
            if (submitBtn) submitBtn.textContent = '⚡ Trigger Scan';
            return;
        }

        if (res.data.error) {
            _showScanResult('error', res.data.error);
            if (submitBtn) submitBtn.textContent = '⚡ Trigger Scan';
            return;
        }

        // Success
        const actionId = res.data.action_id;
        const msg      = res.data.message || 'Scan triggered successfully.';
        _showScanResult('success', msg, actionId);

        // Replace footer with just Close
        const footer = $id('disc-scan-footer');
        if (footer) {
            footer.innerHTML = `<button class="btn btn-primary" onclick="closeModal('modal-discovery-scan')">Close</button>`;
        }

        // Toast outside the modal
        showToast(`Scan triggered for ${subnet}${actionId ? ` (Action ID: ${actionId})` : ''}`, 'success');
    }

    function _showScanResult(type, msg, actionId) {
        const el = $id('disc-scan-result');
        if (!el) return;
        const isSuccess = type === 'success';
        const bg     = isSuccess ? '#f0fdf4' : '#fef2f2';
        const border = isSuccess ? '#86efac' : '#fca5a5';
        const color  = isSuccess ? '#166534' : '#991b1b';
        const icon   = isSuccess ? '✓' : '✕';
        el.style.display = '';
        el.innerHTML = `
            <div style="background:${bg};border:1px solid ${border};border-radius:6px;padding:12px 16px;color:${color};font-size:13px;margin-top:4px;">
                <span style="font-weight:700;margin-right:8px;">${icon}</span>${escHtml(msg)}
                ${actionId ? `<div style="margin-top:6px;font-size:12px;">BigFix Action ID: <strong>${actionId}</strong></div>` : ''}
            </div>`;
    }

    return {
        load, applyFilters, sortBy,
        _toggleRow, _toggleAll,
        openAddModal, toggleTarget, submitAddToInventory,
        openScanModal, submitTriggerScan,
    };
})();
