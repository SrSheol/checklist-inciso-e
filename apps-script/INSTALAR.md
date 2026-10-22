# Instalar «Checklist → Inciso E» en la hoja de Google

Con esto, la hoja tendrá un menú **Checklist → Llenar Inciso E desde checklist…** que abre un panel a la derecha. En el panel cargas el PDF del checklist, revisas los bloques y pulsas **Llenar fila**. El script escribe solo en las columnas de captura de la fila y se salta las columnas RESULTADO protegidas, así que ya no aparece el error de celdas protegidas al pegar.

Solo hay que instalarlo **una vez por hoja**. Tardas unos 10 minutos.

## Lo que necesitas

- Ser **editor** de la hoja (lo ideal es que lo instale el propietario).
- Los 4 archivos de esta carpeta `apps-script`:

| Archivo de esta carpeta | Nombre en Apps Script | Tipo |
|---|---|---|
| `Code.gs` | `Código` (o `Code`) | Secuencia de comandos |
| `Sidebar.html` | `Sidebar` | HTML |
| `Core.html` | `Core` | HTML |
| `appsscript.json` | `appsscript.json` | Manifiesto |

Abre cada archivo con el Bloc de notas (clic derecho → *Abrir con* → *Bloc de notas*) para copiar su contenido.

## Paso 1. Abre el editor de Apps Script

1. Abre la hoja de Google en el navegador.
2. En el menú de arriba, entra a **Extensiones → Apps Script**. Se abre una pestaña nueva con el editor.
3. A la izquierda, en **Archivos**, verás un archivo llamado **Código.gs**.

> **Si `Código.gs` ya tiene código (no solo `function myFunction() {}`)**, alguien ya instaló otro script en esta hoja. **No lo borres.** Sigue con el *Paso 2-B*.

## Paso 2. Pega el código principal

**2-A. Proyecto vacío (lo normal)**

1. Haz clic en **Código.gs**.
2. Selecciona todo su contenido (**Ctrl+A**) y bórralo.
3. Abre `Code.gs` de esta carpeta, copia todo (**Ctrl+A**, **Ctrl+C**) y pégalo en el editor (**Ctrl+V**).

**2-B. El proyecto ya tenía código**

1. Junto a **Archivos**, haz clic en **＋** → **Secuencia de comandos** y llámalo `Checklist`.
2. Pega ahí todo el contenido de `Code.gs`.
3. Usa **Ctrl+F** para buscar `function onOpen` en los demás archivos. Si ya existe otro `onOpen`:
   - borra estas líneas del archivo `Checklist`:
     ```
     function onOpen(e) {
       crearMenuChecklist();
     }
     ```
   - y dentro del `onOpen` que ya existía, agrega la línea `crearMenuChecklist();`.

## Paso 3. Crea los dos archivos HTML

1. Junto a **Archivos**, haz clic en **＋** → **HTML**.
2. Escribe el nombre **`Sidebar`** (exactamente así, con S mayúscula y sin `.html`; el editor lo agrega solo) y pulsa Enter.
3. Borra lo que trae el archivo nuevo y pega todo el contenido de `Sidebar.html`.
4. Repite con otro archivo HTML llamado **`Core`** y pega el contenido de `Core.html`.

## Paso 4. Ajusta los permisos (manifiesto)

Este paso hace que el script pida **solo** los dos permisos que necesita.

1. A la izquierda, haz clic en el engrane **⚙ Configuración del proyecto**.
2. Marca la casilla **«Mostrar el archivo de manifiesto "appsscript.json" en el editor»**.
3. Regresa al editor (icono **< >** a la izquierda) y abre **appsscript.json**.
4. Reemplaza todo su contenido por el de `appsscript.json` de esta carpeta.

> **Si hiciste el Paso 2-B** (ya había otro script), no reemplaces el archivo completo: en la lista `"oauthScopes"` que ya tenga, agrega las dos líneas de este manifiesto. Si no existe `"oauthScopes"`, puedes saltarte este paso y Google calculará los permisos solo.

## Paso 5. Guarda

Pulsa el icono de disquete **💾 Guardar proyecto** (o **Ctrl+S**). Revisa que ningún archivo muestre un punto o asterisco de «sin guardar».

Ponle nombre al proyecto (arriba a la izquierda, donde dice *Proyecto sin título*), por ejemplo `Checklist Inciso E`. Ese nombre es el que verás al autorizar en el Paso 7.

## Paso 6. Recarga la hoja

1. Vuelve a la pestaña de la hoja y **recárgala** (**F5**).
2. Espera unos segundos: junto a *Ayuda* aparecerá el menú **Checklist**.

## Paso 7. Autoriza la primera vez

La primera vez que uses **Checklist → Llenar Inciso E desde checklist…**, Google pide permiso. Esto le pasa a **cada persona** la primera vez que lo usa.

