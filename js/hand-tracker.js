/**
 * hand-tracker.js
 * Motor de detección de mano con MediaPipe Hands (API legacy v0.4).
 * Emite CustomEvents en `document`:
 *   - 'handMove'       { x, y }              índice en coords de pantalla
 *   - 'handLost'                              mano desapareció del frame
 *   - 'pinchStart'     { x, y }              pinza iniciada
 *   - 'pinchProgress'  { x, y, progress }    0..1 durante el hold
 *   - 'pinchConfirmed' { x, y }              hold completado (1.5 s)
 *   - 'pinchEnd'                              pinza soltada antes de confirmar
 */

'use strict';

/* ── Constantes tunables ─────────────────────────────────── */
const PINCH_THRESHOLD = 0.07;   // distancia normalizada pulgar[4]–índice[8]
const PINCH_HOLD_MS   = 1500;   // ms de hold para confirmar
const LERP_ALPHA      = 0.18;   // suavizado de la posición del índice (0=fijo, 1=crudo)

/* ── Estado interno ──────────────────────────────────────── */
let _handsInstance  = null;
let _cameraInstance = null;
let _pinchStart          = null;   // timestamp Date.now() del inicio de pinza
let _waitingForRelease   = false;  // true tras pinchConfirmed hasta que el usuario suelte la mano
let _handVisible    = false;       // ¿hay mano en frame?
let _debugCanvas    = null;
let _debugCtx       = null;

/* Coordenadas suavizadas del índice */
let _smoothX = -200;
let _smoothY = -200;

/* ── API pública ─────────────────────────────────────────── */

/**
 * Inicializa MediaPipe Hands y arranca la cámara.
 * @param {HTMLVideoElement} videoEl  - elemento #webcam
 * @param {HTMLCanvasElement} [canvasEl] - #handCanvas para debug opcional
 * @returns {Promise<void>}
 */
