// LiveDeck editor — the WYSIWYG layer.
//
// Strategy: the deck is loaded into a same-origin <iframe> so its own CSS/JS
// renders exactly as it would when presented. Because it's same-origin, we can
// reach into the iframe document directly — no build step, no framework, and
// the thing you edit IS the thing that gets saved (true round-trip). On save we
// clone the live document, strip the editor's own affordances, and write the
// HTML back to disk.

const iframe = document.getElementById('stage');
const statusEl = document.getElementById('status');
const saveBtn = document.getElementById('save');

let dirty = false;
let lastSaveAt = 0;
let saveTimer = null;

// Tags we treat as directly editable text blocks (the "click to edit" targets).
const EDITABLE =
  'h1,h2,h3,h4,h5,h6,p,li,span,a,td,th,blockquote,figcaption,button,em,strong,small,label,dt,dd';

// Injected only into the live editing view — never written to disk.
const EDITOR_CSS = `
  .__ld-hover { outline: 2px dashed rgba(99,102,241,.55); outline-offset: 2px; cursor: text; }
  [contenteditable="true"] { outline: 2px solid #6366f1 !important; outline-offset: 2px; border-radius: 2px; }
`;

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

function setDirty(value) {
  dirty = value;
  saveBtn.disabled = !value;
  if (value) setStatus('Unsaved changes', 'dirty');
}

function activeDoc() {
  return iframe.contentDocument;
}

// Wire up editing every time the iframe (re)loads the deck.
iframe.addEventListener('load', () => {
  const doc = activeDoc();
  if (!doc) return;

  if (!doc.getElementById('__livedeck_style')) {
    const style = doc.createElement('style');
    style.id = '__livedeck_style';
    style.textContent = EDITOR_CSS;
    doc.head.appendChild(style);
  }

  doc.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.(EDITABLE);
    if (el && !el.isContentEditable) el.classList.add('__ld-hover');
  });
  doc.addEventListener('mouseout', (e) => {
    const el = e.target.closest?.(EDITABLE);
    if (el) el.classList.remove('__ld-hover');
  });

  doc.addEventListener('click', (e) => {
    const el = e.target.closest?.(EDITABLE);
    if (!el) return;
    e.preventDefault();
    el.classList.remove('__ld-hover');
    el.contentEditable = 'true';
    el.focus();
  });

  doc.addEventListener('input', () => setDirty(true));

  doc.addEventListener(
    'keydown',
    (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape') e.target.blur?.();
      else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        doc.execCommand('bold');
      } else if (mod && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        doc.execCommand('italic');
      }
    },
    true,
  );

  // Leaving a field commits it and triggers a debounced autosave.
  doc.addEventListener(
    'blur',
    (e) => {
      const el = e.target;
      if (el?.getAttribute?.('contenteditable') === 'true') {
        el.removeAttribute('contenteditable');
        if (dirty) scheduleSave();
      }
    },
    true,
  );

  setStatus('Ready — click any text to edit', 'ok');
});

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 600);
}

// Produce clean, disk-ready HTML from the live editing document.
function serialize() {
  const clone = activeDoc().documentElement.cloneNode(true);
  clone.querySelectorAll('#__livedeck_style').forEach((n) => n.remove());
  clone.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
  clone.querySelectorAll('.__ld-hover').forEach((n) => n.classList.remove('__ld-hover'));
  clone.querySelectorAll('[class=""]').forEach((n) => n.removeAttribute('class'));
  return '<!DOCTYPE html>\n' + clone.outerHTML + '\n';
}

async function save() {
  setStatus('Saving…');
  try {
    await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'text/html' },
      body: serialize(),
    });
    lastSaveAt = Date.now();
    setDirty(false);
    setStatus('Saved ✓', 'ok');
  } catch (err) {
    setStatus('Save failed — ' + err.message, 'err');
  }
}

function loadDeck() {
  iframe.src = '/deck.html?ts=' + Date.now();
}

saveBtn.addEventListener('click', save);
document.getElementById('reload').addEventListener('click', loadDeck);
document.getElementById('bold').addEventListener('click', () => activeDoc()?.execCommand('bold'));
document.getElementById('italic').addEventListener('click', () => activeDoc()?.execCommand('italic'));
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  }
});

// Live reload when the deck changes on disk (e.g. Claude Code rewrites it).
const events = new EventSource('/api/events');
events.addEventListener('deckchange', () => {
  if (Date.now() - lastSaveAt < 1500) return; // ignore the echo of our own save
  if (dirty) {
    setStatus('File changed on disk — saving will overwrite, or hit Reload', 'dirty');
    return;
  }
  loadDeck();
  setStatus('Reloaded from disk', 'ok');
});

loadDeck();
