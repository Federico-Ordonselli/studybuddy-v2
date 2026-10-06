#!/usr/bin/env bash
# Avvio/arresto di StudyBuddy v2 dal launcher (.desktop) o da terminale.
#   studybuddy.sh start | stop | restart | status | open
#
# I launcher grafici non caricano il profilo shell: aggiungiamo a mano il path
# stabile di node gestito da fnm (l'alias `default`, non quello effimero per-shell).
set -uo pipefail

APP_DIR="/home/federico/progetti/StudyBuddyV2"
RUN_DIR="$APP_DIR/.run"
PIDFILE="$RUN_DIR/dev.pid"
LOG="$RUN_DIR/dev.log"
NODE_BIN="$HOME/.local/share/fnm/aliases/default/bin"

export PATH="$NODE_BIN:$PATH"
mkdir -p "$RUN_DIR"
cd "$APP_DIR" || exit 1

notify() { command -v notify-send >/dev/null 2>&1 && notify-send -a "StudyBuddy" "StudyBuddy v2" "$1" 2>/dev/null; echo "[studybuddy] $1"; }

# URL effettivo (Next può cambiare porta se la 3000 è occupata): si legge dal log.
app_url() { grep -oE 'http://localhost:[0-9]+' "$LOG" 2>/dev/null | head -1; }

is_running() {
  [[ -f "$PIDFILE" ]] || return 1
  kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

open_browser() {
  local url; url="$(app_url)"; url="${url:-http://localhost:3000}"
  command -v xdg-open >/dev/null 2>&1 && xdg-open "$url" >/dev/null 2>&1 &
}

start() {
  if is_running; then notify "Già attivo — apro il browser"; open_browser; return 0; fi
  if ! command -v npm >/dev/null 2>&1; then notify "node/npm non trovati ($NODE_BIN)"; return 1; fi
  curl -sf http://localhost:11434/api/tags >/dev/null 2>&1 || notify "Attenzione: Ollama non risponde su :11434 (avvialo per usare il tutor)"

  : > "$LOG"
  # setsid → nuova sessione: l'intero gruppo (npm→next→next-server) è killabile in blocco.
  setsid npm run dev >"$LOG" 2>&1 < /dev/null &
  echo $! > "$PIDFILE"

  # attende che Next stampi l'URL (ready)
  for _ in $(seq 1 90); do
    [[ -n "$(app_url)" ]] && break
    is_running || { notify "Avvio fallito — vedi $LOG"; return 1; }
    sleep 0.5
  done
  notify "Avviato su $(app_url)"
  open_browser
}

stop() {
  if is_running; then
    local pid; pid="$(cat "$PIDFILE")"
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
    sleep 1
    kill -KILL -- "-$pid" 2>/dev/null || true
    rm -f "$PIDFILE"
    notify "Fermato"
  else
    pkill -f "next dev" 2>/dev/null && notify "Fermato (fallback)" || notify "Non era attivo"
    rm -f "$PIDFILE"
  fi
}

case "${1:-start}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; sleep 1; start ;;
  open)    is_running && open_browser || start ;;
  status)  if is_running; then echo "attivo (pid $(cat "$PIDFILE")) su $(app_url)"; else echo "fermo"; fi ;;
  *)       echo "uso: $0 {start|stop|restart|open|status}"; exit 2 ;;
esac
