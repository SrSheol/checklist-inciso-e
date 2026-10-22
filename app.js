/*
 * app.js — capa de interfaz (DOM). Toda la lógica de negocio vive en core.js:
 *   C.itemsToLines(pages)      texto del PDF -> líneas
 *   C.processLines(lines)      -> { parsed, blocks, warnings }
 *   C.validateBlocks(blocks)   -> issues [{ k, field, msg, suggestions }]
 *   C.buildRow(blocks, row, { fillAll }) -> { cells, lastCol, tsv }
 * Un rediseño puede reemplazar este archivo, index.html y style.css libremente
 * mientras siga llamando a esas funciones; core.js y data.js no dependen del DOM.
 */
import * as C from './core.js';
import { LISTS } from './data.js';

// pdf.js se carga bajo demanda (import dinámico) para que, si el CDN falla,
// el resto de la página siga funcionando y se muestre un error claro.
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
let pdfjsPromise = null;
function loadPdfjs() {
  pdfjsPromise ??= import(PDFJS + 'pdf.min.mjs').then(m => { m.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs'; return m; })
    .catch(e => { pdfjsPromise = null; throw new Error('no se pudo cargar pdf.js desde el CDN (' + e.message + '). Revisa tu conexión.'); });
  return pdfjsPromise;
}

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const EMPTY = () => ({ select: '', producto: '', capacidad: '', inhab: '', serie: '' });
const FIELDS = ['select', 'producto', 'capacidad', 'inhab', 'serie'];

/** Estado de la app: bloques editables + advertencias del parseo. */
const state = { blocks: [], warnings: [], parsed: null, fileName: '' };
let current = null; // última fila construida (buildRow) o null si falta la fila destino

// Listas de validación de la hoja -> <datalist> para autocompletar.
for (const [k, list] of Object.entries(LISTS)) {
  const dl = $('#dl-' + k); if (dl) dl.innerHTML = list.filter(Boolean).map(v => `<option value="${esc(v)}">`).join('');
}

// ---------- Fila destino ----------
const rowEl = $('#row');
rowEl.value = localStorage.getItem('incisoE.row') || '';
/** Devuelve la fila destino como entero ≥ 3, o null si no es válida. */
function targetRow() {
  const v = rowEl.value.trim();
  if (!/^\d+$/.test(v)) return null;
  const n = parseInt(v, 10); return n >= 3 ? n : null;
}
rowEl.addEventListener('input', () => { localStorage.setItem('incisoE.row', rowEl.value); if (targetRow()) rowEl.classList.remove('need'); updateOutput(); });
$('#fillAll').addEventListener('change', updateOutput);

// ---------- Carga del PDF ----------
const drop = $('#drop'), fileEl = $('#file');
fileEl.addEventListener('change', () => { const f = fileEl.files[0]; fileEl.value = ''; if (f) handleFile(f); }); // value='' permite recargar el mismo archivo
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileEl.click(); } });
['dragenter', 'dragover'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', ev => { const f = ev.dataTransfer.files[0]; if (f) handleFile(f); });
// Evita que soltar un archivo fuera de la zona abra el PDF en la pestaña (y se pierda el trabajo).
window.addEventListener('dragover', e => e.preventDefault()); window.addEventListener('drop', e => e.preventDefault());

/** Extrae los fragmentos de texto con posición de cada página (mismo formato que pdfnode.mjs). */
async function extractPages(data) {
  const pdfjsLib = await loadPdfjs();
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p); const vp = pg.getViewport({ scale: 1 }); const tc = await pg.getTextContent();
    pages.push({ height: vp.height, items: tc.items.filter(i => 'str' in i).map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: i.height })) });
  }
  return pages;
}

