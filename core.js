// Lógica compartida (navegador y node): extracción de líneas del PDF, parseo del checklist,
// construcción de bloques y generación de la fila TSV para la pestaña "Inciso E".
import { LISTS, TEMPLATES } from './data.js';

// ---------- utilidades de columnas ----------
export function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
export const MAX_BLOCKS = 100;            // E1..E100 (C..VX)
export function blockLayout(k) {          // k = 1..100 -> columnas (1-based)
  if (k === 1) return { select: 3, producto: 4, capacidad: 5, inhab: null, serie: null, result: 6 };
  if (k === 2) return { select: null, producto: null, capacidad: null, inhab: null, serie: 7, result: 8 };
  const s = 9 + 6 * (k - 3);
  return { select: s, producto: s + 1, capacidad: s + 2, inhab: s + 3, serie: s + 4, result: s + 5 };
}
const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// ---------- 1) líneas a partir de items de pdf.js ----------
const HEADER_FOOTER = [
  /^clave:?$/i, /^revisi[oó]n:?$/i, /^fecha:?$/i, /^p[aá]gina:?$/i, /^\d+\s+de\s+\d+$/i, /^UIMECV-/i,
  /^listado de documentos/i, /^unidad de inspecci[oó]n mexicana/i, /^mirlo n/i, /^tel[eé]fono: 5620937880/i,
  /^contacto:/i, /^www\./i,
];
// pages: [{items:[{str,x,y,w,h}], height}]  -> [{page, y, cells:[{text,x}] , text}]
export function itemsToLines(pages) {
  const lines = [];
  pages.forEach((pg, pi) => {
    const its = pg.items.filter(i => i.str && i.str.trim()).map(i => ({ ...i, str: i.str.replace(/\s+/g, ' ') }));
    its.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const rows = [];
    for (const it of its) {
      let row = rows.find(r => Math.abs(r.y - it.y) <= Math.max(2.5, (it.h || 8) * 0.35));
      if (!row) { row = { y: it.y, items: [] }; rows.push(row); }
      row.items.push(it);
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      const cells = [];
      for (const it of r.items) {
        const last = cells[cells.length - 1];
        if (last && it.x - (last.x + last.w) < 2.5) { last.text += (it.x - (last.x + last.w) > 0.8 && !/^[\/.,]/.test(it.str) ? ' ' : '') + it.str; last.w = it.x + it.w - last.x; }
        else cells.push({ text: it.str, x: it.x, w: it.w });
      }
      cells.forEach(c => c.text = c.text.trim());
      const H = pg.height || 792;
      if (r.y > H * 0.88 || r.y < 45) continue; // encabezado y pie de página repetidos
      const keep = cells.filter(c => c.text && !HEADER_FOOTER.some(re => re.test(c.text)));
      if (!keep.length) continue;
      lines.push({ page: pi + 1, y: r.y, cells: keep, text: keep.map(c => c.text).join('  ') });
    }
  });
  return lines;
}

// ---------- 2) parseo del checklist ----------
export function mapProducto(s) {
  const n = norm(s);
  if (!n) return null;
  if (/premium|super/.test(n)) return 'Gasolina Premium';
  if (/regular|magna/.test(n)) return 'Gasolina Regular';
  if (/diesel/.test(n)) return 'Diésel';
  if (/combustoleo/.test(n)) return 'Combustóleo';
  return null;
}
const STATUS_RE = /(en servicio|fuera de servicio|inhabilitad[oa]|inmovilizad[oa]|sin servicio|en reparaci[oó]n|baja|desconectad[oa]|clausurad[oa]|suspendid[oa])/i;
export function mapStatus(s, kind /* 'tanque'|'manguera' */) {
  const n = norm(s);
  if (!n || n === 'en servicio') return { value: '', warn: null };
  if (/fuera de servicio|sin servicio/.test(n)) return { value: '(Fuera de Servicio)', warn: null };
  if (/inmovilizad/.test(n)) return { value: kind === 'tanque' ? '(Inmovilizado)' : '(Inmovilizada)', warn: null };
  if (/inhabilitad/.test(n)) return { value: kind === 'tanque' ? '(Inhabilitado)' : '(Inhabilitada)', warn: null };
  return { value: kind === 'tanque' ? '(Inhabilitado)' : '(Inhabilitada)', warn: `Estatus "${s}" no reconocido; se marcó como ${kind === 'tanque' ? '(Inhabilitado)' : '(Inhabilitada)'}. Revísalo.` };
}
export function fmtCapacidad(s) {
  const m = (s || '').replace(/\s/g, '').match(/(\d[\d,.]*)/);
  if (!m) return null;
  let digits = m[1];
  // "40,000" o "40.000" -> 40000 ; "40000.00" -> 40000
  if (/[.,]\d{1,2}$/.test(digits) && !/[.,]\d{3}$/.test(digits)) digits = digits.replace(/[.,]\d{1,2}$/, '');
  const n = parseInt(digits.replace(/[.,]/g, ''), 10);
  if (!n) return null;
  return n.toLocaleString('en-US') + ' Litros';
}
export function fmtTanque(n) { return 'Tanque 0' + n; } // así aparece en la lista: Tanque 01..09, Tanque 010..015

