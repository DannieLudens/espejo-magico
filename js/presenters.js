/**
 * presenters.js
 * Configuración y datos de los 4 presentadores del Espejo Mágico.
 *
 * Estructura de cada scene:
 *   video       — ruta al mp4 de la escena principal (null si aún no existe)
 *   audio       — ruta al mp3 del diálogo (null = sin audio)
 *   idle        — objeto opcional para el checkpoint entre escenas.
 *                 La ÚLTIMA escena de cada presentador NO tiene idle.
 *
 * idle: {
 *   objectVideo : video 360° del objeto físico que el usuario debe mostrar
 *   hint        : texto del overlay — describe el objeto a mostrar
 *   (video)     : se resuelve automáticamente por getValidScenes()
 *                 desde el array idleVideos del presentador.
 *                 Si hay más checkpoints que idle videos, se reutiliza el último.
 * }
 *
 * idleVideos    — array de rutas mp4 para el loop de fondo de cada checkpoint.
 *                 Se asignan en orden: checkpointIdx 0 → idleVideos[0], etc.
 *                 Si hay más checkpoints que videos, los sobrantes usan el último.
 *
 * Rutas base de assets definitivos:
 *   Videos : assets/Videos_Definitivos/<Carpeta>/EscenaX.mp4
 *   Idles  : assets/Videos_Definitivos/<Carpeta>/Idles/<nombre>.mp4
 *   Audios : assets/Audios_Definitivos/VozEnOff/<nombre>.mp3
 */

'use strict';

/* ── Rutas base ─────────────────────────────────────────────── */
const _VOZ   = 'assets/Audios_Definitivos/VozEnOff/';
const _VID_P_NOT = 'assets/Videos_Definitivos/Presentadora_De_Noticias/';
const _VID_H_NOT = 'assets/Videos_Definitivos/Presentador_De_Noticias/';
const _VID_MODA  = 'assets/Videos_Definitivos/Presentadora_De_ColModas/';
const _VID_DEP   = 'assets/Videos_Definitivos/Presentador_De_Deportes/';

const _IDL_P_NOT = 'assets/Videos_Definitivos/Presentadora_De_Noticias/Idles/';
const _IDL_H_NOT = 'assets/Videos_Definitivos/Presentador_De_Noticias/Idles/';
const _IDL_MODA  = 'assets/Videos_Definitivos/Presentadora_De_ColModas/Idles/';
const _IDL_DEP   = 'assets/Videos_Definitivos/Presentador_De_Deportes/Idles/';

/* Video de intro (placeholder Tuto1 hasta recibir Tuto2 definitivo) */
const _INTRO_VIDEO = 'assets/videos/Prototipo/Tuto1.mp4';

/* Rutas de objetos — videos 360° para los hints de checkpoint */
const _OBJ = {
  base:         'assets/videos/Prototipo/Objetos/Box_base.mp4',
  rubor:        'assets/videos/Prototipo/Objetos/Box_rubor.mp4',
  caja:         'assets/videos/Prototipo/Objetos/Box_caja de maquillaje.mp4',
  labial:       'assets/videos/Prototipo/Objetos/Box_labial.mp4',
  pintucaritas: 'assets/videos/Prototipo/Objetos/box_pintucaritas.mp4',
  delineador:   'assets/videos/Prototipo/Objetos/box_delineador.mp4',
};

