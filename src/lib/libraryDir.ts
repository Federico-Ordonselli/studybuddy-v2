import path from "node:path";

/**
 * Cartella-libreria: qui si copiano a mano i corsi scaricati, l'app li rileva e li
 * importa. Default `Courses/` nella root del progetto (gitignored), override con
 * STUDYBUDDY_LIBRARY_DIR. Deve stare dentro la sandbox di lib/fsRoot.ts.
 */
export const LIBRARY_DIR = path.resolve(
  /* turbopackIgnore: true */ process.cwd(),
  process.env.STUDYBUDDY_LIBRARY_DIR ?? "Courses"
);
