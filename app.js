pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

const $ = id => document.getElementById(id);
const pagesEl = $('pages'), viewer = $('viewer'), homeEl = $('home'), recentEl = $('recent'), recentWrap = $('recentWrap');
const fileInput = $('fileInput'), saveBtn = $('saveBtn'), statusEl = $('status');
const zoomLabel = $('zoomLabel'), fontSel = $('fontSel'), colorPick = $('colorPick'), hlPick = $('hlPick');
const undoBtn = $('undoBtn'), redoBtn = $('redoBtn'), formatbar = $('formatbar');
const docNameEl = $('docName'), pageCountEl = $('pageCount'), sizeInput = $('sizeInput');

let origBytes = null, fileName = '', currentId = null, pdfDoc = null;
let scale = 1.5, addMode = false, focused = null, pageInfos = [];
let addedModels = [], idSeq = 0, dirtyFile = false, autosaveT = null, autosaveFailed = false;

const status = m => { statusEl.textContent = m; statusEl.style.opacity = 1; clearTimeout(status._t); status._t = setTimeout(() => statusEl.style.opacity = 0, 2200); };
const isBold = n => /bold|black|heavy|demi|semibold/i.test(n || '');
const isItalic = n => /italic|oblique|cursive/i.test(n || '');

const FONTS = {
  arial:      { label: 'Arial', css: `Arial, 'Helvetica Neue', Helvetica, sans-serif`, exp: 'sans' },
  inter:      { label: 'Inter', css: `Inter, Arial, sans-serif`, exp: 'sans' },
  roboto:     { label: 'Roboto', css: `Roboto, Arial, sans-serif`, exp: 'sans' },
  opensans:   { label: 'Open Sans', css: `'Open Sans', Arial, sans-serif`, exp: 'sans' },
  lato:       { label: 'Lato', css: `Lato, Arial, sans-serif`, exp: 'sans' },
  montserrat: { label: 'Montserrat', css: `Montserrat, Arial, sans-serif`, exp: 'sans' },
  oswald:     { label: 'Oswald', css: `Oswald, Arial, sans-serif`, exp: 'sans' },
  raleway:    { label: 'Raleway', css: `Raleway, Arial, sans-serif`, exp: 'sans' },
  poppins:    { label: 'Poppins', css: `Poppins, Arial, sans-serif`, exp: 'sans' },
  nunito:     { label: 'Nunito', css: `Nunito, Arial, sans-serif`, exp: 'sans' },
  sourcesans: { label: 'Source Sans', css: `'Source Sans 3', Arial, sans-serif`, exp: 'sans' },
  verdana:    { label: 'Verdana', css: `Verdana, Geneva, sans-serif`, exp: 'sans' },
  trebuchet:  { label: 'Trebuchet MS', css: `'Trebuchet MS', Verdana, sans-serif`, exp: 'sans' },
  georgia:    { label: 'Georgia', css: `Georgia, 'Times New Roman', serif`, exp: 'serif' },
  times:      { label: 'Times New Roman', css: `'Times New Roman', Times, serif`, exp: 'serif' },
  ptserif:    { label: 'PT Serif', css: `'PT Serif', Georgia, serif`, exp: 'serif' },
  merriweather:{ label: 'Merriweather', css: `Merriweather, Georgia, serif`, exp: 'serif' },
  playfair:   { label: 'Playfair Display', css: `'Playfair Display', Georgia, serif`, exp: 'serif' },
  courier:    { label: 'Courier New', css: `'Courier New', Courier, monospace`, exp: 'mono' },
  robotomono: { label: 'Roboto Mono', css: `'Roboto Mono', 'Courier New', monospace`, exp: 'mono' }
};
Object.entries(FONTS).forEach(([k, f]) => {
  const o = document.createElement('option'); o.value = k; o.textContent = f.label; o.style.fontFamily = f.css; fontSel.appendChild(o);
});
fontSel.value = 'arial';

function guessFontKey(pdfName) {
  const n = (pdfName || '').toLowerCase();
  if (/times|serif|georgia|garamond|minion|palatino|bookman|charter/.test(n)) return /georgia/.test(n) ? 'georgia' : 'times';
  if (/courier|mono|typewriter|consolas|menlo/.test(n)) return 'courier';
  if (/verdana/.test(n)) return 'verdana';
  if (/trebuchet/.test(n)) return 'trebuchet';
  return 'arial';
}

function famKeyFromCss(css) {
  const first = (css || '').split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
  for (const [k, f] of Object.entries(FONTS)) if (f.label.toLowerCase() === first) return k;
  if (first.includes('source sans')) return 'sourcesans';
  if (first.includes('roboto mono')) return 'robotomono';
  if (first.includes('playfair')) return 'playfair';
  if (first.includes('pt serif')) return 'ptserif';
  if (first.includes('merriweather')) return 'merriweather';
  if (first.includes('montserrat')) return 'montserrat';
  if (first.includes('trebuchet')) return 'trebuchet';
  if (first.includes('courier') || first.includes('mono') || first.includes('consolas') || first.includes('menlo')) return 'courier';
  if (/times|serif|georgia|garamond|minion|palatino/.test(first)) return 'times';
  return 'arial';
}

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('the-pdf-editor', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('docs', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbPut(rec) {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction('docs', 'readwrite'); t.objectStore('docs').put(rec); t.oncomplete = res; t.onerror = () => rej(t.error); });
}
async function idbAll() {
  const db = await idb();
  return new Promise((res, rej) => { const q = db.transaction('docs').objectStore('docs').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); });
}
async function idbDel(id) {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction('docs', 'readwrite'); t.objectStore('docs').delete(id); t.oncomplete = res; t.onerror = () => rej(t.error); });
}

