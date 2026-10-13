#!/usr/bin/env bash
# Installa il collegamento di StudyBuddy nel menu applicazioni e sul desktop.
# Rilanciarlo dopo aver spostato il repository (il .desktop contiene percorsi assoluti).
set -eu

ROOT="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"

chmod +x "$ROOT/scripts/desktop/launch.sh"
mkdir -p "$APPS"
cat > "$APPS/studybuddy.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=StudyBuddy
Comment=Tutor locale per i corsi
Exec="$ROOT/scripts/desktop/launch.sh"
Icon=$ROOT/src/app/icon.svg
Terminal=false
Categories=Education;
StartupWMClass=StudyBuddy
EOF
chmod +x "$APPS/studybuddy.desktop"
echo "menu:    $APPS/studybuddy.desktop"

if [ -d "$DESKTOP_DIR" ]; then
  cp "$APPS/studybuddy.desktop" "$DESKTOP_DIR/studybuddy.desktop"
  chmod +x "$DESKTOP_DIR/studybuddy.desktop"
  echo "desktop: $DESKTOP_DIR/studybuddy.desktop"
fi