const PRESENTERS = [
  /* ── 1. Presentadora de Noticias ────────────────────────── */
  {
    id:    'p_noticias',
    label: 'Presentadora\nde Noticias',
    personaje:  'assets/images/Personajes/P_Noticias personaje.png',
    fondo:      'assets/images/Fondos/P_Noticias escenario.png',
    fondoFinal: 'assets/images/Fondos_Finales/P_Noticias Final.png',
    accentColor: '#E8C84A',
    ctaAlign: 'right',     // personaje a la izquierda → botones a la derecha
    introAudio: _VOZ + 'Intro_PM_Noticias.mp3',
    introVideo: _INTRO_VIDEO,

    /* Videos de idle en orden de aparición — 4 checkpoints, 4 videos: match exacto */
    idleVideos: [
      _IDL_P_NOT + 'Idle 1.mp4',
      _IDL_P_NOT + 'Idle 2.mp4',
      _IDL_P_NOT + 'Idle 3.mp4',
      _IDL_P_NOT + 'Idle 4.mp4',
    ],

    scenes: [
      {
        video: _VID_P_NOT + 'Escena1.mp4',
        audio: _VOZ + '1_LimpiezaPiel.mp3',
        idle: { objectVideo: _OBJ.base,   hint: 'Muestra la base de maquillaje a la cámara',
                detect: ['BaseDeMaquillaje'] }
      },
      {
        video: _VID_P_NOT + 'Escena2.mp4',
        audio: _VOZ + '2_BaseDeMaquillaje.mp3',
        idle: { objectVideo: _OBJ.rubor,  hint: 'Muestra el rubor a la cámara',
                detect: ['PolvoDeMaquillaje'] }
      },
      {
        video: _VID_P_NOT + 'Escena3.mp4',
        audio: _VOZ + '3_Rubor.mp3',
        idle: { objectVideo: _OBJ.caja,   hint: 'Muestra las sombras a la cámara',
                detect: ['Sombras'] }
      },
      {
        video: _VID_P_NOT + 'Escena4.mp4',
        audio: _VOZ + '4_Sombras.mp3',
        idle: { objectVideo: _OBJ.labial, hint: 'Muestra el labial a la cámara',
                detect: ['Labial'] }
      },
      {
        /* Última escena — dos audios encadenados: narración + cierre emocional */
        video: _VID_P_NOT + 'Escena5.mp4',
        audio: [_VOZ + '5_Labial.mp3', _VOZ + '5_1_QuedasteHermosa.mp3']
      }
    ]
  },

  /* ── 2. Presentador de Noticias ─────────────────────────── */
  {
    id:    'ph_noticias',
    label: 'Presentador\nde Noticias',
    personaje:  'assets/images/Personajes/PH_Noticias personaje.png',
    fondo:      'assets/images/Fondos/PH_Noticias Escenario.png',
    fondoFinal: 'assets/images/Fondos_Finales/PH_Noticias Final.png',
    accentColor: '#5BB8F5',
    ctaAlign: 'left',      // personaje centro-izquierda → botones a la izquierda
    introAudio: _VOZ + 'Intro_PH_Noticias.mp3',
    introVideo: _INTRO_VIDEO,

    /* 3 checkpoints, 3 videos: match exacto */
    idleVideos: [
      _IDL_H_NOT + 'PH_Noticias 1.mp4',
      _IDL_H_NOT + 'PH_Noticias 2.mp4',
      _IDL_H_NOT + 'PH_Noticias 3.mp4',
    ],

    scenes: [
      {
        /* Secuencia guion: 1ª — dos clips consecutivos */
        video: [_VID_H_NOT + 'Escena1.mp4', _VID_H_NOT + 'Escena2.mp4'],
        audio: _VOZ + '1_LimpiezaPiel.mp3',
        idle: { objectVideo: _OBJ.base,   hint: 'Muestra la base de maquillaje a la cámara',
                detect: ['BaseDeMaquillaje'] }
      },
      {
        /* Secuencia guion: 2ª — dos clips consecutivos */
        video: [_VID_H_NOT + 'Escena5.mp4', _VID_H_NOT + 'Escena4.mp4'],
        audio: _VOZ + '2_BaseDeMaquillaje.mp3',
        idle: { objectVideo: _OBJ.rubor,  hint: 'Muestra el rubor a la cámara',
                detect: ['PolvoDeMaquillaje'] }
      },
      {
        /* Secuencia guion: 3ª */
        video: _VID_H_NOT + 'Escena3.mp4',
        audio: _VOZ + '3_Rubor.mp3',
        idle: { objectVideo: _OBJ.labial, hint: 'Muestra el labial a la cámara',
                detect: ['Labial'] }
      },
      {
        /* Última escena — sin idle */
        video: _VID_H_NOT + 'Escena6.mp4',
        audio: _VOZ + '5_2_HumectanteLabios.mp3'
      }
    ]
  },

  /* ── 3. Presentadora Colombia Moda ──────────────────────── */
  {
    id:    'p_cmoda',
    label: 'Presentadora\nColombia Moda',
    personaje:  'assets/images/Personajes/P_CModa personaje.png',
    fondo:      'assets/images/Fondos/P_CModa escenario.png',
    fondoFinal: 'assets/images/Fondos_Finales/P_CModa Final.png',
    accentColor: '#F4A261',
    ctaAlign: 'left',      // personaje al centro → botones a la izquierda
    introAudio: _VOZ + 'Intro_PM_ColombiaModa.mp3',
    introVideo: _INTRO_VIDEO,

    /* 5 checkpoints, 4 videos — el 5º checkpoint reutiliza Idle 4 (último disponible) */
    idleVideos: [
      _IDL_MODA + 'Idle 1.mp4',
      _IDL_MODA + 'Idle 2.mp4',
      _IDL_MODA + 'Idle 3.mp4',
      _IDL_MODA + 'Idle 4.mp4',
    ],

    scenes: [
      {
        video: _VID_MODA + 'Escena1.mp4',
        audio: _VOZ + '1_LimpiezaPiel.mp3',
        idle: { objectVideo: _OBJ.base,   hint: 'Muestra la base de maquillaje a la cámara',
                detect: ['BaseDeMaquillaje'] }
      },
      {
        video: _VID_MODA + 'Escena2.mp4',
        audio: _VOZ + '2_BaseDeMaquillaje.mp3',
        idle: { objectVideo: _OBJ.rubor,  hint: 'Muestra el rubor a la cámara',
                detect: ['PolvoDeMaquillaje'] }
      },
      {
        video: _VID_MODA + 'Escena3.mp4',
        audio: _VOZ + '3_Rubor.mp3',
        idle: { objectVideo: _OBJ.caja,   hint: 'Muestra las sombras a la cámara',
                detect: ['Sombras'] }
      },
      {
        video: _VID_MODA + 'Escena4.mp4',
        audio: _VOZ + '4_Sombras.mp3',
        idle: { objectVideo: _OBJ.delineador, hint: 'Muestra el delineador a la cámara',
                detect: ['Delineador1', 'Delineador2'] }
      },
      {
        video: _VID_MODA + 'Escena5.mp4',
        audio: _VOZ + '6_Delineador.mp3',
        /* checkpoint 5 → idleVideos[4] no existe → fallback a idleVideos[3] = Idle 4 */
        idle: { objectVideo: _OBJ.labial, hint: 'Muestra el labial a la cámara',
                detect: ['Labial'] }
      },
      {
        /* Última escena — dos audios encadenados: narración + cierre emocional */
        video: _VID_MODA + 'Escena6.mp4',
        audio: [_VOZ + '5_Labial.mp3', _VOZ + '5_1_QuedasteHermosa.mp3']
      }
    ]
  },

  /* ── 4. Presentador de Deportes ─────────────────────────── */
  {
    id:    'ph_deportes',
    label: 'Presentador\nde Deportes',
    personaje:  'assets/images/Personajes/PH_Deportes personaje.png',
    fondo:      'assets/images/Fondos/PH_Deportes Escenario.png',
    fondoFinal: 'assets/images/Fondos_Finales/PH_Deportes Final.png',
    accentColor: '#57CC99',
    ctaAlign: 'right',     // personaje al centro → botones a la derecha
    introAudio: _VOZ + 'Intro_PH_Deportes.mp3',
    introVideo: _INTRO_VIDEO,

    /* 3 checkpoints, 3 videos: match exacto */
    idleVideos: [
      _IDL_DEP + 'Idle 1.mp4',
      _IDL_DEP + 'Idle 2.mp4',
      _IDL_DEP + 'Idle 3.mp4',
    ],

    scenes: [
      {
        video: _VID_DEP + 'Escena1.mp4',
        audio: _VOZ + '1_LimpiezaPiel.mp3',
        idle: { objectVideo: _OBJ.base,   hint: 'Muestra la base de maquillaje a la cámara',
                detect: ['BaseDeMaquillaje'] }
      },
      {
        video: _VID_DEP + 'Escena2.mp4',
        audio: _VOZ + '2_BaseDeMaquillaje.mp3',
        idle: { objectVideo: _OBJ.rubor,        hint: 'Muestra el rubor a la cámara',
                detect: ['PolvoDeMaquillaje'] }
      },
      {
        video: _VID_DEP + 'Escena3.mp4',
        audio: _VOZ + '3_1_RuborContornoDeportes.mp3',
        idle: { objectVideo: _OBJ.pintucaritas, hint: 'Muestra las pintucaritas a la cámara',
                detect: ['Pintucaritas'] }
      },
      {
        /* Última escena — sin idle */
        video: _VID_DEP + 'Escena4.mp4',
        audio: _VOZ + '7_Pintucaritas.mp3'
      }
    ]
  }
];

/**
 * Devuelve las escenas válidas de un presentador con idle.video resuelto.
 *
 * - Filtra escenas con video: null.
 * - Para cada escena con idle, asigna idle.video desde presenter.idleVideos
 *   en orden de aparición. Si hay más checkpoints que videos disponibles,
 *   los sobrantes reutilizan el último video de la lista.
 */
function getValidScenes(presenter) {
  const idleVideos = presenter.idleVideos || [];
  let checkpointIdx = 0;

  return presenter.scenes
    .filter(s => Array.isArray(s.video) ? s.video.length > 0 : s.video !== null)
    .map(scene => {
      if (!scene.idle) return scene;

      /* Resolver video del idle: usar el correspondiente o el último disponible */
      const video = idleVideos.length > 0
        ? (idleVideos[checkpointIdx] ?? idleVideos[idleVideos.length - 1])
        : null;

      checkpointIdx++;
      /* Devolver copia del scene con idle.video inyectado (no mutamos el original) */
      return { ...scene, idle: { ...scene.idle, video } };
    });
}
