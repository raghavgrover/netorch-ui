/**
 * dashboard.js — Dashboard view: KPI cards, recent jobs, platform distribution.
 *
 * Field-name normalisation (same as jobs.js):
 *   /jobs returns JobStatusResponse: { job_id, mode, status, started_at, summary: {...} }
 */
'use strict';

const Dashboard = (() => {

    // Normalise a JobStatusResponse to flat UI fields
    function _norm(j) {
        const done  = (j.summary?.success || 0) + (j.summary?.failed || 0);
        const total = j.summary?.total || 0;
        let duration = '—';
        if (j.started_at && j.completed_at) {
            const secs = Math.round((new Date(j.completed_at) - new Date(j.started_at)) / 1000);
            const m = Math.floor(secs / 60), s = secs % 60;
            duration = m > 0 ? `${m}m ${s}s` : `${s}s`;
        }
        return {
            id:       j.job_id || j.id,
            mode:     j.mode,
            status:   j.status,
            progress: done,
            total:    total,
            started:  j.started_at || '—',
            duration: duration,
        };
    }

    async function load() {
        const [srcRes, jobsRes, groupsRes] = await Promise.all([
            API.inventorySources(),
            API.jobsList({ limit: 8 }),
            API.inventoryGroups(),
        ]);

        _renderKpis(srcRes, jobsRes, groupsRes);
        _renderJobs(jobsRes);
        _renderPlatforms(srcRes);
    }

    function _renderKpis(srcRes, jobsRes, groupsRes) {
        if (srcRes.ok && srcRes.data.sources) {
            const totalHosts = srcRes.data.sources.reduce((s, f) => s + (f.hosts || 0), 0);
            $id('kpi-hosts').textContent = fmtNum(totalHosts);
            $id('kpi-files').textContent = fmtNum(srcRes.data.sources.length);
        }

        if (jobsRes.ok) {
            const jobs = jobsRes.data.jobs || jobsRes.data || [];
            const running = jobs.filter(j => j.status === 'running').length;
            $id('kpi-running').textContent = fmtNum(running);
        }

        if (groupsRes.ok) {
            const groups = groupsRes.data.groups || groupsRes.data || [];
            $id('kpi-groups').textContent = fmtNum(Array.isArray(groups) ? groups.length : 0);
        }

        $id('kpi-hosts-card').onclick   = () => Nav.go('hosts');
        $id('kpi-files-card').onclick   = () => Nav.go('inventory');
        $id('kpi-running-card').onclick = () => Nav.go('jobs');
        $id('kpi-groups-card').onclick  = () => Nav.go('hosts');
    }

    function _renderJobs(res) {
        const tb = $id('dash-jobs-body');
        if (!res.ok) {
            tb.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="padding:24px 0;">
                <div class="empty-state-sub">Could not load jobs.</div></div></td></tr>`;
            return;
        }

        const raw  = res.data.jobs || res.data || [];
        const jobs = raw.map(_norm);

        if (!jobs.length) {
            tb.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="padding:24px 0;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <div class="empty-state-title">No jobs yet</div>
                <div class="empty-state-sub">Submit your first job to get started.</div>
            </div></td></tr>`;
            return;
        }

        tb.innerHTML = jobs.map(j => `
            <tr>
                <td><span class="cell-link" onclick="Jobs.openDetail('${escHtml(j.id)}')">${escHtml(j.id)}</span></td>
                <td>${modeBadge(j.mode)}</td>
                <td>${statusBadge(j.status)}</td>
                <td style="font-size:12px;color:var(--text-secondary);">—</td>
                <td>${progressBar(j.progress, j.total)}</td>
                <td style="font-size:12px;">${escHtml(j.started)}</td>
                <td style="font-size:12px;">${j.status === 'running'
                    ? '<span class="dot-running"></span>Running'
                    : escHtml(j.duration)}</td>
            </tr>`).join('');
    }

    function _renderPlatforms(res) {
        const container = $id('platform-dist');
        if (!res.ok || !res.data.platform_counts) {
            container.innerHTML = '';
            return;
        }
        const platColors = {
            cisco_ios: '#1d4ed8', cisco_xe: '#15803d',
            cisco_xr: '#7c3aed', linux: '#854d0e',
        };
        const entries = Object.entries(res.data.platform_counts);
        if (!entries.length) {
            container.innerHTML = '<div style="font-size:13px;color:var(--text-secondary);">No platform data yet.</div>';
            return;
        }
        container.innerHTML = entries.map(([p, c]) => `
            <div class="kpi-card" style="min-height:80px;cursor:default;">
                <div style="font-size:28px;font-weight:700;color:${platColors[p] || '#64748b'};margin-bottom:6px;">${fmtNum(c)}</div>
                <div style="font-size:11px;color:var(--text-secondary);font-weight:600;">${p.replace(/_/g,' ').toUpperCase()}</div>
            </div>`).join('');
    }

    return { load };
})();
