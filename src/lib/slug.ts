/** Slug dei domini (`areas.slug`): minuscole ASCII, cifre, trattini singoli. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Dal nome allo slug: toglie gli accenti, tutto ciò che non è [a-z0-9] diventa un trattino. */
export function slugify(name: string): string {
  const s = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return s || "dominio";
}

/** `base`, oppure `base-2`, `base-3`… il primo libero. */
export function uniqueSlug(base: string, taken: Set<string>): string {
  let s = base;
  for (let i = 2; taken.has(s); i++) s = `${base}-${i}`;
  return s;
}
