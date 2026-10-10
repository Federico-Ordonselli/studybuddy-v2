Leggi CLAUDE.md prima di qualsiasi modifica: contiene architettura, vincoli e note tecniche vincolanti.

- Lavora su un branch dedicato, mai su main.
- Scrivi i commit in italiano e usa `git add` con file espliciti, mai `git add .` o `git add -A`.
- Non toccare i DB reali (`data/*.db` e `*.db` alla root): i test usano DB temporanei tramite `tests/helpers/db.ts`.
- Non usare `npm run db:push`.
- Niente push.
- Prima di dire "fatto", `npm run typecheck` e `npm test` devono essere verdi.
- L'app è generica: niente codice o prompt adattati a un corso specifico; i corsi in `Courses/` non si committano.
