/**
 * api.js — Thin fetch() wrapper for all /api/* calls.
 *
 * The browser always talks to port 64322 (this Flask UI).
 * The Flask proxy injects the netorch auth token server-side.
 * All methods return { data, ok, status }.
 */
'use strict';

const API = (() => {

    async function request(method, path, body = null) {
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (body !== null) {
            opts.body = JSON.stringify(body);
        }
        try {
            const res = await fetch(path, opts);
            let data;
            const ct = res.headers.get('content-type') || '';
            const text = await res.text();
            if (!text) {
                data = { error: `Empty response (HTTP ${res.status})` };
            } else if (ct.includes('application/json') || text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) {
                try { data = JSON.parse(text); }
                catch { data = { error: text }; }
            } else {
                data = { error: text };
            }
            return { data, ok: res.ok, status: res.status };
        } catch (err) {
            console.error(`API ${method} ${path} failed:`, err);
            return { data: { error: err.message }, ok: false, status: 0 };
        }
    }

    const get    = (path, params = {}) => {
        const qs = new URLSearchParams(
            Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined))
        ).toString();
        return request('GET', qs ? `${path}?${qs}` : path);
    };
    const post   = (path, body)   => request('POST',   path, body);
    const put    = (path, body)   => request('PUT',    path, body);
    const del    = (path)         => request('DELETE', path);

    // ── Health check ──────────────────────────────────────────────────────────
    async function checkHealth() {
        const { data, ok } = await get('/api/health');
        const el = $id('api-status-text');
        const banner = $id('api-error-banner');
        if (ok && data.status === 'ok') {
            el.textContent = 'Connected';
            el.style.color = 'var(--status-green)';
            banner.classList.remove('active');
        } else {
            el.textContent = 'Unreachable';
            el.style.color = 'var(--status-red)';
            banner.classList.add('active');
            $id('api-error-text').textContent =
                'Cannot reach netorch API on port 64321. Check that netorch is running.';
        }
    }

    // ── Inventory ─────────────────────────────────────────────────────────────
    const inventorySources          = ()            => get('/api/inventory/sources');
    const inventorySourceContent    = (file)        => get(`/api/inventory/sources/${encodeURIComponent(file)}`);
    const inventorySourceSave       = (file, body)  => put(`/api/inventory/sources/${encodeURIComponent(file)}`, body);
    const inventorySourceCreate     = (body)        => post('/api/inventory/sources', body);
    const inventorySourceDelete     = (file)        => del(`/api/inventory/sources/${encodeURIComponent(file)}`);
    const inventoryReload           = ()            => post('/api/inventory/reload');
    const inventoryGroups           = ()            => get('/api/inventory/groups');

    // ── Hosts (server-side paginated) ─────────────────────────────────────────
    const hosts = (params) => get('/api/hosts', params);

    // ── Jobs ──────────────────────────────────────────────────────────────────
    const jobsList   = (params)  => get('/api/jobs', params);
    const jobGet     = (id)      => get(`/api/jobs/${id}`);
    const jobDetail  = (id)      => get(`/api/jobs/${id}/detail`);
    const jobSubmit  = (payload) => post('/api/jobs', payload);
    const jobCancel  = (id)      => del(`/api/jobs/${id}`);
    const jobLogUrl  = (id)      => `/api/jobs/${id}/log`;

    // ── Runbooks ──────────────────────────────────────────────────────────────
    const runbooksList = ()              => get('/api/runbooks');
    const runbookGet   = (name)          => get(`/api/runbooks/${encodeURIComponent(name)}`);
    const runbookRun   = (name, payload) => post(`/api/runbooks/${encodeURIComponent(name)}/run`, payload);
    const runbookSave   = (name, content)       => put(`/api/runbooks/${encodeURIComponent(name)}`, { content });
    const runbookCreate = (filename, content)   => post('/api/runbooks', { filename, content });
    const runbookDelete = (name)                => del(`/api/runbooks/${encodeURIComponent(name)}`);

    // ── Workflows ─────────────────────────────────────────────────────────────
    const workflowsList  = ()                   => get('/api/workflows');
    const workflowGet    = (name)               => get(`/api/workflows/${encodeURIComponent(name)}`);
    const workflowSave   = (name, content)      => put(`/api/workflows/${encodeURIComponent(name)}`, { content });
    const workflowCreate = (filename, content)  => post('/api/workflows', { filename, content });
    const workflowDelete = (name)               => del(`/api/workflows/${encodeURIComponent(name)}`);

    return {
        get, post,
        checkHealth,
        inventorySources, inventorySourceContent, inventorySourceSave,
        inventorySourceCreate, inventorySourceDelete, inventoryReload,
        inventoryGroups,
        hosts,
        jobsList, jobGet, jobDetail, jobSubmit, jobCancel, jobLogUrl,
        runbooksList, runbookGet, runbookRun, runbookSave, runbookCreate, runbookDelete,
        workflowsList, workflowGet, workflowSave, workflowCreate, workflowDelete,
    };
})();