async function initHandTracker(videoEl, canvasEl) {
  _debugCanvas = canvasEl || document.getElementById('handCanvas');
  if (_debugCanvas) {
    _debugCtx = _debugCanvas.getContext('2d');
  }

  /* Solicitar acceso a cámara */
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    videoEl.srcObject = stream;
    await videoEl.play();
    console.log('[HandTracker] Cámara iniciada:', stream.getVideoTracks()[0].label);
  } catch (err) {
    console.warn('[HandTracker] Sin acceso a cámara — modo fallback ratón activo.', err);
    return;   // seguirá funcionando con el fallback de ratón en cursor.js
  }

  /* Crear instancia de Hands */
  _handsInstance = new Hands({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`
  });

  _handsInstance.setOptions({
    maxNumHands:            1,
    modelComplexity:        1,      // 1 = full (más preciso, menos falsos positivos)
    minDetectionConfidence: 0.85,   // subido de 0.70 → reduce detecciones de rostro
    minTrackingConfidence:  0.75    // subido de 0.60 → descarta tracks espúrios más rápido
  });

  _handsInstance.onResults(_onResults);

  /* Usar Camera helper para enviar frames continuamente */
  _cameraInstance = new Camera(videoEl, {
    onFrame: async () => {
      if (_handsInstance) {
        await _handsInstance.send({ image: videoEl });
      }
    },
    width: 1280,
    height: 720
  });

  await _cameraInstance.start();
  console.log('[HandTracker] MediaPipe Hands listo.');
}

/** Detiene la cámara y MediaPipe */
function stopHandTracker() {
  _cameraInstance?.stop();
  _cameraInstance = null;
  _handsInstance  = null;
}

/* ── Callback de resultados ──────────────────────────────── */

function _onResults(results) {
  /* Ajustar tamaño del canvas de debug al viewport */
  if (_debugCanvas) {
    _debugCanvas.width  = window.innerWidth;
    _debugCanvas.height = window.innerHeight;
    _debugCtx.clearRect(0, 0, _debugCanvas.width, _debugCanvas.height);
  }

  /* Sin mano detectada */
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    if (_handVisible) {
      _handVisible = false;
      _resetPinch(true);
      document.dispatchEvent(new CustomEvent('handLost'));
    }
    return;
  }

  _handVisible = true;
  const lm = results.multiHandLandmarks[0];

  /* ── Posición del dedo índice (landmark 8) ── */
  // X se invierte porque la webcam entrega imagen espejada
  const rawX = (1 - lm[8].x) * window.innerWidth;
  const rawY =       lm[8].y  * window.innerHeight;

  // Lerp para suavizar movimiento
  _smoothX = _lerp(_smoothX, rawX, LERP_ALPHA);
  _smoothY = _lerp(_smoothY, rawY, LERP_ALPHA);

  document.dispatchEvent(new CustomEvent('handMove', {
    detail: { x: _smoothX, y: _smoothY }
  }));

  /* ── Detección de pinza (pulgar[4] ↔ índice[8]) ── */
  const dist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
  _updatePinch(dist < PINCH_THRESHOLD, { x: _smoothX, y: _smoothY });

  /* ── Debug: dibujar skeleton ── */
  if (_debugCanvas && _debugCanvas.style.opacity !== '0') {
    _drawDebug(results, lm, dist < PINCH_THRESHOLD);
  }
}

/* ── Máquina de estado de pinza ──────────────────────────── */

function _updatePinch(isPinched, pos) {
  if (isPinched) {
    /* Si ya se confirmó una pinza, esperar a que el usuario abra la mano
     * antes de aceptar otra. Esto evita el "spam" de pinchConfirmed
     * mientras se mantiene la pinza sostenida. */
    if (_waitingForRelease) return;

    if (_pinchStart === null) {
      _pinchStart = Date.now();
      document.dispatchEvent(new CustomEvent('pinchStart', { detail: pos }));
    }

    const elapsed  = Date.now() - _pinchStart;
    const progress = Math.min(elapsed / PINCH_HOLD_MS, 1);

    document.dispatchEvent(new CustomEvent('pinchProgress', {
      detail: { ...pos, progress }
    }));

    if (progress >= 1) {
      document.dispatchEvent(new CustomEvent('pinchConfirmed', { detail: pos }));
      console.log('[HandTracker] PINCH CONFIRMED');
      _pinchStart        = null;
      _waitingForRelease = true;   // bloquear hasta que se suelte la mano
    }
  } else {
    _resetPinch(false);
  }
}

function _resetPinch(fromHandLost) {
  if (_pinchStart !== null) {
    /* Solo emitir pinchEnd si la pinza no llegó a confirmarse */
    if (!_waitingForRelease) {
      document.dispatchEvent(new CustomEvent('pinchEnd'));
    }
    _pinchStart = null;
  }
  _waitingForRelease = false;   // la mano se abrió → permitir la siguiente pinza
}

/* ── Debug visual ────────────────────────────────────────── */

function _drawDebug(results, lm, isPinched) {
  if (!_debugCtx) return;
  const ctx = _debugCtx;
  const W = _debugCanvas.width, H = _debugCanvas.height;

  // Dibujar conexiones con drawConnectors de MediaPipe
  if (window.drawConnectors && window.HAND_CONNECTIONS) {
    ctx.save();
    // El canvas de debug se dibuja con coordenadas de pantalla espejadas
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    drawConnectors(ctx, results.multiHandLandmarks[0], HAND_CONNECTIONS, {
      color: isPinched ? '#FFD700' : 'rgba(255,255,255,0.6)',
      lineWidth: 2
    });
    drawLandmarks(ctx, results.multiHandLandmarks[0], {
      color: isPinched ? '#FFD700' : 'rgba(255,200,100,0.9)',
      lineWidth: 1,
      radius: 3
    });
    ctx.restore();
  }

  // Mostrar distancia de pinza (útil para calibrar PINCH_THRESHOLD)
  if (results.multiHandLandmarks.length > 0) {
    const d = Math.hypot(
      lm[4].x - lm[8].x,
      lm[4].y - lm[8].y
    ).toFixed(3);
    ctx.fillStyle = isPinched ? '#FFD700' : 'rgba(255,255,255,0.7)';
    ctx.font = '14px monospace';
    ctx.fillText(`pinch dist: ${d}  (threshold: ${PINCH_THRESHOLD})`, 16, 20);
  }
}

/* ── Helpers ─────────────────────────────────────────────── */

function _lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Exponer para que cursor.js pueda acceder a la posición suavizada
 * sin necesidad de escuchar eventos (útil para inicializar posición).
 */
function getSmoothedIndexPosition() {
  return { x: _smoothX, y: _smoothY };
}
