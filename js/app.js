/**
 * app.js
 * Orquestador principal del Espejo Mágico.
 * Máquina de estados: standby → menu → experience → final → menu
 *
 * En Fase 1 solo están activas: standby (pantalla de espera)
 * y la respuesta al gesto de pinza.
 * Las escenas de menú, experiencia y final se implementan en Fase 2+.
 */

'use strict';

/* ── Estado de la aplicación ─────────────────────────────── */
const AppState = {
  STANDBY:      'standby',
  MENU:         'menu',
  INTRO:        'intro',         // pantalla de carga entre selección y experiencia
  EXPERIENCE:   'experience',
  OUTRO:        'outro',         // pantalla de cierre al terminar la experiencia
  FINAL:        'final',
  PHOTOBOOTH:   'photobooth',    // webcam con filtro de maquillaje AR
  PHOTO_RESULT: 'photo_result',  // foto tomada + QR
  MIRROR:       'mirror',        // espejo mágico con water-ripple
  TUTORIAL:     'tutorial'       // video instrucción pinza (entre mirror y standby)
};

let _currentState     = null;
let _activePresenter  = null;    // objeto PRESENTERS[n]
let _currentSceneIdx  = 0;       // índice de escena dentro de la experiencia
let _isTransitioning  = false;   // guard: evita transiciones simultáneas
let _isIdleMode       = false;   // true mientras espera al usuario en un checkpoint idle

/* ── Audio ambiente ──────────────────────────────────────── */
let _ambientMusic       = null;
let _handIndicatorTimer = null;
let _handShownInStandby = false;  // evita mostrar el indicador múltiples veces
let _tutoFallbackTimer  = null;   // timeout de seguridad para la escena tutorial
let _tutoAudioDelayTimer = null;  // delay 3s antes de iniciar el audio del tutorial

/* Instrucción del menú — se reproduce una sola vez por sesión */
let _menuInstructionPlayed = false;
let _menuInstructionTimer  = null;
let _menuInstructionAudio  = null;

/* ── Mirror countdown ────────────────────────────────────── */
const _MIRROR_CD_SECS  = 10;           // segundos totales
const _MIRROR_CD_CIRC  = 144.51;       // 2π×23 — circunferencia del ring SVG
let   _mirrorCdSecs    = _MIRROR_CD_SECS;
let   _mirrorCdTimer   = null;

/* ── Elemento overlay para fade negro entre transiciones ─── */
let _overlayEl = null;

/* ── Inicialización ──────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[App] Iniciando Espejo Mágico…');

  /* Crear overlay de fade */
  _overlayEl = document.createElement('div');
  _overlayEl.id = 'scene-overlay';
  document.body.appendChild(_overlayEl);

  /* Guardar referencias globales */
  _ambientMusic = document.getElementById('ambient-music');
  _webcamEl     = document.getElementById('webcam');

  /* Iniciar subsistemas */
  initMirrorFrame();
  initCursor();
  initPhotoBooth();

  /* Detector de objetos físicos — carga el modelo TM en background */
  if (typeof initObjectDetector === 'function') {
    initObjectDetector().catch(e =>
      console.warn('[App] Detector de objetos no disponible:', e)
    );
  }

  /* Subtítulos (closed captions) — tecla C para activar/desactivar */
  if (typeof initCaptions === 'function') initCaptions();

  /* Iniciar hand tracker (asíncrono — puede fallar si no hay cámara) */
  const videoEl  = document.getElementById('webcam');
  const canvasEl = document.getElementById('handCanvas');
  await initHandTracker(videoEl, canvasEl);

  /* Registrar listeners globales */
  _registerEventListeners();

  /* Atajo de teclado D → toggle debug landmarks */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'd' || e.key === 'D') {
      canvasEl.classList.toggle('debug-visible');
    }
    /* Tecla ` (backtick) → toggle cursor del sistema (modo operador) */
    if (e.key === '`') {
      document.body.classList.toggle('system-cursor');
    }
    /* Tecla M → abrir escena espejo mágico (water ripple) desde cualquier estado */
    if (e.key === 'm' || e.key === 'M') {
      if (_currentState !== AppState.MIRROR) {
        _transitionTo(AppState.MIRROR);
      }
    }
    /* Tecla N → ir directo al menú de selección de presentadores */
    if (e.key === 'n' || e.key === 'N') {
      if (_currentState !== AppState.MENU) {
        _transitionTo(AppState.MENU);
      }
    }
    /* Tecla V → toggle panel de audio */
    if (e.key === 'v' || e.key === 'V') {
      _toggleSoundPanel();
    }
    /* Tecla G → toggle panel de destello de tarjetas (solo en menú) */
    if ((e.key === 'g' || e.key === 'G') && _currentState === AppState.MENU) {
      _toggleGlassPanel();
    }
    /* Tecla C → toggle panel de config del ripple (solo en escena espejo) */
    if ((e.key === 'c' || e.key === 'C') && _currentState === AppState.MIRROR) {
      _toggleMirrorConfig();
    }
    /* Tecla ESC → volver */
    if (e.key === 'Escape') {
      if (_currentState === AppState.MIRROR) {
        /* El espejo es el preludio → vuelve a standby (saltando tutorial) */
        _transitionTo(AppState.STANDBY);
      } else if (_currentState === AppState.TUTORIAL) {
        /* Operador puede saltar el tutorial */
        _transitionTo(AppState.STANDBY);
      } else if (_currentState === AppState.MENU) {
        _transitionTo(AppState.STANDBY);
      } else if (_currentState === AppState.EXPERIENCE ||
                 _currentState === AppState.OUTRO     ||
                 _currentState === AppState.FINAL     ||
                 _currentState === AppState.PHOTOBOOTH ||
                 _currentState === AppState.PHOTO_RESULT) {
        _transitionTo(AppState.MENU);
      }
    }
  });

  /* Arrancar en standby */
  _transitionTo(AppState.STANDBY, true);

  console.log('[App] Listo. Presiona D para ver landmarks de debug.');
});

/* ── Listeners de eventos de mano ────────────────────────── */

function _registerEventListeners() {
  document.addEventListener('handMove',       _onHandMove);
  document.addEventListener('handLost',       _onHandLost);
  document.addEventListener('pinchConfirmed', _onPinchConfirmed);
  document.addEventListener('pinchProgress',  _onPinchProgress);
}

function _onHandMove(e) {
  /* En standby, cuando aparece la mano → mostrar hint de pinza (no transicionar) */
  if (_currentState === AppState.STANDBY) {
    if (!_handShownInStandby) {
      _handShownInStandby = true;
      _showHandIndicator();   // muestra "👌 Haz pinza para continuar"
    }
    return;
  }

  /* En menú, detectar hover sobre cards de presentadores */
  if (_currentState === AppState.MENU) {
    _updatePresenterHover(e.detail.x, e.detail.y);
  }

  /* En la experiencia, gestionar dwell sobre dots y botón volver */
  if (_currentState === AppState.EXPERIENCE) {
    _updateExperienceDwell(e.detail.x, e.detail.y);
  }

  /* En el espejo, resetear el countdown al detectar mano */
  if (_currentState === AppState.MIRROR) {
    _resetMirrorCountdown();
  }
}

function _onHandLost() {
  if (_currentState === AppState.MENU) {
    document.querySelectorAll('.presenter-card').forEach(c => {
      c.classList.remove('hovered', 'selecting');
    });
    /* Ocultar fondo dinámico al perder la mano */
    const menuBg = document.getElementById('menu-bg');
    if (menuBg) menuBg.style.opacity = '0';
  }

  /* Cancelar dwell si la mano se pierde */
  if (_dwellEl) _cancelDwell();
}

function _clearPinchBars() {
  document.querySelectorAll('.card-pinch-bar').forEach(b => b.style.width = '0%');
  document.querySelectorAll('.presenter-card').forEach(c => c.classList.remove('selecting'));
}

function _onPinchProgress(e) {
  const { x, y, progress } = e.detail;

  if (_currentState === AppState.MENU) {
    const activeCard = _getCardAt(x, y);
    document.querySelectorAll('.presenter-card').forEach(c => {
      const isActive = c === activeCard;
      c.classList.toggle('selecting', isActive);
      /* La barra de progreso está oculta — el feedback visual es el cursor circular */
    });
  }

  if (_currentState === AppState.FINAL) {
    const btn = _getFinalBtnAt(x, y);
    document.querySelectorAll('.final-btn').forEach(b => {
      const isActive = b === btn;
      b.classList.toggle('selecting', isActive);
      const bar = b.querySelector('.final-btn-bar');
      if (bar) bar.style.width = isActive ? `${progress * 100}%` : '0%';
    });
  }
}

/* ── Helpers de hit-test para pinza ─────────────────────────── */

