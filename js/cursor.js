/**
 * cursor.js
 * Sistema de cursor dual para kiosco sin ratón:
 *
 *   #lipstick-cursor  → imagen PNG del labial (cursor por defecto)
 *   #pinch-cursor     → emoji 👌 (cuando el dedo está sobre algo interactivo)
 *
 * IMPORTANTE: todos los handlers internos tienen prefijo _cur para evitar
 * colisiones de nombres con app.js en el scope global de scripts clásicos.
 *
 * El ratón NO mueve ninguno de los dos cursores.
 * Solo el dedo índice los controla vía eventos de hand-tracker.js.
 * Sin mano detectada → ambos permanecen en la última posición conocida.
 */

'use strict';

/* ── Referencias DOM ─────────────────────────────────────── */
let _curLipstickEl  = null;   // #lipstick-cursor
let _curPinchEl     = null;   // #pinch-cursor  (👌)
let _curProgressEl  = null;   // #pinch-progress (ring SVG)

/* ── Estado ──────────────────────────────────────────────── */
let _curTargetX      = -300;
let _curTargetY      = -300;
let _curCurrentX     = -300;
let _curCurrentY     = -300;
let _curRafId        = null;
let _curInteractive  = false;
let _curHandSeen     = false;   // false hasta la primera detección de mano

const _CUR_LERP          = 0.55;    // más rápido que hand-tracker para minimizar lag visual
const _CUR_CIRCUMFERENCE = 138.23;
const _CUR_PROX_RADIUS   = 65;     // px — radio para efecto finger-near en dots y botón volver

/* Elementos interactivos — equivalente a cursor:pointer */
const _CUR_INTERACTIVE_SEL =
  '[data-action], .presenter-card, .final-btn, ' +
  '#btn-take-photo, #photobooth-back, .photobooth-back-btn, ' +
  '#exp-back-btn, .exp-dot';

/* ── Inicialización ──────────────────────────────────────── */

function initCursor() {
  _curLipstickEl  = document.getElementById('lipstick-cursor');
  _curPinchEl     = document.getElementById('pinch-cursor');
  _curProgressEl  = document.getElementById('pinch-progress');

  if (!_curLipstickEl) {
    console.warn('[Cursor] #lipstick-cursor no encontrado');
    return;
  }

  /* Resetear estado en caso de reinicio */
  _curHandSeen    = false;
  _curInteractive = false;

  /* Ambos cursores ocultos hasta la primera detección de mano */
  _curLipstickEl.style.visibility = 'hidden';
  if (_curPinchEl) _curPinchEl.style.visibility = 'hidden';

  /* Posición inicial fuera de pantalla */
  _curApplyPosition(_curCurrentX, _curCurrentY);

  /* Solo escucha eventos de la mano — el ratón no tiene efecto.
   * Prefijo _cur en todos los handlers para evitar colisión con app.js */
  document.addEventListener('handMove',       _curOnHandMove);
  document.addEventListener('pinchStart',     _curOnPinchStart);
  document.addEventListener('pinchProgress',  _curOnPinchProgress);
  document.addEventListener('pinchConfirmed', _curOnPinchConfirmed);
  document.addEventListener('pinchEnd',       _curOnPinchEnd);

  _curStartLoop();
  console.log('[Cursor] Listo — labial=normal, 👌=interactivo.');
}

/* ── Handlers de eventos de mano ─────────────────────────── */

function _curOnHandMove(e) {
  _curTargetX = e.detail.x;
  _curTargetY = e.detail.y;

  /* Primera detección: revelar el cursor labial */
  if (!_curHandSeen && _curLipstickEl) {
    _curHandSeen = true;
    _curLipstickEl.style.visibility = 'visible';
    console.log('[Cursor] Primera mano detectada — cursor visible.');
  }
}

function _curOnPinchStart() {
  _curLipstickEl?.classList.add('pinching');
  _curPinchEl?.classList.add('pinching');
  _curProgressEl?.classList.add('active');
  _curSetProgress(0);
}

function _curOnPinchProgress(e) {
  _curSetProgress(e.detail.progress);
  _curSetProgressPos(e.detail.x, e.detail.y);
}

function _curOnPinchConfirmed() {
  _curLipstickEl?.classList.remove('pinching');
  _curPinchEl?.classList.remove('pinching');
  _curProgressEl?.classList.remove('active');
  _curSetProgress(0);
  _curPopAnimation();
}

function _curOnPinchEnd() {
  _curLipstickEl?.classList.remove('pinching');
  _curPinchEl?.classList.remove('pinching');
  _curProgressEl?.classList.remove('active');
  _curSetProgress(0);
}

/* ── Loop de animación ───────────────────────────────────── */

