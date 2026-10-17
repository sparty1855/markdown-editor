/*
 * app.js — UI glue: editor, preview, copy, save, templates, service worker.
 */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const editor = $('#editor');
  const preview = $('#preview');
  const titleInput = $('#doc-title');
  let currentId = null;   // id of doc being edited (null = unsaved new doc)
  let currentIsTemplate = false;
  let rawMode = false;

  // ------------------------------------------------------------- pane tabs
  const isPhone = () => window.matchMedia('(max-width: 991.98px)').matches;
  function setPane(which) {
    const showPreview = which === 'preview';
    document.body.classList.toggle('show-preview', showPreview);
    $('#tab-edit').classList.toggle('active', !showPreview);
    $('#tab-edit').setAttribute('aria-pressed', String(!showPreview));
    $('#tab-preview').classList.toggle('active', showPreview);
    $('#tab-preview').setAttribute('aria-pressed', String(showPreview));
    if (showPreview) updatePreview();
    localStorage.setItem('redditmd.pane', which);
  }
  $('#tab-edit').addEventListener('click', () => setPane('edit'));
  $('#tab-preview').addEventListener('click', () => setPane('preview'));
  // On phones start on whichever pane the user last used (default: edit).
  if (isPhone()) setPane(localStorage.getItem('redditmd.pane') || 'edit');
  else setPane('preview');
  // Keep tabs consistent when the viewport crosses the breakpoint.
  window.matchMedia('(min-width: 992px)').addEventListener('change', (e) => {
    if (e.matches) setPane('preview');
    else setPane(localStorage.getItem('redditmd.pane') || 'edit');
  });

  // ---------------------------------------------------------------- helpers
  function toast(msg, variant = 'secondary', ms = 2600) {
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

  function promptModal(title, label, initial) {
    return new Promise((resolve) => {
      const modalEl = $('#modal-prompt');
      $('#modal-prompt-title').textContent = title;
      $('#modal-prompt-label').textContent = label;
      const input = $('#modal-prompt-input');
      input.value = initial || '';
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      const ok = $('#modal-prompt-ok');
      const done = (val) => {
        modal.hide();
        ok.removeEventListener('click', onOk);
        input.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const onOk = () => done(input.value.trim() || null);
      const onKey = (e) => { if (e.key === 'Enter') onOk(); };
      ok.addEventListener('click', onOk);
      input.addEventListener('keydown', onKey);
      modalEl.addEventListener('shown.bs.modal', () => input.select(), { once: true });
      modal.show();
    });
  }

  function confirmDelete() {
    // No native confirm styling; use a toast-based double-check variable.
    return window.confirm('Delete this item? This cannot be undone.');
  }

  // ---------------------------------------------------------------- preview
  function updatePreview() {
    const md = RedditMD.normalize(editor.value);
    if (rawMode) {
      preview.innerHTML = '<pre style="white-space:pre-wrap;margin:0"></pre>';
      preview.firstChild.textContent = md;
    } else {
      preview.innerHTML = RedditMD.toHtml(md);
    }
  }

  let previewTimer = null;
  editor.addEventListener('input', () => {
    saveDraft();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 120);
  });

  // Pasting a link over a selection on mobile puts the URL in both places;
  // common annoyance — nothing to fix here, but keep paste plain (no formatting).

  // Keep the layout inside the visible viewport when the on-screen keyboard
  // opens (Android resizes; iOS overlays — this handles both).
  if (window.visualViewport) {
    const fitVv = () => {
      document.body.style.height = window.visualViewport.height + 'px';
    };
    window.visualViewport.addEventListener('resize', fitVv);
    fitVv();
  }
  $('#mode-render').addEventListener('click', () => {
    rawMode = false;
    $('#mode-render').classList.add('active');
    $('#mode-raw').classList.remove('active');
    $('#btn-copy-preview').hidden = true;
    updatePreview();
  });
  $('#mode-raw').addEventListener('click', () => {
    rawMode = true;
    $('#mode-raw').classList.add('active');
    $('#mode-render').classList.remove('active');
    $('#btn-copy-preview').hidden = false;
    updatePreview();
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
    let lineStart = value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = value.length;
    const lines = value.slice(lineStart, lineEnd).split('\n');
    const replacement = lines.map((l, i) => prefixFn(l, i)).join('\n');
    editor.setRangeText(replacement, lineStart, lineEnd, 'end');
    editor.focus();
    editor.dispatchEvent(new Event('input'));
  }

  const actions = {
    bold: () => wrapSelection('**', '**', 'bold text'),
    italic: () => wrapSelection('*', '*', 'italic text'),
    underline: () => wrapSelection('<u>', '</u>', 'underlined'),
    strike: () => wrapSelection('~~', '~~', 'struck through'),
    code: () => wrapSelection('`', '`', 'code'),
    link: () => wrapSelection('[', '](https://example.com)', 'label'),
    quote: () => prefixLines((l) => (l.startsWith('> ') ? l.slice(2) : '> ' + l)),
    spoiler: () => wrapSelection('>!', '!<', 'spoiler text'),
    h1: () => prefixLines((l) => l.replace(/^#{1,6}\s*/, '') ? '# ' + l.replace(/^#{1,6}\s*/, '') : '# '),
    h2: () => prefixLines((l) => '## ' + l.replace(/^#{1,6}\s*/, '')),
    h3: () => prefixLines((l) => '### ' + l.replace(/^#{1,6}\s*/, '')),
    h4: () => prefixLines((l) => '#### ' + l.replace(/^#{1,6}\s*/, '')),
    ul: () => prefixLines((l) => (/^\s*[-*+]\s+/.test(l) ? l : '- ' + l)),
    ol: () => prefixLines((l, i) => (/\d+\.\s/.test(l) ? l : (i + 1) + '. ' + l)),
    rule: () => wrapSelection('\n\n---\n\n', '', ''),
    table: () => insertTable()
  };

  // Fix h1 action (was too clever, simplify).
  actions.h1 = () => prefixLines((l) => '# ' + l.replace(/^#{1,6}\s*/, ''));

  function insertTable() {
    const cols = 3, rows = 3;
    const table = [];
    const header = [];
    for (let c = 0; c < cols; c++) header.push('Column ' + (c + 1));
    table.push('| ' + header.join(' | ') + ' |');
    table.push('|' + header.map(() => ' --- ').join('|') + '|');
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) row.push('  ');
      table.push('| ' + row.join(' | ') + ' |');
    }
    const text = table.join('\n');
    const start = editor.selectionStart;
    editor.setRangeText('\n' + text + '\n', start, start, 'end');
    editor.focus();
    editor.dispatchEvent(new Event('input'));
  }

  document.querySelectorAll('[data-md]').forEach((btn) => {
    btn.addEventListener('click', () => actions[btn.dataset.md]());
  });

  let wrap = true;
  $('#btn-wrap').addEventListener('click', () => {
    wrap = !wrap;
    editor.setAttribute('wrap', wrap ? 'soft' : 'off');
    $('#btn-wrap').classList.toggle('active', !wrap);
    toast(wrap ? 'Soft wrap on' : 'Soft wrap off');
  });

  editor.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); actions.bold(); }
    else if (k === 'i') { e.preventDefault(); actions.italic(); }
    else if (k === 'k') { e.preventDefault(); actions.link(); }
    else if (k === 's') { e.preventDefault(); saveDoc(); }
  });

  // Tab inserts two spaces instead of moving focus.
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
      editor.dispatchEvent(new Event('input'));
    }
  });

  // ---------------------------------------------------------------- copy
  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toast(label + ' copied to clipboard', 'success');
    } catch {
      // Fallback for older browsers / non-secure contexts.
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
        toast('Copy failed — select the raw text and copy manually', 'danger');
      }
      ta.remove();
    }
  }

  $('#btn-copy').addEventListener('click', () => {
    copyText(RedditMD.normalize(editor.value), 'Markdown');
  });
  $('#btn-copy-preview').addEventListener('click', () => {
    copyText(RedditMD.toText(RedditMD.normalize(editor.value)), 'Unicode text');
  });

  // ---------------------------------------------------------------- docs
  function saveDraft() {
    if (currentId) return; // docs in the store save explicitly via Save
    localStorage.setItem('redditmd.draft', JSON.stringify({ t: titleInput.value, m: editor.value }));
  }
  function loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem('redditmd.draft'));
      if (d) { titleInput.value = d.t || ''; editor.value = d.m || ''; }
    } catch { /* ignore */ }
  }

  function newDoc(fromTemplate) {
    currentId = null;
    currentIsTemplate = false;
    titleInput.value = fromTemplate ? fromTemplate.title.replace(/template/i, '').trim() : '';
    editor.value = fromTemplate ? fromTemplate.body : '';
    updatePreview();
    hideCanvas('#docs-canvas');
    hideCanvas('#templates-canvas');
    setPane('edit');
    if (!isPhone()) editor.focus(); // don't pop the keyboard on phones
  }

  function hideCanvas(sel) {
    const el = $(sel);
    if (el) bootstrap.Offcanvas.getInstance(el)?.hide();
  }

  async function saveDoc() {
    const body = editor.value;
    if (!body.trim() && !titleInput.value.trim()) {
      toast('Nothing to save yet', 'warning');
      return;
    }
    let doc;
    if (currentId) {
      doc = Store.get(currentId);
      doc.title = titleInput.value.trim() || 'Untitled';
      doc.body = body;
    } else {
      doc = {
        id: null,
        title: titleInput.value.trim() || 'Untitled',
        body,
        template: currentIsTemplate
      };
    }
    const saved = Store.put(doc);
    currentId = saved.id;
    localStorage.removeItem('redditmd.draft');
    toast(currentIsTemplate ? 'Template saved' : 'Saved', 'success');
    renderLists();
  }

  function openDoc(id) {
    const doc = Store.get(id);
    if (!doc) return;
    currentId = doc.id;
    currentIsTemplate = !!doc.template;
    titleInput.value = doc.title;
    editor.value = doc.body;
    updatePreview();
    hideCanvas('#docs-canvas');
    hideCanvas('#templates-canvas');
    setPane('edit');
    if (!isPhone()) editor.focus();
  }

  function deleteDoc(id) {
    const doc = Store.get(id);
    if (!doc) return;
    if (!confirmDelete()) return;
    Store.remove(id);
    if (currentId === id) { currentId = null; currentIsTemplate = false; }
    renderLists();
    toast('Deleted', 'secondary');
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
  }

  function renderDocList() {
    const listEl = $('#doc-list');
    const q = ($('#doc-search').value || '').toLowerCase();
    const docs = Store.getDocs()
      .filter((d) => d.title.toLowerCase().includes(q) || d.body.toLowerCase().includes(q))
      .sort((a, b) => b.updated - a.updated);
    listEl.innerHTML = '';
    if (!docs.length) {
      listEl.innerHTML = '<p class="text-muted small">No documents yet. Write something and hit 💾 Save.</p>';
      return;
    }
    for (const d of docs) {
      const item = document.createElement('div');
      item.className = 'list-group-item d-flex justify-content-between align-items-center gap-2 doc-row' +
        (d.id === currentId ? ' active' : '');
      item.innerHTML =
        '<div class="overflow-hidden flex-grow-1" data-open style="cursor:pointer;min-width:0">' +
          '<div class="fw-semibold text-truncate">' + escapeHtml(d.title) + '</div>' +
          '<div class="small text-muted text-truncate">' + escapeHtml(d.body.split('\n')[0] || '') + '</div>' +
          '<div class="x-small text-muted">' + fmtTime(d.updated) + '</div>' +
        '</div>' +
        '<div class="btn-group btn-group-sm flex-shrink-0">' +
          '<button class="btn btn-outline-secondary" data-act="copy" title="Copy markdown">📋</button>' +
          '<button class="btn btn-outline-danger" data-act="del" title="Delete">🗑</button>' +
        '</div>';
      item.querySelector('[data-open]').addEventListener('click', () => openDoc(d.id));
      item.querySelector('[data-act=copy]').addEventListener('click', async () => {
        await copyText(RedditMD.normalize(d.body), d.title);
      });
      item.querySelector('[data-act=del]').addEventListener('click', () => deleteDoc(d.id));
      listEl.appendChild(item);
    }
  }

  function renderTemplatePicker() {
    const sel = $('#new-from-template');
    const cur = sel.value;
    sel.innerHTML = '<option value="">— pick a template —</option>';
    for (const t of Store.getTemplates().sort((a, b) => a.title.localeCompare(b.title))) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.title;
      sel.appendChild(opt);
    }
    sel.value = cur;
  }

  function renderTemplateList() {
    const listEl = $('#template-list');
    const templates = Store.getTemplates().sort((a, b) => a.title.localeCompare(b.title));
    listEl.innerHTML = '';
    if (!templates.length) {
      listEl.innerHTML = '<p class="text-muted small">No templates yet. Create one with <strong>+ New</strong>, ' +
        'or write something in the editor and use <strong>Save as template</strong> from the Docs panel.</p>';
      return;
    }
    for (const t of templates) {
      const item = document.createElement('div');
      item.className = 'list-group-item d-flex justify-content-between align-items-center gap-2';
      item.innerHTML =
        '<div style="cursor:pointer;min-width:0" class="overflow-hidden flex-grow-1" data-open>' +
          '<div class="fw-semibold text-truncate">' + escapeHtml(t.title) + '</div>' +
          '<div class="small text-muted text-truncate">' + escapeHtml((t.body.match(/^#.*$/m) || [t.body.split('\n')[0] || ''])[0]) + '</div>' +
        '</div>' +
        '<div class="btn-group btn-group-sm flex-shrink-0">' +
          '<button class="btn btn-outline-primary" data-act="use" title="Create document from template">Use</button>' +
          '<button class="btn btn-outline-secondary" data-act="edit" title="Edit template">✎</button>' +
          '<button class="btn btn-outline-danger" data-act="del" title="Delete">🗑</button>' +
        '</div>';
      item.querySelector('div').addEventListener('click', () => { newDoc(t); });
      item.querySelector('[data-act=use]').addEventListener('click', () => newDoc(t));
      item.querySelector('[data-act=edit]').addEventListener('click', () => openDoc(t.id));
      item.querySelector('[data-act=del]').addEventListener('click', () => deleteDoc(t.id));
      listEl.appendChild(item);
    }
  }

  function renderLists() {
    renderDocList();
    renderTemplatePicker();
    renderTemplateList();
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  $('#btn-docs').addEventListener('click', () => {
    renderDocList();
    bootstrap.Offcanvas.getOrCreateInstance($('#docs-canvas')).show();
  });
  $('#btn-templates').addEventListener('click', () => {
    renderTemplateList();
    bootstrap.Offcanvas.getOrCreateInstance($('#templates-canvas')).show();
  });
  $('#doc-search').addEventListener('input', renderDocList);
  $('#btn-new-doc').addEventListener('click', () => newDoc());
  $('#new-from-template').addEventListener('change', (e) => {
    const t = Store.get(e.target.value);
    if (t) { newDoc(t); toast('Started from template: ' + t.title, 'info'); }
    e.target.value = '';
  });

  async function createTemplateFlow() {
    const name = await promptModal('New template', 'Template name', '');
    if (!name) return;
    const saved = Store.put({ id: null, title: name, body: '# ' + name + '\n\n\n', template: true });
    openDoc(saved.id);
    toast('Template created', 'success');
  }
  $('#btn-new-template').addEventListener('click', createTemplateFlow);

  $('#btn-save').addEventListener('click', saveDoc);
  titleInput.addEventListener('input', () => { if (!currentId) saveDraft(); });

  // ---------------------------------------------------------------- init
  loadDraft();
  updatePreview();
  renderLists();

  // Persist any unsaved draft when the app goes to the background / closes.
  window.addEventListener('pagehide', saveDraft);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveDraft();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
