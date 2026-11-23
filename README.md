# Markdown Editor — a Reddit-flavored Markdown PWA

A simple, installable Progressive Web App for writing **Reddit-flavored Markdown**, previewing it the way Reddit will render it, and copying it to paste straight into the Reddit app (Android/iOS or desktop).

No build step, no npm, no bundler. Plain JavaScript + Bootstrap 5 from CDN + a service worker for offline use.

## Run it

Any static file server will do. For example:

```bash
cd reddit-markdown-pwa
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Service workers require `http://localhost` or HTTPS.

To **install as an app**: open the page in Chrome/Edge (desktop: install icon in the address bar; Android: menu → "Add to Home screen" / "Install app"). Once installed it works fully offline.

## Features

- **Two screens, no clutter**:
  - **Home** — all notes in one list with search, plus a **Templates** tab. Create (`✎ New note`), copy, or two-tap-delete from each row.
  - **Editor** — back button, live title, Copy, and a small ⋮ menu (copy Unicode / save as template). Nothing else.
- **Autosave**: every edit is saved ~500ms after typing stops. There is no Save button. A note's **title is its first line** (markdown stripped); if the note never gets one it falls back to `Note — <date>`. Empty notes are never persisted.
- **Inline toolbar** (edit pane): **B** *I* <u>U</u> ~~S~~ `code` link ^sup — inline formatting only.
- **FAB (+)** in the lower right opens an insert sheet: tables, bulleted/ordered lists, quote, spoiler, divider, headings H1–H4.
- **Smart Enter**: Enter on a list line continues the list (bullets repeat, ordered markers increment); Enter on a blank list entry ends the list and clears the line.
- **Indent / outdent** (⇥ / ⇤ on the toolbar) nest or un-nest list lines, with full nested-list rendering in the preview.
- **Split view**: on desktop the editor and live preview sit side by side; on phones a tab strip switches between them (preview toggleable to raw markdown).
- **Save as template**: open a note, `⋮ → Save as template`; it appears on the Home Templates tab with a **Use** button to start a new note from it.

### Markdown / Reddit flavor
- **Reddit flavor support**:
  - Headings `#`–`######` (Reddit caps at `h6`)
  - **Bold** (`**text**` / `__text__`), *italic* (`*text*` / `_text_`)
  - ~~Strike-through~~ (`~~text~~`)
  - Underline via `<u>text</u>` (Reddit's editor uses HTML `<u>`; the toolbar inserts it)
  - Inline code with backticks, superscript `^like this`
  - Bulleted (`-`/`*`/`+`) and ordered (`1.`) lists
  - Block quotes `> text`, horizontal rules, links, auto-linked URLs
  - Spoilers `>!like this!<` (shown as redacted badges in preview)
  - **Robust tables**: `| pipe | tables |` with `:---:` alignment cells, escaped pipes `\|`, bold/italic/code inside cells, column count derived from the header, over/under-full rows tolerated
- **Copy buttons**:
  - **Copy** (top bar): copies the exact markdown — this is what you paste into Reddit's markdown editor.
  - **Copy unicode** (in raw mode): renders the markdown to plain text with Unicode formatting (mathematical bold, box-drawing tables). Useful for apps that strip markdown but display Unicode.
- **Storage**: browser `localStorage` as JSON records (id, title, body, template flag, timestamps) — not raw markdown files. Per-browser, works offline, cleared only if you clear site data.
- **Editor niceties**: keyboard shortcuts (`Ctrl+B` bold, `Ctrl+I` italic, `Ctrl+K` link), tab inserts spaces.
- Dark theme top bar, light content; toasts for feedback; delete is a two-tap confirm (no native dialogs, which iOS standalone PWAs suppress).

## What's deliberately not supported

Images/media embeds, footnotes, nested block structures beyond what's listed, and HTML beyond `<u>`. Keep it simple; Reddit's own editor rejects most raw HTML anyway.

## Files

- `index.html` — UI shell (Bootstrap 5.3 via CDN)
- `markdown.js` — Reddit-flavored Markdown parser → HTML preview / Unicode text
- `storage.js` — localStorage-backed document & template store (JSON records)
- `app.js` — editor/preview/copy/save/template logic
- `sw.js`, `manifest.webmanifest`, `icons/` — PWA installability & offline cache
- `tests/` — Node tests for the markdown engine (`node tests/markdown.test.js`)

## A note on storage

Documents live in the browser's `localStorage` under `redditmd.docs.v1`. This means:

- They persist across sessions and work offline after install.
- They are per-browser/per-origin — clearing site data deletes them.
- No filesystem permission prompts, no vendor lock-in, but no sync either. A "download as file" export is an easy future addition.
