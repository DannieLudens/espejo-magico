/**
 * snap-filter.js
 * ──────────────────────────────────────────────────────────
 * Integración de Snap Camera Kit para filtros AR en el Photo Booth.
 * Solo se activa cuando APP_CONFIG.snap.enabled = true.
 *
 * Flujo:
 *   1. initSnapFilter(canvas)  → carga el SDK via dynamic import y crea sesión
 *   2. applySnapLens(id)       → aplica el lens del presentador activo
 *   3. pauseSnapFilter()       → pausa el render (ej. mientras se muestra el QR)
 *   4. stopSnapFilter()        → limpia la sesión completamente
 *
 * SDK de referencia: https://developers.snap.com/camera-kit/web/
 * CDN del paquete:   https://cdn.jsdelivr.net/npm/@snap/camera-kit@latest
 * ──────────────────────────────────────────────────────────
 */

'use strict';

/* ── Estado interno ──────────────────────────────────────── */
let _cameraKit   = null;
let _session     = null;
let _snapCanvas  = null;
let _initialized = false;

/**
 * URLs del SDK de Snap Camera Kit (se prueban en orden hasta que una funcione).
 *
 * ① Local (Vite build)  — más rápido y confiable; requiere haber ejecutado
 *     cd snap-kit && npm install && npm run build
 *   El output queda en js/snap-kit-bundle.js (importado como módulo ES).
 *
 * ② esm.sh ?bundle      — fuerza a esm.sh a incluir TODAS las dependencias
 *   (incluyendo browser-headers) dentro del mismo archivo, evitando el error
 *   "does not provide an export named 'BrowserHeaders'".
 *
 * ③ esm.sh (sin bundle) — fallback: puede fallar con el error de browser-headers.
 */
const SNAP_SDK_URLS = [
  // ① Build local generado con: cd snap-kit && npm run build
  //   El dynamic import() en scripts clásicos resuelve relativo al script mismo
  //   (js/snap-filter.js → js/snap-kit-bundle.js), NO relativo al documento.
  './snap-kit-bundle.js',
  // ② esm.sh con ?bundle: fuerza a incluir TODAS las dependencias inline
  //   (resuelve el error "does not provide an export named 'BrowserHeaders'")
  'https://esm.sh/@snap/camera-kit?bundle',
  // ③ Versión pinned + bundled como último recurso
  'https://esm.sh/@snap/camera-kit@0.9.14?bundle',
];

/* ─────────────────────────────────────────────────────────── */

/**
 * Inicializa Snap Camera Kit y crea la sesión de render.
 *
 * @param {HTMLCanvasElement} renderCanvas
 *   Canvas donde Snap renderizará el video con el filtro AR aplicado.
 *   Debe ser el mismo elemento #photobooth-canvas del DOM.
 *
 * @returns {Promise<boolean>} true si la inicialización fue exitosa
 */
async function initSnapFilter(renderCanvas) {
  if (!APP_CONFIG.snap.enabled) {
    console.log('[SnapFilter] Deshabilitado en APP_CONFIG.snap.enabled');
    return false;
  }

  if (_initialized && _session) {
    console.log('[SnapFilter] Ya inicializado, reutilizando sesión.');
    return true;
  }

  try {
    /* ── Cargar el SDK: probar URLs en orden hasta que una funcione ── */
    let snapSDK = null;
    let lastErr  = null;

    for (const url of SNAP_SDK_URLS) {
      try {
        console.log('[SnapFilter] Probando SDK desde:', url);
        snapSDK = await import(url);
        if (snapSDK?.bootstrapCameraKit) {
          console.log('[SnapFilter] SDK cargado desde:', url);
          break;
        }
        snapSDK = null;
      } catch (e) {
        lastErr = e;
        console.warn('[SnapFilter] Falló', url, '—', e.message?.slice(0, 120));
      }
    }

    if (!snapSDK?.bootstrapCameraKit) {
      throw lastErr || new Error(
        'Ninguna URL del SDK funcionó. Opciones:\n' +
        '  A) cd snap-kit && npm install && npm run build   (genera js/snap-kit-bundle.js)\n' +
        '  B) Verifica conectividad a esm.sh'
      );
    }

    const { bootstrapCameraKit, createMediaStreamSource, Transform2D } = snapSDK;

    /* ── Inicializar Camera Kit con el token de la app ── */
    _cameraKit = await bootstrapCameraKit({
      apiToken: APP_CONFIG.snap.apiToken
    });

    /* ── Crear sesión de render usando el canvas EXCLUSIVO de Snap ──
     *
     * IMPORTANTE: Snap Camera Kit llama internamente a
     *   canvas.transferControlToOffscreen()
     * lo que falla con InvalidStateError si el canvas ya tiene un
     * contexto 2D/WebGL. Por eso usamos #snap-canvas, que nunca debe
     * tener getContext() llamado en ningún otro lugar del código.
     * NO usar renderCanvas (= #photobooth-canvas) porque photo-booth.js
     * ya le asignó un contexto 2D.
     */
    const snapCanvasEl = document.getElementById('snap-canvas');
    if (!snapCanvasEl) {
      throw new Error(
        '#snap-canvas no encontrado en el DOM. ' +
        'Asegúrate de tener <canvas id="snap-canvas"> en index.html.'
      );
    }
    _snapCanvas = snapCanvasEl;

    const session = await _cameraKit.createSession({
      liveRenderTarget: _snapCanvas
    });
    _session = session;

    /* ── Obtener el stream de la webcam ya abierta por MediaPipe ── */
    const webcamEl = document.getElementById('webcam');
    if (!webcamEl || !webcamEl.srcObject) {
      throw new Error('Stream de webcam no disponible. ' +
        'Asegúrate de llamar a initSnapFilter() después de initHandTracker().');
    }

    /* Transform2D.MirrorX espeja horizontalmente el feed de la cámara ANTES
     * del render de los lens AR, de modo que el resultado sea como un espejo
     * real. Es la forma correcta — si se hace solo con CSS el tracking de cara
     * sigue en coordenadas sin espejo y puede perder precisión en los bordes. */
    const mirrorTransform = (Transform2D && Transform2D.MirrorX != null)
      ? Transform2D.MirrorX
      : undefined;

    const sourceOptions = mirrorTransform != null
      ? { transform: mirrorTransform, cameraType: 'user' }
      : { cameraType: 'user' };

    const source = createMediaStreamSource(webcamEl.srcObject, sourceOptions);
    await session.setSource(source);
    console.log('[SnapFilter] Mirror mode:',
      mirrorTransform != null ? 'Transform2D.MirrorX (SDK)' : 'sin mirror (Transform2D no disponible)');

    /* Configurar resolución de render */
    await session.source.setRenderSize(
      APP_CONFIG.photobooth.photoWidth,
      APP_CONFIG.photobooth.photoHeight
    );

    _initialized = true;
    console.log('[SnapFilter] ✅ Inicializado correctamente.');
    return true;

  } catch (err) {
    console.error('[SnapFilter] ❌ Error al inicializar:', err.message || err);
    console.info('[SnapFilter] El photobooth usará el filtro de Face Mesh como fallback.');
    _initialized = false;
    return false;
  }
}