const SEC = [
  { id: 'disp1', re: /^1\.\s*informaci[oó]n de (los )?dispensarios/i },
  { id: 'disp2', re: /^2\.\s*relaci[oó]n de (los )?dispensarios/i },
  { id: 'med', re: /^2\.1\b/i },
  { id: 'tanques', re: /^3\.\s*informaci[oó]n de (los )?tanques/i },
  { id: 'consola', re: /^4\.\s*informaci[oó]n de(l)? equipo de telemedici[oó]n/i },
  { id: 'programa', re: /^5\.\s*datos del programa/i },
  { id: 'fin', re: /^6\.\s/i },
  { id: 'fin', re: /^7\.\s*datos de proveedores/i },
];
function labelValue(line, labelRe) {
  // devuelve el texto a la derecha de la etiqueta (puede estar en la misma celda tras ':')
  const t = line.cells.map(c => c.text);
  for (let i = 0; i < t.length; i++) {
    const m = t[i].match(labelRe);
    if (m) {
      const rest = t[i].slice(m.index + m[0].length).replace(/^[:\s]+/, '');
      return [rest, ...t.slice(i + 1)].filter(Boolean).join(' ').trim();
    }
  }
  return null;
}

export function parseChecklist(lines) {
  const out = { ot: null, cliente: null, permiso: null, dispensarios: [], relacion: [], medidores: {}, tanques: [], consola: { marca: '', modelo: '', serie: '' }, programa: { nombre: '', version: '' }, warnings: [] };
  const W = m => out.warnings.push(m);
  let sec = null, curDisp = null;
  const seen = {};
  for (const ln of lines) {
    const t = ln.text;
    const first = ln.cells[0].text;
    if (!out.ot) { const m = t.match(/OT-[A-Z]+-[A-Z]+-\s*\d+\s*\/\s*\d{4}/i); if (m) out.ot = m[0].replace(/\s+/g, ''); }
    if (!out.cliente) { const v = labelValue(ln, /^raz[oó]n social:?/i); if (v) out.cliente = v; }
    if (!out.permiso) { const v = labelValue(ln, /^permiso cre(\/cne)?:?/i); if (v) out.permiso = v; }
    const s = SEC.find(x => x.re.test(first) || x.re.test(t));
    if (s) { sec = s.id; seen[sec] = true; curDisp = null; continue; }
    if (sec === 'disp1') {
      const i = ln.cells.findIndex(c => /^dispensario\s*\d+/i.test(c.text));
      if (i >= 0) {
        const num = parseInt(ln.cells[i].text.match(/\d+/)[0], 10);
        const rest = ln.cells.slice(i + 1).map(c => c.text);
        out.dispensarios.push({ num, marca: rest[0] || '', modelo: rest[1] || '', serie: rest[2] || '' });
      }
    } else if (sec === 'disp2') {
      if (/^\d+$/.test(first) && ln.cells.length >= 2) {
        const cells = ln.cells.slice(1).map(c => c.text);
        const st = cells.find(c => STATUS_RE.test(c)) || '';
        const nm = cells.find(c => /^\d+$/.test(c));
        const prod = cells.find(c => !/^\d+$/.test(c) && c !== st) || '';
        out.relacion.push({ num: parseInt(first, 10), producto: prod, mangueras: nm ? parseInt(nm, 10) : null, estatus: st });
      }
    } else if (sec === 'med') {
      const hm = t.match(/^dispensario\s*(\d+)\b(.*)$/i);
      if (hm) { curDisp = parseInt(hm[1], 10); out.medidores[curDisp] = out.medidores[curDisp] || { titulo: t, filas: [] }; continue; }
      if (curDisp == null) continue;
      if (/^(po|pos\.?|s\.|producto)$/i.test(first) || /producto/i.test(t) && /estatus/i.test(t)) continue; // encabezado (incluye "Po" / "s." partido)
      if (/^([A-Z]|\d{1,2})$/.test(first) && ln.cells.length >= 2) {
        const cells = ln.cells.slice(1).map(c => c.text);
        const pi = cells.findIndex(c => mapProducto(c));
        const st = cells.find(c => STATUS_RE.test(c)) || '';
        const serie = pi >= 0 && cells[pi + 1] && cells[pi + 1] !== st ? cells[pi + 1] : '';
        out.medidores[curDisp].filas.push({ pos: first, productoTxt: pi >= 0 ? cells[pi] : (cells[0] || ''), producto: pi >= 0 ? mapProducto(cells[pi]) : null, serie, estatus: st });
      }
    } else if (sec === 'tanques') {
      const ti = ln.cells.findIndex(c => /^tanque\b/i.test(c.text));
      if (ti >= 0 && !/^tanque$/i.test(ln.cells[ti].text)) {
        const name = ln.cells[ti].text;
        const nm = name.match(/(\d+)/);
        const cells = ln.cells.slice(ti + 1).map(c => c.text);
        const prodTxt = cells.find(c => mapProducto(c)) || '';
        const capTxt = cells.find(c => /\d[\d,.]*\s*(l\b|lts?\.?|litros)/i.test(c)) || cells.find(c => /^\d[\d,.]{3,}$/.test(c)) || '';
        const st = cells.find(c => STATUS_RE.test(c)) || '';
        out.tanques.push({ num: nm ? parseInt(nm[1], 10) : out.tanques.length + 1, nombreTxt: name, bipartido: /bipartido/i.test(name), productoTxt: prodTxt, producto: mapProducto(prodTxt), capacidadTxt: capTxt, capacidad: fmtCapacidad(capTxt), estatus: st });
      }
    } else if (sec === 'consola') {
      let v;
      if ((v = labelValue(ln, /marca( de la)? consola( de telemedici[oó]n)?:?/i)) !== null) out.consola.marca = v;
      else if ((v = labelValue(ln, /^modelo:?/i)) !== null) out.consola.modelo = v;
      else if ((v = labelValue(ln, /n[uú]mero de serie:?|no\.? de serie:?/i)) !== null) out.consola.serie = v;
    } else if (sec === 'programa') {
      let v;
      if ((v = labelValue(ln, /nombre del programa inform[aá]tico:?/i)) !== null) out.programa.nombre = v;
      else if ((v = labelValue(ln, /versi[oó]n del programa inform[aá]tico:?/i)) !== null) out.programa.version = v;
    }
  }
  // advertencias
  for (const k of ['disp2', 'tanques', 'consola', 'programa']) if (!seen[k]) W(`No se encontró la sección "${{ disp2: '2. Relación de dispensarios', tanques: '3. Información de los tanques', consola: '4. Equipo de telemedición', programa: '5. Datos del programa informático' }[k]}" en el PDF.`);
  if (!seen.med) W('No se encontró la sección "2.1 Números de serie de los medidores"; los productos por manguera se infieren de la sección 2.');
  if (!out.tanques.length) W('No se encontraron tanques.');
  out.tanques.forEach(tq => {
    if (!tq.producto) W(`${tq.nombreTxt}: no se reconoció el producto "${tq.productoTxt}".`);
    if (!tq.capacidad) W(`${tq.nombreTxt}: no se reconoció la capacidad "${tq.capacidadTxt}".`);
  });
  if (!out.consola.marca) W('No se encontró la marca/modelo de la consola de telemedición.');
  if (!out.consola.serie) W('No se encontró el número de serie de la consola.');
  if (!out.programa.nombre) W('No se encontró el nombre del programa informático.');
  if (!out.programa.version) W('No se encontró la versión del programa informático.');
  return out;
}

