"""
transcribe.py
Genera archivos .vtt con subtítulos sincronizados para todos los audios
de EspejoMágico usando el modelo Whisper de OpenAI.

Uso:
    python tools/transcribe.py

Requisitos:
    pip install openai-whisper
    ffmpeg instalado y en PATH

El script:
  - Busca todos los .mp3 en assets/Audios_Definitivos/VozEnOff/
  - Transcribe cada uno con el modelo 'small' en español
  - Guarda el .vtt en assets/captions/ con el mismo nombre base
  - Omite archivos que ya tienen .vtt (re-corre sin problema)
"""

import os
import glob
import whisper

# ── Configuración ────────────────────────────────────────────────
MODEL_SIZE  = "small"          # tiny | base | small | medium | large
LANGUAGE    = "es"             # español
AUDIO_DIR   = os.path.join(os.path.dirname(__file__), "..", "assets", "Audios_Definitivos", "VozEnOff")
OUTPUT_DIR  = os.path.join(os.path.dirname(__file__), "..", "assets", "captions")

# ── Helpers ──────────────────────────────────────────────────────
def seconds_to_vtt(s: float) -> str:
    """Convierte segundos a formato HH:MM:SS.mmm de WebVTT."""
    h   = int(s // 3600)
    m   = int((s % 3600) // 60)
    sec = s % 60
    return f"{h:02d}:{m:02d}:{sec:06.3f}"

def save_vtt(segments, out_path: str):
    """Escribe un archivo .vtt a partir de los segmentos de Whisper."""
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("WEBVTT\n\n")
        for i, seg in enumerate(segments, 1):
            start = seconds_to_vtt(seg["start"])
            end   = seconds_to_vtt(seg["end"])
            text  = seg["text"].strip()
            f.write(f"{i}\n{start} --> {end}\n{text}\n\n")

# ── Main ─────────────────────────────────────────────────────────
def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    mp3_files = sorted(glob.glob(os.path.join(AUDIO_DIR, "*.mp3")))
    if not mp3_files:
        print(f"[!] No se encontraron MP3 en: {AUDIO_DIR}")
        return

    print(f"[Whisper] Cargando modelo '{MODEL_SIZE}'...")
    model = whisper.load_model(MODEL_SIZE)
    print(f"[Whisper] Modelo listo. Procesando {len(mp3_files)} archivos...\n")

    for mp3 in mp3_files:
        name     = os.path.splitext(os.path.basename(mp3))[0]
        out_path = os.path.join(OUTPUT_DIR, name + ".vtt")

        if os.path.exists(out_path):
            print(f"  [OK] {name}.vtt ya existe — omitido")
            continue

        print(f"  [->] Transcribiendo {name}.mp3...", end=" ", flush=True)
        result = model.transcribe(mp3, language=LANGUAGE, task="transcribe")
        save_vtt(result["segments"], out_path)
        print(f"✓  ({len(result['segments'])} cues)")

    print(f"\n[OK] Listo - VTTs guardados en: {OUTPUT_DIR}")

if __name__ == "__main__":
    main()
