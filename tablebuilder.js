/*
 * tablebuilder.js — full-screen rich table editor.
 *
 * Grid model: grid[0] is the header row; grid[r>0] are body rows.
 * Tap a cell to select it: a small popover appears with that cell's
 * actions (edit / copy / paste / clear). Cells in row 0 get column
 * operations; cells in column 0 get row operations; the corner gets both.
 * Requires markdown.js (MarkdownEngine) and Bootstrap CSS to be loaded.
 */
const TableBuilder = (() => {
  'use strict';

  let screen = null;   // full-screen overlay element
  let popover = null;  // action popover element
  let grid = [];       // grid[r][c] = raw cell text; grid[0] = header
  let align = [];      // align[c] = null | 'left' | 'right' | 'center'
  let sel = null;      // {r, c} or null
  let editing = null;  // {r, c} or null
  let onDoneCb = null;

  const rowsCount = () => grid.length;
  const colsCount = () => (grid[0] ? grid[0].length : 0);

  // ------------------------------------------------------------- utilities
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toastB(msg) {
    let holder = document.getElementById('rmd-builder-toast');
    if (!holder) {
      holder = document.createElement('div');
      holder.id = 'rmd-builder-toast';
      holder.style.cssText = 'position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);' +
        'background:#212529;color:#fff;padding:.5rem 1rem;border-radius:.375rem;z-index:2000;font-size:.9rem;';
      document.body.appendChild(holder);
    }
    holder.textContent = msg;
    holder.style.display = 'block';
    clearTimeout(holder._t);
    holder._t = setTimeout(() => { holder.style.display = 'none'; }, 1800);
  }

  function renderCellHtml(raw) {
    const html = MarkdownEngine.toHtml(raw || '');
    // unwrap a bare single paragraph for tighter cells
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

  // ------------------------------------------------------------- rendering
  function buildScreen() {
    screen = document.createElement('div');
    screen.id = 'screen-builder';
    screen.style.cssText =
      'position:fixed;inset:0;z-index:1900;background:#fff;display:flex;flex-direction:column;' +
      'padding-top:env(safe-area-inset-top,0);padding-bottom:env(safe-area-inset-bottom,0);';
    screen.innerHTML = `
      <nav class="navbar bg-dark py-1 flex-shrink-0">
        <div class="container-fluid gap-2 px-2">
          <button class="btn btn-outline-light btn-sm" id="rmd-builder-cancel" type="button">✕ Cancel</button>
          <span class="navbar-text">Table builder</span>
          <button class="btn btn-success btn-sm ms-auto" id="rmd-builder-done" type="button">✓ Insert</button>
        </div>
      </nav>
      <div id="rmd-builder-scroll" class="flex-grow-1 overflow-auto p-2"></div>
      <footer class="d-flex flex-wrap gap-2 p-2 border-top bg-white flex-shrink-0">
        <button class="btn btn-outline-primary btn-sm" id="rmd-add-row" type="button">+ Add row</button>
        <button class="btn btn-outline-primary btn-sm" id="rmd-add-col" type="button">+ Add column</button>
        <span class="ms-auto align-self-center small text-body-secondary">First row &amp; first column are headers — tap their cells for row/column tools</span>
      </footer>`;
    document.body.appendChild(screen);

    screen.querySelector('#rmd-builder-cancel').addEventListener('click', close);
    screen.querySelector('#rmd-builder-done').addEventListener('click', commit);
    screen.querySelector('#rmd-add-row').addEventListener('click', () => {
      grid.push(Array(colsCount()).fill(''));
      render();
    });
    screen.querySelector('#rmd-add-col').addEventListener('click', addCol);
    screen.querySelector('#rmd-builder-scroll').addEventListener('scroll', hidePopover, { passive: true });
  }

  function addCol() {
    const n = colsCount();
    grid.forEach((r) => r.push(''));
    grid[0][n] = 'Column ' + (n + 1);
    align.push(null);
    actualRenderAdd('Added column ' + (n + 1));
  }
  function actualRenderAdd(msg) { render(); toastB(msg); }

  function render() {
    if (!screen) return;
    const wrap = screen.querySelector('#rmd-builder-scroll');
    const r0 = rowsCount();
    let html = '<div class="table-responsive"><table class="table table-bordered table-sm mb-0" style="min-width:100%">';
    for (let r = 0; r < r0; r++) {
      const row = padRow(grid[r] || [], colsCount());
      html += '<tr>';
      for (let c = 0; c < colsCount(); c++) {
        const isHeader = r === 0 || c === 0;
        const tag = isHeader ? 'th' : 'td';
        const cls = ['rmd-cell', isHeader ? 'table-light' : ''];
        if (sel && sel.r === r && sel.c === c) cls.push('table-active');
        const style = (align[c] && align[c] !== 'left') ? ' style="text-align:' + align[c] + '"' : '';
        const content = (editing && editing.r === r && editing.c === c)
          ? '<input type="text" class="form-control form-control-sm" value="' + esc(row[c] || '') + '">'
          : renderCellHtml(row[c]);
        html += `<${tag} class="${cls.filter(Boolean).join(' ')}" data-r="${r}" data-c="${c}"${style}>${content}</${tag}>`;
      }
      html += '</tr>';
    }
    html += '</table></div>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('.rmd-cell').forEach((cell) => {
      cell.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        commitEditIfAny();
        sel = { r: +cell.dataset.r, c: +cell.dataset.c };
        editing = null;
        render();
        showPopover(cell);
      });
      const input = cell.querySelector('input');
      if (input) {
        input.addEventListener('change', commitEditIfAny);
        input.addEventListener('blur', commitEditIfAny);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); commitEditIfAny(); render(); }
        });
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
    if (sel) {
      const cell = wrap.querySelector(`[data-r="${sel.r}"][data-c="${sel.c}"]`);
      if (cell) showPopover(cell);
    }
  }

  function commitEditIfAny() {
    if (!editing || !screen) return;
    const input = screen.querySelector('#rmd-builder-scroll input');
    if (input) grid[editing.r][editing.c] = input.value;
    editing = null;
  }

  // ------------------------------------------------------------- popover
  function hidePopover() {
    if (popover) { popover.remove(); popover = null; }
  }

  function btn(label, title, fn, variant) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm btn-outline-' + (variant || 'secondary');
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', fn);
    return b;
  }

  function showPopover(cell) {
    hidePopover();
    const { r, c } = sel;
    popover = document.createElement('div');
    popover.style.cssText =
      'position:fixed;display:flex;flex-wrap:wrap;gap:.25rem;padding:.35rem;max-width:min(92vw,30rem);' +
      'background:#fff;border:1px solid var(--bs-border-color);border-radius:.5rem;z-index:2000;' +
      'box-shadow:var(--bs-box-shadow);font-size:.82rem;';

    const startEdit = () => {
      hidePopover();
      editing = { r, c };
      render();
      const inp = screen.querySelector('#rmd-builder-scroll input');
      if (inp) inp.focus();
    };

    // Base cell actions — visible only on the selected cell, per spec.
    popover.append(
      btn('✏', 'Edit cell', startEdit, 'primary'),
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
    if (r === 0 && colsCount() > 0) {
      popover.append(document.createElement('hr'));
      popover.append(
        btn('⇦', 'Move column left', () => moveCol(c, -1)),
        btn('⇨', 'Move column right', () => moveCol(c, 1)),
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
        deleteGuardBtn('✕ Col', 'Delete column', c < colsCount() ? () => delCol(c) : null)
      );
    }

    // Row tools on first-column cells.
    if (c === 0 && rowsCount() > 0) {
      popover.append(document.createElement('hr'));
      popover.append(
        btn('⇧', 'Move row up', () => moveRow(r, -1)),
        btn('⇩', 'Move row down', () => moveRow(r, 1)),
        btn('⧉ Row', 'Copy row (tab-separated)', () => {
          clipWrite(padRow(grid[r], colsCount()).join('\t'));
        }),
        btn('📥 Row', 'Paste into row (tab-separated)', async () => {
          const t = await clipRead();
          if (t == null) return;
          const cells = t.split('\t').map((x) => x.trim());
          setRow(r, cells);
          render();
          toastB('Row updated');
        }),
        deleteGuardBtn('✕ Row', 'Delete row', () => delRow(r))
      );
    }

    document.body.appendChild(popover);
    const rect = cell.getBoundingClientRect();
    const pw = popover.offsetWidth, ph = popover.offsetHeight;
    let left = Math.min(Math.max(8, rect.left), window.innerWidth - pw - 8);
    let top = rect.bottom + 4;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, rect.top - ph - 4);
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';
  }

  function deleteGuardBtn(label, title, fn) {
    if (!fn) {
      const b = btn(label, 'Cannot delete', () => toastB('Cannot delete this one'), 'danger');
      return b;
    }
    const b = btn(label, title, (e) => {
      if (b.dataset.armed === '1') { fn(); return; }
      b.dataset.armed = '1';
      b.classList.remove('btn-outline-danger');
      b.classList.add('btn-danger');
      b.textContent = 'Sure?';
      setTimeout(() => {
        b.dataset.armed = '';
        b.classList.add('btn-outline-danger');
        b.classList.remove('btn-danger');
        b.textContent = label;
      }, 2500);
    }, 'danger');
    return b;
  }

  // ------------------------------------------------------------- grid ops
  function colLines(c) {
    const out = [];
    for (let r = 0; r < rowsCount(); r++) out.push(String(padRow(grid[r], colsCount())[c] ?? ''));
    return out;
  }

  function setColumn(c, lines) {
    for (let r = 0; r < rowsCount(); r++) {
      const line = lines[r] ?? '';
      grid[r][c] = line;
    }
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
    hidePopover();
    render();
    toastB('Column deleted');
  }

  function delRow(r) {
    if (r === 0) { toastB('Cannot delete the header row'); return; }
    if (rowsCount() <= 2) { toastB('Keep at least one data row'); return; }
    grid.splice(r, 1);
    sel = null;
    hidePopover();
    render();
    toastB('Row deleted');
  }


  // ------------------------------------------------------------- lifecycle
  function open(spec) {
    grid = [spec.header.map((s) => String(s ?? ''))];
    spec.rows.forEach((r) => grid.push(r.map((s) => String(s ?? ''))));
    align = (spec.align || []).slice();
    while (align.length < colsCount()) align.push(null);
    sel = null;
    editing = null;
    onDoneCb = spec.onDone || (() => {});
    buildScreen();
    render();
  }

  function commit() {
    commitEditIfAny();
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
    hidePopover();
    commitEditIfAny();
    if (screen) { screen.remove(); screen = null; }
    const holder = document.getElementById('rmd-builder-toast');
    if (holder) holder.remove();
    sel = null; editing = null; onDoneCb = null;
  }

  return { open };
})();
