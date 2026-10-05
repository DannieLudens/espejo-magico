'use strict';
const fs = require('fs');
const path = require('path');

const config = `'use strict';
const APP_CONFIG = {

  cloudinary: {
    enabled:      true,
    cloudName:    "${process.env.CLOUDINARY_CLOUD_NAME || ''}",
    uploadPreset: "${process.env.CLOUDINARY_UPLOAD_PRESET || ''}"
  },

  imgbb: {
    enabled: false,
    apiKey:  ""
  },

  firebase: {
    enabled: false
  },

  snap: {
    enabled:     true,
    apiToken:    "${process.env.SNAP_API_TOKEN || ''}",
    lensGroupId: "${process.env.SNAP_LENS_GROUP_ID || ''}",
    lensIds: {
      p_noticias:  "${process.env.SNAP_LENS_ID_P_NOTICIAS || ''}",
      ph_noticias: "${process.env.SNAP_LENS_ID_PH_NOTICIAS || ''}",
      p_cmoda:     "${process.env.SNAP_LENS_ID_P_CMODA || ''}",
      ph_deportes: "${process.env.SNAP_LENS_ID_PH_DEPORTES || ''}"
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
`;

const outPath = path.join(__dirname, '..', 'js', 'config.js');
fs.writeFileSync(outPath, config, 'utf8');
console.log('config.js generado desde variables de entorno.');
