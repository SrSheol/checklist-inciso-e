/**
 * Checklist → Inciso E (Apps Script ligado a la hoja).
 *
 * Agrega el menú «Checklist» con un panel lateral donde se carga el PDF del checklist.
 * El PDF se procesa SOLO en el navegador (Sidebar.html + Core.html); aquí solo llegan
 * los valores finales de cada bloque, que se escriben celda por celda en las columnas
 * de captura de la fila elegida. Nunca se escriben las columnas A/B ni las RESULTADO.
 *
 * Funciones llamadas desde el panel (google.script.run):
 *   ckContexto(fila)      fila activa o indicada + listas de validación de la hoja
 *   ckBuscarFila(texto)   busca por Folio Acta (col. A) o permiso (col. B)
 *   ckLlenarFila(datos)   escribe los bloques (con bloqueo, protecciones y validación)
 */

var CK = {
  HOJA: 'Inciso E',
  PRIMERA_FILA: 3,      // filas 1–2 = encabezados
  COL_FOLIO: 1,         // A (fórmula, nunca se escribe)
  COL_PERMISO: 2,       // B (fórmula, nunca se escribe)
  MAX_BLOQUES: 100,     // E1..E100 (C..VX)
  CAMPOS: ['select', 'producto', 'capacidad', 'inhab', 'serie'],
};

// ---------- menú y panel ----------

function onOpen(e) {
  crearMenuChecklist();
}

function onInstall(e) {
  onOpen(e);
}

/** Crea el menú. Si tu proyecto ya tiene otro onOpen, llama a esta función desde él. */
function crearMenuChecklist() {
  SpreadsheetApp.getUi()
    .createMenu('Checklist')
    .addItem('Llenar Inciso E desde checklist…', 'abrirPanelChecklist')
    .addToUi();
}

function abrirPanelChecklist() {
  var html = HtmlService.createTemplateFromFile('Sidebar').evaluate().setTitle('Checklist → Inciso E');
  SpreadsheetApp.getUi().showSidebar(html);
}

/** Inserta otro archivo HTML del proyecto dentro de Sidebar.html. */
function incluir_(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

// ---------- columnas de cada bloque (igual que blockLayout de Core.html) ----------

function layout_(k) {
  if (k === 1) return { select: 3, producto: 4, capacidad: 5, inhab: null, serie: null, result: 6 };
  if (k === 2) return { select: null, producto: null, capacidad: null, inhab: null, serie: 7, result: 8 };
  var s = 9 + 6 * (k - 3);
  return { select: s, producto: s + 1, capacidad: s + 2, inhab: s + 3, serie: s + 4, result: s + 5 };
}

/** Columnas de captura (contiguas) del bloque k: {inicio, campos:[...]} */
function capturas_(k) {
  var L = layout_(k);
  var campos = CK.CAMPOS.filter(function (f) { return L[f] != null; });
  return { inicio: L[campos[0]], campos: campos, result: L.result };
}

var ULTIMA_COL_ = layout_(CK.MAX_BLOQUES).result;    // VX = 596

function letra_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function hoja_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CK.HOJA);
  if (!sh) throw new Error('No existe la pestaña «' + CK.HOJA + '» en este archivo.');
  return sh;
}

function filaValida_(sh, fila) {
  fila = Number(fila);
  if (!(fila >= CK.PRIMERA_FILA) || fila !== Math.floor(fila)) throw new Error('La fila debe ser un número entero a partir de ' + CK.PRIMERA_FILA + '.');
  if (fila > sh.getMaxRows()) throw new Error('La fila ' + fila + ' no existe (la hoja tiene ' + sh.getMaxRows() + ' filas).');
  return fila;
}

// ---------- lectura de la fila ----------

/** Folio, permiso y datos actuales (solo columnas de captura) de la fila. */
function infoFila_(sh, fila) {
  var ncols = Math.min(sh.getMaxColumns(), ULTIMA_COL_);
  var vals = sh.getRange(fila, 1, 1, ncols).getDisplayValues()[0];
  var existentes = [];
  for (var k = 1; k <= CK.MAX_BLOQUES; k++) {
    var L = layout_(k), b = { k: k }, hay = false;
    CK.CAMPOS.forEach(function (f) {
      var v = L[f] != null && L[f] <= ncols ? vals[L[f] - 1] : '';
      b[f] = v;
      if (v !== '') hay = true;
    });
    if (hay) existentes.push(b);
  }
  return { fila: fila, folio: vals[CK.COL_FOLIO - 1], permiso: vals[CK.COL_PERMISO - 1], existentes: existentes };
}