// ---------- 3) bloques ----------
// block: {kind:'tanque'|'vacio'|'manguera'|'consola'|'sistema', select, producto, capacidad, inhab, serie}
// Alias de nombres de programa informático (checklist -> valor de la lista de la hoja).
// Clave: nombre normalizado (minúsculas, sin acentos ni espacios). Solo nombres de programa, nunca proveedores.
export const PROGRAM_ALIASES = { gaslight: 'GasLightManager' };
const squash = s => norm(s).replace(/[\s\-_.]/g, '');
export function normalizePrograma(name, list) {
  const n = squash(name);
  if (!n) return { value: name, note: null };
  const cands = (list || []).filter(x => x && !/litros|^manguera/i.test(x));
  const exact = cands.find(x => squash(x) === n);
  if (exact) return { value: exact, note: null };
  const alias = PROGRAM_ALIASES[n];
  if (alias) {
    const v = cands.find(x => squash(x) === squash(alias)) || alias;
    return { value: v, note: `ℹ️ Programa "${name}" del checklist se capturó como "${v}" (alias configurado).` };
  }
  const starts = cands.filter(x => squash(x).startsWith(n));
  const m = starts.length ? starts : cands.filter(x => squash(x).includes(n));
  if (m.length === 1) return { value: m[0], note: `ℹ️ Programa "${name}" no está tal cual en la lista; se usó "${m[0]}" (única coincidencia). Verifícalo.` };
  return { value: name, note: null }; // 0 o varias coincidencias: validateBlocks avisa con sugerencias
}

