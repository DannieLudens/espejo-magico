'use strict';

/**
 * config.example.js
 * Copia este archivo como config.js y rellena tus credenciales.
 * NUNCA subas config.js al repositorio (está en .gitignore).
 */
const APP_CONFIG = {

  cloudinary: {
    enabled:      true,
    cloudName:    "TU_CLOUD_NAME",
    uploadPreset: "TU_UPLOAD_PRESET"
  },

  imgbb: {
    enabled: false,
    apiKey:  "TU_IMGBB_API_KEY"
  },

  firebase: {
    enabled: false,
    apiKey:            "TU_API_KEY",
    authDomain:        "TU_PROJECT.firebaseapp.com",
    projectId:         "TU_PROJECT_ID",
    storageBucket:     "TU_PROJECT.appspot.com",
    messagingSenderId: "TU_SENDER_ID",
    appId:             "TU_APP_ID"
  },

  snap: {
    enabled:      true,
    apiToken:     "TU_SNAP_API_TOKEN",   // my.developer.snap.com → Camera Kit → API Token
    lensGroupId:  "TU_LENS_GROUP_ID",   // UUID del grupo de lentes
    lensIds: {
      p_noticias:  "LENS_ID_1",
      ph_noticias: "LENS_ID_2",
      p_cmoda:     "LENS_ID_3",
      ph_deportes: "LENS_ID_4"
    }
  },

  photobooth: {
    countdownSeconds: 3,
    photoWidth:       1280,
    photoHeight:      720,
    jpegQuality:      0.92,
    watermarkLogo:    true,
    qrDisplayMs:      90000,
    kioskUrl:         ""
  }

};
