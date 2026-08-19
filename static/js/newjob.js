/**
 * newjob.js — New Job submission form.
 *
 * Supports:
 *   - Run Commands mode (exec-mode + config-mode commands)
 *   - Device chip selector (group names or IPs)
 *   - Commands textarea
 *   - File Transfers section: add/remove rows, local path, remote path, post-transfer commands
 *   - Runbook mode: select and execute a runbook
 *   - Workflow mode: select a workflow, set parameters, execute  ← NEW
 *   - Options: timeout, max workers, backup config
 *
 * File transfer API contract (mirrors FileTransferEntry schema):
 *   { local_path, remote_path, post_transfer_commands: [str] | null }
 *
 * Validation rules (matching api/routes/jobs.py):
 *   - Devices required always
 *   - At least one of: commands OR file_transfers must be provided
 *   - At least one of: commands, config_mode_commands, or file_transfers required
 */
'use strict';

const NewJob = (() => {
    let _mode    = 'run';
    let _devices = [];
    let _transferCount = 0;   // monotonic counter for unique row IDs

    // Workflow mode state  ← NEW
    let _wfParams = [];       // [{key, value, hint}]

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    function onEnter() {
        _loadGroupsDatalist();
        _updateCommandsRequired();
        setMode(_mode);
    }

    // ── Mode ──────────────────────────────────────────────────────────────────

    function setMode(m) {
        _mode = m;
        $id('mode-run').classList.toggle('active',      m === 'run');
        $id('mode-runbook').classList.toggle('active',  m === 'runbook');
        $id('mode-workflow').classList.toggle('active', m === 'workflow');

        $id('config-mode-section').style.display = m === 'run'      ? '' : 'none';
        $id('runbook-section').style.display     = m === 'runbook'  ? '' : 'none';
        $id('workflow-section').style.display    = m === 'workflow' ? '' : 'none';

        // Hide commands/transfers sections in runbook and workflow modes
        const cmdTransferSection = $id('commands-transfers-section');
        if (cmdTransferSection) {
            cmdTransferSection.style.display = (m === 'runbook' || m === 'workflow') ? 'none' : '';
        }

        const modeHints = {
            run:      'Run commands on the target devices. Use Commands for exec-mode operations and Config-mode Commands for configuration changes.',
            runbook:  'Select a runbook to execute its commands on the targeted devices.',
            workflow: 'Select a workflow script to run on each targeted device. Workflows can mix local logic with device SSH steps.',
        };
        $id('mode-hint').textContent = modeHints[m] || '';

        if (m === 'runbook')  _loadRunbooksDropdown();
        if (m === 'workflow') _loadWorkflowsDropdown();

        // Relabel submit button
        const btn = $id('submit-job-btn');
        if (btn) {
            btn.innerHTML = m === 'workflow'
                ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="9 11 12 14 22 4"/></svg> Run Workflow`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Job`;
        }

        _updateCommandsRequired();
    }

    async function _loadRunbooksDropdown() {
        const sel = $id('runbook-select');
        if (!sel) return;
        sel.innerHTML = '<option value="">Loading…</option>';
        const res = await API.runbooksList();
        if (!res.ok || !res.data.runbooks) {
            sel.innerHTML = '<option value="">Failed to load runbooks</option>';
            return;
        }
        const runbooks = res.data.runbooks;
        if (!runbooks.length) {
            sel.innerHTML = '<option value="">No runbooks found in /opt/netorch/runbooks/</option>';
            return;
        }
        sel.innerHTML = '<option value="">— Select a runbook —</option>' +
            runbooks.map(rb => `<option value="${escHtml(rb.name)}" data-desc="${escHtml(rb.description || '')}" data-count="${rb.command_count}">${escHtml(rb.name)}${rb.description ? ' — ' + escHtml(rb.description) : ''}</option>`).join('');
        sel.onchange = () => {
            const opt = sel.selectedOptions[0];
            const hint = $id('runbook-desc-hint');
            if (!hint) return;
            if (opt?.value) {
                const count = opt.dataset.count;
                hint.textContent = `${count} command${count == 1 ? '' : 's'} will run on each device.`;
                hint.style.color = 'var(--text-secondary)';
            } else {
                hint.textContent = '';
            }
        };
    }

    // ── Workflow dropdown  ← NEW ──────────────────────────────────────────────

    async function _loadWorkflowsDropdown() {
        const sel = $id('workflow-select');
        if (!sel) return;
        sel.innerHTML = '<option value="">Loading…</option>';
        _wfParams = [];
        _renderWfParamRows();

        const res = await API.get('/api/workflows');
        if (!res.ok || !res.data.workflows) {
            sel.innerHTML = '<option value="">Failed to load workflows</option>';
            return;
        }
        const workflows = res.data.workflows;
        if (!workflows.length) {
            sel.innerHTML = '<option value="">No workflow scripts found in /opt/netorch/workflows/</option>';
            return;
        }

        // Store full workflow data so we can access parameters on selection
        sel._workflowData = workflows;

        sel.innerHTML = '<option value="">— Select a workflow —</option>' +
            workflows.map(wf => `<option value="${escHtml(wf.name)}">${escHtml(wf.name)}${wf.description ? ' — ' + escHtml(wf.description) : ''}</option>`).join('');

        sel.onchange = async () => {
            const selectedName = sel.value;
            const hint = $id('workflow-desc-hint');
            if (!selectedName) {
                if (hint) hint.textContent = '';
                _wfParams = [];
                _renderWfParamRows();
                return;
            }

            // Fetch full metadata to get declared parameters
            const wfRes = await API.get(`/api/workflows/${encodeURIComponent(selectedName)}`);
            if (wfRes.ok) {
                const wf = wfRes.data;
                if (hint) {
                    const paramCount = (wf.parameters || []).length;
                    hint.textContent = paramCount
                        ? `${paramCount} declared parameter${paramCount !== 1 ? 's' : ''} — fill in values below.`
                        : 'No parameters declared in workflow YAML.';
                    hint.style.color = 'var(--text-secondary)';
                }
                _wfParams = (wf.parameters || []).map(p => ({
                    key:   typeof p === 'string' ? p : (p.name || String(p)),
                    value: '',
                    hint:  '',
                }));
            } else {
                _wfParams = [];
            }
            _renderWfParamRows();
        };
    }

    function _renderWfParamRows() {
        const container = $id('wf-param-rows-newjob');
        if (!container) return;

        container.innerHTML = '';

        if (!_wfParams.length) {
            container.innerHTML = `
                <div style="font-size:12px;color:var(--text-secondary);padding:4px 0;font-style:italic;">
                    No parameters declared. Add custom parameters below if needed.
                </div>`;
            return;
        }

        _wfParams.forEach((p, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;';
            row.innerHTML = `
                <div style="flex:0 0 180px;">
                    <input type="text" class="form-control" value="${escHtml(p.key)}"
                        placeholder="PARAMETER_NAME"
                        style="font-size:12px;font-family:monospace;"
                        oninput="NewJob._wfUpdateParam(${i},'key',this.value)">
                </div>
                <div style="flex:1;">
                    <input type="text" class="form-control" value="${escHtml(p.value)}"
                        placeholder="${escHtml(p.hint || 'Value…')}"
                        style="font-size:12px;"
                        oninput="NewJob._wfUpdateParam(${i},'value',this.value)">
                </div>
                <button onclick="NewJob._wfRemoveParam(${i})"
                    style="background:none;border:none;cursor:pointer;padding:6px;color:var(--text-secondary);flex-shrink:0;" title="Remove">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>`;
            container.appendChild(row);
        });
    }

    function addWfParam() {
        _wfParams.push({ key: '', value: '', hint: '' });
        _renderWfParamRows();
        setTimeout(() => {
            const inputs = $id('wf-param-rows-newjob')?.querySelectorAll('input[type=text]');
            if (inputs?.length) inputs[inputs.length - 2].focus();
        }, 0);
    }

    function _wfUpdateParam(i, field, value) {
        if (_wfParams[i]) _wfParams[i][field] = value;
    }

    function _wfRemoveParam(i) {
        _wfParams.splice(i, 1);
        _renderWfParamRows();
    }

    // ── Device chip selector ──────────────────────────────────────────────────

    function deviceKeydown(event) {
        const inp = event.target;
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            const val = inp.value.trim().replace(/,$/, '');
            if (val && !_devices.includes(val)) {
                _devices.push(val);
                _renderChips();
            }
            inp.value = '';
        }
        if (event.key === 'Backspace' && !inp.value && _devices.length) {
            _devices.pop();
            _renderChips();
        }
    }

    function _renderChips() {
        const container = $id('device-chips');
        container.innerHTML =
            _devices.map((d, i) => `
                <span style="background:#eff6ff;color:var(--hcl-blue);border:1px solid #bfdbfe;border-radius:4px;padding:3px 8px;font-size:12px;font-weight:500;display:inline-flex;align-items:center;gap:5px;">
                    ${escHtml(d)}
                    <span style="cursor:pointer;opacity:0.6;display:flex;" onclick="NewJob.removeDevice(${i})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </span>
                </span>`).join('') +
            `<input type="text" id="device-input"
                placeholder="${_devices.length ? '' : 'Type group name or IP, press Enter to add…'}"
                style="border:none;outline:none;font-size:13px;font-family:'Inter';flex:1;min-width:160px;background:transparent;padding:2px 4px;"
                onkeydown="NewJob.deviceKeydown(event)"
                autocomplete="off" list="group-datalist">`;
    }

    function removeDevice(i) {
        _devices.splice(i, 1);
        _renderChips();
        $id('device-input')?.focus();
    }

    function clearDevices() {
        _devices = [];
        _renderChips();
    }

    async function loadGroupsDropdown() {
        const res = await API.inventoryGroups();
        if (!res.ok) { showToast('Could not load groups', 'error'); return; }
        const groups = res.data.groups || res.data || [];
        let added = 0;
        groups.forEach(g => { if (!_devices.includes(g)) { _devices.push(g); added++; } });
        if (added) { _renderChips(); showToast(`Added ${added} group${added !== 1 ? 's' : ''}`, 'success'); }
        else showToast('All groups already added', 'info');
    }

    async function _loadGroupsDatalist() {
        const res = await API.inventoryGroups();
        if (!res.ok) return;
        const groups = res.data.groups || res.data || [];
        const dl = $id('group-datalist');
        if (dl) dl.innerHTML = groups.map(g => `<option value="${escHtml(g)}">`).join('');
    }

    function prefillHost(host) {
        if (!_devices.includes(host)) _devices.push(host);
        _renderChips();
    }

    // ── File Transfers ────────────────────────────────────────────────────────

    function addTransfer() {
        const tpl   = $id('transfer-row-tpl');
        const list  = $id('transfer-list');
        const empty = $id('transfer-empty');

        const clone = tpl.content.cloneNode(true);
        const row   = clone.querySelector('.transfer-row');
        const id    = ++_transferCount;
        row.dataset.tid = id;

        const badge = row.querySelector('.transfer-num');
        badge.textContent = _getTransferRows().length + 1;

        list.insertBefore(clone, empty);
        empty.style.display = 'none';

        row.querySelector('.transfer-local')?.focus();
        _updateCommandsRequired();
    }

    function removeTransfer(btn) {
        const row = btn.closest('.transfer-row');
        row.remove();

        _getTransferRows().forEach((r, i) => {
            const badge = r.querySelector('.transfer-num');
            if (badge) badge.textContent = i + 1;
        });

        if (_getTransferRows().length === 0) {
            $id('transfer-empty').style.display = '';
        }

        _updateCommandsRequired();
    }

    function _getTransferRows() {
        return Array.from($id('transfer-list').querySelectorAll('.transfer-row'));
    }

    function _readTransfers() {
        return _getTransferRows().map(row => {
            const localPath  = row.querySelector('.transfer-local')?.value.trim()  || '';
            const remotePath = row.querySelector('.transfer-remote')?.value.trim() || '';
            const postRaw    = row.querySelector('.transfer-post-cmds')?.value.trim() || '';
            const postCmds   = postRaw
                ? postRaw.split('\n').map(l => l.trim()).filter(Boolean)
                : null;
            return { local_path: localPath, remote_path: remotePath, post_transfer_commands: postCmds };
        });
    }

    function _updateCommandsRequired() {
        const hasTransfers = _getTransferRows().length > 0;
        const star  = $id('cmd-required-star');
        const hint  = $id('cmd-hint');
        if (star) star.style.display = hasTransfers ? 'none' : '';
        if (hint) hint.textContent = hasTransfers
            ? 'Optional when file transfers are present. Commands run after file transfer.'
            : 'One command per line. Runs on every targeted device.';
    }

    // ── Submit ────────────────────────────────────────────────────────────────

    async function submit() {
        if (_mode === 'runbook')  return _submitRunbook();
        if (_mode === 'workflow') return _submitWorkflow();   // ← NEW

        // Validation
        if (!_devices.length) {
            showToast('Add at least one target device or group', 'error'); return;
        }

        const cmds      = $id('job-commands').value.trim();
        const transfers = _readTransfers();
        const hasTransfers = transfers.length > 0;

        if (!cmds && !hasTransfers) {
            showToast('Commands are required (or add at least one file transfer)', 'error'); return;
        }

        for (let i = 0; i < transfers.length; i++) {
            if (!transfers[i].local_path)  { showToast(`File transfer ${i + 1}: Local path is required`, 'error');  return; }
            if (!transfers[i].remote_path) { showToast(`File transfer ${i + 1}: Remote path is required`, 'error'); return; }
        }

        const payload = {
            mode:    _mode,
            devices: _devices.map(d => {
                const isIp = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(d) || /^[0-9a-f:]+$/i.test(d);
                return isIp ? { host: d } : { group: d };
            }),
            commands: cmds ? cmds.split('\n').map(l => l.trim()).filter(Boolean) : [],
            options: {
                timeout_per_device: parseInt($id('opt-timeout').value, 10) || 30,
                max_workers:        parseInt($id('opt-workers').value,  10) || 20,
                backup_config_before_change: $id('opt-backup').checked,
            },
        };

        if (hasTransfers) payload.file_transfers = transfers;

        const cfgCmds = $id('job-config-mode-commands').value.trim();
        if (cfgCmds) {
            payload.config_mode_commands = cfgCmds.split('\n').map(l => l.trim()).filter(Boolean);
        }

        const btn = $id('submit-job-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="dot-running"></span> Submitting…';

        const res = await API.jobSubmit(payload);
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Job`;

        if (res.ok) {
            const jobId = res.data.job_id || res.data.id;
            showToast(`Job ${jobId} submitted`, 'success');
            reset();
            jobId ? Jobs.openDetail(jobId) : Nav.go('jobs');
        } else if (isDeviceBusy(res)) {
            showDeviceBusyModal(res.data.detail, submit);
        } else {
            let err = res.data?.detail || res.data?.error || res.data?.message;
            if (!err && res.status === 0) err = 'Cannot reach netorch API — is it running?';
            if (!err && res.status >= 500) err = `Server error (HTTP ${res.status}) — check journalctl -u netorch`;
            if (!err) err = JSON.stringify(res.data);
            if (typeof err !== 'string') err = JSON.stringify(err);
            showToast(`Submit failed: ${err}`, 'error');
        }
    }

    // ── Runbook submit ────────────────────────────────────────────────────────

    async function _submitRunbook() {
        if (!_devices.length) {
            showToast('Add at least one target device or group', 'error'); return;
        }
        const sel = $id('runbook-select');
        const rbName = sel ? sel.value : '';
        if (!rbName) { showToast('Please select a runbook', 'error'); return; }

        const payload = {
            devices: _devices.map(d => {
                const isIp = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(d);
                return isIp ? { host: d } : { group: d };
            }),
            options: {
                timeout_per_device: parseInt($id('opt-timeout').value, 10) || 30,
                max_workers:        parseInt($id('opt-workers').value,  10) || 20,
            },
        };

        const btn = $id('submit-job-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="dot-running"></span> Submitting…';

        const res = await API.runbookRun(rbName, payload);
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Job`;

        if (res.ok) {
            const jobId = res.data.job_id;
            showToast(`Runbook job ${jobId} submitted`, 'success');
            reset();
            jobId ? Jobs.openDetail(jobId) : Nav.go('jobs');
        } else if (isDeviceBusy(res)) {
            showDeviceBusyModal(res.data.detail, submit);
        } else {
            let err = res.data?.detail || res.data?.error || JSON.stringify(res.data);
            if (typeof err !== 'string') err = JSON.stringify(err);
            showToast(`Submit failed: ${err}`, 'error');
        }
    }

    // ── Workflow submit  ← NEW ────────────────────────────────────────────────

    async function _submitWorkflow() {
        if (!_devices.length) {
            showToast('Add at least one target device or group', 'error'); return;
        }
        const sel = $id('workflow-select');
        const wfName = sel ? sel.value : '';
        if (!wfName) { showToast('Please select a workflow script', 'error'); return; }

        // Build parameters dict — skip rows with empty keys
        const parameters = {};
        for (const p of _wfParams) {
            const k = p.key.trim();
            if (k) parameters[k] = p.value;
        }

        const payload = {
            devices: _devices.map(d => {
                const isIp = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(d);
                return isIp ? { host: d } : { group: d };
            }),
            parameters,
            options: {
                timeout_per_device: parseInt($id('opt-wf-timeout').value, 10) || 300,
                max_workers:        parseInt($id('opt-wf-workers').value,  10) || 10,
            },
        };

        const btn = $id('submit-job-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="dot-running"></span> Submitting…';

        const res = await API.post(`/api/workflows/${encodeURIComponent(wfName)}/run`, payload);
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="9 11 12 14 22 4"/></svg> Run Workflow`;

        if (res.ok) {
            const jobId = res.data.job_id;
            showToast(`Workflow job ${jobId} submitted`, 'success');
            reset();
            jobId ? Jobs.openDetail(jobId) : Nav.go('jobs');
        } else if (isDeviceBusy(res)) {
            showDeviceBusyModal(res.data.detail, submit);
        } else {
            let err = res.data?.detail || res.data?.error || JSON.stringify(res.data);
            if (typeof err !== 'string') err = JSON.stringify(err);
            showToast(`Submit failed: ${err}`, 'error');
        }
    }

    // ── Reset ─────────────────────────────────────────────────────────────────

    function reset() {
        _mode    = 'run';
        _devices = [];
        _wfParams = [];
        setMode('run');
        _renderChips();
        $id('job-commands').value              = '';
        $id('job-config-mode-commands').value  = '';
        $id('opt-backup').checked             = true;
        $id('opt-timeout').value              = '30';
        $id('opt-workers').value              = '20';
        const rbSel = $id('runbook-select');
        if (rbSel) rbSel.value = '';
        const rbHint = $id('runbook-desc-hint');
        if (rbHint) rbHint.textContent = '';
        const wfSel = $id('workflow-select');
        if (wfSel) wfSel.value = '';
        const wfHint = $id('workflow-desc-hint');
        if (wfHint) wfHint.textContent = '';

        _getTransferRows().forEach(r => r.remove());
        $id('transfer-empty').style.display = '';
        _updateCommandsRequired();
        _renderWfParamRows();
    }

    return {
        onEnter,
        setMode,
        deviceKeydown, removeDevice, clearDevices,
        loadGroupsDropdown, prefillHost,
        addTransfer, removeTransfer,
        addWfParam, _wfUpdateParam, _wfRemoveParam,
        submit, reset,
    };
})();
