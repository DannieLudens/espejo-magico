/**
 * face-filter.js
 * ──────────────────────────────────────────────────────────
 * Filtro AR de maquillaje usando MediaPipe Face Mesh.
 * Detecta 468 landmarks faciales y pinta:
 *   - Labios (contorno outer + inner)
 *   - Sombra de ojos (elipse sobre cada ojo)
 *   - Rubor (círculos suaves en mejillas)
 *
 * API pública:
 *   initFaceFilter(videoEl, canvasEl)  → Promise<void>
 *   setMakeupPreset(preset)            → void
 *   stopFaceFilter()                   → void
 *   isFaceFilterReady()                → bool
 * ──────────────────────────────────────────────────────────
 */

'use strict';

/* ── Landmarks del rostro (índices de MediaPipe FaceMesh) ── */

// Contorno exterior de los labios (sentido horario)
const LIPS_OUTER = [
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409,
  291, 375, 321, 405, 314, 17, 84, 181, 91, 146
];
// Contorno interior de los labios
const LIPS_INNER = [
  78, 191, 80, 81, 82, 13, 312, 311, 310, 415,
  308, 324, 318, 402, 317, 14, 87, 178, 88, 95
];

// Ojo izquierdo (desde perspectiva del sujeto)
const LEFT_EYE   = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
// Ojo derecho (desde perspectiva del sujeto)
const RIGHT_EYE  = [33,  7,  163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];

// Puntos de referencia para mejillas (zona de blush)
const LEFT_CHEEK_CENTER  = [116, 123, 147, 187, 207];   // mejilla izquierda del sujeto
const RIGHT_CHEEK_CENTER = [345, 352, 376, 411, 427];   // mejilla derecha del sujeto

/* ── Presets de maquillaje por presentador ────────────────── */
const MAKEUP_PRESETS = {
  p_noticias: {
    // Presentadora de Noticias — look profesional TV
    lips:      { outer: 'rgba(210, 75, 110, 0.80)', inner: 'rgba(190, 55, 90, 0.70)' },
    eyeshadow: { color: 'rgba(160, 110, 180, 0.45)', radius: 0.55 },
    blush:     { color: 'rgba(240, 150, 140, 0.35)', radius: 0.10 }
  },
  ph_noticias: {
    // Presentador de Noticias — maquillaje masculino de TV (muy sutil)
    lips:      { outer: 'rgba(170, 95, 85, 0.30)', inner: 'rgba(155, 80, 75, 0.22)' },
    eyeshadow: null,
    blush:     { color: 'rgba(200, 155, 135, 0.18)', radius: 0.09 }
  },
  p_cmoda: {
    // Presentadora Colombia Moda — look dramático editorial
    lips:      { outer: 'rgba(155, 15, 55, 0.90)', inner: 'rgba(130, 10, 45, 0.80)' },
    eyeshadow: { color: 'rgba(195, 145, 25, 0.58)', radius: 0.68 },
    blush:     { color: 'rgba(225, 115, 95, 0.42)', radius: 0.11 }
  },
  ph_deportes: {
    // Presentador de Deportes — natural, casi sin maquillaje
    lips:      { outer: 'rgba(185, 110, 95, 0.22)', inner: null },
    eyeshadow: null,
    blush:     null
  }
};

/* ── Estado interno ──────────────────────────────────────── */
let _faceMesh      = null;
let _faceCam       = null;
let _canvas        = null;
let _ctx           = null;
let _videoEl       = null;
let _currentPreset = null;
let _ready         = false;
let _lastLandmarks = null;

/* ── API Pública ─────────────────────────────────────────── */