export function buildBlocks(p) {
  const blocks = [], warnings = [];
  const tanks = [...p.tanques].sort((a, b) => a.num - b.num);
  tanks.forEach((tq, i) => {
    const st = mapStatus(tq.estatus, 'tanque'); if (st.warn) warnings.push(`${tq.nombreTxt}: ${st.warn}`);
    const select = tq.bipartido ? 'Tanque Bipartido ' + tq.num : fmtTanque(tq.num);
    let sel = select, inh = st.value;
    if (i === 0 && inh) {
      // E1 no tiene columna "inhabilitado": la hoja usa la variante de la lista, p. ej. "Tanque 01 (Fuera de Servicio) "
      const alt = LISTS.selC.find(x => norm(x) === norm(select + ' ' + inh));
      if (alt) { sel = alt; inh = ''; }
      else warnings.push(`${tq.nombreTxt}: estatus ${inh} sin variante en la lista para E1; revisa la columna C.`);
    }
    blocks.push({ kind: 'tanque', select: sel, producto: tq.producto || '', capacidad: tq.capacidad || '', inhab: inh, serie: '' });
    blocks.push({ kind: 'vacio', select: '', producto: '', capacidad: '', inhab: '', serie: '' });
  });
  // dispensarios: unión de secciones 1, 2 y 2.1
  const nums = new Set([...p.dispensarios.map(d => d.num), ...p.relacion.map(r => r.num), ...Object.keys(p.medidores).map(Number)]);
  let k = 0;
  for (const n of [...nums].sort((a, b) => a - b)) {
    const rel = p.relacion.find(r => r.num === n);
    const med = p.medidores[n];
    let filas = med ? med.filas : [];
    const relCount = rel && rel.mangueras;
    if (med && relCount && filas.length !== relCount) warnings.push(`Dispensario ${n}: la sección 2 indica ${relCount} mangueras pero la 2.1 lista ${filas.length} medidores.`);
    if (!filas.length) {
      const prod = rel ? mapProducto(rel.producto) : null;
      const cnt = relCount || 0;
      if (!cnt) { warnings.push(`Dispensario ${n}: no se pudo determinar el número de mangueras.`); continue; }
      warnings.push(`Dispensario ${n}: sin detalle en 2.1; se generaron ${cnt} mangueras con producto ${prod ? '"' + prod + '"' : 'vacío (revisar)'}.`);
      filas = Array.from({ length: cnt }, (_, i) => ({ pos: String.fromCharCode(65 + i), producto: prod, productoTxt: rel ? rel.producto : '', estatus: '' }));
    }
    for (const f of filas) {
      k++;
      if (!f.producto) warnings.push(`Dispensario ${n} pos. ${f.pos}: no se reconoció el producto "${f.productoTxt}".`);
      let st = mapStatus(f.estatus, 'manguera');
      if (!st.value && rel && rel.estatus) st = mapStatus(rel.estatus, 'manguera'); // estatus del dispensario completo
      if (st.warn) warnings.push(`Dispensario ${n} pos. ${f.pos}: ${st.warn}`);
      blocks.push({ kind: 'manguera', select: 'Dispensario ' + n, producto: f.producto || '', capacidad: 'Manguera ' + k, inhab: st.value, serie: '' });
    }
  }
  if (!k) warnings.push('No se generó ninguna manguera.');
  const c = p.consola;
  let consolaNombre = c.marca || '';
  if (c.modelo && !norm(consolaNombre).includes(norm(c.modelo))) consolaNombre = (consolaNombre + ' ' + c.modelo).trim();
  blocks.push({ kind: 'consola', select: 'Consola ', producto: '', capacidad: consolaNombre, inhab: '', serie: c.serie || '' });
  const prog = normalizePrograma(p.programa.nombre || '', listFor(blocks.length + 1, 'capacidad'));
  if (prog.note) warnings.push(prog.note);
  blocks.push({ kind: 'sistema', select: 'Sistema Informático ', producto: '', capacidad: prog.value, inhab: '', serie: p.programa.version || '' });
  if (blocks.length > MAX_BLOCKS) warnings.push(`Se generaron ${blocks.length} bloques pero la hoja solo tiene ${MAX_BLOCKS} (E1–E100). Los sobrantes se omiten.`);
  return { blocks, warnings };
}

