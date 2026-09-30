#!/bin/bash
#
# Instala PuertosView como LaunchAgent: arranca solo al iniciar sesión y queda
# siempre disponible en http://localhost:7788.
#
#   ./scripts/install-daemon.sh            instala (o reinstala) y arranca
#   ./scripts/install-daemon.sh --uninstall  descarga el agente y borra el plist
#
set -euo pipefail

LABEL="pe.jsoluciones.puertosview"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/PuertosView"
DOMAIN="gui/$(id -u)"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✔ PuertosView desinstalado del arranque. Los logs siguen en $LOG_DIR"
  exit 0
fi

# launchd no hereda el PATH del shell: hay que darle la ruta absoluta de node.
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "✖ No encuentro node en el PATH. Instálalo o ajusta NODE_BIN a mano." >&2
  exit 1
fi
NODE_DIR="$(dirname "$NODE_BIN")"

echo "▸ Repo:  $REPO"
echo "▸ Node:  $NODE_BIN"

# El servidor sirve web/dist si existe; sin build solo respondería la API.
echo "▸ Compilando el dashboard..."
(cd "$REPO" && npm run build >/dev/null)

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$REPO/node_modules/tsx/dist/cli.mjs</string>
    <string>$REPO/server/src/index.ts</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$REPO</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>StandardOutPath</key>
  <string>$LOG_DIR/puertosview.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/puertosview.error.log</string>

  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
PLIST_EOF

# bootout + bootstrap es el equivalente moderno de load -w; el || true cubre el
# primer arranque, cuando todavía no hay nada que descargar.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/$LABEL"

# tsx transpila el servidor en el primer arranque; en frío puede tardar ~15s.
echo "▸ Esperando a que levante..."
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:7788/api/state 2>/dev/null; then
    echo
    echo "✔ PuertosView corriendo en http://localhost:7788"
    echo "  Logs:       $LOG_DIR/puertosview.log"
    echo "  Reiniciar:  launchctl kickstart -k $DOMAIN/$LABEL"
    echo "  Quitar:     ./scripts/install-daemon.sh --uninstall"
    exit 0
  fi
  sleep 0.4
done

echo "✖ No respondió en 30s. Revisa $LOG_DIR/puertosview.error.log" >&2
echo "  Estado del agente: launchctl print $DOMAIN/$LABEL" >&2
exit 1
