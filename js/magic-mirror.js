/**
 * magic-mirror.js — WebGL2 Full-GPU Edition
 * ──────────────────────────────────────────────────────────────────
 * Arquitectura:
 *
 *  MODO GPU  (requiere EXT_color_buffer_float, siempre en escritorio)
 *    • Wave step shader: simulación completa en GPU (ping-pong FBOs)
 *      ola 160×120 → ≈19 K fragmentos/frame (~microsegundos en RTX)
 *    • Display shader:  displacement + tinte desde wave FBO + webcam
 *    • CPU solo calcula: coordenadas del dedo → uniform vec2
 *
 *  MODO HYBRID (WebGL2 disponible pero sin EXT_color_buffer_float)
 *    • CPU wave step (Float32Array, ~0.1 ms)
 *    • GPU display shader con wave como R32F texture
 *
 *  MODO CANVAS2D (sin WebGL2)
 *    • Fallback completo idéntico al original
 *
 * API pública:
 *   startMagicMirror(webcamEl)
 *   stopMagicMirror()
 */

'use strict';

/* ── Dimensiones ────────────────────────────────────────────────── */
const MM_WORK_W = 640;
const MM_WORK_H = 480;
const MM_SIM_W  = 160;
const MM_SIM_H  = 120;

/* ── Parámetros ajustables ─────────────────────────────────────── */
let _mmDamping = 0.950;
let _mmSplashR = 3;
let _mmSplashF = 150;
let _mmDisp    = 0.5;
let _mmTint    = 0.10;

const MM_DEFAULTS = { damping: 0.950, splashR: 3, splashF: 150, disp: 0.5, tint: 0.10 };

/* ── Estado global ─────────────────────────────────────────────── */
let _mmActive        = false;
let _mmRafId         = null;
let _mmWebcam        = null;
let _mmCanvas        = null;
let _mmActivateTimer = null;
let _mmMode          = 'none';   // 'gpu' | 'hybrid' | 'canvas2d'

/* Posición del dedo en espacio sim (−1 = sin mano) */
let _mmFX = -1;
let _mmFY = -1;

/* Posición anterior para detectar movimiento real (evita spam de olas) */
let _mmPrevFX = -1;
let _mmPrevFY = -1;
const MM_SPLASH_THRESHOLD = 1.5;   // mínimo de píxeles sim para crear ola

/* ── Recursos WebGL compartidos ────────────────────────────────── */
let _gl    = null;
let _vao   = null;
let _camTex = null;
let _camLoaded = false;   // evita texImage2D tras primer frame

/* ─────────────────────────────────────────────────────────────────
   MODO GPU — ping-pong de 3 texturas R32F + 3 FBOs
   ───────────────────────────────────────────────────────────────── */
let _wTex  = null;   // Float32Array(3) de texturas R32F
let _wFb   = null;   // Float32Array(3) de framebuffers
let _wCurr = 0;
let _wPrev = 1;
let _wNext = 2;

let _waveProg    = null;
let _wuCurr      = null;
let _wuPrev      = null;
let _wuDamping   = null;
let _wuSplashUV  = null;
let _wuSplashF   = null;
let _wuSplashR   = null;
let _wuHasSplash = null;

let _dispProg = null;
let _duCamera = null;
let _duWave   = null;
let _duDisp   = null;
let _duTint   = null;

/* ─────────────────────────────────────────────────────────────────
   MODO HYBRID — CPU wave + GPU display
   ───────────────────────────────────────────────────────────────── */
let _mmBufA    = null;
let _mmBufB    = null;
let _hybProg   = null;
let _waveTex   = null;   // R32F upload target
let _huCamera  = null;
let _huWave    = null;
let _huDisp    = null;
let _huTint    = null;

/* ══════════════════════════════════════════════════════════════════
   SHADERS
   ══════════════════════════════════════════════════════════════════ */

