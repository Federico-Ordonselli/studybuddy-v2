# syntax=docker/dockerfile:1
# StudyBuddy con GPU. CUDA 13 + cuDNN 9 dell'immagine per onnxruntime-node 1.30
# (reranker, nel processo Node). CUDA 12 + cuDNN 9 per ctranslate2 (Whisper) arrivano
# da pip nella .venv e le vede solo il sottoprocesso Python: src/lib/transcribe.ts le
# mette nel suo LD_LIBRARY_PATH (stesso soname libcudnn.so.9: non vanno mescolate).
FROM node:24.16.0-bookworm-slim AS node

FROM nvidia/cuda:13.0.2-cudnn-runtime-ubuntu24.04 AS base
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- dipendenze Node (moduli nativi: toolchain solo qui) ----
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- build Next ----
# Le devDependencies restano: `next start` carica next.config.ts, e tsx serve alla
# CLI `npm run ingest` dentro il container. Il peso è trascurabile accanto a CUDA.
FROM deps AS build
COPY . .
RUN npm run build

# ---- venv Python: Whisper su GPU + yt-dlp ----
# av pinnato a 17.1.0 (quello dell'ambiente locale): con av 19 faster-whisper 1.2.1 fallisce
# in decode_audio (metadata_errors) e il sidecar ripiega in silenzio su CPU.
FROM base AS venv
RUN python3 -m venv /app/.venv \
 && /app/.venv/bin/pip install --no-cache-dir \
      faster-whisper==1.2.1 ctranslate2==4.8.0 "av==17.1.0" \
      "nvidia-cublas-cu12>=12,<13" "nvidia-cudnn-cu12>=9,<10" \
      yt-dlp

# ---- runtime ----
FROM base AS runner
ENV NODE_ENV=production \
    HOME=/tmp \
    HOST=127.0.0.1 \
    PORT=3000 \
    DB_PATH=/app/data/studybuddy.db \
    STUDYBUDDY_MODELS_DIR=/app/data/models \
    HF_HOME=/app/data/models/hf
COPY --from=venv /app/.venv ./.venv
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json /app/next.config.ts /app/tsconfig.json ./
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
RUN mkdir -p /app/data && chown -R 1000:1000 /app/.next /app/data
USER 1000:1000
EXPOSE 3000
CMD ["sh", "-c", "exec node_modules/.bin/next start -H \"$HOST\" -p \"$PORT\""]
