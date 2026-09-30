#!/bin/bash
#
# Instala Capitanía como LaunchAgent: arranca solo al iniciar sesión y queda
# siempre disponible en http://localhost:7788.
#
#   ./scripts/install-daemon.sh              instala (o reinstala) y arranca
#   ./scripts/install-daemon.sh --restart    reinicia (apaga los proyectos que lanzó)
#   ./scripts/install-daemon.sh --logs       sigue el log en vivo
#   ./scripts/install-daemon.sh --uninstall  descarga el agente y borra el plist
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$REPO/scripts/config.sh"
LABEL="$BUNDLE_ID"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

case "${1:-}" in
  --uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "✔ $APP_NAME desinstalado del arranque. Los logs siguen en $LOG_DIR"
    exit 0
    ;;
  --restart)
    launchctl kickstart -k "$DOMAIN/$LABEL"
    echo "✔ $APP_NAME reiniciado"
    exit 0
    ;;
  --logs)
    exec tail -f "$LOG_FILE"
    ;;
esac

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
    <key>CAPITANIA_PORT</key>
    <string>$PORT</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>StandardOutPath</key>
  <string>$LOG_FILE</string>
  <key>StandardErrorPath</key>
  <string>$ERROR_LOG_FILE</string>

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
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/state" 2>/dev/null; then
    echo
    echo "✔ $APP_NAME corriendo en http://localhost:$PORT"
    echo "  Logs:       npm run daemon:logs"
    echo "  Reiniciar:  npm run daemon:restart"
    echo "  Quitar:     npm run daemon:uninstall"
    exit 0
  fi
  sleep 0.4
done

echo "✖ No respondió en 30s. Revisa $ERROR_LOG_FILE" >&2
echo "  Estado del agente: launchctl print $DOMAIN/$LABEL" >&2
exit 1