async function saveSession() {
  if (!pdfDoc || !origBytes) return;
  try {
    await idbPut({ id: currentId, name: fileName, updatedAt: Date.now(), pdf: origBytes, snap: serialize(), scale, pages: pdfDoc.numPages, dirtyFile });
  } catch (err) {
    if (!autosaveFailed) { autosaveFailed = true; status('Autosave failed — browser storage full'); }
  }
}
function scheduleAutosave() {
  clearTimeout(autosaveT);
  autosaveT = setTimeout(saveSession, 1200);
}

function markDirty() {
  dirtyFile = true;
  saveBtn.classList.add('dirty');
  scheduleAutosave();
}
function markClean() {
  dirtyFile = false;
  saveBtn.classList.remove('dirty');
}

addEventListener('beforeunload', e => {
  if (dirtyFile && pdfDoc) { e.preventDefault(); e.returnValue = ''; }
});

let undoStack = [], redoStack = [], beforeOp = null, typeBefore = null;

function serialize() {
  const boxes = [];
  document.querySelectorAll('.tbox').forEach(el => {
    boxes.push({
      id: el.dataset.id, page: +el.dataset.page,
      text: el.innerText, html: el.innerHTML,
      left: parseFloat(el.style.left) || 0, top: parseFloat(el.style.top) || 0,
      fontPx: parseFloat(el.style.fontSize) || 12,
      bold: el.dataset.bold || '', italic: el.dataset.italic || '', ul: el.dataset.ul || '',
      fam: el.dataset.fam || 'arial', exp: el.dataset.exp || 'sans',
      color: el.dataset.color || '#000000', hl: el.dataset.hl || '',
      deleted: el.dataset.deleted || '', added: el.dataset.added || ''
    });
  });
  return { scale, boxes };
}

function willChange() { if (!beforeOp) beforeOp = serialize(); }
function didChange() {
  if (beforeOp) { undoStack.push(beforeOp); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; beforeOp = null; }
  updateUndoBtns();
  markDirty();
}
function updateUndoBtns() { undoBtn.disabled = !undoStack.length; redoBtn.disabled = !redoStack.length; }

function undo() {
  if (!undoStack.length) return;
  redoStack.push(serialize());
  applySnapshot(undoStack.pop());
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(serialize());
  applySnapshot(redoStack.pop());
}
undoBtn.onclick = undo;
redoBtn.onclick = redo;

let savedSel = null;
document.addEventListener('selectionchange', () => {
  const s = getSelection();
  if (!s.rangeCount) return;
  const a = s.anchorNode;
  if (!a) return;
  const box = a.nodeType === 1 ? a.closest('.tbox') : (a.parentElement ? a.parentElement.closest('.tbox') : null);
  if (box) { try { savedSel = { id: box.dataset.id, range: s.getRangeAt(0).cloneRange() }; } catch (err) { } }
});
function targetBox() {
  if (focused && document.contains(focused) && !focused.dataset.deleted && focused.style.display !== 'none') return focused;
  if (savedSel) {
    const el = document.querySelector(`[data-id="${savedSel.id}"]`);
    if (el && !el.dataset.deleted && el.style.display !== 'none') return el;
  }
  return null;
}
function restoreSel(box) {
  try {
    box.focus();
    const s = getSelection();
    if (savedSel && savedSel.id === box.dataset.id && savedSel.range) {
      s.removeAllRanges();
      s.addRange(savedSel.range);
    }
  } catch (err) { }
}
function selCollapsed(box) {
  const s = getSelection();
  if (!s.rangeCount) return true;
  const r = s.getRangeAt(0);
  return r.collapsed || !box.contains(r.commonAncestorContainer);
}
function syncModel(box) {
  const m = pageInfos.flatMap(p => p.models).find(m => m.id === box.dataset.id);
  if (m) { m.text = box.innerText; m.dirty = box.innerText !== m.str; }
}
function formatOp(fn) {
  const box = targetBox();
  if (!box) return status('Click a text box first');
  restoreSel(box);
  willChange();
  typeBefore = null;
  fn(box, selCollapsed(box));
  normalizeBox(box);
  syncModel(box);
  box.dataset.dirty = '1';
  didChange();
  box.focus();
}
function normalizeBox(el) {
  el.querySelectorAll('font').forEach(fn => {
    const sp = document.createElement('span');
    if (fn.hasAttribute('color')) sp.style.color = fn.getAttribute('color');
    if (fn.hasAttribute('face')) { const k = famKeyFromCss(fn.getAttribute('face')); sp.style.fontFamily = (FONTS[k] || FONTS.arial).css; }
    sp.innerHTML = fn.innerHTML;
    fn.replaceWith(sp);
  });
}
function applySizeToSel(box, px) {
  document.execCommand('fontSize', false, '7');
  box.querySelectorAll('font[size="7"]').forEach(fn => {
    const sp = document.createElement('span');
    sp.style.fontSize = px + 'px';
    sp.innerHTML = fn.innerHTML;
    fn.replaceWith(sp);
  });
}

formatbar.querySelectorAll('button').forEach(b => b.addEventListener('mousedown', e => e.preventDefault()));

