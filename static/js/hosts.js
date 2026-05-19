/**
 * hosts.js — Hosts view.
 *
 * All filtering and pagination is server-side.
 * The browser sends query params to /api/hosts and renders only one page.
 * With 50 000 hosts this keeps the browser DOM trivially small.
 */
'use strict';

const Hosts = (() => {
    let _page     = 0;
    let _pageSize = 100;
    let _total    = 0;
    let _search   = '';
    let _platform = '';
    let _group    = '';
    let _drawerHost = null;
    let _selected = new Set();   // IPs of checked rows

    // Debounced search so we don't hammer /api/hosts on every keystroke
    const _debouncedLoad = debounce(_fetchAndRender, 350);

    // ── Public entry point ────────────────────────────────────────────────────

    async function load() {
        _page = 0;
        _search   = '';
        _platform = '';
        _group    = '';
        _selected.clear();
        $id('host-search').value   = '';
        $id('plat-filter').value   = '';
        $id('group-filter').value  = '';
        _updateDeleteBtn();
        await _fetchAndRender();
        _loadGroups();
    }

    // ── Event handlers (called from HTML) ─────────────────────────────────────

    function onSearch() {
        _search = $id('host-search').value.trim();
        _page   = 0;
        _debouncedLoad();
    }

    function onFilter() {
        _platform = $id('plat-filter').value;
        _group    = $id('group-filter').value;
        _page     = 0;
        _fetchAndRender();
    }

    function onPageSizeChange() {
        _pageSize = parseInt($id('host-page-size').value, 10);
        _page     = 0;
        _fetchAndRender();
    }

    function refresh() {
        _fetchAndRender();
    }

    // ── Data fetch ────────────────────────────────────────────────────────────

    async function _fetchAndRender() {
        const tbody = $id('hosts-body');
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-secondary);">Loading…</td></tr>`;

        const res = await API.hosts({
            offset:   _page * _pageSize,
            limit:    _pageSize,
            search:   _search,
            platform: _platform,
            group:    _group,
        });

        if (!res.ok) {
            tbody.innerHTML = `<tr><td colspan="7">
                <div class="api-error-banner active" style="margin:12px;">
                    Could not load hosts: ${escHtml(res.data?.error || 'Unknown error')}
                </div></td></tr>`;
            return;
        }

        // netorch /inventory/hosts returns { hosts: [...], total: N }
        // or { items: [...], total: N } — handle both
        const hosts = res.data.hosts || res.data.items || res.data || [];
        _total = res.data.total ?? hosts.length;

        _renderTable(hosts);
        _renderPager();

        const start = _page * _pageSize + 1;
        const end   = Math.min(start + hosts.length - 1, _total);
        $id('host-pager-info').textContent = _total
            ? `${fmtNum(start)}–${fmtNum(end)} of ${fmtNum(_total)}`
            : 'No hosts found';
        $id('host-count').textContent = `${fmtNum(_total)} host${_total !== 1 ? 's' : ''}`;
    }

    function _renderTable(hosts) {
        const tbody = $id('hosts-body');
        if (!hosts.length) {
            tbody.innerHTML = `<tr><td colspan="8">
                <div class="empty-state" style="padding:40px 0;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
                        <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
                    </svg>
                    <div class="empty-state-title">No hosts found</div>
                    <div class="empty-state-sub">Try adjusting your search or filter criteria.</div>
                </div></td></tr>`;
            _syncHeaderCheckbox(hosts);
            return;
        }

        tbody.innerHTML = hosts.map(h => {
            const groups  = Array.isArray(h.groups) ? h.groups : (h.group ? [h.group] : []);
            const checked = _selected.has(h.host) ? 'checked' : '';
            return `
            <tr class="${_selected.has(h.host) ? 'row-selected' : ''}">
                <td><input type="checkbox" ${checked}
                    onchange="Hosts._toggleRow('${escHtml(h.host)}', this.checked)"></td>
                <td><span class="cell-link" onclick="Hosts.openDrawer('${escHtml(h.host)}')">${escHtml(h.host)}</span></td>
                <td>${platBadge(h.platform)}</td>
                <td><span style="font-size:12px;color:var(--text-secondary);">${escHtml(groups.join(', '))}</span></td>
                <td style="font-size:12px;">${h.port || 22}</td>
                <td>${h.last_job
                    ? `<span class="cell-link" onclick="Jobs.openDetail('${escHtml(h.last_job)}')" style="font-size:12px;">${escHtml(h.last_job)}</span>`
                    : '<span style="color:var(--text-secondary);font-size:12px;">—</span>'}</td>
                <td>${statusBadge(h.last_status || null)}</td>
                <td>
                    <button class="btn btn-outline btn-icon" title="Run job on this host"
                        onclick="Hosts.runJobFor('${escHtml(h.host)}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                            <polygon points="5 3 19 12 5 21 5 3"/>
                        </svg>
                    </button>
                </td>
            </tr>`;
        }).join('');
        _syncHeaderCheckbox(hosts);
    }

    function _toggleRow(host, checked) {
        if (checked) _selected.add(host);
        else         _selected.delete(host);
        _updateDeleteBtn();
        _syncHeaderCheckbox(null);
    }

    function toggleAll(checked) {
        // Select/deselect all visible rows on the current page
        const rows = $id('hosts-body').querySelectorAll('input[type=checkbox]');
        rows.forEach(cb => {
            const host = cb.closest('tr')?.querySelector('.cell-link')?.textContent;
            if (!host) return;
            if (checked) _selected.add(host);
            else         _selected.delete(host);
            cb.checked = checked;
        });
        // Toggle row-selected class
        $id('hosts-body').querySelectorAll('tr').forEach(tr => {
            tr.classList.toggle('row-selected', checked && tr.querySelector('input[type=checkbox]') !== null);
        });
        _updateDeleteBtn();
    }

    function _syncHeaderCheckbox(hosts) {
        const cb = $id('hosts-cb-all');
        if (!cb) return;
        const rows = $id('hosts-body').querySelectorAll('input[type=checkbox]');
        if (!rows.length) { cb.checked = false; cb.indeterminate = false; return; }
        const checkedCount = [...rows].filter(r => r.checked).length;
        cb.checked       = checkedCount === rows.length;
        cb.indeterminate = checkedCount > 0 && checkedCount < rows.length;
    }

    function _updateDeleteBtn() {
        const btn = $id('hosts-delete-btn');
        if (!btn) return;
        const n = _selected.size;
        btn.disabled = n === 0;
        btn.innerHTML = n > 0
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" style="margin-right:4px;vertical-align:middle;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>Delete ${n} Selected`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" style="margin-right:4px;vertical-align:middle;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>Delete Selected`;
    }

    async function deleteSelected() {
        if (_selected.size === 0) return;
        const hosts = [..._selected];
        const noun = hosts.length === 1 ? 'host' : 'hosts';
        if (!confirm(
            `Delete ${hosts.length} ${noun} from inventory?\n\n` +
            hosts.join('\n') +
            '\n\nThis removes them from the inventory file(s) and cannot be undone.'
        )) return;

        const res = await API.del('/api/inventory/hosts', { hosts });
        if (res.ok) {
            const n = res.data.removed ?? hosts.length;
            showToast(`Removed ${n} ${noun} from inventory`, 'success');
            _selected.clear();
            _updateDeleteBtn();
            await _fetchAndRender();
        } else {
            showToast(`Delete failed: ${res.data?.detail || res.data?.error || 'Unknown error'}`, 'error');
        }
    }

    function _renderPager() {
        const pages = Math.ceil(_total / _pageSize);
        renderPager(
            $id('host-pager-btns'),
            _page,
            pages,
            (p) => { _page = p; _fetchAndRender(); }
        );
    }

    // ── Groups dropdown for filter bar ────────────────────────────────────────

    async function _loadGroups() {
        const res = await API.inventoryGroups();
        if (!res.ok) return;
        const groups = res.data.groups || res.data || [];
        const sel = $id('group-filter');
        const current = sel.value;
        sel.innerHTML = '<option value="">All Groups</option>' +
            groups.map(g => `<option value="${escHtml(g)}"${g === current ? ' selected' : ''}>${escHtml(g)}</option>`).join('');
    }

    // ── Host detail drawer ────────────────────────────────────────────────────

    async function openDrawer(host) {
        _drawerHost = host;
        $id('host-drawer-title').textContent = host;
        $id('host-drawer-meta').textContent  = '';
        $id('host-drawer-body').innerHTML    = '<div class="empty-state"><div class="empty-state-sub">Loading…</div></div>';
        $id('host-drawer-overlay').classList.add('active');
        $id('host-drawer').classList.add('active');

        // Fetch this specific host — use search to find it
        const res = await API.hosts({ search: host, limit: 1 });
        if (!res.ok) {
            $id('host-drawer-body').innerHTML = `<div class="api-error-banner active">Could not load host data.</div>`;
            return;
        }
        const hosts = res.data.hosts || res.data.items || res.data || [];
        const h = hosts.find(x => x.host === host) || hosts[0];
        if (!h) {
            $id('host-drawer-body').innerHTML = `<div class="empty-state"><div class="empty-state-sub">Host not found in inventory.</div></div>`;
            return;
        }

        $id('host-drawer-meta').textContent = `Platform: ${h.platform}  |  Port: ${h.port || 22}`;
        const groups = Array.isArray(h.groups) ? h.groups : (h.group ? [h.group] : []);

        $id('host-drawer-body').innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
                <div class="section-card" style="margin:0;">
                    <div style="font-size:10px;text-transform:uppercase;font-weight:700;color:var(--text-secondary);margin-bottom:8px;">Platform</div>
                    ${platBadge(h.platform)}
                </div>
                <div class="section-card" style="margin:0;">
                    <div style="font-size:10px;text-transform:uppercase;font-weight:700;color:var(--text-secondary);margin-bottom:8px;">SSH Port</div>
                    <div style="font-size:20px;font-weight:700;color:var(--text-primary);">${h.port || 22}</div>
                </div>
                <div class="section-card" style="margin:0;grid-column:1/-1;">
                    <div style="font-size:10px;text-transform:uppercase;font-weight:700;color:var(--text-secondary);margin-bottom:8px;">Groups</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        ${groups.length
                            ? groups.map(g => `<span style="background:#eff6ff;color:var(--hcl-blue);border:1px solid #bfdbfe;border-radius:4px;padding:3px 8px;font-size:12px;font-weight:500;">${escHtml(g)}</span>`).join('')
                            : '<span style="color:var(--text-secondary);font-size:12px;">No groups</span>'}
                    </div>
                </div>
                <div class="section-card" style="margin:0;">
                    <div style="font-size:10px;text-transform:uppercase;font-weight:700;color:var(--text-secondary);margin-bottom:8px;">Last Job</div>
                    <div style="font-size:13px;font-weight:600;">${h.last_job
                        ? `<span class="cell-link" onclick="Jobs.openDetail('${escHtml(h.last_job)}')">${escHtml(h.last_job)}</span>`
                        : '—'}</div>
                </div>
                <div class="section-card" style="margin:0;">
                    <div style="font-size:10px;text-transform:uppercase;font-weight:700;color:var(--text-secondary);margin-bottom:8px;">Last Result</div>
                    ${statusBadge(h.last_status || null)}
                </div>
            </div>
            <div style="background:#f8fafc;border:1px solid var(--border-light);border-radius:6px;padding:16px;font-size:12px;color:var(--text-secondary);text-align:center;">
                Click <strong>Run Job on This Host</strong> to collect live device output.
            </div>`;
    }

    function closeDrawer() {
        $id('host-drawer-overlay').classList.remove('active');
        $id('host-drawer').classList.remove('active');
        _drawerHost = null;
    }

    function runJobForCurrent() {
        if (!_drawerHost) return;
        runJobFor(_drawerHost);
    }

    function runJobFor(host) {
        closeDrawer();
        NewJob.prefillHost(host);
        Nav.go('newjob');
    }

    return {
        load, refresh,
        onSearch, onFilter, onPageSizeChange,
        openDrawer, closeDrawer, runJobForCurrent, runJobFor,
        toggleAll, _toggleRow, deleteSelected,
    };
})();
