/**
 * captions.js
 * Subtítulos (closed captions) sincronizados con los audios de voz en off.
 *
 * API pública:
 *   initCaptions()                  — llama una vez al arrancar la app.
 *   attachCaptions(audioEl, vttUrl) — vincula un <audio> a su .vtt.
 *   detachCaptions()                — desvincula (al cambiar de escena).
 *   toggleCaptions()                — activa / desactiva (tecla C).
 *   areCaptionsEnabled()            — devuelve el estado actual.
 *
 * Tecla de activación: C
 * El estado se persiste en localStorage ('cc_enabled').
 *
 * El overlay #cc-overlay debe existir en el HTML (lo crea initCaptions
 * si no existe, para mayor resiliencia).
 */

'use strict';

/* ── Estado ────────────────────────────────────────────── */
let _ccEnabled    = false;
let _ccCues       = [];          // [{start, end, text}]
let _ccCurrentEl  = null;        // <audio> activo
let _ccOverlay    = null;        // div#cc-overlay
let _ccText       = null;        // div#cc-text (hijo del overlay)
let _ccBound      = null;        // listener timeupdate enlazado

/* ── Constantes ────────────────────────────────────────── */
const _CC_STORAGE_KEY = 'cc_enabled';
const _CC_CAPTIONS_DIR = 'assets/captions/';

/* ── Inicialización ────────────────────────────────────── */

/**
 * Crea el overlay DOM, restaura la preferencia del usuario y
 * registra la tecla C para el toggle.
 */
function initCaptions() {
  _ccOverlay = document.getElementById('cc-overlay');

  /* Crear el overlay si no existe en el HTML */
  if (!_ccOverlay) {
    _ccOverlay = document.createElement('div');
    _ccOverlay.id = 'cc-overlay';
    document.body.appendChild(_ccOverlay);
  }

  _ccText = document.getElementById('cc-text');
  if (!_ccText) {
    _ccText = document.createElement('div');
    _ccText.id = 'cc-text';
    _ccOverlay.appendChild(_ccText);
  }

  /* Restaurar preferencia guardada */
  const saved = localStorage.getItem(_CC_STORAGE_KEY);
  _ccEnabled  = saved === null ? false : saved === 'true';
  _ccOverlay.classList.toggle('cc-active', _ccEnabled);

  /* Indicador de estado (badge CC) */
  _ccUpdateBadge();

  /* Tecla C → toggle */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'c' || e.key === 'C') toggleCaptions();
  });

  console.log('[CC] Subtítulos inicializados —', _ccEnabled ? 'ON' : 'OFF');
}

/* ── API pública ───────────────────────────────────────── */

/**
 * Vincula un elemento <audio> a su archivo .vtt.
 * Descarga y parsea el .vtt; luego sincroniza en timeupdate.
 *
 * @param {HTMLAudioElement} audioEl  — el elemento <audio> activo
 * @param {string}           vttUrl  — ruta al .vtt (puede ser null/undefined)
 */
async function attachCaptions(audioEl, vttUrl) {
  detachCaptions();   /* limpiar binding anterior */

  if (!audioEl || !vttUrl) return;

  /* Descargar y parsear el VTT */
  try {
    const res = await fetch(vttUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    _ccCues = _parseVTT(text);
    console.log(`[CC] ${_ccCues.length} cues cargadas desde ${vttUrl}`);
  } catch (e) {
    console.warn('[CC] No se pudo cargar el VTT:', vttUrl, e.message);
    _ccCues = [];
    return;
  }

  _ccCurrentEl = audioEl;
  _ccBound = _onTimeUpdate.bind(null, audioEl);
  audioEl.addEventListener('timeupdate', _ccBound);
  audioEl.addEventListener('ended', _ccClear, { once: true });
}

/**
 * Desvincula el <audio> activo y oculta el texto.
 */
function detachCaptions() {
  if (_ccCurrentEl && _ccBound) {
    _ccCurrentEl.removeEventListener('timeupdate', _ccBound);
  }
  _ccCurrentEl = null;
  _ccBound     = null;
  _ccCues      = [];
  _ccClear();
}

/**
 * Activa o desactiva los subtítulos y persiste la preferencia.
 */
function toggleCaptions() {
  _ccEnabled = !_ccEnabled;
  localStorage.setItem(_CC_STORAGE_KEY, _ccEnabled);
  _ccOverlay.classList.toggle('cc-active', _ccEnabled);
  _ccUpdateBadge();
  if (!_ccEnabled) _ccClear();
  console.log('[CC] Subtítulos:', _ccEnabled ? 'ON' : 'OFF');
}

/** Devuelve true si los subtítulos están activos. */
function areCaptionsEnabled() {
  return _ccEnabled;
}

/**
 * Devuelve la URL del .vtt para un nombre de archivo de audio.
 * Ej: 'assets/Audios_Definitivos/VozEnOff/1_LimpiezaPiel.mp3'
 *     → 'assets/captions/1_LimpiezaPiel.vtt'
 */
function getCaptionUrl(audioSrc) {
  if (!audioSrc) return null;
  const base = audioSrc.split('/').pop().replace(/\.[^.]+$/, '');
  return _CC_CAPTIONS_DIR + base + '.vtt';
}

/* ── Internos ──────────────────────────────────────────── */

function _onTimeUpdate(audioEl) {
  if (!_ccEnabled || !_ccCues.length) return;

  const t = audioEl.currentTime;
  const cue = _ccCues.find(c => t >= c.start && t <= c.end);

  if (cue) {
    _ccText.textContent = cue.text;
    _ccOverlay.classList.add('cc-showing');
  } else {
    _ccClear();
  }
}

function _ccClear() {
  if (_ccText)    _ccText.textContent = '';
  if (_ccOverlay) _ccOverlay.classList.remove('cc-showing');
}

/**
 * Parser mínimo de WebVTT.
 * Soporta el formato estándar: HEADER + bloques "start --> end\ntexto".
 */
function _parseVTT(raw) {
  const cues   = [];
  const blocks = raw.replace(/\r\n/g, '\n').split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    /* Buscar la línea con "-->" */
    const timeLine = lines.find(l => l.includes('-->'));
    if (!timeLine) continue;

    const [startStr, endStr] = timeLine.split('-->').map(s => s.trim());
    const start = _vttToSeconds(startStr);
    const end   = _vttToSeconds(endStr);
    if (isNaN(start) || isNaN(end)) continue;

    /* El texto son las líneas después de la línea de tiempo */
    const timeIdx = lines.indexOf(timeLine);
    const text = lines.slice(timeIdx + 1).join(' ').trim();
    if (text) cues.push({ start, end, text });
  }

  return cues;
}

/** "00:00:03.500" o "00:03.500" → segundos (number) */
function _vttToSeconds(str) {
  const parts = str.split(':').map(parseFloat);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return NaN;
}

/* ── Badge CC ──────────────────────────────────────────── */
function _ccUpdateBadge() {
  let badge = document.getElementById('cc-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'cc-badge';
    badge.textContent = 'CC';
    document.body.appendChild(badge);
  }
  badge.classList.toggle('cc-badge-on',  _ccEnabled);
  badge.classList.toggle('cc-badge-off', !_ccEnabled);
  badge.title = _ccEnabled ? 'Subtítulos ON (C para desactivar)'
                           : 'Subtítulos OFF (C para activar)';
}