async function handleFile(f) {
  const dropText = $('#dropText');
  if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { dropText.textContent = '✖ "' + f.name + '" no es un PDF. Elige el checklist en PDF.'; return; }
  dropText.textContent = 'Procesando ' + f.name + '…';
  delete document.body.dataset.parsed;
  try {
    const pages = await extractPages(new Uint8Array(await f.arrayBuffer()));
    const lines = C.itemsToLines(pages);
    const r = C.processLines(lines);
    if (!lines.length) r.warnings.unshift('El PDF no contiene texto seleccionable (¿es un escaneo?). No se pudo leer nada; captura los bloques a mano.');
    Object.assign(state, { blocks: r.blocks, warnings: r.warnings, parsed: r.parsed, fileName: f.name });
    const p = r.parsed, mang = r.blocks.filter(b => b.kind === 'manguera');
    $('#meta').hidden = false;
    $('#meta').innerHTML = `<b>OT:</b> ${esc(p.ot || '¿?')} &nbsp; <b>Cliente:</b> ${esc(p.cliente || '¿?')} &nbsp; <b>Permiso:</b> ${esc(p.permiso || '¿?')}<br>` +
      `${p.tanques.length} tanque(s), ${mang.length} manguera(s) en ${new Set(mang.map(b => b.select)).size} dispensario(s).`;
    dropText.textContent = '✔ ' + f.name + ' (clic o arrastra otro PDF para reemplazar)';
    document.body.dataset.parsed = '1'; // usado por las pruebas automáticas
    renderAll();
    if (!targetRow()) { rowEl.classList.add('need'); rowEl.focus(); }
  } catch (e) {
    console.error(e);
    dropText.textContent = '✖ No se pudo leer el PDF: ' + e.message;
  }
}

// ---------- Tabla editable ----------
/** Lista de validación (id de <datalist>) para el campo f del bloque k; mismas columnas que C.listFor. */
function dlFor(k, f) {
  if (f === 'producto') return 'dl-producto'; if (f === 'inhab') return 'dl-inhab';
  if (f === 'select') return k <= 3 ? 'dl-selC' : 'dl-sel';
  if (f === 'capacidad') return k === 1 ? 'dl-capE' : k === 3 ? 'dl-capK' : 'dl-cap';
  return '';
}
/** Tipo visual del bloque según su selección (para el color de la fila). */
function kindOf(b) {
  const s = (b.select || '').toLowerCase();
  if (s.startsWith('tanque')) return 'tanque'; if (s.startsWith('dispensario')) return 'manguera';
  if (s.startsWith('consola')) return 'consola'; if (s.startsWith('sistema')) return 'sistema';
  return FIELDS.some(f => b[f]) ? 'otro' : 'vacio';
}

/** Reconstruye la tabla completa. Solo para cambios estructurales (nuevo PDF, mover/insertar/borrar). */
function renderTable() {
  const tb = $('#preview tbody'); tb.innerHTML = '';
  state.blocks.forEach((b, i) => {
    const k = i + 1, L = C.blockLayout(k);
    const tr = document.createElement('tr'); tr.className = 'k-' + kindOf(b);
    tr.innerHTML = `<td><b>E${k}</b>${k > C.MAX_BLOCKS ? ' ⚠' : ''}</td><td class="cols">${[L.select || L.serie, L.result].map(C.colLetter).join('–')}</td>`;
    for (const f of FIELDS) {
      const td = document.createElement('td'); const inp = document.createElement('input');
      inp.value = b[f] || ''; inp.disabled = L[f] == null && !b[f]; inp.dataset.i = i; inp.dataset.f = f;
      const dl = dlFor(k, f); if (dl) inp.setAttribute('list', dl);
      // 'input' (no 'change'): actualiza la salida al teclear sin reconstruir la tabla, así no se pierde el foco.
      inp.addEventListener('input', () => { state.blocks[i][f] = inp.value; tr.className = 'k-' + kindOf(state.blocks[i]); updateIssuesAndOutput(); });
      td.appendChild(inp); tr.appendChild(td);
    }
    const acts = document.createElement('td'); acts.className = 'acts';
    acts.innerHTML = `<button type="button" title="Subir" data-a="up">↑</button><button type="button" title="Bajar" data-a="down">↓</button><button type="button" title="Insertar bloque vacío debajo" data-a="ins">＋</button><button type="button" title="Eliminar bloque" data-a="del">✕</button>`;
    acts.addEventListener('click', ev => {
      const a = ev.target.dataset.a; if (!a) return; const B = state.blocks;
      if (a === 'up' && i > 0) [B[i - 1], B[i]] = [B[i], B[i - 1]];
      if (a === 'down' && i < B.length - 1) [B[i + 1], B[i]] = [B[i], B[i + 1]];
      if (a === 'ins') B.splice(i + 1, 0, EMPTY());
      if (a === 'del') B.splice(i, 1);
      renderAll();
    });
    tr.appendChild(acts); tb.appendChild(tr);
  });
}
$('#addBlock').addEventListener('click', () => { state.blocks.push(EMPTY()); renderAll(); });

