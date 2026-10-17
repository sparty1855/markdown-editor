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
    }
    return docs;
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

  return { getAll, get, put, remove, getDocs, getTemplates };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Store;