function runsOf(el) {
  const base = {
    bold: !!el.dataset.bold, italic: !!el.dataset.italic, ul: !!el.dataset.ul,
    color: el.dataset.color || '#000000', size: parseFloat(el.style.fontSize) || 12,
    fam: el.dataset.fam || 'arial', exp: el.dataset.exp || 'sans', hl: ''
  };
  const runs = [];
  const BLOCK = /^(DIV|P|LI|H1|H2|H3|BLOCKQUOTE)$/;
  const walk = (node, st, first) => {
    if (node.nodeType === 3) { if (node.textContent) runs.push({ text: node.textContent, ...st }); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (tag === 'BR') { runs.push({ text: '\n', ...st }); return; }
    if (BLOCK.test(tag) && !first) runs.push({ text: '\n', ...st });
    const s2 = { ...st };
    if (tag === 'B' || tag === 'STRONG') s2.bold = true;
    if (tag === 'I' || tag === 'EM') s2.italic = true;
    if (tag === 'U') s2.ul = true;
    if (tag === 'FONT') {
      if (node.hasAttribute('color')) s2.color = node.getAttribute('color');
      if (node.hasAttribute('face')) { const k = famKeyFromCss(node.getAttribute('face')); s2.fam = k; s2.exp = (FONTS[k] || FONTS.arial).exp; }
    }
    const cs = node.style;
    if (cs && cs.length) {
      const fw = cs.fontWeight;
      if (fw === 'bold' || fw === '700' || +fw >= 600) s2.bold = true;
      if (fw === 'normal' || fw === '400') s2.bold = false;
      if (cs.fontStyle === 'italic') s2.italic = true;
      if (cs.fontStyle === 'normal') s2.italic = false;
      if ((cs.textDecoration || '').includes('underline')) s2.ul = true;
      if (cs.color) s2.color = cs.color;
      if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') s2.hl = cs.backgroundColor;
      if (cs.fontSize) s2.size = parseFloat(cs.fontSize) || s2.size;
      if (cs.fontFamily) { const k = famKeyFromCss(cs.fontFamily); s2.fam = k; s2.exp = (FONTS[k] || FONTS.arial).exp; }
    }
    Array.from(node.childNodes).forEach((c, i) => walk(c, s2, first && i === 0));
  };
  Array.from(el.childNodes).forEach((c, i) => walk(c, base, i === 0));
  return runs;
}

function applySnapshot(snap) {
  const f = scale / (snap.scale || scale);
  focused = null; beforeOp = null; typeBefore = null;
  const byId = {};
  snap.boxes.forEach(b => { byId[b.id] = b; });
  pageInfos.forEach(info => {
    info.layer.querySelectorAll('.tbox').forEach(e => e.remove());
    snap.boxes.filter(b => b.page === info.n).forEach(b => {
      const m = info.models.find(mm => mm.id === b.id);
      if (!m) return;
      buildBox(info.layer, info.n, m, {
        text: b.text, html: b.html, left: b.left * f, top: b.top * f, fontPx: b.fontPx * f,
        bold: b.bold, italic: b.italic, ul: b.ul, fam: b.fam, exp: b.exp, color: b.color, hl: b.hl, deleted: b.deleted
      });
    });
    info.models.forEach(m => {
      const b = byId[m.id];
      if (!b) { m.gone = true; return; }
      m.gone = false; m.text = b.text; m.deleted = !!b.deleted; m.fontPx = b.fontPx * f;
      if (m.added) { m.newLeft = b.left * f; m.newTop = b.top * f; }
      else m.moved = Math.abs(b.left * f - m.x) > 0.5 || Math.abs(b.top * f - m.yTop) > 0.5;
    });
  });
  updateUndoBtns();
  markDirty();
}

function showEditor() {
  homeEl.style.display = 'none';
  pagesEl.style.display = 'flex';
  formatbar.hidden = false;
}
function showHome() {
  saveSession().then(refreshRecent).catch(refreshRecent);
  pdfDoc = null; origBytes = null; focused = null; savedSel = null;
  pagesEl.style.display = 'none';
  pagesEl.innerHTML = '';
  homeEl.style.display = '';
  formatbar.hidden = true;
  docNameEl.textContent = '';
  saveBtn.disabled = true;
  markClean();
  saveBtn.classList.remove('dirty');
}

async function refreshRecent() {
  let docs = [];
  try { docs = await idbAll(); } catch (err) { docs = []; }
  docs.sort((a, b) => b.updatedAt - a.updatedAt);
  recentWrap.hidden = !docs.length;
  recentEl.innerHTML = '';
  docs.forEach(d => {
    const row = document.createElement('div');
    row.className = 'doc-row';
    const grow = document.createElement('div');
    grow.className = 'grow';
    const nm = document.createElement('div');
    nm.className = 'nm'; nm.textContent = d.name;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = new Date(d.updatedAt).toLocaleString() + (d.pages ? ` · ${d.pages} page${d.pages > 1 ? 's' : ''}` : '') + (d.dirtyFile ? ' · unsaved changes' : '');
    grow.appendChild(nm); grow.appendChild(meta);
    const open = document.createElement('button');
    open.textContent = 'Open'; open.className = 'primary openbtn';
    open.onclick = () => openRecord(d);
    const dl = document.createElement('button');
    dl.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    dl.title = 'Download PDF with saved changes'; dl.className = 'primary iconbtn'; dl.setAttribute('aria-label', 'Download PDF');
    dl.onclick = async () => { await openRecord(d); if (pdfDoc && currentId === d.id) saveBtn.onclick(); };
    const del = document.createElement('button');
    del.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    del.title = 'Remove from library'; del.className = 'danger iconbtn'; del.setAttribute('aria-label', 'Remove from library');
    del.onclick = async () => {
      if (!confirm(`Remove "${d.name}" from the library?\n\nYou won't be able to open or save it again unless you re-import the original PDF file.`)) return;
      await idbDel(d.id); if (currentId === d.id) currentId = 'd' + Date.now().toString(36); refreshRecent();
    };
    row.appendChild(grow); row.appendChild(open); row.appendChild(dl); row.appendChild(del);
    recentEl.appendChild(row);
  });
}

async function openRecord(d) {
  try {
    currentId = d.id; fileName = d.name; origBytes = d.pdf;
    scale = d.scale || 1.5; zoomLabel.textContent = Math.round(scale * 100) + '%';
    pdfDoc = await pdfjsLib.getDocument({ data: origBytes.slice(0) }).promise;
    resetDocState();
    await renderAll(false);
    if (d.snap) {
      (d.snap.boxes || []).forEach(b => {
        if (b.added && !addedModels.find(a => a.id === b.id)) {
          const m = { id: b.id, str: '', text: b.text, added: true, pageNum: b.page, fontPx: b.fontPx, newLeft: b.left, newTop: b.top, x: b.left, yTop: b.top, bold: '', italic: '', gone: false };
          addedModels.push(m);
          const info = pageInfos.find(p => p.n === b.page); if (info) info.models.push(m);
          const num = parseInt(b.id.slice(1), 10); if (!isNaN(num) && num >= idSeq) idSeq = num + 1;
        }
      });
      applySnapshotNoDirty(d.snap);
    }
    undoStack = [serialize()]; updateUndoBtns();
    if (d.dirtyFile) markDirty(); else markClean();
    enterDoc();
    status(`Opened ${fileName}`);
  } catch (err) { console.error(err); status('Could not open — file data is damaged'); }
}

function applySnapshotNoDirty(snap) {
  const f = scale / (snap.scale || scale);
  focused = null; beforeOp = null; typeBefore = null;
  const byId = {};
  snap.boxes.forEach(b => { byId[b.id] = b; });
  pageInfos.forEach(info => {
    info.layer.querySelectorAll('.tbox').forEach(e => e.remove());
    snap.boxes.filter(b => b.page === info.n).forEach(b => {
      const m = info.models.find(mm => mm.id === b.id);
      if (!m) return;
      buildBox(info.layer, info.n, m, {
        text: b.text, html: b.html, left: b.left * f, top: b.top * f, fontPx: b.fontPx * f,
        bold: b.bold, italic: b.italic, ul: b.ul, fam: b.fam, exp: b.exp, color: b.color, hl: b.hl, deleted: b.deleted
      });
    });
    info.models.forEach(m => {
      const b = byId[m.id];
      if (!b) { m.gone = true; return; }
      m.gone = false; m.text = b.text; m.deleted = !!b.deleted; m.fontPx = b.fontPx * f;
      if (m.added) { m.newLeft = b.left * f; m.newTop = b.top * f; }
      else m.moved = Math.abs(b.left * f - m.x) > 0.5 || Math.abs(b.top * f - m.yTop) > 0.5;
    });
  });
}

function resetDocState() {
  pageInfos = []; addedModels = []; idSeq = 0;
  undoStack = []; redoStack = []; beforeOp = null; typeBefore = null; updateUndoBtns();
}
function enterDoc() {
  docNameEl.textContent = fileName;
  pageCountEl.textContent = `${pdfDoc.numPages} page${pdfDoc.numPages > 1 ? 's' : ''}`;
  saveBtn.disabled = false;
  showEditor();
}

$('openBtn').onclick = $('homeOpen').onclick = () => fileInput.click();
$('libBtn').onclick = showHome;
fileInput.onchange = e => { if (e.target.files[0]) openFile(e.target.files[0]); fileInput.value = ''; };
['dragover', 'dragenter'].forEach(ev => viewer.addEventListener(ev, e => e.preventDefault()));
viewer.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && /pdf/i.test(f.type + f.name)) openFile(f); });