async function initFaceFilter(videoEl, canvasEl) {
  _videoEl = videoEl;
  _canvas  = canvasEl;
  _ctx     = canvasEl.getContext('2d');

  if (typeof FaceMesh === 'undefined') {
    console.warn('[FaceFilter] MediaPipe FaceMesh no cargado. Verifica el CDN.');
    return;
  }

  _faceMesh = new FaceMesh({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`
  });

  _faceMesh.setOptions({
    maxNumFaces:            1,
    refineLandmarks:        true,    // mejora labios e iris
    minDetectionConfidence: 0.65,
    minTrackingConfidence:  0.55
  });

  _faceMesh.onResults(_onFaceResults);

  /* Usar Camera helper (mismo que hand-tracker.js) */
  if (typeof Camera !== 'undefined') {
    _faceCam = new Camera(videoEl, {
      onFrame: async () => {
        if (_faceMesh) await _faceMesh.send({ image: videoEl });
      },
      width: 1280,
      height: 720
    });
    await _faceCam.start();
  }

  _ready = true;
  console.log('[FaceFilter] MediaPipe Face Mesh listo.');
}

function setMakeupPreset(presenterId) {
  _currentPreset = MAKEUP_PRESETS[presenterId] || null;
  console.log('[FaceFilter] Preset:', presenterId, _currentPreset ? '✓' : '(sin preset)');
}

function stopFaceFilter() {
  _faceCam?.stop();
  _faceCam   = null;
  _faceMesh  = null;
  _ready         = false;
  _lastLandmarks = null;
  if (_ctx && _canvas) {
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
  }
}

function isFaceFilterReady() { return _ready; }

/* ── Callback de resultados de Face Mesh ─────────────────── */

function _onFaceResults(results) {
  if (!_canvas || !_ctx) return;

  _canvas.width  = _videoEl.videoWidth  || 1280;
  _canvas.height = _videoEl.videoHeight || 720;
  _ctx.clearRect(0, 0, _canvas.width, _canvas.height);

  if (!results.multiFaceLandmarks?.length) {
    _lastLandmarks = null;
    return;
  }

  const lm = results.multiFaceLandmarks[0];
  _lastLandmarks = lm;

  if (_currentPreset) {
    _drawMakeup(_ctx, lm, _canvas.width, _canvas.height, _currentPreset);
  }
}

/* ── Motor de pintado de maquillaje ─────────────────────── */

function _drawMakeup(ctx, lm, W, H, preset) {
  ctx.save();

  // Espejo horizontal (la cámara ya viene espejada en la vista del usuario,
  // pero el canvas de overlay necesita coincidir con el video espejado)
  ctx.translate(W, 0);
  ctx.scale(-1, 1);

  /* ── Labios ── */
  if (preset.lips) {
    _drawLips(ctx, lm, W, H, preset.lips);
  }

  /* ── Sombra de ojos ── */
  if (preset.eyeshadow) {
    _drawEyeshadow(ctx, lm, W, H, preset.eyeshadow, LEFT_EYE,  'left');
    _drawEyeshadow(ctx, lm, W, H, preset.eyeshadow, RIGHT_EYE, 'right');
  }

  /* ── Rubor / blush ── */
  if (preset.blush) {
    _drawBlush(ctx, lm, W, H, preset.blush, LEFT_CHEEK_CENTER);
    _drawBlush(ctx, lm, W, H, preset.blush, RIGHT_CHEEK_CENTER);
  }

  ctx.restore();
}

/* Labios: traza los contornos y rellena con color */
function _drawLips(ctx, lm, W, H, lipConfig) {
  const toLips = (indices) => indices.map(i => ({
    x: lm[i].x * W, y: lm[i].y * H
  }));

  // Labio exterior
  ctx.beginPath();
  const outer = toLips(LIPS_OUTER);
  outer.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.fillStyle = lipConfig.outer;
  ctx.fill();

  // Labio interior (si se definió)
  if (lipConfig.inner) {
    ctx.beginPath();
    const inner = toLips(LIPS_INNER);
    inner.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fillStyle = lipConfig.inner;
    ctx.fill();
  }

  // Pequeño highlight en el labio superior
  ctx.beginPath();
  const topCenter = { x: lm[0].x * W, y: lm[0].y * H };
  ctx.ellipse(topCenter.x, topCenter.y - 2, 8, 4, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fill();
}

/* Sombra de ojos: elipse difuminada sobre el ojo */
function _drawEyeshadow(ctx, lm, W, H, config, eyeIndices, side) {
  // Centro del ojo
  const pts = eyeIndices.map(i => ({ x: lm[i].x * W, y: lm[i].y * H }));
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;

  // Dimensiones de la elipse proporcionales a la distancia inter-ocular
  const eyeWidth = Math.abs(pts[0].x - pts[8].x) * 1.4;
  const eyeH     = eyeWidth * 0.45 * config.radius;

  // Desplazar hacia arriba (sombra va encima del ojo)
  const offsetY = eyeH * 0.8;

  const grad = ctx.createRadialGradient(cx, cy - offsetY, 0, cx, cy - offsetY, eyeWidth * 0.7);
  grad.addColorStop(0, config.color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.beginPath();
  ctx.ellipse(cx, cy - offsetY, eyeWidth * 0.65, eyeH * 1.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
}

/* Rubor: círculo difuminado en la mejilla */
function _drawBlush(ctx, lm, W, H, config, cheekIndices) {
  const pts = cheekIndices.map(i => ({ x: lm[i].x * W, y: lm[i].y * H }));
  const cx  = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy  = pts.reduce((s, p) => s + p.y, 0) / pts.length;

  // Radio proporcional al ancho de la cara
  const faceWidth = W * 0.35;  // estimación
  const r = faceWidth * config.radius;

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, config.color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
}

/* ── Helper: punto medio de un grupo de landmarks ────────── */
function _centroid(lm, indices, W, H) {
  const pts = indices.map(i => ({ x: lm[i].x * W, y: lm[i].y * H }));
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length
  };
}
