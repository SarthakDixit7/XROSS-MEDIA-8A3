const CONTROL_SELECTOR = 'button,select,textarea,input:not([type="hidden"]),a[href],[tabindex]:not([tabindex="-1"])';
const TEXT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);
const DIRECTION = new Set(['up', 'down', 'left', 'right']);

/** Return the next selectable index without ever selecting a disabled option. */
export function nextEnabledIndex(items, current, delta) {
  if (!items.length) return -1;
  for (let step = 1; step <= items.length; step++) {
    const index = ((current + delta * step) % items.length + items.length) % items.length;
    if (!items[index].disabled && !items[index].hidden) return index;
  }
  return -1;
}

/** Range math shared by controller left/right and number fields. */
export function steppedValue({ value, min = '0', max = '100', step = '1' }, direction) {
  const low = min === '' ? 0 : Number(min);
  const high = max === '' ? 100 : Number(max);
  const increment = step === 'any' || !Number.isFinite(Number(step)) || Number(step) <= 0 ? 1 : Number(step);
  const start = Number.isFinite(Number(value)) ? Number(value) : low;
  const next = Math.min(high, Math.max(low, start + direction * increment));
  return Number(next.toFixed(10));
}

const LETTER_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm,.-'];
const SYMBOL_ROWS = ['!@#$%^&*()', '[]{}<>/\\|:', '\'";?+=_~`'];
const ACTION_KEYS = ['Shift', 'Symbols', 'Space', 'Delete', 'Done', 'Cancel'];

const STYLES = `
.controller-editor{box-sizing:border-box;color:#fff;background:linear-gradient(145deg,rgba(20,42,63,.98),rgba(6,16,30,.98));border:1px solid #a8d9ff45;border-radius:18px;padding:28px;width:min(720px,88vw);max-height:84vh;box-shadow:0 26px 120px #0009;font:inherit;overflow:auto}
.controller-editor::backdrop{background:#020a165e;backdrop-filter:blur(7px)}
.controller-editor h2{font-size:25px;font-weight:400;letter-spacing:.04em;margin:0 0 20px}
.controller-editor .controller-editor-hint{font-size:13px;opacity:.65;letter-spacing:.025em;margin:18px 0 0}
.controller-choice-list{display:grid;gap:5px;max-height:54vh;overflow:auto;padding:4px}
.controller-choice{border:0;background:#ffffff08;color:inherit;text-align:left;border-radius:7px;padding:14px 16px;font:inherit;cursor:pointer;width:100%}
.controller-choice[aria-selected="true"]::after{content:'✓';float:right;opacity:.8}
.controller-choice:focus,.controller-key:focus,.controller-key.is-current{outline:2px solid #bce8ff;outline-offset:1px;background:#70cfff35;box-shadow:0 0 18px #99dbff24}
.controller-choice:disabled{opacity:.35;cursor:default}
.controller-keyboard-field{box-sizing:border-box;width:100%;font:inherit;font-size:22px;color:inherit;background:#0004;border:1px solid #bce8ff70;border-radius:8px;padding:12px 15px;outline:none;margin-bottom:18px}
.controller-keyboard-rows{display:grid;gap:7px}
.controller-key-row{display:flex;gap:7px;justify-content:center}
.controller-key{flex:1;min-width:0;max-width:64px;height:43px;border:1px solid #ffffff18;border-radius:6px;background:#ffffff0c;color:inherit;font:inherit;cursor:pointer}
.controller-key-row:last-child .controller-key{max-width:none;font-size:13px}
.controller-key[data-key="Done"]{background:#5bbb7430}
[data-controller-editing="true"]{outline:2px solid #bce8ff!important;outline-offset:5px}
@media(max-width:620px){.controller-editor{padding:18px}.controller-key-row{gap:4px}.controller-key{height:38px}.controller-key-row:last-child .controller-key{font-size:11px}}
`;

