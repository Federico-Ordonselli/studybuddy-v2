import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pacchetti nativi / non-bundlabili: tenuti esterni al bundle del server.
  // (sqlite nativo + onnxruntime di Transformers.js per il reranker cross-encoder)
  serverExternalPackages: ["better-sqlite3", "sqlite-vec", "@huggingface/transformers", "onnxruntime-node"],
};

export default nextConfig;
