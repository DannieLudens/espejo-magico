/**
 * mirror-frame.js
 * Genera y anima las bombillas LED del marco tipo vanity mirror.
 *
 * Secuencia perimetral continua (sentido horario desde esquina inferior-izq):
 *   [0 – 14]  carril izquierdo,  de abajo hacia arriba
 *   [15 – 36] carril superior,   de izquierda a derecha
 *   [37 – 51] carril derecho,    de arriba hacia abajo
 *
 * Cada bombilla recibe un animation-delay proporcional a su posición
 * global → el pulso viaja como una sola ola alrededor del marco.
 * triggerSelectionFlash() ordena el destello en ese mismo sentido.
 *
 * API:
 *   initMirrorFrame()        — crea las bombillas en el DOM
 *   triggerSelectionFlash()  — destello blanco en ola perimetral
 */

'use strict';

const BULBS_TOP   = 22;   // bombillas en el carril superior
const BULBS_SIDE  = 15;   // bombillas por cada carril lateral
const PULSE_CYCLE = 2.2;  // segundos de un ciclo completo de pulso
const _TOTAL      = BULBS_TOP + BULBS_SIDE * 2;  // 52 en total

/**
 * Inicializa el marco asignando a cada bombilla su posición global
 * en el perímetro para que el pulso sea una ola unísona.
 */
function initMirrorFrame() {
  // Carril izquierdo: el DOM va de arriba→abajo (i=0 es el más alto),
  // pero la ola empieza abajo → invertimos: globalPos = SIDE-1-i
  _createBulbs('bulbs-left',  BULBS_SIDE, i => BULBS_SIDE - 1 - i);

  // Carril superior: DOM y ola van izq→der, globalPos desplazado en SIDE
  _createBulbs('bulbs-top',   BULBS_TOP,  i => BULBS_SIDE + i);

  // Carril derecho: DOM y ola van arriba→abajo, desplazado en SIDE+TOP
  _createBulbs('bulbs-right', BULBS_SIDE, i => BULBS_SIDE + BULBS_TOP + i);

  console.log('[MirrorFrame] Marco inicializado con', _TOTAL,
    'bombillas (ola perimetral unísona).');
}

/**
 * Parpadeo uniforme (sin ola) — sincronizado con cada tick del countdown.
 * Todas las bombillas encendidas al mismo tiempo → sensación de pulso.
 */
function triggerCountdownBlink() {
  const bulbs = document.querySelectorAll('.bulb');
  bulbs.forEach(b => b.classList.add('countdown-blink'));
  setTimeout(() => bulbs.forEach(b => b.classList.remove('countdown-blink')), 280);
}

/**
 * Flash fotográfico — todas las bombillas simultáneas, más brillante y largo.
 * Llamar en el momento exacto de captura de la foto.
 */
function triggerCameraFlash() {
  const bulbs = document.querySelectorAll('.bulb');
  bulbs.forEach(b => b.classList.add('camera-flash'));
  setTimeout(() => bulbs.forEach(b => b.classList.remove('camera-flash')), 750);
}

/**
 * Dispara el destello blanco recorriendo el perímetro en orden de ola.
 * Las bombillas se ordenan por data-wave-pos antes de aplicar el delay.
 */
function triggerSelectionFlash() {
  const bulbs    = Array.from(document.querySelectorAll('.bulb'));
  const STEP_MS  = 26;   // ms entre bombillas — ola viaja en ~1350 ms
  const FLASH_MS = 320;  // debe coincidir con la duración CSS de bulbFlash
  // Con estos valores ~12 bombillas encendidas a la vez → ola visible como banda

  // Ordenar por posición global en el perímetro
  bulbs.sort((a, b) =>
    parseInt(a.dataset.wavePos, 10) - parseInt(b.dataset.wavePos, 10)
  );

  bulbs.forEach((bulb, i) => {
    const addMs    = i * STEP_MS;
    const removeMs = addMs + FLASH_MS;

    setTimeout(() => bulb.classList.add('flash'), addMs);

    // Al quitar la clase, bulbPulse retoma exactamente donde estaba —
    // no hace falta reflow forzado (el navegador continúa el timeline CSS).
    setTimeout(() => bulb.classList.remove('flash'), removeMs);
  });
}

/**
 * Crea `count` elementos .bulb dentro del contenedor indicado.
 * globalPosFn(i) devuelve la posición global de la bombilla i en el perímetro.
 * @private
 */
function _createBulbs(containerId, count, globalPosFn) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`[MirrorFrame] Contenedor #${containerId} no encontrado.`);
    return;
  }

  for (let i = 0; i < count; i++) {
    const bulb = document.createElement('div');
    bulb.className = 'bulb';

    // Posición global → controla el ORDEN del flash perimetral
    const globalPos = globalPosFn(i);
    bulb.dataset.wavePos = globalPos;

    // Fase LOCAL dentro del carril → ola secuencial visible igual que antes
    // Cada carril usa su propio 'count', dando pasos grandes entre bombillas
    // (~147 ms en laterales, ~100 ms en superior) vs los ~42 ms del global.
    const delay = -((i / count) * PULSE_CYCLE).toFixed(3);
    bulb.style.animationDelay = `${delay}s`;

    container.appendChild(bulb);
  }
}
