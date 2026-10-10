"use client";

import Link from "next/link";
import ThemeToggle from "./ThemeToggle";
import type { ShellData } from "@/lib/home";
import { MODULES } from "@/lib/modules";

function Badge({ n }: { n: number }) {
  return n > 0 ? <span className="ml-auto text-[10px] tabular bg-surface-2 border border-border rounded-full px-1.5 text-fg-muted">{n}</span> : null;
}

function Item({ href, symbol, label, active, collapsed, badge }: {
  href: string; symbol: string; label: string; active: boolean; collapsed: boolean; badge?: number;
}) {
  return (
    <Link href={href} title={collapsed ? label : undefined} aria-current={active ? "page" : undefined}
      className={`menu-item group flex items-center gap-3 px-3 py-2 text-sm transition-colors ${active
        ? "bg-surface-2 text-fg" : "text-fg-muted hover:text-fg hover:bg-surface-2"}`}>
      <span className={`menu-symbol w-5 text-center text-base leading-none ${active ? "text-accent" : "text-fg-dim group-hover:text-fg-muted"}`}>{symbol}</span>
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && badge !== undefined && <Badge n={badge} />}
    </Link>
  );
}

function Section({ label, collapsed, children }: { label: string; collapsed: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      {!collapsed && <div className="menu-section-label">{label}</div>}
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

/** Sidebar dell'hub: Home, Corsi, i domini (tabella areas), Impostazioni, Appunto. */
export default function Sidebar({ data, pathname, collapsed, onToggle, onCapture }: {
  data: ShellData; pathname: string; collapsed: boolean; onToggle?: () => void; onCapture: () => void;
}) {
  const on = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  const moduleOn = (m: string | null) => !!m && Object.hasOwn(MODULES, m) && on(MODULES[m].href);
  return (
    <aside className={`menu-sidebar h-full shrink-0 flex flex-col ${collapsed ? "menu-collapsed w-16" : "w-60"}`}>
      <div className={`menu-brand flex items-center ${collapsed ? "justify-center py-4" : "justify-between px-5 pt-6 pb-4"}`}>
        {!collapsed && <Link href="/" className="font-display text-2xl tracking-tight leading-none">StudyBuddy</Link>}
        {onToggle && (
          <button type="button" onClick={onToggle} className="text-fg-dim hover:text-fg px-1"
            aria-label={collapsed ? "Espandi la barra laterale" : "Comprimi la barra laterale"}>{collapsed ? "»" : "«"}</button>
        )}
      </div>
      <nav className={`flex-1 overflow-y-auto py-4 ${collapsed ? "px-1.5" : "px-3"}`} aria-label="Navigazione">
        <Section label="Generale" collapsed={collapsed}>
          <Item href="/" symbol="⌂" label="Home" active={pathname === "/"} collapsed={collapsed} />
          <Item href="/corsi" symbol="▤" label="Corsi" active={on("/corsi") || on("/study")} collapsed={collapsed} badge={data.dueTotal} />
        </Section>
        <Section label="Domini" collapsed={collapsed}>
          {data.areas.map((a) => (
            <Item key={a.slug} href={`/d/${a.slug}`} symbol={a.symbol} label={a.name} active={on(`/d/${a.slug}`) || moduleOn(a.module)} collapsed={collapsed} />
          ))}
          {!data.areas.length && !collapsed && (
            <Link href="/settings" className="block px-3 py-1 text-xs text-fg-dim hover:text-fg">+ crea un dominio</Link>
          )}
        </Section>
        <Section label="Sistema" collapsed={collapsed}>
          <Item href="/settings" symbol="◐" label="Impostazioni" active={on("/settings")} collapsed={collapsed} />
          <button type="button" onClick={onCapture} title={collapsed ? "Appunto (n)" : undefined}
            className="menu-item group flex items-center gap-3 px-3 py-2 text-sm text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors">
            <span className="menu-symbol w-5 text-center text-base leading-none text-fg-dim group-hover:text-fg-muted">✎</span>
            {!collapsed && <><span className="flex-1 text-left">Appunto</span><kbd className="text-[10px] font-mono text-fg-dim">n</kbd><Badge n={data.inboxCount} /></>}
          </button>
        </Section>
      </nav>
      <div className="menu-footer"><ThemeToggle collapsed={collapsed} /></div>
    </aside>
  );
}