/** Devuelve true si (x, y) cae dentro del bounding rect del elemento */
function _hitTest(x, y, el) {
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** Devuelve el dot de checkpoint que está en (x, y), o null */
function _getDotAt(x, y) {
  for (const dot of document.querySelectorAll('.exp-dot')) {
    if (_hitTest(x, y, dot)) return dot;
  }
  return null;
}

/**
 * Reproduce directamente una escena por índice (sin entrar en idle).
 * Usado por los dots de navegación inicio/fin.
 */
function _jumpToScene(sceneIdx) {
  if (!_activePresenter) return;
  const scenes = getValidScenes(_activePresenter);
  if (sceneIdx < 0 || sceneIdx >= scenes.length) return;
  _stopExperienceMedia();
  _isIdleMode      = false;
  _currentSceneIdx = sceneIdx;
  _playScene(scenes[sceneIdx]);
  console.log('[App] Salto directo a escena', sceneIdx + 1, '/', scenes.length);
}

/**
 * Interactúa con el checkpoint de la escena indicada.
 *
 * - Si ya estamos en el idle de ESA escena → confirmar (avanzar a la siguiente).
 * - Si es otro checkpoint                  → saltar a su idle directamente.
 */
function _jumpToCheckpoint(sceneIdx) {
  if (!_activePresenter) return;
  const scenes = getValidScenes(_activePresenter);
  if (sceneIdx < 0 || sceneIdx >= scenes.length || !scenes[sceneIdx].idle) return;

  if (_isIdleMode && _currentSceneIdx === sceneIdx) {
    /* Dot del checkpoint activo: confirmar que el usuario mostró el objeto */
    console.log('[App] Checkpoint confirmado via dot', sceneIdx + 1);
    _exitIdleMode();
    return;
  }

  /* Otro dot: saltar a ese checkpoint */
  _stopExperienceMedia();
  _currentSceneIdx = sceneIdx;
  _enterIdleMode(scenes[sceneIdx].idle);
  console.log('[App] Salto a checkpoint', sceneIdx + 1, '/', scenes.length);
}

/* ── Dwell selection — hover-and-wait para EXPERIENCE ───────── */

/**
 * Comprueba si el dedo está sobre un dot o el botón volver.
 * Inicia, mantiene o cancela el dwell según corresponda.
 */
function _updateExperienceDwell(x, y) {
  let target = null;
  const backBtn = document.getElementById('exp-back-btn');
  if (backBtn && _hitTest(x, y, backBtn)) {
    target = backBtn;
  } else {
    target = _getDotAt(x, y);
  }

  if (!target) {
    if (_dwellEl) _cancelDwell();
    return;
  }
  /* Mismo elemento → el tick ya corre */
  if (target === _dwellEl) return;

  /* Elemento nuevo → cancelar anterior e iniciar */
  _cancelDwell();
  _startDwell(target);
}

function _startDwell(el) {
  _dwellEl    = el;
  _dwellStart = performance.now();
  el.classList.add('dwelling');
  _dwellRafId = requestAnimationFrame(_tickDwell);
}

function _cancelDwell() {
  if (_dwellRafId) { cancelAnimationFrame(_dwellRafId); _dwellRafId = null; }
  if (_dwellEl)    { _dwellEl.classList.remove('dwelling'); }
  _dwellEl    = null;
  _dwellStart = null;
  if (typeof curShowDwellProgress === 'function') curShowDwellProgress(0);
}

function _tickDwell() {
  if (!_dwellEl || _currentState !== AppState.EXPERIENCE) {
    _cancelDwell();
    return;
  }

  const elapsed  = performance.now() - _dwellStart;
  const progress = Math.min(elapsed / _DWELL_MS, 1);

  /* Mostrar ring de progreso centrado sobre el elemento */
  const rect = _dwellEl.getBoundingClientRect();
  const cx   = rect.left + rect.width  * 0.5;
  const cy   = rect.top  + rect.height * 0.5;
  if (typeof curShowDwellProgress === 'function') curShowDwellProgress(progress, cx, cy);

  if (progress >= 1) {
    _confirmDwell(_dwellEl);
    return;
  }

  _dwellRafId = requestAnimationFrame(_tickDwell);
}

function _confirmDwell(el) {
  const confirmed = el;
  _cancelDwell();        /* limpia estado antes de la acción */
  triggerSelectionFlash();

  const backBtn = document.getElementById('exp-back-btn');
  if (confirmed === backBtn) {
    _transitionTo(AppState.MENU);
    return;
  }

  /* Es un dot */
  if (confirmed.dataset.nav === 'start') {
    _jumpToScene(0);
  } else if (confirmed.dataset.nav === 'end') {
    const sc = getValidScenes(_activePresenter);
    _jumpToScene(sc.length - 1);
  } else {
    const idx = parseInt(confirmed.dataset.sceneIdx, 10);
    _jumpToCheckpoint(idx);
  }
}

function _onPinchConfirmed(e) {
  triggerSelectionFlash();

  switch (_currentState) {
    case AppState.STANDBY:
      _transitionTo(AppState.MENU);
      break;

    case AppState.MENU: {
      const card = _getCardAt(e.detail.x, e.detail.y);
      if (card) {
        const presenterId = card.dataset.presenterId;
        _activePresenter = PRESENTERS.find(p => p.id === presenterId);
        if (_activePresenter) {
          _clearPinchBars();
          _currentSceneIdx = 0;
          /* Esperar a que termine el flash de bombillas antes de transicionar */
          setTimeout(() => _transitionTo(AppState.INTRO), 900);
        }
      }
      break;
    }

    case AppState.EXPERIENCE: {
      const { x: px, y: py } = e.detail;

      /* 1. Botón Volver — siempre disponible */
      const backBtn = document.getElementById('exp-back-btn');
      if (backBtn && _hitTest(px, py, backBtn)) {
        _transitionTo(AppState.MENU);
        break;
      }

      /* 2. Dots — nav (inicio/fin) o checkpoint intermedio */
      const hitDot = _getDotAt(px, py);
      if (hitDot) {
        if (hitDot.dataset.nav === 'start') {
          _jumpToScene(0);
        } else if (hitDot.dataset.nav === 'end') {
          const sc = getValidScenes(_activePresenter);
          _jumpToScene(sc.length - 1);
        } else {
          const idx = parseInt(hitDot.dataset.sceneIdx, 10);
          _jumpToCheckpoint(idx);
        }
        break;
      }

      /* Pinza en cualquier otro lugar: ignorar completamente */
      break;
    }

    case AppState.MIRROR:
      _transitionTo(AppState.TUTORIAL);
      break;

    case AppState.FINAL:
      // Detectar cuál botón está bajo el cursor
      _handleFinalPinch(e.detail.x, e.detail.y);
      break;

    case AppState.PHOTOBOOTH: {
      const { x: pbx, y: pby } = e.detail;
      /* Botón "← Volver" → menú de selección */
      const pbBack = document.getElementById('photobooth-back');
      if (pbBack && _hitTest(pbx, pby, pbBack)) {
        _transitionTo(AppState.MENU);
        break;
      }
      /* Botón 📷 → iniciar cuenta regresiva */
      _handlePhotoBoothPinch(pbx, pby);
      break;
    }

    case AppState.PHOTO_RESULT:
      // Detectar botón de acción en la pantalla de foto
      _handlePhotoResultPinch(e.detail.x, e.detail.y);
      break;
  }
}

/* ── Máquina de estados ──────────────────────────────────── */

/**
 * Realiza la transición a un nuevo estado con fade negro opcional.
 * @param {string}  state      - valor de AppState
 * @param {boolean} immediate  - si true, sin animación de fade
 */
async function _transitionTo(state, immediate = false) {
  if (_currentState === state || _isTransitioning) return;
  _isTransitioning = true;

  console.log(`[App] ${_currentState} → ${state}`);

  if (!immediate) {
    await _fadeOut();
  }

  /* Limpiar estado anterior */
  _onLeaveState(_currentState);

  _currentState = state;

  /* Activar escena */
  document.querySelectorAll('.scene').forEach(s => s.classList.remove('active'));
  const sceneEl = document.getElementById(`scene-${state}`);
  if (sceneEl) sceneEl.classList.add('active');

  /* Inicializar estado nuevo */
  _onEnterState(state);

  if (!immediate) {
    await _fadeIn();
  }

  _isTransitioning = false;
}

function _onLeaveState(state) {
  if (!state) return;
  if (state === AppState.EXPERIENCE) {
    document.body.classList.remove('experience-mode');
    _cancelDwell();
    _stopExperienceMedia();
  }
  if (state === AppState.STANDBY) {
    document.body.classList.remove('standby-mode');
    const videoEl = document.getElementById('standby-video');
    if (videoEl) videoEl.pause();
  }
  if (state === AppState.FINAL ||
      state === AppState.PHOTOBOOTH ||
      state === AppState.PHOTO_RESULT) {
    _onLeaveStateFinal();
  }
  if (state === AppState.MIRROR) {
    _stopMirrorCountdown();
    stopMagicMirror();
    document.body.classList.remove('mirror-mode');
  }
  if (state === AppState.TUTORIAL) {
    const v = document.getElementById('tuto-video');
    const a = document.getElementById('tuto-audio');
    if (v) { v.loop = false; v.pause(); v.onended = null; v.src = ''; }
    if (a) { a.pause(); a.onended = null; a.src = ''; }
    if (_tutoFallbackTimer)   { clearTimeout(_tutoFallbackTimer);   _tutoFallbackTimer   = null; }
    if (_tutoAudioDelayTimer) { clearTimeout(_tutoAudioDelayTimer); _tutoAudioDelayTimer = null; }
    if (typeof detachCaptions === 'function') detachCaptions();
  }
  if (state === AppState.INTRO) {
    const a   = document.getElementById('intro-audio');
    const img = document.getElementById('intro-presenter-img');
    if (a)   { a.pause(); a.onended = null; a.src = ''; }
    if (img) { img.src = ''; }
    if (_introFallbackTimer)   { clearTimeout(_introFallbackTimer);   _introFallbackTimer   = null; }
    if (_introAudioDelayTimer) { clearTimeout(_introAudioDelayTimer); _introAudioDelayTimer = null; }
    if (typeof detachCaptions === 'function') detachCaptions();
  }
  if (state === AppState.OUTRO) {
    const a = document.getElementById('outro-audio');
    if (a) { a.pause(); a.onended = null; a.src = ''; }
    if (_outroFallbackTimer)   { clearTimeout(_outroFallbackTimer);   _outroFallbackTimer   = null; }
    if (_outroAudioDelayTimer) { clearTimeout(_outroAudioDelayTimer); _outroAudioDelayTimer = null; }
    if (typeof detachCaptions === 'function') detachCaptions();
  }
  if (state === AppState.MENU) {
    if (_menuInstructionTimer) { clearTimeout(_menuInstructionTimer); _menuInstructionTimer = null; }
    if (_menuInstructionAudio) { _menuInstructionAudio.pause(); _menuInstructionAudio = null; }
  }
}

function _onEnterState(state) {
  switch (state) {
    case AppState.STANDBY:
      _setupStandby();
      break;
    case AppState.MENU:
      _setupMenu();
      break;
    case AppState.INTRO:
      _setupIntro();
      break;
    case AppState.OUTRO:
      _setupOutro();
      break;
    case AppState.EXPERIENCE:
      document.body.classList.add('experience-mode');
      _setupExperience();
      break;
    case AppState.FINAL:
      _setupFinal();
      break;
    case AppState.MIRROR:
      document.body.classList.add('mirror-mode');
      startMagicMirror(_webcamEl);
      _startMirrorCountdown();
      break;
    case AppState.TUTORIAL:
      _setupTutorial();
      break;
  }
}

/* ── Escena: STANDBY ─────────────────────────────────────── */

function _setupStandby() {
  _handShownInStandby = false;
  document.body.classList.add('standby-mode');

  /* ── Video de fondo en loop ── */
  const videoEl = document.getElementById('standby-video');
  if (videoEl) {
    videoEl.src = 'assets/videos/Prototipo/Video_standby_v2_KlingAI.mp4';
    videoEl.load();
    videoEl.play().catch(() => {
      // Fallback a la versión v1 si v2 no carga
      videoEl.src = 'assets/videos/Prototipo/Video_standby_v1_PixVerseAI.mp4';
      videoEl.play().catch(e =>
        console.warn('[App] Video standby no disponible:', e)
      );
    });
  }

  /* ── Música ambiente ── */
  _startAmbientMusic();

  /* ── Ocultar indicador de mano por si quedó visible ── */
  const indicator = document.getElementById('hand-detected-indicator');
  if (indicator) indicator.classList.add('hidden');

  console.log('[App] Escena Standby activa.');
}

function _showHandIndicator() {
  const indicator = document.getElementById('hand-detected-indicator');
  if (!indicator) return;
  indicator.classList.remove('hidden');
  // Se oculta automáticamente al hacer la transición al menú
}

/* ── Escena: TUTORIAL ────────────────────────────────────── */

function _setupTutorial() {
  const videoEl = document.getElementById('tuto-video');
  const audioEl = document.getElementById('tuto-audio');

  if (!videoEl) {
    console.warn('[App] #tuto-video no encontrado — saltando a STANDBY');
    _transitionTo(AppState.STANDBY);
    return;
  }

  /* ── Video en loop hasta que el audio termine ── */
  videoEl.loop  = true;
  videoEl.muted = false;
  videoEl.src   = 'assets/videos/Prototipo/Tuto1.mp4';
  videoEl.load();
  videoEl.play().catch(err => console.warn('[App] Tuto video:', err));

  /* Cuando el audio termina: desactivar loop y esperar que el ciclo actual
   * del video llegue a su fin natural (sin interrumpirlo a mitad). */
  const _doTutoTransition = () => {
    if (_tutoFallbackTimer) { clearTimeout(_tutoFallbackTimer); _tutoFallbackTimer = null; }
    videoEl.loop = false;
    videoEl.addEventListener('ended', () => {
      if (_currentState === AppState.TUTORIAL) _transitionTo(AppState.STANDBY);
    }, { once: true });
  };

  /* ── Audio: inicia 3 s después del video ── */
  _tutoAudioDelayTimer = setTimeout(() => {
    _tutoAudioDelayTimer = null;
    if (!audioEl) { _doTutoTransition(); return; }
    audioEl.src = 'assets/Audios_Definitivos/VozEnOff/Instruccion_Gesto_pinza.mp3';
    audioEl.load();
    audioEl.onended = () => { audioEl.onended = null; _doTutoTransition(); };
    audioEl.play().catch(err => {
      console.warn('[App] Tuto audio:', err);
      _doTutoTransition();
    });
    if (typeof attachCaptions === 'function') attachCaptions(audioEl, getCaptionUrl(audioEl.src));
    _applyVolumes();
  }, 3000);

  /* Fallback global: máximo 90 s por si algo falla */
  _tutoFallbackTimer = setTimeout(() => {
    _tutoFallbackTimer = null;
    if (_tutoAudioDelayTimer) { clearTimeout(_tutoAudioDelayTimer); _tutoAudioDelayTimer = null; }
    if (_currentState === AppState.TUTORIAL) _transitionTo(AppState.STANDBY);
  }, 90000);

  /* Click del mouse → skip tutorial */
  document.getElementById('scene-tutorial')?.addEventListener('click', () => {
    if (_currentState === AppState.TUTORIAL) _transitionTo(AppState.STANDBY);
  }, { once: true });

  console.log('[App] Escena Tutorial activa.');
}

/* ── Escena: INTRO (pantalla de carga entre menú y experiencia) ── */

let _introFallbackTimer  = null;
let _introAudioDelayTimer = null;

function _setupIntro() {
  if (!_activePresenter) { _transitionTo(AppState.EXPERIENCE); return; }

  const audioEl = document.getElementById('intro-audio');
  const imgEl   = document.getElementById('intro-presenter-img');

  /* Mostrar la imagen fondoFinal del presentador a tamaño mediano */
  if (imgEl) {
    imgEl.src = _activePresenter.fondoFinal || '';
  }

  /* Transición al final del audio de introducción */
  const _doIntroTransition = () => {
    if (_introFallbackTimer)   { clearTimeout(_introFallbackTimer);   _introFallbackTimer   = null; }
    if (_introAudioDelayTimer) { clearTimeout(_introAudioDelayTimer); _introAudioDelayTimer = null; }
    if (_currentState === AppState.INTRO) _transitionTo(AppState.EXPERIENCE);
  };

  /* ── Audio: inicia tras un breve delay de 1 s ── */
  _introAudioDelayTimer = setTimeout(() => {
    _introAudioDelayTimer = null;
    if (!audioEl || !_activePresenter.introAudio) { _doIntroTransition(); return; }
    audioEl.src = _activePresenter.introAudio;
    audioEl.load();
    audioEl.onended = () => { audioEl.onended = null; _doIntroTransition(); };
    audioEl.play().catch(err => {
      console.warn('[App] Intro audio:', err);
      _doIntroTransition();
    });
    if (typeof attachCaptions === 'function') attachCaptions(audioEl, getCaptionUrl(audioEl.src));
    _applyVolumes();
  }, 1000);

  /* Fallback global: máximo 90 s */
  _introFallbackTimer = setTimeout(() => {
    _introFallbackTimer = null;
    if (_introAudioDelayTimer) { clearTimeout(_introAudioDelayTimer); _introAudioDelayTimer = null; }
    if (_currentState === AppState.INTRO) _transitionTo(AppState.EXPERIENCE);
  }, 90000);

  /* Click del mouse → skip intro */
  document.getElementById('scene-intro')?.addEventListener('click', () => {
    if (_currentState === AppState.INTRO) _transitionTo(AppState.EXPERIENCE);
  }, { once: true });

  console.log('[App] Intro activa —', _activePresenter.label);
}

/* ── Escena: OUTRO (pantalla de cierre al terminar la experiencia) ── */

let _outroFallbackTimer  = null;
let _outroAudioDelayTimer = null;

function _setupOutro() {
  /* Sin video: pantalla negra + marco vanity + logo + barras.
   * El audio empieza de inmediato; al terminar → FINAL. */
  const audioEl = document.getElementById('outro-audio');

  const _doOutroTransition = () => {
    if (_outroFallbackTimer) { clearTimeout(_outroFallbackTimer); _outroFallbackTimer = null; }
    if (_currentState === AppState.OUTRO) _transitionTo(AppState.FINAL);
  };

  if (audioEl) {
    audioEl.src = 'assets/Audios_Definitivos/VozEnOff/Instruccion_Probarse_el_maquillaje.mp3';
    audioEl.load();
    audioEl.onended = () => { audioEl.onended = null; _doOutroTransition(); };
    audioEl.play().catch(err => {
      console.warn('[App] Outro audio:', err);
      _doOutroTransition();
    });
    if (typeof attachCaptions === 'function') attachCaptions(audioEl, getCaptionUrl(audioEl.src));
    _applyVolumes();
  } else {
    /* Sin elemento de audio → pasar directamente */
    _doOutroTransition();
  }

  /* Fallback: máximo 30 s */
  _outroFallbackTimer = setTimeout(() => {
    _outroFallbackTimer = null;
    if (_currentState === AppState.OUTRO) _transitionTo(AppState.FINAL);
  }, 30000);

  /* Click del mouse → skip outro */
  document.getElementById('scene-outro')?.addEventListener('click', () => {
    if (_currentState === AppState.OUTRO) _transitionTo(AppState.FINAL);
  }, { once: true });

  console.log('[App] Outro activo — instrucción maquillaje.');
}

/* ── Música ambiente ─────────────────────────────────────── */

function _startAmbientMusic() {
  if (!_ambientMusic) return;

  /* El volumen lo gestiona _applyVolumes — nunca sobreescribir aquí */
  _applyVolumes();

  _ambientMusic.play().catch(() => {
    // El navegador bloquea audio sin interacción del usuario.
    // Se intentará de nuevo en la primera interacción (handMove o click).
    const unlockAudio = () => {
      _ambientMusic.play().catch(() => {});
      document.removeEventListener('handMove', unlockAudio);
      document.removeEventListener('click',    unlockAudio);
    };
    document.addEventListener('handMove', unlockAudio, { once: true });
    document.addEventListener('click',    unlockAudio, { once: true });
  });
}

function _stopAmbientMusic() {
  if (!_ambientMusic) return;
  _ambientMusic.pause();
}

/* ── Mirror countdown ────────────────────────────────────────── */

function _startMirrorCountdown() {
  _mirrorCdSecs = _MIRROR_CD_SECS;
  _applyMirrorCountdown();
  _stopMirrorCountdown();   /* limpiar cualquier timer previo */
  _mirrorCdTimer = setInterval(() => {
    _mirrorCdSecs = Math.max(0, _mirrorCdSecs - 1);
    _applyMirrorCountdown();
    if (_mirrorCdSecs <= 0) {
      _stopMirrorCountdown();
      if (_currentState === AppState.MIRROR) {
        console.log('[Mirror] Countdown llegó a 0 → STANDBY');
        _transitionTo(AppState.STANDBY);
      }
    }
  }, 1000);
}

function _stopMirrorCountdown() {
  if (_mirrorCdTimer) { clearInterval(_mirrorCdTimer); _mirrorCdTimer = null; }
}

/** Resetea el contador a 60 s cuando hay interacción (handMove) */
function _resetMirrorCountdown() {
  _mirrorCdSecs = _MIRROR_CD_SECS;
  _applyMirrorCountdown();
}

/** Actualiza el DOM del ring SVG y el número */
function _applyMirrorCountdown() {
  const ring = document.getElementById('mirror-cd-ring');
  const num  = document.getElementById('mirror-cd-num');
  if (!ring || !num) return;

  const frac = _mirrorCdSecs / _MIRROR_CD_SECS;
  ring.style.strokeDashoffset = _MIRROR_CD_CIRC * (1 - frac);

  /* Color: dorado → naranja → rojo según urgencia */
  if (frac > 0.4) {
    ring.style.stroke = 'rgba(212, 175, 55, 0.85)';
  } else if (frac > 0.15) {
    ring.style.stroke = 'rgba(255, 155, 40, 0.9)';
  } else {
    ring.style.stroke = 'rgba(255, 75, 75, 0.9)';
  }

  num.textContent = _mirrorCdSecs;
}

/* ── Escena: MENÚ ────────────────────────────────────────── */

function _setupMenu() {
  const grid = document.getElementById('presenters-grid');
  if (!grid) return;

  /* Generar cards solo si no existen todavía */
  if (grid.children.length === 0) {
    _buildPresenterCards(grid);
  }

  /* Instrucción de selección — 3 s de delay, solo una vez por sesión */
  if (!_menuInstructionPlayed) {
    _menuInstructionTimer = setTimeout(() => {
      _menuInstructionTimer  = null;
      _menuInstructionPlayed = true;
      _menuInstructionAudio  = new Audio(
        'assets/Audios_Definitivos/VozEnOff/Instruccion_Seleccion_de_Presentador.mp3'
      );
      const mf = _audioConfig.mutemaster ? 0 : _audioConfig.master / 100;
      _menuInstructionAudio.volume = mf * (_audioConfig.mutevoz ? 0 : _audioConfig.voz / 100);
      _menuInstructionAudio.play().catch(() => {});
      if (typeof attachCaptions === 'function')
        attachCaptions(_menuInstructionAudio, getCaptionUrl(_menuInstructionAudio.src));
    }, 3000);
  }

  console.log('[App] Escena Menú activa.');
}

function _buildPresenterCards(container) {
  PRESENTERS.forEach((presenter, index) => {
    /* Wrapper: contiene el óvalo + nombre debajo (columna flex) */
    const wrapper = document.createElement('div');
    wrapper.className = 'card-wrapper';
    wrapper.style.animationDelay = `${index * 0.10}s`;

    /* Óvalo con overflow:hidden — solo contenido visual */
    const card = document.createElement('div');
    card.className = 'presenter-card';
    card.dataset.presenterId = presenter.id;
    /* Fondo del hover de menú: siempre presenter.fondo (independiente de cardBg) */
    card.dataset.hoverBg = `url('${presenter.fondo}')`;

    /* Capa fondo (escenario) — usa cardBg si existe (permite fondo de tarjeta
       distinto al fondo del hover de menú que siempre usa presenter.fondo) */
    const bg = document.createElement('div');
    bg.className = 'card-bg';
    bg.style.backgroundImage = `url('${presenter.cardBg || presenter.fondo}')`;
    card.appendChild(bg);

    /* Fade superior */
    const topFade = document.createElement('div');
    topFade.className = 'card-top-fade';
    card.appendChild(topFade);

    /* Capa personaje */
    const character = document.createElement('div');
    character.className = 'card-character';
    character.style.backgroundImage = `url('${presenter.personaje}')`;
    card.appendChild(character);

    /* Ring de selección */
    const ring = document.createElement('div');
    ring.className = 'card-select-ring';
    card.appendChild(ring);

    /* Click de ratón / touch — misma lógica que pinch confirmado */
    card.addEventListener('click', () => {
      if (_currentState !== AppState.MENU) return;
      _activePresenter = PRESENTERS.find(p => p.id === presenter.id);
      if (_activePresenter) {
        triggerSelectionFlash();
        _clearPinchBars();
        _currentSceneIdx = 0;
        setTimeout(() => _transitionTo(AppState.INTRO), 900);
      }
    });

    /* Barra de progreso (oculta por CSS) */
    const pinchBar = document.createElement('div');
    pinchBar.className = 'card-pinch-bar';
    card.appendChild(pinchBar);

    wrapper.appendChild(card);

    /* Nombre — fuera del óvalo, debajo de él */
    const name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = presenter.label;
    wrapper.appendChild(name);

    container.appendChild(wrapper);
  });
}

/**
 * Aplica efecto hover a la card bajo las coordenadas dadas.
 * También activa el efecto parallax en las capas bg/character.
 */
function _updatePresenterHover(x, y) {
  const cards   = document.querySelectorAll('.presenter-card');
  const menuBg  = document.getElementById('menu-bg');
  let hoveredCard = null;

  cards.forEach(card => {
    const rect   = card.getBoundingClientRect();
    const inside = x >= rect.left && x <= rect.right &&
                   y >= rect.top  && y <= rect.bottom;

    card.classList.toggle('hovered', inside);
    if (inside) hoveredCard = card;

    if (inside) {
      /* Parallax: mover bg y character en direcciones opuestas */
      const cx = (x - rect.left)  / rect.width  - 0.5;
      const cy = (y - rect.top)   / rect.height - 0.5;
      const bgEl = card.querySelector('.card-bg');
      const chEl = card.querySelector('.card-character');
      if (bgEl) bgEl.style.transform = `translate(${cx * -12}px, ${cy * -8}px)`;
      if (chEl) chEl.style.transform = `translate(${cx *  8}px, ${cy *  5}px)`;
    } else {
      /* Restaurar parallax */
      const bgEl = card.querySelector('.card-bg');
      const chEl = card.querySelector('.card-character');
      if (bgEl) bgEl.style.transform = '';
      if (chEl) chEl.style.transform = '';
    }
  });

  /* ── Fondo dinámico de escena ── */
  if (menuBg) {
    if (hoveredCard) {
      /* Usar data-hover-bg (siempre presenter.fondo), NO el fondo de la tarjeta
         que puede ser distinto (ej. Presentador de Noticias usa cardBg diferente) */
      const url = hoveredCard.dataset.hoverBg;
      if (url) {
        /* Solo actualizar si cambió de presentador — evita recalcular en cada frame */
        if (menuBg.style.backgroundImage !== url) {
          menuBg.style.backgroundImage = url;
        }
        menuBg.style.opacity = '1';
      }
    } else {
      menuBg.style.opacity = '0';
    }
  }
}

/**
 * Devuelve el elemento .presenter-card que contiene las coordenadas (x,y).
 */
function _getCardAt(x, y) {
  const cards = document.querySelectorAll('.presenter-card');
  for (const card of cards) {
    const r = card.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return card;
    }
  }
  return null;
}

