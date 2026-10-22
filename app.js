/*
 * app.js — capa de interfaz (DOM). La lógica de negocio vive en core.js y paste.js:
 *   C.itemsToLines(pages)        texto del PDF -> líneas
 *   C.processLines(lines)        -> { parsed, blocks, warnings }
 *   C.validateBlocks(blocks)     -> issues [{ k, field, msg, suggestions }]
 *   C.buildRow(blocks, row, …)   fila completa (solo referencia)
 *   P.pasteInfo / P.blockTSV     celdas de entrada de cada bloque y texto a copiar
 */
import * as C from './core.js';
import * as P from './paste.js';
import { LISTS } from './data.js';

// pdf.js se carga bajo demanda (y se precarga en segundo plano) para que, si el CDN falla,
// el resto de la página siga funcionando y se muestre un error claro.
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
let pdfjsPromise = null;
function loadPdfjs() {
  pdfjsPromise ??= import(PDFJS + 'pdf.min.mjs').then(m => { m.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs'; return m; })
    .catch(e => { pdfjsPromise = null; throw new Error('no se pudo cargar pdf.js desde el CDN (' + e.message + '). Revisa tu conexión.'); });
  return pdfjsPromise;
}
(window.requestIdleCallback || setTimeout)(() => loadPdfjs().catch(() => {}));

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const EMPTY = () => ({ select: '', producto: '', capacidad: '', inhab: '', serie: '' });
const FIELDS = P.FIELDS;

// localStorage puede no estar disponible (modo privado, archivo local con restricciones): nunca debe romper la app.
const store = {
  get(k, d) { try { const v = localStorage.getItem('incisoE.' + k); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('incisoE.' + k, v); } catch { /* sin almacenamiento */ } },
};

/** Estado: bloques editables, advertencias del parseo y progreso del copiado. */
const state = { blocks: [], warnings: [], parsed: null, fileName: '' };
const copied = new WeakMap(); // bloque -> { k, row, sig } en el momento de copiarlo
let lastK = 0;                // último bloque copiado (1-based), para saber cuál sigue
let issues = [];

// Listas de validación de la hoja -> <datalist> para autocompletar.
for (const [k, list] of Object.entries(LISTS)) {
  const dl = $('#dl-' + k); if (dl) dl.innerHTML = [...new Set(list.filter(Boolean))].map(v => `<option value="${esc(v)}">`).join('');
}

// ---------- Fila destino ----------
const rowEl = $('#row');
rowEl.value = store.get('row', '');
/** Fila destino como entero ≥ 3, o null si no es válida. */
function targetRow() {
  const v = rowEl.value.trim();
  if (!/^\d+$/.test(v)) return null;
  const n = parseInt(v, 10); return n >= 3 ? n : null;
}
rowEl.addEventListener('input', () => {
  rowEl.value = rowEl.value.replace(/[^\d]/g, '');
  store.set('row', rowEl.value);
  lastK = 0; // otra fila: el modo guiado vuelve a empezar desde el primer bloque sin copiar
  rowEl.closest('.row-panel').classList.toggle('need', !targetRow() && state.blocks.length > 0);
  refresh();
});
rowEl.addEventListener('keydown', e => { if (e.key === 'Enter' && targetRow()) { e.preventDefault(); $('#next').focus(); } });
function needRow() {
  const p = rowEl.closest('.row-panel'); p.classList.add('need'); p.classList.remove('shake'); void p.offsetWidth; p.classList.add('shake');
  rowEl.focus(); rowEl.select();
  toast('Escribe primero la fila destino.', 'err');
}

// ---------- Preferencias ----------
const guardEl = $('#guard');
guardEl.checked = store.get('guard', '1') === '1';
guardEl.addEventListener('change', () => { store.set('guard', guardEl.checked ? '1' : '0'); refresh(); });
$('#fillAll').addEventListener('change', renderFullRow);

// ---------- Carga del PDF ----------
const fileEl = $('#file'), drop = $('#drop');
fileEl.addEventListener('change', () => { const f = fileEl.files[0]; fileEl.value = ''; if (f) handleFile(f); }); // value='' permite recargar el mismo archivo
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileEl.click(); } });
$('#changeFile').addEventListener('click', () => fileEl.click());

