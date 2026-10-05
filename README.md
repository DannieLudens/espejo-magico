# Espejo Mágico — Kiosco Interactivo Museográfico

**Telemedellín Tour · UPB · 2025**

Instalación interactiva de realidad aumentada para el Tour Telemedellín de la Universidad Pontificia Bolivariana. Los visitantes interactúan con un espejo mágico que detecta su mano y les permite explorar a los presentadores del canal en diferentes escenas noticiosas.

---

## Demo & Documentación

- 🎨 **Figma**: Documentación completa — UI Kit, wireframes, user flow, manuales  
  https://www.figma.com/design/xgHbfKmBAMk3Ly4CiJZl27

---

## Stack Tecnológico

| Tecnología | Uso |
|-----------|-----|
| **WebGL2** | Simulación GPU de water ripple (ping-pong framebuffers, R32F textures) |
| **MediaPipe Hands** | Detección de mano en tiempo real (landmark 8 = punta del índice) |
| **Snap Camera Kit** | Filtros AR de presentadores (lentes Snapchat) |
| **Cloudinary** | Subida y alojamiento de fotos del photobooth |
| **Vanilla JS** | Máquina de estados, lógica de la experiencia |
| **HTML5 Canvas / CSS** | UI del kiosco, countdown dwell-click |

---

## Arquitectura

```
AppState Machine
│
├── STANDBY      → logo animado, espera detección de mano
├── TUTORIAL     → video instrucción gesto pinza
├── MENU         → cards de presentadores, dwell-click 1.5s
├── INTRO        → imagen + audio del presentador seleccionado
├── EXPERIENCE   → video de escenas + dots navegables
├── OUTRO        → video de cierre
├── FINAL        → CTA hacia photobooth o timeout
├── PHOTOBOOTH   → filtro AR de Snap + cuenta regresiva 3s
├── PHOTO_RESULT → foto capturada + QR Cloudinary
└── MIRROR       → water ripple WebGL2, 10s countdown
```

### Water Ripple — GPU (WebGL2)

Simulación de ondas de agua 100% en GPU mediante ping-pong de 3 framebuffers R32F:
- **Wave step shader**: ecuación de onda discreta `(r+l+d+u)*0.5 - prev) * damping`
- **Display shader**: deforma la textura de la cámara en tiempo real
- **Threshold de splash**: solo inyecta onda cuando el dedo se mueve ≥ 1.5 px simulados

---

## Estructura de Archivos

```
EspejoMagico_Web/
├── index.html
├── js/
│   ├── app.js           # Máquina de estados principal
│   ├── magic-mirror.js  # Water ripple WebGL2 + cámara
│   ├── snap-bridge.js   # Integración Snap Camera Kit
│   ├── photobooth.js    # Captura + subida Cloudinary
│   └── config.js        # Credenciales de servicios externos
├── css/
├── assets/
│   ├── videos/          # Escenas por presentador
│   ├── audios/          # Diálogos por presentador
│   └── images/
└── snap-kit/            # Bundle de Snap Camera Kit (npm)
```

---

## Instalación y Ejecución

El proyecto requiere servirse desde `localhost:5173` (requerimiento de Snap Camera Kit).

```bash
# Opción A — Python
python -m http.server 5173

# Opción B — VS Code Live Server
# Configurar: "liveServer.settings.port": 5173, "liveServer.settings.host": "localhost"
```

Abrir en el navegador: `http://localhost:5173`

### Atajos del operador

| Tecla | Acción |
|-------|--------|
| `N` | Ir al Menú de presentadores |
| `M` | Ir al Espejo Mágico |
| `ESC` | Volver al estado anterior |
| `D` | Toggle landmarks MediaPipe |

---

## Servicios Externos

Configurar en [`js/config.js`](js/config.js):

- **Cloudinary** — subida de fotos del photobooth (gratis, sin tarjeta)
- **Snap Camera Kit** — token de la app en `my.developer.snap.com`

---

## Autor

**Daniel Ardila** · daniel.ardilaa@upb.edu.co  
Taller 7 | Entretenimiento Digital | Tour Telemedellín · UPB 2025
