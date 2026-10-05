/**
 * photo-booth.js
 * ──────────────────────────────────────────────────────────
 * Módulo de Photo Booth para el Espejo Mágico.
 *
 * Responsabilidades:
 *   1. Render loop: webcam espejada + overlay de maquillaje
 *   2. Cuenta regresiva animada (3 → 2 → 1 → ¡Listo!)
 *   3. Captura de la foto (canvas → JPEG)
 *   4. Watermark con logo Telemedellín
 *   5. Subida a Cloudinary (principal) o Firebase (alternativo)
 *   6. Generación de QR con la URL de descarga
 *   7. Descarga directa en el PC como fallback final
 *
 * API pública:
 *   initPhotoBooth()
 *   startCountdown()     → Promise<string>  (resuelve con dataURL de la foto)
 *   stopPhotoBooth()
 *   setSnapMode(bool)    → habilita captura desde el canvas de Snap Camera Kit
 * ──────────────────────────────────────────────────────────
 */

'use strict';

/* ── Referencias DOM ─────────────────────────────────────── */
let _pbCanvas      = null;   // canvas principal del photobooth
let _pbCtx         = null;
let _overlayCanvas = null;   // canvas de makeup (de face-filter.js)
let _pbWebcamEl      = null;
let _pbRafId         = null;
let _running       = false;

/* ── Estado ──────────────────────────────────────────────── */
let _logoImg       = null;   // imagen del logo precargada
let _countingDown  = false;
let _snapMode      = false;  // true cuando Snap Camera Kit está activo

/* ── Inicialización ──────────────────────────────────────── */

function initPhotoBooth() {
  _pbCanvas      = document.getElementById('photobooth-canvas');
  _overlayCanvas = document.getElementById('photobooth-makeup-canvas');
  _pbWebcamEl      = document.getElementById('webcam');

  if (!_pbCanvas) {
    console.warn('[PhotoBooth] #photobooth-canvas no encontrado');
    return;
  }
  _pbCtx = _pbCanvas.getContext('2d');

  /* Precargar el logo para el watermark */
  if (APP_CONFIG.photobooth.watermarkLogo) {
    _logoImg = new Image();
    _logoImg.src = 'assets/images/Logotipo_de_Telemedellín.png';
  }

  console.log('[PhotoBooth] Inicializado.');
}

/**
 * Arranca el render loop del photobooth (webcam + makeup).
 * Llamar cuando se entra al modo photobooth.
 */
function startPhotoBoothRender() {
  if (_running) return;
  _running = true;
  _loop();
}

/** Detiene el render loop. */
function stopPhotoBooth() {
  _running = false;
  cancelAnimationFrame(_pbRafId);
}

/**
 * Activa o desactiva el modo Snap Camera Kit.
 * En modo Snap, el render del canvas lo gestiona Camera Kit — no
 * corremos nuestro propio RAF. La captura lee directamente el _pbCanvas.
 * @param {boolean} enabled
 */
function setSnapMode(enabled) {
  _snapMode = !!enabled;
}

/* ── Render loop ─────────────────────────────────────────── */

function _loop() {
  if (!_running) return;

  const W = _pbCanvas.width  = window.innerWidth  * 0.65 | 0;
  const H = _pbCanvas.height = W * (9 / 16) | 0;

  /* 1. Dibujar webcam espejada */
  if (_pbWebcamEl && _pbWebcamEl.readyState >= 2) {
    _pbCtx.save();
    _pbCtx.translate(W, 0);
    _pbCtx.scale(-1, 1);
    _pbCtx.drawImage(_pbWebcamEl, 0, 0, W, H);
    _pbCtx.restore();
  } else {
    _pbCtx.fillStyle = '#111';
    _pbCtx.fillRect(0, 0, W, H);
  }

  /* 2. Superponer overlay de maquillaje */
  if (_overlayCanvas && _overlayCanvas.width > 0) {
    _pbCtx.globalAlpha = 1;
    _pbCtx.drawImage(_overlayCanvas, 0, 0, W, H);
  }

  _pbRafId = requestAnimationFrame(_loop);
}

/* ── Cuenta regresiva ────────────────────────────────────── */

/**
 * Inicia la cuenta regresiva y captura la foto al final.
 * @returns {Promise<string>} dataURL de la foto tomada
 */