1. Aparece **«Se requiere autorización»** → pulsa **Continuar** (o **Revisar permisos**).
2. Elige tu cuenta de Google.
3. Si aparece **«Google no verificó esta app»**: es normal en scripts hechos para una sola hoja. Pulsa **Configuración avanzada** (o *Avanzado*) → **Ir a Checklist Inciso E (no seguro)** (aparece el nombre que le pusiste al proyecto en el Paso 5). En cuentas de empresa puede que esta pantalla no aparezca.
4. Revisa los permisos y pulsa **Permitir**:
   - *Ver y administrar las hojas de cálculo en las que se instaló esta aplicación*: solo esta hoja, no tu Drive.
   - *Mostrar y ejecutar contenido web de terceros en mensajes y barras laterales*: es el panel lateral.
5. Vuelve a abrir **Checklist → Llenar Inciso E desde checklist…**.

## Cómo se usa

1. En la pestaña **Inciso E**, haz clic en cualquier celda de la fila que quieres llenar. El panel toma esa fila al abrirse. También puedes escribir el **Folio Acta** (p. ej. `00123`), el **permiso** o el número de fila en el buscador. Si cambias de celda con el panel abierto, pulsa **↺ Usar la celda seleccionada**.
2. Revisa el folio y el permiso de la fila. Cuando cargues el PDF, el panel te avisa si el permiso del checklist **no coincide** con la columna B.
3. Carga el PDF del checklist (clic en el recuadro o arrástralo). El PDF se lee en tu navegador y **nunca se sube** a ningún lado.
4. Revisa los bloques. Haz clic en un bloque para editarlo, moverlo, insertar uno vacío o borrarlo. Lo marcado en rojo no está en la lista de validación de la hoja.
5. Si la fila ya tenía datos de bloques más a la derecha que ya no aplican, marca **Limpiar bloques sobrantes a la derecha**. Solo borra celdas de captura, nunca fórmulas.
6. Pulsa **Llenar fila N**. Si la fila ya tenía datos distintos, o si el permiso no coincide, el panel te muestra qué va a cambiar y te pide confirmar.
7. Al terminar, el panel muestra las descripciones que generaron las fórmulas RESULTADO de la hoja.

## Qué hace (y qué no hace) el script

- Escribe **solo** en las columnas de captura: C–E (E1), G (E2) y las 5 primeras columnas de cada bloque desde E3. **Nunca** escribe en A, B ni en ninguna columna RESULTADO.
- Antes de escribir revisa las protecciones de la hoja. Si alguna celda de captura está protegida y tú no puedes editarla, no escribe nada y te dice cuáles son.
- Si una celda tiene validación que **rechaza** valores fuera de la lista y el valor no está en ella, no escribe nada y te dice cuál corregir.
- Si algo falla a la mitad, **restaura** los valores anteriores de la fila y te dice qué pasó.
- Las series y versiones que parecen números (por ejemplo `00123` o `1.20`) se escriben como texto para que no pierdan ceros.
- Evita que dos personas llenen filas al mismo tiempo (la segunda espera unos segundos).
- Solo tiene acceso a esta hoja de cálculo.

## Problemas frecuentes

| Mensaje o síntoma | Qué hacer |
|---|---|
| No aparece el menú **Checklist** | Recarga la hoja y espera 10 segundos. Revisa que guardaste todos los archivos (Paso 5). Si sigue sin aparecer, en el editor de Apps Script elige la función `crearMenuChecklist` en la lista de arriba y pulsa **▶ Ejecutar**. Te pedirá autorizar (Paso 7). Después recarga la hoja. |
| Al abrir el panel sale «No se encontró el archivo HTML llamado Sidebar» (o Core) | El archivo HTML no se llama exactamente `Sidebar` o `Core`. Renómbralo en el editor (tres puntos junto al archivo → *Cambiar nombre*). |
| «No existe la pestaña «Inciso E»» | La pestaña debe llamarse exactamente `Inciso E`. Si se llama distinto, cambia `HOJA: 'Inciso E'` al principio de `Código.gs` y guarda. |
| «No se pudo cargar el lector de PDF (pdf.js)» | El panel descarga el lector de PDF de internet (cdn.jsdelivr.net o unpkg.com). Revisa tu conexión o pide a sistemas que permitan esos sitios. |
| «El PDF no contiene texto seleccionable» | Es un PDF escaneado (una imagen). Usa el PDF original del checklist o captura los bloques a mano en el panel. |
| «No tienes permiso para editar estas celdas protegidas» | El propietario debe darte permiso sobre las columnas de captura. Las columnas RESULTADO pueden seguir protegidas. |
| «La fila N cambió desde que la elegiste» | Alguien insertó, borró u ordenó filas. Vuelve a elegir la fila. |
| «Otra persona está llenando una fila» | Espera unos segundos y vuelve a pulsar **Llenar fila**. |
| Un valor sale en rojo | No está en la lista de validación de esa columna. Elige uno de la lista (aparece al escribir) o usa la sugerencia. |

## Para quien mantenga el código

- `Core.html` es una copia de `core.js` de la web app (las diferencias están anotadas con `[AS]` al inicio del archivo). Si cambias el parseo en `core.js`, haz el mismo cambio en `Core.html`.
- Las listas de validación se leen de la hoja cada vez que abres el panel o cambias de fila. Las listas dentro de `Core.html` (copiadas de `data.js`) solo se usan si la hoja no tiene validaciones.
