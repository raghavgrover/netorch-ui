/**
 * busy.js — shared device-reservation ("in use") state.
 *
 * Backs the pre-flight indicators that let an operator see a device is already
 * in use BEFORE submitting, rather than being told by a 409 afterwards.
 *
 * Reservation state changes constantly, so it is never served from the UI's
 * TTLCache; this module keeps only a very short client-side cache to avoid
 * hammering the endpoint when several widgets ask at once.
 */
const Busy = (() => {

    const TTL_MS = 8000;          // client-side freshness window

    let _map        = {};         // normalised host -> reservation record
    let _enabled    = true;       // false when [locking] enabled = false
    let _fetchedAt  = 0;
    let _inflight   = null;
    let _groupCache = {};         // group name -> [hosts]

    const _norm = h => String(h == null ? '' : h).trim().toLowerCase();

    /** Fetch current reservations (deduped + short-cached). */
    async function refresh(force = false) {
        if (!force && Date.now() - _fetchedAt < TTL_MS) return _map;
        if (_inflight) return _inflight;

        _inflight = (async () => {
            try {
                const res = await API.get('/api/devices/busy');
                if (res.ok && res.data) {
                    _enabled = res.data.locking_enabled !== false;
                    const next = {};
                    (res.data.devices || []).forEach(d => { next[_norm(d.host)] = d; });
                    _map = next;
                    _fetchedAt = Date.now();
                }
            } catch (_) {
                /* leave the previous snapshot in place on a transient failure */
            } finally {
                _inflight = null;
            }
            return _map;
        })();
        return _inflight;
    }

    function get(host)     { return _map[_norm(host)] || null; }
    function isBusy(host)  { return !!get(host); }
    function count()       { return Object.keys(_map).length; }
    function enabled()     { return _enabled; }
    function all()         { return Object.values(_map); }

    /** Members of an inventory group (cached — membership changes rarely). */
    async function groupHosts(group) {
        const key = _norm(group);
        if (_groupCache[key]) return _groupCache[key];
        const res = await API.get(`/api/inventory/groups/${encodeURIComponent(group)}`);
        if (!res.ok) return [];
        const raw   = res.data.hosts || res.data || [];
        const hosts = raw.map(h => (typeof h === 'string' ? h : h.host)).filter(Boolean);
        _groupCache[key] = hosts;
        return hosts;
    }

    /**
     * Resolve a list of New Job chips (each either a host or a group name) to
     * the reservations that would block them. Returns
     * [{ chip, host, reservation, viaGroup }].
     */
    async function resolveChips(chips) {
        await refresh();
        if (!_enabled || !count()) return [];
        const out = [];
        for (const chip of chips) {
            const direct = get(chip);
            if (direct) {
                out.push({ chip, host: direct.host, reservation: direct, viaGroup: false });
                continue;
            }
            // Not a literal busy host — it may be a group containing one.
            let members = [];
            try { members = await groupHosts(chip); } catch (_) { members = []; }
            members.forEach(h => {
                const r = get(h);
                if (r) out.push({ chip, host: r.host, reservation: r, viaGroup: true });
            });
        }
        return out;
    }

    function clearGroupCache() { _groupCache = {}; }

    /** One-line description of who holds a device, for tooltips. */
    function describe(reservation) {
        if (!reservation) return '';
        const who  = reservation.operator || 'unknown operator';
        const what = reservation.script || reservation.mode || 'a job';
        const kind = reservation.intent === 'write' ? 'configuring' : 'reading';
        return `In use — ${kind} by ${what} (${who}, job ${reservation.job_id || '?'})`;
    }

    return { refresh, get, isBusy, count, enabled, all,
             groupHosts, resolveChips, clearGroupCache, describe };
})();