/* Vértice compartido — quad NDC, aPos en location 0 */
const _VERT = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/* ──────────────────────────────────────────────────────────────────
   Wave-step shader
   Lee uCurr y uPrev (R32F desde FBOs), aplica ecuación de ola
   discreta, escribe siguiente estado.
   Inyecta splash si uHasSplash > 0.5.
   Fuerza 0 en bordes (absorción).
   ────────────────────────────────────────────────────────────────── */
const _FRAG_WAVE = `#version 300 es
precision highp float;

uniform sampler2D uCurr;
uniform sampler2D uPrev;
uniform float     uDamping;
uniform vec2      uSplashUV;
uniform float     uSplashF;
uniform float     uSplashR;
uniform float     uHasSplash;

in  vec2 vUV;
out vec4 fragColor;

void main() {
  const float W  = ${MM_SIM_W}.0;
  const float H  = ${MM_SIM_H}.0;
  const float tW = 1.0 / W;
  const float tH = 1.0 / H;

  /* Absorbing borders — bordes a cero (equivale al loop y=1..H-2) */
  vec2 px = vUV * vec2(W, H);
  if (px.x < 1.0 || px.x > W - 1.0 || px.y < 1.0 || px.y > H - 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float curr = texture(uCurr, vUV).r;
  float prev = texture(uPrev, vUV).r;
  float r    = texture(uCurr, vUV + vec2( tW, 0.0)).r;
  float l    = texture(uCurr, vUV - vec2( tW, 0.0)).r;
  float d    = texture(uCurr, vUV + vec2(0.0,  tH)).r;
  float u    = texture(uCurr, vUV - vec2(0.0,  tH)).r;

  float next = (r + l + d + u) * 0.5 - prev;
  next *= uDamping;

  /* Splash (radio en texels) */
  if (uHasSplash > 0.5) {
    vec2 delta = (vUV - uSplashUV) * vec2(W, H);
    if (dot(delta, delta) <= uSplashR * uSplashR) {
      next += uSplashF;
    }
  }

  fragColor = vec4(next, 0.0, 0.0, 1.0);
}`;

/* ──────────────────────────────────────────────────────────────────
   Display shader (GPU wave mode)
   Wave viene de FBO → orientación GL (Y=0 abajo) → sin flip de ola.
   Cámara viene de texImage2D(video) → row0 al GL Y=0 → sí flip.
   ────────────────────────────────────────────────────────────────── */
const _FRAG_DISP = `#version 300 es
precision highp float;

uniform sampler2D uCamera;
uniform sampler2D uWave;
uniform float     uDisp;
uniform float     uTint;

in  vec2 vUV;
out vec4 fragColor;

void main() {
  const float tW = 1.0 / ${MM_SIM_W}.0;
  const float tH = 1.0 / ${MM_SIM_H}.0;

  /* Wave del FBO ya en orientación GL — sin flip */
  float hR = texture(uWave, vUV + vec2( tW, 0.0)).r;
  float hL = texture(uWave, vUV - vec2( tW, 0.0)).r;
  float hD = texture(uWave, vUV + vec2(0.0,  tH)).r;
  float hU = texture(uWave, vUV - vec2(0.0,  tH)).r;

  float dx = (hR - hL) * uDisp;
  float dy = (hD - hU) * uDisp;

  /* Cámara: flip Y (texImage2D(video) invierte vertical) */
  float fy = 1.0 - vUV.y;
  vec2 camUV = vec2(1.0 - vUV.x + dx / 640.0,
                    fy           + dy / 480.0);
  camUV = clamp(camUV, 0.0, 1.0);
  vec4 color = texture(uCamera, camUV);

  if (uTint > 0.0) {
    float mag = abs(dx) + abs(dy);
    if (mag > 1.5) {
      float t = min(uTint, (mag - 1.5) / 20.0 * uTint);
      color.rgb = mix(color.rgb, vec3(0.706, 0.784, 0.902), t);
    }
  }
  fragColor = color;
}`;