$('zoomIn').onclick = () => setZoom(scale + 0.25);
$('zoomOut').onclick = () => setZoom(scale - 0.25);
function setZoom(s) { scale = Math.min(3, Math.max(0.6, Math.round(s * 100) / 100)); zoomLabel.textContent = Math.round(scale * 100) + '%'; if (pdfDoc) renderAll(true); }

$('addBtn').onclick = () => { addMode = !addMode; $('addBtn').classList.toggle('active', addMode); };
$('boldBtn').onclick = () => toggleStyle('bold');
$('italicBtn').onclick = () => toggleStyle('italic');
$('ulBtn').onclick = () => toggleStyle('ul');
$('smallerBtn').onclick = () => bumpSize(-1);
$('biggerBtn').onclick = () => bumpSize(1);
$('delBtn').onclick = deleteFocused;
$('clearBtn').onclick = clearBox;

sizeInput.onchange = () => {
  const px = Math.min(120, Math.max(5, parseFloat(sizeInput.value) || 12));
  sizeInput.value = px;
  formatOp((box, collapsed) => {
    if (collapsed) { box.style.fontSize = px + 'px'; box.dataset.fontPx = px; }
    else applySizeToSel(box, px);
  });
};

fontSel.onchange = () => {
  formatOp((box, collapsed) => {
    const f = FONTS[fontSel.value] || FONTS.arial;
    if (collapsed) {
      box.style.fontFamily = f.css; box.dataset.fam = fontSel.value; box.dataset.exp = f.exp;
    } else {
      document.execCommand('fontName', false, f.css.split(',')[0].replace(/['"]/g, '').trim());
    }
  });
};

let colorBefore = null, hlBefore = null;
colorPick.addEventListener('input', () => {
  const box = targetBox();
  if (!box) return;
  if (!colorBefore) colorBefore = serialize();
  restoreSel(box);
  typeBefore = null;
  if (!selCollapsed(box)) { document.execCommand('foreColor', false, colorPick.value); normalizeBox(box); }
  else { box.style.color = colorPick.value; box.dataset.color = colorPick.value; }
  box.dataset.dirty = '1'; syncModel(box); markDirty();
});
colorPick.addEventListener('change', () => {
  if (colorBefore) { undoStack.push(colorBefore); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; colorBefore = null; updateUndoBtns(); }
  const box = targetBox(); if (box) box.focus();
});
hlPick.addEventListener('input', () => {
  const box = targetBox();
  if (!box) return;
  if (!hlBefore) hlBefore = serialize();
  restoreSel(box);
  typeBefore = null;
  if (!selCollapsed(box)) { document.execCommand('hiliteColor', false, hlPick.value); }
  else { box.style.background = hlPick.value; box.dataset.hl = hlPick.value; }
  box.dataset.dirty = '1'; syncModel(box); markDirty();
});
hlPick.addEventListener('change', () => {
  if (hlBefore) { undoStack.push(hlBefore); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; hlBefore = null; updateUndoBtns(); }
  const box = targetBox(); if (box) box.focus();
});

document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (!saveBtn.disabled) saveBtn.onclick(); return; }
  if (e.key === 'Escape') { addMode = false; $('addBtn').classList.remove('active'); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return; }
  if (mod && e.key.toLowerCase() === 'b' && focused) { e.preventDefault(); toggleStyle('bold'); }
  if (mod && e.key.toLowerCase() === 'i' && focused) { e.preventDefault(); toggleStyle('italic'); }
  if (mod && e.key.toLowerCase() === 'u' && focused) { e.preventDefault(); toggleStyle('ul'); }
  if (e.key === 'Delete' && focused && document.activeElement !== focused) deleteFocused();
});