// ---------- 4) validación contra las listas de la hoja ----------
export function listFor(k, field) {
  if (field === 'producto') return LISTS.producto;
  if (field === 'inhab') return LISTS.inhab;
  if (field === 'select') return k <= 2 ? LISTS.selC : (k === 3 ? LISTS.selC : LISTS.sel);
  if (field === 'capacidad') return k === 1 ? LISTS.capE : (k === 3 ? LISTS.capK : LISTS.cap);
  return null;
}
export function validateBlocks(blocks) {
  const issues = [];
  const LBL = { select: 'selección', producto: 'producto', capacidad: 'capacidad/manguera', inhab: 'inhabilitado', serie: 'serie/versión' }; // {k, field, value, msg, suggestions}
  blocks.slice(0, MAX_BLOCKS).forEach((b, i) => {
    const k = i + 1, L = blockLayout(k);
    for (const f of ['select', 'producto', 'capacidad', 'inhab']) {
      const v = b[f]; if (!v) continue;
      if (L[f] == null) { issues.push({ k, field: f, value: v, msg: `E${k} no tiene columna "${LBL[f]}"; el valor se perderá.` }); continue; }
      const list = listFor(k, f);
      if (list && !list.includes(v)) {
        const nv = norm(v);
        const sugg = list.filter(x => x && (norm(x).includes(nv) || nv.includes(norm(x)) && norm(x).length > 3)).slice(0, 4);
        issues.push({ k, field: f, value: v, suggestions: [...new Set(sugg)], msg: `E${k} ${LBL[f]}: "${v}" no está en la lista de validación de la hoja (columna ${colLetter(L[f])}); Sheets podría rechazar el pegado.` });
      }
    }
    if (b.serie && /^0\d+$/.test(String(b.serie))) issues.push({ k, field: 'serie', value: b.serie, msg: `E${k} serie "${b.serie}" es numérica con cero inicial; Sheets podría convertirla a número y perder el cero.` });
    if (b.serie && /^\d{16,}$/.test(String(b.serie))) issues.push({ k, field: 'serie', value: b.serie, msg: `E${k} serie "${b.serie}" tiene más de 15 dígitos; Sheets podría redondearla al convertirla a número.` });
  });
  return issues;
}

// ---------- 5) fila TSV ----------
const clean = v => String(v ?? '').replace(/[\t\r\n]+/g, ' ');
export function formulaFor(col, row) { const t = TEMPLATES[colLetter(col)]; return t ? t.replace(/\{r\}/g, String(row)) : ''; }
// devuelve {cells: [...desde C], lastCol}
export function buildRow(blocks, row, { fillAll = false } = {}) {
  row = parseInt(row, 10);
  if (!(row >= 3)) throw new Error('La fila destino debe ser un número ≥ 3.');
  const used = Math.min(blocks.length, MAX_BLOCKS);
  const nBlocks = fillAll ? MAX_BLOCKS : Math.max(used, 1);
  const lastCol = blockLayout(nBlocks).result;
  const cells = new Array(lastCol - 2).fill('');
  const put = (col, v) => { if (col) cells[col - 3] = clean(v); };
  for (let k = 1; k <= nBlocks; k++) {
    const L = blockLayout(k), b = blocks[k - 1] || {};
    put(L.select, b.select); put(L.producto, b.producto); put(L.capacidad, b.capacidad); put(L.inhab, b.inhab); put(L.serie, b.serie);
    put(L.result, formulaFor(L.result, row));
  }
  return { cells, lastCol, tsv: cells.join('\t') };
}

// pipeline completo desde líneas
export function processLines(lines) {
  const parsed = parseChecklist(lines);
  const { blocks, warnings } = buildBlocks(parsed);
  return { parsed, blocks, warnings: [...parsed.warnings, ...warnings] };
}