/* ──────────────────────────────────────────────────────────────────
   Display shader (Hybrid mode — wave viene de texSubImage2D / CPU)
   CPU array: row0 = tope del grid → almacenado en GL Y=0 → flip ola.
   Cámara: mismo flip.
   ────────────────────────────────────────────────────────────────── */
const _FRAG_HYBRID = `#version 300 es
precision highp float;

uniform sampler2D uCamera;
uniform sampler2D uWave;
uniform float     uDisp;
uniform float     uTint;

in  vec2 vUV;
out vec4 fragColor;

void main() {
  const float tW = 1.0 / ${MM_SIM_W}.0;
  const float tH = 1.0 / ${MM_SIM_H}.0;

  /* Wave subida desde CPU → flip Y */
  float fy   = 1.0 - vUV.y;
  vec2  wUV  = vec2(vUV.x, fy);
  float hR = texture(uWave, wUV + vec2( tW, 0.0)).r;
  float hL = texture(uWave, wUV - vec2( tW, 0.0)).r;
  float hD = texture(uWave, wUV + vec2(0.0,  tH)).r;
  float hU = texture(uWave, wUV - vec2(0.0,  tH)).r;

  float dx = (hR - hL) * uDisp;
  float dy = (hD - hU) * uDisp;

  vec2 camUV = vec2(1.0 - vUV.x + dx / 640.0,
                    fy           + dy / 480.0);
  camUV = clamp(camUV, 0.0, 1.0);
  vec4 color = texture(uCamera, camUV);

  if (uTint > 0.0) {
    float mag = abs(dx) + abs(dy);
    if (mag > 1.5) {
      float t = min(uTint, (mag - 1.5) / 20.0 * uTint);
      color.rgb = mix(color.rgb, vec3(0.706, 0.784, 0.902), t);
    }
  }
  fragColor = color;
}`;

/* ══════════════════════════════════════════════════════════════════
   API PÚBLICA
   ══════════════════════════════════════════════════════════════════ */

function startMagicMirror(webcamEl) {
  if (_mmActive) stopMagicMirror();
  _mmActive  = true;
  _mmWebcam  = webcamEl;
  _camLoaded = false;

  _mmCanvas        = document.getElementById('mirror-canvas');
  _mmCanvas.width  = MM_WORK_W;
  _mmCanvas.height = MM_WORK_H;

  _gl = _mmCanvas.getContext('webgl2', {
    alpha: false, antialias: false, powerPreference: 'high-performance'
  });

  if (!_gl) {
    console.warn('[MagicMirror] WebGL2 no disponible — Canvas2D fallback.');
    _startCanvas2D(webcamEl);
    return;
  }

  const extFloat = _gl.getExtension('OES_texture_float_linear');
  const extFB    = _gl.getExtension('EXT_color_buffer_float');

  if (extFB) {
    _startGPU();
  } else {
    console.warn('[MagicMirror] EXT_color_buffer_float no disponible — modo Hybrid.');
    _startHybrid();
  }

  document.addEventListener('handMove', _mmHandMove);
  document.addEventListener('handLost', _mmHandLost);
}

function stopMagicMirror() {
  _mmActive = false;
  if (_mmRafId)         { cancelAnimationFrame(_mmRafId); _mmRafId = null; }
  if (_mmActivateTimer) { clearTimeout(_mmActivateTimer); _mmActivateTimer = null; }
  document.removeEventListener('handMove', _mmHandMove);
  document.removeEventListener('handLost', _mmHandLost);
  _mmFX = _mmFY = -1;
  _mmWebcam = null;

  _c2dStop();
  _gpuStop();
  _hybridStop();

  if (_gl) { _gl = null; }
  _mmMode = 'none';
  console.log('[MagicMirror] Detenido.');
}

/* ══════════════════════════════════════════════════════════════════
   MODO GPU — inicialización
   ══════════════════════════════════════════════════════════════════ */

