/**
 * nav.js — View routing and browser history management.
 * Single-page navigation without a framework.
 */
'use strict';

const Nav = (() => {
    const META = {
        overview:  { title: 'Dashboard',   subtitle: 'netorch — Network Device Orchestrator' },
        inventory: { title: 'Inventory',   subtitle: 'Manage inventory files and device sources' },
        hosts:     { title: 'Hosts',       subtitle: 'Browse and inspect all known devices' },
        jobs:      { title: 'Jobs',        subtitle: 'Monitor running and historical jobs' },
        newjob:    { title: 'New Job',     subtitle: 'Submit a new job on target devices' },
        jobdetail: { title: 'Job Detail',  subtitle: 'Per-device results and live log stream' },
        runbooks:  { title: 'Runbooks',    subtitle: 'Execute predefined command runbooks on devices' },
        workflows:   { title: 'Workflows',   subtitle: 'YAML-defined multi-step orchestration' },
        discovery:   { title: 'Discovery',   subtitle: 'BigFix Asset Discovery — unmanaged network devices' },
        compliance:  { title: 'Compliance',  subtitle: 'Vulnerability Scanning — Cisco PSIRT' },
    };

    const history  = [];
    let   cursor   = -1;
    let   skipPush = false;   // set when navigating via back/fwd

    function go(view, menuEl) {
        // Activate the right section
        document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));

        const section = $id('view-' + view);
        if (section) section.classList.add('active');

        if (menuEl) {
            menuEl.classList.add('active');
        } else {
            const m = document.querySelector(`.menu-item[data-view="${view}"]`);
            if (m) m.classList.add('active');
        }

        // Update page header
        const meta = META[view] || { title: view, subtitle: '' };
        $id('page-title').textContent    = meta.title;
        $id('page-subtitle').textContent = meta.subtitle;

        // Dynamic toolbar per view
        _setToolbar(view);

        // Push to internal history
        if (!skipPush) {
            if (cursor === -1 || history[cursor] !== view) {
                history.splice(cursor + 1);
                history.push(view);
                cursor = history.length - 1;
            }
        }
        _updateArrows();

        // Trigger view-specific data load
        _onEnter(view);
    }

    function back() {
        if (cursor > 0) {
            cursor--;
            skipPush = true;
            go(history[cursor]);
            skipPush = false;
        }
    }

    function fwd() {
        if (cursor < history.length - 1) {
            cursor++;
            skipPush = true;
            go(history[cursor]);
            skipPush = false;
        }
    }

    function _updateArrows() {
        $id('nav-back').disabled = cursor <= 0;
        $id('nav-fwd').disabled  = cursor >= history.length - 1;
    }

    function _setToolbar(view) {
        const tb = $id('page-toolbar');
        tb.innerHTML = '';
        if (view === 'jobdetail') {
            tb.innerHTML = `
                <button class="btn btn-outline" onclick="Nav.go('jobs')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
                    Back to Jobs
                </button>`;
        }
        if (view === 'hosts') {
            tb.innerHTML = `
                <button class="btn btn-primary" onclick="Nav.go('newjob')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    New Job
                </button>`;
        }
    }

    function _onEnter(view) {
        if (view === 'overview')  Dashboard.load();
        if (view === 'inventory') Inventory.load();
        if (view === 'hosts')     Hosts.load();
        if (view === 'jobs')      Jobs.load();
        if (view === 'newjob')    NewJob.onEnter();
        if (view === 'runbooks')  Runbooks.load();
        if (view === 'workflows') Workflows.load();
        if (view === 'discovery')  Discovery.load();
        if (view === 'compliance') Compliance.onActivate();
    }

    return { go, back, fwd };
})();
