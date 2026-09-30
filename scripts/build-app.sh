#!/bin/bash
#
# Construye Capitania.app: un launcher que se asegura de que el daemon esté
# vivo y abre el dashboard en una ventana limpia, sin barra de direcciones.
#
#   ./scripts/build-app.sh              deja la app en build/Capitania.app
#   ./scripts/build-app.sh --install    además la copia a /Applications
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$REPO/scripts/config.sh"
APP="$REPO/build/$APP_SLUG.app"
CONTENTS="$APP/Contents"

echo "▸ Generando ícono..."
ICONSET="$REPO/build/$APP_SLUG.iconset"
rm -rf "$ICONSET" "$APP"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"
swift "$REPO/scripts/make-icon.swift" "$ICONSET" >/dev/null
iconutil -c icns "$ICONSET" -o "$CONTENTS/Resources/AppIcon.icns"
rm -rf "$ICONSET"

echo "▸ Escribiendo Info.plist..."
cat > "$CONTENTS/Info.plist" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>            <string>$APP_NAME</string>
  <key>CFBundleDisplayName</key>     <string>$APP_NAME</string>
  <key>CFBundleIdentifier</key>      <string>$BUNDLE_ID.launcher</string>
  <key>CFBundleVersion</key>         <string>1.0.0</string>
  <key>CFBundleShortVersionString</key> <string>1.0.0</string>
  <key>CFBundlePackageType</key>     <string>APPL</string>
  <key>CFBundleExecutable</key>      <string>$APP_SLUG</string>
  <key>CFBundleIconFile</key>        <string>AppIcon</string>
  <key>LSMinimumSystemVersion</key>  <string>13.0</string>
  <!-- Es un launcher: abre la ventana y sale, sin quedarse en el Dock. -->
  <key>LSUIElement</key>             <true/>
  <key>NSHighResolutionCapable</key> <true/>
</dict>
</plist>
PLIST_EOF

echo "▸ Escribiendo el launcher..."
cat > "$CONTENTS/MacOS/$APP_SLUG" <<LAUNCHER_EOF
#!/bin/bash
# Abre el dashboard de $APP_NAME, levantando el daemon si hiciera falta.
set -uo pipefail

PORT=$PORT
REPO="$REPO"
LABEL="$BUNDLE_ID"
URL="http://localhost:\$PORT"

notify() {
  osascript -e "display notification \"\$1\" with title \"$APP_NAME\"" >/dev/null 2>&1 || true
}

alive() { curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:\$PORT/api/state" 2>/dev/null; }

if ! alive; then
  notify "Levantando el servidor..."
  # Si el LaunchAgent existe lo reinicia; si no, arranca el server suelto.
  if launchctl print "gui/\$(id -u)/\$LABEL" >/dev/null 2>&1; then
    launchctl kickstart "gui/\$(id -u)/\$LABEL" >/dev/null 2>&1
  else
    # Login shell: lanzada desde Finder la app no hereda el PATH del usuario y
    # npm/node no se encontrarían.
    nohup /bin/zsh -lc "cd '\$REPO' && npm start" >/dev/null 2>&1 &
  fi

  for _ in \$(seq 1 60); do
    alive && break
    sleep 0.5
  done

  if ! alive; then
    osascript -e 'display alert "$APP_NAME" message "El servidor no respondió en el puerto '"\$PORT"'. Revisa $ERROR_LOG_FILE" as critical' >/dev/null 2>&1
    exit 1
  fi
fi

# Ventana de aplicación (sin barra de URL ni pestañas) si hay un Chromium a mano.
for browser in "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
               "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
               "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; do
  if [[ -x "\$browser" ]]; then
    "\$browser" --app="\$URL" >/dev/null 2>&1 &
    exit 0
  fi
done

# Sin Chromium: se abre en el navegador por defecto, como pestaña normal.
open "\$URL"
LAUNCHER_EOF

chmod +x "$CONTENTS/MacOS/$APP_SLUG"

# Sin esto Finder puede seguir mostrando el ícono genérico cacheado.
touch "$APP"

echo
echo "✔ App construida: $APP"

if [[ "${1:-}" == "--install" ]]; then
  rm -rf "/Applications/$APP_SLUG.app"
  cp -R "$APP" /Applications/
  touch "/Applications/$APP_SLUG.app"
  echo "✔ Instalada en /Applications/$APP_SLUG.app"
  echo "  Búscala con ⌘+Espacio → \"$APP_NAME\""
else
  echo "  Instálala con: ./scripts/build-app.sh --install"
fi
