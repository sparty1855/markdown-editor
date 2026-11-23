/*
 * storage.js — documents & templates persisted in localStorage.
 * Documents are stored as JSON objects (not pure markdown) so we can keep
 * metadata: title, template flag, created/updated timestamps, id.
 */
const Store = (() => {
  const KEY = 'redditmd.docs.v1';
  let docs = null;

  function load() {
    if (docs === null) {
      try {
        docs = JSON.parse(localStorage.getItem(KEY)) || [];
        if (!Array.isArray(docs)) docs = [];
      } catch { docs = []; }
      sanitize();
    }
    return docs;
  }

  // Guard against duplicate ids (historic autosave races): keep the most
  // recently updated copy of each id.
  function sanitize() {
    const seen = new Map();
    for (const d of docs) {
      if (!d || !d.id) continue;
      const prev = seen.get(d.id);
      if (!prev || (d.updated || 0) >= (prev.updated || 0)) seen.set(d.id, d);
    }
    docs = [...seen.values()];
  }

  function persist() {
    localStorage.setItem(KEY, JSON.stringify(load()));
  }

  function uid() {
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function getAll() { return load(); }
  function get(id) { return load().find((d) => d.id === id) || null; }

  function put(doc) {
    const list = load();
    doc.updated = Date.now();
    if (!doc.id) {
      doc.id = uid();
      doc.created = doc.updated;
      list.unshift(doc);
    } else {
      const idx = list.findIndex((d) => d.id === doc.id);
      if (idx >= 0) list[idx] = doc; else list.unshift(doc);
    }
    persist();
    return doc;
  }

  function remove(id) {
    docs = load().filter((d) => d.id !== id);
    persist();
  }

  function getDocs() { return load().filter((d) => !d.template); }
  function getTemplates() { return load().filter((d) => !!d.template); }

  // Merge imported docs: exact duplicates (same title+body) are skipped,
  // colliding ids get fresh ones.
  function importAll(docs) {
    const list = load();
    const knownContent = new Set(list.map((d) => (d.title || '') + '\u0000' + (d.body || '')));
    const knownIds = new Set(list.map((d) => d.id));
    let added = 0, skipped = 0;
    for (const d of docs) {
      if (!d || typeof d.title !== 'string' || typeof d.body !== 'string') continue;
      const key = (d.title || '') + '\u0000' + (d.body || '');
      if (knownContent.has(key)) { skipped++; continue; }
      knownContent.add(key);
      let id = d.id;
      while (!id || knownIds.has(id)) id = uid();
      knownIds.add(id);
      list.push({
        id,
        title: d.title,
        body: d.body,
        template: !!d.template,
        created: d.created || Date.now(),
        updated: d.updated || Date.now()
      });
      added++;
    }
    persist();
    return { added, skipped };
  }

  return { getAll, get, put, remove, getDocs, getTemplates, importAll };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Store;
