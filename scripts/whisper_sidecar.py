#!/usr/bin/env python3
"""Sidecar faster-whisper: trascrive un video e stampa SRT su stdout.

Uso:  whisper_sidecar.py <video> <model> [language]
Env:  WHISPER_DEVICE (auto|cuda|cpu), WHISPER_COMPUTE (auto|float16|int8|...)

faster-whisper usa CTranslate2 (CPU o CUDA): sulla 4080 va in GPU con `auto`.
"""
import os
import sys


def fmt(t: float) -> str:
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")


def main() -> int:
    if len(sys.argv) < 3:
        sys.stderr.write("uso: whisper_sidecar.py <video> <model> [language]\n")
        return 2
    video, model_size = sys.argv[1], sys.argv[2]
    language = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.stderr.write("faster_whisper non installato (pip install faster-whisper)\n")
        return 3

    device = os.environ.get("WHISPER_DEVICE", "auto")
    compute = os.environ.get("WHISPER_COMPUTE", "auto")

    def transcribe(dev, comp):
        model = WhisperModel(model_size, device=dev, compute_type=comp)
        segments, _info = model.transcribe(video, language=language, vad_filter=True)
        return list(segments)  # forza l'iterazione: errori GPU (cuBLAS/cuDNN) emergono qui

    try:
        segs = transcribe(device, compute)
    except Exception as e:  # GPU non utilizzabile (cuBLAS/cuDNN) → CPU
        sys.stderr.write(f"[whisper] device={device} non utilizzabile ({e}); fallback CPU/int8\n")
        segs = transcribe("cpu", "int8")

    for i, seg in enumerate(segs, 1):
        text = seg.text.strip()
        if not text:
            continue
        print(i)
        print(f"{fmt(seg.start)} --> {fmt(seg.end)}")
        print(text)
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