/* ── Escena: EXPERIENCIA ─────────────────────────────────── */

let _progressRafId   = null;   // requestAnimationFrame para la barra de progreso
let _sceneVideoEnded = false;  // el video de la escena actual ha terminado
let _sceneAudioEnded = false;  // el audio (o todos los tracks) han terminado

/* ── Dwell selection (hover-and-wait para dots y botón volver) ─── */
const _DWELL_MS   = 1500;  // ms de hover continuo para confirmar
let   _dwellEl    = null;  // elemento que está siendo "habitado"
let   _dwellStart = null;  // timestamp de inicio del dwell
let   _dwellRafId = null;  // ID del rAF del tick de progreso

/**
 * Comprueba si tanto el video como el audio de la escena actual han terminado.
 * Solo cuando los dos están listos se avanza a la siguiente escena/idle.
 */
function _checkSceneComplete() {
  if (_sceneVideoEnded && _sceneAudioEnded) {
    _advanceExperience();
  }
}

function _setupExperience() {
  if (!_activePresenter) return;
  const scenes = getValidScenes(_activePresenter);
  if (scenes.length === 0) {
    console.warn('[App] No hay escenas válidas para', _activePresenter.id);
    _transitionTo(AppState.MENU);
    return;
  }

  /* Nombre del presentador */
  const nameEl = document.getElementById('exp-presenter-name');
  if (nameEl) nameEl.textContent = _activePresenter.label.replace('\n', ' ');

  /* Botón Volver — click con mouse */
  const backBtn = document.getElementById('exp-back-btn');
  if (backBtn) {
    backBtn.onclick = () => _transitionTo(AppState.MENU);
  }

  /* Dots de capítulos */
  _buildExpDots(scenes);

  /* Iniciar primera escena */
  _playScene(scenes[_currentSceneIdx]);

  console.log('[App] Experiencia:', _activePresenter.label,
    '— escena', _currentSceneIdx + 1, '/', scenes.length);
}

