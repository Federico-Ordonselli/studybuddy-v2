#!/usr/bin/env bash
# Esegue un comando con le librerie CUDA 12 di onnxruntime-node (reranker su GPU).
# onnxruntime-node è compilato per CUDA 12: se il sistema ha un'altra versione,
# le lib arrivano dai pacchetti pip nvidia-*-cu12 nella .venv del progetto.
# LD_LIBRARY_PATH va impostata prima dell'avvio di Node (dlopen la legge allo start).
# Senza la .venv il comando parte lo stesso e il reranker ripiega sulla CPU.
set -euo pipefail
cd "$(dirname "$0")/.."
libs=$(ls -d .venv/lib/python*/site-packages/nvidia/*/lib 2>/dev/null | sed "s|^|$PWD/|" | paste -sd: -)
[[ -n "$libs" ]] && export LD_LIBRARY_PATH="$libs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$@"