// Soltar un PDF en cualquier parte de la ventana. El contador evita el parpadeo de dragleave sobre elementos hijos.
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragover', e => { e.preventDefault(); });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
window.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
  const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f);
});

/** Fragmentos de texto con posición de cada página (formato que espera C.itemsToLines). */
async function extractPages(data) {
  const pdfjsLib = await loadPdfjs();
  const doc = await pdfjsLib.getDocument({ data }).promise;
  try {
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const pg = await doc.getPage(p); const vp = pg.getViewport({ scale: 1 }); const tc = await pg.getTextContent();
      pages.push({ height: vp.height, items: tc.items.filter(i => 'str' in i).map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: i.height })) });
    }
    return pages;
  } finally {
    doc.destroy(); // libera el worker y la memoria: la página se usa muchas veces seguidas sin recargar
  }
}

/** Estado de carga: en la zona de arrastre o, si ya hay un checklist en pantalla, como aviso flotante. */
function setDrop(title, sub, cls = '') {
  $('#dropTitle').textContent = title; $('#dropSub').textContent = sub;
  drop.className = 'dropzone ' + cls;
  if (state.blocks.length && cls) toast(`${title}. ${sub}`, cls === 'is-error' ? 'err' : '');
}

async function handleFile(f) {
  if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
    setDrop(`«${f.name}» no es un PDF`, 'Elige el checklist en PDF.', 'is-error'); return;
  }
  setDrop('Leyendo ' + f.name + '…', 'Un momento.', 'is-busy');
  delete document.body.dataset.parsed;
  try {
    const pages = await extractPages(new Uint8Array(await f.arrayBuffer()));
    const lines = C.itemsToLines(pages);
    const r = C.processLines(lines);
    if (!lines.length) r.warnings.unshift('El PDF no contiene texto seleccionable (¿es un escaneo?). No se pudo leer nada; captura los bloques a mano.');
    Object.assign(state, { blocks: r.blocks, warnings: r.warnings, parsed: r.parsed, fileName: f.name });
    lastK = 0; delete $('#warnBox').dataset.seen;
    setDrop('Arrastra aquí el checklist en PDF', 'o haz clic para elegirlo');
    if ($('#toast').textContent.startsWith('Leyendo')) $('#toast').classList.remove('show');
    renderFile();
    $('#empty').hidden = true; $('#work').hidden = false; $('#filePanel').hidden = false; $('#guide').hidden = false;
    document.body.dataset.parsed = '1'; // usado por las pruebas automáticas
    renderList();
    // Confirmar la fila destino en cada checklist nuevo: la recordada es de otro registro.
    rowEl.focus(); rowEl.select();
    if (!targetRow()) rowEl.closest('.row-panel').classList.add('need');
  } catch (e) {
    console.error(e);
    const msg = /password/i.test(e?.name + e?.message) ? 'El PDF está protegido con contraseña.' : e.message;
    setDrop('No se pudo leer el PDF', msg, 'is-error');
  }
}
function renderFile() {
  const p = state.parsed, mang = state.blocks.filter(b => b.kind === 'manguera');
  $('#fileName').textContent = state.fileName;
  $('#fileMeta').innerHTML = [['OT', p.ot], ['Cliente', p.cliente], ['Permiso', p.permiso]]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v || 'no encontrado')}</dd></div>`).join('');
  const nd = new Set(mang.map(b => b.select)).size;
  $('#fileCounts').textContent = `${p.tanques.length} ${p.tanques.length === 1 ? 'tanque' : 'tanques'}, ${mang.length} ${mang.length === 1 ? 'manguera' : 'mangueras'} en ${nd} ${nd === 1 ? 'dispensario' : 'dispensarios'}`;
}

// ---------- Descripción de cada bloque ----------
function kindOf(b) {
  const s = norm(b.select);
  if (s.startsWith('tanque')) return 'tanque'; if (s.startsWith('dispensario')) return 'manguera';
  if (s.startsWith('consola')) return 'consola'; if (s.startsWith('sistema')) return 'sistema';
  return P.isEmptyBlock(b) ? 'vacio' : 'otro';
}
function describe(b) {
  const t = s => String(s ?? '').trim();
  switch (kindOf(b)) {
    case 'tanque': return { title: t(b.select), sub: [t(b.producto), t(b.capacidad)].filter(Boolean).join(', ') };
    case 'manguera': return { title: t(b.capacidad) || 'Manguera', sub: [t(b.select), t(b.producto)].filter(Boolean).join(', ') };
    case 'consola': return { title: 'Consola', sub: t(b.capacidad) };
    case 'sistema': return { title: 'Sistema informático', sub: t(b.capacidad) };
    case 'vacio': return { title: 'Vacío', sub: 'Separador, no se pega' };
    default: return { title: 'Bloque libre', sub: t(b.select) };
  }
}
/** Grupo visual: los vacíos pertenecen al grupo anterior (el separador tras cada tanque). */
function groupsOf(blocks) {
  let prev = '';
  return blocks.map(b => {
    const k = kindOf(b);
    const g = k === 'tanque' ? 'Tanques' : k === 'manguera' ? String(b.select).trim() : (k === 'consola' || k === 'sistema') ? 'Telemedición y sistema informático' : k === 'otro' ? 'Otros' : prev;
    prev = g || prev; return g;
  });
}
const label = (b, k) => `E${k}, ${describe(b).title}`;

// ---------- Lista de bloques ----------
/** Lista de validación (id de <datalist>) para el campo f del bloque k; mismas columnas que C.listFor. */
function dlFor(k, f) {
  if (f === 'producto') return 'dl-producto'; if (f === 'inhab') return 'dl-inhab';
  if (f === 'select') return k <= 3 ? 'dl-selC' : 'dl-sel';
  if (f === 'capacidad') return k === 1 ? 'dl-capE' : k === 3 ? 'dl-capK' : 'dl-cap';
  return '';
}
const FIELD_NAME = { select: 'Selección', producto: 'Producto', capacidad: 'Capacidad / equipo', inhab: 'Inhabilitado', serie: 'Serie / versión' };

const listEl = $('#blocks');
/** Reconstruye la lista. Solo para cambios estructurales (nuevo PDF, mover/insertar/borrar). */
function renderList() {
  listEl.innerHTML = '';
  state.blocks.forEach((b, i) => {
    const k = i + 1, L = C.blockLayout(k);
    const li = document.createElement('li'); li.className = 'blk'; li.dataset.i = i;
    const cells = FIELDS.map(f => {
      const col = L[f] != null ? C.colLetter(L[f]) : '';
      const dis = !col && !b[f];
      const dl = dlFor(k, f);
      return `<label class="cell${col ? '' : ' nocol'}" data-f="${f}"><span class="col" aria-hidden="true">${col || '–'}</span>` +
        `<input data-f="${f}" value="${esc(b[f] || '')}"${dl ? ` list="${dl}"` : ''}${dis ? ' disabled' : ''} aria-label="E${k} ${FIELD_NAME[f]}${col ? ', columna ' + col : ', sin columna en este bloque'}" spellcheck="false" autocomplete="off"></label>`;
    }).join('');
    li.innerHTML = `<span class="st" aria-hidden="true"></span><span class="bid">E${k}</span>` +
      `<div class="what"><b></b><small></small></div><div class="cells">${cells}</div><div class="go"></div>` +
      `<div class="tools" role="group" aria-label="Ordenar E${k}">` +
      `<button type="button" data-a="up" title="Subir" aria-label="Subir E${k}"${i ? '' : ' disabled'}>↑</button>` +
      `<button type="button" data-a="down" title="Bajar" aria-label="Bajar E${k}"${i < state.blocks.length - 1 ? '' : ' disabled'}>↓</button>` +
      `<button type="button" data-a="ins" title="Insertar bloque vacío debajo" aria-label="Insertar bloque vacío debajo de E${k}">+</button>` +
      `<button type="button" data-a="del" title="Eliminar bloque" aria-label="Eliminar E${k}">×</button></div>`;
    listEl.appendChild(li);
  });
  refresh();
}

// Edición: 'input' actualiza al teclear sin reconstruir la lista (no se pierde el foco).
listEl.addEventListener('input', e => {
  const inp = e.target.closest('input[data-f]'); if (!inp) return;
  const i = +inp.closest('.blk').dataset.i;
  state.blocks[i][inp.dataset.f] = inp.value;
  refresh();
});
listEl.addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.matches('input')) e.target.blur(); });
listEl.addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  const i = +btn.closest('.blk').dataset.i, B = state.blocks;
  if (btn.dataset.copy != null) { copyBlock(i); return; }
  const a = btn.dataset.a; if (!a) return;
  if (a === 'up' && i > 0) [B[i - 1], B[i]] = [B[i], B[i - 1]];
  if (a === 'down' && i < B.length - 1) [B[i + 1], B[i]] = [B[i], B[i + 1]];
  if (a === 'ins') B.splice(i + 1, 0, EMPTY());
  if (a === 'del') { if (!P.isEmptyBlock(B[i]) && !confirm(`¿Eliminar ${label(B[i], i + 1)}? Los bloques siguientes se recorren una posición.`)) return; B.splice(i, 1); }
  renderList();
  const again = listEl.querySelector(`.blk[data-i="${a === 'up' ? i - 1 : a === 'down' ? i + 1 : a === 'ins' ? i + 1 : Math.min(i, B.length - 1)}"] [data-a="${a === 'del' ? 'ins' : a}"]`);
  again?.focus();
});
$('#addBlock').addEventListener('click', () => {
  state.blocks.push(EMPTY()); renderList();
  listEl.lastElementChild?.querySelector('input:not([disabled])')?.focus();
});

// ---------- Progreso ----------
const sig = b => FIELDS.map(f => b[f] ?? '').join('\u0001') + (guardEl.checked ? '|g' : '');
/** Copiado vigente: misma posición, misma fila destino y mismos valores que cuando se copió. */
function isDone(b, k, row) { const c = copied.get(b); return !!c && c.k === k && c.row === row && c.sig === sig(b); }
function infos(row) { return state.blocks.map((b, i) => ({ ...P.pasteInfo(b, i + 1, row), i, b, done: isDone(b, i + 1, row) })); }
/** Siguiente bloque a copiar: el primero sin copiar después del último copiado; si no hay, desde el inicio. */
function nextInfo(list) {
  const todo = list.filter(x => x.pasteable && !x.done);
  return todo.find(x => x.k > lastK) || todo[0] || null;
}

// ---------- Refresco (valores, validación, progreso) ----------
function refresh() {
  if (!state.blocks.length) return;
  const row = targetRow();
  issues = C.validateBlocks(state.blocks);
  const list = infos(row), nx = nextInfo(list), groups = groupsOf(state.blocks);
  const rows = listEl.children;
  list.forEach((x, i) => {
    const li = rows[i]; if (!li) return;
    const d = describe(x.b), kind = kindOf(x.b);
    li.className = `blk k-${kind}` + (x.pasteable ? '' : ' skip') + (x.done ? ' done' : '') + (nx && nx.i === i ? ' next' : '') + (x.k > C.MAX_BLOCKS ? ' over' : '');
    li.classList.toggle('grp-start', i === 0 || groups[i] !== groups[i - 1]);
    li.dataset.group = groups[i] || '';
    li.querySelector('.what b').textContent = d.title;
    li.querySelector('.what small').textContent = d.sub;
    li.querySelector('.st').textContent = x.done ? '✓' : '';
    // Celdas: marca de validación y de "se pegará como texto"
    let rowIssue = false;
    li.querySelectorAll('input[data-f]').forEach(inp => {
      const f = inp.dataset.f, iss = issues.find(z => z.k === x.k && z.field === f);
      const guarded = guardEl.checked && x.fields.includes(f) && P.isRisky(inp.value);
      const soft = iss && guarded && f === 'serie'; // el apóstrofo ya evita el problema de la serie
      inp.classList.toggle('bad', !!iss && !soft);
      inp.classList.toggle('txt', guarded);
      inp.title = iss ? iss.msg + (iss.suggestions?.length ? '\nSugerencias: ' + iss.suggestions.join(' / ') : '') + (soft ? '\nSe pegará como texto (con apóstrofo), así se conserva tal cual.' : '')
        : guarded ? 'Se pegará como texto (con apóstrofo inicial) para que Sheets no lo convierta.' : '';
      if (iss && !soft) rowIssue = true;
    });
    li.classList.toggle('has-issue', rowIssue);
    // Destino
    const go = li.querySelector('.go');
    if (x.pasteable) {
      const cell = row ? x.cell : x.first + '…';
      go.innerHTML = `<span class="target" title="${row ? 'Celdas ' + esc(x.range) : 'Falta la fila destino'}">${esc(cell)}</span>` +
        `<button type="button" class="copy" data-copy aria-label="Copiar ${esc(label(x.b, x.k))}">${x.done ? 'Copiado' : 'Copiar'}</button>`;
    } else {
      go.innerHTML = `<span class="skipnote">${x.reason === 'fuera' ? 'Fuera de E100, no cabe' : x.reason === 'sincol' ? 'Sin columnas para estos datos' : 'Vacío, no se pega'}</span>`;
    }
  });
  renderStrip(list, nx, row);
  renderGuide(list, nx, row);
  renderWarnings();
  renderFullRow();
}

// Franja de columnas de la fila: cada bloque = celdas de entrada + RESULTADO protegida.
function renderStrip(list, nx, row) {
  const strip = $('#strip');
  const n = Math.min(Math.max(list.length, 1), C.MAX_BLOCKS);
  const lastCol = C.blockLayout(n).result, total = lastCol - 2;
  $('#stripRow').textContent = row ?? '—';
  $('#stripFirst').textContent = 'C'; $('#stripLast').textContent = C.colLetter(lastCol);
  let html = '';
  for (let k = 1; k <= n; k++) {
    const x = list[k - 1] || { pasteable: false, k, done: false, i: k - 1 };
    const L = C.blockLayout(k), inputs = P.inputFields(k).length;
    const cls = ['seg', x.pasteable ? 'in' : 'off', x.done ? 'done' : '', nx && nx.k === k ? 'next' : ''].join(' ');
    html += `<div class="${cls}" style="flex:${L.result - (k === 1 ? 2 : C.blockLayout(k - 1).result)}" data-i="${k - 1}" title="E${k} ${C.colLetter(L.select ?? L.serie)}–${C.colLetter(L.result - 1)}">` +
      `<i class="ins" style="flex:${inputs}"></i><i class="lock"></i></div>`;
  }
  strip.innerHTML = html;
  if (nx && row && nx.k <= n) {
    const firstCol = C.blockLayout(nx.k).result - P.inputFields(nx.k).length; // primera celda de entrada del siguiente
    strip.insertAdjacentHTML('beforeend', `<span class="pin" style="left:${((firstCol - 3) / total * 100).toFixed(2)}%">${esc(nx.cell)}</span>`);
  }
}
$('#strip').addEventListener('click', e => {
  const seg = e.target.closest('.seg'); if (!seg) return;
  const li = listEl.children[+seg.dataset.i]; if (!li) return;
  li.scrollIntoView({ block: 'center', behavior: 'smooth' }); flash(li);
});

// ---------- Modo guiado ----------
const guide = $('#guide');
function renderGuide(list, nx, row) {
  const todo = list.filter(x => x.pasteable), done = todo.filter(x => x.done).length;
  const last = lastK ? list[lastK - 1] : null;
  const lastValid = last && last.done;
  $('#gCount').textContent = `${done} de ${todo.length}`;
  const bar = $('#gBar'); bar.setAttribute('aria-valuemax', todo.length); bar.setAttribute('aria-valuenow', done);
  bar.firstElementChild.style.width = (todo.length ? done / todo.length * 100 : 0) + '%';
  $('#restart').disabled = !done;
  $('#again').disabled = !lastValid;
  const next = $('#next');
  let st;
  if (!row) {
    st = 'norow';
    set('Escribe la fila destino', '—', 'Sin fila no se puede saber dónde pegar.');
    next.disabled = false; $('#nextLabel').textContent = 'Copiar siguiente'; $('#nextSub').textContent = 'Falta la fila destino';
  } else if (!todo.length) {
    st = 'off'; set('No hay bloques para pegar', '—', ''); next.disabled = true; $('#nextSub').textContent = '';
  } else if (!nx) {
    st = 'complete';
    set(lastValid ? `${label(last.b, last.k)} está en el portapapeles` : `Fila ${row} completa`, lastValid ? last.cell : '✓', lastValid ? `Pégalo en ${last.cell}. Es el último: la fila ${row} queda completa.` : `Los ${todo.length} bloques ya se copiaron.`);
    next.disabled = true; $('#nextLabel').textContent = 'Todo copiado'; $('#nextSub').textContent = `${todo.length} de ${todo.length}`;
  } else if (lastValid) {
    st = 'pasting';
    set(`${label(last.b, last.k)} está en el portapapeles. Pégalo en`, last.cell, `Después: ${label(nx.b, nx.k)}, en ${nx.cell}`);
    next.disabled = false; $('#nextLabel').textContent = `Copiar siguiente, E${nx.k}`; $('#nextSub').textContent = `${describe(nx.b).title}, se pega en ${nx.cell}`;
  } else {
    st = 'ready';
    set(`Primero: ${label(nx.b, nx.k)}. Al copiarlo, pégalo en`, nx.cell, describe(nx.b).sub);
    next.disabled = false; $('#nextLabel').textContent = `Copiar E${nx.k}`; $('#nextSub').textContent = `${describe(nx.b).title}, se pega en ${nx.cell}`;
  }
  if (guide.dataset.state !== st || guide.dataset.cell !== $('#gCell').textContent) {
    guide.dataset.state = st; guide.dataset.cell = $('#gCell').textContent;
    const c = $('#gCell'); c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
  }
  function set(kicker, cell, what) { $('#gKicker').textContent = kicker; $('#gCell').textContent = cell; $('#gWhat').textContent = what; }
}

async function copyNext() {
  if (!state.blocks.length) return;
  const row = targetRow(); if (!row) { needRow(); return; }
  const nx = nextInfo(infos(row)); if (!nx) { toast(`La fila ${row} ya está completa. Usa «Reiniciar» para empezar de nuevo.`); return; }
  await copyBlock(nx.i);
}
async function copyAgain() {
  const row = targetRow(); if (!row || !lastK) return;
  const b = state.blocks[lastK - 1]; if (b && isDone(b, lastK, row)) await copyBlock(lastK - 1);
}
$('#next').addEventListener('click', copyNext);
$('#again').addEventListener('click', copyAgain);
$('#restart').addEventListener('click', () => {
  state.blocks.forEach(b => copied.delete(b)); lastK = 0; refresh();
  toast('Progreso reiniciado.'); listEl.firstElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});

let copying = false;
async function copyBlock(i) {
  if (copying) return; // evita dobles copias por tecla mantenida
  const row = targetRow(); if (!row) { needRow(); return; }
  const b = state.blocks[i], k = i + 1, x = P.pasteInfo(b, k, row);
  if (!x.pasteable) return;
  copying = true;
  try {
    const text = P.blockTSV(b, k, { guard: guardEl.checked });
    const ok = await P.copyText(text);
    copied.set(b, { k, row, sig: sig(b) }); lastK = k;
    refresh();
    const li = listEl.children[i]; flash(li);
    if (ok) toast(`${label(b, k)} copiado. Pégalo en ${x.cell}.`, 'ok');
    else openManual(text, x.cell);
    // Deja visible el siguiente bloque sin mover la vista si ya se ve.
    const nx = nextInfo(infos(row));
    (nx ? listEl.children[nx.i] : li)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } finally { copying = false; }
}

// Atajos: Espacio o N = copiar siguiente, R = volver a copiar. No actúan mientras se escribe en un campo.
const typing = t => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable], dialog');
const isNextKey = e => (e.key === ' ' || e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey;
document.addEventListener('keydown', e => {
  if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (isNextKey(e)) { e.preventDefault(); if (!e.repeat) copyNext(); }
  else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); if (!e.repeat) copyAgain(); }
});
// Espacio sobre un botón con foco lo "pulsaría" al soltar la tecla: se cancela para no copiar dos veces.
document.addEventListener('keyup', e => { if (e.key === ' ' && !typing(e.target)) e.preventDefault(); });

// ---------- Advertencias ----------
function renderWarnings() {
  const g = guardEl.checked;
  const list = [
    ...state.warnings.map(w => ({ text: w, info: w.startsWith('ℹ') })),
    ...issues.map(x => {
      const soft = g && x.field === 'serie' && P.isRisky(x.value);
      return { text: x.msg + (x.suggestions?.length ? ' Sugerencias: ' + x.suggestions.join(' / ') + '.' : '') + (soft ? ' Se pegará como texto (con apóstrofo), así se conserva tal cual.' : ''), info: soft };
    }),
  ];
  const box = $('#warnBox'), serious = list.filter(w => !w.info).length;
  box.hidden = !list.length;
  box.classList.toggle('only-info', !serious);
  $('#warnSummary').textContent = serious ? `Revisa ${serious} ${serious === 1 ? 'aviso' : 'avisos'} antes de copiar` + (list.length > serious ? ` (y ${list.length - serious} ${list.length - serious === 1 ? 'nota' : 'notas'})` : '')
    : `${list.length} ${list.length === 1 ? 'nota' : 'notas'} del checklist`;
  const html = list.map(w => `<li class="${w.info ? 'info' : 'warn'}">${esc(w.text.replace(/^ℹ️?\s*/, ''))}</li>`).join('');
  if ($('#warnings').innerHTML !== html) $('#warnings').innerHTML = html;
  if (serious && !box.dataset.seen) { box.open = true; box.dataset.seen = '1'; }
}

// ---------- Fila completa (referencia) ----------
function renderFullRow() {
  const row = targetRow(), t = $('#tsv');
  t.value = row && state.blocks.length ? C.buildRow(state.blocks, row, { fillAll: $('#fillAll').checked }).tsv : '';
  t.placeholder = row ? '' : 'Escribe la fila destino para generar la fila completa.';
}
$('#copyRow').addEventListener('click', async () => {
  const t = $('#tsv'); if (!t.value) { needRow(); return; }
  if (await P.copyText(t.value)) toast('Fila completa copiada (solo referencia: no se puede pegar entera en «Inciso E»).', 'ok');
  else openManual(t.value, 'donde la necesites');
});

// ---------- Copia manual (último recurso) ----------
const dlg = $('#manual');
function openManual(text, cell) {
  $('#toast').classList.remove('show'); // el aviso anterior no aplica a esta copia
  $('#manualText').value = text; $('#manualCell').textContent = cell;
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  selectManual();
}
function selectManual() { const t = $('#manualText'); t.focus(); t.select(); t.setSelectionRange(0, t.value.length); }
$('#manualSelect').addEventListener('click', selectManual);
$('#manualClose').addEventListener('click', () => { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); $('#next').focus(); });

// ---------- Microinteracciones ----------
let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show ' + kind;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
function flash(el) { if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }

window.__incisoE = { state, C, P, copyNext }; // depuración / pruebas
