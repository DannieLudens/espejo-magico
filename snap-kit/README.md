# snap-kit — Build de Snap Camera Kit para Espejo Mágico

## ¿Para qué sirve esto?

El SDK oficial de Snap Camera Kit para Web requiere un bundler (Vite/npm)
porque usa archivos `.wasm` que necesitan ser co-ubicados con el JS.

**Si `snap-filter.js` carga bien desde `esm.sh` → no necesitas este paso.**

Si ves errores como `Failed to fetch WASM` o `Module not found` en la consola
con `snap.enabled: true`, sigue estos pasos para hacer el build.

---

## Pasos (una sola vez)

### Requisitos
- Node.js instalado (https://nodejs.org)

### 1 — Instalar dependencias

Abre una terminal en esta carpeta (`EspejoMagico_Web/snap-kit/`) y ejecuta:

```bash
npm install
```

### 2 — Build

```bash
npm run build
```

Esto genera `../js/snap-kit-bundle.js` — un archivo JS único con Camera Kit incluido
que expone `window.SnapCameraKit` globalmente.

### 3 — Activar en `index.html`

Descomenta esta línea en `index.html` (está comentada por defecto):

```html
<!-- <script src="js/snap-kit-bundle.js"></script> -->
```

Y cambia en `snap-filter.js` la constante:

```js
// De:
const SNAP_SDK_CDN = 'https://esm.sh/@snap/camera-kit';

// A:
const SNAP_SDK_CDN = null;  // usa window.SnapCameraKit (cargado vía bundle)
```

---

## ¿Cuándo necesito esto?

Solo si la carga desde `esm.sh` falla. Para la mayoría de instalaciones con
conexión a internet, el CDN funciona directamente sin este paso.

---

## Archivos de este directorio

| Archivo | Descripción |
|---|---|
| `package.json` | Dependencias (solo `@snap/camera-kit` y `vite`) |
| `vite.config.js` | Configuración de build — genera `snap-kit-bundle.js` |
| `src/snap-bridge.js` | Entry point que expone Camera Kit como global |
| `README.md` | Este archivo |