function _startGPU() {
  const g = _gl;

  /* VAO compartido para el quad NDC */
  _vao = g.createVertexArray();
  g.bindVertexArray(_vao);
  const vbuf = g.createBuffer();
  g.bindBuffer(g.ARRAY_BUFFER, vbuf);
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), g.STATIC_DRAW);
  g.enableVertexAttribArray(0);
  g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
  g.bindVertexArray(null);

  /* Programas */
  _waveProg = _mmCompile(g, _VERT, _FRAG_WAVE);
  _dispProg = _mmCompile(g, _VERT, _FRAG_DISP);
  if (!_waveProg || !_dispProg) {
    console.error('[MagicMirror] Error compilando shaders GPU — hybrid fallback.');
    _gpuStop();
    _startHybrid();
    return;
  }

  /* Wave uniforms */
  g.useProgram(_waveProg);
  _wuCurr      = g.getUniformLocation(_waveProg, 'uCurr');
  _wuPrev      = g.getUniformLocation(_waveProg, 'uPrev');
  _wuDamping   = g.getUniformLocation(_waveProg, 'uDamping');
  _wuSplashUV  = g.getUniformLocation(_waveProg, 'uSplashUV');
  _wuSplashF   = g.getUniformLocation(_waveProg, 'uSplashF');
  _wuSplashR   = g.getUniformLocation(_waveProg, 'uSplashR');
  _wuHasSplash = g.getUniformLocation(_waveProg, 'uHasSplash');
  g.uniform1i(_wuCurr, 0);
  g.uniform1i(_wuPrev, 1);

  /* Display uniforms */
  g.useProgram(_dispProg);
  _duCamera = g.getUniformLocation(_dispProg, 'uCamera');
  _duWave   = g.getUniformLocation(_dispProg, 'uWave');
  _duDisp   = g.getUniformLocation(_dispProg, 'uDisp');
  _duTint   = g.getUniformLocation(_dispProg, 'uTint');
  g.uniform1i(_duCamera, 0);
  g.uniform1i(_duWave,   1);

  /* 3 texturas R32F para ping-pong de ola */
  _wTex = [
    _mmMakeTex(g, null, g.R32F, g.RED, g.FLOAT, MM_SIM_W, MM_SIM_H),
    _mmMakeTex(g, null, g.R32F, g.RED, g.FLOAT, MM_SIM_W, MM_SIM_H),
    _mmMakeTex(g, null, g.R32F, g.RED, g.FLOAT, MM_SIM_W, MM_SIM_H),
  ];

  /* 3 FBOs, uno por textura */
  _wFb = [g.createFramebuffer(), g.createFramebuffer(), g.createFramebuffer()];
  for (let i = 0; i < 3; i++) {
    g.bindFramebuffer(g.FRAMEBUFFER, _wFb[i]);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, _wTex[i], 0);
    const status = g.checkFramebufferStatus(g.FRAMEBUFFER);
    if (status !== g.FRAMEBUFFER_COMPLETE) {
      console.error('[MagicMirror] FBO', i, 'incompleto:', status, '— hybrid fallback.');
      g.bindFramebuffer(g.FRAMEBUFFER, null);
      _gpuStop();
      _startHybrid();
      return;
    }
  }
  g.bindFramebuffer(g.FRAMEBUFFER, null);

  /* Textura de cámara RGBA */
  _camTex = _mmMakeTex(g, null, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, MM_WORK_W, MM_WORK_H);

  _wCurr = 0; _wPrev = 1; _wNext = 2;
  _mmMode = 'gpu';
  _mmRafId = requestAnimationFrame(_gpuFrame);
  console.log('[MagicMirror] Iniciado: MODO GPU (ping-pong wave en RTX).');
}

/* ── Frame GPU ─────────────────────────────────────────────────── */