/**
 * Listas de validación de las columnas de captura de la fila.
 * Devuelve {cols: {columna: [valores]}, estrictas: {columna: true}}.
 */
function listasValidacion_(sh, fila) {
  var ncols = Math.min(sh.getMaxColumns(), ULTIMA_COL_);
  var reglas = sh.getRange(fila, 1, 1, ncols).getDataValidations()[0];
  var cols = {}, estrictas = {}, cache = {};
  for (var k = 1; k <= CK.MAX_BLOQUES; k++) {
    var L = layout_(k);
    CK.CAMPOS.forEach(function (f) {
      var c = L[f];
      if (c == null || c > ncols || !reglas[c - 1]) return;
      var lista = valoresDeRegla_(reglas[c - 1], cache);
      if (!lista) return;
      cols[c] = lista;
      if (!reglas[c - 1].getAllowInvalid()) estrictas[c] = true;
    });
  }
  return { cols: cols, estrictas: estrictas };
}

/** Cada lista se envía una sola vez al panel: {listas:[[...]], col:{columna: índice}, estrictas}. */
function comprimir_(l) {
  var listas = [], indice = {}, col = {};
  Object.keys(l.cols).forEach(function (c) {
    var clave = JSON.stringify(l.cols[c]);
    if (!(clave in indice)) { indice[clave] = listas.length; listas.push(l.cols[c]); }
    col[c] = indice[clave];
  });
  return { listas: listas, col: col, estrictas: l.estrictas };
}

function valoresDeRegla_(regla, cache) {
  var tipo = regla.getCriteriaType(), args = regla.getCriteriaValues();
  var T = SpreadsheetApp.DataValidationCriteria;
  if (tipo === T.VALUE_IN_LIST) return args[0].map(String);
  if (tipo !== T.VALUE_IN_RANGE) return null;
  var rango = args[0];
  var clave = rango.getSheet().getName() + '!' + rango.getA1Notation();
  if (!cache[clave]) {
    var crudos = rango.getValues(), vistos = rango.getDisplayValues(), out = [];
    crudos.forEach(function (fila, i) {
      fila.forEach(function (v, j) {
        // textos tal cual (conservan espacios finales como «Consola »); números/fechas como se ven
        var s = typeof v === 'string' ? v : vistos[i][j];
        if (s !== '') out.push(s);
      });
    });
    cache[clave] = out;
  }
  return cache[clave];
}

// ---------- funciones para el panel ----------

/**
 * Contexto inicial: si `fila` viene vacía usa la fila activa de «Inciso E» (≥ 3).
 * Las listas de validación se leen de la fila elegida (o de la primera fila de datos).
 */
function ckContexto(fila) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = hoja_();
  var aviso = null;
  if (fila == null || fila === '') {
    fila = null;
    var activa = ss.getActiveSheet();
    if (activa.getName() === CK.HOJA) {
      var r = activa.getActiveRange();
      if (r && r.getRow() >= CK.PRIMERA_FILA) fila = r.getRow();
      else aviso = 'Selecciona una celda de la fila destino (desde la fila ' + CK.PRIMERA_FILA + ') o busca por folio/permiso.';
    } else {
      aviso = 'Abre la pestaña «' + CK.HOJA + '» y selecciona la fila destino, o busca por folio/permiso.';
    }
  } else {
    fila = filaValida_(sh, fila);
  }
  var listas = listasValidacion_(sh, fila || CK.PRIMERA_FILA);
  if (fila && fila !== CK.PRIMERA_FILA && !Object.keys(listas.cols).length) {
    // fila sin validaciones: se usan las listas de la primera fila solo como referencia (no rechazan nada aquí)
    listas = listasValidacion_(sh, CK.PRIMERA_FILA);
    listas.estrictas = {};
  }
  return {
    hoja: CK.HOJA,
    info: fila ? infoFila_(sh, fila) : null,
    listas: comprimir_(listas),
    columnasHoja: sh.getMaxColumns(),
    aviso: aviso,
  };
}

