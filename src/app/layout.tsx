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

// La shell legge il DB a ogni richiesta (badge, domini): niente prerender statico, anche per / e not-found.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // I dati della shell si rileggono a ogni richiesta e a ogni router.refresh(), NON a ogni navigazione client
  // (il layout condiviso non viene rifetchato): chi cambia carte o note deve chiamare router.refresh().
  return (
    <html lang="it" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var t;try{t=localStorage.getItem("studybuddy-theme-v1")}catch{}document.documentElement.dataset.theme=t==="dark"||t==="light"?t:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"})();` }} />
      </head>
      <body>
        <Shell data={getShellData()}>{children}</Shell>
      </body>
    </html>
  );
}