function startCountdown() {
  if (_countingDown) return Promise.reject('already counting');
  _countingDown = true;

  return new Promise((resolve) => {
    const seconds = APP_CONFIG.photobooth.countdownSeconds;
    let count     = seconds;

    const display = document.getElementById('countdown-display');
    if (display) display.classList.remove('hidden');

    const tick = () => {
      if (count > 0) {
        if (display) {
          display.textContent = count;
          display.classList.remove('countdown-pop');
          // Forzar reflow para reiniciar animación
          void display.offsetWidth;
          display.classList.add('countdown-pop');
        }
        // Parpadeo uniforme de las bombillas al ritmo del tick
        if (typeof triggerCountdownBlink === 'function') triggerCountdownBlink();
        count--;
        setTimeout(tick, 1000);
      } else {
        /* ¡Foto! — flash de cámara en todas las bombillas */
        if (typeof triggerCameraFlash === 'function') triggerCameraFlash();
        if (display) {
          display.textContent = '¡Listo!';
          display.classList.remove('countdown-pop');
          void display.offsetWidth;
          display.classList.add('countdown-pop');
        }
        setTimeout(() => {
          const photo = _capturePhoto();
          if (display) display.classList.add('hidden');
          _countingDown = false;
          resolve(photo);
        }, 800);
      }
    };

    tick();
  });
}

/* ── Captura ─────────────────────────────────────────────── */

/**
 * Renderiza la foto final en un canvas de alta resolución y devuelve dataURL.
 * Incluye watermark del logo Telemedellín.
 */
function _capturePhoto() {
  const W = APP_CONFIG.photobooth.photoWidth;
  const H = APP_CONFIG.photobooth.photoHeight;

  const captureCanvas = document.createElement('canvas');
  captureCanvas.width  = W;
  captureCanvas.height = H;
  const ctx = captureCanvas.getContext('2d');

  /* Modo Snap Camera Kit: leer del canvas dedicado (#snap-canvas),
   * NO de #photobooth-canvas (que tiene contexto 2D y no es el target de Snap) */
  const _snapCanvasEl = document.getElementById('snap-canvas');
  if (_snapMode && _snapCanvasEl && _snapCanvasEl.width > 0) {
    ctx.drawImage(_snapCanvasEl, 0, 0, W, H);
  } else {
    /* Modo manual: webcam espejada + overlay de maquillaje */
    if (_pbWebcamEl && _pbWebcamEl.readyState >= 2) {
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(_pbWebcamEl, 0, 0, W, H);
      ctx.restore();
    } else {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, W, H);
    }

    if (_overlayCanvas && _overlayCanvas.width > 0) {
      ctx.drawImage(_overlayCanvas, 0, 0, W, H);
    }
  }

  /* 3. Marco decorativo (esquinas doradas) */
  _drawDecorativeFrame(ctx, W, H);

  /* 4. Watermark logo Telemedellín */
  if (_logoImg && _logoImg.complete && APP_CONFIG.photobooth.watermarkLogo) {
    const logoW = W * 0.18;
    const logoH = logoW * (_logoImg.naturalHeight / _logoImg.naturalWidth);
    const margin = W * 0.025;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(_logoImg, W - logoW - margin, H - logoH - margin, logoW, logoH);
    ctx.globalAlpha = 1;
  }

  /* 5. Texto de marca */
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `bold ${W * 0.015}px Quicksand, sans-serif`;
  ctx.fillText('Espejo Mágico — Tour Telemedellín', W * 0.025, H - W * 0.018);

  return captureCanvas.toDataURL('image/jpeg', APP_CONFIG.photobooth.jpegQuality);
}

/** Dibuja esquinas doradas decorativas en el frame de la foto */
function _drawDecorativeFrame(ctx, W, H) {
  const gold    = '#D4AF37';
  const size    = Math.min(W, H) * 0.06;
  const margin  = Math.min(W, H) * 0.025;
  const lw      = Math.max(2, W * 0.004);

  ctx.strokeStyle = gold;
  ctx.lineWidth   = lw;
  ctx.lineCap     = 'round';

  const corners = [
    [margin, margin,           1, 1 ],
    [W - margin, margin,      -1, 1 ],
    [margin, H - margin,       1, -1],
    [W - margin, H - margin,  -1, -1]
  ];

  corners.forEach(([cx, cy, dx, dy]) => {
    ctx.beginPath();
    ctx.moveTo(cx + dx * size, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * size);
    ctx.stroke();
  });
}

/* ── Subida a Cloudinary ──────────────────────────────────── */

/**
 * Sube la foto a Cloudinary (upload preset unsigned) y devuelve la URL pública.
 * No requiere backend — el preset unsigned permite subir directamente.
 * @param {string} dataURL
 * @returns {Promise<string>} URL HTTPS de la imagen en Cloudinary
 */
async function uploadToCloudinary(dataURL) {
  const cfg = APP_CONFIG.cloudinary;
  if (!cfg.enabled) throw new Error('Cloudinary no configurado');

  const blob     = _dataURLtoBlob(dataURL);
  const form     = new FormData();
  form.append('file',          blob, 'espejo-magico.jpg');
  form.append('upload_preset', cfg.uploadPreset);
  form.append('folder',        'espejo-magico');

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`,
    { method: 'POST', body: form }
  );

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Cloudinary ${res.status}: ${msg}`);
  }

  const data = await res.json();
  console.log('[PhotoBooth] Subida a Cloudinary:', data.secure_url);
  return data.secure_url;
}

