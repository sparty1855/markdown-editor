/*
 * app.js — Home screen (notes & templates) + Editor screen (autosaving).
 */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const editor = $('#editor');
  const preview = $('#preview');
  const insertSheet = $('#insert-sheet');

  let currentId = null;      // persisted doc id (null until first autosave)
  let currentIsTemplate = false;
  let saveTimer = null;

  // ---------------------------------------------------------------- helpers
  function toast(msg, variant = 'secondary', ms = 2400) {
    const el = document.createElement('div');
    el.className = `toast align-items-center text-bg-${variant} border-0`;
    el.role = 'alert';
    el.innerHTML = `<div class="d-flex"><div class="toast-body">${msg}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
    $('#toast-holder').appendChild(el);
    const t = new bootstrap.Toast(el, { delay: ms });
    t.show();
    el.addEventListener('hidden.bs.toast', () => el.remove());
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(ts) {
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // The note's title is the first non-empty line, markdown stripped.
  function derivedTitle(body) {
    const first = (body || '').split('\n').map((l) => l.trim()).find((l) => l);
    const cleaned = first ? first.replace(/^#{1,6}\s*/, '').replace(/[*_~`]+/g, '').trim() : '';
    if (cleaned) return cleaned.slice(0, 90);
    return 'Note — ' + new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function snippet(body) {
    const lines = (body || '').split('\n').map((l) => l.trim());
    const firstIdx = lines.findIndex((l) => l);
    return (lines.slice(firstIdx + 1).find((l) => l) || '').slice(0, 120);
  }

  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toast(label + ' copied to clipboard', 'success');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        toast(label + ' copied to clipboard', 'success');
      } catch {
        toast('Copy failed', 'danger');
      }
      ta.remove();
    }
  }

  // Simple modal helper: shows a Bootstrap modal, resolves with a callback's
  // value on OK, or null when dismissed. Cleanup is automatic.
  function showModal(modalEl, onOk, focusEl) {
    return new Promise((resolve) => {
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      const okBtn = modalEl.querySelector('.modal-footer .btn-primary');
      const cleanup = (val) => {
        okBtn.removeEventListener('click', onOkClick);
        modalEl.removeEventListener('hidden.bs.modal', onHidden);
        modal.hide();
        resolve(val);
      };
      const onOkClick = () => {
        const val = onOk();
        if (val !== false) cleanup(val);
      };
      const onHidden = () => {
        okBtn.removeEventListener('click', onOkClick);
        modalEl.removeEventListener('hidden.bs.modal', onHidden);
        resolve(null);
      };
      okBtn.addEventListener('click', onOkClick);
      modalEl.addEventListener('hidden.bs.modal', onHidden);
      modalEl.addEventListener('shown.bs.modal', () => focusEl && focusEl.focus(), { once: true });
      modal.show();
    });
  }

  // ---------------------------------------------------------------- preview
  function updatePreview() {
    preview.innerHTML = RedditMD.toHtml(RedditMD.normalize(editor.value));
  }

  let previewTimer = null;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 120);
  }

  // ------------------------------------------------------------- pane tabs
  const isPhone = () => window.matchMedia('(max-width: 991.98px)').matches;
  function setPane(which) {
    const desktop = !isPhone();
    const editCol = $('#col-editor');
    const prevCol = $('#col-preview');
    if (desktop) {
      editCol.classList.remove('d-none');
      prevCol.classList.remove('d-none');
    } else {
      editCol.classList.toggle('d-none', which !== 'edit');
      prevCol.classList.toggle('d-none', which !== 'preview');
    }
    // The FAB inserts into the text — meaningless while reading the preview.
    const fabHidden = which !== 'edit';
    $('#fab-insert').classList.toggle('d-none', fabHidden);
    if (fabHidden) bootstrap.Offcanvas.getInstance(insertSheet)?.hide();
    if (which === 'preview') updatePreview();
    $('#tab-edit').classList.toggle('active', which === 'edit');
    $('#tab-edit').setAttribute('aria-pressed', String(which === 'edit'));
    $('#tab-preview').classList.toggle('active', which === 'preview');
    $('#tab-preview').setAttribute('aria-pressed', String(which === 'preview'));
  }
  $('#tab-edit').addEventListener('click', () => setPane('edit'));
  $('#tab-preview').addEventListener('click', () => setPane('preview'));
  window.matchMedia('(min-width: 992px)').addEventListener('change', () => {
    setPane(isPhone() ? 'edit' : 'edit');
  });

  // ---------------------------------------------------------------- screens
  function showHome() {
    flushSave();
    $('#screen-editor').classList.add('d-none');
    $('#screen-home').classList.remove('d-none');
    renderLists();
  }

  function showEditor() {
    $('#screen-home').classList.add('d-none');
    $('#screen-editor').classList.remove('d-none');
    $('#badge-template').classList.toggle('d-none', !currentIsTemplate);
    $('#btn-toggle-template').textContent = currentIsTemplate ? 'Convert back to note' : 'Save as template';
    setPane('edit');
    updatePreview();
  }

  function newDoc(opts) {
    currentId = null;
    currentIsTemplate = !!(opts && opts.isTemplate);
    editor.value = (opts && opts.body) || '';
    showEditor();
    if (!isPhone()) editor.focus();
  }

  function openDoc(id) {
    const doc = Store.get(id);
    if (!doc) return;
    currentId = doc.id;
    currentIsTemplate = !!doc.template;
    editor.value = doc.body;
    showEditor();
    if (!isPhone()) editor.focus();
  }

  // ---------------------------------------------------------------- autosave
  editor.addEventListener('input', () => {
    schedulePreview();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 500);
  });

  function flushSave() {
    clearTimeout(saveTimer);
    const body = editor.value;
    if (!currentId && !body.trim()) return;  // don't persist untouched new notes
    let doc;
    if (currentId) {
      doc = Store.get(currentId);
      if (!doc) { currentId = null; return; }
    } else {
      doc = { title: '', body: '', template: currentIsTemplate };
    }
    doc.body = body;
    doc.title = derivedTitle(body);
    const saved = Store.put(doc);
    currentId = saved.id;
    currentIsTemplate = !!saved.template;
  }

  window.addEventListener('pagehide', () => flushSave());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });

  $('#btn-back').addEventListener('click', () => {
    if (currentId && !editor.value.trim()) {
      Store.remove(currentId);        // user emptied an existing note then left
      toast('Note deleted (empty)', 'secondary');
    }
    showHome();
  });

  // ---------------------------------------------------------------- toolbar
  function wrapSelection(before, after, placeholder) {
    const start = editor.selectionStart, end = editor.selectionEnd;
    const sel = editor.value.slice(start, end) || placeholder || '';
    editor.setRangeText(before + sel + after, start, end, 'end');
    const s = start + before.length, e = s + sel.length;
    editor.setSelectionRange(s, e);
    editor.focus();
    editor.dispatchEvent(new Event('input'));
  }

  function prefixLines(prefixFn) {
    const start = editor.selectionStart, end = editor.selectionEnd;
    const value = editor.value;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = value.length;
    const lines = value.slice(lineStart, lineEnd).split('\n');
    editor.setRangeText(lines.map((l, i) => prefixFn(l, i)).join('\n'), lineStart, lineEnd, 'end');
    editor.focus();
    editor.dispatchEvent(new Event('input'));
  }

  function insertBlock(text) {
    const start = editor.selectionStart;
    editor.setRangeText('\n' + text + '\n', start, start, 'end');
    editor.focus();
    editor.dispatchEvent(new Event('input'));
  }

  const actions = {
    bold: () => wrapSelection('**', '**', 'bold text'),
    italic: () => wrapSelection('*', '*', 'italic text'),
    underline: () => wrapSelection('<u>', '</u>', 'underlined'),
    strike: () => wrapSelection('~~', '~~', 'struck text'),
    code: () => wrapSelection('`', '`', 'code'),
    sup: () => wrapSelection('^(', ')', 'superscript'),
    link: () => wrapSelection('[', '](https://example.com)', 'label'),
    h1: () => prefixLines((l) => '# ' + l.replace(/^#{1,6}\s*/, '')),
    h2: () => prefixLines((l) => '## ' + l.replace(/^#{1,6}\s*/, '')),
    h3: () => prefixLines((l) => '### ' + l.replace(/^#{1,6}\s*/, '')),
    h4: () => prefixLines((l) => '#### ' + l.replace(/^#{1,6}\s*/, '')),
    ul: () => prefixLines((l) => (/^\s*[-*+]\s+/.test(l) ? l : '- ' + l)),
    ol: () => prefixLines((l, i) => (/\d+\.\s/.test(l) ? l : (i + 1) + '. ' + l)),
    spoiler: () => wrapSelection('>!', '!<', 'spoiler text'),
    rule: () => insertBlock('---'),
    table: () => tableFlow(),
    quote: () => quoteFlow()
  };

  // --- table: ask for size, then insert
  async function tableFlow() {
    const colsEl = $('#tbl-cols');
    const rowsEl = $('#tbl-rows');
    colsEl.value = 3;
    rowsEl.value = 3;
    const dims = await showModal($('#modal-table'), () => {
      const cols = Math.min(20, Math.max(1, parseInt(colsEl.value, 10) || 3));
      const rows = Math.min(200, Math.max(1, parseInt(rowsEl.value, 10) || 3));
      return { cols, rows };
    }, colsEl);
    if (!dims) return;
    const header = [];
    for (let c = 0; c < dims.cols; c++) header.push('Column ' + (c + 1));
    const table = [];
    table.push('| ' + header.join(' | ') + ' |');
    table.push('|' + header.map(() => ' --- ').join('|') + '|');
    for (let r = 0; r < dims.rows; r++) {
      table.push('| ' + header.map(() => '  ').join(' | ') + ' |');
    }
    insertBlock(table.join('\n'));
  }

  // --- quote: ask for the text, then quote every line at once
  async function quoteFlow() {
    const textEl = $('#quote-text');
    textEl.value = '';
    const text = await showModal($('#modal-quote'), () => {
      if (!textEl.value.trim()) return false;   // keep modal open on empty
      return textEl.value.replace(/\s+$/, '');
    }, textEl);
    if (!text) return;
    const quoted = text.split('\n').map((l) => '> ' + l).join('\n');
    insertBlock(quoted);
  }

  document.querySelectorAll('[data-md]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions[btn.dataset.md]();
      // Close the insert sheet if it's open (its buttons also carry data-md).
      bootstrap.Offcanvas.getInstance(insertSheet)?.hide();
    });
  });
  $('#fab-insert').addEventListener('click', () => {
    bootstrap.Offcanvas.getOrCreateInstance(insertSheet).show();
  });

  editor.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); actions.bold(); }
    else if (k === 'i') { e.preventDefault(); actions.italic(); }
    else if (k === 'k') { e.preventDefault(); actions.link(); }
  });
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
      editor.dispatchEvent(new Event('input'));
    }
  });

  // ---------------------------------------------------------------- copy
  $('#btn-copy').addEventListener('click', () => {
    flushSave();
    copyText(RedditMD.normalize(editor.value), 'Markdown');
  });
  $('#btn-copy-unicode').addEventListener('click', () => {
    copyText(RedditMD.toText(RedditMD.normalize(editor.value)), 'Unicode text');
  });

  // ---------------------------------------------------------------- kebab
  $('#btn-toggle-template').addEventListener('click', () => {
    flushSave();
    if (!currentId) {
      toast('Type something first', 'warning');
      return;
    }
    const doc = Store.get(currentId);
    doc.template = !doc.template;
    Store.put(doc);
    currentIsTemplate = !!doc.template;
    $('#badge-template').classList.toggle('d-none', !doc.template);
    $('#btn-toggle-template').textContent = doc.template ? 'Convert back to note' : 'Save as template';
    toast(doc.template ? 'Saved as template' : 'Converted back to note', 'success');
  });

  // ---------------------------------------------------------------- home
  const homeTabs = { notes: $('#tab-notes'), templates: $('#tab-templates') };
  function setHomeTab(which) {
    homeTabs.notes.classList.toggle('active', which === 'notes');
    homeTabs.notes.setAttribute('aria-selected', String(which === 'notes'));
    homeTabs.templates.classList.toggle('active', which === 'templates');
    homeTabs.templates.setAttribute('aria-selected', String(which === 'templates'));
    $('#home-panel-notes').classList.toggle('d-none', which !== 'notes');
    $('#home-panel-templates').classList.toggle('d-none', which !== 'templates');
  }
  homeTabs.notes.addEventListener('click', () => setHomeTab('notes'));
  homeTabs.templates.addEventListener('click', () => setHomeTab('templates'));

  // Two-tap delete (window.confirm is unreliable in iOS standalone PWAs).
  function bindDelete(btn, fn) {
    btn.addEventListener('click', () => {
      if (btn.dataset.armed === '1') {
        fn();
        return;
      }
      btn.dataset.armed = '1';
      const original = btn.innerHTML;
      btn.innerHTML = 'Sure?';
      btn.classList.remove('btn-outline-danger');
      btn.classList.add('btn-danger');
      setTimeout(() => {
        btn.dataset.armed = '';
        btn.innerHTML = original;
        btn.classList.add('btn-outline-danger');
        btn.classList.remove('btn-danger');
      }, 2500);
    });
  }

  function renderDocList() {
    const listEl = $('#doc-list');
    const q = ($('#doc-search').value || '').toLowerCase();
    const docs = Store.getDocs()
      .filter((d) => d.title.toLowerCase().includes(q) || d.body.toLowerCase().includes(q))
      .sort((a, b) => b.updated - a.updated);
    listEl.innerHTML = '';
    if (!docs.length) {
      listEl.innerHTML = '<p class="text-muted small mb-0">No notes yet. Tap <strong>✎ New note</strong> to start one.</p>';
      return;
    }
    for (const d of docs) {
      const item = document.createElement('div');
      item.className = 'list-group-item d-flex justify-content-between align-items-center gap-2 doc-row';
      item.innerHTML =
        '<div class="overflow-hidden flex-grow-1" data-open style="cursor:pointer;min-width:0">' +
          '<div class="fw-semibold text-truncate">' + escapeHtml(d.title) + '</div>' +
          '<div class="small text-muted text-truncate">' + escapeHtml(snippet(d.body)) + '</div>' +
          '<div class="small text-secondary-emphasis">' + fmtDate(d.updated) + '</div>' +
        '</div>' +
        '<div class="d-flex flex-column flex-sm-row gap-1 flex-shrink-0">' +
          '<button class="btn btn-outline-secondary btn-sm" data-copy title="Copy markdown">📋</button>' +
          '<button class="btn btn-outline-danger btn-sm" data-del title="Delete">🗑</button>' +
        '</div>';
      item.querySelector('[data-open]').addEventListener('click', () => openDoc(d.id));
      item.querySelector('[data-copy]').addEventListener('click', async () => {
        await copyText(RedditMD.normalize(d.body), d.title);
      });
      bindDelete(item.querySelector('[data-del]'), () => {
        Store.remove(d.id);
        if (currentId === d.id) currentId = null;
        renderDocList();
        toast('Note deleted', 'secondary');
      });
      listEl.appendChild(item);
    }
  }

  function renderTemplateList() {
    const listEl = $('#template-list');
    const templates = Store.getTemplates().sort((a, b) => a.title.localeCompare(b.title));
    listEl.innerHTML = '';
    if (!templates.length) {
      listEl.innerHTML =
        '<p class="text-muted small mb-0">No templates yet. Create one here, or open a note in the editor ' +
        'and use <strong>⋮ → Save as template</strong>.</p>';
      return;
    }
    for (const t of templates) {
      const item = document.createElement('div');
      item.className = 'list-group-item d-flex justify-content-between align-items-center gap-2';
      item.innerHTML =
        '<div class="overflow-hidden flex-grow-1" data-edit style="cursor:pointer;min-width:0">' +
          '<div class="fw-semibold text-truncate">' + escapeHtml(t.title) + '</div>' +
          '<div class="small text-muted text-truncate">' + escapeHtml(snippet(t.body)) + '</div>' +
        '</div>' +
        '<div class="d-flex flex-sm-row gap-1 flex-shrink-0">' +
          '<button class="btn btn-primary btn-sm" data-use title="Create note from template">Use</button>' +
          '<button class="btn btn-outline-danger btn-sm" data-del title="Delete">🗑</button>' +
        '</div>';
      item.querySelector('[data-edit]').addEventListener('click', () => openDoc(t.id));
      item.querySelector('[data-use]').addEventListener('click', () => {
        newDoc({ body: t.body, isTemplate: false });
        toast('Started from template: ' + t.title, 'info');
      });
      bindDelete(item.querySelector('[data-del]'), () => {
        Store.remove(t.id);
        if (currentId === t.id) currentId = null;
        renderTemplateList();
        toast('Template deleted', 'secondary');
      });
      listEl.appendChild(item);
    }
  }

  function renderLists() {
    renderDocList();
    renderTemplateList();
  }

  $('#btn-new-doc').addEventListener('click', () => newDoc());
  $('#btn-new-template').addEventListener('click', () => newDoc({ isTemplate: true }));
  $('#doc-search').addEventListener('input', renderDocList);

  // ---------------------------------------------------------------- init
  showHome();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
