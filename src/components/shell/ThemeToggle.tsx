"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "studybuddy-theme-v1";

export default function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const sync = () => setDark(document.documentElement.dataset.theme === "dark");
    sync();
    const media = matchMedia("(prefers-color-scheme: dark)");
    const followSystem = () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem(STORAGE_KEY); } catch {}
      if (saved !== "dark" && saved !== "light") {
        document.documentElement.dataset.theme = media.matches ? "dark" : "light";
        sync();
      }
    };
    media.addEventListener("change", followSystem);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      document.documentElement.dataset.theme = event.newValue === "dark" || event.newValue === "light" ? event.newValue : media.matches ? "dark" : "light";
      sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("studybuddy-theme-change", sync);
    return () => {
      media.removeEventListener("change", followSystem);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("studybuddy-theme-change", sync);
    };
  }, []);

  function toggle() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setDark(next === "dark");
    window.dispatchEvent(new Event("studybuddy-theme-change"));
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Il tema funziona anche senza storage. */ }
  }

  return (
    <button type="button" className="theme-toggle menu-item" onClick={toggle}
      aria-label="Tema scuro" aria-pressed={dark} title={dark ? "Passa al tema chiaro" : "Passa al tema scuro"}>
      <span aria-hidden="true" className="theme-icon">{dark ? "☼" : "☾"}</span>
      {!collapsed && <span>{dark ? "Tema chiaro" : "Tema scuro"}</span>}
    </button>
  );
}