function _gpuFrame() {
  if (!_mmActive || _mmMode !== 'gpu') return;
  const g = _gl;

  g.bindVertexArray(_vao);

  /* ── 1. Subir frame de cámara ── */
  if (_mmWebcam && _mmWebcam.readyState >= 2) {
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, _camTex);
    if (!_camLoaded) {
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, _mmWebcam);
      _camLoaded = true;
    } else {
      g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, g.RGBA, g.UNSIGNED_BYTE, _mmWebcam);
    }
  }

  /* ── 2. Wave step pass (SIM_W × SIM_H viewport) ── */
  g.bindFramebuffer(g.FRAMEBUFFER, _wFb[_wNext]);
  g.viewport(0, 0, MM_SIM_W, MM_SIM_H);
  g.useProgram(_waveProg);

  g.activeTexture(g.TEXTURE0);
  g.bindTexture(g.TEXTURE_2D, _wTex[_wCurr]);
  g.activeTexture(g.TEXTURE1);
  g.bindTexture(g.TEXTURE_2D, _wTex[_wPrev]);

  g.uniform1f(_wuDamping, _mmDamping);

  if (_mmFX >= 0 && _mmFY >= 0) {
    /* Solo hacer splash si el dedo se movió lo suficiente —
     * evita inundar la simulación cuando la mano está quieta */
    const dx = _mmFX - _mmPrevFX;
    const dy = _mmFY - _mmPrevFY;
    const moved = _mmPrevFX < 0 ||
                  dx * dx + dy * dy >= MM_SPLASH_THRESHOLD * MM_SPLASH_THRESHOLD;
    if (moved) {
      const su = _mmFX / MM_SIM_W;
      const sv = 1.0 - _mmFY / MM_SIM_H;
      g.uniform2f(_wuSplashUV, su, sv);
      g.uniform1f(_wuSplashF,  _mmSplashF);
      g.uniform1f(_wuSplashR,  _mmSplashR);
      g.uniform1f(_wuHasSplash, 1.0);
      _mmPrevFX = _mmFX;
      _mmPrevFY = _mmFY;
    } else {
      g.uniform1f(_wuHasSplash, 0.0);
    }
  } else {
    g.uniform1f(_wuHasSplash, 0.0);
  }

  g.drawArrays(g.TRIANGLE_STRIP, 0, 4);

  /* ── 3. Display pass (WORK_W × WORK_H viewport) ── */
  g.bindFramebuffer(g.FRAMEBUFFER, null);
  g.viewport(0, 0, MM_WORK_W, MM_WORK_H);
  g.useProgram(_dispProg);

  g.activeTexture(g.TEXTURE0);
  g.bindTexture(g.TEXTURE_2D, _camTex);
  g.activeTexture(g.TEXTURE1);
  g.bindTexture(g.TEXTURE_2D, _wTex[_wNext]);

  g.uniform1f(_duDisp, _mmDisp);
  g.uniform1f(_duTint, _mmTint);
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4);

  /* ── 4. Ping-pong ── */
  const tmp = _wPrev; _wPrev = _wCurr; _wCurr = _wNext; _wNext = tmp;

  _mmRafId = requestAnimationFrame(_gpuFrame);
}

function _gpuStop() {
  if (!_gl) return;
  const g = _gl;
  if (_waveProg) { g.deleteProgram(_waveProg); _waveProg = null; }
  if (_dispProg) { g.deleteProgram(_dispProg); _dispProg = null; }
  if (_camTex)   { g.deleteTexture(_camTex);   _camTex   = null; }
  if (_vao)      { g.deleteVertexArray(_vao);  _vao      = null; }
  if (_wTex)  { _wTex.forEach(t => g.deleteTexture(t));      _wTex = null; }
  if (_wFb)   { _wFb.forEach(f  => g.deleteFramebuffer(f));  _wFb  = null; }
}

/* ══════════════════════════════════════════════════════════════════
   MODO HYBRID — inicialización
   ══════════════════════════════════════════════════════════════════ */

