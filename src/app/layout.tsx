import "./globals.css";

export const metadata = {
  title: "StudyBuddy v2",
  description: "Local-first RAG study companion",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
