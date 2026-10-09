"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CAPTURE_EVENT } from "@/lib/client/captureTarget";
import type { ShellData } from "@/lib/home";
import QuickCapture from "@/components/notes/QuickCapture";
import Sidebar from "./Sidebar";

/** True se il tasto va a un campo di testo: lì `n` è una lettera, non una scorciatoia. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/**
 * Shell dell'hub: sidebar (compressa a icone su /study/*, espandibile), drawer sotto
 * `md`, quick capture da voce di menu, tasto `n` o evento CAPTURE_EVENT.
 */
export default function Shell({ data, children }: { data: ShellData; children: React.ReactNode }) {
  const pathname = usePathname();
  const study = pathname.startsWith("/study/");
  const [expanded, setExpanded] = useState<boolean | null>(null); // null = default della pagina
  const [drawer, setDrawer] = useState(false);
  const [capture, setCapture] = useState(false);
  const collapsed = expanded === null ? study : !expanded;

  useEffect(() => { setDrawer(false); setExpanded(null); }, [study]);
  useEffect(() => { setDrawer(false); }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      setCapture(true);
    };
    const onOpen = () => setCapture(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(CAPTURE_EVENT, onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener(CAPTURE_EVENT, onOpen); };
  }, []);

  const openCapture = () => { setDrawer(false); setCapture(true); };

  return (
    <div className="h-dvh flex">
      <div className="hidden md:flex">
        <Sidebar data={data} pathname={pathname} collapsed={collapsed} onToggle={() => setExpanded(collapsed)} onCapture={openCapture} />
      </div>
      {drawer && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setDrawer(false)}>
          <div className="h-full w-60" onClick={(e) => e.stopPropagation()}>
            <Sidebar data={data} pathname={pathname} collapsed={false} onCapture={openCapture} />
          </div>
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="md:hidden h-12 shrink-0 border-b border-border px-4 flex items-center gap-3">
          <button type="button" onClick={() => setDrawer(true)} aria-label="Apri il menu" className="text-lg text-fg-muted hover:text-fg">☰</button>
          <Link href="/" className="font-display text-xl tracking-tight">StudyBuddy</Link>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">{children}</div>
      </div>
      {capture && <QuickCapture data={data} pathname={pathname} onClose={() => setCapture(false)} />}
    </div>
  );
}