function _startHybrid() {
  const g = _gl;

  if (!_vao) {
    _vao = g.createVertexArray();
    g.bindVertexArray(_vao);
    const vbuf = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, vbuf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), g.STATIC_DRAW);
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    g.bindVertexArray(null);
  }

  _hybProg = _mmCompile(g, _VERT, _FRAG_HYBRID);
  if (!_hybProg) {
    console.error('[MagicMirror] Error compilando shader Hybrid — Canvas2D fallback.');
    _hybridStop();
    _startCanvas2D(_mmWebcam);
    return;
  }

  g.useProgram(_hybProg);
  _huCamera = g.getUniformLocation(_hybProg, 'uCamera');
  _huWave   = g.getUniformLocation(_hybProg, 'uWave');
  _huDisp   = g.getUniformLocation(_hybProg, 'uDisp');
  _huTint   = g.getUniformLocation(_hybProg, 'uTint');
  g.uniform1i(_huCamera, 0);
  g.uniform1i(_huWave,   1);

  _camTex  = _mmMakeTex(g, null, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, MM_WORK_W, MM_WORK_H);
  _waveTex = _mmMakeTex(g, null, g.R32F, g.RED,  g.FLOAT,         MM_SIM_W,  MM_SIM_H);

  _mmBufA = new Float32Array(MM_SIM_W * MM_SIM_H);
  _mmBufB = new Float32Array(MM_SIM_W * MM_SIM_H);

  _mmMode  = 'hybrid';
  _mmRafId = requestAnimationFrame(_hybridFrame);
  console.log('[MagicMirror] Iniciado: MODO HYBRID (CPU wave + GPU display).');
}

/* ── Frame Hybrid ──────────────────────────────────────────────── */

function _hybridFrame() {
  if (!_mmActive || _mmMode !== 'hybrid') return;
  const g = _gl;

  /* 1. Splash + step CPU */
  if (_mmFX >= 0 && _mmFY >= 0) {
    const dx = _mmFX - _mmPrevFX;
    const dy = _mmFY - _mmPrevFY;
    const moved = _mmPrevFX < 0 ||
                  dx * dx + dy * dy >= MM_SPLASH_THRESHOLD * MM_SPLASH_THRESHOLD;
    if (moved) {
      const sx = Math.min(MM_SIM_W - 2, Math.max(1, _mmFX | 0));
      const sy = Math.min(MM_SIM_H - 2, Math.max(1, _mmFY | 0));
      _mmSplash(sx, sy, _mmSplashF, _mmSplashR);
      _mmPrevFX = _mmFX;
      _mmPrevFY = _mmFY;
    }
  }
  _mmStep();

  /* 2. Subir ola y cámara a GPU */
  g.bindVertexArray(_vao);

  g.activeTexture(g.TEXTURE1);
  g.bindTexture(g.TEXTURE_2D, _waveTex);
  g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, MM_SIM_W, MM_SIM_H, g.RED, g.FLOAT, _mmBufA);

  if (_mmWebcam && _mmWebcam.readyState >= 2) {
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, _camTex);
    if (!_camLoaded) {
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, _mmWebcam);
      _camLoaded = true;
    } else {
      g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, g.RGBA, g.UNSIGNED_BYTE, _mmWebcam);
    }
  }

  /* 3. Display pass */
  g.viewport(0, 0, MM_WORK_W, MM_WORK_H);
  g.useProgram(_hybProg);
  g.uniform1f(_huDisp, _mmDisp);
  g.uniform1f(_huTint, _mmTint);
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4);

  _mmRafId = requestAnimationFrame(_hybridFrame);
}

function _hybridStop() {
  if (!_gl) return;
  const g = _gl;
  if (_hybProg) { g.deleteProgram(_hybProg); _hybProg = null; }
  if (_camTex)  { g.deleteTexture(_camTex);  _camTex  = null; }
  if (_waveTex) { g.deleteTexture(_waveTex); _waveTex = null; }
  if (_vao)     { g.deleteVertexArray(_vao); _vao     = null; }
  _mmBufA = _mmBufB = null;
}

/* ══════════════════════════════════════════════════════════════════
   SIMULACIÓN DE OLAS (CPU — solo Hybrid mode)
   ══════════════════════════════════════════════════════════════════ */

