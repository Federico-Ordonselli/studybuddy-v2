import { useEffect, useState } from "react";
import { post } from "./api";

const KEY = "studybuddy-desktop";

/**
 * Vero se la pagina è aperta dal launcher desktop, che passa `?desktop=1`.
 * Dopo la prima navigazione il parametro sparisce dall'URL: resta in sessionStorage.
 */
export function useDesktopMode(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    let on = new URLSearchParams(location.search).get("desktop") === "1";
    try {
      if (on) sessionStorage.setItem(KEY, "1");
      else on = sessionStorage.getItem(KEY) === "1";
    } catch { /* Senza storage vale solo la prima pagina. */ }
    setDesktop(on);
  }, []);
  return desktop;
}

export async function quitDesktop(): Promise<void> {
  try {
    await post("/api/desktop/quit", {});
  } finally {
    window.close(); // basta se la finestra non ha ancora navigato; altrimenti la chiude il launcher
  }
}
