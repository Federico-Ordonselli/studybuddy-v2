#!/usr/bin/env bash
# Esegue un comando con le librerie CUDA 12 nella .venv (Whisper, via ctranslate2).
# onnxruntime-node 1.30 usa CUDA 13: le sue lib sono quelle di sistema (o quelle
# dell'immagine Docker). Le lib CUDA 12 dei pacchetti pip nvidia-*-cu12 servono
# solo a ctranslate2/faster-whisper. Lo script è anche l'entrypoint del container.
# LD_LIBRARY_PATH va impostata prima dell'avvio di Node (dlopen la legge allo start).
# Senza la .venv il comando parte lo stesso.
set -euo pipefail
cd "$(dirname "$0")/.."
libs=$(ls -d .venv/lib/python*/site-packages/nvidia/*/lib 2>/dev/null | sed "s|^|$PWD/|" | paste -sd: -)
[[ -n "$libs" ]] && export LD_LIBRARY_PATH="$libs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$@"
