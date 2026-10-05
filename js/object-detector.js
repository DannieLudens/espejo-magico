/**
 * object-detector.js
 * Reconocimiento de objetos físicos con modelo Teachable Machine (TF.js).
 *
 * Flujo:
 *   1. initObjectDetector()  → carga el modelo una sola vez al arrancar la app.
 *   2. startDetecting(videoEl, labels, onDetected) → durante el idle, analiza
 *      frames de la webcam cada _DET_INTERVAL_MS ms.
 *      Cuando el objeto correcto se mantiene ≥ _DET_HOLD_MS, llama onDetected().
 *   3. stopDetecting() → limpia el loop (al salir del idle o al avanzar).
 *
 * Degradación: si el modelo no cargó (sin internet, archivo faltante…)
 * las funciones son no-op — el usuario puede seguir usando el gesto pinza.
 */

'use strict';

/* ── Configuración ────────────────────────────────────── */
const _DET_MODEL_URL   = 'assets/model/model.json';
const _DET_META_URL    = 'assets/model/metadata.json';
const _DET_CONFIDENCE  = 0.78;   // confianza mínima para considerar detección válida
const _DET_HOLD_MS     = 1500;   // ms que el objeto debe mantenerse detectado
const _DET_INTERVAL_MS = 280;    // ms entre frames analizados (~3.5 fps — suficiente)

/* ── Estado interno ───────────────────────────────────── */
let _detModel     = null;
let _detReady     = false;
let _detLoopId    = null;
let _detHoldStart = null;

/* ── Inicialización ───────────────────────────────────── */

/**
 * Carga el modelo TM desde assets/model/.
 * Debe llamarse una sola vez al arrancar la app (fire-and-forget).
 */
async function initObjectDetector() {
  if (!window.tmImage) {
    console.warn('[Detector] @teachablemachine/image no disponible — sin reconocimiento.');
    return;
  }
  try {
    _detModel = await window.tmImage.load(_DET_MODEL_URL, _DET_META_URL);
    _detReady = true;
    console.log('[Detector] Modelo listo —',
      _detModel.getTotalClasses(), 'clases cargadas.');
  } catch (e) {
    console.error('[Detector] Error cargando modelo:', e);
  }
}

/* ── API pública ──────────────────────────────────────── */

/**
 * Inicia el loop de detección sobre el videoEl de la webcam.
 *
 * @param {HTMLVideoElement} videoEl       — fuente de imagen (webcam global)
 * @param {string[]}         acceptedLabels — etiquetas TM que cuentan como "correcto"
 * @param {function}         onDetected    — callback cuando el objeto se mantiene detectado
 */
function startDetecting(videoEl, acceptedLabels, onDetected) {
  stopDetecting();   // limpiar loop anterior por si quedó activo

  if (!_detReady || !videoEl || !acceptedLabels?.length) {
    console.warn('[Detector] No disponible — loop de detección omitido.');
    return;
  }

  _detHoldStart = null;
  _detSetStatus('scanning');
  console.log('[Detector] Buscando:', acceptedLabels.join(' / '));

  _detLoopId = setInterval(async () => {
    /* Esperar a que el video tenga datos reales */
    if (!videoEl.videoWidth || videoEl.readyState < 2) return;

    let predictions;
    try {
      predictions = await _detModel.predict(videoEl);
    } catch (e) {
      return;   // skip frame silencioso en caso de error puntual
    }

    /* La predicción más probable */
    const best = predictions.reduce((a, b) =>
      a.probability > b.probability ? a : b
    );

    const detected = acceptedLabels.includes(best.className) &&
                     best.probability >= _DET_CONFIDENCE;

    /* Actualizar UI de feedback */
    _detUpdateUI(best.className, best.probability, detected);

    if (detected) {
      if (!_detHoldStart) _detHoldStart = Date.now();

      const elapsed  = Date.now() - _detHoldStart;
      const progress = Math.min(elapsed / _DET_HOLD_MS, 1);
      _detSetHoldProgress(progress);

      if (elapsed >= _DET_HOLD_MS) {
        stopDetecting();
        _detSetStatus('confirmed');
        console.log('[Detector] Objeto confirmado:', best.className,
          `(${(best.probability * 100).toFixed(0)}%)`);
        onDetected();
      }
    } else {
      /* Objeto perdido o cambiado: reiniciar el hold */
      if (_detHoldStart) {
        _detHoldStart = null;
        _detSetHoldProgress(0);
      }
    }
  }, _DET_INTERVAL_MS);
}

/**
 * Detiene el loop de detección y resetea el feedback visual.
 * Seguro llamarlo aunque no haya loop activo.
 */
function stopDetecting() {
  if (_detLoopId !== null) {
    clearInterval(_detLoopId);
    _detLoopId = null;
  }
  _detHoldStart = null;
  _detSetHoldProgress(0);
  _detSetStatus('idle');
}

/* ── Feedback visual ──────────────────────────────────── */

function _detUpdateUI(className, probability, detected) {
  const labelEl  = document.getElementById('det-label');
  const cameraEl = document.getElementById('exp-idle-camera');

  if (labelEl) {
    if (detected) {
      labelEl.textContent = '✓ ¡Objeto detectado! Mantén quieto…';
    } else if (className === 'Ninguno') {
      labelEl.textContent = 'Acerca el objeto a la cámara';
    } else {
      /* Muestra el nombre del objeto que está viendo (aunque no sea el correcto) */
      labelEl.textContent = 'Buscando…';
    }
  }

  /* Borde verde en la cámara cuando detecta correctamente */
  if (cameraEl) {
    cameraEl.classList.toggle('det-detected', detected);
  }
}

function _detSetHoldProgress(value) {
  const fillEl = document.getElementById('det-hold-fill');
  if (fillEl) fillEl.style.width = (value * 100) + '%';
}

function _detSetStatus(status) {
  const container = document.getElementById('det-feedback');
  if (container) container.dataset.status = status;
}
