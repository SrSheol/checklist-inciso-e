/*
 * paste.js — copiado por bloques para la pestaña «Inciso E».
 * Las columnas RESULTADO están protegidas, así que cada bloque se pega por separado:
 * solo sus celdas de entrada (E1 = C..E, E2 = G, E3+ = 5 columnas desde I, O, U…).
 * Funciones puras (salvo copyText) para poder probarlas en node.
 */
import { blockLayout, colLetter, MAX_BLOCKS } from './core.js';

export const FIELDS = ['select', 'producto', 'capacidad', 'inhab', 'serie'];

/** Campos con columna de entrada en el bloque k, en orden de columna. */
export function inputFields(k) {
  const L = blockLayout(k);
  return FIELDS.filter(f => L[f] != null).sort((a, b) => L[a] - L[b]);
}

const filled = v => String(v ?? '').trim() !== '';
export const isEmptyBlock = b => !FIELDS.some(f => filled(b[f]));

/**
 * Dónde y qué se pega del bloque k en la fila `row` (row puede ser null).
 * pasteable = está dentro de E1..E100 y tiene algún valor en sus columnas de entrada.
 */
export function pasteInfo(b, k, row) {
  if (k > MAX_BLOCKS) return { k, fields: [], cols: [], pasteable: false, reason: 'fuera' };
  const L = blockLayout(k), fields = inputFields(k);
  const cols = fields.map(f => colLetter(L[f]));
  const first = cols[0], last = cols[cols.length - 1];
  const r = row ?? '';
  const info = { k, fields, cols, first, last, result: colLetter(L.result), cell: first + r, range: first === last ? first + r : `${first}${r}:${last}${r}` };
  if (isEmptyBlock(b)) return { ...info, pasteable: false, reason: 'vacio' };
  if (!fields.some(f => filled(b[f]))) return { ...info, pasteable: false, reason: 'sincol' };
  return { ...info, pasteable: true, reason: null };
}

/**
 * Valores que Google Sheets reinterpretaría al pegar texto plano: fórmulas (=, +, -, @),
 * números (pierden ceros iniciales; con más de 15 dígitos se redondean), notación científica,
 * fechas/horas, booleanos y comillas iniciales (Sheets las trata como campo entrecomillado).
 * Ningún valor de las listas de validación coincide con estos patrones.
 */
const RISKY = [
  /^[=+\-@"]/,
  /^\(?[$€]?\s*\d[\d.,\s]*\)?\s*%?$/,
  /^\.\d+$/,
  /^\d+(\.\d+)?e[+-]?\d+$/i,
  /^\d{1,4}[/.-]\d{1,2}([/.-]\d{1,4})?$/,
  /^\d{1,2}:\d{2}/,
  /^(true|false|verdadero|falso)$/i,
];
export const isRisky = v => RISKY.some(re => re.test(String(v ?? '').trim()));

// Igual que clean() de core.buildRow: un tabulador o salto de línea partiría la celda.
const clean = v => String(v ?? '').replace(/[\t\r\n]+/g, ' ');

/** Texto de una celda; con guard, un apóstrofo inicial obliga a Sheets a guardarlo como texto. */
export function cellText(v, guard = true) {
  const s = clean(v);
  return guard && isRisky(s) ? "'" + s : s;
}

/** Texto separado por tabuladores con las celdas de entrada del bloque k (incluye las vacías, para limpiar lo que hubiera). */
export function blockTSV(b, k, { guard = true } = {}) {
  return inputFields(k).map(f => cellText(b[f], guard)).join('\t');
}

/**
 * Copia texto plano. 1) Clipboard API; 2) textarea fuera de pantalla + execCommand('copy').
 * Devuelve true si alguna funcionó; si no, la interfaz muestra el texto para copiarlo a mano.
 */
export async function copyText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { console.warn('clipboard.writeText falló:', e); }
  }
  const prev = document.activeElement;
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.setAttribute('aria-hidden', 'true');
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0';
  // Con un <dialog> modal abierto, lo que está fuera es inerte y no se puede seleccionar: va dentro del diálogo.
  (document.querySelector('dialog[open]') || document.body).appendChild(ta);
  ta.focus({ preventScroll: true }); ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { console.warn('execCommand falló:', e); }
  ta.remove();
  if (prev && prev.focus) prev.focus({ preventScroll: true });
  return ok;
}