function _buildExpDots(scenes) {
  const track = document.getElementById('exp-progress-track');
  if (!track) return;
  /* Eliminar dots previos sin tocar el fill */
  track.querySelectorAll('.exp-dot').forEach(d => d.remove());
  const total = scenes.length;

  /* ── Dot de INICIO (verde) — reproduce la Escena 1 ── */
  const startDot = document.createElement('div');
  startDot.className = 'exp-dot exp-dot--nav';
  startDot.dataset.nav = 'start';
  startDot.style.left  = '0%';
  startDot.title = 'Volver al inicio';
  startDot.addEventListener('click', () => _jumpToScene(0));
  track.appendChild(startDot);

  /* ── Dots de checkpoint intermedios ── */
  scenes.forEach((scene, i) => {
    if (!scene.idle) return;
    const dot = document.createElement('div');
    dot.className = 'exp-dot';
    dot.dataset.sceneIdx = i;
    dot.style.left = ((i + 1) / total * 100) + '%';
    dot.addEventListener('click', () => _jumpToCheckpoint(i));
    track.appendChild(dot);
  });

  /* ── Dot de FIN (verde) — reproduce la última escena ── */
  const endDot = document.createElement('div');
  endDot.className = 'exp-dot exp-dot--nav';
  endDot.dataset.nav = 'end';
  endDot.style.left  = '100%';
  endDot.title = 'Ir a la última escena';
  endDot.addEventListener('click', () => _jumpToScene(total - 1));
  track.appendChild(endDot);
}