function toggleStyle(kind) {
  formatOp((box, collapsed) => {
    if (!collapsed) {
      document.execCommand(kind === 'bold' ? 'bold' : kind === 'italic' ? 'italic' : 'underline', false, null);
      return;
    }
    const s = box.style;
    if (kind === 'bold') { const b = s.fontWeight === '700' || +s.fontWeight >= 600; s.fontWeight = b ? '400' : '700'; box.dataset.bold = b ? '' : '1'; }
    else if (kind === 'italic') { const it = s.fontStyle === 'italic'; s.fontStyle = it ? 'normal' : 'italic'; box.dataset.italic = it ? '' : '1'; }
    else { const u = s.textDecoration.includes('underline'); s.textDecoration = u ? '' : 'underline'; box.dataset.ul = u ? '' : '1'; }
  });
}
function bumpSize(d) {
  formatOp((box, collapsed) => {
    const px = Math.min(120, Math.max(5, Math.round(parseFloat(box.style.fontSize) || 12) + d));
    if (collapsed) { box.style.fontSize = px + 'px'; box.dataset.fontPx = px; }
    else applySizeToSel(box, px);
    sizeInput.value = px;
  });
}
function clearBox() {
  const box = targetBox();
  if (!box) return status('Click a text box first');
  const m = pageInfos.flatMap(p => p.models).find(m => m.id === box.dataset.id);
  if (!m) return;
  willChange();
  if (m.added) {
    box.style.fontWeight = '400'; box.dataset.bold = '';
    box.style.fontStyle = 'normal'; box.dataset.italic = '';
    box.style.textDecoration = ''; box.dataset.ul = '';
    box.style.background = ''; box.dataset.hl = '';
    box.style.color = '#000000'; box.dataset.color = '#000000';
    box.style.fontSize = '16px'; box.dataset.fontPx = 16;
    box.style.fontFamily = FONTS.arial.css; box.dataset.fam = 'arial'; box.dataset.exp = 'sans';
    box.innerHTML = box.innerText;
  } else {
    box.textContent = m.str; m.text = m.str;
    box.style.left = m.x + 'px'; box.style.top = m.yTop + 'px';
    box.style.fontSize = m.ofontPx + 'px'; box.dataset.fontPx = m.ofontPx; m.fontPx = m.ofontPx;
    box.style.fontWeight = m.obold ? '700' : '400'; box.dataset.bold = m.obold;
    box.style.fontStyle = m.oitalic ? 'italic' : 'normal'; box.dataset.italic = m.oitalic;
    box.style.textDecoration = ''; box.dataset.ul = '';
    box.style.background = ''; box.dataset.hl = '';
    const fnt = FONTS[m.ofam] || FONTS.arial;
    box.style.fontFamily = fnt.css; box.dataset.fam = m.ofam; box.dataset.exp = m.oexp;
    box.style.color = m.ocolor; box.dataset.color = m.ocolor;
    m.moved = false; m.deleted = false;
    box.dataset.deleted = ''; box.style.display = '';
  }
  box.dataset.dirty = '1';
  didChange();
  box.focus();
}
function deleteFocused() {
  const box = targetBox();
  if (!box) return;
  willChange();
  box.dataset.deleted = '1'; box.style.display = 'none';
  const m = pageInfos.flatMap(p => p.models).find(m => m.id === box.dataset.id); if (m) m.deleted = true;
  if (focused === box) focused = null;
  try { getSelection().removeAllRanges(); } catch (err) { }
  savedSel = null;
  didChange();
}

async function openFile(file) {
  fileName = file.name || 'document.pdf';
  currentId = 'd' + Date.now().toString(36);
  origBytes = await file.arrayBuffer();
  pdfDoc = await pdfjsLib.getDocument({ data: origBytes.slice(0) }).promise;
  resetDocState();
  await renderAll(false);
  undoStack = [serialize()]; updateUndoBtns();
  markClean();
  enterDoc();
  saveSession();
  status(`Loaded ${pdfDoc.numPages} page${pdfDoc.numPages > 1 ? 's' : ''} — click any text to edit`);
}

async function renderAll(keepEdits) {
  const keep = keepEdits ? serialize() : null;
  const byId = {};
  if (keep) keep.boxes.forEach(b => { byId[b.id] = b; });
  const f = keep ? scale / (keep.scale || scale) : 1;
  pagesEl.innerHTML = ''; pageInfos = [];
  for (let n = 1; n <= pdfDoc.numPages; n++) await renderPage(n, byId, f);
}