function _curStartLoop() {
  function tick() {
    /* LERP rápido hacia la posición suavizada del hand-tracker */
    _curCurrentX += (_curTargetX - _curCurrentX) * _CUR_LERP;
    _curCurrentY += (_curTargetY - _curCurrentY) * _CUR_LERP;

    _curApplyPosition(_curCurrentX, _curCurrentY);

    /* Detectar modo interactivo y proximidad solo cuando la mano ya fue vista */
    if (_curHandSeen) {
      _curUpdateInteractive(_curCurrentX, _curCurrentY);
      _curUpdateProximity(_curCurrentX, _curCurrentY);
    }

    _curRafId = requestAnimationFrame(tick);
  }
  _curRafId = requestAnimationFrame(tick);
}

/* ── Proximidad: efecto finger-near ─────────────────────── */

/**
 * Recorre todos los dots de experiencia y el botón volver.
 * Si el dedo interpolado está dentro de _CUR_PROX_RADIUS px del
 * centro del elemento, añade la clase CSS "finger-near" (que
 * dispara la animación de hinchazón); la quita en caso contrario.
 */
function _curUpdateProximity(x, y) {
  document.querySelectorAll(
    '.exp-dot, #exp-back-btn, ' +
    '#btn-try-makeup, #btn-back-menu, ' +
    '#btn-take-photo, .photobooth-back-btn, #btn-retake, #btn-photo-menu'
  ).forEach(function(el) {
    var rect = el.getBoundingClientRect();
    if (!rect.width) return;                     // elemento invisible / fuera del DOM
    var cx = rect.left + rect.width  * 0.5;
    var cy = rect.top  + rect.height * 0.5;
    el.classList.toggle('finger-near', Math.hypot(x - cx, y - cy) < _CUR_PROX_RADIUS);
  });
}

/* ── Posicionamiento ─────────────────────────────────────── */

function _curApplyPosition(x, y) {
  /* Labial: left/top = punta exacta del dedo (hotspot = esquina superior-izquierda) */
  if (_curLipstickEl) {
    _curLipstickEl.style.left = `${x}px`;
    _curLipstickEl.style.top  = `${y}px`;
  }
  /* Emoji: mismas coordenadas; CSS translate(-50%,-50%) lo centra en el dedo */
  if (_curPinchEl) {
    _curPinchEl.style.left = `${x}px`;
    _curPinchEl.style.top  = `${y}px`;
  }
}

function _curSetProgressPos(x, y) {
  if (!_curProgressEl) return;
  _curProgressEl.style.left = `${x}px`;
  _curProgressEl.style.top  = `${y}px`;
}

/* ── Detección de elemento interactivo ───────────────────── */

function _curUpdateInteractive(x, y) {
  /* Cursor fuera del viewport → modo normal sin cambios */
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
    if (_curInteractive) _curSetInteractive(false);
    return;
  }

  /* elementFromPoint ignora pointer-events:none, atraviesa los cursores */
  const el = document.elementFromPoint(x, y);
  const now = !!(el?.closest(_CUR_INTERACTIVE_SEL));

  if (now !== _curInteractive) {
    _curSetInteractive(now);
  }
}

function _curSetInteractive(value) {
  _curInteractive = value;

  if (value) {
    /* Modo interactivo: mostrar 👌, ocultar labial */
    if (_curLipstickEl) _curLipstickEl.style.visibility = 'hidden';
    if (_curPinchEl)    _curPinchEl.style.visibility    = 'visible';
  } else {
    /* Modo normal: mostrar labial, ocultar 👌 */
    if (_curLipstickEl) _curLipstickEl.style.visibility = 'visible';
    if (_curPinchEl)    _curPinchEl.style.visibility    = 'hidden';
  }
}

/* ── Ring de progreso ────────────────────────────────────── */

/**
 * API pública para mostrar el ring de progreso desde otras partes de la app.
 * Usado por el sistema de dwell (hover-and-wait) de la escena de experiencia.
 * @param {number} progress  0 = ocultar, 0.01-1 = mostrar con ese porcentaje
 * @param {number} [x]       posición left (px) — ignorado si progress <= 0
 * @param {number} [y]       posición top  (px) — ignorado si progress <= 0
 */
function curShowDwellProgress(progress, x, y) {
  const el = document.getElementById('pinch-progress');
  if (!el) return;
  if (progress <= 0) {
    el.classList.remove('active');
    _curSetProgress(0);
    return;
  }
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
  _curSetProgress(progress);
  el.classList.add('active');
}

function _curSetProgress(value) {
  if (!_curProgressEl) return;
  const fill = _curProgressEl.querySelector('.fill');
  if (!fill) return;
  fill.style.strokeDashoffset = _CUR_CIRCUMFERENCE * (1 - value);
}

/* ── Animación de pop al confirmar pinza ─────────────────── */

function _curPopAnimation() {
  const target = _curInteractive ? _curPinchEl : _curLipstickEl;
  if (!target) return;
  target.style.transition = 'transform 0.2s cubic-bezier(0.34,1.56,0.64,1)';
  target.classList.add('pop');
  setTimeout(() => {
    target.classList.remove('pop');
    target.style.transition = '';
  }, 300);
}
