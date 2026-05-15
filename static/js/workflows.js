/**
 * workflows.js — Workflows page (YAML-based).
 *
 * Full-width table layout matching the Runbooks page.
 * Three modals: View (read-only Code/Steps), Edit (editable Code/Steps), New.
 * Run modal: device chip selector + per-parameter inputs.
 */
'use strict';

const Workflows = (() => {
    // ── State ─────────────────────────────────────────────────────────────────
    let _workflows   = [];
    let _uploadFiles = [];

    // Modal-specific mode state ('code' | 'steps')
    let _vMode_st = 'code';   // view modal
    let _eMode_st = 'code';   // edit modal
    let _nMode_st = 'code';   // new modal

    // Current filename open in view/edit modals
    let _viewFilename = null;
    let _editFilename = null;

    // Run modal state
    let _runFilename = null;
    let _runDevices  = [];
    let _runParams   = {};

    // ── Context helper ────────────────────────────────────────────────────────
    // ctx: 'v' (view), 'e' (edit), 'n' (new)

    const _IDS = {
        v: { ta:'wf-v-ta', codePn:'wf-v-code-pane', stepsPn:'wf-v-steps-pane',
             err:'wf-v-steps-err', params:'wf-v-params', vars:null,
             stepsEl:'wf-v-steps', addWrap:null,
             btnCode:'wf-v-btn-code', btnSteps:'wf-v-btn-steps' },
        e: { ta:'wf-e-ta', codePn:'wf-e-code-pane', stepsPn:'wf-e-steps-pane',
             err:'wf-e-steps-err', params:'wf-e-params', vars:'wf-e-vars',
             stepsEl:'wf-e-steps', addWrap:'wf-e-add-wrap',
             btnCode:'wf-e-btn-code', btnSteps:'wf-e-btn-steps',
             menu:'wf-e-add-menu' },
        n: { ta:'wf-n-ta', codePn:'wf-n-code-pane', stepsPn:'wf-n-steps-pane',
             err:'wf-n-steps-err', params:'wf-n-params', vars:'wf-n-vars',
             stepsEl:'wf-n-steps', addWrap:'wf-n-add-wrap',
             btnCode:'wf-n-btn-code', btnSteps:'wf-n-btn-steps',
             menu:'wf-n-add-menu' },
    };
    function _c(ctx, key) { return _IDS[ctx]?.[key]; }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    function load() { _fetchWorkflows(); }

    // ── Data fetch ────────────────────────────────────────────────────────────

    async function _fetchWorkflows() {
        const wrap = $id('workflows-list-wrap');
        if (wrap) wrap.innerHTML = '<div class="loading-row">Loading workflows…</div>';

        const res = await API.get('/api/workflows');
        if (!res.ok) {
            if (wrap) wrap.innerHTML =
                `<div class="empty-state"><p>Failed to load workflows: ${res.data?.error || 'API error'}</p></div>`;
            return;
        }
        _workflows = res.data.workflows || [];
        const el = $id('wf-count');
        if (el) el.textContent = `${_workflows.length} workflow${_workflows.length !== 1 ? 's' : ''}`;
        _render();
    }

    // ── Table render ──────────────────────────────────────────────────────────

    function _render() {
        const wrap = $id('workflows-list-wrap');
        if (!wrap) return;

        if (!_workflows.length) {
            wrap.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40" style="color:var(--text-secondary);margin-bottom:12px;">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <p style="font-size:14px;font-weight:600;color:var(--text-primary);">No workflows found</p>
                    <p style="font-size:12px;color:var(--text-secondary);">Click <strong>+ New Workflow</strong> to create one.</p>
                </div>`;
            return;
        }

        wrap.innerHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Workflow</th>
                        <th>Description</th>
                        <th style="width:70px;text-align:right;">Steps</th>
                        <th style="width:160px;">Actions</th>
                        <th style="width:70px;"></th>
                    </tr>
                </thead>
                <tbody>
                    ${_workflows.map(wf => `
                        <tr>
                            <td>
                                <div style="font-weight:600;font-size:13px;">${escHtml(wf.name)}</div>
                                <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${escHtml(wf.filename)}</div>
                            </td>
                            <td style="color:var(--text-secondary);font-size:12px;"
                                title="${escHtml(wf.description || '')}">${escHtml(_truncate(wf.description || '—', 80))}</td>
                            <td style="text-align:right;font-size:13px;">${(wf.steps || []).length}</td>
                            <td>
                                <div style="display:flex;gap:4px;">
                                    <button class="btn btn-outline btn-icon" title="View workflow"
                                        onclick="Workflows.openViewModal('${escHtml(wf.filename)}')">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                                        </svg>
                                    </button>
                                    <button class="btn btn-outline" style="font-size:12px;padding:5px 10px;"
                                        onclick="Workflows.openEditModal('${escHtml(wf.filename)}')">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" style="margin-right:4px;vertical-align:middle;">
                                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                        </svg>Edit
                                    </button>
                                    <button class="btn btn-danger" style="font-size:12px;padding:5px 10px;"
                                        onclick="Workflows._deleteWorkflow('${escHtml(wf.filename)}')">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" style="margin-right:4px;vertical-align:middle;">
                                            <polyline points="3 6 5 6 21 6"/>
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                                        </svg>Delete
                                    </button>
                                </div>
                            </td>
                            <td style="text-align:right;">
                                <button class="btn btn-primary" style="font-size:12px;padding:5px 12px;"
                                    onclick="Workflows._openRunModal('${escHtml(wf.filename)}')">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                    Run
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    }

    // ── View Modal ────────────────────────────────────────────────────────────

    async function openViewModal(filename) {
        _viewFilename = filename;
        _vMode_st = 'code';
        $id('wf-view-title').textContent = filename;
        $id('wf-v-ta').value = 'Loading…';
        _setPaneMode('v', 'code');
        openModal('wf-view-modal');

        const res = await API.get(`/api/workflows/${encodeURIComponent(filename)}`);
        if (!res.ok) {
            $id('wf-v-ta').value = `# Error loading workflow: ${res.data?.error || 'API error'}`;
            return;
        }
        $id('wf-v-ta').value = res.data.raw_content || '';
    }

    function _vMode(mode) {
        if (mode === 'steps') {
            const yaml = $id('wf-v-ta')?.value || '';
            const err = $id(_c('v','err'));
            try {
                jsyaml.load(yaml);
                if (err) err.style.display = 'none';
                _renderStepsReadOnly('v');
            } catch(e) {
                if (err) { err.textContent = `YAML error: ${e.message}`; err.style.display = ''; }
            }
        }
        _vMode_st = mode;
        _setPaneMode('v', mode);
    }

    function _runFromView() {
        if (!_viewFilename) return;
        closeModal('wf-view-modal');
        _openRunModal(_viewFilename);
    }

    // ── Edit Modal ────────────────────────────────────────────────────────────

    async function openEditModal(filename) {
        _editFilename = filename;
        _eMode_st = 'code';
        $id('wf-edit-title').textContent = `Edit — ${filename}`;
        $id('wf-e-ta').value = 'Loading…';
        const saveBtn = $id('wf-edit-save-btn');
        if (saveBtn) saveBtn.disabled = true;
        _setPaneMode('e', 'code');
        openModal('wf-edit-modal');

        const res = await API.get(`/api/workflows/${encodeURIComponent(filename)}`);
        if (!res.ok) {
            $id('wf-e-ta').value = `# Error: ${res.data?.error || 'API error'}`;
            return;
        }
        $id('wf-e-ta').value = res.data.raw_content || '';
        if (saveBtn) saveBtn.disabled = false;
    }

    function _eMode(mode) {
        if (mode === 'steps' && _eMode_st === 'code') {
            const yaml = $id('wf-e-ta')?.value || '';
            try { jsyaml.load(yaml); }
            catch(e) { showToast(`YAML error: ${e.message}`, 'error'); return; }
            _renderStepsEditable('e');
        }
        if (mode === 'code' && _eMode_st === 'steps') {
            // textarea is already up-to-date (mutations write back immediately)
        }
        _eMode_st = mode;
        _setPaneMode('e', mode);
    }

    async function saveEdit() {
        if (!_editFilename) return;
        const content = $id('wf-e-ta')?.value || '';
        const btn = $id('wf-edit-save-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

        const res = await API.workflowSave(_editFilename, content);

        if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
        if (res.ok) {
            closeModal('wf-edit-modal');
            showToast(`Saved ${_editFilename}`, 'success');
            _fetchWorkflows();
        } else {
            showToast(`Save failed: ${res.data?.detail || res.data?.error || 'Unknown error'}`, 'error');
        }
    }

    // ── New Workflow Modal ────────────────────────────────────────────────────

    function openNew() {
        _nMode_st = 'code';
        $id('wf-new-filename').value = '';
        const defaultYaml = [
            'name: My Workflow',
            'description: What this workflow does',
            'parameters: []',
            'vars: {}',
            'steps:',
            '  - name: Step 1',
            '    type: device_commands',
            '    commands:',
            '      - show version',
        ].join('\n') + '\n';
        $id('wf-n-ta').value = defaultYaml;
        const btn = $id('wf-new-save-btn');
        if (btn) { btn.disabled = false; btn.textContent = 'Create Workflow'; }
        _setPaneMode('n', 'code');
        openModal('modal-wf-new');
        setTimeout(() => $id('wf-new-filename')?.focus(), 100);
    }

    function _nMode(mode) {
        if (mode === 'steps' && _nMode_st === 'code') {
            const yaml = $id('wf-n-ta')?.value || '';
            try { jsyaml.load(yaml); }
            catch(e) { showToast(`YAML error: ${e.message}`, 'error'); return; }
            _renderStepsEditable('n');
        }
        _nMode_st = mode;
        _setPaneMode('n', mode);
    }

    async function saveNew() {
        const filename = $id('wf-new-filename')?.value.trim();
        if (!filename) { showToast('Filename is required', 'error'); return; }
        if (!filename.endsWith('.yaml')) { showToast('Filename must end with .yaml', 'error'); return; }

        const content = $id('wf-n-ta')?.value || '';
        const btn = $id('wf-new-save-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }

        const res = await API.workflowCreate(filename, content);

        if (btn) { btn.disabled = false; btn.textContent = 'Create Workflow'; }
        if (res.ok) {
            closeModal('modal-wf-new');
            showToast(`Created ${filename}`, 'success');
            _fetchWorkflows();
        } else {
            showToast(`Create failed: ${res.data?.detail || res.data?.error || 'Unknown error'}`, 'error');
        }
    }

    // ── Pane toggle helper ────────────────────────────────────────────────────

    function _setPaneMode(ctx, mode) {
        const codePn  = $id(_c(ctx,'codePn'));
        const stepsPn = $id(_c(ctx,'stepsPn'));
        const btnCode  = $id(_c(ctx,'btnCode'));
        const btnSteps = $id(_c(ctx,'btnSteps'));
        if (codePn)  codePn.style.display  = mode === 'code'  ? '' : 'none';
        if (stepsPn) stepsPn.style.display  = mode === 'steps' ? '' : 'none';
        if (btnCode)  btnCode.classList.toggle('active',  mode === 'code');
        if (btnSteps) btnSteps.classList.toggle('active', mode === 'steps');
    }

    // ── Read-only step rendering (View modal) ─────────────────────────────────

    function _renderStepsReadOnly(ctx) {
        const yaml = $id(_c(ctx,'ta'))?.value || '';
        let doc = {};
        try { doc = jsyaml.load(yaml) || {}; } catch(_) { return; }

        // Params
        const paramsEl = $id(_c(ctx,'params'));
        if (paramsEl) {
            const params = doc.parameters || [];
            paramsEl.innerHTML = params.length
                ? `<div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">PARAMETERS</div>
                   <div style="display:flex;flex-wrap:wrap;gap:6px;">
                       ${params.map(p => `<span style="background:#eff6ff;color:var(--hcl-blue);border:1px solid #bfdbfe;border-radius:4px;padding:3px 10px;font-size:12px;font-weight:500;">${escHtml(String(p))}</span>`).join('')}
                   </div>`
                : '';
        }

        const stepsEl = $id(_c(ctx,'stepsEl'));
        if (!stepsEl) return;
        const steps = doc.steps || [];
        if (!steps.length) {
            stepsEl.innerHTML = '<div style="color:var(--text-secondary);font-size:12px;font-style:italic;">No steps defined.</div>';
            return;
        }
        stepsEl.innerHTML = steps.map((step, i) => _stepCardRO(step, i)).join('');
    }

    function _stepCardRO(step, idx) {
        const type = step.type || '—';
        let details = '';
        if (type === 'device_commands' || type === 'device_config') {
            details = `<div style="font-family:monospace;font-size:12px;background:#f8fafc;border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-top:8px;white-space:pre-wrap;">${escHtml((step.commands || []).join('\n'))}</div>`;
        } else if (type === 'file_transfer') {
            details = `<div style="font-size:12px;margin-top:6px;"><span style="color:var(--text-secondary);">Local:</span> <code>${escHtml(step.local_path||'')}</code> → <span style="color:var(--text-secondary);">Remote:</span> <code>${escHtml(step.remote_path||'')}</code></div>`;
        } else if (type === 'device_runbook') {
            details = `<div style="font-size:12px;margin-top:6px;"><span style="color:var(--text-secondary);">Runbook:</span> <code>${escHtml(step.runbook||'')}</code></div>`;
        } else if (type === 'shell') {
            details = `<div style="font-size:12px;margin-top:6px;"><span style="color:var(--text-secondary);">run:</span> <strong>${escHtml(step.run||'')}</strong></div>
                       <div style="font-family:monospace;font-size:12px;background:#f8fafc;border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-top:6px;white-space:pre-wrap;">${escHtml(step.script||'')}</div>`;
        }
        return `
            <div class="section-card" style="padding:12px 16px;margin-bottom:8px;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:11px;font-weight:600;color:var(--text-secondary);flex-shrink:0;">Step ${idx+1}</span>
                    <span style="font-weight:600;font-size:13px;flex:1;">${escHtml(step.name||'')}</span>
                    <span style="font-size:11px;background:var(--bg-hover);border-radius:4px;padding:2px 8px;color:var(--text-secondary);">${escHtml(type)}</span>
                </div>
                ${details}
            </div>`;
    }

    // ── Editable step rendering (Edit / New modals) ───────────────────────────

    function _renderStepsEditable(ctx) {
        const yaml = $id(_c(ctx,'ta'))?.value || '';
        let doc = {};
        const errEl = $id(_c(ctx,'err'));
        try {
            doc = jsyaml.load(yaml) || {};
            if (errEl) errEl.style.display = 'none';
        } catch(e) {
            if (errEl) { errEl.textContent = `YAML error: ${e.message}`; errEl.style.display = ''; }
            return;
        }

        // Parameters
        const paramsEl = $id(_c(ctx,'params'));
        if (paramsEl) {
            const params = doc.parameters || [];
            paramsEl.innerHTML = `
                <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">PARAMETERS</div>
                <div id="${ctx}-param-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
                    ${params.map((p,i) => `
                        <div style="background:#eff6ff;color:var(--hcl-blue);border:1px solid #bfdbfe;border-radius:4px;padding:3px 8px;font-size:12px;font-weight:500;display:inline-flex;align-items:center;gap:6px;">
                            <input type="text" value="${escHtml(String(p))}" style="background:transparent;border:none;outline:none;font-size:12px;color:inherit;width:${Math.max(80,String(p).length*8)}px;"
                                onchange="Workflows._updateParam('${ctx}',${i},this.value)">
                            <span style="cursor:pointer;opacity:.6;" onclick="Workflows._removeParam('${ctx}',${i})">×</span>
                        </div>`).join('')}
                </div>
                <button class="btn btn-outline" style="font-size:12px;padding:4px 10px;"
                    onclick="Workflows._addParam('${ctx}')">+ Add Parameter</button>`;
        }

        // Vars
        const varsEl = _c(ctx,'vars') ? $id(_c(ctx,'vars')) : null;
        if (varsEl) {
            const wfVars = doc.vars || {};
            const entries = Object.entries(wfVars);
            varsEl.innerHTML = `
                <details style="margin-top:8px;">
                    <summary style="cursor:pointer;font-size:12px;font-weight:600;color:var(--text-secondary);padding:4px 0;text-transform:uppercase;letter-spacing:.04em;">
                        Global Variables (${entries.length})
                    </summary>
                    <div style="margin-top:8px;">
                        ${entries.map(([k,v],i) => `
                            <div style="display:flex;gap:8px;margin-bottom:6px;">
                                <input type="text" class="form-control" value="${escHtml(k)}" placeholder="KEY"
                                    style="flex:0 0 150px;font-size:12px;font-family:monospace;"
                                    onchange="Workflows._updateVar('${ctx}',${i},'key',this.value)">
                                <input type="text" class="form-control" value="${escHtml(String(v))}" placeholder="value"
                                    style="flex:1;font-size:12px;"
                                    onchange="Workflows._updateVar('${ctx}',${i},'value',this.value)">
                                <button class="btn btn-danger btn-icon" onclick="Workflows._removeVar('${ctx}',${i})">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </button>
                            </div>`).join('')}
                        <button class="btn btn-outline" style="font-size:12px;padding:4px 10px;margin-top:4px;"
                            onclick="Workflows._addVar('${ctx}')">+ Add Variable</button>
                    </div>
                </details>`;
        }

        // Step cards
        const stepsEl = $id(_c(ctx,'stepsEl'));
        if (!stepsEl) return;
        const steps = doc.steps || [];
        stepsEl.innerHTML = steps.length
            ? steps.map((step, i) => _stepCardEditable(step, i, ctx)).join('')
            : '<div style="color:var(--text-secondary);font-size:12px;font-style:italic;padding:8px 0;">No steps — click Add Step below.</div>';

        // Add Step button
        const addWrap = _c(ctx,'addWrap') ? $id(_c(ctx,'addWrap')) : null;
        if (addWrap) {
            addWrap.innerHTML = `
                <div style="position:relative;display:inline-block;">
                    <button class="btn btn-outline" onclick="Workflows._toggleAddStepMenu(event,'${ctx}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Add Step
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="margin-left:4px;"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                    <div id="${_c(ctx,'menu')}" style="display:none;position:absolute;left:0;top:100%;z-index:300;background:var(--bg-card);border:1px solid var(--border-light);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:190px;margin-top:4px;">
                        ${[['device_commands','Device Commands'],['device_config','Device Config Commands'],
                           ['file_transfer','File Transfer'],['device_runbook','Run Runbook'],['shell','Shell Script']]
                          .map(([t,l]) => `<div style="padding:9px 14px;cursor:pointer;font-size:13px;"
                              onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background=''"
                              onclick="Workflows._addStep('${ctx}','${t}')">${escHtml(l)}</div>`).join('')}
                    </div>
                </div>`;
        }
    }

    function _stepCardEditable(step, idx, ctx) {
        const type = step.type || 'device_commands';
        const types = ['device_commands','device_config','file_transfer','device_runbook','shell'];
        let fields = '';

        if (type === 'device_commands' || type === 'device_config') {
            fields = `<div class="form-group" style="margin-bottom:8px;">
                <label class="form-label" style="font-size:11px;">Commands</label>
                <textarea class="form-control" rows="3" style="font-family:monospace;font-size:12px;"
                    onchange="Workflows._updateStep('${ctx}',${idx},'commands',this.value)">${escHtml((step.commands||[]).join('\n'))}</textarea>
            </div>`;
        } else if (type === 'file_transfer') {
            fields = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                <div class="form-group" style="margin:0;">
                    <label class="form-label" style="font-size:11px;">Local Path</label>
                    <input type="text" class="form-control" style="font-size:12px;" value="${escHtml(step.local_path||'')}"
                        onchange="Workflows._updateStep('${ctx}',${idx},'local_path',this.value)">
                </div>
                <div class="form-group" style="margin:0;">
                    <label class="form-label" style="font-size:11px;">Remote Path</label>
                    <input type="text" class="form-control" style="font-size:12px;" value="${escHtml(step.remote_path||'')}"
                        onchange="Workflows._updateStep('${ctx}',${idx},'remote_path',this.value)">
                </div>
            </div>
            <div class="form-group" style="margin-bottom:8px;">
                <label class="form-label" style="font-size:11px;">Post-transfer Commands <span style="font-weight:400;">(optional)</span></label>
                <textarea class="form-control" rows="2" style="font-family:monospace;font-size:12px;"
                    onchange="Workflows._updateStep('${ctx}',${idx},'post_transfer_commands',this.value)">${escHtml((step.post_transfer_commands||[]).join('\n'))}</textarea>
            </div>`;
        } else if (type === 'device_runbook') {
            fields = `<div class="form-group" style="margin-bottom:8px;">
                <label class="form-label" style="font-size:11px;">Runbook</label>
                <input type="text" class="form-control" style="font-size:12px;" value="${escHtml(step.runbook||'')}"
                    placeholder="cisco_verify_version.sh"
                    onchange="Workflows._updateStep('${ctx}',${idx},'runbook',this.value)">
            </div>`;
        } else if (type === 'shell') {
            const runVal = step.run || 'once';
            fields = `<div class="form-group" style="margin-bottom:8px;">
                <label class="form-label" style="font-size:11px;">Run</label>
                <select class="form-control" style="font-size:12px;width:130px;"
                    onchange="Workflows._updateStep('${ctx}',${idx},'run',this.value)">
                    <option value="once" ${runVal==='once'?'selected':''}>once</option>
                    <option value="per_device" ${runVal==='per_device'?'selected':''}>per_device</option>
                </select>
            </div>
            <div class="form-group" style="margin-bottom:8px;">
                <label class="form-label" style="font-size:11px;">Script</label>
                <textarea class="form-control" rows="4" style="font-family:monospace;font-size:12px;"
                    onchange="Workflows._updateStep('${ctx}',${idx},'script',this.value)">${escHtml(step.script||'')}</textarea>
            </div>`;
        }

        return `
            <div class="section-card" style="padding:12px 16px;margin-bottom:8px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <span style="font-size:11px;font-weight:600;color:var(--text-secondary);flex-shrink:0;">Step ${idx+1}</span>
                    <input type="text" class="form-control" style="flex:1;font-size:13px;font-weight:600;"
                        value="${escHtml(step.name||'')}" placeholder="Step name"
                        onchange="Workflows._updateStep('${ctx}',${idx},'name',this.value)">
                    <select class="form-control" style="width:165px;font-size:12px;"
                        onchange="Workflows._changeStepType('${ctx}',${idx},this.value)">
                        ${types.map(t=>`<option value="${t}" ${type===t?'selected':''}>${t}</option>`).join('')}
                    </select>
                    <button class="btn btn-danger btn-icon" onclick="Workflows._removeStep('${ctx}',${idx})" title="Remove">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                    </button>
                </div>
                ${fields}
            </div>`;
    }

    // ── YAML mutation helpers (editable modals only) ───────────────────────────

    function _mutateDocs(ctx, fn) {
        const ta = $id(_c(ctx,'ta'));
        if (!ta) return;
        let doc = {};
        try { doc = jsyaml.load(ta.value) || {}; } catch(_) { doc = {}; }
        fn(doc);
        ta.value = jsyaml.dump(doc, { lineWidth: 120, noRefs: true });
        _renderStepsEditable(ctx);
    }

    function _addStep(ctx, type) {
        _closeAllMenus();
        const defaults = {
            device_commands: { name:'New Step', type, commands:['show version'] },
            device_config:   { name:'New Step', type, commands:[''] },
            file_transfer:   { name:'New Step', type, local_path:'', remote_path:'' },
            device_runbook:  { name:'New Step', type, runbook:'' },
            shell:           { name:'New Step', type, run:'once', script:'echo "hello"' },
        };
        _mutateDocs(ctx, doc => {
            if (!doc.steps) doc.steps = [];
            doc.steps.push(defaults[type] || { name:'New Step', type });
        });
    }

    function _removeStep(ctx, idx) {
        _mutateDocs(ctx, doc => { (doc.steps||[]).splice(idx,1); });
    }

    function _changeStepType(ctx, idx, newType) {
        _mutateDocs(ctx, doc => {
            const step = (doc.steps||[])[idx];
            if (!step) return;
            step.type = newType;
            delete step.commands; delete step.script; delete step.run;
            delete step.local_path; delete step.remote_path;
            delete step.post_transfer_commands; delete step.runbook;
            if (newType==='device_commands'||newType==='device_config') step.commands=[''];
            if (newType==='shell') { step.run='once'; step.script=''; }
            if (newType==='file_transfer') { step.local_path=''; step.remote_path=''; }
            if (newType==='device_runbook') step.runbook='';
        });
    }

    function _updateStep(ctx, idx, field, rawVal) {
        _mutateDocs(ctx, doc => {
            const step = (doc.steps||[])[idx];
            if (!step) return;
            if (field==='commands'||field==='post_transfer_commands') {
                const arr = rawVal.split('\n').map(l=>l.trim()).filter(Boolean);
                if (arr.length) step[field]=arr; else delete step[field];
            } else {
                step[field] = rawVal;
            }
        });
    }

    function _addParam(ctx) {
        _mutateDocs(ctx, doc => { if(!doc.parameters) doc.parameters=[]; doc.parameters.push('NEW_PARAM'); });
    }
    function _removeParam(ctx, i) {
        _mutateDocs(ctx, doc => { (doc.parameters||[]).splice(i,1); });
    }
    function _updateParam(ctx, i, val) {
        _mutateDocs(ctx, doc => { if(doc.parameters) doc.parameters[i]=val; });
    }

    function _addVar(ctx) {
        _mutateDocs(ctx, doc => { if(!doc.vars) doc.vars={}; doc.vars['NEW_VAR']='value'; });
    }
    function _removeVar(ctx, i) {
        _mutateDocs(ctx, doc => {
            const entries=Object.entries(doc.vars||{}); entries.splice(i,1);
            doc.vars=Object.fromEntries(entries);
        });
    }
    function _updateVar(ctx, i, part, val) {
        _mutateDocs(ctx, doc => {
            const entries=Object.entries(doc.vars||{});
            if(part==='key') { const v=doc.vars[entries[i]?.[0]]; delete doc.vars[entries[i]?.[0]]; doc.vars[val]=v; }
            else { const k=entries[i]?.[0]; if(k) doc.vars[k]=val; }
        });
    }

    function _toggleAddStepMenu(event, ctx) {
        event.stopPropagation();
        const menuId = _c(ctx,'menu');
        if (!menuId) return;
        const menu = $id(menuId);
        if (!menu) return;
        const isOpen = menu.style.display !== 'none';
        _closeAllMenus();
        if (!isOpen) menu.style.display = '';
    }

    function _closeAllMenus() {
        ['wf-e-add-menu','wf-n-add-menu'].forEach(id => {
            const m = $id(id); if (m) m.style.display = 'none';
        });
    }

    document.addEventListener('click', _closeAllMenus);

    // ── Delete ────────────────────────────────────────────────────────────────

    async function _deleteWorkflow(filename) {
        if (!confirm(`Delete ${filename}?\n\nThis removes the file and cannot be undone.`)) return;
        const res = await API.workflowDelete(filename);
        if (res.ok) {
            showToast(`Deleted ${filename}`, 'info');
            _fetchWorkflows();
        } else {
            showToast(`Delete failed: ${res.data?.detail || res.data?.error || 'Unknown error'}`, 'error');
        }
    }

    // ── Toolbar ───────────────────────────────────────────────────────────────

    async function reload() {
        await _fetchWorkflows();
        showToast('Workflows refreshed', 'success');
    }

    // ── Upload modal ──────────────────────────────────────────────────────────

    function openUpload() {
        _uploadFiles = [];
        const list = $id('wf-upload-list');
        if (list) { list.style.display='none'; list.innerHTML=''; }
        const btn = $id('wf-upload-save-btn');
        if (btn) { btn.disabled=true; btn.textContent='Upload & Save'; }
        const inp = $id('wf-upload-input');
        if (inp) inp.value='';
        openModal('modal-wf-upload');
    }

    function fileSelected(event) { _addFiles(Array.from(event.target.files)); }

    function dropFile(event) {
        event.preventDefault();
        $id('wf-upload-drop-zone')?.classList.remove('drag-over');
        _addFiles(Array.from(event.dataTransfer.files));
    }

    function _addFiles(newFiles) {
        for (const f of newFiles) {
            if ((f.name.endsWith('.yaml')||f.name.endsWith('.yml')) && !_uploadFiles.find(x=>x.name===f.name))
                _uploadFiles.push(f);
        }
        _renderUploadList();
    }

    function _renderUploadList() {
        const list = $id('wf-upload-list');
        const btn  = $id('wf-upload-save-btn');
        if (!list) return;
        if (!_uploadFiles.length) {
            list.style.display='none'; list.innerHTML='';
            if (btn) { btn.disabled=true; btn.textContent='Upload & Save'; }
            return;
        }
        list.style.display='';
        list.innerHTML = _uploadFiles.map((f,i)=>`
            <div style="background:#f8fafc;border:1px solid var(--border-light);border-radius:6px;padding:10px 14px;display:flex;align-items:center;gap:10px;margin-bottom:6px;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(f.name)}</div>
                    <div style="font-size:11px;color:var(--text-secondary);">${(f.size/1024).toFixed(1)} KB</div>
                </div>
                <button class="btn btn-danger btn-icon" onclick="Workflows.removeFile(${i})">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>`).join('');
        if (btn) { btn.disabled=false; btn.textContent=`Upload & Save (${_uploadFiles.length})`; }
    }

    function removeFile(i) {
        _uploadFiles.splice(i,1);
        const inp=$id('wf-upload-input'); if(inp) inp.value='';
        _renderUploadList();
    }

    function clearUpload() { _uploadFiles=[]; _renderUploadList(); }

    function _readFile(file) {
        return new Promise(resolve => {
            const r=new FileReader(); r.onload=e=>resolve(e.target.result); r.readAsText(file);
        });
    }

    async function uploadSave() {
        if (!_uploadFiles.length) return;
        const btn=$id('wf-upload-save-btn');
        if(btn){btn.disabled=true;btn.textContent='Uploading…';}
        let ok=0; const fail=[];
        for (const f of _uploadFiles) {
            const content=await _readFile(f);
            const res=await API.workflowCreate(f.name,content);
            if(res.ok) ok++; else fail.push(`${f.name}: ${res.data?.detail||res.data?.error||'error'}`);
        }
        if(btn){btn.disabled=false;btn.textContent='Upload & Save';}
        if(!fail.length){closeModal('modal-wf-upload');clearUpload();showToast(`Uploaded ${ok} file${ok!==1?'s':''}`, 'success');_fetchWorkflows();}
        else{if(ok) showToast(`${ok} uploaded, ${fail.length} failed`, 'error'); else showToast(`Upload failed: ${fail[0]}`, 'error');}
    }

    // ── Run Modal ─────────────────────────────────────────────────────────────

    async function _openRunModal(filename) {
        _runFilename = filename;
        _runDevices  = [];
        _runParams   = {};

        $id('wf-run-modal-title').textContent = `Run: ${filename}`;
        $id('wf-run-modal-devices').innerHTML = '';
        _renderRunChips();

        const res = await API.inventoryGroups();
        const dl = $id('wf-run-modal-group-datalist');
        if (dl && res.ok) dl.innerHTML=(res.data.groups||[]).map(g=>`<option value="${escHtml(g)}">`).join('');

        const wfRes = await API.get(`/api/workflows/${encodeURIComponent(filename)}`);
        const params = wfRes.ok ? (wfRes.data.parameters||[]) : [];

        const container = $id('wf-run-params-container');
        if (container) {
            container.innerHTML = params.length
                ? params.map(p=>`
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                        <label style="flex:0 0 160px;font-size:12px;font-weight:600;font-family:monospace;">${escHtml(String(p))}</label>
                        <input type="text" class="form-control" style="flex:1;font-size:12px;" placeholder="value"
                            oninput="Workflows._setRunParam('${escHtml(String(p))}',this.value)">
                    </div>`).join('')
                : '<div style="font-size:12px;color:var(--text-secondary);font-style:italic;">No parameters declared.</div>';
        }

        $id('wf-run-modal-incident').value='';
        $id('wf-run-modal-timeout').value='300';
        $id('wf-run-modal-workers').value='10';
        $id('workflow-run-modal').classList.add('active');
    }

    function _setRunParam(key, val) { _runParams[key]=val; }

    function closeRunModal() {
        $id('workflow-run-modal').classList.remove('active');
        _runFilename=null; _runDevices=[]; _runParams={};
    }

    function addParam() {
        // Legacy — kept for backward compat with run modal HTML
    }

    function _renderRunChips() {
        const container=$id('wf-run-modal-devices');
        if (!container) return;
        container.innerHTML=
            _runDevices.map((d,i)=>`
                <span style="background:#eff6ff;color:var(--hcl-blue);border:1px solid #bfdbfe;border-radius:4px;padding:3px 8px;font-size:12px;font-weight:500;display:inline-flex;align-items:center;gap:5px;">
                    ${escHtml(d)}
                    <span style="cursor:pointer;opacity:0.6;display:flex;" onclick="Workflows._removeDevice(${i})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </span>
                </span>`).join('') +
            `<input type="text" id="wf-run-modal-device-input"
                placeholder="${_runDevices.length?'':'Type group name or IP, press Enter…'}"
                style="border:none;outline:none;font-size:13px;font-family:'Inter';flex:1;min-width:160px;background:transparent;padding:2px 4px;"
                onkeydown="Workflows._deviceKeydown(event)"
                autocomplete="off" list="wf-run-modal-group-datalist">`;
    }

    function _deviceKeydown(event) {
        const inp=event.target;
        if (event.key==='Enter'||event.key===',') {
            event.preventDefault();
            const val=inp.value.trim().replace(/,$/,'');
            if(val&&!_runDevices.includes(val)){_runDevices.push(val);_renderRunChips();}
            inp.value='';
        }
        if (event.key==='Backspace'&&!inp.value&&_runDevices.length){_runDevices.pop();_renderRunChips();}
    }

    function _removeDevice(i) { _runDevices.splice(i,1); _renderRunChips(); }

    async function submitRun() {
        if (!_runFilename) return;
        if (!_runDevices.length) { showToast('Please add at least one target device or group.','error'); return; }
        const incident=$id('wf-run-modal-incident').value.trim().toUpperCase();
        if (!incident) { showToast('Incident number is required.','error'); $id('wf-run-modal-incident').focus(); return; }

        const devices=_runDevices.map(d=>/^\d{1,3}(\.\d{1,3}){3}/.test(d)?{host:d}:{group:d});
        const payload={
            devices, parameters:_runParams, incident,
            options:{
                timeout_per_device:parseInt($id('wf-run-modal-timeout').value,10)||300,
                max_workers:parseInt($id('wf-run-modal-workers').value,10)||10,
            },
        };

        const btn=$id('wf-run-modal-submit-btn');
        btn.disabled=true; btn.textContent='Submitting…';

        const res=await API.post(`/api/workflows/${encodeURIComponent(_runFilename)}/run`,payload);

        btn.disabled=false;
        btn.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Workflow`;

        if (res.ok) {
            const jobId=res.data.job_id;
            showToast(`Workflow job ${jobId} submitted`,'success');
            closeRunModal();
            jobId?Jobs.openDetail(jobId):Nav.go('jobs');
        } else {
            showToast(`Submit failed: ${res.data?.detail||res.data?.error||JSON.stringify(res.data)}`,'error');
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _truncate(str, max) { return str.length>max ? str.slice(0,max)+'…' : str; }

    function _fmtTime(iso) {
        if (!iso) return '—';
        try { return new Date(iso).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
        catch { return iso; }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    return {
        load, reload, openNew, saveNew,
        openUpload, fileSelected, dropFile, clearUpload, removeFile, uploadSave,
        openViewModal, _vMode, _runFromView,
        openEditModal, _eMode, saveEdit,
        _nMode,
        submitRun, closeRunModal, addParam,
        _openRunModal, _deleteWorkflow,
        _addStep, _removeStep, _changeStepType, _updateStep,
        _addParam, _removeParam, _updateParam,
        _addVar, _removeVar, _updateVar,
        _toggleAddStepMenu,
        _deviceKeydown, _removeDevice, _setRunParam,
    };
})();
