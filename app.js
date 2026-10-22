import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
import * as C from './core.js';
import { LISTS } from './data.js';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

const $ = s => document.querySelector(s);
const state = { blocks: [], warnings: [], parsed: null };
for (const [k, list] of Object.entries(LISTS)) { const dl = $('#dl-' + k); if (dl) dl.innerHTML = list.filter(Boolean).map(v => `<option value="${esc(v)}">`).join(''); }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

const rowEl = $('#row');
rowEl.value = localStorage.getItem('incisoE.row') || '';
rowEl.addEventListener('input', () => { localStorage.setItem('incisoE.row', rowEl.value); refresh(); });
$('#fillAll').addEventListener('change', refresh);

// ---- carga del PDF ----
const drop = $('#drop'), fileEl = $('#file');
fileEl.addEventListener('change', () => fileEl.files[0] && handleFile(fileEl.files[0]));
['dragenter', 'dragover'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', ev => { const f = ev.dataTransfer.files[0]; if (f) handleFile(f); });
window.addEventListener('dragover', e => e.preventDefault()); window.addEventListener('drop', e => e.preventDefault());

export async function extractPages(data) {
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p); const vp = pg.getViewport({ scale: 1 }); const tc = await pg.getTextContent();
    pages.push({ height: vp.height, items: tc.items.map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: i.height })) });
  }
  return pages;
}
async function handleFile(f) {
  $('#dropText').textContent = 'Procesando ' + f.name + '…';
  try {
    const pages = await extractPages(new Uint8Array(await f.arrayBuffer()));
    const lines = C.itemsToLines(pages);
    const r = C.processLines(lines);
    state.blocks = r.blocks; state.warnings = r.warnings; state.parsed = r.parsed;
    const p = r.parsed;
    $('#meta').hidden = false;
    $('#meta').innerHTML = `<b>OT:</b> ${esc(p.ot || '¿?')} &nbsp; <b>Cliente:</b> ${esc(p.cliente || '¿?')} &nbsp; <b>Permiso:</b> ${esc(p.permiso || '¿?')}<br>` +
      `${p.tanques.length} tanque(s), ${r.blocks.filter(b => b.kind === 'manguera').length} manguera(s) en ${new Set(r.blocks.filter(b => b.kind === 'manguera').map(b => b.select)).size} dispensario(s).`;
    $('#dropText').textContent = '✔ ' + f.name + ' (clic o arrastra otro PDF para reemplazar)';
    document.body.dataset.parsed = '1';
    refresh();
  } catch (e) {
    console.error(e);
    $('#dropText').textContent = '✖ No se pudo leer el PDF: ' + e.message;
  }
}

// ---- vista previa editable ----
const FIELDS = ['select', 'producto', 'capacidad', 'inhab', 'serie'];
function dlFor(k, f) {
  if (f === 'producto') return 'dl-producto'; if (f === 'inhab') return 'dl-inhab';
  if (f === 'select') return k <= 3 ? 'dl-selC' : 'dl-sel';
  if (f === 'capacidad') return k === 1 ? 'dl-capE' : k === 3 ? 'dl-capK' : 'dl-cap';
  return '';
}
function kindOf(b) {
  const s = (b.select || '').toLowerCase();
  if (s.startsWith('tanque')) return 'tanque'; if (s.startsWith('dispensario')) return 'manguera';
  if (s.startsWith('consola')) return 'consola'; if (s.startsWith('sistema')) return 'sistema';
  return FIELDS.some(f => b[f]) ? 'otro' : 'vacio';
}
function renderTable(issues) {
  const tb = $('#preview tbody'); tb.innerHTML = '';
  state.blocks.forEach((b, i) => {
    const k = i + 1, L = C.blockLayout(k);
    const tr = document.createElement('tr'); tr.className = 'k-' + kindOf(b);
    const cols = [L.select || L.serie, L.result].map(C.colLetter).join('–');
    tr.innerHTML = `<td><b>E${k}</b>${k > C.MAX_BLOCKS ? ' ⚠' : ''}</td><td class="cols">${cols}</td>`;
    for (const f of FIELDS) {
      const td = document.createElement('td'); const inp = document.createElement('input');
      inp.value = b[f] || ''; inp.disabled = L[f] == null && !b[f]; inp.dataset.i = i; inp.dataset.f = f;
      const dl = dlFor(k, f); if (dl) inp.setAttribute('list', dl);
      const iss = issues.find(x => x.k === k && x.field === f);
      if (iss) { inp.classList.add('bad'); inp.title = iss.msg + (iss.suggestions && iss.suggestions.length ? '\nSugerencias: ' + iss.suggestions.join(' / ') : ''); }
      inp.addEventListener('change', () => { state.blocks[i][f] = inp.value; refresh(); });
      td.appendChild(inp); tr.appendChild(td);
    }
    const acts = document.createElement('td'); acts.className = 'acts';
    acts.innerHTML = `<button title="Subir" data-a="up">↑</button><button title="Bajar" data-a="down">↓</button><button title="Insertar bloque vacío debajo" data-a="ins">＋</button><button title="Eliminar bloque" data-a="del">✕</button>`;
    acts.addEventListener('click', ev => {
      const a = ev.target.dataset.a; if (!a) return; const B = state.blocks;
      if (a === 'up' && i > 0) [B[i - 1], B[i]] = [B[i], B[i - 1]];
      if (a === 'down' && i < B.length - 1) [B[i + 1], B[i]] = [B[i], B[i + 1]];
      if (a === 'ins') B.splice(i + 1, 0, { select: '', producto: '', capacidad: '', inhab: '', serie: '' });
      if (a === 'del') B.splice(i, 1);
      refresh();
    });
    tr.appendChild(acts); tb.appendChild(tr);
  });
}
$('#addBlock').addEventListener('click', () => { state.blocks.push({ select: '', producto: '', capacidad: '', inhab: '', serie: '' }); refresh(); });

let current = null;
function refresh() {
  if (!state.blocks.length) return;
  const issues = C.validateBlocks(state.blocks);
  const all = [...state.warnings, ...issues.map(x => x.msg + (x.suggestions && x.suggestions.length ? ' Sugerencias: ' + x.suggestions.join(' / ') + '.' : ''))];
  $('#warnCard').hidden = !all.length; $('#warnings').innerHTML = all.map(w => `<li>${esc(w)}</li>`).join('');
  $('#previewCard').hidden = false; $('#copyCard').hidden = false;
  renderTable(issues);
  const row = parseInt(rowEl.value, 10);
  $('#howRow').textContent = row >= 3 ? row : 'indicada'; $('#howCell').textContent = 'C' + (row >= 3 ? row : '454');
  if (row >= 3) {
    current = C.buildRow(state.blocks, row, { fillAll: $('#fillAll').checked });
    $('#tsv').value = current.tsv; $('#copy').disabled = false;
    $('#copyStatus').textContent = `Listo: ${current.cells.length} celdas (C${row}–${C.colLetter(current.lastCol)}${row}).`;
  } else { current = null; $('#tsv').value = ''; $('#copy').disabled = true; $('#copyStatus').textContent = 'Escribe la fila destino (≥ 3).'; }
}
$('#copy').addEventListener('click', async () => {
  if (!current) return;
  try { await navigator.clipboard.writeText(current.tsv); }
  catch { const t = $('#tsv'); t.closest('details').open = true; t.select(); document.execCommand('copy'); }
  $('#copyStatus').textContent = `✔ Copiado: ${current.cells.length} celdas. Ahora pega en C${rowEl.value} de «Inciso E».`;
});
window.__incisoE = { state, C };