function _updateExpDots(currentIdx, isCheckpoint = false) {
  document.querySelectorAll('.exp-dot').forEach(dot => {
    /* Saltear los dots de navegación (inicio/fin) — no cambian de estado */
    if (dot.dataset.nav) return;
    const idx = parseInt(dot.dataset.sceneIdx, 10);
    dot.className = 'exp-dot';
    if (idx < currentIdx) {
      dot.classList.add('done');
    } else if (idx === currentIdx && isCheckpoint) {
      dot.classList.add('checkpoint');
    }
  });
}

function _playScene(scene) {
  const videoEl  = document.getElementById('exp-video');
  const audioEl  = document.getElementById('exp-audio');
  const hintEl   = document.getElementById('exp-continue-hint');
  const fadeEl   = document.getElementById('exp-scene-fade');
  const fillEl   = document.getElementById('exp-progress-fill');

  if (!videoEl) return;

  const scenes = getValidScenes(_activePresenter);
  const total  = scenes.length;

  /* Dots */
  _updateExpDots(_currentSceneIdx);

  /* Ocultar hint de continuar */
  if (hintEl) hintEl.classList.add('hidden');

  /* Posición inicial de la barra en el progreso global */
  if (fillEl) fillEl.style.width = (_currentSceneIdx / total * 100) + '%';

  /* Fade out antes de cambiar video (excepto la primera escena) */
  const doFade = _currentSceneIdx > 0;

  const startVideo = () => {
    /* Resetear flags de fin de escena */
    _sceneVideoEnded = false;
    _sceneAudioEnded = false;

    /* Video — soporta clip único (string) o secuencia de clips (array) */
    const videoClips = Array.isArray(scene.video) ? scene.video : [scene.video];
    let _videoIdx = 0;

    const _playNextClip = () => {
      if (_videoIdx >= videoClips.length) {
        /* Todos los clips terminaron — limpiar handlers de progreso */
        videoEl.onended      = null;
        videoEl.ontimeupdate = null;
        _sceneVideoEnded = true;

        if (!_sceneAudioEnded) {
          /* El audio sigue sonando: hacer bridge con el idle en loop
           * para no congelar la imagen mientras el audio termina.
           * Fallback: si la escena no tiene idle (última escena),
           * usar el último idle del presentador. */
          const bridgeSrc = scene.idle?.video
            ?? (_activePresenter.idleVideos?.slice(-1)[0] ?? null);

          if (bridgeSrc) {
            videoEl.loop = true;
            videoEl.src  = bridgeSrc;
            videoEl.load();
            videoEl.play().catch(e => {
              if (e.name !== 'AbortError') console.warn('[App] Idle bridge error:', e);
            });
            console.log('[App] Bridge idle activo — esperando fin de audio');
          }
          /* _checkSceneComplete() se llamará cuando el audio termine */
        } else {
          _checkSceneComplete();
        }
        return;
      }
      videoEl.pause();
      videoEl.src = videoClips[_videoIdx++];
      videoEl.load();
      videoEl.onended = _playNextClip;
      videoEl.play().catch(e => {
        if (e.name !== 'AbortError') console.warn('[App] Video play error:', e);
      });
    };

    _playNextClip();

    /* Actualizar barra de progreso — progreso global de la experiencia */
    videoEl.ontimeupdate = () => {
      if (!videoEl.duration || !fillEl) return;
      /* Fracción del clip actual dentro de la escena */
      const clipFrac = videoEl.currentTime / videoEl.duration;
      /* Progreso global: escenas completadas + fracción de la escena actual */
      const overall = (_currentSceneIdx + clipFrac) / total;
      fillEl.style.width = (overall * 100) + '%';
    };

    /* Audio sincronizado — soporta string único o array de tracks encadenados */
    if (audioEl) {
      audioEl.pause();
      audioEl.onended = null;

      const tracks = scene.audio
        ? (Array.isArray(scene.audio) ? scene.audio : [scene.audio])
        : [];

      if (tracks.length > 0) {
        let _trackIdx = 0;
        const _playNextTrack = () => {
          if (_trackIdx >= tracks.length) {
            /* Último track terminado — marcar audio completo */
            audioEl.onended = null;
            _sceneAudioEnded = true;
            if (typeof detachCaptions === 'function') detachCaptions();

            /* Si había un bridge idle en loop, detenerlo antes de avanzar */
            if (_sceneVideoEnded && videoEl.loop) {
              videoEl.loop = false;
              videoEl.pause();
              videoEl.src = '';
              console.log('[App] Bridge idle detenido — audio completado');
            }

            _checkSceneComplete();
            return;
          }
          audioEl.src = tracks[_trackIdx++];
          audioEl.load();
          audioEl.onended = _playNextTrack;
          audioEl.play().catch(e => {
            if (e.name !== 'AbortError') console.warn('[App] Audio play error:', e);
          });
          if (typeof attachCaptions === 'function') attachCaptions(audioEl, getCaptionUrl(audioEl.src));
        };
        _playNextTrack();
      } else {
        /* Sin audio — marcar como completado de inmediato */
        _sceneAudioEnded = true;
        audioEl.src = '';
      }
    } else {
      /* Sin elemento de audio — no bloquear avance */
      _sceneAudioEnded = true;
    }

    /* Aplicar volúmenes actuales a video y audio recién iniciados */
    _applyVolumes();

    /* Fade in */
    if (fadeEl) {
      fadeEl.classList.remove('active');
    }
  };

  if (doFade && fadeEl) {
    fadeEl.classList.add('active');
    setTimeout(startVideo, 320);
  } else {
    startVideo();
  }
}

function _advanceExperience() {
  if (!_activePresenter) return;
  const scenes = getValidScenes(_activePresenter);

  /* Si ya estamos en idle, el pinch lo gestiona _exitIdleMode — no avanzar aquí */
  if (_isIdleMode) return;

  const currentScene = scenes[_currentSceneIdx];

  /* ¿La escena actual tiene un idle con video? → entrar en checkpoint */
  if (currentScene?.idle?.video) {
    _enterIdleMode(currentScene.idle);
    return;
  }

  /* Sin idle → avanzar directo a la siguiente escena o al outro/final */
  _currentSceneIdx++;
  if (_currentSceneIdx < scenes.length) {
    _playScene(scenes[_currentSceneIdx]);
    console.log('[App] Avanzando a escena', _currentSceneIdx + 1, '/', scenes.length);
  } else {
    _transitionTo(AppState.OUTRO);
  }
}

function _stopExperienceMedia() {
  /* Detener reconocimiento de objetos si estaba activo */
  if (typeof stopDetecting === 'function') stopDetecting();

  const videoEl    = document.getElementById('exp-video');
  const audioEl    = document.getElementById('exp-audio');
  const fadeEl     = document.getElementById('exp-scene-fade');
  const hintEl     = document.getElementById('exp-continue-hint');
  const idleOverlay= document.getElementById('exp-idle-overlay');

  if (videoEl) {
    videoEl.pause();
    videoEl.loop = false;
    videoEl.src  = '';
    videoEl.onended      = null;
    videoEl.ontimeupdate = null;
  }
  if (audioEl) { audioEl.pause(); audioEl.onended = null; audioEl.src = ''; }
  if (typeof detachCaptions === 'function') detachCaptions();
  _sceneVideoEnded = false;
  _sceneAudioEnded = false;
  if (fadeEl)  { fadeEl.classList.remove('active'); }
  if (hintEl)  { hintEl.classList.add('hidden'); }
  if (idleOverlay) {
    idleOverlay.classList.add('hidden');
    idleOverlay.onclick = null;
  }

  /* Limpiar video del objeto físico */
  const objectVideoEl = document.getElementById('exp-idle-object');
  if (objectVideoEl) { objectVideoEl.pause(); objectVideoEl.src = ''; }

  /* Desconectar cámara del overlay idle */
  const idleCameraEl = document.getElementById('exp-idle-camera');
  if (idleCameraEl) idleCameraEl.srcObject = null;

  _isIdleMode = false;
  cancelAnimationFrame(_progressRafId);
}

/* ── Modo idle (checkpoint entre escenas) ────────────────── */

