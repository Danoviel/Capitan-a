# Identidad de la app, compartida por todos los scripts de instalación.
# Se carga con `source`: no se ejecuta sola.

# Nombre visible (notificaciones, Info.plist) y nombre de archivo (sin tilde:
# rutas como /Applications/Capitania.app se escriben sin problemas en la terminal).
APP_NAME="Capitanía"
APP_SLUG="Capitania"

# Identificador para macOS (LaunchAgent y bundles). Es la firma del autor, no
# del usuario: quien instale la app no necesita cambiarlo.
BUNDLE_ID="io.github.danoviel.capitania"

# Debe coincidir con DEFAULT_SERVER_PORT de shared/src/constants.ts.
PORT="${CAPITANIA_PORT:-7788}"

LOG_DIR="$HOME/Library/Logs/$APP_SLUG"
LOG_FILE="$LOG_DIR/capitania.log"
ERROR_LOG_FILE="$LOG_DIR/capitania.error.log"

DOMAIN="gui/$(id -u)"
