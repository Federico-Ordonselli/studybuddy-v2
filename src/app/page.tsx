import Link from "next/link";

/** Home dell'hub (contenuto nel Task 6). */
export default function HomePage() {
  return (
    <div className="max-w-3xl w-full mx-auto px-4 md:px-8 py-10">
      <h1 className="font-display text-4xl">Home</h1>
      <Link href="/corsi" className="text-accent underline">Vai ai corsi</Link>
    </div>
  );
}
