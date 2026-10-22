# Checklist en PDF → bloques para «Inciso E»

Página estática (HTML/CSS/JS sin compilación, apta para GitHub Pages) que lee el checklist en PDF y prepara cada bloque de la pestaña **Inciso E** para pegarlo en Google Sheets **bloque por bloque**.

- Todo se procesa en el navegador con [pdf.js](https://mozilla.github.io/pdf.js/); el PDF no se sube a ningún lado.
- Orden de bloques: tanques (cada uno seguido de un bloque vacío) → una manguera por bloque (`Dispensario N` / producto / `Manguera K`, K consecutiva) → `Consola ` (nombre + serie) → `Sistema Informático ` (nombre + versión).
- Valida contra las listas de validación de la hoja y avisa de diferencias. Cualquier valor se puede editar antes de copiar.

## Por qué por bloques

Las columnas RESULTADO de «Inciso E» están protegidas. Si se pega la fila completa, Sheets la rechaza («El rango de datos que intentas pegar se superpone a algunas celdas protegidas»). Por eso cada bloque se copia y se pega por separado, solo con sus celdas de entrada:

| Bloque | Celdas que se pegan | RESULTADO (protegida, no se toca) |
|---|---|---|
| E1 | C, D, E | F |
| E2 | G | H |
| E3 | I a M | N |
| E4 | O a S | T |
| E5 | U a Y | Z |
| … | 5 columnas por bloque | la 6.ª de cada bloque |

## Uso

1. Abre la página y **arrastra el PDF** (a cualquier parte de la ventana) o haz clic en la zona de carga.
2. Escribe la **fila destino** (por ejemplo `128`) y pulsa <kbd>Enter</kbd>. Con cada PDF nuevo el campo queda seleccionado para confirmar la fila.
3. Revisa los avisos (si hay) y corrige valores directamente en la lista.
4. Copia y pega bloque por bloque:
   - **Modo guiado:** pulsa **Copiar siguiente** o la tecla <kbd>Espacio</kbd> (también <kbd>N</kbd>). El panel muestra en grande la celda donde pegar, por ejemplo `I454`. Ve a Sheets, selecciona esa celda y pega con <kbd>Ctrl</kbd>+<kbd>V</kbd>. Vuelve a la página y pulsa <kbd>Espacio</kbd> otra vez.
   - **Por bloque:** cada bloque tiene su botón **Copiar** y la celda donde va.
   - Truco: en Sheets escribe la celda en el **cuadro de nombre** (arriba a la izquierda, junto a la barra de fórmulas) y pulsa <kbd>Enter</kbd> para saltar directo a ella.
5. Los bloques vacíos (el separador tras cada tanque) aparecen como «Vacío, no se pega»: sáltalos.

Otros controles:

- <kbd>R</kbd> o **Volver a copiar**: copia otra vez el último bloque.
- **Reiniciar**: borra el progreso de la fila.
- El contador («7 de 15») y la franja superior muestran qué bloques ya se copiaron, cuál sigue y dónde están las columnas protegidas. Clic en la franja lleva al bloque.
- Si cambias la fila destino o editas un bloque ya copiado, ese bloque vuelve a quedar pendiente.
- Los atajos no actúan mientras escribes en un campo (pulsa <kbd>Esc</kbd> para salir del campo).

### Qué se copia exactamente

- Texto plano separado por tabuladores, solo las celdas de entrada del bloque. Las celdas vacías también se incluyen, para limpiar lo que hubiera en ellas.
- Los valores que Sheets reinterpretaría (números como `0123`, series de más de 15 dígitos, fechas como `12/05`, horas, `TRUE`/`FALSE`, notación científica como `1E5`, o lo que empieza con `=`, `+`, `-`, `@` o comillas) se pegan **como texto** anteponiendo un apóstrofo, que Sheets no muestra. Se marcan con una línea ámbar en la lista. Se puede desactivar con la casilla al final de la página. Ningún valor de las listas de validación cambia.
- Si el navegador no deja copiar (ni con la API del portapapeles ni con el método alternativo), se abre un cuadro con el texto ya seleccionado para copiarlo con <kbd>Ctrl</kbd>+<kbd>C</kbd>.

### Fila completa (solo referencia)

Al final de la página está la fila completa, con las fórmulas RESULTADO ajustadas a la fila destino. **No se puede pegar de una vez** por las columnas protegidas; sirve para revisar o comparar.

## Archivos

- `index.html`, `style.css`, `app.js`: interfaz.
- `paste.js`: celdas de entrada de cada bloque, celda destino, texto a copiar y portapapeles.
- `core.js`: lectura del PDF, parseo del checklist, construcción y validación de bloques.
- `data.js`: listas de validación y plantillas de fórmulas de la hoja.

Este repositorio no contiene datos de clientes.
