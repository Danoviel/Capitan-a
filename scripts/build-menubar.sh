#!/bin/bash
#
# Construye CapitaniaMenuBar.app: el ícono de la barra de menú.
#
#   ./scripts/build-menubar.sh            deja la app en build/
#   ./scripts/build-menubar.sh --install  la instala y la arranca al iniciar sesión
#   ./scripts/build-menubar.sh --uninstall
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$REPO/scripts/config.sh"
NAME="${APP_SLUG}MenuBar"
APP="$REPO/build/$NAME.app"
CONTENTS="$APP/Contents"
LABEL="$BUNDLE_ID.menubar"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  rm -rf "/Applications/$NAME.app"
  echo "✔ Ícono de barra de menú desinstalado."
  exit 0
fi

echo "▸ Compilando Swift..."
rm -rf "$APP"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"
swiftc -O -o "$CONTENTS/MacOS/$NAME" "$REPO/menubar/main.swift"

echo "▸ Generando ícono..."
ICONSET="$REPO/build/$NAME.iconset"
rm -rf "$ICONSET"
swift "$REPO/scripts/make-icon.swift" "$ICONSET" >/dev/null
iconutil -c icns "$ICONSET" -o "$CONTENTS/Resources/AppIcon.icns"
rm -rf "$ICONSET"

echo "▸ Escribiendo Info.plist..."
cat > "$CONTENTS/Info.plist" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>            <string>$APP_NAME Menu Bar</string>
  <key>CFBundleDisplayName</key>     <string>$APP_NAME Menu Bar</string>
  <key>CFBundleIdentifier</key>      <string>$LABEL</string>
  <key>CFBundleVersion</key>         <string>1.0.0</string>
  <key>CFBundleShortVersionString</key> <string>1.0.0</string>
  <key>CFBundlePackageType</key>     <string>APPL</string>
  <key>CFBundleExecutable</key>      <string>$NAME</string>
  <key>CFBundleIconFile</key>        <string>AppIcon</string>
  <key>LSMinimumSystemVersion</key>  <string>13.0</string>
  <!-- Vive solo en la barra de menú: sin ícono en el Dock. -->
  <key>LSUIElement</key>             <true/>
  <key>NSHighResolutionCapable</key> <true/>
  <!-- El panel habla HTTP plano contra loopback; ATS lo bloquearía sin esto. -->
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
    <key>NSExceptionDomains</key>
    <dict>
      <key>127.0.0.1</key>
      <dict>
        <key>NSExceptionAllowsInsecureHTTPLoads</key><true/>
        <key>NSIncludesSubdomains</key><true/>
      </dict>
      <key>localhost</key>
      <dict>
        <key>NSExceptionAllowsInsecureHTTPLoads</key><true/>
        <key>NSIncludesSubdomains</key><true/>
      </dict>
    </dict>
  </dict>
</dict>
PLIST_EOF
echo "</plist>" >> "$CONTENTS/Info.plist"

touch "$APP"
echo
echo "✔ App construida: $APP"

if [[ "${1:-}" != "--install" ]]; then
  echo "  Instálala con: ./scripts/build-menubar.sh --install"
  exit 0
fi

echo "▸ Instalando en /Applications..."
# Si ya está corriendo hay que bajarla antes de reemplazar el binario.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
pkill -f "/Applications/$NAME.app/Contents/MacOS/$NAME" 2>/dev/null || true
sleep 1
rm -rf "/Applications/$NAME.app"
cp -R "$APP" /Applications/
touch "/Applications/$NAME.app"

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<AGENT_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Applications/$NAME.app/Contents/MacOS/$NAME</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
AGENT_EOF

launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/$LABEL"

sleep 2
if pgrep -f "/Applications/$NAME.app/Contents/MacOS/$NAME" >/dev/null; then
  echo
  echo "✔ Ícono activo en la barra de menú (arriba a la derecha)."
  echo "  Arranca solo al iniciar sesión."
  echo "  Quitar: ./scripts/build-menubar.sh --uninstall"
else
  echo "✖ No arrancó. Prueba a mano: /Applications/$NAME.app/Contents/MacOS/$NAME" >&2
  exit 1
fi