function _mmSplash(cx, cy, force, radius) {
  const r2 = radius * radius;
  const x0 = Math.max(1, cx - radius);
  const x1 = Math.min(MM_SIM_W - 2, cx + radius);
  const y0 = Math.max(1, cy - radius);
  const y1 = Math.min(MM_SIM_H - 2, cy + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) _mmBufA[y * MM_SIM_W + x] += force;
    }
  }
}

function _mmStep() {
  for (let y = 1; y < MM_SIM_H - 1; y++) {
    for (let x = 1; x < MM_SIM_W - 1; x++) {
      const i = y * MM_SIM_W + x;
      const v = (
        _mmBufA[(y - 1) * MM_SIM_W + x] +
        _mmBufA[(y + 1) * MM_SIM_W + x] +
        _mmBufA[y * MM_SIM_W + (x - 1)] +
        _mmBufA[y * MM_SIM_W + (x + 1)]
      ) * 0.5 - _mmBufB[i];
      _mmBufB[i] = v * _mmDamping;
    }
  }
  const tmp = _mmBufA; _mmBufA = _mmBufB; _mmBufB = tmp;
}

/* ══════════════════════════════════════════════════════════════════
   HANDLERS DE MANO
   ══════════════════════════════════════════════════════════════════ */

function _mmHandMove(e) {
  if (!_mmActive || !_mmCanvas) return;
  const rect = _mmCanvas.getBoundingClientRect();
  _mmFX = ((e.detail.x - rect.left)  / rect.width)  * MM_SIM_W;
  _mmFY = ((e.detail.y - rect.top)   / rect.height) * MM_SIM_H;

  if (_mmActivateTimer === null) {
    _mmActivateTimer = setTimeout(() => {
      _mmActivateTimer = null;
      document.dispatchEvent(new CustomEvent('mirrorActivated'));
    }, 10000);
  }
}

function _mmHandLost() {
  _mmFX = _mmFY = -1;
  _mmPrevFX = _mmPrevFY = -1;
  if (_mmActivateTimer !== null) {
    clearTimeout(_mmActivateTimer);
    _mmActivateTimer = null;
  }
}

/* ══════════════════════════════════════════════════════════════════
   HELPERS WEBGL
   ══════════════════════════════════════════════════════════════════ */

function _mmCompile(gl, vsSrc, fsSrc) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[MagicMirror] Shader compile error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  };
  const vs = sh(gl.VERTEX_SHADER,   vsSrc);
  const fs = sh(gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('[MagicMirror] Link error:', gl.getProgramInfoLog(p));
    gl.deleteProgram(p);
    return null;
  }
  return p;
}

function _mmMakeTex(gl, data, internalFmt, fmt, type, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFmt, w, h, 0, fmt, type, data);
  return tex;
}

/* ══════════════════════════════════════════════════════════════════
   FALLBACK CANVAS2D
   ══════════════════════════════════════════════════════════════════ */

let _c2dCtx    = null;
let _c2dTmpCnv = null;
let _c2dTmpCtx = null;
let _c2dOut    = null;
let _c2dSrc    = null;

function _startCanvas2D(webcamEl) {
  _mmCanvas.width  = MM_WORK_W;
  _mmCanvas.height = MM_WORK_H;
  _c2dCtx = _mmCanvas.getContext('2d', { willReadFrequently: true });

  _c2dTmpCnv        = document.createElement('canvas');
  _c2dTmpCnv.width  = MM_WORK_W;
  _c2dTmpCnv.height = MM_WORK_H;
  _c2dTmpCtx = _c2dTmpCnv.getContext('2d', { willReadFrequently: true });

  _c2dOut = new ImageData(MM_WORK_W, MM_WORK_H);
  _mmBufA = new Float32Array(MM_SIM_W * MM_SIM_H);
  _mmBufB = new Float32Array(MM_SIM_W * MM_SIM_H);

  _mmMode  = 'canvas2d';
  _mmRafId = requestAnimationFrame(_c2dFrame);
  console.log('[MagicMirror] Iniciado: MODO Canvas2D (fallback).');
}