/**
 * Entra en modo idle: el video del checkpoint se reproduce en loop
 * mientras el usuario busca el objeto físico pedido.
 * La barra de progreso llega al 100 % y el dot muestra ✓ checkpoint.
 * @param {{ video: string, hint: string }} idle
 */
function _enterIdleMode(idle) {
  _isIdleMode = true;

  const videoEl    = document.getElementById('exp-video');
  const audioEl    = document.getElementById('exp-audio');
  const fadeEl     = document.getElementById('exp-scene-fade');
  const fillEl     = document.getElementById('exp-progress-fill');
  const hintEl     = document.getElementById('exp-continue-hint');
  const idleOverlay= document.getElementById('exp-idle-overlay');
  const idleHintEl = document.getElementById('exp-idle-hint');

  /* Barra al progreso correspondiente al checkpoint alcanzado */
  const _idleScenes = getValidScenes(_activePresenter);
  if (fillEl) fillEl.style.width = ((_currentSceneIdx + 1) / _idleScenes.length * 100) + '%';

  /* Dot del checkpoint */
  _updateExpDots(_currentSceneIdx, true);

  /* Ocultar hint de "continuar" — el overlay idle lo reemplaza */
  if (hintEl) hintEl.classList.add('hidden');

  /* Actualizar texto del overlay */
  if (idleHintEl) idleHintEl.textContent = idle.hint || 'Muestra el objeto a la cámara';

  const startIdleVideo = () => {
    /* Silenciar audio de la escena anterior */
    if (audioEl) { audioEl.pause(); audioEl.src = ''; }

    /* Video en loop sin autoavance */
    if (videoEl) {
      videoEl.pause();
      videoEl.loop         = true;
      videoEl.onended      = null;
      videoEl.ontimeupdate = null;
      videoEl.src          = idle.video;
      videoEl.load();
      videoEl.play().catch(e => {
        if (e.name !== 'AbortError') console.warn('[App] Idle video error:', e);
      });
    }

    /* Mostrar overlay */
    if (idleOverlay) idleOverlay.classList.remove('hidden');

    /* Video del objeto físico (360°) — hint visual del checkpoint */
    const objectVideoEl = document.getElementById('exp-idle-object');
    if (objectVideoEl) {
      if (idle.objectVideo) {
        objectVideoEl.src = idle.objectVideo;
        objectVideoEl.load();
        objectVideoEl.play().catch(e => {
          if (e.name !== 'AbortError') console.warn('[App] Object video error:', e);
        });
        objectVideoEl.style.display = '';
      } else {
        objectVideoEl.style.display = 'none';
      }
    }

    /* Cámara del usuario — conectar el mismo stream del webcam global */
    const idleCameraEl = document.getElementById('exp-idle-camera');
    if (idleCameraEl) {
      const webcamEl = document.getElementById('webcam');
      if (webcamEl?.srcObject) {
        idleCameraEl.srcObject = webcamEl.srcObject;
      }
    }

    /* Reconocimiento de objetos — arranca la detección automática.
     * Si el modelo no está listo, startDetecting() es no-op y el usuario
     * puede seguir avanzando con el gesto de pinza o los dots. */
    if (typeof startDetecting === 'function' && idle.detect?.length) {
      const webcamEl = document.getElementById('webcam');
      startDetecting(webcamEl, idle.detect, () => {
        if (_isIdleMode) _exitIdleMode();
      });
    }

    /* Click en el overlay (ratón) → confirmar checkpoint para testing */
    if (idleOverlay) {
      idleOverlay.onclick = () => { if (_isIdleMode) _exitIdleMode(); };
    }

    /* Fade in */
    if (fadeEl) fadeEl.classList.remove('active');
  };

  /* Fade de transición entre el video principal y el idle */
  if (fadeEl) {
    fadeEl.classList.add('active');
    setTimeout(startIdleVideo, 320);
  } else {
    startIdleVideo();
  }

  console.log('[App] Checkpoint idle — esperando objeto:', idle.hint);
}

/**
 * Sale del modo idle: el usuario hizo pinza confirmando que mostró el objeto.
 * Avanza a la siguiente escena principal.
 */
function _exitIdleMode() {
  _isIdleMode = false;

  /* Detener reconocimiento de objetos */
  if (typeof stopDetecting === 'function') stopDetecting();

  const videoEl    = document.getElementById('exp-video');
  const idleOverlay= document.getElementById('exp-idle-overlay');
  const fillEl     = document.getElementById('exp-progress-fill');

  if (videoEl) videoEl.loop = false;
  if (idleOverlay) {
    idleOverlay.classList.add('hidden');
    idleOverlay.onclick = null;
  }

  /* Limpiar video del objeto físico */
  const objectVideoEl = document.getElementById('exp-idle-object');
  if (objectVideoEl) { objectVideoEl.pause(); objectVideoEl.src = ''; }

  /* Avanzar a la siguiente escena principal (o al outro si era la última) */
  const scenes = getValidScenes(_activePresenter);
  _currentSceneIdx++;

  if (_currentSceneIdx < scenes.length) {
    _playScene(scenes[_currentSceneIdx]);
    console.log('[App] Saliendo de idle → escena', _currentSceneIdx + 1, '/', scenes.length);
  } else {
    _transitionTo(AppState.OUTRO);
  }
}

/* ── Escena: FINAL ───────────────────────────────────────── */

let _finalAutoReturnTimer = null;

function _setupFinal() {
  if (!_activePresenter) return;

  /* Mostrar solo el modo resultado al entrar */
  _showFinalMode('result');

  /* Fondo con la imagen fondoFinal */
  const bgEl  = document.getElementById('final-bg-overlay');
  const imgEl = document.getElementById('final-presenter-img');
  if (bgEl)  bgEl.style.backgroundImage = `url('${_activePresenter.fondoFinal}')`;
  if (imgEl) imgEl.src = _activePresenter.fondoFinal;

  /* Alineación del CTA según el presentador activo */
  const resultMode = document.getElementById('final-result-mode');
  if (resultMode) {
    resultMode.dataset.ctaAlign = _activePresenter.ctaAlign || 'center';
  }

  /* Nombre del presentador en el CTA */
  const nameEl = document.getElementById('final-presenter-name-label');
  if (nameEl) nameEl.textContent = _activePresenter.label;

  /* Hover de botones con la mano */
  document.addEventListener('handMove', _onFinalHandMove);

  /* Click del mouse en los botones de la pantalla de resultado */
  document.getElementById('btn-try-makeup')?.addEventListener('click', () => {
    if (_currentState === AppState.FINAL) {
      clearTimeout(_finalAutoReturnTimer);
      _enterPhotoBooth();
    }
  });
  document.getElementById('btn-back-menu')?.addEventListener('click', () => {
    if (_currentState === AppState.FINAL) _transitionTo(AppState.MENU);
  });

  /* Auto-retorno al menú tras 30 s de inactividad */
  _finalAutoReturnTimer = setTimeout(() => {
    if (_currentState === AppState.FINAL) {
      _transitionTo(AppState.MENU);
    }
  }, 30000);

  console.log('[App] Pantalla final:', _activePresenter.label);
}

function _onLeaveStateFinal() {
  clearTimeout(_finalAutoReturnTimer);
  document.removeEventListener('handMove', _onFinalHandMove);

  stopPhotoBooth();
  stopFaceFilter();

  /* IMPORTANTE: usamos pause (no stop) para preservar la sesión de Snap.
   * Después de transferControlToOffscreen el canvas no puede reutilizarse;
   * si destruimos la sesión con stopSnapFilter() y el usuario vuelve al
   * photobooth, el siguiente createSession() lanzaría InvalidStateError.
   * pause() mantiene la sesión viva pero detiene el render. */
  if (typeof pauseSnapFilter === 'function') {
    pauseSnapFilter().catch(() => {});
  }
  if (typeof setSnapMode === 'function') {
    setSnapMode(false);
  }

  /* Desregistrar el hover del botón 📷 */
  document.removeEventListener('handMove', _onPhotoBoothHandMove);

  /* Restaurar visibilidad de canvases (por si venía del modo photobooth) */
  document.getElementById('snap-canvas')?.classList.add('hidden');
  document.getElementById('photobooth-canvas')?.classList.remove('hidden');
  document.getElementById('photobooth-makeup-canvas')?.classList.remove('hidden');

  /* Restaurar el botón 📷 y quitar estado hovered para la próxima vez */
  const takeBtn = document.getElementById('btn-take-photo');
  if (takeBtn) {
    takeBtn.classList.remove('hidden', 'hovered');
  }
}

/* Mueve el hover sobre los botones del final */
function _onFinalHandMove(e) {
  if (_currentState !== AppState.FINAL) return;
  const { x, y } = e.detail;
  const btn = _getFinalBtnAt(x, y);
  document.querySelectorAll('.final-btn').forEach(b => {
    b.classList.toggle('hovered', b === btn);
  });
}

/* Devuelve el .final-btn bajo las coordenadas dadas */
function _getFinalBtnAt(x, y) {
  const btns = document.querySelectorAll('.final-btn');
  for (const btn of btns) {
    const r = btn.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return btn;
  }
  return null;
}

/* Maneja la pinza en la pantalla final */
function _handleFinalPinch(x, y) {
  const btn = _getFinalBtnAt(x, y);
  if (!btn) return;

  const action = btn.dataset.action;
  if (action === 'makeup') {
    clearTimeout(_finalAutoReturnTimer);
    _enterPhotoBooth();
  } else if (action === 'menu') {
    _transitionTo(AppState.MENU);
  }
}

/* ── Modo Photobooth ─────────────────────────────────────── */

