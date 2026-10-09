import "@fontsource-variable/fraunces";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import "@/components/mappe/studio.css";
import { getShellData } from "@/lib/home";
import Shell from "@/components/shell/Shell";

export const metadata = {
  title: "StudyBuddy",
  description: "Local-first RAG study companion",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // dati letti a ogni richiesta (le pagine sono dinamiche): router.refresh() aggiorna anche i badge
  return (
    <html lang="it">
      <body>
        <Shell data={getShellData()}>{children}</Shell>
      </body>
    </html>
  );
}
