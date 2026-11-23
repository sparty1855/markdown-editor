/*
 * tablebuilder.js — full-screen rich table editor.
 *
 * Grid model: grid[0] is the header row; grid[r>0] are body rows.
 * Tap a cell to select it: a contextual action bar under the top bar shows
 * that cell's actions (edit / copy / paste / clear). Cells in row 0 also
 * get their column's tools; cells in column 0 also get their row's tools.
 *
 * Editing happens in a modal: large textarea at the bottom, live markdown
 * preview above it, and a limited inline toolbar (no lists/headings/rules/
 * tables — those don't belong inside a table cell).
 */
const TableBuilder = (() => {
  'use strict';

  let screen = null;
  let bar = null;       // contextual action bar
  let modal = null;     // cell edit modal
  let grid = [];
  let align = [];
  let sel = null;       // {r, c} — grid coordinates, r=0 is the header row
  let onDoneCb = null;

  const rowsCount = () => grid.length;
  const colsCount = () => (grid[0] ? grid[0].length : 0);

  // ------------------------------------------------------------- utilities
  function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

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
    // z-index 1045: above the app UI (FAB ~1030), but BELOW Bootstrap's modal
    // layer (backdrop 1050 / modal 1055) so the cell editor modal stacks on
    // top of the builder where it belongs.
    screen.style.cssText =
      'position:fixed;inset:0;z-index:1045;background:#fff;display:flex;flex-direction:column;' +
      'padding-top:env(safe-area-inset-top,0);';
    screen.innerHTML = `
      <nav class="navbar bg-dark py-1 flex-shrink-0">
        <div class="container-fluid gap-2 px-2">
          <button class="btn btn-outline-light btn-sm" id="rmd-builder-cancel" type="button">✕ Cancel</button>
          <span class="navbar-text">Table builder</span>
          <button class="btn btn-success btn-sm ms-auto" id="rmd-builder-done" type="button">✓ Insert</button>
        </div>
      </nav>
      <div id="rmd-builder-bar" class="d-flex align-items-center gap-1 px-2 py-1 bg-body-tertiary border-bottom flex-shrink-0 overflow-auto" style="scrollbar-width:none;"></div>
      <div id="rmd-builder-scroll" class="flex-grow-1 overflow-auto p-2"></div>
      <footer class="d-flex flex-wrap gap-2 p-2 border-top bg-white flex-shrink-0">
        <button class="btn btn-outline-primary btn-sm" id="rmd-add-row" type="button">+ Add row</button>
        <button class="btn btn-outline-primary btn-sm" id="rmd-add-col" type="button">+ Add column</button>
        <span class="ms-auto align-self-center small text-body-secondary">First row &amp; column are headers — select their cells for row/column tools</span>
      </footer>`;
    document.body.appendChild(screen);
    bar = screen.querySelector('#rmd-builder-bar');

    screen.querySelector('#rmd-builder-cancel').addEventListener('click', close);
    screen.querySelector('#rmd-builder-done').addEventListener('click', commit);
    screen.querySelector('#rmd-add-row').addEventListener('click', () => {
      grid.push(Array(colsCount()).fill(''));
      render();
    });
    screen.querySelector('#rmd-add-col').addEventListener('click', () => {
      const n = colsCount();
      grid.forEach((r) => r.push(''));
      grid[0][n] = 'Column ' + (n + 1);
      align.push(null);
      render();
      toastB('Added column ' + (n + 1));
    });
  }

  // ------------------------------------------------------------- action bar
  function btn(label, title, fn, variant, disabled) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm flex-shrink-0 btn-outline-' + (variant || 'secondary') + (disabled ? ' disabled' : '');
    b.textContent = label;
    b.title = title;
    if (!disabled) b.addEventListener('click', fn);
    return b;
  }

  function deleteGuardBtn(label, title, fn, canFn) {
    if (!canFn || !canFn()) {
      const b = btn(label, 'Not allowed here', () => toastB('Not allowed here'), 'dark');
      b.classList.add('opacity-50');
      return b;
    }
    const b = btn(label, title, (e) => {
      if (b.dataset.armed === '1') { fn(); return; }
      b.dataset.armed = '1';
      b.classList.remove('btn-outline-dark');
      b.classList.add('btn-dark');
      b.textContent = 'Sure?';
      setTimeout(() => {
        b.dataset.armed = '';
        b.classList.add('btn-outline-dark');
        b.classList.remove('btn-dark');
        b.textContent = label;
      }, 2500);
    }, 'dark');
    return b;
  }

  function updateBar() {
    if (!bar) return;
    bar.innerHTML = '';
    if (!sel) {
      bar.innerHTML = '<span class="small text-body-secondary flex-shrink-0">Tap a cell to select it — its actions appear here</span>';
      return;
    }
    const { r, c } = sel;
    const n = colsCount();

    const label = document.createElement('span');
    label.className = 'small text-body-secondary flex-shrink-0 me-1';
    label.textContent = 'R' + (r + 1) + '·C' + (c + 1) + ' ';
    bar.append(label);

    // Base cell actions.
    bar.append(
      btn('✏ Edit', 'Edit cell in full editor', openCellModal, 'primary'),
      btn('⧉', 'Copy cell', () => clipWrite(String(grid[r][c] ?? ''))),
      btn('📥', 'Paste into cell', async () => {
        const t = await clipRead();
        if (t == null) return;
        grid[r][c] = t.replace(/\n+/g, ' ');
        render();
      }),
      btn('✕', 'Clear cell', () => { grid[r][c] = ''; render(); }, 'danger')
    );

    // Column tools on first-row cells.
    if (r === 0) {
      const sep = document.createElement('span');
      sep.className = 'border-start mx-1 flex-shrink-0';
      bar.append(sep);
      bar.append(
        btn('⇦', 'Move column left', () => moveCol(c, -1), 'secondary', c === 0),
        btn('⇨', 'Move column right', () => moveCol(c, 1), 'secondary', c === n - 1),
        btn('⧉ Col', 'Copy column', () => clipWrite(colLines(c).join('\n'))),
        btn('📥 Col', 'Paste into column (one line per cell)', async () => {
          const t = await clipRead();
          if (t == null) return;
          const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
          if (!lines.length) return;
          setColumn(c, lines);
          render();
          toastB('Column updated');
        }),
        deleteGuardBtn('✕ Col', 'Delete column', () => delCol(c), () => n > 1)
      );
    }

    // Row tools on first-column cells.
    if (c === 0) {
      const sep = document.createElement('span');
      sep.className = 'border-start mx-1 flex-shrink-0';
      bar.append(sep);
      bar.append(
        btn('⇧', 'Move row up', () => moveRow(r, -1), 'secondary', r === 0),
        btn('⇩', 'Move row down', () => moveRow(r, 1), 'secondary', r === rowsCount() - 1),
        btn('⧉ Row', 'Copy row (tab-separated)', () => {
          clipWrite(padRow(grid[r], colsCount()).join('\t'));
        }),
        btn('📥 Row', 'Paste into row (tab-separated)', async () => {
          const t = await clipRead();
          if (t == null) return;
          setRow(r, t.split('\t').map((x) => x.trim()));
          render();
          toastB('Row updated');
        }),
        deleteGuardBtn('✕ Row', 'Delete row', () => delRow(r), () => r > 0 && rowsCount() > 2)
      );
    }
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
                <button class="btn btn-outline-secondary" type="button" data-cmd="bold" title="Bold"><b>B</b></button>
                <button class="btn btn-outline-secondary" type="button" data-cmd="italic" title="Italic"><i>I</i></button>
                <button class="btn btn-outline-secondary" type="button" data-cmd="underline" title="Underline"><u>U</u></button>
                <button class="btn btn-outline-secondary" type="button" data-cmd="strike" title="Strikethrough"><s>S</s></button>
                <button class="btn btn-outline-secondary" type="button" data-cmd="code" title="Inline code">&lt;/&gt;</button>
                <button class="btn btn-outline-secondary" type="button" data-cmd="link" title="Link">🔗</button>
                <button class="btn btn-outline-secondary" type="button" data-cmd="sup" title="Superscript">^</button>
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
        const cmd = b.dataset.cmd;
        const wraps = {
          bold: ['**', '**', 'bold text'],
          italic: ['*', '*', 'italic text'],
          underline: ['<u>', '</u>', 'underlined'],
          strike: ['~~', '~~', 'struck text'],
          code: ['`', '`', 'code'],
          link: ['[', '](https://example.com)', 'label'],
          sup: ['^(', ')', 'superscript']
        }[cmd];
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

  function setColumn(c, lines) {
    for (let r = 0; r < rowsCount(); r++) grid[r][c] = lines[r] ?? '';
  }

  function setRow(r, cells) {
    for (let c = 0; c < colsCount(); c++) grid[r][c] = cells[c] ?? grid[r][c];
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
    grid.forEach((row) => row.splice(c, 1));
    align.splice(c, 1);
    sel = null;
    render();
    toastB('Column deleted');
  }

  function delRow(r) {
    if (r === 0) { toastB('Cannot delete the header row'); return; }
    if (rowsCount() <= 2) { toastB('Keep at least one data row'); return; }
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
    if (modal) { bootstrap.Modal.getInstance(modal)?.hide(); modal.remove(); modal = null; }
    if (screen) { screen.remove(); screen = null; }
    if (toastEl) { toastEl.remove(); toastEl = null; }
    bar = null;
    sel = null;
    onDoneCb = null;
  }

  return { open, _debug: () => ({ grid, align, sel }) };
})();
