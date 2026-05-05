/**
 * workflows.js — Workflows page.
 *
 * Lists workflow scripts from /opt/netorch/workflows/, shows metadata
 * and declared parameters, and lets the operator run a workflow against
 * any host/group via a modal dialog.
 *
 * Differences from runbooks.js:
 *  - Calls /api/workflows endpoints instead of /api/runbooks
 *  - Run modal has a dynamic Parameters section (key/value pairs)
 *  - Parameters are passed as { parameters: { KEY: VALUE, ... } } in POST body
 *  - Live log polling during execution (workflow output streamed line-by-line)
 */
'use strict';

const Workflows = (() => {
    let _workflows    = [];
    let _workflowName = null;   // currently-selected workflow for the run modal
    let _devices      = [];
    let _params       = [];     // [{key, value}]

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    function load() {
        _fetchWorkflows();
    }

    // ── Data fetch ────────────────────────────────────────────────────────────

    async function _fetchWorkflows() {
        const wrap = $id('workflows-list-wrap');
        if (wrap) wrap.innerHTML = '<div class="loading-row">Loading workflows…</div>';

        const res = await API.get('/api/workflows');
        if (!res.ok) {
            if (wrap) wrap.innerHTML = `<div class="empty-state"><p>Failed to load workflows: ${res.data?.error || 'API error'}</p></div>`;
            return;
        }

        _workflows = res.data.workflows || [];
        _render();
    }

    // ── Render list ───────────────────────────────────────────────────────────

    function _render() {
        const wrap = $id('workflows-list-wrap');
        if (!wrap) return;

        if (!_workflows.length) {
            wrap.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40" style="color:var(--text-secondary);margin-bottom:12px;">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="12" y1="16" x2="8" y2="16"/><line x1="12" y1="12" x2="8" y2="12"/>
                        <line x1="16" y1="12" x2="16" y2="12"/>
                    </svg>
                    <p style="font-size:14px;font-weight:600;color:var(--text-primary);">No workflows found</p>
                    <p style="font-size:12px;color:var(--text-secondary);">Place <code>.sh</code> workflow scripts in <code>/opt/netorch/workflows/</code> on the relay server.</p>
                    <p style="font-size:12px;color:var(--text-secondary);margin-top:4px;">
                        Declare parameters with <code># PARAM: KEY — description</code> in the script header.
                    </p>
                </div>`;
            return;
        }

        wrap.innerHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Workflow</th>
                        <th>Description</th>
                        <th style="width:90px;text-align:right;">Params</th>
                        <th style="width:160px;">Last Modified</th>
                        <th style="width:90px;"></th>
                    </tr>
                </thead>
                <tbody>
                    ${_workflows.map(wf => `
                        <tr>
                            <td>
                                <div style="display:flex;align-items:center;gap:8px;">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15" style="color:var(--hcl-blue);flex-shrink:0;">
                                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                                        <polyline points="9 11 12 14 22 4"/>
                                    </svg>
                                    <span style="font-weight:600;font-size:13px;">${escHtml(wf.name)}</span>
                                </div>
                            </td>
                            <td style="color:var(--text-secondary);font-size:12px;">${escHtml(wf.description || '—')}</td>
                            <td style="text-align:right;font-size:13px;">${(wf.parameters || []).length}</td>
                            <td style="font-size:12px;color:var(--text-secondary);">${_fmtTime(wf.modified_at)}</td>
                            <td style="text-align:right;">
                                <button class="btn btn-primary" style="font-size:12px;padding:5px 12px;"
                                    onclick="Workflows.openRunModal('${escHtml(wf.name)}')">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                    Run
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    }

    // ── Run Modal ─────────────────────────────────────────────────────────────

    async function openRunModal(name) {
        _workflowName = name;
        _devices = [];
        _params  = [];

        $id('wf-run-modal-title').textContent = `Run: ${name}`;
        $id('wf-run-modal-devices').innerHTML = '';
        _renderModalChips();

        // Load groups into datalist
        const res = await API.inventoryGroups();
        const datalist = $id('wf-run-modal-group-datalist');
        if (datalist && res.ok) {
            datalist.innerHTML = (res.data.groups || [])
                .map(g => `<option value="${escHtml(g)}">`)
                .join('');
        }

        // Fetch workflow metadata to pre-populate declared PARAM fields
        const wfRes = await API.get(`/api/workflows/${encodeURIComponent(name)}`);
        if (wfRes.ok && wfRes.data.parameters?.length) {
            _params = wfRes.data.parameters.map(p => ({
                key:   p.name,
                value: '',
                hint:  p.description || '',
            }));
        }
        _renderParamRows();

        // Reset options
        $id('wf-run-modal-incident').value = '';
        $id('wf-run-modal-timeout').value  = '300';
        $id('wf-run-modal-workers').value  = '10';

        $id('workflow-run-modal').classList.add('active');
    }

    function closeRunModal() {
        $id('workflow-run-modal').classList.remove('active');
        _workflowName = null;
        _devices = [];
        _params  = [];
    }

    // ── Device chips (modal) ──────────────────────────────────────────────────

    function _renderModalChips() {
        const container = $id('wf-run-modal-devices');
        if (!container) return;

        container.innerHTML =
            _devices.map((d, i) => `
                <span style="background:#eff6ff;color:var(--hcl-blue);border:1px solid #bfdbfe;border-radius:4px;padding:3px 8px;font-size:12px;font-weight:500;display:inline-flex;align-items:center;gap:5px;">
                    ${escHtml(d)}
                    <span style="cursor:pointer;opacity:0.6;display:flex;" onclick="Workflows._removeDevice(${i})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </span>
                </span>`).join('') +
            `<input type="text" id="wf-run-modal-device-input"
                placeholder="${_devices.length ? '' : 'Type group name or IP, press Enter…'}"
                style="border:none;outline:none;font-size:13px;font-family:'Inter';flex:1;min-width:160px;background:transparent;padding:2px 4px;"
                onkeydown="Workflows._deviceKeydown(event)"
                autocomplete="off" list="wf-run-modal-group-datalist">`;
    }

    function _deviceKeydown(event) {
        const inp = event.target;
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            const val = inp.value.trim().replace(/,$/, '');
            if (val && !_devices.includes(val)) {
                _devices.push(val);
                _renderModalChips();
                setTimeout(() => {
                    const newInp = $id('wf-run-modal-device-input');
                    if (newInp) newInp.focus();
                }, 0);
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

    // ── Parameter rows ────────────────────────────────────────────────────────

    function _renderParamRows() {
        const container = $id('wf-param-rows');
        if (!container) return;

        if (!_params.length) {
            container.innerHTML = `
                <div style="font-size:12px;color:var(--text-secondary);padding:8px 0;font-style:italic;">
                    No parameters declared in this workflow script.<br>
                    Add any custom parameters below if needed.
                </div>`;
        } else {
            container.innerHTML = '';
        }

        _params.forEach((p, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;';
            row.innerHTML = `
                <div style="flex:0 0 180px;">
                    <input type="text" class="form-control" value="${escHtml(p.key)}"
                        placeholder="PARAMETER_NAME"
                        style="font-size:12px;font-family:monospace;"
                        oninput="Workflows._updateParam(${i},'key',this.value)">
                </div>
                <div style="flex:1;">
                    <input type="text" class="form-control" value="${escHtml(p.value)}"
                        placeholder="${escHtml(p.hint || 'Value…')}"
                        style="font-size:12px;"
                        oninput="Workflows._updateParam(${i},'value',this.value)">
                </div>
                <button onclick="Workflows._removeParam(${i})"
                    style="background:none;border:none;cursor:pointer;padding:6px;color:var(--text-secondary);flex-shrink:0;"
                    title="Remove parameter">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>`;
            container.appendChild(row);
        });
    }

    function addParam() {
        _params.push({ key: '', value: '', hint: '' });
        _renderParamRows();
        // Focus the new key input
        setTimeout(() => {
            const inputs = $id('wf-param-rows')?.querySelectorAll('input[type=text]');
            if (inputs?.length) inputs[inputs.length - 2].focus();
        }, 0);
    }

    function _updateParam(i, field, value) {
        if (_params[i]) _params[i][field] = value;
    }

    function _removeParam(i) {
        _params.splice(i, 1);
        _renderParamRows();
    }

    // ── Submit ────────────────────────────────────────────────────────────────

    async function submitRun() {
        if (!_workflowName) return;

        if (!_devices.length) {
            showToast('Please add at least one target device or group.', 'error');
            return;
        }

        const incident = $id('wf-run-modal-incident').value.trim().toUpperCase();
        if (!incident) {
            showToast('Incident number is required.', 'error');
            $id('wf-run-modal-incident').focus();
            return;
        }

        // Build parameters object — skip rows with empty keys
        const parameters = {};
        for (const p of _params) {
            const k = p.key.trim();
            if (k) parameters[k] = p.value;
        }

        // Validate all declared params have values
        const missing = _params.filter(p => p.key.trim() && !p.value.trim() && p.hint !== undefined);
        // (non-blocking — just warn)
        if (missing.length) {
            const names = missing.map(p => p.key).join(', ');
            if (!confirm(`Some parameters have no value: ${names}\n\nProceed anyway?`)) return;
        }

        const devices = _devices.map(d => {
            const isIp = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(d);
            return isIp ? { host: d } : { group: d };
        });

        const payload = {
            devices,
            parameters,
            incident,
            options: {
                timeout_per_device: parseInt($id('wf-run-modal-timeout').value, 10) || 300,
                max_workers:        parseInt($id('wf-run-modal-workers').value,  10) || 10,
            },
        };

        const btn = $id('wf-run-modal-submit-btn');
        btn.disabled = true;
        btn.textContent = 'Submitting…';

        const res = await API.post(`/api/workflows/${encodeURIComponent(_workflowName)}/run`, payload);

        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Workflow`;

        if (res.ok) {
            const jobId = res.data.job_id;
            showToast(`Workflow job ${jobId} submitted`, 'success');
            closeRunModal();
            jobId ? Jobs.openDetail(jobId) : Nav.go('jobs');
        } else {
            const err = res.data?.detail || res.data?.error || JSON.stringify(res.data);
            showToast(`Submit failed: ${err}`, 'error');
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

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
        openRunModal, closeRunModal, submitRun, addParam,
        _deviceKeydown, _removeDevice, _updateParam, _removeParam,
    };
})();