function _c2dStop() {
  _c2dCtx = _c2dTmpCtx = _c2dTmpCnv = _c2dOut = _c2dSrc = null;
}

function _c2dFrame() {
  if (!_mmActive || !_c2dCtx) return;

  if (_mmFX >= 0 && _mmFY >= 0) {
    const dx = _mmFX - _mmPrevFX;
    const dy = _mmFY - _mmPrevFY;
    const moved = _mmPrevFX < 0 ||
                  dx * dx + dy * dy >= MM_SPLASH_THRESHOLD * MM_SPLASH_THRESHOLD;
    if (moved) {
      const sx = Math.min(MM_SIM_W - 2, Math.max(1, _mmFX | 0));
      const sy = Math.min(MM_SIM_H - 2, Math.max(1, _mmFY | 0));
      _mmSplash(sx, sy, _mmSplashF, _mmSplashR);
      _mmPrevFX = _mmFX;
      _mmPrevFY = _mmFY;
    }
  }
  _mmStep();

  if (_mmWebcam && _mmWebcam.readyState >= 2) {
    _c2dTmpCtx.save();
    _c2dTmpCtx.translate(MM_WORK_W, 0);
    _c2dTmpCtx.scale(-1, 1);
    _c2dTmpCtx.drawImage(_mmWebcam, 0, 0, MM_WORK_W, MM_WORK_H);
    _c2dTmpCtx.restore();
    _c2dSrc = _c2dTmpCtx.getImageData(0, 0, MM_WORK_W, MM_WORK_H);
  }

  if (_c2dSrc) {
    _c2dApplyDisp();
    _c2dCtx.putImageData(_c2dOut, 0, 0);
  } else {
    _c2dCtx.fillStyle = '#0a0a0a';
    _c2dCtx.fillRect(0, 0, MM_WORK_W, MM_WORK_H);
  }

  _mmRafId = requestAnimationFrame(_c2dFrame);
}

function _c2dSampleH(fx, fy) {
  const x0 = Math.max(0, Math.min(MM_SIM_W - 2, fx | 0));
  const y0 = Math.max(0, Math.min(MM_SIM_H - 2, fy | 0));
  const tx = fx - x0, ty = fy - y0;
  const w  = MM_SIM_W;
  return (
    _mmBufA[y0 * w + x0]         * (1 - tx) * (1 - ty) +
    _mmBufA[y0 * w + x0 + 1]     *  tx      * (1 - ty) +
    _mmBufA[(y0 + 1) * w + x0]   * (1 - tx) *  ty      +
    _mmBufA[(y0 + 1) * w + x0 + 1] * tx     *  ty
  );
}

function _c2dApplyDisp() {
  const src = _c2dSrc.data, out = _c2dOut.data;
  const W = MM_WORK_W, H = MM_WORK_H;
  const scX = MM_SIM_W / W, scY = MM_SIM_H / H;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (_c2dSampleH((x + 1) * scX, y * scY) - _c2dSampleH((x - 1) * scX, y * scY)) * _mmDisp;
      const dy = (_c2dSampleH(x * scX, (y + 1) * scY) - _c2dSampleH(x * scX, (y - 1) * scY)) * _mmDisp;
      const nx = Math.min(W - 1, Math.max(0, (x + dx) | 0));
      const ny = Math.min(H - 1, Math.max(0, (y + dy) | 0));
      const si = (ny * W + nx) * 4, di = (y * W + x) * 4;
      out[di]     = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = 255;
      if (_mmTint > 0) {
        const mag = Math.abs(dx) + Math.abs(dy);
        if (mag > 1.5) {
          const t = Math.min(_mmTint, (mag - 1.5) / 20 * _mmTint);
          out[di]     = (out[di]     + (180 - out[di])     * t) | 0;
          out[di + 1] = (out[di + 1] + (200 - out[di + 1]) * t) | 0;
          out[di + 2] = (out[di + 2] + (230 - out[di + 2]) * t) | 0;
        }
      }
    }
  }
}