/**
 * Controller navigation for native dialogs, including custom select and text editors.
 * Call handle before XMB navigation. Native mouse/keyboard inputs remain unchanged.
 * onClose(dialog) should close the supplied dialog; callbacks may play UI sounds.
 */
export function createDialogInput({
  document: doc = globalThis.document,
  onNavigate = () => {}, onConfirm = () => {}, onBack = () => {},
  onClose = dialog => dialog.close()
} = {}) {
  if (!doc) throw new Error('Dialog input requires a document.');
  const contexts = new WeakMap();
  let activeDialog = null;
  let editor = null;
  let rangeTarget = null;
  let destroyed = false;
  let restoring = false;

  function visible(node) {
    if (!node || node.disabled || node.matches?.(':disabled') || node.getAttribute('aria-disabled') === 'true') return false;
    if (node.closest('[hidden],[inert]')) return false;
    if (!node.getClientRects().length) return false;
    const style = doc.defaultView?.getComputedStyle(node);
    return !style || (style.visibility !== 'hidden' && style.display !== 'none');
  }

  function controls(dialog) {
    return [...dialog.querySelectorAll(CONTROL_SELECTOR)].filter(visible);
  }

  function topDialog() {
    if (editor?.element.open) return editor.element;
    const focused = doc.activeElement?.closest?.('dialog[open]');
    if (focused) return focused;
    if (activeDialog?.open && activeDialog.isConnected) return activeDialog;
    return [...doc.querySelectorAll('dialog[open]')].at(-1) || null;
  }

  function reference(node, dialog) {
    return { dialog, node, id: node.id, name: node.getAttribute('name'), key: node.getAttribute('data-focus-key'), index: controls(dialog).indexOf(node) };
  }

  function resolve(ref, exact = false) {
    if (!ref?.dialog.open || !ref.dialog.isConnected) return null;
    if (ref.node?.isConnected && ref.dialog.contains(ref.node) && visible(ref.node)) return ref.node;
    const list = controls(ref.dialog);
    return list.find(node => ref.id && node.id === ref.id)
      || list.find(node => ref.key && node.getAttribute('data-focus-key') === ref.key)
      || list.find(node => ref.name && node.getAttribute('name') === ref.name)
      || (!exact && list[Math.min(Math.max(0, ref.index), list.length - 1)]) || null;
  }

  function focus(node, dialog = node?.closest('dialog')) {
    if (!node) return;
    node.focus({ preventScroll: true });
    node.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    if (dialog && !dialog.hasAttribute('data-controller-editor')) {
      activeDialog = dialog;
      contexts.set(dialog, reference(node, dialog));
    }
  }

  function focusFirst(dialog = topDialog()) {
    if (!dialog) return false;
    focus(controls(dialog)[0], dialog);
    return true;
  }

  function events(node) {
    const EventType = doc.defaultView.Event;
    node.dispatchEvent(new EventType('input', { bubbles: true }));
    node.dispatchEvent(new EventType('change', { bubbles: true }));
  }

  function label(node) {
    return node.getAttribute('aria-label') || node.labels?.[0]?.querySelector('span')?.textContent?.trim()
      || node.labels?.[0]?.textContent?.trim() || node.getAttribute('placeholder') || 'Edit value';
  }

  function ensureStyles() {
    if (doc.getElementById('controller-editor-styles')) return;
    const style = doc.createElement('style');
    style.id = 'controller-editor-styles';
    style.textContent = STYLES;
    doc.head.append(style);
  }

  function element(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function makeEditor(kind, target, dialog) {
    ensureStyles();
    endRange();
    const panel = element('dialog', 'controller-editor');
    panel.setAttribute('data-controller-editor', kind);
    const title = element('h2', '', label(target));
    title.id = `controller-editor-title-${kind}`;
    panel.setAttribute('aria-labelledby', title.id);
    panel.append(title);
    const state = { kind, element: panel, ref: reference(target, dialog) };
    panel.addEventListener('cancel', event => { event.preventDefault(); closeEditor(false); });
    panel.addEventListener('close', () => { if (editor === state) closeEditor(false); });
    doc.body.append(panel);
    editor = state;
    return state;
  }

  function closeEditor(commit) {
    if (!editor) return;
    const closed = editor;
    editor = null;
    const target = resolve(closed.ref, true);
    if (target && commit) {
      if (closed.kind === 'select') target.value = closed.choices[closed.index]?.value ?? target.value;
      if (closed.kind === 'keyboard') target.value = closed.field.value;
    }
    closed.element.close();
    closed.element.remove();
    focus(target, closed.ref.dialog);
    // Dispatch after restoring focus: change listeners may replace this control.
    if (target && commit) events(target);
    if (commit) onConfirm(); else onBack();
  }

  function openChoices(target, dialog) {
    const options = [...target.options].map(option => ({
      value: option.value, label: option.label || option.textContent,
      disabled: option.disabled || option.parentElement?.disabled, hidden: option.hidden
    }));
    if (nextEnabledIndex(options, -1, 1) < 0) return;
    const state = makeEditor('select', target, dialog);
    state.choices = options;
    state.index = options.findIndex(option => option.value === target.value && !option.disabled && !option.hidden);
    if (state.index < 0) state.index = nextEnabledIndex(options, -1, 1);
    const list = element('div', 'controller-choice-list');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', label(target));
    state.buttons = options.map((option, index) => {
      const button = element('button', 'controller-choice', option.label);
      button.type = 'button';
      button.disabled = Boolean(option.disabled);
      button.hidden = Boolean(option.hidden);
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(option.value === target.value));
      button.addEventListener('focus', () => { state.index = index; });
      button.addEventListener('click', () => { state.index = index; closeEditor(true); });
      list.append(button);
      return button;
    });
    state.element.append(list, element('p', 'controller-editor-hint', '↑ ↓ Choose     A / Enter Apply     B / Esc Cancel'));
    state.element.showModal();
    focus(state.buttons[state.index]);
    onConfirm();
  }

  function keyboardRows(state) {
    const rows = (state.symbols ? SYMBOL_ROWS : LETTER_ROWS).map(row => [...row].map(key => state.shift ? key.toUpperCase() : key));
    rows.push(ACTION_KEYS);
    return rows;
  }

  function highlightKey(state, moveFocus = false) {
    state.buttons.forEach(row => row.forEach(button => button.classList.remove('is-current')));
    const current = state.buttons[state.row]?.[state.column];
    current?.classList.add('is-current');
    if (moveFocus) focus(current);
  }

  function renderKeys(state) {
    state.rows = keyboardRows(state);
    state.row = Math.min(state.row, state.rows.length - 1);
    state.column = Math.min(state.column, state.rows[state.row].length - 1);
    state.keyArea.replaceChildren();
    state.buttons = state.rows.map((keys, rowIndex) => {
      const row = element('div', 'controller-key-row');
      const buttons = keys.map((key, columnIndex) => {
        const button = element('button', 'controller-key', key === 'Symbols' && state.symbols ? 'ABC' : key);
        button.type = 'button';
        button.dataset.key = key;
        button.addEventListener('focus', () => { state.row = rowIndex; state.column = columnIndex; highlightKey(state); });
        button.addEventListener('click', () => pressKey(state, key));
        row.append(button);
        return button;
      });
      state.keyArea.append(row);
      return buttons;
    });
    highlightKey(state);
  }

  function insertText(state, value) {
    const field = state.field;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const max = state.maxLength;
    const candidate = field.value.slice(0, start) + value + field.value.slice(end);
    if (max >= 0 && candidate.length > max) return;
    field.value = candidate;
    field.setSelectionRange(start + value.length, start + value.length);
  }

  function pressKey(state, key) {
    if (editor !== state) return;
    if (key === 'Done') { closeEditor(true); return; }
    if (key === 'Cancel') { closeEditor(false); return; }
    if (key === 'Shift' || key === 'Symbols') {
      state[key === 'Shift' ? 'shift' : 'symbols'] = !state[key === 'Shift' ? 'shift' : 'symbols'];
      renderKeys(state);
      highlightKey(state, true);
    } else if (key === 'Delete') {
      const start = state.field.selectionStart ?? state.field.value.length;
      const end = state.field.selectionEnd ?? start;
      // Delete a complete Unicode character, including pasted emoji.
      const previous = [...state.field.value.slice(0, start)].at(-1)?.length || 0;
      state.field.setSelectionRange(start === end ? start - previous : start, end);
      insertText(state, '');
    } else insertText(state, key === 'Space' ? ' ' : key);
    onConfirm();
  }

  function openKeyboard(target, dialog) {
    if (target.readOnly) return;
    const state = makeEditor('keyboard', target, dialog);
    Object.assign(state, { row: 0, column: 0, shift: false, symbols: false, maxLength: target.maxLength ?? -1 });
    state.field = element('input', 'controller-keyboard-field');
    state.field.type = target.type === 'password' ? 'password' : 'text';
    state.field.value = target.value;
    state.field.setAttribute('aria-label', label(target));
    state.field.autocomplete = 'off';
    state.field.spellcheck = false;
    if (state.maxLength >= 0) state.field.maxLength = state.maxLength;
    state.keyArea = element('div', 'controller-keyboard-rows');
    state.element.append(state.field, state.keyArea, element('p', 'controller-editor-hint', 'D-pad Move     A Type     X Delete     Y Shift     B Cancel · Keyboard typing supported'));
    renderKeys(state);
    state.element.showModal();
    state.field.focus();
    state.field.setSelectionRange(state.field.value.length, state.field.value.length);
    highlightKey(state);
    onConfirm();
  }

  function handleEditor(action) {
    const state = editor;
    if (action === 'back') { closeEditor(false); return true; }
    if (state.kind === 'select') {
      if (DIRECTION.has(action)) {
        state.index = nextEnabledIndex(state.choices, state.index, action === 'up' || action === 'left' ? -1 : 1);
        focus(state.buttons[state.index]);
        onNavigate();
      } else if (action === 'select') closeEditor(true);
      return true;
    }
    if (DIRECTION.has(action)) {
      if (action === 'left' || action === 'right') {
        const count = state.rows[state.row].length;
        state.column = (state.column + (action === 'left' ? -1 : 1) + count) % count;
      } else {
        state.row = (state.row + (action === 'up' ? -1 : 1) + state.rows.length) % state.rows.length;
        state.column = Math.min(state.column, state.rows[state.row].length - 1);
      }
      highlightKey(state, true);
      onNavigate();
    } else if (action === 'select') pressKey(state, state.rows[state.row][state.column]);
    else if (action === 'secondary') pressKey(state, 'Delete');
    else if (action === 'options') pressKey(state, 'Shift');
    return true;
  }

  function endRange() {
    resolve(rangeTarget, true)?.removeAttribute('data-controller-editing');
    rangeTarget = null;
  }

  function adjustRange(node, delta) {
    const value = steppedValue(node, delta);
    if (String(value) !== node.value) {
      node.value = value;
      events(node);
      onNavigate();
    }
  }

  function handle(action, suppliedDialog) {
    if (destroyed || action === 'fullscreen') return false;
    action = ({ home: 'back', previousCategory: 'left', nextCategory: 'right' })[action] || action;
    if (editor) {
      if (!editor.ref.dialog.open || !editor.ref.dialog.isConnected) closeEditor(false);
      else return handleEditor(action);
    }
    const dialog = suppliedDialog || topDialog();
    if (!dialog?.open) return false;
    if (rangeTarget && rangeTarget.dialog !== dialog) endRange();
    activeDialog = dialog;
    const list = controls(dialog);
    let current = list.includes(doc.activeElement) ? doc.activeElement : resolve(contexts.get(dialog));
    if (!current) current = list[0];
    if (current && current !== doc.activeElement) focus(current, dialog);
    if (action === 'back') {
      if (rangeTarget) { endRange(); onBack(); }
      else { onBack(); onClose(dialog); }
      return true;
    }
    if (!current) return true;
    if (action === 'up' || action === 'down') {
      endRange();
      const index = list.indexOf(current);
      focus(list[(index + (action === 'up' ? -1 : 1) + list.length) % list.length], dialog);
      onNavigate();
    } else if (action === 'left' || action === 'right') {
      if (current.matches('input[type="range"]')) adjustRange(current, action === 'left' ? -1 : 1);
      else if (current.matches('select')) openChoices(current, dialog);
      else {
        endRange();
        const index = list.indexOf(current);
        focus(list[(index + (action === 'left' ? -1 : 1) + list.length) % list.length], dialog);
        onNavigate();
      }
    } else if (action === 'select') {
      if (current.matches('select')) openChoices(current, dialog);
      else if (current.matches('input[type="range"]')) {
        if (rangeTarget) endRange();
        else { rangeTarget = reference(current, dialog); current.dataset.controllerEditing = 'true'; }
        onConfirm();
      } else if (current.matches('textarea') || (current.matches('input') && TEXT_TYPES.has(current.type))) openKeyboard(current, dialog);
      else { onConfirm(); current.click(); }
    }
    return true;
  }

  function rememberFocus(event) {
    const node = event.target;
    const dialog = node.closest?.('dialog[open]');
    if (!dialog || dialog.hasAttribute('data-controller-editor')) return;
    if (node.matches(CONTROL_SELECTOR)) {
      activeDialog = dialog;
      contexts.set(dialog, reference(node, dialog));
    }
  }

  function restoreFocus() {
    if (destroyed || restoring || editor || !activeDialog?.open || !activeDialog.isConnected) return;
    if (doc.activeElement !== doc.body && doc.activeElement !== activeDialog && doc.activeElement?.isConnected) return;
    const next = resolve(contexts.get(activeDialog));
    if (next) {
      restoring = true;
      focus(next, activeDialog);
      restoring = false;
    }
  }

  function editorKeydown(event) {
    if (!editor) return;
    // The app's XMB handler must not also consume keys from this nested editor.
    const action = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Escape: 'back', Enter: 'select' })[event.key];
    if (editor.kind === 'keyboard' && event.target === editor.field) {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); closeEditor(false); }
      else if (event.key === 'Enter') { event.preventDefault(); closeEditor(true); }
      // Editing, selection and caret movement use native text-field behaviour.
      return;
    }
    if (action) { event.preventDefault(); event.stopImmediatePropagation(); handleEditor(action); }
    else if (editor.kind === 'keyboard' && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
      event.preventDefault(); event.stopImmediatePropagation(); insertText(editor, event.key);
    } else if (editor.kind === 'keyboard' && event.key === 'Backspace') {
      event.preventDefault(); event.stopImmediatePropagation(); pressKey(editor, 'Delete');
    }
  }

  doc.addEventListener('focusin', rememberFocus, true);
  doc.addEventListener('keydown', editorKeydown, true);
  const Observer = doc.defaultView?.MutationObserver;
  const observer = Observer ? new Observer(restoreFocus) : null;
  observer?.observe(doc.body, { subtree: true, childList: true });

  return {
    handle, focusFirst,
    get isEditing() { return Boolean(editor || rangeTarget); },
    reset() { if (editor) closeEditor(false); endRange(); activeDialog = null; },
    destroy() {
      if (editor) closeEditor(false);
      endRange(); destroyed = true; observer?.disconnect();
      doc.removeEventListener('focusin', rememberFocus, true);
      doc.removeEventListener('keydown', editorKeydown, true);
    }
  };
}
