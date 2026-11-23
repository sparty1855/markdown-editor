/*
 * tablebuilder.js — full-screen rich table editor.
 *
 * Grid model: grid[0] is the header row; grid[r>0] are body rows.
 * Tap a cell to select it; tap anything else to deselect.
 *
 * The action bar is a FIXED vertical stack of rows (cell tools, column tools,
 * row tools, add controls). It never changes shape — inapplicable buttons are
 * greyed out via the disabled state:
 *   - cell tools apply to the selected cell
 *   - column tools enable when a header-row cell is selected
 *   - row tools enable when a first-column cell is selected
 *   - add controls are always enabled (insert after selection / at the end)
 *
 * Editing happens in a modal: live markdown preview above a large textarea,
 * with a limited inline toolbar. Icons use vendored Font Awesome 6 free.
 */
const TableBuilder = (() => {
  'use strict';

  let screen = null;
  let bar = null;
  let modal = null;      // cell edit modal
  let numModal = null;   // "add custom number" modal
  let grid = [];
  let align = [];
  let sel = null;        // {r, c} — r=0 is the header row
  let onDoneCb = null;
  let refs = {};         // toolbar button refs by title

  const rowsCount = () => grid.length;
  const colsCount = () => (grid[0] ? grid[0].length : 0);

  // ------------------------------------------------------------- utilities
  let toastEl = null;
  function toastB(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText =
        'position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);' +
        'background:#212529;color:#fff;padding:.5rem 1rem;border-radius:.375rem;z-index:2100;font-size:.9rem;display:none;';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => { toastEl.style.display = 'none'; }, 1800);
  }

  function renderCellHtml(raw) {
    const html = MarkdownEngine.toHtml(raw || '');
    const one = html.replace(/^<p>([\s\S]*)<\/p>$/, '$1');
    return one.trim() || '<span class="text-body-tertiary">·</span>';
  }

  async function clipWrite(text) {
    try {
      await navigator.clipboard.writeText(text);
      toastB('Copied');
    } catch {
      toastB('Copy blocked by browser');
    }
  }

  async function clipRead() {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      toastB('Clipboard paste unsupported here');
      return null;
    }
    try {
      return await navigator.clipboard.readText();
    } catch {
      toastB('Paste blocked — allow clipboard access');
      return null;
    }
  }

  function padRow(r, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(r[i] ?? '');
    return out;
  }

  // ------------------------------------------------------------- screen
  function buildScreen() {
    screen = document.createElement('div');
    screen.id = 'screen-builder';
    // z-index 1045: above app chrome (FAB ~1030), BELOW Bootstrap's modal
    // layer (backdrop 1050 / modal 1055) so modals stack on top.
    screen.style.cssText =
      'position:fixed;inset:0;z-index:1045;background:#fff;display:flex;flex-direction:column;' +
      'padding-top:env(safe-area-inset-top,0);';
    screen.innerHTML = `
      <nav class="navbar bg-dark py-1 flex-shrink-0">
        <div class="container-fluid gap-2 px-2">
          <button class="btn btn-outline-light btn-sm" id="rmd-builder-cancel" type="button"><i class="fa-solid fa-xmark"></i> Cancel</button>
          <span class="navbar-text">Table builder</span>
          <button class="btn btn-success btn-sm ms-auto" id="rmd-builder-done" type="button"><i class="fa-solid fa-check"></i> Insert</button>
        </div>
      </nav>
      <div id="rmd-builder-bar" class="d-flex flex-column px-2 py-1 bg-body-tertiary border-bottom flex-shrink-0"></div>
      <div id="rmd-builder-scroll" class="flex-grow-1 overflow-auto p-2"></div>`;
    document.body.appendChild(screen);
    bar = screen.querySelector('#rmd-builder-bar');

    screen.querySelector('#rmd-builder-cancel').addEventListener('click', close);
    screen.querySelector('#rmd-builder-done').addEventListener('click', commit);

    // Tap anything that isn't a cell → deselect.
    screen.querySelector('#rmd-builder-scroll').addEventListener('click', (e) => {
      if (!e.target.closest('.rmd-cell') && sel) {
        sel = null;
        render();
      }
    });

    buildBar();
    updateBar();
  }

  // ------------------------------------------------------------- toolbar
  function barRow() {
    const row = document.createElement('div');
    row.className = 'd-flex flex-wrap align-items-center gap-1 py-1';
    return row;
  }

  function makeBtn(icon, title, fn, variant) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm flex-shrink-0 btn-outline-' + (variant || 'secondary');
    b.title = title;
    b.innerHTML = '<i class="fa-solid fa-' + icon + '"></i>';
    refs[title] = b;
    b.addEventListener('click', fn);
    return b;
  }

  function buildBar() {
    bar.innerHTML = '';
    refs = {};

    const cellRow = barRow();
    cellRow.append(
      makeBtn('pen', 'Edit cell in full editor', () => openCellModal(), 'primary'),
      makeBtn('copy', 'Copy cell', () => clipWrite(String(grid[sel.r][sel.c] ?? ''))),
      makeBtn('paste', 'Paste into cell', async () => {
        const t = await clipRead();
        if (t == null) return;
        grid[sel.r][sel.c] = t.replace(/\n+/g, ' ');
        render();
      }),
      makeBtn('eraser', 'Clear cell', () => { grid[sel.r][sel.c] = ''; render(); }, 'danger')
    );
    bar.append(cellRow);

    const colRow = barRow();
    colRow.append(
      makeBtn('arrow-left', 'Move column left', () => moveCol(sel.c, -1)),
      makeBtn('arrow-right', 'Move column right', () => moveCol(sel.c, 1)),
      makeBtn('copy', 'Copy column', () => clipWrite(colLines(sel.c).join('\n'))),
      makeBtn('paste', 'Paste into column (one line per cell)', async () => {
        const t = await clipRead();
        if (t == null) return;
        const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
        if (!lines.length) return;
        for (let rr = 0; rr < rowsCount(); rr++) grid[rr][sel.c] = lines[rr] ?? '';
        render();
        toastB('Column updated');
      }),
      makeBtn('trash-can', 'Delete column', () => delCol(sel.c), 'danger')
    );
    bar.append(colRow);

    const rowTools = barRow();
    rowTools.append(
      makeBtn('arrow-up', 'Move row up', () => moveRow(sel.r, -1)),
      makeBtn('arrow-down', 'Move row down', () => moveRow(sel.r, 1)),
      makeBtn('copy', 'Copy row (tab-separated)', () => {
        clipWrite(padRow(grid[sel.r], colsCount()).join('\t'));
      }),
      makeBtn('paste', 'Paste into row (tab-separated)', async () => {
        const t = await clipRead();
        if (t == null) return;
        const cells = t.split('\t').map((x) => x.trim());
        for (let cc = 0; cc < colsCount(); cc++) grid[sel.r][cc] = cells[cc] ?? grid[sel.r][cc];
        render();
        toastB('Row updated');
      }),
      makeBtn('trash-can', 'Delete row', () => delRow(sel.r), 'danger')
    );
    bar.append(rowTools);

    bar.append(addControlsRow());

    // Subtle dividers between the fixed rows.
    [...bar.children].slice(0, -1).forEach((rowEl) => {
      rowEl.style.borderBottom = '1px solid var(--bs-border-color-translucent)';
    });
  }

  function updateBar() {
    if (!bar || !refs['Copy cell']) return;
    const colCtx = !!(sel && sel.r === 0);
    const rowCtx = !!(sel && sel.c === 0);
    const hasCell = !!sel;
    const n = colsCount();

    const set = (title, enabled) => {
      const b = refs[title];
      if (b) b.disabled = !enabled;
    };

    set('Edit cell in full editor', hasCell);
    set('Copy cell', hasCell);
    set('Paste into cell', hasCell);
    set('Clear cell', hasCell);

    set('Move column left', colCtx && sel.c > 0);
    set('Move column right', colCtx && sel.c < n - 1);
    set('Copy column', colCtx);
    set('Paste into column (one line per cell)', colCtx);
    set('Delete column', colCtx && n > 1);

    set('Move row up', rowCtx && sel.r > 0);
    set('Move row down', rowCtx && sel.r < rowsCount() - 1);
    set('Copy row (tab-separated)', rowCtx);
    set('Paste into row (tab-separated)', rowCtx);
    set('Delete row', rowCtx && sel.r > 0 && rowsCount() > 2);
  }

  function addControlsRow() {
    const row = barRow();
    row.append(makeAddControl('row', ' Row'), makeAddControl('col', ' Col'));
    return row;
  }

  function makeAddControl(kind, label) {
    const wrap = document.createElement('div');
    wrap.className = 'btn-group btn-group-sm';

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'btn btn-primary';
    main.innerHTML = '<i class="fa-solid fa-plus"></i>' + label;
    main.title = 'Add 1 ' + kind +
      (kind === 'row' ? ' after the selected row (or at the bottom)' : ' after the selected column (or at the end)');
    main.addEventListener('click', () => addOne(kind));

    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'btn btn-primary dropdown-toggle dropdown-toggle-split';
    caret.setAttribute('data-bs-toggle', 'dropdown');
    caret.setAttribute('aria-label', 'More add options');

    const menu = document.createElement('ul');
    menu.className = 'dropdown-menu';
    [2, 3].forEach((n) => {
      const li = document.createElement('li');
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'dropdown-item';
      item.textContent = 'Add ' + n + (kind === 'row' ? ' rows' : ' columns');
      item.addEventListener('click', () => addMany(kind, n));
      li.append(item);
      menu.append(li);
    });
    menu.insertAdjacentHTML('beforeend', '<li><hr class="dropdown-divider"></li>');
    const customLi = document.createElement('li');
    const customBtn = document.createElement('button');
    customBtn.type = 'button';
    customBtn.className = 'dropdown-item';
    customBtn.textContent = 'Custom…';
    customBtn.addEventListener('click', async () => {
      const n = await askNumber('How many ' + (kind === 'row' ? 'rows' : 'columns') + '?');
      if (n) addMany(kind, n);
    });
    customLi.append(customBtn);
    menu.append(customLi);

    wrap.append(main, caret, menu);
    return wrap;
  }

  // Insert `count` rows after the selected row (or at the bottom).
  function insertRows(count) {
    const at = sel ? sel.r : rowsCount() - 1;
    const block = [];
    for (let i = 0; i < count; i++) block.push(Array(colsCount()).fill(''));
    grid.splice(at + 1, 0, ...block);
    render();
  }

  // Insert `count` columns after the selected column (or at the end).
  function insertCols(count) {
    const at = sel ? sel.c : colsCount() - 1;
    for (let i = 0; i < count; i++) {
      const pos = at + 1 + i;
      grid.forEach((r) => r.splice(pos, 0, ''));
      grid[0][pos] = 'Column ' + (pos + 1);
      align.splice(pos, 0, null);
    }
    render();
  }

  function addOne(kind) {
    if (kind === 'row') insertRows(1); else insertCols(1);
  }

  function addMany(kind, n) {
    if (kind === 'row') insertRows(n); else insertCols(n);
    toastB('Added ' + n + ' ' + kind + (n === 1 ? '' : 's'));
  }

  // ------------------------------------------------------------- number modal
  function askNumber(title) {
    return new Promise((resolve) => {
      if (!numModal) {
        numModal = document.createElement('div');
        numModal.className = 'modal fade';
        numModal.innerHTML = `
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
              <div class="modal-header py-2"><h6 class="modal-title" id="rmd-num-title"></h6>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
              <div class="modal-body">
                <label class="form-label" for="rmd-num-input">Number of positions</label>
                <input type="number" class="form-control" id="rmd-num-input" min="1" max="100" inputmode="numeric" value="4">
              </div>
              <div class="modal-footer py-2">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                <button type="button" class="btn btn-primary" id="rmd-num-ok"><i class="fa-solid fa-plus"></i> Add</button>
              </div>
            </div>
          </div>`;
        document.body.appendChild(numModal);
        const ok = numModal.querySelector('#rmd-num-ok');
        const input = numModal.querySelector('#rmd-num-input');
        const submit = () => {
          const v = Math.min(100, Math.max(1, parseInt(input.value, 10) || 1));
          numModal._resolve(v);
          numModal._resolve = null;
          bootstrap.Modal.getInstance(numModal).hide();
        };
        ok.addEventListener('click', submit);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
        numModal.addEventListener('hidden.bs.modal', () => {
          const res = numModal._resolve;
          numModal._resolve = null;
          if (res) res(null);
        });
      }
      if (numModal._resolve) return; // already pending; ignore extra dialogs
      numModal.querySelector('#rmd-num-title').textContent = title;
      const input = numModal.querySelector('#rmd-num-input');
      input.value = 4;
      numModal._resolve = resolve;
      numModal.addEventListener('shown.bs.modal', () => input.select(), { once: true });
      bootstrap.Modal.getOrCreateInstance(numModal).show();
    });
  }

  // ------------------------------------------------------------- cell modal
  function buildCellModal() {
    modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.id = 'rmd-cell-modal';
    modal.tabIndex = -1;
    modal.innerHTML = `
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable" style="max-width:48rem;height:min(92vh,44rem);">
        <div class="modal-content d-flex flex-column" style="height:100%;">
          <div class="modal-header py-2 flex-shrink-0">
            <h6 class="modal-title" id="rmd-cell-title">Edit cell</h6>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body d-flex flex-column gap-2 p-2" style="min-height:0;">
            <div class="btn-toolbar d-flex gap-1 flex-wrap flex-shrink-0" role="toolbar" aria-label="Inline formatting">
              <div class="btn-group btn-group-sm" role="group">
                <button class="btn btn-outline-secondary" type="button" data-cmd="bold" title="Bold"><i class="fa-solid fa-bold"></i></button>
                <button class="btn btn-outline-secondary" type="button" data-cmd="italic" title="Italic"><i class="fa-solid fa-italic"></i></button>
                <button class="btn btn-outline-secondary" type="button" data-cmd="underline" title="Underline"><i class="fa-solid fa-underline"></i></button>
                <button class="btn btn-outline-secondary" type="button" data-cmd="strike" title="Strikethrough"><i class="fa-solid fa-strikethrough"></i></button>
                <button class="btn btn-outline-secondary" type="button" data-cmd="code" title="Inline code"><i class="fa-solid fa-code"></i></button>
                <button class="btn btn-outline-secondary" type="button" data-cmd="link" title="Link"><i class="fa-solid fa-link"></i></button>
                <button class="btn btn-outline-secondary" type="button" data-cmd="sup" title="Superscript"><i class="fa-solid fa-superscript"></i></button>
              </div>
            </div>
            <div class="border rounded p-2 flex-shrink-0" id="rmd-cell-preview" style="height:34%;overflow:auto;background:#fff;"></div>
            <textarea class="form-control flex-grow-1" id="rmd-cell-input" rows="4"
              style="min-height:0;font-size:16px;font-family:var(--bs-font-monospace);"
              placeholder="Cell text (markdown)…"></textarea>
          </div>
          <div class="modal-footer py-2 flex-shrink-0">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="rmd-cell-save">Save</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const input = modal.querySelector('#rmd-cell-input');
    const preview = modal.querySelector('#rmd-cell-preview');

    const refresh = () => {
      preview.innerHTML = MarkdownEngine.toHtml(input.value || '') ||
        '<span class="text-body-tertiary">·</span>';
    };
    input.addEventListener('input', refresh);

    modal.querySelectorAll('[data-cmd]').forEach((b) => {
      b.addEventListener('click', () => {
        const wraps = {
          bold: ['**', '**', 'bold text'],
          italic: ['*', '*', 'italic text'],
          underline: ['<u>', '</u>', 'underlined'],
          strike: ['~~', '~~', 'struck text'],
          code: ['`', '`', 'code'],
          link: ['[', '](https://example.com)', 'label'],
          sup: ['^(', ')', 'superscript']
        }[b.dataset.cmd];
        const [before, after, ph] = wraps;
        const start = input.selectionStart, end = input.selectionEnd;
        const chosen = input.value.slice(start, end) || ph;
        input.setRangeText(before + chosen + after, start, end, 'end');
        input.setSelectionRange(start + before.length, start + before.length + chosen.length);
        input.focus();
        refresh();
      });
    });

    modal.querySelector('#rmd-cell-save').addEventListener('click', () => {
      if (sel) grid[sel.r][sel.c] = input.value.replace(/\n+/g, ' ');
      bootstrap.Modal.getInstance(modal).hide();
      render();
    });
  }

  function openCellModal() {
    if (!sel) return;
    if (!modal) buildCellModal();
    modal.querySelector('#rmd-cell-title').textContent =
      'Edit cell — row ' + (sel.r + 1) + ', column ' + (sel.c + 1);
    const input = modal.querySelector('#rmd-cell-input');
    const preview = modal.querySelector('#rmd-cell-preview');
    input.value = String(grid[sel.r][sel.c] ?? '');
    preview.innerHTML = MarkdownEngine.toHtml(input.value || '');
    bootstrap.Modal.getOrCreateInstance(modal).show();
    modal.addEventListener('shown.bs.modal', () => input.focus(), { once: true });
  }

  // ------------------------------------------------------------- grid ops
  function colLines(c) {
    const out = [];
    for (let r = 0; r < rowsCount(); r++) out.push(String(padRow(grid[r], colsCount())[c] ?? ''));
    return out;
  }

  function moveCol(c, dir) {
    const t = c + dir;
    if (t < 0 || t >= colsCount()) { toastB('Edge of table'); return; }
    grid.forEach((row) => { const tmp = row[c]; row[c] = row[t]; row[t] = tmp; });
    const ta = align[c]; align[c] = align[t]; align[t] = ta;
    sel = { r: sel.r, c: t };
    render();
  }

  function moveRow(r, dir) {
    const t = r + dir;
    if (t < 0 || t >= rowsCount()) { toastB('Edge of table'); return; }
    const tmp = grid[r]; grid[r] = grid[t]; grid[t] = tmp;
    sel = { r: t, c: sel.c };
    render();
  }

  function delCol(c) {
    if (colsCount() <= 1) { toastB('Cannot delete the last column'); return; }
    // two-tap guard
    const b = refs['Delete column'];
    if (b.dataset.armed !== '1') {
      b.dataset.armed = '1';
      b.innerHTML = 'Sure?';
      setTimeout(() => {
        b.dataset.armed = '';
        b.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
      }, 2500);
      return;
    }
    b.dataset.armed = '';
    b.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    grid.forEach((row) => row.splice(c, 1));
    align.splice(c, 1);
    sel = null;
    render();
    toastB('Column deleted');
  }

  function delRow(r) {
    if (r === 0) { toastB('Cannot delete the header row'); return; }
    if (rowsCount() <= 2) { toastB('Keep at least one data row'); return; }
    const b = refs['Delete row'];
    if (b.dataset.armed !== '1') {
      b.dataset.armed = '1';
      b.innerHTML = 'Sure?';
      setTimeout(() => {
        b.dataset.armed = '';
        b.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
      }, 2500);
      return;
    }
    b.dataset.armed = '';
    b.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    grid.splice(r, 1);
    sel = null;
    render();
    toastB('Row deleted');
  }

  // ------------------------------------------------------------- rendering
  function render() {
    if (!screen) return;
    const wrap = screen.querySelector('#rmd-builder-scroll');
    let html = '<div class="table-responsive"><table class="table table-bordered table-sm mb-0" style="min-width:100%">';
    for (let r = 0; r < rowsCount(); r++) {
      const row = padRow(grid[r] || [], colsCount());
      html += '<tr>';
      for (let c = 0; c < colsCount(); c++) {
        const isHeader = r === 0 || c === 0;
        const tag = isHeader ? 'th' : 'td';
        const cls = ['rmd-cell', isHeader ? 'table-light' : ''];
        if (sel && sel.r === r && sel.c === c) cls.push('table-active');
        const style = (align[c] && align[c] !== 'left') ? ' style="text-align:' + align[c] + '"' : '';
        html += `<${tag} class="${cls.filter(Boolean).join(' ')}" data-r="${r}" data-c="${c}"${style}>${renderCellHtml(row[c])}</${tag}>`;
      }
      html += '</tr>';
    }
    html += '</table></div>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('.rmd-cell').forEach((cell) => {
      cell.addEventListener('click', () => {
        sel = { r: +cell.dataset.r, c: +cell.dataset.c };
        render();
      });
    });
    updateBar();
  }

  // ------------------------------------------------------------- lifecycle
  function open(spec) {
    grid = [spec.header.map((s) => String(s ?? ''))];
    spec.rows.forEach((r) => grid.push(r.map((s) => String(s ?? ''))));
    align = (spec.align || []).slice();
    while (align.length < colsCount()) align.push(null);
    sel = null;
    onDoneCb = spec.onDone || (() => {});
    buildScreen();
    render();
  }

  function commit() {
    const md = MarkdownEngine.toTableMarkdown({
      header: grid[0],
      align,
      rows: grid.slice(1)
    });
    const cb = onDoneCb;
    close();
    cb(md);
  }

  function close() {
    if (numModal) { bootstrap.Modal.getInstance(numModal)?.hide(); numModal.remove(); numModal = null; }
    if (modal) { bootstrap.Modal.getInstance(modal)?.hide(); modal.remove(); modal = null; }
    if (screen) { screen.remove(); screen = null; }
    if (toastEl) { toastEl.remove(); toastEl = null; }
    bar = null;
    refs = {};
    sel = null;
    onDoneCb = null;
  }

  return { open, _debug: () => ({ grid, align, sel }) };
})();
