import { listAreas } from "@/lib/areas";
import AreasManager from "@/components/settings/AreasManager";
import HealthPanel from "@/components/settings/HealthPanel";

export const dynamic = "force-dynamic";

/** Impostazioni: gestione dei domini (tabella areas) e stato dei servizi locali. */
export default function SettingsPage() {
  return (
    <div className="max-w-3xl w-full mx-auto px-4 md:px-8 py-10 flex flex-col gap-12">
      <header className="fade-up">
        <div className="text-[10px] uppercase tracking-[0.3em] text-fg-dim mb-2">Impostazioni</div>
        <h1 className="font-display text-4xl md:text-5xl tracking-tight leading-none">Domini e stato</h1>
      </header>
      <AreasManager areas={listAreas()} />
      <HealthPanel />
    </div>
  );
}