async function _enterPhotoBooth() {
  _showFinalMode('photobooth');
  _currentState = AppState.PHOTOBOOTH;   // sub-estado dentro de FINAL

  /* Restaurar el botón 📷 y el hint — pueden haber quedado ocultos
   * por una sesión de captura anterior (retomar foto). */
  document.getElementById('btn-take-photo')?.classList.remove('hidden', 'hovered');
  document.getElementById('photobooth-hint')?.classList.remove('hidden');
  _photoCapturing = false;   // reset de seguridad

  const makeupCanvas = document.getElementById('photobooth-makeup-canvas');
  const pbCanvas     = document.getElementById('photobooth-canvas');

  /* ── Intentar Snap Camera Kit si está habilitado ── */
  let snapOk = false;
  if (APP_CONFIG.snap.enabled && typeof initSnapFilter === 'function') {
    snapOk = await initSnapFilter(pbCanvas);
    if (snapOk) {
      snapOk = await applySnapLens(_activePresenter.id);
    }
    if (snapOk) {
      setSnapMode(true);
      /* Mostrar el canvas de Snap y ocultar el canvas 2D + makeup overlay
       * (Snap renderiza su propio video con AR; no necesitamos el loop RAF) */
      document.getElementById('snap-canvas')?.classList.remove('hidden');
      document.getElementById('photobooth-canvas')?.classList.add('hidden');
      document.getElementById('photobooth-makeup-canvas')?.classList.add('hidden');
      /* Hover del botón 📷 */
      document.addEventListener('handMove', _onPhotoBoothHandMove);
      console.log('[App] Photobooth activo con Snap Camera Kit —', _activePresenter.id);
      return;
    }
    /* Si Snap falla → caer en Face Mesh */
    console.warn('[App] Snap Camera Kit falló, usando Face Mesh como fallback.');
    setSnapMode(false);
  }

  /* ── Fallback: Face Mesh + render manual ── */
  if (typeof initFaceFilter === 'function') {
    await initFaceFilter(_webcamEl, makeupCanvas);
    setMakeupPreset(_activePresenter.id);
  }
  startPhotoBoothRender();
  /* Hover del botón 📷 también en modo Face Mesh */
  document.addEventListener('handMove', _onPhotoBoothHandMove);

  console.log('[App] Photobooth activo con Face Mesh —', _activePresenter.id);
}

/* Botón oculto en standby → abre el espejo mágico */
document.addEventListener('DOMContentLoaded', () => {
  const mirrorBtn = document.getElementById('btn-magic-mirror');
  if (mirrorBtn) {
    mirrorBtn.addEventListener('click', () => _transitionTo(AppState.MIRROR));
  }
});

/* 10 s de interacción continua en el espejo → video tutorial → standby */
document.addEventListener('mirrorActivated', () => {
  if (_currentState === AppState.MIRROR) {
    console.log('[App] mirrorActivated → transitando a TUTORIAL');
    _transitionTo(AppState.TUTORIAL);
  }
});

/* Botón "← Volver" del photobooth → regresar al modo resultado */
document.addEventListener('DOMContentLoaded', () => {
  const backBtn = document.getElementById('photobooth-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (_currentState === AppState.PHOTOBOOTH) {
        /* _onLeaveStateFinal() se encarga del cleanup de Snap/FaceMesh al transicionar */
        _transitionTo(AppState.MENU);
      }
    });
  }

  /* Botón 📷 "Tomar foto" → lanzar cuenta regresiva con el mouse */
  const takeBtn = document.getElementById('btn-take-photo');
  if (takeBtn) {
    takeBtn.addEventListener('click', () => {
      if (_currentState === AppState.PHOTOBOOTH) {
        _startPhotoCapture();
      }
    });
  }

  /* Botón "Tomar otra" en pantalla de resultado de foto */
  const retakeBtn = document.getElementById('btn-retake');
  if (retakeBtn) {
    retakeBtn.addEventListener('click', () => {
      if (_currentState === AppState.PHOTO_RESULT) _enterPhotoBooth();
    });
  }

  /* Botón "Volver al inicio" en pantalla de resultado de foto */
  const photoMenuBtn = document.getElementById('btn-photo-menu');
  if (photoMenuBtn) {
    photoMenuBtn.addEventListener('click', () => {
      if (_currentState === AppState.PHOTO_RESULT) _transitionTo(AppState.MENU);
    });
  }
});

/**
 * Comprueba si la pinza cayó sobre el botón 📷 y lanza la captura.
 */
function _handlePhotoBoothPinch(x, y) {
  const btn = document.getElementById('btn-take-photo');
  if (!btn || btn.classList.contains('hidden')) return;
  const r = btn.getBoundingClientRect();
  if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
    _startPhotoCapture();
  }
}

/**
 * Hover del cursor sobre el botón 📷 del photobooth.
 */
function _onPhotoBoothHandMove(e) {
  if (_currentState !== AppState.PHOTOBOOTH) return;
  const { x, y } = e.detail;
  const btn = document.getElementById('btn-take-photo');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const over = (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
  btn.classList.toggle('hovered', over);
}

let _photoCapturing = false;
async function _startPhotoCapture() {
  if (_photoCapturing) return;
  _photoCapturing = true;

  /* Ocultar el botón 📷 durante la cuenta regresiva */
  document.getElementById('btn-take-photo')?.classList.add('hidden');
  document.getElementById('photobooth-hint')?.classList.add('hidden');

  try {
    /* Cuenta regresiva + captura */
    const dataURL = await startCountdown();

    /* Flash visual */
    _triggerPhotoFlash();

    /* Detener render loop (la foto ya fue capturada) */
    stopPhotoBooth();
    stopFaceFilter();
    if (typeof pauseSnapFilter === 'function') pauseSnapFilter().catch(() => {});
    if (typeof setSnapMode    === 'function') setSnapMode(false);

    /* Mostrar foto + QR */
    _showPhotoResult(dataURL);
  } catch (err) {
    console.error('[App] Error en captura:', err);
    /* Restaurar el botón si algo falla */
    document.getElementById('btn-take-photo')?.classList.remove('hidden');
    document.getElementById('photobooth-hint')?.classList.remove('hidden');
  } finally {
    _photoCapturing = false;
  }
}

function _triggerPhotoFlash() {
  let flash = document.getElementById('photobooth-flash');
  if (!flash) {
    flash = document.createElement('div');
    flash.id = 'photobooth-flash';
    document.getElementById('final-photobooth-mode')?.appendChild(flash);
  }
  flash.classList.remove('active');
  void flash.offsetWidth;
  flash.classList.add('active');
}

async function _showPhotoResult(dataURL) {
  _showFinalMode('photo');
  _currentState = AppState.PHOTO_RESULT;

  /* Mostrar la foto capturada */
  const img = document.getElementById('captured-photo-img');
  if (img) img.src = dataURL;

  /* Mostrar indicador de carga */
  const uploading = document.getElementById('photo-uploading');
  if (uploading) uploading.classList.remove('hidden');

  /* Subir a Firebase y generar QR */
  await processAndShowQR(dataURL, 'qr-code-container');

  if (uploading) uploading.classList.add('hidden');

  /* Auto-retorno al tutorial/standby tras el tiempo configurado */
  setTimeout(() => {
    if (_currentState === AppState.PHOTO_RESULT) {
      _transitionTo(AppState.TUTORIAL);
    }
  }, APP_CONFIG.photobooth.qrDisplayMs);
}

function _handlePhotoResultPinch(x, y) {
  const retakeBtn = document.getElementById('btn-retake');
  const menuBtn   = document.getElementById('btn-photo-menu');

  if (retakeBtn) {
    const r = retakeBtn.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      _enterPhotoBooth();
      return;
    }
  }
  if (menuBtn) {
    const r = menuBtn.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      _transitionTo(AppState.MENU);
    }
  }
}

/* Muestra uno de los tres sub-modos de la escena final */
function _showFinalMode(mode) {
  const modes = {
    result:   document.getElementById('final-result-mode'),
    photobooth: document.getElementById('final-photobooth-mode'),
    photo:    document.getElementById('final-photo-mode')
  };
  Object.entries(modes).forEach(([key, el]) => {
    if (el) el.classList.toggle('hidden', key !== mode);
  });
}

/* Referencia al webcam para el photobooth */
let _webcamEl = null;

/* ════════════════════════════════════════════════════════════
   PANEL CRISTAL TARJETAS  (tecla G — solo en MENU)
   ════════════════════════════════════════════════════════════ */

let _glassPanelOpen = false;

function _toggleGlassPanel() {
  const panel = document.getElementById('glass-panel');
  if (!panel) return;
  _glassPanelOpen = !_glassPanelOpen;
  panel.classList.toggle('hidden', !_glassPanelOpen);
}

/* Inicializar sliders del panel cristal (una vez, en DOMContentLoaded) */
document.addEventListener('DOMContentLoaded', () => {
  const sparkleSlider = document.getElementById('sparkle-slider');
  const sparkleVal    = document.getElementById('sparkle-val');
  const stripesSlider = document.getElementById('stripes-slider');
  const stripesVal    = document.getElementById('stripes-val');
  const glassPanel    = document.getElementById('glass-panel');

  if (sparkleSlider) {
    sparkleSlider.addEventListener('input', () => {
      const v = parseFloat(sparkleSlider.value).toFixed(2);
      sparkleVal.textContent = v;
      document.documentElement.style.setProperty('--card-sparkle-opacity', v);
    });
  }

  if (stripesSlider) {
    stripesSlider.addEventListener('input', () => {
      const v = parseFloat(stripesSlider.value).toFixed(2);
      stripesVal.textContent = v;
      document.documentElement.style.setProperty('--card-stripes-opacity', v);
    });
  }

  /* Cerrar panel al hacer clic fuera */
  document.addEventListener('click', (e) => {
    if (_glassPanelOpen && glassPanel && !glassPanel.contains(e.target)) {
      _glassPanelOpen = false;
      glassPanel.classList.add('hidden');
    }
  });
});