/** Busca filas por Folio Acta (col. A) o permiso (col. B). Un número puro también se ofrece como nº de fila. */
function ckBuscarFila(texto) {
  var sh = hoja_();
  var q = String(texto || '').trim();
  if (!q) throw new Error('Escribe un folio, un permiso o un número de fila.');
  var ultima = sh.getLastRow();
  var coincidencias = [];
  if (ultima >= CK.PRIMERA_FILA) {
    var datos = sh.getRange(CK.PRIMERA_FILA, 1, ultima - CK.PRIMERA_FILA + 1, 2).getDisplayValues();
    var qPermiso = normPermiso_(q), qFolio = /^\d+$/.test(q) ? Number(q) : null;
    datos.forEach(function (d, i) {
      var folio = d[0].trim(), permiso = d[1];
      var porFolio = folio !== '' && (normPermiso_(folio) === qPermiso || (qFolio !== null && /^\d+$/.test(folio) && Number(folio) === qFolio));
      var porPermiso = permiso !== '' && normPermiso_(permiso) === qPermiso;
      if (porFolio || porPermiso) coincidencias.push({ fila: i + CK.PRIMERA_FILA, folio: d[0], permiso: permiso, por: porFolio ? 'folio' : 'permiso' });
    });
    // sin coincidencia exacta: el folio o el permiso contienen lo escrito (p. ej. «123» en «A-00123»)
    if (!coincidencias.length && qPermiso.length >= 3) {
      datos.forEach(function (d, i) {
        if (normPermiso_(d[0]).indexOf(qPermiso) >= 0 || normPermiso_(d[1]).indexOf(qPermiso) >= 0) {
          coincidencias.push({ fila: i + CK.PRIMERA_FILA, folio: d[0], permiso: d[1], por: 'parcial' });
        }
      });
    }
  }
  var comoFila = null;
  if (/^\d+$/.test(q) && Number(q) >= CK.PRIMERA_FILA && Number(q) <= sh.getMaxRows()) {
    var fv = sh.getRange(Number(q), 1, 1, 2).getDisplayValues()[0];
    comoFila = { fila: Number(q), folio: fv[0], permiso: fv[1] };
  }
  return { coincidencias: coincidencias.slice(0, 20), total: coincidencias.length, comoFila: comoFila };
}

/** Selecciona la fila en la hoja para que el usuario la vea. */
function ckIrAFila(fila) {
  var sh = hoja_();
  fila = filaValida_(sh, fila);
  sh.activate();
  sh.getRange(fila, 3).activate();
  return true;
}

function normPermiso_(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, '');
}

/**
 * Escribe los bloques en la fila.
 * datos = {fila, bloques:[{select,producto,capacidad,inhab,serie}], limpiarResto, confirmarSobrescritura,
 *          esperado:{folio, permiso}}
 * Devuelve {ok:true, escritos, limpiados, resultados, avisos} o {necesitaConfirmar:true, info}
 * o {ok:false, error, escritos, revertido}.
 */
