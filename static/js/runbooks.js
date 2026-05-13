/**
 * runbooks.js — Runbooks page.
 *
 * Lists runbooks from /opt/netorch/runbooks, shows metadata, and lets the
 * operator run a runbook on any host/group via a modal dialog.
 */
'use strict';

const Runbooks = (() => {
    let _runbooks   = [];
    let _runbookName = null;   // currently-selected runbook for the run modal
    let _devices    = [];
    let _uploadFiles = [];

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    function load() {
        _fetchRunbooks();
    }

    // ── Data fetch ────────────────────────────────────────────────────────────

    async function _fetchRunbooks() {
        const wrap = $id('runbooks-list-wrap');
        if (wrap) wrap.innerHTML = '<div class="loading-row">Loading runbooks…</div>';

        const res = await API.runbooksList();
        if (!res.ok) {
            if (wrap) wrap.innerHTML = `<div class="empty-state"><p>Failed to load runbooks: ${res.data?.error || 'API error'}</p></div>`;
            return;
        }

        _runbooks = res.data.runbooks || [];
        const countEl = $id('rb-count');
        if (countEl) countEl.textContent = `${_runbooks.length} runbook${_runbooks.length !== 1 ? 's' : ''}`;
        _render();
    }

    function _render() {
        const wrap = $id('runbooks-list-wrap');
        if (!wrap) return;

        if (!_runbooks.length) {
            wrap.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40" style="color:var(--text-secondary);margin-bottom:12px;">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                    <p style="font-size:14px;font-weight:600;color:var(--text-primary);">No runbooks found</p>
                    <p style="font-size:12px;color:var(--text-secondary);">Place <code>.sh</code> files in <code>/opt/netorch/runbooks/</code> on the relay server.</p>
                </div>`;
            return;
        }

        wrap.innerHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Runbook</th>
                        <th>Description</th>
                        <th style="width:160px;">Last Modified</th>
                        <th style="width:120px;">Actions</th>
                        <th style="width:90px;"></th>
                    </tr>
                </thead>
                <tbody>
                    ${_runbooks.map(rb => `
                        <tr>
                            <td>
                                <div style="display:flex;align-items:center;gap:8px;">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15" style="color:var(--hcl-blue);flex-shrink:0;">
                                        <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
                                    </svg>
                                    <span style="font-weight:600;font-size:13px;">${escHtml(rb.name)}</span>
                                </div>
                            </td>
                            <td style="color:var(--text-secondary);font-size:12px;" title="${escHtml(rb.description || '')}">${escHtml(_truncate(rb.description || '—', 80))}</td>
                            <td style="font-size:12px;color:var(--text-secondary);">${_fmtTime(rb.modified_at)}</td>
                            <td>
                                <div style="display:flex;gap:4px;">
                                    <button class="btn btn-outline btn-icon" title="View runbook"
                                        onclick="Runbooks.openViewModal('${escHtml(rb.name)}')">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                                        </svg>
                                    </button>
                                    <button class="btn btn-outline" style="font-size:12px;padding:5px 10px;"
                                        title="Edit runbook" onclick="Runbooks.openEditModal('${escHtml(rb.name)}')">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" style="margin-right:4px;vertical-align:middle;">
                                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                        </svg>Edit
                                    </button>
                                    <button class="btn btn-danger" style="font-size:12px;padding:5px 10px;"
                                        title="Delete runbook" onclick="Runbooks.deleteRunbook('${escHtml(rb.name)}')">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" style="margin-right:4px;vertical-align:middle;">
                                            <polyline points="3 6 5 6 21 6"/>
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                                        </svg>Delete
                                    </button>
                                </div>
                            </td>
                            <td style="text-align:right;">
                                <button class="btn btn-primary" style="font-size:12px;padding:5px 12px;"
                                    onclick="Runbooks.openRunModal('${escHtml(rb.name)}')">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                    Run
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    }

    // ── Reload All ────────────────────────────────────────────────────────────

    async function reload() {
        await _fetchRunbooks();
        showToast('Runbooks refreshed', 'success');
    }

    // ── New File Modal ────────────────────────────────────────────────────────

    function openNew() {
        $id('rb-new-filename').value = '';
        $id('rb-new-content').value = '# Description of what this runbook does\n';
        $id('rb-new-save-btn').disabled = false;
        $id('rb-new-save-btn').textContent = 'Create Runbook';
        openModal('modal-rb-new');
        setTimeout(() => $id('rb-new-filename').focus(), 100);
    }

    async function saveNew() {
        const filename = $id('rb-new-filename').value.trim();
        const content  = $id('rb-new-content').value;

        if (!filename) { showToast('Filename is required', 'error'); return; }
        if (!filename.endsWith('.sh')) { showToast('Filename must end with .sh', 'error'); return; }

        $id('rb-new-save-btn').disabled = true;
        $id('rb-new-save-btn').textContent = 'Creating…';

        const res = await API.runbookCreate(filename, content);

        $id('rb-new-save-btn').disabled = false;
        $id('rb-new-save-btn').textContent = 'Create Runbook';

        if (res.ok) {
            closeModal('modal-rb-new');
            showToast(`Created ${filename}`, 'success');
            _fetchRunbooks();
        } else {
            showToast(`Create failed: ${res.data?.detail || res.data?.error || 'Unknown error'}`, 'error');
        }
    }

    // ── Upload Modal ──────────────────────────────────────────────────────────

    function openUpload() {
        _uploadFiles = [];
        $id('rb-upload-list').style.display = 'none';
        $id('rb-upload-list').innerHTML = '';
        $id('rb-upload-save-btn').disabled = true;
        $id('rb-upload-save-btn').textContent = 'Upload & Save';
        $id('rb-upload-input').value = '';
        openModal('modal-rb-upload');
    }

    function fileSelected(event) {
        _addFiles(Array.from(event.target.files));
    }

    function dropFile(event) {
        event.preventDefault();
        $id('rb-upload-drop-zone').classList.remove('drag-over');
        _addFiles(Array.from(event.dataTransfer.files));
    }

    function _addFiles(newFiles) {
        for (const f of newFiles) {
            if (f.name.endsWith('.sh') && !_uploadFiles.find(x => x.name === f.name))
                _uploadFiles.push(f);
        }
        _renderUploadList();
    }

    function _renderUploadList() {
        const list = $id('rb-upload-list');
        if (!_uploadFiles.length) {
            list.style.display = 'none';
            list.innerHTML = '';
            $id('rb-upload-save-btn').disabled = true;
            $id('rb-upload-save-btn').textContent = 'Upload & Save';
            return;
        }
        list.style.display = '';
        list.innerHTML = _uploadFiles.map((f, i) => `
            <div style="background:#f8fafc;border:1px solid var(--border-light);border-radius:6px;padding:10px 14px;display:flex;align-items:center;gap:10px;margin-bottom:6px;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    style="width:15px;height:15px;color:var(--hcl-blue);flex-shrink:0;">
                    <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
                </svg>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(f.name)}</div>
                    <div style="font-size:11px;color:var(--text-secondary);">${(f.size / 1024).toFixed(1)} KB</div>
                </div>
                <button class="btn btn-danger btn-icon" onclick="Runbooks.removeFile(${i})">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>`).join('');
        const n = _uploadFiles.length;
        $id('rb-upload-save-btn').disabled = false;
        $id('rb-upload-save-btn').textContent = `Upload & Save (${n})`;
    }

    function removeFile(i) {
        _uploadFiles.splice(i, 1);
        $id('rb-upload-input').value = '';
        _renderUploadList();
    }

    function clearUpload() {
        _uploadFiles = [];
        $id('rb-upload-list').style.display = 'none';
        $id('rb-upload-list').innerHTML = '';
        $id('rb-upload-save-btn').disabled = true;
        $id('rb-upload-save-btn').textContent = 'Upload & Save';
        $id('rb-upload-input').value = '';
    }

    function _readFile(file) {
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.readAsText(file);
        });
    }

    async function uploadSave() {
        if (!_uploadFiles.length) return;
        const btn = $id('rb-upload-save-btn');
        btn.disabled = true;
        btn.textContent = 'Uploading…';

        let succeeded = 0;
        const failures = [];
        for (const file of _uploadFiles) {
            const content = await _readFile(file);
            const res = await API.runbookCreate(file.name, content);
            if (res.ok) succeeded++;
            else failures.push(`${file.name}: ${res.data?.detail || res.data?.error || 'error'}`);
        }

        btn.disabled = false;
        btn.textContent = 'Upload & Save';

        if (!failures.length) {
            closeModal('modal-rb-upload');
            clearUpload();
            showToast(`Uploaded ${succeeded} file${succeeded !== 1 ? 's' : ''}`, 'success');
            _fetchRunbooks();
        } else {
            if (succeeded) showToast(`${succeeded} uploaded, ${failures.length} failed`, 'error');
            else showToast(`Upload failed: ${failures[0]}`, 'error');
        }
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    async function deleteRunbook(name) {
        if (!confirm(`Delete ${name}?\n\nThis removes the file from /opt/netorch/runbooks/ and cannot be undone.`)) return;
        const res = await API.runbookDelete(name);
        if (res.ok) {
            showToast(`Deleted ${name}`, 'info');
            _fetchRunbooks();
        } else {
            showToast(`Delete failed: ${res.data?.detail || res.data?.error || 'Unknown error'}`, 'error');
        }
    }

    // ── View Modal ────────────────────────────────────────────────────────────

    async function openViewModal(name) {
        $id('runbook-view-title').textContent = `View: ${name}`;
        $id('runbook-view-content').value = 'Loading…';
        openModal('runbook-view-modal');

        const res = await API.runbookGet(name);
        if (res.ok) {
            $id('runbook-view-content').value = (res.data.raw_lines || []).join('\n');
        } else {
            $id('runbook-view-content').value = `# Error: ${res.data?.error || 'Unknown'}`;
        }
    }

    // ── Edit Modal ────────────────────────────────────────────────────────────

    async function openEditModal(name) {
        $id('runbook-edit-title').textContent = `Edit: ${name}`;
        $id('runbook-edit-filename').value = name;
        $id('runbook-edit-content').value = 'Loading…';
        $id('runbook-edit-save-btn').disabled = true;
        openModal('runbook-edit-modal');

        const res = await API.runbookGet(name);
        if (res.ok) {
            $id('runbook-edit-content').value = (res.data.raw_lines || []).join('\n');
        } else {
            $id('runbook-edit-content').value = `# Error: ${res.data?.error || 'Unknown'}`;
        }
        $id('runbook-edit-save-btn').disabled = false;
    }

    async function saveEdit() {
        const name    = $id('runbook-edit-filename').value.trim();
        const content = $id('runbook-edit-content').value;
        if (!name) return;

        $id('runbook-edit-save-btn').disabled = true;
        $id('runbook-edit-save-btn').textContent = 'Saving…';

        const res = await API.runbookSave(name, content);

        $id('runbook-edit-save-btn').disabled = false;
        $id('runbook-edit-save-btn').textContent = 'Save Runbook';

        if (res.ok) {
            closeModal('runbook-edit-modal');
            showToast(`Saved ${name}`, 'success');
            _fetchRunbooks();
        } else {
            showToast(`Save failed: ${res.data?.detail || res.data?.error || 'Unknown error'}`, 'error');
        }
    }

    // ── Run Modal ─────────────────────────────────────────────────────────────

    async function openRunModal(name) {
        _runbookName = name;
        _devices     = [];

        $id('run-modal-title').textContent = `Run: ${name}`;
        $id('run-modal-devices').innerHTML = '';
        _renderModalChips();

        // Load groups into datalist
        const res = await API.inventoryGroups();
        const datalist = $id('run-modal-group-datalist');
        if (datalist && res.ok) {
            const groups = res.data.groups || [];
            datalist.innerHTML = groups.map(g => `<option value="${escHtml(g)}">`).join('');
        }

        // Reset options
        $id('run-modal-incident').value = '';
        $id('run-modal-timeout').value  = '30';
        $id('run-modal-workers').value  = '20';

        $id('runbook-run-modal').classList.add('active');
    }

    function closeRunModal() {
        $id('runbook-run-modal').classList.remove('active');
        _runbookName = null;
        _devices     = [];
    }

    function _renderModalChips() {
        const container = $id('run-modal-devices');
        if (!container) return;

        container.innerHTML =
            _devices.map((d, i) => `
                <span style="background:#eff6ff;color:var(--hcl-blue);border:1px solid #bfdbfe;border-radius:4px;padding:3px 8px;font-size:12px;font-weight:500;display:inline-flex;align-items:center;gap:5px;">
                    ${escHtml(d)}
                    <span style="cursor:pointer;opacity:0.6;display:flex;" onclick="Runbooks._removeDevice(${i})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </span>
                </span>`).join('') +
            `<input type="text" id="run-modal-device-input"
                placeholder="${_devices.length ? '' : 'Type group name or IP, press Enter…'}"
                style="border:none;outline:none;font-size:13px;font-family:'Inter';flex:1;min-width:160px;background:transparent;padding:2px 4px;"
                onkeydown="Runbooks._deviceKeydown(event)"
                autocomplete="off" list="run-modal-group-datalist">`;
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
            inp.value = '';
        }
        if (event.key === 'Backspace' && !inp.value && _devices.length) {
            _devices.pop();
            _renderModalChips();
        }
    }

    function _removeDevice(i) {
        _devices.splice(i, 1);
        _renderModalChips();
    }

    async function submitRun() {
        if (!_runbookName) return;
        if (!_devices.length) {
            showToast('Please add at least one target device or group.', 'error');
            return;
        }

        const incident = $id('run-modal-incident').value.trim().toUpperCase();
        if (!incident) {
            showToast('Incident number is required.', 'error');
            $id('run-modal-incident').focus();
            return;
        }

        const devices = _devices.map(d => {
            const isIp = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(d);
            return isIp ? { host: d } : { group: d };
        });

        const payload = {
            devices,
            incident,
            options: {
                timeout_per_device: parseInt($id('run-modal-timeout').value, 10) || 30,
                max_workers:        parseInt($id('run-modal-workers').value,  10) || 20,
            },
        };

        const btn = $id('run-modal-submit-btn');
        btn.disabled = true;
        btn.textContent = 'Submitting…';

        const res = await API.runbookRun(_runbookName, payload);

        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Runbook`;

        if (res.ok) {
            const jobId = res.data.job_id;
            showToast(`Job ${jobId} submitted`, 'success');
            closeRunModal();
            jobId ? Jobs.openDetail(jobId) : Nav.go('jobs');
        } else {
            const err = res.data?.detail || res.data?.error || JSON.stringify(res.data);
            showToast(`Submit failed: ${err}`, 'error');
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _truncate(str, max) {
        return str.length > max ? str.slice(0, max) + '…' : str;
    }

    function _fmtTime(iso) {
        if (!iso) return '—';
        try {
            return new Date(iso).toLocaleString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
            });
        } catch { return iso; }
    }

    return {
        load,
        reload,
        openNew, saveNew,
        openUpload, fileSelected, dropFile, clearUpload, removeFile, uploadSave,
        deleteRunbook,
        openViewModal,
        openEditModal, saveEdit,
        openRunModal, closeRunModal, submitRun,
        _deviceKeydown, _removeDevice,
    };
})();