/* ── Subida a Firebase (alternativo) ─────────────────────── */

/**
 * Sube la foto a Firebase Storage y devuelve la URL pública.
 * @param {string} dataURL
 * @returns {Promise<string>} URL de descarga
 */
async function uploadToFirebase(dataURL) {
  if (!APP_CONFIG.firebase.enabled) {
    throw new Error('Firebase no configurado');
  }

  const blob     = _dataURLtoBlob(dataURL);
  const filename = `espejo-magico-${Date.now()}.jpg`;
  const ref      = firebase.storage().ref(`fotos/${filename}`);

  await ref.put(blob, { contentType: 'image/jpeg' });
  const url = await ref.getDownloadURL();
  console.log('[PhotoBooth] Subida a Firebase:', url);
  return url;
}

/* ── Generación de QR ────────────────────────────────────── */

/**
 * Genera un código QR en el elemento indicado.
 * @param {string} containerId  - ID del elemento contenedor
 * @param {string} url          - URL que codifica el QR
 */
function generateQRCode(containerId, url) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';  // limpiar QR anterior

  if (typeof QRCode === 'undefined') {
    console.warn('[PhotoBooth] qrcode.js no cargado');
    container.textContent = url;
    return;
  }

  new QRCode(container, {
    text:          url,
    width:         220,
    height:        220,
    colorDark:     '#000000',
    colorLight:    '#ffffff',
    correctLevel:  QRCode.CorrectLevel.M
  });

  console.log('[PhotoBooth] QR generado para:', url.slice(0, 60) + '…');
}

/**
 * Flujo completo de subida y generación de QR.
 * Prioridad: Cloudinary → Firebase → fallback local.
 *
 * • Cloudinary/Firebase producen URLs públicas → el QR funciona en cualquier red.
 * • El fallback local genera una URL de LAN → solo funciona en la WiFi del museo.
 *
 * @param {string} dataURL - foto capturada
 * @param {string} qrContainerId
 * @returns {Promise<void>}
 */
async function processAndShowQR(dataURL, qrContainerId) {
  try {
    if (APP_CONFIG.cloudinary.enabled) {
      /* ── Cloudinary (recomendado) ── */
      const url = await uploadToCloudinary(dataURL);
      // La URL de Cloudinary es pública y funciona desde cualquier dispositivo
      generateQRCode(qrContainerId, url);
      return;
    }

    if (APP_CONFIG.firebase.enabled && typeof firebase !== 'undefined') {
      /* ── Firebase (alternativo) ── */
      const url = await uploadToFirebase(dataURL);
      generateQRCode(qrContainerId, url);
      return;
    }

    /* ── Sin servicio cloud: QR de red local ── */
    _fallbackLocalQR(dataURL, qrContainerId);

  } catch (err) {
    console.warn('[PhotoBooth] Fallo en upload, usando fallback local:', err);
    _fallbackLocalQR(dataURL, qrContainerId);
  }
}

/**
 * Fallback: guarda la foto en memoria y genera QR con URL local.
 * Usa APP_CONFIG.photobooth.kioskUrl si está configurado (IP de LAN),
 * si no, usa window.location.origin (funciona solo si el celular del
 * visitante está en la misma WiFi que el kiosco).
 */
function _fallbackLocalQR(dataURL, qrContainerId) {
  const id = 'photo_' + Date.now();
  window._photoStore = window._photoStore || {};
  window._photoStore[id] = dataURL;

  const base = (APP_CONFIG.photobooth.kioskUrl || window.location.origin).replace(/\/$/, '');
  const url  = `${base}/photo.html?id=${id}`;

  generateQRCode(qrContainerId, url);

  /* Descarga automática en el PC del museo como respaldo */
  _triggerDownload(dataURL, `espejo-magico-${id}.jpg`);

  console.log('[PhotoBooth] QR local:', url);
  if (!APP_CONFIG.photobooth.kioskUrl) {
    console.info('[PhotoBooth] TIP: configura APP_CONFIG.photobooth.kioskUrl',
      'con la IP LAN del museo (ej. "http://192.168.1.50:5173") para que',
      'el QR funcione desde el celular del visitante.');
  }
}

/** Dispara la descarga del archivo en el PC */
function _triggerDownload(dataURL, filename) {
  const a = document.createElement('a');
  a.href     = dataURL;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/* ── Helpers ─────────────────────────────────────────────── */

function _dataURLtoBlob(dataURL) {
  const [header, data] = dataURL.split(',');
  const mime  = header.match(/:(.*?);/)[1];
  const bytes = atob(data);
  const arr   = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
