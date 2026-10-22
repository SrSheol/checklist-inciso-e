# Checklist MECV → fila «Inciso E»

Página estática que convierte un checklist MECV (PDF) en una fila separada por tabuladores lista para pegar en la pestaña **Inciso E** (a partir de la columna C).

- Todo se procesa en el navegador con [pdf.js](https://mozilla.github.io/pdf.js/); el PDF no se sube a ningún lado.
- Orden de bloques: tanques (cada uno seguido de un bloque vacío) → una manguera por bloque (`Dispensario N` / producto / `Manguera K`, K consecutiva) → `Consola ` → `Sistema Informático `.
- Cada bloque incluido lleva la fórmula de su columna RESULTADO ajustada a la fila destino.
- Valida contra las listas de validación de la hoja y avisa de diferencias.

Uso: abre la página, arrastra el PDF, escribe la fila destino, revisa/edita, pulsa **Copiar fila**, haz clic en la columna C de esa fila en Inciso E y pega con Ctrl+V.

Este repositorio no contiene datos de clientes.
