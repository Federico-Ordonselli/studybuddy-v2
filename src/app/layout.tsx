import "@fontsource-variable/fraunces";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import "@/components/mappe/studio.css";
import Link from "next/link";

export const metadata = {
  title: "StudyBuddy",
  description: "Local-first RAG study companion",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>
        <div className="h-dvh flex flex-col">
          <header className="h-12 shrink-0 border-b border-border px-4 md:px-8 flex items-center justify-between">
            <Link href="/" className="font-display text-xl tracking-tight">StudyBuddy</Link>
            <Link href="/add" className="text-[11px] uppercase tracking-[0.25em] text-fg-dim hover:text-fg transition-colors">
              + Aggiungi corso
            </Link>
          </header>
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">{children}</div>
        </div>
      </body>
    </html>
  );
}