/* ════════════════════════════════════════════════════════════
   PANEL DE AUDIO  (tecla V)
   4 canales: master · voz en off · videos · música de fondo
   Configuración persistida en localStorage.
   ════════════════════════════════════════════════════════════ */

const _AUDIO_STORAGE_KEY = 'espejoMagico_audioConfig';

/* Valores por defecto */
const _AUDIO_DEFAULTS = {
  master: 100, mutemaster: false,
  voz:    100, mutevoz:    false,
  video:  100, mutevideo:  false,
  music:   35, mutemusic:  false,
};

/* Configuración activa — se carga desde localStorage al iniciar */
let _audioConfig = { ..._AUDIO_DEFAULTS };

let _soundPanelOpen = false;

/* Compatibilidad con código que aún lee _isMuted (ej. _startAmbientMusic) */
Object.defineProperty(window, '_isMuted', {
  get: () => _audioConfig.mutemaster,
  set: () => {},   // no-op — ya no se usa
  configurable: true,
});

function _toggleSoundPanel() {
  const panel = document.getElementById('sound-panel');
  if (!panel) return;
  _soundPanelOpen = !_soundPanelOpen;
  panel.classList.toggle('hidden', !_soundPanelOpen);
}

/**
 * Aplica _audioConfig a todos los elementos de audio/video activos.
 * Llamar siempre que cambie cualquier valor del config.
 */
function _applyVolumes() {
  const mf = _audioConfig.mutemaster ? 0 : _audioConfig.master / 100;

  /* Música de fondo */
  if (_ambientMusic) {
    _ambientMusic.volume = mf * (_audioConfig.mutemusic ? 0 : _audioConfig.music / 100);
  }

  /* Voz en off — todos los canales de narración */
  const vozVol = mf * (_audioConfig.mutevoz ? 0 : _audioConfig.voz / 100);
  const expAudio = document.getElementById('exp-audio');
  if (expAudio)  expAudio.volume  = vozVol;
  const introAudioEl = document.getElementById('intro-audio');
  if (introAudioEl) introAudioEl.volume = vozVol;
  const tutoAudioEl  = document.getElementById('tuto-audio');
  if (tutoAudioEl)  tutoAudioEl.volume  = vozVol;
  const outroAudioEl = document.getElementById('outro-audio');
  if (outroAudioEl) outroAudioEl.volume = vozVol;
  if (_menuInstructionAudio) _menuInstructionAudio.volume = vozVol;

  /* Video */
  const expVideo = document.getElementById('exp-video');
  if (expVideo) {
    expVideo.volume = mf * (_audioConfig.mutevideo ? 0 : _audioConfig.video / 100);
  }
}

/** Guarda la configuración actual en localStorage */
function _saveAudioConfig() {
  try {
    localStorage.setItem(_AUDIO_STORAGE_KEY, JSON.stringify(_audioConfig));
    console.log('[Audio] Configuración guardada.');
  } catch (e) {
    console.warn('[Audio] No se pudo guardar:', e);
  }
}

/** Carga la configuración guardada (si existe) y sincroniza la UI */
function _loadAudioConfig() {
  try {
    const saved = localStorage.getItem(_AUDIO_STORAGE_KEY);
    if (saved) {
      _audioConfig = { ..._AUDIO_DEFAULTS, ...JSON.parse(saved) };
      console.log('[Audio] Configuración cargada desde localStorage.');
    }
  } catch (e) {
    console.warn('[Audio] No se pudo cargar config guardada:', e);
  }
}

/** Sincroniza sliders y botones mute con _audioConfig */
function _syncAudioUI() {
  const channels = ['master', 'voz', 'video', 'music'];
  channels.forEach(ch => {
    const slider  = document.getElementById(`vol-${ch}`);
    const valSpan = document.getElementById(`vol-${ch}-val`);
    const muteBtn = document.getElementById(`btn-mute-${ch}`);

    if (slider)  slider.value       = _audioConfig[ch];
    if (valSpan) valSpan.textContent = _audioConfig[ch] + '%';
    if (muteBtn) {
      const muted = _audioConfig[`mute${ch}`];
      muteBtn.textContent       = muted ? '🔇' : '🔊';
      muteBtn.dataset.muted     = muted ? 'true' : 'false';
    }
  });
}

/* Inicializar panel de audio (una vez, en DOMContentLoaded) */
document.addEventListener('DOMContentLoaded', () => {
  const panel = document.getElementById('sound-panel');

  /* Cargar config guardada y aplicarla */
  _loadAudioConfig();
  _syncAudioUI();
  /* _applyVolumes() se llamará cuando arranque la música en _startAmbientMusic */

  /* Conectar sliders */
  ['master', 'voz', 'video', 'music'].forEach(ch => {
    const slider  = document.getElementById(`vol-${ch}`);
    const valSpan = document.getElementById(`vol-${ch}-val`);
    if (!slider) return;

    slider.addEventListener('input', () => {
      _audioConfig[ch] = parseInt(slider.value, 10);
      if (valSpan) valSpan.textContent = slider.value + '%';
      _applyVolumes();
    });
  });

  /* Conectar botones mute */
  ['master', 'voz', 'video', 'music'].forEach(ch => {
    const btn = document.getElementById(`btn-mute-${ch}`);
    if (!btn) return;
    btn.addEventListener('click', () => {
      _audioConfig[`mute${ch}`] = !_audioConfig[`mute${ch}`];
      const muted = _audioConfig[`mute${ch}`];
      btn.textContent   = muted ? '🔇' : '🔊';
      btn.dataset.muted = muted ? 'true' : 'false';
      _applyVolumes();
    });
  });

  /* Botón Guardar */
  const saveBtn = document.getElementById('btn-save-audio');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      _saveAudioConfig();
      saveBtn.textContent = '✅ Guardado';
      setTimeout(() => { saveBtn.textContent = '💾 Guardar configuración'; }, 1800);
    });
  }

  /* Cerrar panel al hacer clic fuera */
  document.addEventListener('click', (e) => {
    if (_soundPanelOpen && panel && !panel.contains(e.target)) {
      _soundPanelOpen = false;
      panel.classList.add('hidden');
    }
  });
});

/* ════════════════════════════════════════════════════════════
   PANEL DE CONFIG DEL RIPPLE  (tecla C en escena espejo)
   ════════════════════════════════════════════════════════════ */

let _mirrorConfigOpen = false;

function _toggleMirrorConfig() {
  const panel = document.getElementById('mirror-config');
  if (!panel) return;
  _mirrorConfigOpen = !_mirrorConfigOpen;
  panel.classList.toggle('hidden', !_mirrorConfigOpen);
}

document.addEventListener('DOMContentLoaded', () => {
  /* Conectar cada slider del ripple con las variables de magic-mirror.js */
  const bindings = [
    { id: 'cfg-damping', valId: 'cfg-damping-val', decimals: 3,
      set: v => { _mmDamping = v; }  },
    { id: 'cfg-force',   valId: 'cfg-force-val',   decimals: 0,
      set: v => { _mmSplashF = v; } },
    { id: 'cfg-radius',  valId: 'cfg-radius-val',  decimals: 0,
      set: v => { _mmSplashR = v; } },
    { id: 'cfg-disp',    valId: 'cfg-disp-val',    decimals: 1,
      set: v => { _mmDisp    = v; } },
    { id: 'cfg-tint',    valId: 'cfg-tint-val',    decimals: 2,
      set: v => { _mmTint    = v; } },
  ];

  bindings.forEach(({ id, valId, decimals, set }) => {
    const input = document.getElementById(id);
    const label = document.getElementById(valId);
    if (!input) return;
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (label) label.textContent = v.toFixed(decimals);
      set(v);
    });
  });

  /* Botón "Restablecer valores" */
  const resetBtn = document.getElementById('cfg-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      /* Restaurar variables de simulación */
      _mmDamping = MM_DEFAULTS.damping;
      _mmSplashF = MM_DEFAULTS.splashF;
      _mmSplashR = MM_DEFAULTS.splashR;
      _mmDisp    = MM_DEFAULTS.disp;
      _mmTint    = MM_DEFAULTS.tint;

      /* Sincronizar sliders con los valores por defecto */
      const snap = [
        { id: 'cfg-damping', valId: 'cfg-damping-val', v: MM_DEFAULTS.damping, d: 3 },
        { id: 'cfg-force',   valId: 'cfg-force-val',   v: MM_DEFAULTS.splashF, d: 0 },
        { id: 'cfg-radius',  valId: 'cfg-radius-val',  v: MM_DEFAULTS.splashR, d: 0 },
        { id: 'cfg-disp',    valId: 'cfg-disp-val',    v: MM_DEFAULTS.disp,    d: 1 },
        { id: 'cfg-tint',    valId: 'cfg-tint-val',    v: MM_DEFAULTS.tint,    d: 2 },
      ];
      snap.forEach(({ id, valId, v, d }) => {
        const el = document.getElementById(id);
        const lb = document.getElementById(valId);
        if (el) el.value = v;
        if (lb) lb.textContent = v.toFixed(d);
      });
    });
  }
});

/* ── Fade negro entre escenas ────────────────────────────── */

function _fadeOut() {
  return new Promise(resolve => {
    if (!_overlayEl) { resolve(); return; }
    _overlayEl.classList.add('fade-in');
    _overlayEl.classList.remove('fade-out');
    setTimeout(resolve, 380);
  });
}

function _fadeIn() {
  return new Promise(resolve => {
    if (!_overlayEl) { resolve(); return; }
    _overlayEl.classList.remove('fade-in');
    _overlayEl.classList.add('fade-out');
    setTimeout(resolve, 400);
  });
}