function buildBox(layer, pageNum, m, st) {
  const el = document.createElement('div');
  el.className = 'tbox' + (m.added ? ' added' : '');
  el.contentEditable = 'true'; el.spellcheck = false;
  el.dataset.id = m.id; el.dataset.page = pageNum;
  if (st.html != null) el.innerHTML = st.html; else el.innerText = st.text;
  el.style.left = st.left + 'px'; el.style.top = st.top + 'px';
  el.style.fontSize = st.fontPx + 'px';
  const fnt = FONTS[st.fam] || FONTS.arial;
  el.style.fontFamily = fnt.css; el.dataset.fam = st.fam || 'arial'; el.dataset.exp = st.exp || fnt.exp;
  el.style.color = st.color || '#000000'; el.dataset.color = st.color || '#000000';
  if (st.hl) { el.style.background = st.hl; el.dataset.hl = st.hl; }
  el.dataset.fontPx = st.fontPx;
  if (st.bold) { el.style.fontWeight = '700'; el.dataset.bold = '1'; }
  if (st.italic) { el.style.fontStyle = 'italic'; el.dataset.italic = '1'; }
  if (st.ul) { el.style.textDecoration = 'underline'; el.dataset.ul = '1'; }
  if (st.deleted) { el.dataset.deleted = '1'; el.style.display = 'none'; m.deleted = true; }
  attachBox(el, m);
  layer.appendChild(el);
  return el;
}

const cssPx = v => Math.round(v * 255).toString(16).padStart(2, '0');
function samplePageColors(ctx, canvas, boxes) {
  let img = null;
  try { img = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch (err) { return; }
  const dpr = canvas.width / parseFloat(canvas.style.width);
  const W = canvas.width, H = canvas.height, D = img.data;
  const at = (x, y) => {
    x = Math.max(0, Math.min(W - 1, Math.round(x))); y = Math.max(0, Math.min(H - 1, Math.round(y)));
    const o = (y * W + x) * 4;
    return [D[o], D[o + 1], D[o + 2]];
  };
  const med = arr => { arr.sort((a, b) => a - b); return arr.length ? arr[arr.length >> 1] : 128; };
  boxes.forEach(b => {
    const bx = Math.max(0, (b.left - 2) * dpr), by = Math.max(0, (b.top - 2) * dpr);
    const bw = (b.w + 4) * dpr, bh = (b.h + 4) * dpr;
    const rs = [[], [], []];
    for (let x = bx; x <= bx + bw; x += 3) {
      [[x, by], [x, by + bh]].forEach(([px, py]) => { const c = at(px, py); rs[0].push(c[0]); rs[1].push(c[1]); rs[2].push(c[2]); });
    }
    for (let y = by; y <= by + bh; y += 3) {
      [[bx, y], [bx + bw, y]].forEach(([px, py]) => { const c = at(px, py); rs[0].push(c[0]); rs[1].push(c[1]); rs[2].push(c[2]); });
    }
    const bg = [med(rs[0]), med(rs[1]), med(rs[2])];
    const fr = [[], [], []];
    for (let y = by + 2 * dpr; y < by + bh - dpr; y += 2.5 * dpr) {
      for (let x = bx + 2 * dpr; x < bx + bw - dpr; x += 2 * dpr) {
        const c = at(x, y);
        if (Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) > 60) { fr[0].push(c[0]); fr[1].push(c[1]); fr[2].push(c[2]); }
      }
    }
    if (fr[0].length > 5) b.fg = '#' + cssPx(med(fr[0]) / 255) + cssPx(med(fr[1]) / 255) + cssPx(med(fr[2]) / 255);
    b.bg = '#' + cssPx(bg[0] / 255) + cssPx(bg[1] / 255) + cssPx(bg[2] / 255);
    ctx.fillStyle = b.bg;
    ctx.fillRect((b.left - 1) * dpr, (b.top - 1) * dpr, (b.w + 2) * dpr, (b.h + 2) * dpr);
  });
}

async function renderPage(n, byId, f) {
  const page = await pdfDoc.getPage(n);
  const viewport = page.getViewport({ scale });
  const wrap = document.createElement('div');
  wrap.className = 'page'; wrap.style.width = viewport.width + 'px'; wrap.style.height = viewport.height + 'px';
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width * devicePixelRatio);
  canvas.height = Math.floor(viewport.height * devicePixelRatio);
  canvas.style.width = viewport.width + 'px'; canvas.style.height = viewport.height + 'px';
  wrap.appendChild(canvas);
  const layer = document.createElement('div');
  layer.className = 'text-layer'; wrap.appendChild(layer);
  pagesEl.appendChild(wrap);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport, transform: devicePixelRatio !== 1 ? [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0] : null }).promise;

  const tc = await page.getTextContent();
  const items = tc.items.filter(it => it.str && it.str.trim());
  const models = [];
  const samples = [];
  items.forEach((item, idx) => {
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const fontPx = Math.hypot(tx[2], tx[3]);
    if (fontPx < 2 || fontPx > 220) return;
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    const id = `p${n}i${idx}`;
    const yTop = y - fontPx * 0.92;
    const m = {
      id, str: item.str, fontName: item.fontName || '',
      pdfX: item.transform[4], pdfY: item.transform[5],
      pdfW: item.width, pdfH: item.height,
      fontPx, x, yTop, text: item.str,
      bold: isBold(item.fontName) ? '1' : '', italic: isItalic(item.fontName) ? '1' : ''
    };
    models.push(m);
    const estW = Math.max((item.width || 0) * scale, 6);
    samples.push({ left: x, top: yTop, w: estW, h: fontPx * 1.25, fg: null, bg: '#ffffff', m });
  });
  samplePageColors(ctx, canvas, samples);
  samples.forEach(s => {
    const m = s.m;
    const famKey = guessFontKey(m.fontName);
    m.ocolor = s.fg || '#000000'; m.ofam = famKey; m.oexp = FONTS[famKey].exp;
    m.obold = m.bold; m.oitalic = m.italic; m.ofontPx = m.fontPx;
    const k = byId[m.id];
    buildBox(layer, n, m, k ? {
      text: k.text, html: k.html, left: k.left * f, top: k.top * f, fontPx: k.fontPx * f,
      bold: k.bold, italic: k.italic, ul: k.ul, fam: k.fam, exp: k.exp, color: k.color, hl: k.hl, deleted: k.deleted
    } : {
      text: m.str, html: null, left: m.x, top: m.yTop, fontPx: m.fontPx,
      bold: m.bold, italic: m.italic, ul: '', fam: famKey, exp: FONTS[famKey].exp,
      color: m.ocolor, hl: '', deleted: ''
    });
    const kb = byId[m.id];
    if (kb && (kb.text !== m.str || kb.deleted)) { m.text = kb.text; m.deleted = !!kb.deleted; }
  });
  const info = { n, viewport, models, layer, pdfW: viewport.width / scale, pdfH: viewport.height / scale };
  pageInfos.push(info);
  addedModels.filter(a => a.pageNum === n).forEach(a => {
    if (a.gone) return;
    const k = byId[a.id];
    buildBox(layer, n, a, k ? {
      text: k.text, html: k.html, left: k.left * f, top: k.top * f, fontPx: k.fontPx * f,
      bold: k.bold, italic: k.italic, ul: k.ul, fam: k.fam, exp: k.exp, color: k.color, hl: k.hl, deleted: k.deleted
    } : { text: a.text, html: null, left: a.newLeft * f, top: a.newTop * f, fontPx: a.fontPx * f, bold: '', italic: '', ul: '', fam: 'arial', exp: 'sans', color: '#000000', hl: '', deleted: '' });
  });

  layer.addEventListener('dblclick', e => { if (e.target === layer) addBoxEl(layer, n, e.offsetX, e.offsetY, 'Type here', 12); });
  layer.addEventListener('click', e => {
    if (!addMode || e.target !== layer) return;
    addBoxEl(layer, n, e.offsetX, e.offsetY, 'Type here', 12); addMode = false; $('addBtn').classList.remove('active');
  });
}