function ckLlenarFila(datos) {
  var sh = hoja_();
  var fila = filaValida_(sh, datos && datos.fila);
  var bloques = (datos.bloques || []).slice(0, CK.MAX_BLOQUES);
  if (!bloques.length) throw new Error('No hay bloques que escribir.');

  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(15000)) throw new Error('Otra persona está llenando una fila en este momento. Espera unos segundos e inténtalo de nuevo.');
  try {
    // 1) la fila sigue siendo la que el usuario confirmó (nadie insertó/ordenó filas mientras tanto)
    var info = infoFila_(sh, fila);
    if (datos.esperado && (info.folio !== datos.esperado.folio || info.permiso !== datos.esperado.permiso)) {
      return { ok: false, escritos: [], error: 'La fila ' + fila + ' cambió desde que la elegiste (ahora: folio «' + info.folio + '», permiso «' + info.permiso + '»). Vuelve a elegir la fila.' };
    }

    // 2) plan de escritura: un rango 1×N por bloque, solo columnas de captura
    var nTotal = datos.limpiarResto ? CK.MAX_BLOQUES : bloques.length;
    var plan = [], avisos = [];
    for (var k = 1; k <= nTotal; k++) {
      var cap = capturas_(k), b = bloques[k - 1];
      var valores = cap.campos.map(function (f) { return b ? limpiar_(b[f]) : ''; });
      if (b) CK.CAMPOS.forEach(function (f) {
        if (cap.campos.indexOf(f) < 0 && limpiar_(b[f]) !== '') avisos.push('E' + k + ': «' + b[f] + '» no se escribió porque ese bloque no tiene columna para ese dato.');
      });
      plan.push({ k: k, col: cap.inicio, n: cap.campos.length, campos: cap.campos, result: cap.result, valores: valores, limpiar: !b });
    }
    var ultimaCol = plan[plan.length - 1].col + plan[plan.length - 1].n - 1;
    if (ultimaCol > sh.getMaxColumns()) {
      return { ok: false, escritos: [], error: 'La hoja solo tiene ' + sh.getMaxColumns() + ' columnas (hasta ' + letra_(sh.getMaxColumns()) + ') y se necesitan hasta ' + letra_(ultimaCol) + '. No se escribió nada.' };
    }
    verificaSoloCaptura_(plan);

    // 3) datos existentes que cambiarían → pedir confirmación
    var afectados = info.existentes.filter(function (e) {
      if (e.k > nTotal) return false;
      var p = plan[e.k - 1];
      return p.campos.some(function (f, i) { return String(e[f]).trim() !== p.valores[i].trim(); });
    });
    if (afectados.length && !datos.confirmarSobrescritura) {
      return { necesitaConfirmar: true, info: info, afectados: afectados.map(function (e) { return e.k; }) };
    }

    // 4) protecciones y validaciones estrictas, antes de escribir nada
    var bloqueadas = celdasProtegidas_(sh, fila, plan);
    if (bloqueadas.length) {
      return { ok: false, escritos: [], error: 'No tienes permiso para editar estas celdas protegidas: ' + resumen_(bloqueadas) + '. No se escribió nada. Pide al propietario de la hoja que te dé acceso a esas columnas.' };
    }
    var invalidas = valoresRechazados_(sh, fila, plan);
    if (invalidas.length) {
      return { ok: false, escritos: [], error: 'Estos valores no están en la lista de su celda y la hoja los rechazaría: ' + invalidas.join('; ') + '. Corrígelos en el panel. No se escribió nada.' };
    }

    // 5) respaldo de lo que había, para revertir si algo falla a la mitad
    var ncols = ultimaCol - 2;
    var rFila = sh.getRange(fila, 3, 1, ncols);
    var antes = rFila.getValues()[0], antesF = rFila.getFormulas()[0];

    // 6) escritura
    var escritos = [], aLimpiar = [], tocados = [];
    try {
      plan.forEach(function (p) {
        if (p.limpiar) { aLimpiar.push(p); return; }
        tocados.push(p);
        sh.getRange(fila, p.col, 1, p.n).setValues([p.valores.map(comoTexto_)]);
        escritos.push(p.k);
      });
      if (aLimpiar.length) {
        tocados = tocados.concat(aLimpiar);
        sh.getRangeList(aLimpiar.map(function (p) { return letra_(p.col) + fila + ':' + letra_(p.col + p.n - 1) + fila; })).clearContent();
      }
      SpreadsheetApp.flush();
    } catch (err) {
      var revertido = revertir_(sh, fila, tocados, antes, antesF);
      return {
        ok: false, escritos: escritos, revertido: revertido,
        error: 'Falló la escritura en E' + (escritos.length ? escritos[escritos.length - 1] + 1 : 1) + ': ' + err.message +
          (revertido ? ' Se restauraron los valores anteriores de la fila; no quedó nada a medias.' : ' ¡No se pudieron restaurar los valores anteriores! Bloques escritos: ' + bloquesTxt_(escritos) + '. Revisa la fila a mano.'),
      };
    }

    // 7) leer de vuelta: valores escritos y las descripciones RESULTADO que generan las fórmulas
    var rTras = sh.getRange(fila, 1, 1, plan[plan.length - 1].result);
    var tras = rTras.getValues()[0], trasTxt = rTras.getDisplayValues()[0], trasF = rTras.getFormulas()[0];
    var resultados = [], sinFormula = [];
    plan.forEach(function (p) {
      if (p.limpiar) return;
      p.campos.forEach(function (f, i) {
        var esperado = p.valores[i], real = tras[p.col + i - 1];
        if (esperado !== '' && String(real) !== esperado && !(typeof real === 'string' && real.trim() === esperado.trim())) {
          avisos.push('E' + p.k + ' ' + letra_(p.col + i) + fila + ': se escribió «' + esperado + '» pero la hoja muestra «' + trasTxt[p.col + i - 1] + '».');
        }
      });
      // los bloques vacíos tras cada tanque también generan texto (la sonda del tanque anterior)
      var conDatos = p.valores.some(function (v) { return v !== ''; });
      if (conDatos || trasTxt[p.result - 1] !== '') {
        resultados.push({ k: p.k, celda: letra_(p.result) + fila, texto: trasTxt[p.result - 1] });
      }
      if (conDatos && !trasF[p.result - 1]) sinFormula.push(letra_(p.result) + fila);
    });
    if (sinFormula.length) avisos.push('Estas celdas RESULTADO no tienen fórmula, así que no generan descripción: ' + resumen_(sinFormula) + '.');
    return {
      ok: true, fila: fila, escritos: escritos, limpiados: aLimpiar.map(function (p) { return p.k; }),
      resultados: resultados, avisos: avisos,
    };
  } finally {
    lock.releaseLock();
  }
}

