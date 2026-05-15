/**
 * utils.js — Shared UI helpers
 * No external dependencies. Loaded first by base.html.
 */
'use strict';

// ── DOM shorthand ─────────────────────────────────────────────────────────────
function $id(id) { return document.getElementById(id); }

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(id)  { $id(id).classList.add('active'); }
function closeModal(id) { $id(id).classList.remove('active'); }

// Close modal when clicking the backdrop
document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
    }
});

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
    const container = $id('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    t.innerHTML = `<span style="font-size:14px;">${icon}</span><span>${msg}</span>`;
    container.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 300);
    }, type === 'error' ? 5000 : 3000);
}

// ── Loader ────────────────────────────────────────────────────────────────────
const Loader = {
    show() { $id('loader').classList.add('active'); },
    hide() { $id('loader').classList.remove('active'); },
};

// ── Badge helpers ─────────────────────────────────────────────────────────────
function statusBadge(s) {
    if (!s) return '<span class="badge b-grey">—</span>';
    const map = {
        completed: 'b-green',
        success:   'b-green',
        failed:    'b-red',
        partial_failure: 'b-amber',
        running:   'b-blue',
        pending:   'b-grey',
        cancelled: 'b-grey',
    };
    const label = s.replace(/_/g, ' ');
    const cls = map[s] || 'b-grey';
    const dot = s === 'running' ? '<span class="dot-running"></span>' : '';
    return `<span class="badge ${cls}">${dot}${label}</span>`;
}

function modeBadge(m) {
    if (m === 'workflow') return '<span class="badge b-blue">workflow</span>';
    return '<span class="badge b-amber">run commands</span>';
}

function platBadge(p) {
    const map = {
        cisco_ios: ['plat-ios', 'Cisco IOS'],
        cisco_xe:  ['plat-xe',  'IOS-XE'],
        cisco_xr:  ['plat-xr',  'IOS-XR'],
        linux:     ['plat-linux', 'Linux'],
    };
    const [cls, label] = map[p] || ['plat-unknown', p];
    return `<span class="plat-badge ${cls}">${label}</span>`;
}

// ── Number formatter ──────────────────────────────────────────────────────────
function fmtNum(n) {
    if (n === null || n === undefined) return '—';
    return Number(n).toLocaleString();
}

// ── Duration helper ───────────────────────────────────────────────────────────
function fmtDuration(seconds) {
    if (!seconds && seconds !== 0) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

// ── Progress bar HTML ─────────────────────────────────────────────────────────
function progressBar(done, total) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return `
        <div style="display:flex;align-items:center;gap:8px;min-width:100px;">
            <div class="progress-bar-wrap">
                <div class="progress-bar-fill" style="width:${pct}%"></div>
            </div>
            <span style="font-size:11px;color:var(--text-secondary);white-space:nowrap;">${done}/${total}</span>
        </div>`;
}

// ── Log line coloriser ────────────────────────────────────────────────────────
function coloriseLine(line) {
    if (!line) return '';
    const l = line.toLowerCase();
    let cls = 'log-info';
    if (l.startsWith('show ') || l.startsWith('ping ') || l.startsWith('traceroute '))
        cls = 'log-cmd';
    else if (l.includes('error') || l.includes('fail') || l.includes('denied') || l.includes('unreachable'))
        cls = 'log-err';
    else if (l.includes('warn') || l.includes('caution'))
        cls = 'log-warn';
    else if (l.startsWith('cisco') || l.startsWith('router') || l.startsWith('switch') || l.startsWith('hostname'))
        cls = 'log-ok';
    return `<div class="${cls}">${escHtml(line)}</div>`;
}

function escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Paginator builder ─────────────────────────────────────────────────────────
/**
 * Renders pagination buttons into a container element.
 * @param {HTMLElement} container  - element to fill
 * @param {number}      currentPage - 0-based current page
 * @param {number}      totalPages
 * @param {function}    onPage     - called with new page index (0-based)
 */
function renderPager(container, currentPage, totalPages, onPage) {
    container.innerHTML = '';
    if (totalPages <= 1) return;

    const addBtn = (label, page, disabled, active) => {
        const b = document.createElement('button');
        b.className = 'pager-btn' + (active ? ' active' : '');
        b.textContent = label;
        b.disabled = disabled;
        b.addEventListener('click', () => onPage(page));
        container.appendChild(b);
    };

    addBtn('‹', currentPage - 1, currentPage === 0, false);

    // Window of at most 7 page buttons
    const start = Math.max(0, currentPage - 3);
    const end   = Math.min(totalPages - 1, currentPage + 3);
    if (start > 0) { addBtn('1', 0, false, false); if (start > 1) container.insertAdjacentHTML('beforeend', '<span class="pager-btn" style="cursor:default;border:none;">…</span>'); }
    for (let i = start; i <= end; i++) addBtn(i + 1, i, false, i === currentPage);
    if (end < totalPages - 1) { if (end < totalPages - 2) container.insertAdjacentHTML('beforeend', '<span class="pager-btn" style="cursor:default;border:none;">…</span>'); addBtn(totalPages, totalPages - 1, false, false); }

    addBtn('›', currentPage + 1, currentPage >= totalPages - 1, false);
}

// ── Debounce ──────────────────────────────────────────────────────────────────
function debounce(fn, delay) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}