function attachBox(el, model) {
  el.addEventListener('focus', () => {
    focused = el;
    typeBefore = serialize();
    if (el.dataset.fam && FONTS[el.dataset.fam]) fontSel.value = el.dataset.fam;
    colorPick.value = rgbToHex(el.dataset.color || '#000000');
    if (el.dataset.hl) hlPick.value = rgbToHex(el.dataset.hl);
    sizeInput.value = Math.round(parseFloat(el.style.fontSize) || 12);
    $('ulBtn').classList.toggle('active', !!el.dataset.ul);
  });
  el.addEventListener('blur', () => { typeBefore = null; if (nudging) { nudging = false; didChange(); } if (focused === el) focused = null; });
  el.addEventListener('input', () => {
    if (typeBefore) { undoStack.push(typeBefore); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; typeBefore = null; updateUndoBtns(); }
    model.text = el.innerText;
    model.dirty = el.innerText !== model.str;
    el.dataset.dirty = model.dirty ? '1' : '';
    markDirty();
  });
  let nudging = false;
  function onEdge(e) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return true;
    const t = Math.max(2, Math.min(4, Math.min(r.width, r.height) / 3));
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return x < t || y < t || r.width - x < t || r.height - y < t;
  }
  el.addEventListener('mousemove', e => {
    if (el.classList.contains('dragging')) return;
    const edge = onEdge(e);
    el.classList.toggle('edge', edge);
    el.style.cursor = edge ? 'move' : 'text';
  });
  el.addEventListener('mouseleave', () => { el.style.cursor = ''; el.classList.remove('edge'); });
  el.addEventListener('keydown', e => {
    if (!e.key.startsWith('Arrow')) return;
    e.preventDefault();
    willChange(); nudging = true;
    const d = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') el.style.left = (el.offsetLeft - d) + 'px';
    if (e.key === 'ArrowRight') el.style.left = (el.offsetLeft + d) + 'px';
    if (e.key === 'ArrowUp') el.style.top = (el.offsetTop - d) + 'px';
    if (e.key === 'ArrowDown') el.style.top = (el.offsetTop + d) + 'px';
    model.moved = true;
    if (model.added) { model.newLeft = parseFloat(el.style.left); model.newTop = parseFloat(el.style.top); }
    model.fontPx = parseFloat(el.style.fontSize);
    el.dataset.dirty = '1';
  });
  el.addEventListener('keyup', e => {
    if (nudging && e.key.startsWith('Arrow')) { nudging = false; didChange(); }
  });
  el.addEventListener('pointerdown', e => {
    if (e.target !== el || addMode) return;
    if (!onEdge(e)) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = el.offsetLeft, oy = el.offsetTop;
    let dragging = false;
    const mv = ev => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
      if (!dragging) { dragging = true; willChange(); el.classList.add('dragging'); el.blur(); try { el.setPointerCapture(e.pointerId); } catch (err) { } }
      el.style.left = ox + ev.clientX - sx + 'px';
      el.style.top = oy + ev.clientY - sy + 'px';
    };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      el.classList.remove('dragging'); el.classList.remove('edge');
      if (dragging) {
        model.moved = true;
        if (model.added) { model.newLeft = parseFloat(el.style.left); model.newTop = parseFloat(el.style.top); }
        model.fontPx = parseFloat(el.style.fontSize);
        el.dataset.dirty = '1';
        focused = el;
        didChange();
      }
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
}

