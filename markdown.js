/*
 * markdown.js — a small Reddit-flavored Markdown engine.
 * Renders to HTML for preview, and to "Unicode-pretty" plain text
 * (bold → 𝗯𝗼𝗹𝗱, etc.) for pasting into apps that convert plain text.
 */
const RedditMD = (() => {
  const escHtml = (s) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const escAttr = (s) => s.replace(/"/g, '%22');

  // ---- Reddit inline markup ------------------------------------------------
  // Order matters: spoilers and links contain inline content, so run them first.
  const inlineRules = [
    // Reddit "fancy pants" code span: backticks. (`` renders literally on Reddit.)
    { re: /(`+)([\s\S]*?)\1/g, make: (m) => ({ t: 'code', c: m[2] }) },
    // Spoiler: >!text!< (raw '>' here; HTML escaping happens at render time)
    { re: />!((?:[^!]|!(?!>))*?)!</g, make: (m) => ({ t: 'spoiler', c: m[1] }) },
    // [label](href) — also catches [label](https://…)
    { re: /\[([^\]]*)\]\(([^()\s]+(?:\([^()]*\)[^()\s]*)*)\)/g, make: (m) => ({ t: 'link', label: m[1], href: m[2] }) },
    // Auto-link bare URLs (Reddit does this in comments).
    { re: /(^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g,
      make: (m) => ({ t: 'autolink', href: m[2] }) },
    // Bold+italic: ***text*** or ___text___ (must run before bold/italic)
    { re: /(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g, make: (m) => ({ t: 'bold', c: '*' + m[2] + '*' }) },
    // Bold: **text** or __text__
    { re: /(\*\*|__)(?=\S)([\s\S]*?\S)\1(?!\*)/g, make: (m) => ({ t: 'bold', c: m[2] }) },
    // Italic: *text* or _text_ (avoid intraword underscores; keep it simple)
    { re: /(\*|_)(?=\S)([^*_\n]*?\S)\1/g, make: (m) => ({ t: 'italic', c: m[2] }) },
    // Strike: ~~text~~
    { re: /~~(?=\S)([\s\S]*?\S)~~/g, make: (m) => ({ t: 'strike', c: m[1] }) },
    // Underline via <u>…</u> (the only raw HTML Reddit's editor emits/supports).
    { re: /<u>([\s\S]*?)<\/u>/gi, make: (m) => ({ t: 'underline', c: m[1] }) },
    // Superscript ^text (Reddit: ^word or ^(phrase))
    { re: /\^\(([^)\n]+)\)|\^(\S+)/g, make: (m) => ({ t: 'sup', c: m[1] || m[2] }) }
  ];

  // Convert one inline text string to an array of tokens.
  function tokenizeInline(text) {
    // Split on code spans first (no formatting inside).
    const parts = [];
    let rest = text;
    const codeRe = /(`+)([\s\S]*?)\1/;
    let m;
    while ((m = rest.match(codeRe))) {
      parts.push({ t: 'text', c: rest.slice(0, m.index) });
      parts.push({ t: 'code', c: m[2] });
      rest = rest.slice(m.index + m[0].length);
    }
    parts.push({ t: 'text', c: rest });

    const out = [];
    for (const p of parts) {
      if (p.t === 'code') { out.push(p); continue; }
      out.push(...inlineize(p.c));
    }
    return out;
  }

  // Apply non-code inline rules repeatedly until stable.
  function inlineize(text) {
    let tokens = [{ t: 'text', c: text }];
    for (const rule of inlineRules) {
      if (rule.re.source.startsWith('(`')) continue; // handled above
      const next = [];
      for (const tok of tokens) {
        if (tok.t !== 'text') { next.push(tok); continue; }
        let s = tok.c;
        let m;
        rule.re.lastIndex = 0;
        while ((m = rule.re.exec(s))) {
          if (m.index > 0) next.push({ t: 'text', c: s.slice(0, m.index) });
          const made = rule.make(m);
          if (made.t === 'autolink') {
            if (m[1]) next.push({ t: 'text', c: m[1] });
            next.push({ t: 'link', label: made.href, href: made.href,
              children: [{ t: 'text', c: made.href }] });
          } else {
            next.push(made);
          }
          s = s.slice(m.index + m[0].length);
          rule.re.lastIndex = 0;
        }
        if (s) next.push({ t: 'text', c: s });
      }
      tokens = next;
    }
    // Recurse into container tokens.
    for (const tok of tokens) {
      if (tok.t === 'bold' || tok.t === 'italic' || tok.t === 'strike' || tok.t === 'spoiler' || tok.t === 'underline') {
        tok.children = tokenizeInline(tok.c);
      }
    }
    return tokens;
  }

  function renderInlineHtml(tokens) {
    return tokens.map((tok) => {
      switch (tok.t) {
        case 'text': return escHtml(tok.c);
        case 'code': return '<code>' + escHtml(tok.c) + '</code>';
        case 'bold': return '<strong>' + renderInlineHtml(tok.children) + '</strong>';
        case 'italic': return '<em>' + renderInlineHtml(tok.children) + '</em>';
        case 'strike': return '<del>' + renderInlineHtml(tok.children) + '</del>';
        case 'spoiler': return '<span class="badge text-bg-secondary" title="Spoiler (renders as &gt;!…!&lt; on Reddit)">' + renderInlineHtml(tok.children) + '</span>';
        case 'underline': return '<u>' + renderInlineHtml(tok.children) + '</u>';
        case 'link': {
          const href = escHtml(escAttr(tok.href));
          const labelHtml = tok.children
            ? renderInlineHtml(tok.children)
            : renderInlineHtml(tokenizeInline(tok.label || href));
          return '<a href="' + href + '" target="_blank" rel="noopener noreferrer nofollow ugc">' + labelHtml + '</a>';
        }
        case 'sup': return '<sup>' + escHtml(tok.c) + '</sup>';
        default: return escHtml(tok.c || '');
      }
    }).join('');
  }

  // ---- Block parsing -------------------------------------------------------
  const headingRe = /^(#{1,6})\s+(.*)$/;
  const hrRe = /^(-{3,}|\*{3,}|_{3,})\s*$/;
  const ulRe = /^(\s*)([-*+])\s+(.*)$/;
  const olRe = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
  const quoteRe = /^(\s*)>\s?(.*)$/;
  const tableRowRe = /^\s*\|(.+)\|\s*$/;
  const tableSplitRe = /^\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

  function splitTableRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '')
      .split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  }

  function isTableSplit(line) {
    const s = line.trim();
    if (!s.includes('-')) return false;
    return splitTableRow(s).every((c) => /^:?-{2,}:?$/.test(c.replace(/\s+/g, ''))) && s.includes('|');
  }

  function parseBlocks(lines) {
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) { i++; continue; }

      let m;
      if ((m = line.match(hrRe))) {
        blocks.push({ t: 'hr' });
        i++;
        continue;
      }
      if ((m = line.match(headingRe))) {
        blocks.push({ t: 'heading', level: m[1].length, text: m[2].trim() });
        i++;
        continue;
      }

      // Table: header row + separator row.
      if (tableRowRe.test(line) && i + 1 < lines.length && isTableSplit(lines[i + 1])) {
        const header = splitTableRow(line);
        const align = splitTableRow(lines[i + 1]).map((c) => {
          const l = c.startsWith(':'), r = c.endsWith(':');
          return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
        });
        i += 2;
        const rows = [];
        while (i < lines.length && tableRowRe.test(lines[i]) && lines[i].trim()) {
          rows.push(splitTableRow(lines[i]));
          i++;
        }
        blocks.push({ t: 'table', header, align, rows });
        continue;
      }

      // Block quote (no nesting support; keep simple).
      // A line like ">!spoiler!<" is a spoiler paragraph, not a quote.
      if ((m = line.match(quoteRe)) && !/^\s*>\s?!(?:.|\n)*?!<\s*$/.test(line)) {
        const inner = [];
        while (i < lines.length && (m = lines[i].match(quoteRe))) {
          inner.push(m[2]);
          i++;
        }
        blocks.push({ t: 'quote', lines: inner });
        continue;
      }

      // Lists.
      if (ulRe.test(line) || olRe.test(line)) {
        const ordered = olRe.test(line);
        const items = [];
        while (i < lines.length && (m = lines[i].match(ordered ? olRe : ulRe))) {
          items.push(m[3]);
          i++;
          // continuation lines for lazy paragraphs inside an item
          while (i < lines.length && lines[i].trim() && !ulRe.test(lines[i]) && !olRe.test(lines[i]) &&
                 !headingRe.test(lines[i]) && !tableRowRe.test(lines[i]) && !quoteRe.test(lines[i]) && !hrRe.test(lines[i])) {
            items[items.length - 1] += ' ' + lines[i].trim();
            i++;
          }
        }
        blocks.push({ t: 'list', ordered, items });
        continue;
      }

      // Paragraph: consume until blank line or block start.
      const para = [line.trim()];
        i++;
      while (i < lines.length && lines[i].trim() &&
             !headingRe.test(lines[i]) && !hrRe.test(lines[i]) &&
             !tableRowRe.test(lines[i]) && !quoteRe.test(lines[i]) &&
             !ulRe.test(lines[i]) && !olRe.test(lines[i])) {
        para.push(lines[i].trim());
        i++;
      }
      blocks.push({ t: 'para', text: para.join('\n') });
    }
    return blocks;
  }

  function renderBlocksHtml(blocks) {
    return blocks.map((b) => {
      switch (b.t) {
        case 'hr': return '<hr>';
        case 'heading': {
          const lvl = Math.min(6, Math.max(1, b.level));
          return '<h' + lvl + '>' + renderInlineHtml(tokenizeInline(b.text)) + '</h' + lvl + '>';
        }
        case 'quote': return '<blockquote>' + renderBlocksHtml(parseBlocks(b.lines)) + '</blockquote>';
        case 'list': {
          const tag = b.ordered ? 'ol' : 'ul';
          const items = b.items.map((it) => '<li>' + renderInlineHtml(tokenizeInline(it)) + '</li>').join('');
          return '<' + tag + '>' + items + '</' + tag + '>';
        }
        case 'table': return tableToHtml(b);
        case 'para': return '<p>' + renderInlineHtml(tokenizeInline(b.text)).replace(/\n/g, '<br>') + '</p>';
        default: return '';
      }
    }).join('\n');
  }

  function tableToHtml(b) {
    const n = b.header.length;
    const alignAttr = (idx) => {
      const a = b.align[idx] || null;
      return a ? ' style="text-align:' + a + '"' : '';
    };
    let html = '<div class="table-wrap"><table class="table table-sm table-bordered mb-0"><thead><tr>';
    b.header.forEach((h, idx) => {
      html += '<th' + alignAttr(idx) + '>' + renderInlineHtml(tokenizeInline(h)) + '</th>';
    });
    html += '</tr></thead><tbody>';
    b.rows.forEach((row) => {
      html += '<tr>';
      for (let idx = 0; idx < n; idx++) {
        html += '<td' + alignAttr(idx) + '>' + renderInlineHtml(tokenizeInline(row[idx] ?? '')) + '</td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  // ---- Unicode plain-text rendering ----------------------------------------
  // For apps that convert pasted plain text (e.g. chat apps): map markup to
  // Unicode equivalents so it still *looks* formatted.
  const boldMap = new Map(), italicMap = new Map(), monoMap = new Map();
  (function initUnicodeMaps() {
    // Sans-serif bold block: uppercase U+1D5D4, lowercase U+1D5EE, digits U+1D7EC
    for (let i = 0; i < 26; i++) {
      boldMap.set(String.fromCharCode(65 + i), String.fromCodePoint(0x1d5d4 + i));
      boldMap.set(String.fromCharCode(97 + i), String.fromCodePoint(0x1d5ee + i));
    }
    for (let d = 0; d < 10; d++) boldMap.set(String(d), String.fromCodePoint(0x1d7ec + d));
    // Monospace block: uppercase U+1D670, lowercase U+1D68A, digits U+1D7F6
    for (let i = 0; i < 26; i++) {
      monoMap.set(String.fromCharCode(65 + i), String.fromCodePoint(0x1d670 + i));
      monoMap.set(String.fromCharCode(97 + i), String.fromCodePoint(0x1d68a + i));
    }
    for (let d = 0; d < 10; d++) monoMap.set(String(d), String.fromCodePoint(0x1d7f6 + d));
  })();

  function mapChars(s, m) {
    let out = '';
    for (const ch of s) out += (m.get(ch) || ch);
    return out;
  }

  function renderInlineText(tokens) {
    return tokens.map((tok) => {
      switch (tok.t) {
        case 'text': return tok.c;
        case 'code': return mapChars(tok.c, monoMap);
        case 'bold': return mapChars(renderInlineText(tok.children), boldMap);
        case 'italic': return renderInlineText(tok.children); // Unicode italic is ugly; leave as-is
        case 'strike': return '\u0336'.repeat(0) + renderInlineText(tok.children); // keep text plain
        case 'spoiler': return '‹' + renderInlineText(tok.children) + '›';
        case 'underline': return renderInlineText(tok.children);
        case 'link': return tok.label || tok.href;
        case 'sup': return '^(' + tok.c + ')';
        default: return '';
      }
    }).join('');
  }

  function renderBlocksText(blocks) {
    return blocks.map((b) => {
      switch (b.t) {
        case 'hr': return '──────────';
        case 'heading': {
          const bars = '═'.repeat(Math.max(1, 7 - b.level));
          return renderInlineText(tokenizeInline(b.text)) + '\n' + bars;
        }
        case 'quote': return renderBlocksText(parseBlocks(b.lines))
          .split('\n').map((l) => (l ? '│ ' + l : '│')).join('\n');
        case 'list':
          return b.items.map((it, idx) => (b.ordered ? (idx + 1) + '. ' : '• ') + renderInlineText(tokenizeInline(it))).join('\n');
        case 'table': return tableToText(b);
        case 'para': return renderInlineText(tokenizeInline(b.text));
        default: return '';
      }
    }).filter((s) => s !== '').join('\n\n');
  }

  function tableToText(b) {
    const n = b.header.length;
    const rows = [b.header, ...b.rows].map((r) => {
      const cells = [];
      for (let i = 0; i < n; i++) cells.push(renderInlineText(tokenizeInline(r[i] ?? '')));
      return cells;
    });
    const widths = [];
    for (let i = 0; i < n; i++) widths[i] = Math.max(...rows.map((r) => [...r[i]].length), 3);
    const line = (cells) => cells.map((c, i) => (c ?? '').padEnd(widths[i], ' ')).join(' │ ');
    const border = '├' + widths.map((w) => '─'.repeat(w + 2)).join('┼') + '┤';
    const top = '┌' + widths.map((w) => '─'.repeat(w + 2)).join('┬') + '┐';
    const bot = '└' + widths.map((w) => '─'.repeat(w + 2)).join('┴') + '┘';
    const out = [top, '│ ' + line(rows[0]) + ' │', border];
    for (let r = 1; r < rows.length; r++) out.push('│ ' + line(rows[r]) + ' │');
    out.push(bot);
    return out.join('\n');
  }

  // ---- Public API -----------------------------------------------------------
  function toHtml(md) {
    const lines = md.replace(/\r\n?/g, '\n').split('\n');
    return renderBlocksHtml(parseBlocks(lines));
  }

  function toText(md) {
    const lines = md.replace(/\r\n?/g, '\n').split('\n');
    return renderBlocksText(parseBlocks(lines));
  }

  function normalize(md) {
    // Normalize line endings; keep <u> tags (Reddit's editor supports them).
    return md.replace(/\r\n?/g, '\n');
  }

  return { toHtml, toText, normalize };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RedditMD;
