const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

/** A controller-friendly manager for website tabs in the XMB Media Center. */
export function createMediaCenter({ dialog, api = window.launcher, onState = () => {},
  onError = () => {}, onOpen = () => dialog.showModal(), onClose = () => dialog.close(),
  onFocus = () => {} } = {}) {
  if (!dialog) throw new Error('Media Center needs its dialog element.');
  let links = [];
  let mode = 'list';
  let editingId = null;
  let busy = false;
  let message = '';

  const find = id => links.find(link => link.id === id);
  const notifyFocus = () => { if (dialog.open) queueMicrotask(() => onFocus(dialog)); };
  const showError = error => {
    message = String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
    const node = dialog.querySelector('.media-message');
    if (node) { node.textContent = message; node.hidden = false; }
    onError(error);
  };

  function renderList() {
    const rows = links.map(link => `<div class="media-site">
      <span class="media-site-icon ${link.id === 'youtube' ? 'youtube' : ''}" aria-hidden="true">${link.id === 'youtube' ? '▶' : '◎'}</span>
      <span class="media-site-copy"><strong>${escapeHtml(link.title)}</strong><small>${escapeHtml(link.url)}</small></span>
      <button type="button" class="media-action primary" data-media-action="open" data-media-id="${escapeHtml(link.id)}" aria-label="Open ${escapeHtml(link.title)} in Chrome">Open</button>
      ${link.builtin ? '' : `<button type="button" class="media-action" data-media-action="edit" data-media-id="${escapeHtml(link.id)}" aria-label="Edit ${escapeHtml(link.title)}">Edit</button>
      <button type="button" class="media-action danger" data-media-action="remove" data-media-id="${escapeHtml(link.id)}" aria-label="Remove ${escapeHtml(link.title)}">Remove</button>`}
    </div>`).join('');
    dialog.innerHTML = `<h2>Media Center</h2><div class="dialog-content media-content">
      <p class="media-lead">Open YouTube and your saved websites in Chrome tabs.</p>
      <div class="media-sites">${rows}</div>
      <button type="button" class="media-add" data-media-action="add"><span aria-hidden="true">＋</span> Add Website</button>
      <p class="media-message" role="alert" ${message ? '' : 'hidden'}>${escapeHtml(message)}</p>
    </div><button type="button" class="dialog-back" data-media-action="back">Back to XMB</button>`;
  }

  function renderEdit() {
    const link = editingId ? find(editingId) : null;
    dialog.innerHTML = `<h2>${link ? 'Edit Website' : 'Add Website'}</h2><div class="dialog-content media-content media-edit">
      <p class="media-lead">Save a website you want to open from your Media Center.</p>
      <label class="media-field"><span>Site name</span><input id="media-title" type="text" maxlength="60" autocomplete="off" placeholder="For example, YouTube Music" value="${escapeHtml(link?.title || '')}"></label>
      <label class="media-field"><span>Website address</span><input id="media-url" type="url" maxlength="2048" spellcheck="false" autocomplete="off" placeholder="https://example.com" value="${escapeHtml(link?.url || '')}"></label>
      <p class="media-hint">Use a full https:// or http:// website address.</p>
      <p class="media-message" role="alert" ${message ? '' : 'hidden'}>${escapeHtml(message)}</p>
      <div class="media-buttons"><button type="button" class="media-action primary" data-media-action="save">Save Website</button><button type="button" class="media-action" data-media-action="list">Cancel</button></div>
    </div><button type="button" class="dialog-back" data-media-action="list">Back to Media Center</button>`;
  }

  function renderConfirm() {
    const link = find(editingId);
    dialog.innerHTML = `<h2>Remove Website?</h2><div class="dialog-content media-content">
      <p class="media-lead">Remove <strong>${escapeHtml(link?.title || 'this website')}</strong> from your Media Center? This will not change your browser bookmarks.</p>
      <p class="media-message" role="alert" ${message ? '' : 'hidden'}>${escapeHtml(message)}</p>
      <div class="media-buttons"><button type="button" class="media-action danger" data-media-action="confirm-remove">Remove Website</button><button type="button" class="media-action" data-media-action="list">Keep Website</button></div>
    </div><button type="button" class="dialog-back" data-media-action="list">Back to Media Center</button>`;
  }

  function render() {
    if (mode === 'edit') renderEdit();
    else if (mode === 'confirm') renderConfirm();
    else renderList();
    notifyFocus();
  }

  function setState(state) {
    links = Array.isArray(state?.mediaLinks) ? state.mediaLinks : [];
    if (editingId && !find(editingId)) { editingId = null; mode = 'list'; }
    if (dialog.open && mode === 'list') render();
  }

  function show() {
    mode = 'list'; editingId = null; message = '';
    render(); onOpen(dialog); notifyFocus();
  }

  async function openLink(id) {
    if (busy) return null;
    busy = true;
    try {
      const result = await api.openMediaLink(id);
      if (dialog.open) onClose(dialog);
      return result;
    } catch (error) { showError(error); return null; }
    finally { busy = false; }
  }

  async function save() {
    if (busy) return;
    const input = { title: dialog.querySelector('#media-title')?.value || '', url: dialog.querySelector('#media-url')?.value || '' };
    if (editingId) input.id = editingId;
    busy = true;
    try {
      const state = await (editingId ? api.updateMediaLink(input) : api.addMediaLink(input));
      links = state.mediaLinks;
      mode = 'list'; editingId = null; message = '';
      onState(state); render();
    } catch (error) { showError(error); }
    finally { busy = false; }
  }

  async function remove() {
    if (busy || !editingId) return;
    busy = true;
    try {
      const state = await api.removeMediaLink(editingId);
      links = state.mediaLinks;
      mode = 'list'; editingId = null; message = '';
      onState(state); render();
    } catch (error) { showError(error); }
    finally { busy = false; }
  }

  dialog.addEventListener('click', event => {
    const button = event.target.closest('[data-media-action]');
    if (!button || !dialog.contains(button) || busy) return;
    const action = button.dataset.mediaAction;
    const id = button.dataset.mediaId;
    if (action === 'open') { void openLink(id); return; }
    if (action === 'save') { void save(); return; }
    if (action === 'confirm-remove') { void remove(); return; }
    if (action === 'back') { onClose(dialog); return; }
    if (action === 'list') { mode = 'list'; editingId = null; message = ''; render(); return; }
    if (action === 'add') { mode = 'edit'; editingId = null; message = ''; render(); return; }
    if (action === 'edit' && find(id) && !find(id).builtin) { mode = 'edit'; editingId = id; message = ''; render(); return; }
    if (action === 'remove' && find(id) && !find(id).builtin) { mode = 'confirm'; editingId = id; message = ''; render(); }
  });

  dialog.addEventListener('keydown', event => {
    if (event.key === 'Enter' && mode === 'edit' && event.target.matches('input')) {
      event.preventDefault(); void save();
    }
  });

  return { setState, show, openLink };
}
