#!/bin/bash
#
# Instalador de Capitanía para macOS.
#
# Desde el repo clonado:
#   ./install.sh
#
# Sin clonar nada (descarga el repo en ~/Capitania):
#   curl -fsSL https://raw.githubusercontent.com/Danoviel/Capitan-a/main/install.sh | bash
#
# Opciones:
#   --menubar        instala también el ícono de la barra de menú
#   --sin-servicio   no lo deja arrancando al iniciar sesión (lo levantas con `npm start`)
#
# Variables opcionales:
#   CAPITANIA_DIR       dónde clonar cuando se instala sin repo (por defecto ~/Capitania)
#   CAPITANIA_REPO_URL  de dónde clonar (útil para un fork)
#
set -euo pipefail

REPO_URL="${CAPITANIA_REPO_URL:-https://github.com/Danoviel/Capitan-a.git}"
TARGET_DIR="${CAPITANIA_DIR:-$HOME/Capitania}"
MIN_NODE=20

step() { printf '\n▸ %s\n' "$1"; }
fail() { printf '\n✖ %s\n' "$1" >&2; exit 1; }

# --- 1. ¿Estamos dentro del repo o hay que traerlo? --------------------------
# Con `curl | bash` no hay archivo en disco: BASH_SOURCE no apunta al repo.
SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [[ -z "$SCRIPT_DIR" || ! -f "$SCRIPT_DIR/scripts/config.sh" ]]; then
  [[ "$(uname -s)" == "Darwin" ]] || fail "Capitanía por ahora funciona solo en macOS."
  command -v git >/dev/null 2>&1 || fail "Falta git. Instálalo con: xcode-select --install"

  if [[ -d "$TARGET_DIR/.git" ]]; then
    step "Actualizando $TARGET_DIR"
    git -C "$TARGET_DIR" pull --ff-only
  elif [[ -e "$TARGET_DIR" ]]; then
    fail "$TARGET_DIR ya existe y no es el repo de Capitanía. Usa CAPITANIA_DIR=otra/carpeta."
  else
    step "Descargando Capitanía en $TARGET_DIR"
    git clone --depth 1 "$REPO_URL" "$TARGET_DIR"
  fi
  exec bash "$TARGET_DIR/install.sh" "$@"
fi

REPO="$SCRIPT_DIR"
source "$REPO/scripts/config.sh"

WITH_MENUBAR=false
WITH_SERVICE=true
for arg in "$@"; do
  case "$arg" in
    --menubar) WITH_MENUBAR=true ;;
    --sin-servicio) WITH_SERVICE=false ;;
    *) fail "Opción desconocida: $arg (usa --menubar o --sin-servicio)" ;;
  esac
done

# --- 2. Requisitos -----------------------------------------------------------
step "Revisando requisitos"
[[ "$(uname -s)" == "Darwin" ]] || fail "$APP_NAME por ahora funciona solo en macOS."

command -v node >/dev/null 2>&1 \
  || fail "Falta Node.js $MIN_NODE o superior. Instálalo desde https://nodejs.org o con: brew install node"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= MIN_NODE )) \
  || fail "Tienes Node $(node -v) y hace falta $MIN_NODE o superior. Actualízalo desde https://nodejs.org"
echo "  Node $(node -v) ✓"

# Las apps (.app y barra de menú) se compilan con Swift: sin las herramientas de
# línea de comandos de Xcode se instala igual, solo que sin esas apps.
HAS_SWIFT=false
if xcode-select -p >/dev/null 2>&1 && command -v swiftc >/dev/null 2>&1; then
  HAS_SWIFT=true
  echo "  Herramientas de Xcode ✓"
else
  echo "  Herramientas de Xcode: no están (se omite la app de /Applications; instálalas con xcode-select --install)"
fi

# --- 3. Dependencias ---------------------------------------------------------
step "Instalando dependencias"
(cd "$REPO" && npm ci --no-audit --no-fund)

# --- 4. Servicio, apps y panel -----------------------------------------------
if $WITH_SERVICE; then
  step "Dejando $APP_NAME como servicio (arranca solo al iniciar sesión)"
  "$REPO/scripts/install-daemon.sh"
else
  step "Compilando el panel"
  (cd "$REPO" && npm run build >/dev/null)
fi

if $HAS_SWIFT; then
  step "Instalando $APP_SLUG.app en /Applications"
  "$REPO/scripts/build-app.sh" --install
  if $WITH_MENUBAR; then
    step "Instalando el ícono de la barra de menú"
    "$REPO/scripts/build-menubar.sh" --install
  fi
fi

echo
echo "✔ $APP_NAME instalado en $REPO"
if $WITH_SERVICE; then
  echo "  Panel:  http://localhost:$PORT"
  open "http://localhost:$PORT" 2>/dev/null || true
else
  echo "  Arráncalo con:  cd \"$REPO\" && npm start"
fi
echo "  Agrega tus proyectos con el botón \"+ Nuevo proyecto\"."
