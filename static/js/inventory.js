/**
 * inventory.js — Inventory file management.
 */
'use strict';

const Inventory = (() => {
    let _editingFile = null;   // null = new file, string = filename being edited
    let _uploadFile  = null;   // File object from drag/drop or input

    // ── Load & render list ────────────────────────────────────────────────────

    async function load() {
        const list = $id('inv-list');
        list.innerHTML = '<div class="empty-state"><div class="empty-state-sub">Loading…</div></div>';

        const res = await API.inventorySources();
        if (!res.ok) {
            list.innerHTML = `<div class="api-error-banner active" style="margin:0;">
                Could not load inventory sources: ${escHtml(res.data?.error || 'Unknown error')}
            </div>`;
            return;
        }
        const sources = res.data.sources || res.data || [];
        $id('inv-count').textContent = `${sources.length} inventory file${sources.length !== 1 ? 's' : ''}`;

        if (!sources.length) {
            list.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <div class="empty-state-title">No inventory files</div>
                    <div class="empty-state-sub">Create or upload a <code>.ini</code> file to start managing devices.</div>
                </div>`;
            return;
        }

        list.innerHTML = sources.map(f => `
            <div class="inv-file-card" id="inv-card-${_safeId(f.file)}">
                <div>
                    <div class="inv-file-name">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                            style="width:16px;height:16px;color:var(--hcl-blue);flex-shrink:0;">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                        </svg>
                        ${escHtml(f.file)}
                    </div>
                    <div class="inv-file-meta">
                        <span>${fmtNum(f.hosts)} host${f.hosts !== 1 ? 's' : ''}</span>
                        <span>${fmtNum(f.groups)} group${f.groups !== 1 ? 's' : ''}</span>
                        <span style="font-family:monospace;font-size:11px;">${escHtml(f.path || '')}</span>
                    </div>
                </div>
                <div class="inv-file-actions">
                    <button class="btn btn-outline" style="font-size:12px;"
                        onclick="Inventory.editFile('${escHtml(f.file)}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>Edit
                    </button>
                    <button class="btn btn-outline" style="font-size:12px;"
                        onclick="Inventory.reloadFile('${escHtml(f.file)}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                        </svg>Reload
                    </button>
                    <button class="btn btn-danger" style="font-size:12px;"
                        onclick="Inventory.deleteFile('${escHtml(f.file)}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>Delete
                    </button>
                </div>
            </div>`).join('');
    }

    // ── New file modal ────────────────────────────────────────────────────────

    function openNew() {
        _editingFile = null;
        $id('inv-modal-title').textContent = 'New Inventory File';
        $id('inv-filename').value = '';
        $id('inv-filename').disabled = false;
        $id('inv-content').value =
            '; Ansible-style INI inventory\n' +
            '[group_name]\n' +
            '; <IP>  platform=cisco_ios  username=netaudit  password=CHANGE_ME  port=22\n\n' +
            '[all:vars]\n' +
            'port=22';
        openModal('modal-inv-edit');
        setTimeout(() => $id('inv-filename').focus(), 100);
    }

    // ── Edit existing file ────────────────────────────────────────────────────

    async function editFile(filename) {
        _editingFile = filename;
        $id('inv-modal-title').textContent = `Edit: ${filename}`;
        $id('inv-filename').value = filename;
        $id('inv-filename').disabled = true;
        $id('inv-content').value = 'Loading…';
        $id('inv-save-btn').disabled = true;
        openModal('modal-inv-edit');

        const res = await API.inventorySourceContent(filename);
        if (res.ok) {
            $id('inv-content').value = res.data.content || '';
        } else {
            $id('inv-content').value = `; Error loading file: ${res.data?.error || 'Unknown error'}`;
        }
        $id('inv-save-btn').disabled = false;
    }

    // ── Save (new or edit) ────────────────────────────────────────────────────

    async function save() {
        const filename = $id('inv-filename').value.trim();
        const content  = $id('inv-content').value;

        if (!filename) { showToast('Filename is required', 'error'); return; }
        if (!filename.endsWith('.ini')) { showToast('Filename must end with .ini', 'error'); return; }

        $id('inv-save-btn').disabled = true;
        $id('inv-save-btn').textContent = 'Saving…';

        let res;
        if (_editingFile) {
            res = await API.inventorySourceSave(filename, { content });
        } else {
            res = await API.inventorySourceCreate({ filename, content });
        }

        $id('inv-save-btn').disabled = false;
        $id('inv-save-btn').textContent = 'Save File';

        if (res.ok) {
            closeModal('modal-inv-edit');
            showToast(`Saved ${filename}`, 'success');
            load();
        } else {
            showToast(`Save failed: ${res.data?.detail || res.data?.error || 'Unknown error'}`, 'error');
        }
    }

    // ── Reload individual file ────────────────────────────────────────────────

    async function reloadFile(filename) {
        const res = await API.inventoryReload();
        if (res.ok) {
            showToast(`Inventory reloaded (includes ${filename})`, 'success');
            load();
        } else {
            showToast(`Reload failed: ${res.data?.error || 'Unknown error'}`, 'error');
        }
    }

    // ── Reload all ────────────────────────────────────────────────────────────

    async function reload() {
        const res = await API.inventoryReload();
        if (res.ok) {
            showToast('All inventory files reloaded', 'success');
            load();
        } else {
            showToast(`Reload failed: ${res.data?.error || 'Unknown error'}`, 'error');
        }
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    async function deleteFile(filename) {
        if (!confirm(`Delete ${filename}?\n\nThis removes the file from /opt/netorch/inventory/ and cannot be undone.`)) return;

        const res = await API.inventorySourceDelete(filename);
        if (res.ok) {
            showToast(`Deleted ${filename}`, 'info');
            load();
        } else {
            showToast(`Delete failed: ${res.data?.error || 'Unknown error'}`, 'error');
        }
    }

    // ── Upload modal ──────────────────────────────────────────────────────────

    function openUpload() {
        _uploadFile = null;
        $id('upload-preview').style.display = 'none';
        $id('upload-save-btn').disabled = true;
        $id('upload-input').value = '';
        openModal('modal-inv-upload');
    }

    function fileSelected(event) {
        const file = event.target.files[0];
        if (!file) return;
        _setUploadFile(file);
    }

    function dropFile(event) {
        event.preventDefault();
        $id('upload-drop-zone').classList.remove('drag-over');
        const file = event.dataTransfer.files[0];
        if (!file) return;
        _setUploadFile(file);
    }

    function _setUploadFile(file) {
        _uploadFile = file;
        $id('upload-fname').textContent = file.name;
        $id('upload-fsize').textContent = `${(file.size / 1024).toFixed(1)} KB`;
        $id('upload-preview').style.display = '';
        $id('upload-save-btn').disabled = false;
    }

    function clearUpload() {
        _uploadFile = null;
        $id('upload-preview').style.display = 'none';
        $id('upload-save-btn').disabled = true;
        $id('upload-input').value = '';
    }

    async function uploadSave() {
        if (!_uploadFile) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            const content  = e.target.result;
            const filename = _uploadFile.name;
            $id('upload-save-btn').disabled = true;
            $id('upload-save-btn').textContent = 'Uploading…';

            const res = await API.inventorySourceCreate({ filename, content });
            $id('upload-save-btn').disabled = false;
            $id('upload-save-btn').textContent = 'Upload & Save';

            if (res.ok) {
                closeModal('modal-inv-upload');
                clearUpload();
                showToast(`Uploaded ${filename}`, 'success');
                load();
            } else {
                showToast(`Upload failed: ${res.data?.error || 'Unknown error'}`, 'error');
            }
        };
        reader.readAsText(_uploadFile);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _safeId(str) {
        return str.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    return {
        load,
        openNew, editFile, save,
        reload, reloadFile, deleteFile,
        openUpload, fileSelected, dropFile, clearUpload, uploadSave,
    };
})();
