#!/usr/bin/env bash
# Apre StudyBuddy in una finestra a sé (Chrome/Chromium in modalità --app, profilo dedicato).
# Se il server non risponde avvia il container Docker e, quando la finestra si chiude
# (X oppure «Chiudi» nella sidebar), lo ferma di nuovo. Un server già acceso (Docker o
# `npm run dev`) resta acceso. Installazione del collegamento: scripts/desktop/install.sh.
set -u

ROOT="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)"
cd "$ROOT" || exit 1

PORT="$(sed -n 's/^STUDYBUDDY_PORT=//p' .env 2>/dev/null | tail -n 1)"
URL="http://localhost:${PORT:-3000}"
QUIT="$ROOT/data/.desktop-quit"   # scritto da POST /api/desktop/quit (lib/desktop.ts)
PROFILE="${XDG_DATA_HOME:-$HOME/.local/share}/studybuddy/browser"
LOCK="${XDG_RUNTIME_DIR:-/tmp}/studybuddy-desktop.lock"

say() {
  echo "StudyBuddy: $1" >&2
  command -v notify-send >/dev/null && notify-send -a StudyBuddy -i "$ROOT/src/app/icon.svg" StudyBuddy "$1"
}

BROWSER=""
for b in chromium google-chrome-stable google-chrome brave; do
  if command -v "$b" >/dev/null; then BROWSER="$b"; break; fi
done
[ -n "$BROWSER" ] || { say "serve Chromium o Google Chrome per la finestra dell'app"; exit 1; }

window() {
  # exec: con `window &` il PID in $! è il browser, non una subshell che lo lancia.
  # 9>&- : il browser non deve ereditare il lock.
  exec "$BROWSER" --user-data-dir="$PROFILE" --app="$URL/?desktop=1" --class=StudyBuddy \
    --no-first-run --no-default-browser-check 9>&-
}

# Già aperta: il browser passa la richiesta all'istanza esistente (nuova finestra) ed esce.
exec 9>"$LOCK"
if ! flock -n 9; then window; fi

up() { curl -s -o /dev/null -m 2 "$URL/icon.svg"; }

started=0
if ! up; then
  say "avvio del server…"
  docker compose up -d >&2 || { say "docker compose up non è riuscito"; exit 1; }
  started=1
  for _ in $(seq 120); do up && break; sleep 0.5; done
  up || { say "il server non risponde su $URL"; docker compose stop >&2; exit 1; }
fi

mkdir -p "$(dirname "$QUIT")"
rm -f "$QUIT"
window &
pid=$!
while kill -0 "$pid" 2>/dev/null; do
  if [ -e "$QUIT" ]; then kill "$pid"; wait "$pid"; break; fi
  sleep 1
done
rm -f "$QUIT"

[ "$started" = 1 ] && docker compose stop >&2
exit 0
