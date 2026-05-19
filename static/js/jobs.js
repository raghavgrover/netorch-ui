/**
 * jobs.js — Job list view and live job detail with SSE streaming.
 *
 * Field normalisation:
 *   GET /jobs  → JobStatusResponse: { job_id, mode, status, started_at, completed_at, summary:{total,success,failed,in_progress} }
 *   GET /jobs/{id}/detail → { id, mode, status, started, duration, progress, total, devices:[...] }
 *
 * _normalise() maps both shapes to a flat object the templates consume.
 */
'use strict';

const Jobs = (() => {
    let _page       = 0;
    let _pageSize   = 50;
    let _total      = 0;
    let _statusFilt = '';
    let _activeSSE  = null;
    let _elapsedTimer = null;   // setInterval handle for live elapsed clock
    let _jobStartTs   = null;   // Date object when current job started

    // ── Normalise JobStatusResponse OR detail shape → flat UI object ──────────
    function _normalise(j) {
        // summary comes from list endpoint; detail endpoint has progress/total flat
        const success = j.summary?.success ?? 0;
        const failed  = j.summary?.failed  ?? 0;
        const total   = j.summary?.total   ?? j.total ?? 0;
        const done    = j.summary ? success + failed : (j.progress ?? 0);

        let duration = '—';
        if (j.started_at && j.completed_at) {
            const secs = Math.round((new Date(j.completed_at) - new Date(j.started_at)) / 1000);
            const m = Math.floor(secs / 60), s = secs % 60;
            duration = m > 0 ? `${m}m ${s}s` : `${s}s`;
        }

        return {
            id:           j.job_id  || j.id,
            mode:         j.mode,
            status:       j.status,
            devices:      j.devices || [],
            progress:     done,
            total:        total,
            success:      success,
            failed:       failed,
            in_progress:  j.summary?.in_progress ?? Math.max(0, total - done),
            started:      j.started_at || j.started || '—',
            started_at:   j.started_at || j.started || null,
            completed_at: j.completed_at || j.duration || null,  // detail uses 'duration' for completed_at
            duration:     duration,
        };
    }

    // ── Job list ──────────────────────────────────────────────────────────────

    async function load() {
        _page       = 0;
        _statusFilt = $id('job-status-filter').value;
        await _fetchAndRender();
    }

    function onFilter() {
        _statusFilt = $id('job-status-filter').value;
        _page = 0;
        _fetchAndRender();
    }

    function refresh() { _fetchAndRender(); }

    async function _fetchAndRender() {
        const tbody = $id('jobs-body');
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-secondary);">Loading…</td></tr>`;

        const res = await API.jobsList({ status: _statusFilt, limit: _pageSize, offset: _page * _pageSize });

        if (!res.ok) {
            tbody.innerHTML = `<tr><td colspan="8"><div class="api-error-banner active" style="margin:12px;">
                Could not load jobs: ${escHtml(res.data?.error || 'Unknown error')}</div></td></tr>`;
            return;
        }

        const raw  = res.data.jobs || res.data || [];
        const jobs = raw.map(_normalise);
        _total = res.data.total ?? jobs.length;
        $id('jobs-count').textContent = `${fmtNum(_total)} job${_total !== 1 ? 's' : ''}`;

        if (!jobs.length) {
            tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state" style="padding:40px 0;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <div class="empty-state-title">No jobs found</div>
                <div class="empty-state-sub">Submit your first job using the New Job page.</div>
            </div></td></tr>`;
            return;
        }

        tbody.innerHTML = jobs.map(j => {
            const isRunning = j.status === 'running';
            return `
            <tr>
                <td><span class="cell-link" onclick="Jobs.openDetail('${escHtml(j.id)}')">${escHtml(j.id)}</span></td>
                <td>${modeBadge(j.mode)}</td>
                <td>${statusBadge(j.status)}</td>
                <td style="font-size:12px;color:var(--text-secondary);">
                    <span style="color:var(--status-green);">✓ ${j.success}</span>
                    &nbsp;
                    <span style="color:var(--status-red);">✕ ${j.failed}</span>
                    &nbsp;/ ${j.total}
                </td>
                <td>${progressBar(j.progress, j.total)}</td>
                <td style="font-size:12px;">${escHtml(j.started)}</td>
                <td style="font-size:12px;">${isRunning ? '<span class="dot-running"></span>Running' : escHtml(j.duration)}</td>
                <td>
                    <div style="display:flex;gap:4px;">
                        <button class="btn btn-outline btn-icon" title="View detail" onclick="Jobs.openDetail('${escHtml(j.id)}')">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                            </svg>
                        </button>
                        ${isRunning ? `<button class="btn btn-danger btn-icon" title="Cancel" onclick="Jobs.cancel('${escHtml(j.id)}')">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                        </button>` : ''}
                    </div>
                </td>
            </tr>`;
        }).join('');

        renderPager($id('jobs-pager-btns'), _page, Math.ceil(_total / _pageSize),
            (p) => { _page = p; _fetchAndRender(); });
        const start = _page * _pageSize + 1;
        const end   = Math.min(start + jobs.length - 1, _total);
        $id('jobs-pager-info').textContent = _total ? `${fmtNum(start)}–${fmtNum(end)} of ${fmtNum(_total)}` : '';
    }

    // ── Cancel ────────────────────────────────────────────────────────────────

    async function cancel(jobId) {
        if (!confirm(`Cancel job ${jobId}?\n\nIn-flight device sessions will complete before the job stops.`)) return;
        const res = await API.jobCancel(jobId);
        if (res.ok) {
            showToast(`Job ${jobId} cancelled`, 'info');
            _fetchAndRender();
        } else {
            showToast(`Cancel failed: ${res.data?.detail || res.data?.error || 'Unknown error'}`, 'error');
        }
    }

    // ── Job detail ────────────────────────────────────────────────────────────

    async function openDetail(jobId) {
        if (!jobId || jobId === 'undefined') { showToast('Invalid job ID', 'error'); return; }

        _stopSSE();
        _stopElapsedTimer();
        Nav.go('jobdetail');
        $id('page-title').textContent = `Job: ${jobId}`;

        const container = $id('jobdetail-content');
        container.innerHTML = '<div class="empty-state"><div class="empty-state-sub">Loading…</div></div>';

        const [jobRes, detailRes] = await Promise.all([API.jobGet(jobId), API.jobDetail(jobId)]);

        if (!jobRes.ok) {
            container.innerHTML = `<div class="api-error-banner active" style="margin:0;">Job not found: ${escHtml(jobId)}</div>`;
            return;
        }

        const job    = _normalise(jobRes.data);
        const detail = detailRes.ok ? detailRes.data : null;

        _renderDetail(jobId, job, detail);

        if (job.status === 'running') {
            _startElapsedTimer(job.started_at);
            _startSSE(jobId);
        }
    }

    // ── Render detail card ────────────────────────────────────────────────────

    function _renderDetail(jobId, job, detail) {
        const container = $id('jobdetail-content');
        const pct       = job.total > 0 ? Math.round((job.progress / job.total) * 100) : 0;
        const devices   = detail?.devices || [];
        const steps     = detail?.steps   || [];
        const isWorkflow = job.mode === 'workflow';
        const isRunning  = job.status === 'running';

        container.innerHTML = `
            <!-- Summary card -->
            <div class="section-card" style="margin-bottom:16px;">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px;align-items:start;">

                    <div>
                        <div class="jd-label">Job ID</div>
                        <div style="font-size:15px;font-weight:700;font-family:monospace;">${escHtml(job.id)}</div>
                    </div>

                    <div>
                        <div class="jd-label">Mode</div>
                        ${modeBadge(job.mode)}
                    </div>

                    <div>
                        <div class="jd-label">Status</div>
                        <div id="jd-status">${statusBadge(job.status)}</div>
                    </div>

                    <div>
                        <div class="jd-label">Started</div>
                        <div style="font-size:12px;">${escHtml(_fmtTimestamp(job.started))}</div>
                    </div>

                    <div>
                        <div class="jd-label">Duration</div>
                        <div style="font-size:13px;font-weight:600;" id="jd-duration">
                            ${isRunning ? '<span class="dot-running"></span><span id="jd-elapsed">0s</span>' : escHtml(job.duration)}
                        </div>
                    </div>

                    <div>
                        <div class="jd-label">Progress</div>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <div class="progress-bar-wrap" style="min-width:80px;">
                                <div class="progress-bar-fill" id="jd-progress-bar" style="width:${pct}%"></div>
                            </div>
                            <span style="font-size:12px;font-weight:600;color:var(--hcl-blue);" id="jd-progress-txt">${job.progress}/${job.total}</span>
                        </div>
                    </div>

                </div>

                <!-- Success / Failed / In-Progress counts -->
                <div style="display:flex;gap:20px;margin-top:16px;padding-top:14px;border-top:1px solid var(--border-light);">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span style="width:10px;height:10px;border-radius:50%;background:var(--status-green);display:inline-block;flex-shrink:0;"></span>
                        <span style="font-size:12px;color:var(--text-secondary);">Succeeded</span>
                        <span style="font-size:16px;font-weight:700;color:var(--status-green);" id="jd-success">${job.success}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span style="width:10px;height:10px;border-radius:50%;background:var(--status-red);display:inline-block;flex-shrink:0;"></span>
                        <span style="font-size:12px;color:var(--text-secondary);">Failed</span>
                        <span style="font-size:16px;font-weight:700;color:var(--status-red);" id="jd-failed">${job.failed}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span style="width:10px;height:10px;border-radius:50%;background:var(--hcl-blue);display:inline-block;flex-shrink:0;${isRunning ? 'animation:pulse 1.4s infinite;' : ''}"></span>
                        <span style="font-size:12px;color:var(--text-secondary);">In Progress</span>
                        <span style="font-size:16px;font-weight:700;color:var(--hcl-blue);" id="jd-inprogress">${job.in_progress}</span>
                    </div>
                    <div style="margin-left:auto;display:flex;align-items:center;gap:6px;">
                        <span style="font-size:12px;color:var(--text-secondary);">Total Devices</span>
                        <span style="font-size:16px;font-weight:700;color:var(--text-primary);">${job.total}</span>
                    </div>
                </div>
            </div>

            <!-- Actions bar -->
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                <div class="dash-header-title" style="margin:0;border:none;padding:0;">
                    ${isWorkflow ? 'Step Results' : 'Per-Device Results'}
                </div>
                <div style="display:flex;gap:8px;" id="jd-actions">
                    ${_actionsHtml(jobId, job.status)}
                </div>
            </div>

            <!-- Results: step-by-step for workflow, per-device accordion for others -->
            <div id="jd-devices">
                ${isWorkflow ? _stepsHtml(steps, devices) : _devicesHtml(devices)}
            </div>`;
    }

    function _actionsHtml(jobId, status) {
        const isRunning = status === 'running';
        return `
            <a class="btn btn-outline" style="font-size:12px;" href="${API.jobLogUrl(jobId)}" download>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>Download Log
            </a>
            ${isRunning
                ? `<button class="btn btn-danger" style="font-size:12px;" onclick="Jobs.cancel('${escHtml(jobId)}')">Cancel Job</button>`
                : `<button class="btn btn-outline" style="font-size:12px;" onclick="Jobs.openDetail('${escHtml(jobId)}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
                        Refresh Results
                   </button>`
            }`;
    }

    // ── Workflow step-by-step results ─────────────────────────────────────────

    function _stepsHtml(steps, devices) {
        if (!steps.length && !devices.length) {
            return '<div class="empty-state"><p>No step results yet.</p></div>';
        }

        // Build a set of step names already covered by workflow_step_outputs
        const coveredSteps = new Set(steps.map(s => s.step_name));

        // Also include device-scoped steps that ONLY appear in devices (not in step_outputs)
        // This handles older jobs or edge cases
        const allSteps = [...steps];
        const deviceStepNames = new Set(
            devices.flatMap(d => (d.output || [])
                .filter(l => l.startsWith('# [step:'))
                .map(l => l.replace(/^# \[step:/, '').replace(/\]$/, ''))
            )
        );
        deviceStepNames.forEach(name => {
            if (!coveredSteps.has(name)) {
                // Build a synthetic step entry from device outputs
                const devEntries = devices.map(d => {
                    const lines = d.output || [];
                    const start = lines.findIndex(l => l === `# [step:${name}]`);
                    if (start === -1) return null;
                    const relevant = [];
                    for (let i = start + 1; i < lines.length; i++) {
                        if (lines[i].startsWith('# [step:')) break;
                        relevant.push(lines[i]);
                    }
                    return { host: d.host, output: relevant, exit_code: d.status === 'success' ? 0 : 1, status: d.status };
                }).filter(Boolean);
                allSteps.push({ step_name: name, devices: devEntries, once_output: null, once_exit_code: null });
            }
        });

        if (!allSteps.length) {
            return '<div class="empty-state"><p>No step results available.</p></div>';
        }

        return allSteps.map((step, idx) => {
            const isOnce   = step.once_output !== null;
            const hasDevs  = step.devices && step.devices.length > 0;
            const allOk    = isOnce
                ? step.once_exit_code === 0
                : hasDevs && step.devices.every(d => d.exit_code === 0);
            const anyFail  = isOnce
                ? step.once_exit_code !== 0
                : hasDevs && step.devices.some(d => d.exit_code !== 0);
            const stepStatus = !isOnce && !hasDevs ? 'skipped'
                : anyFail ? 'failed'
                : allOk   ? 'success'
                : 'partial';
            const statusBadge = {
                success: '<span class="badge b-green" style="font-size:11px;">✓ success</span>',
                failed:  '<span class="badge b-red"   style="font-size:11px;">✕ failed</span>',
                partial: '<span class="badge b-amber" style="font-size:11px;">⚠ partial</span>',
                skipped: '<span class="badge b-grey"  style="font-size:11px;">— skipped</span>',
            }[stepStatus] || '';
            const stepType = isOnce ? 'shell/once' : hasDevs ? 'per-device' : 'skipped';

            let body = '';
            if (isOnce) {
                const lines = (step.once_output || '').split('\n').map(coloriseLine).join('');
                const errCls = step.once_exit_code !== 0 ? ';border-left:3px solid var(--status-red)' : '';
                body = `<div class="log-block" style="margin-top:10px${errCls}">${lines || '<span style="opacity:.5;">(no output)</span>'}</div>`;
            } else if (hasDevs) {
                body = step.devices.map(dv => {
                    const lines = (dv.output || []).map(coloriseLine).join('');
                    const hdr   = dv.exit_code === 0
                        ? `<span style="color:var(--status-green);">✓</span>`
                        : `<span style="color:var(--status-red);">✕</span>`;
                    return `
                        <div style="margin-top:8px;">
                            <div style="font-size:12px;font-weight:600;font-family:monospace;color:var(--text-secondary);margin-bottom:4px;">
                                ${hdr} ${escHtml(dv.host)}
                            </div>
                            <div class="log-block">${lines || '<span style="opacity:.5;">(no output)</span>'}</div>
                        </div>`;
                }).join('');
            } else {
                body = `<div style="font-size:12px;color:var(--text-secondary);font-style:italic;margin-top:8px;">Step skipped — all devices were already marked failed by a previous step.</div>`;
            }

            return `
                <div class="section-card" style="margin-bottom:12px;padding:14px 18px;">
                    <div style="display:flex;align-items:center;gap:10px;cursor:pointer;"
                         onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'':'none'">
                        <span style="font-size:13px;font-weight:700;color:var(--text-secondary);flex-shrink:0;">Step ${idx + 1}</span>
                        <span style="font-size:14px;font-weight:600;flex:1;">${escHtml(step.step_name)}</span>
                        <span style="font-size:11px;color:var(--text-secondary);background:var(--bg-hover);padding:2px 8px;border-radius:4px;white-space:nowrap;">${stepType}</span>
                        ${statusBadge}
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="flex-shrink:0;opacity:.4;"><polyline points="6 9 12 15 18 9"/></svg>
                    </div>
                    <div>${body}</div>
                </div>`;
        }).join('');
    }

    function _deviceOutputHtml(d) {
        const lines = (d.output || []).map(coloriseLine);

        // Device-level error (auth failure, unreachable, timeout, etc.)
        if (d.error) {
            for (const ln of d.error.split('\n'))
                if (ln.trim()) lines.push(`<div class="log-err">${escHtml(ln)}</div>`);
        }

        if (lines.length) return lines.join('');
        if (d.status === 'running') return '<span style="opacity:0.4;">No output yet…</span>';
        return '<span style="opacity:0.4;">No output.</span>';
    }

    function _devicesHtml(devices) {
        if (!devices.length) {
            return `<div class="empty-state" style="padding:32px 0;">
                <div class="empty-state-sub">Waiting for device results…</div>
            </div>`;
        }
        return devices.map((d, i) => `
            <div class="device-row" id="drow-${i}">
                <div class="device-row-header" onclick="Jobs.toggleDevice(${i})">
                    <svg class="expand-arrow" id="darr-${i}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;flex-shrink:0;">
                        <path d="M9 18l6-6-6-6"/>
                    </svg>
                    <span style="font-weight:600;font-size:13px;flex:1;">${escHtml(d.host)}</span>
                    ${platBadge(d.platform || '')}
                    ${statusBadge(d.status)}
                    ${d.duration ? `<span style="font-size:11px;color:var(--text-secondary);margin-left:6px;">${Number(d.duration).toFixed(1)}s</span>` : ''}
                </div>
                <div class="device-row-body" id="dbody-${i}">
                    <div class="log-viewer" id="dlog-${i}">${_deviceOutputHtml(d)}${
                        d.status === 'running' ? '<span style="opacity:0.6;animation:pulse 1s infinite;">▌</span>' : ''
                    }</div>
                </div>
            </div>`).join('');
    }

    function toggleDevice(i) {
        $id(`dbody-${i}`)?.classList.toggle('open');
        $id(`darr-${i}`)?.classList.toggle('open');
    }

    // ── SSE streaming ─────────────────────────────────────────────────────────

    function _startSSE(jobId) {
        _stopSSE();
        const es = new EventSource(`/api/stream/jobs/${encodeURIComponent(jobId)}`);
        _activeSSE = es;

        es.onmessage = (event) => {
            try { _updateDetail(JSON.parse(event.data), jobId); }
            catch (e) { console.warn('SSE parse error:', e); }
        };

        es.addEventListener('done', async () => {
            _stopSSE();
            _stopElapsedTimer();
            showToast('Job completed', 'success');
            // Re-fetch the final state so status, duration, counts all update correctly
            await _refreshDetailInPlace(jobId);
        });

        es.addEventListener('timeout', () => {
            _stopSSE();
            _stopElapsedTimer();
            showToast('Stream timed out — click Refresh Results to update', 'info');
        });

        es.addEventListener('error', (e) => { console.warn('SSE error:', e); });
    }

    function _stopSSE() {
        if (_activeSSE) { _activeSSE.close(); _activeSSE = null; }
    }

    /** Called by SSE done event — re-fetches both endpoints and re-renders summary + devices */
    async function _refreshDetailInPlace(jobId) {
        const [jobRes, detailRes] = await Promise.all([API.jobGet(jobId), API.jobDetail(jobId)]);
        if (!jobRes.ok) return;

        const job    = _normalise(jobRes.data);
        const detail = detailRes.ok ? detailRes.data : null;
        const devices = detail?.devices || [];

        // Update status badge
        const statusEl = $id('jd-status');
        if (statusEl) statusEl.innerHTML = statusBadge(job.status);

        // Update duration (now completed_at is set)
        const durEl = $id('jd-duration');
        if (durEl) durEl.innerHTML = escHtml(job.duration);

        // Update counts
        _updateCounts(job.progress, job.total, job.success, job.failed, job.in_progress);

        // Update actions bar (remove Cancel, show Refresh Results)
        const actionsEl = $id('jd-actions');
        if (actionsEl) actionsEl.innerHTML = _actionsHtml(jobId, job.status);

        // Re-render devices with final output
        const devicesEl = $id('jd-devices');
        if (devicesEl) devicesEl.innerHTML = _devicesHtml(devices);
    }

    /** Called on every SSE data message — patches individual elements without full re-render */
    function _updateDetail(data, jobId) {
        // Progress bar + counter
        if (data.progress !== undefined && data.total) {
            _updateCounts(data.progress, data.total,
                data.summary?.success ?? 0,
                data.summary?.failed  ?? 0,
                data.summary?.in_progress ?? Math.max(0, data.total - data.progress));
        }

        // Status badge (may flip from running to partial_failure mid-stream)
        if (data.status) {
            const statusEl = $id('jd-status');
            if (statusEl) statusEl.innerHTML = statusBadge(data.status);
        }

        // Per-device rows — patch existing rows or inject new ones
        if (Array.isArray(data.devices)) {
            const container = $id('jd-devices');

            data.devices.forEach((d, i) => {
                let row = $id(`drow-${i}`);

                // New device arrived — append row
                if (!row && container) {
                    // Remove empty-state placeholder if present
                    const placeholder = container.querySelector('.empty-state');
                    if (placeholder) placeholder.remove();

                    container.insertAdjacentHTML('beforeend', `
                        <div class="device-row" id="drow-${i}">
                            <div class="device-row-header" onclick="Jobs.toggleDevice(${i})">
                                <svg class="expand-arrow" id="darr-${i}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;flex-shrink:0;"><path d="M9 18l6-6-6-6"/></svg>
                                <span style="font-weight:600;font-size:13px;flex:1;">${escHtml(d.host)}</span>
                                ${platBadge(d.platform || '')}
                                <span id="dbadge-${i}">${statusBadge(d.status)}</span>
                            </div>
                            <div class="device-row-body" id="dbody-${i}">
                                <div class="log-viewer" id="dlog-${i}"></div>
                            </div>
                        </div>`);
                    row = $id(`drow-${i}`);
                }

                if (!row) return;

                // Update status badge
                const badge = $id(`dbadge-${i}`) || row.querySelector('.device-row-header .badge');
                if (badge) badge.outerHTML = `<span id="dbadge-${i}">${statusBadge(d.status)}</span>`;

                // Update log output
                const log = $id(`dlog-${i}`);
                if (log) {
                    log.innerHTML = _deviceOutputHtml(d) +
                        (d.status === 'running' ? '<span style="opacity:0.6;animation:pulse 1s infinite;">▌</span>' : '');
                    const body = $id(`dbody-${i}`);
                    if (body?.classList.contains('open')) log.scrollTop = log.scrollHeight;
                }
            });
        }
    }

    function _updateCounts(progress, total, success, failed, inProgress) {
        const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
        const bar = $id('jd-progress-bar');
        const txt = $id('jd-progress-txt');
        if (bar) bar.style.width = pct + '%';
        if (txt) txt.textContent = `${progress}/${total}`;

        const sEl = $id('jd-success');
        const fEl = $id('jd-failed');
        const iEl = $id('jd-inprogress');
        if (sEl) sEl.textContent = success;
        if (fEl) fEl.textContent = failed;
        if (iEl) iEl.textContent = inProgress;
    }

    // ── Live elapsed timer ────────────────────────────────────────────────────

    function _startElapsedTimer(startedAt) {
        _stopElapsedTimer();
        _jobStartTs = startedAt ? new Date(startedAt) : new Date();
        _elapsedTimer = setInterval(() => {
            const el = $id('jd-elapsed');
            if (!el) { _stopElapsedTimer(); return; }
            const secs = Math.round((Date.now() - _jobStartTs) / 1000);
            const m = Math.floor(secs / 60), s = secs % 60;
            el.textContent = m > 0 ? `${m}m ${s}s` : `${s}s`;
        }, 1000);
    }

    function _stopElapsedTimer() {
        if (_elapsedTimer) { clearInterval(_elapsedTimer); _elapsedTimer = null; }
        _jobStartTs = null;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _fmtTimestamp(ts) {
        if (!ts || ts === '—') return '—';
        try {
            const d = new Date(ts);
            return d.toLocaleString();
        } catch { return ts; }
    }

    return {
        load, refresh, onFilter,
        cancel, openDetail, toggleDevice,
    };
})();