function addBoxEl(layer, pageNum, x, y, text, fontPt) {
  willChange();
  const fontPx = fontPt * scale;
  const id = 'a' + (idSeq++);
  const m = { id, str: '', text, added: true, pageNum, fontPx, newLeft: x, newTop: y, x, yTop: y, bold: '', italic: '', gone: false };
  addedModels.push(m);
  const info = pageInfos.find(p => p.n === pageNum); if (info) info.models.push(m);
  const el = buildBox(layer, pageNum, m, { text, html: null, left: x, top: y, fontPx, bold: '', italic: '', ul: '', fam: fontSel.value || 'arial', exp: (FONTS[fontSel.value] || FONTS.arial).exp, color: colorPick.value || '#000000', hl: '', deleted: '' });
  didChange();
  el.focus();
  document.execCommand && document.execCommand('selectAll', false, null);
  return el;
}

function rgbToHex(c) {
  const m = /rgba?\(([^)]+)\)/.exec(c || '');
  if (m) {
    const p = m[1].split(',').map(v => parseFloat(v));
    const h = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + h(p[0]) + h(p[1]) + h(p[2]);
  }
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map(ch => ch + ch).join('');
  return '#000000';
}

function hexToPdf(c) {
  const h = rgbToHex(c);
  return { r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 };
}

$('saveBtn').onclick = async () => {
  try {
    status('Saving…');
    const pdf = await PDFLib.PDFDocument.load(origBytes.slice(0));
    const cache = {};
    async function getFont(cls, b, it) {
      const key = cls + (b ? 'B' : '') + (it ? 'I' : '');
      if (!cache[key]) {
        const S = PDFLib.StandardFonts;
        const name = cls === 'serif'
          ? (b && it ? S.TimesRomanBoldItalic : b ? S.TimesRomanBold : it ? S.TimesRomanItalic : S.TimesRoman)
          : cls === 'mono'
            ? (b && it ? S.CourierBoldOblique : b ? S.CourierBold : it ? S.CourierOblique : S.Courier)
            : (b && it ? S.HelveticaBoldOblique : b ? S.HelveticaBold : it ? S.HelveticaOblique : S.Helvetica);
        cache[key] = await pdf.embedFont(name);
      }
      return cache[key];
    }
    const elOf = m => document.querySelector(`[data-id="${m.id}"]`);

    for (let i = 0; i < pageInfos.length; i++) {
      const info = pageInfos[i];
      const pg = pdf.getPages()[i];
      const { height: PH } = pg.getSize();
      for (const m of info.models) {
        const el = elOf(m);
        if (!el || m.gone) continue;
        const cur = el.innerText;
        const px = parseFloat(el.style.fontSize) || m.fontPx;
        const pt = px / scale;
        if (m.added) {
          if (!cur.trim() || el.dataset.deleted) continue;
        } else {
          const changed = cur !== m.str || el.dataset.dirty || m.moved || el.dataset.deleted || el.dataset.hl || el.dataset.ul;
          if (!changed) continue;
          const w = Math.max(m.pdfW, 4), h = Math.max(m.pdfH, pt * 0.4);
          pg.drawRectangle({ x: m.pdfX, y: m.pdfY - h * 0.25, width: w + 2, height: h * 1.35, color: PDFLib.rgb(1, 1, 1) });
          if (el.dataset.deleted) continue;
        }
        const base = (m.added || m.moved)
          ? { x: parseFloat(el.style.left) / scale, y: PH - parseFloat(el.style.top) / scale - pt * 0.9 }
          : { x: m.pdfX, y: m.pdfY };
        const runs = runsOf(el);
        const lines = [[]];
        runs.forEach(r => {
          const parts = r.text.split('\n');
          parts.forEach((p, ix) => {
            if (ix > 0) lines.push([]);
            if (p) lines[lines.length - 1].push({ ...r, text: p });
          });
        });
        if (el.dataset.hl) {
          let maxW = 4;
          for (const segs of lines) for (const sg of segs) {
            const f0 = await getFont(sg.exp, sg.bold, sg.italic);
            try { maxW = Math.max(maxW, f0.widthOfTextAtSize(sg.text, (sg.size || px) / scale)); } catch (err) { }
          }
          const hc = hexToPdf(el.dataset.hl);
          pg.drawRectangle({ x: base.x - 1, y: base.y - pt * 0.3 - (lines.length - 1) * pt * 1.15, width: maxW + 2, height: lines.length * pt * 1.15 + pt * 0.15, color: PDFLib.rgb(hc.r, hc.g, hc.b) });
        }
        for (let j = 0; j < lines.length; j++) {
          const y = base.y - j * pt * 1.15;
          let x = base.x;
          for (const sg of lines[j]) {
            const spt = (sg.size || px) / scale;
            const f2 = await getFont(sg.exp, sg.bold, sg.italic);
            const cc2 = hexToPdf(sg.color);
            const col2 = PDFLib.rgb(cc2.r, cc2.g, cc2.b);
            let wseg = 0;
            try { wseg = f2.widthOfTextAtSize(sg.text, spt); } catch (err) { }
            if (sg.hl) {
              const hc = hexToPdf(sg.hl);
              pg.drawRectangle({ x: x - 0.5, y: y - spt * 0.3, width: wseg + 1, height: spt * 1.3, color: PDFLib.rgb(hc.r, hc.g, hc.b) });
            }
            if (sg.text) pg.drawText(sg.text, { x, y, size: spt, font: f2, color: col2 });
            if (sg.ul || el.dataset.ul) {
              const yy = y - Math.max(0.75, spt / 12);
              pg.drawLine({ start: { x, y: yy }, end: { x: x + wseg, y: yy }, thickness: Math.max(0.5, spt / 14), color: col2 });
            }
            x += wseg;
          }
        }
      }
    }

    const out = await pdf.save();
    const blob = new Blob([out], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName.replace(/\.pdf$/i, '') + '-edited.pdf';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    markClean();
    saveSession();
    status('Saved ✓');
  } catch (err) { console.error(err); status('Save failed: ' + err.message); }
};

showHome();
refreshRecent();