// ---------- ayudantes de escritura ----------

function limpiar_(v) {
  return v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' ');
}

/**
 * Sheets interpreta lo que se escribe como si se tecleara: «0123» → 123, «=…» → fórmula,
 * «1.2» → número. Un apóstrofo inicial lo fuerza a texto (no se ve en la celda).
 */
function comoTexto_(v) {
  if (v === '') return v;
  var t = v.trim();
  var parece = /^[=+\-@']/.test(t) ||
    (/\d/.test(t) && /^[\d\s.,:\/$%()\-]+$/.test(t)) ||
    /^[+\-]?\d+(\.\d+)?e[+\-]?\d+$/i.test(t) ||
    /^(true|false|verdadero|falso)$/i.test(t);
  return parece ? "'" + v : v;
}

/** Defensa extra: ninguna celda del plan puede ser A, B o una columna RESULTADO. */
function verificaSoloCaptura_(plan) {
  var resultado = {};
  for (var k = 1; k <= CK.MAX_BLOQUES; k++) resultado[layout_(k).result] = true;
  plan.forEach(function (p) {
    for (var c = p.col; c < p.col + p.n; c++) {
      if (c <= CK.COL_PERMISO || resultado[c]) throw new Error('Error interno: se intentó escribir la columna ' + letra_(c) + ' (fórmula). No se escribió nada.');
    }
  });
}

/** Celdas del plan dentro de rangos protegidos que el usuario no puede editar. */
function celdasProtegidas_(sh, fila, plan) {
  var malas = [];
  var enPlan = function (c0, c1, r0, r1) {
    if (fila < r0 || fila > r1) return [];
    var out = [];
    plan.forEach(function (p) { for (var c = p.col; c < p.col + p.n; c++) if (c >= c0 && c <= c1) out.push(c); });
    return out;
  };
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (pr) {
    if (pr.canEdit()) return;
    var r = pr.getRange();
    malas = malas.concat(enPlan(r.getColumn(), r.getLastColumn(), r.getRow(), r.getLastRow()));
  });
  // hoja completa protegida: solo se puede escribir en sus rangos sin proteger
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (pr) {
    if (pr.canEdit()) return;
    var libres = pr.getUnprotectedRanges();
    plan.forEach(function (p) {
      for (var c = p.col; c < p.col + p.n; c++) {
        var libre = libres.some(function (r) { return fila >= r.getRow() && fila <= r.getLastRow() && c >= r.getColumn() && c <= r.getLastColumn(); });
        if (!libre) malas.push(c);
      }
    });
  });
  return malas.filter(function (c, i) { return malas.indexOf(c) === i; }).sort(function (a, b) { return a - b; }).map(function (c) { return letra_(c) + fila; });
}

/** Valores que una validación estricta (rechazar entrada) no aceptaría. */
function valoresRechazados_(sh, fila, plan) {
  var listas = listasValidacion_(sh, fila), out = [];
  var n = function (s) { return String(s).trim().toLowerCase(); };
  plan.forEach(function (p) {
    p.valores.forEach(function (v, i) {
      var c = p.col + i;
      if (v === '' || !listas.estrictas[c]) return;
      var lista = listas.cols[c];
      if (lista.indexOf(v) < 0 && !lista.some(function (x) { return n(x) === n(v); })) out.push('E' + p.k + ' ' + letra_(c) + fila + ' «' + v + '»');
    });
  });
  return out;
}

function revertir_(sh, fila, plan, antes, antesF) {
  try {
    plan.forEach(function (p) {
      var vals = [];
      for (var c = p.col; c < p.col + p.n; c++) {
        var v = antes[c - 3];
        // los textos se reescriben como texto para que «0123» no se convierta en número
        vals.push(antesF[c - 3] || (typeof v === 'string' ? comoTexto_(v) : v));
      }
      sh.getRange(fila, p.col, 1, p.n).setValues([vals]);
    });
    SpreadsheetApp.flush();
    return true;
  } catch (e) {
    return false;
  }
}

function resumen_(celdas) {
  return celdas.length > 8 ? celdas.slice(0, 8).join(', ') + ' y ' + (celdas.length - 8) + ' más' : celdas.join(', ');
}

function bloquesTxt_(ks) {
  return ks.length ? ks.map(function (k) { return 'E' + k; }).join(', ') : 'ninguno';
}
