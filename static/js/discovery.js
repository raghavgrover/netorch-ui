/**
 * discovery.js — BigFix Asset Discovery page.
 *
 * Fetches unmanaged assets from /api/discovery/devices, renders a sortable
 * filterable table, and lets operators see which devices are not yet in
 * the netorch inventory.
 */
'use strict';

const Discovery = (() => {
    let _devices     = [];   // full result set from API
    let _filtered    = [];   // after client-side filters
    let _sortCol     = 'ip';
    let _sortAsc     = true;
    let _lastMeta    = { bigfix_server: '', scan_time: '', total: 0 };

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    async function load() {
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

        // Compute most recent scan time for status bar
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
        const parts = [
            `${_filtered.length} of ${_devices.length} device${_devices.length !== 1 ? 's' : ''}`,
        ];
        if (_lastMeta.scan_time) parts.push(`Last scan: ${_lastMeta.scan_time}`);
        if (_lastMeta.bigfix_server) parts.push(`BigFix: ${_lastMeta.bigfix_server}`);
        el.textContent = parts.join(' · ');
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
        const typeFilter  = ($id('disc-filter-type')?.value   || '').toLowerCase();
        const platFilter  = ($id('disc-filter-platform')?.value || '').toLowerCase();
        const invFilter   = $id('disc-filter-inv')?.value   || '';
        const search      = ($id('disc-filter-search')?.value || '').toLowerCase();

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

    // ── Table render ──────────────────────────────────────────────────────────

    const _COLS = [
        { key: 'ip',                label: 'IP Address',      width: '' },
        { key: 'hostname',          label: 'Hostname',        width: '' },
        { key: 'mac',               label: 'MAC Address',     width: '150px' },
        { key: 'device_type',       label: 'Device Type',     width: '120px' },
        { key: 'os',                label: 'OS',              width: '' },
        { key: 'open_ports',        label: 'Open Ports',      width: '140px' },
        { key: 'inferred_platform', label: 'Platform',        width: '130px' },
        { key: 'in_inventory',      label: 'In Inventory',    width: '110px' },
        { key: 'scan_time',         label: 'Scan Time',       width: '160px' },
    ];

    function _arrow(col) {
        if (_sortCol !== col) return '<span style="opacity:.3;">⇅</span>';
        return _sortAsc ? '↑' : '↓';
    }

    function _platformBadge(platform) {
        const map = {
            cisco_ios:      ['plat-ios',   'Cisco IOS'],
            cisco_xe:       ['plat-xe',    'IOS-XE'],
            cisco_xr:       ['plat-xr',    'IOS-XR'],
            cisco_nxos:     ['plat-xr',    'NX-OS'],
            linux:          ['plat-linux', 'Linux'],
            juniper_junos:  ['plat-xe',    'Juniper'],
            fortinet:       ['plat-ios',   'FortiOS'],
            unsupported:    ['plat-unknown','Unsupported'],
            unknown:        ['plat-unknown','Unknown'],
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

        const thStyle = 'cursor:pointer;user-select:none;white-space:nowrap;';
        const headers = _COLS.map(c =>
            `<th style="${c.width ? `width:${c.width};` : ''}${thStyle}"
                onclick="Discovery.sortBy('${c.key}')">${escHtml(c.label)} ${_arrow(c.key)}</th>`
        ).join('');

        const rows = _filtered.map(d => `
            <tr>
                <td style="font-weight:600;font-family:monospace;">${escHtml(d.ip)}</td>
                <td style="font-size:12px;">${escHtml(d.hostname || '—')}</td>
                <td style="font-size:12px;font-family:monospace;color:var(--text-secondary);">${escHtml(d.mac || '—')}</td>
                <td style="font-size:12px;">${escHtml(d.device_type || '—')}</td>
                <td style="font-size:12px;">${escHtml(d.os || '—')}</td>
                <td style="font-size:11px;color:var(--text-secondary);">${escHtml(d.open_ports || '—')}</td>
                <td>${_platformBadge(d.inferred_platform)}</td>
                <td style="text-align:center;">${d.in_inventory
                    ? '<span class="badge b-green" style="font-size:11px;">✓ Yes</span>'
                    : ''}</td>
                <td style="font-size:11px;color:var(--text-secondary);">${escHtml(d.scan_time || '—')}</td>
            </tr>`).join('');

        wrap.innerHTML = `
            <table class="data-table">
                <thead><tr>${headers}</tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
    }

    return { load, applyFilters, sortBy };
})();