/* ─────────────────────────────────────────────────────────── */

/**
 * Aplica el lens de maquillaje del presentador activo.
 *
 * Requiere que en APP_CONFIG.snap.lensIds[presenterId] haya un UUID válido
 * obtenido en Snap Developer Portal → EspejoMagicoUPB → Camera Kit → Lenses.
 *
 * @param {string} presenterId  - ej. 'p_noticias', 'ph_deportes'
 * @returns {Promise<boolean>}
 */
async function applySnapLens(presenterId) {
  if (!_session || !_cameraKit) {
    console.warn('[SnapFilter] applySnapLens() llamado sin sesión activa.');
    return false;
  }

  const lensId  = APP_CONFIG.snap.lensIds[presenterId];
  const groupId = APP_CONFIG.snap.lensGroupId;

  /* Validar que los IDs estén configurados (no son placeholders) */
  if (!lensId || lensId.startsWith('TU_')) {
    console.warn(
      `[SnapFilter] Lens ID no configurado para "${presenterId}".`,
      '\nSigue estos pasos:',
      '\n  1. Ve a https://my.developer.snap.com',
      '\n  2. App EspejoMagicoUPB → Camera Kit → Lenses',
      '\n  3. Crea/agrega lentes a un Lens Group',
      '\n  4. Copia el UUID del lente y pégalo en APP_CONFIG.snap.lensIds'
    );
    return false;
  }

  if (!groupId || groupId.startsWith('TU_')) {
    console.warn(
      '[SnapFilter] lensGroupId no configurado.',
      '\nCópialo desde Snap Developer Portal → Camera Kit → Lens Groups.'
    );
    return false;
  }

  try {
    const lens = await _cameraKit.lensRepository.loadLens(lensId, groupId);
    await _session.applyLens(lens);
    await _session.play();
    console.log(`[SnapFilter] ✅ Lens "${lensId}" aplicado (${presenterId})`);
    return true;
  } catch (err) {
    console.error(`[SnapFilter] Error al aplicar lens "${lensId}":`, err.message || err);
    return false;
  }
}

/* ─────────────────────────────────────────────────────────── */

/**
 * Pausa el render de Snap Camera Kit.
 * Útil al capturar la foto o al mostrar el QR.
 */
async function pauseSnapFilter() {
  if (_session) {
    try { await _session.pause(); } catch (_) {}
  }
}

/**
 * Detiene y limpia la sesión completamente.
 * Llamar al salir del modo photobooth.
 */
async function stopSnapFilter() {
  try {
    if (_session) {
      await _session.pause();
      /* Camera Kit v0.9+: removeLens() limpia el lens activo */
      if (typeof _session.removeLens === 'function') {
        await _session.removeLens();
      }
    }
  } catch (_) {
    /* ignorar errores de limpieza */
  } finally {
    _session     = null;
    _initialized = false;
    console.log('[SnapFilter] Sesión detenida.');
  }
}