function renderAll() {
  $('#previewCard').hidden = false; $('#copyCard').hidden = false;
  renderTable(); updateIssuesAndOutput();
}

/** Recalcula validación (marca celdas en rojo + lista de advertencias) y la fila de salida. */
function updateIssuesAndOutput() {
  const issues = C.validateBlocks(state.blocks);
  document.querySelectorAll('#preview tbody input').forEach(inp => {
    const iss = issues.find(x => x.k === +inp.dataset.i + 1 && x.field === inp.dataset.f);
    inp.classList.toggle('bad', !!iss);
    inp.title = iss ? iss.msg + (iss.suggestions?.length ? '\nSugerencias: ' + iss.suggestions.join(' / ') : '') : '';
  });
  const all = [...state.warnings, ...issues.map(x => x.msg + (x.suggestions?.length ? ' Sugerencias: ' + x.suggestions.join(' / ') + '.' : ''))];
  $('#warnCard').hidden = !all.length;
  $('#warnings').innerHTML = all.map(w => `<li${w.startsWith('ℹ') ? ' class="info"' : ''}>${esc(w)}</li>`).join('');
  updateOutput();
}

/** Construye la fila TSV para la fila destino y actualiza textarea / instrucciones. */
function updateOutput() {
  if (!state.blocks.length) return;
  const row = targetRow();
  $('#howRow').textContent = row ?? 'indicada'; $('#howCell').textContent = 'C' + (row ?? '454');
  if (row) {
    current = C.buildRow(state.blocks, row, { fillAll: $('#fillAll').checked });
    $('#tsv').value = current.tsv;
    setStatus('info', `Listo para copiar: ${current.cells.length} celdas (C${row}–${C.colLetter(current.lastCol)}${row}).`);
  } else {
    current = null; $('#tsv').value = '';
    setStatus('err', 'Falta la fila destino: escríbela en el paso 2 (número ≥ 3).');
  }
}
function setStatus(kind, msg) { const s = $('#copyStatus'); s.className = kind; s.textContent = msg; }

// ---------- Copiar ----------
/*
 * Se copia SOLO text/plain (TSV). Motivo: al pegar, Google Sheets prefiere text/html si existe,
 * y en HTML solo reconoce fórmulas en su atributo propio data-sheets-formula (en notación R1C1);
 * el texto "=..." de una <td> normal puede pegarse como texto literal. Con text/plain, Sheets
 * separa por tabuladores en columnas y convierte cada celda que empieza con "=" en fórmula.
 */
async function copyText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return 'clipboard'; } catch (e) { console.warn('clipboard.writeText falló:', e); }
  }
  // Respaldo: execCommand sobre el textarea VISIBLE (un elemento oculto o dentro de <details> cerrado no se puede seleccionar).
  const t = $('#tsv'); t.value = text; t.focus(); t.select(); t.setSelectionRange(0, text.length);
  try { if (document.execCommand('copy')) return 'execCommand'; } catch (e) { console.warn('execCommand falló:', e); }
  return null;
}
$('#copy').addEventListener('click', async () => {
  updateOutput();
  if (!current) { rowEl.classList.add('need'); rowEl.scrollIntoView({ block: 'center' }); rowEl.focus(); return; }
  const how = await copyText(current.tsv);
  if (how) setStatus('ok', `✔ Copiado: ${current.cells.length} celdas. Ahora haz clic en C${targetRow()} de «Inciso E» y pega con Ctrl+V.`);
  else { const t = $('#tsv'); t.focus(); t.select(); setStatus('err', '✖ El navegador no permitió copiar. El texto ya está seleccionado abajo: pulsa Ctrl+C (⌘+C) y pega en Sheets.'); }
});
$('#selectAll').addEventListener('click', () => { const t = $('#tsv'); t.focus(); t.select(); t.setSelectionRange(0, t.value.length); });

window.__incisoE = { state, C }; // depuración / pruebas
