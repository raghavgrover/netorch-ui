/**
 * newjob.js — New Job submission form.
 *
 * Supports:
 *   - Audit / Remediate mode
 *   - Device chip selector (group names or IPs)
 *   - Commands textarea
 *   - File Transfers section: add/remove rows, local path, remote path, post-transfer commands
 *   - Options: timeout, max workers, backup config
 *
 * File transfer API contract (mirrors FileTransferEntry schema):
 *   { local_path, remote_path, post_transfer_commands: [str] | null }
 *
 * Validation rules (matching api/routes/jobs.py):
 *   - Devices required always
 *   - At least one of: commands OR file_transfers must be provided
 *   - In remediate mode: remediation_commands OR file_transfers required
 */
'use strict';

const NewJob = (() => {
    let _mode    = 'audit';
    let _devices = [];
    let _transferCount = 0;   // monotonic counter for unique row IDs

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    function onEnter() {
        _loadGroupsDatalist();
        _updateCommandsRequired();
    }

    // ── Mode ──────────────────────────────────────────────────────────────────

    function setMode(m) {
        _mode = m;
        $id('mode-audit').classList.toggle('active',     m === 'audit');
        $id('mode-remediate').classList.toggle('active', m === 'remediate');
        $id('mode-runbook').classList.toggle('active',   m === 'runbook');
        $id('remediate-section').style.display = m === 'remediate' ? '' : 'none';
        $id('runbook-section').style.display   = m === 'runbook'   ? '' : 'none';

        // Hide commands/transfers sections in runbook mode (runbook provides commands)
        const cmdTransferSection = $id('commands-transfers-section');
        if (cmdTransferSection) cmdTransferSection.style.display = m === 'runbook' ? 'none' : '';

        $id('mode-hint').textContent = m === 'audit'
            ? 'Audit mode only reads device state — no configuration changes are made.'
            : m === 'remediate'
            ? '⚠ Remediate mode will push configuration changes to devices. Use with caution.'
            : 'Select a runbook to execute its commands on the targeted devices.';

        if (m === 'runbook') _loadRunbooksDropdown();
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

        // Clone template
        const clone = tpl.content.cloneNode(true);
        const row   = clone.querySelector('.transfer-row');
        const id    = ++_transferCount;
        row.dataset.tid = id;

        // Update row number badge
        const badge = row.querySelector('.transfer-num');
        badge.textContent = _getTransferRows().length + 1;

        list.insertBefore(clone, empty);
        empty.style.display = 'none';

        // Focus the first input in the new row
        row.querySelector('.transfer-local')?.focus();

        // Re-evaluate whether commands field is still required
        _updateCommandsRequired();
    }

    function removeTransfer(btn) {
        const row = btn.closest('.transfer-row');
        row.remove();

        // Re-number remaining rows
        _getTransferRows().forEach((r, i) => {
            const badge = r.querySelector('.transfer-num');
            if (badge) badge.textContent = i + 1;
        });

        // Show empty state if no rows left
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

    /** Commands field is required ONLY when no file transfers are defined */
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
        // Runbook mode has its own submit path
        if (_mode === 'runbook') {
            return _submitRunbook();
        }

        // Validation
        if (!_devices.length) {
            showToast('Add at least one target device or group', 'error'); return;
        }

        const cmds      = $id('job-commands').value.trim();
        const transfers = _readTransfers();
        const hasTransfers = transfers.length > 0;

        // Commands required unless file transfers present
        if (!cmds && !hasTransfers) {
            showToast('Commands are required (or add at least one file transfer)', 'error'); return;
        }

        // Validate transfer rows have required fields
        for (let i = 0; i < transfers.length; i++) {
            if (!transfers[i].local_path) {
                showToast(`File transfer ${i + 1}: Local path is required`, 'error'); return;
            }
            if (!transfers[i].remote_path) {
                showToast(`File transfer ${i + 1}: Remote path is required`, 'error'); return;
            }
        }

        // Build payload
        const payload = {
            mode:    _mode,
            devices: _devices.map(d => {
                const isIp = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(d) || /^[0-9a-f:]+$/i.test(d);
                return isIp ? { host: d } : { group: d };
            }),
            commands: cmds ? cmds.split('\n').map(l => l.trim()).filter(Boolean) : [],
            options: {
                timeout_per_device: parseInt($id('opt-timeout').value, 10) || 30,
                max_workers:        parseInt($id('opt-workers').value, 10)  || 20,
                backup_config_before_change: $id('opt-backup').checked,
            },
        };

        if (hasTransfers) {
            payload.file_transfers = transfers;
        }

        if (_mode === 'remediate') {
            const remCmds = $id('job-remediation-commands').value.trim();
            // In remediate mode: remediation_commands required UNLESS file transfers present
            if (!remCmds && !hasTransfers) {
                showToast('Remediation commands are required in Remediate mode (or add file transfers)', 'error'); return;
            }
            if (remCmds) {
                payload.remediation_commands = remCmds.split('\n').map(l => l.trim()).filter(Boolean);
            }
        }

        const btn = $id('submit-job-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="dot-running"></span> Submitting…';

        const res = await API.jobSubmit(payload);
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Submit Job`;

        if (res.ok) {
            const jobId = res.data.job_id || res.data.id;
            showToast(`Job ${jobId} submitted`, 'success');
            reset();
            jobId ? Jobs.openDetail(jobId) : Nav.go('jobs');
        } else {
            let err = res.data?.detail || res.data?.error || res.data?.message;
            if (!err && res.status === 0) err = 'Cannot reach netorch API — is it running?';
            if (!err && res.status >= 500) err = `Server error (HTTP ${res.status}) — check journalctl -u netorch`;
            if (!err) err = JSON.stringify(res.data);
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
        if (!rbName) {
            showToast('Please select a runbook', 'error'); return;
        }

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
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Submit Job`;

        if (res.ok) {
            const jobId = res.data.job_id;
            showToast(`Runbook job ${jobId} submitted`, 'success');
            reset();
            jobId ? Jobs.openDetail(jobId) : Nav.go('jobs');
        } else {
            const err = res.data?.detail || res.data?.error || JSON.stringify(res.data);
            showToast(`Submit failed: ${err}`, 'error');
        }
    }

    // ── Reset ─────────────────────────────────────────────────────────────────

    function reset() {
        _mode    = 'audit';
        _devices = [];
        setMode('audit');
        _renderChips();
        $id('job-commands').value             = '';
        $id('job-remediation-commands').value = '';
        $id('opt-backup').checked             = true;
        $id('opt-timeout').value              = '30';
        $id('opt-workers').value              = '20';
        const sel = $id('runbook-select');
        if (sel) sel.value = '';
        const hint = $id('runbook-desc-hint');
        if (hint) hint.textContent = '';

        // Remove all transfer rows
        _getTransferRows().forEach(r => r.remove());
        $id('transfer-empty').style.display = '';
        _updateCommandsRequired();
    }

    return {
        onEnter,
        setMode,
        deviceKeydown, removeDevice, clearDevices,
        loadGroupsDropdown, prefillHost,
        addTransfer, removeTransfer,
        submit, reset,
    };
})();
