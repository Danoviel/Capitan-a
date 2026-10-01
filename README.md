# Capitanía

Panel local para **prender, apagar y vigilar los servidores de desarrollo** de todos tus proyectos desde un solo lugar, y para **detectar cuándo un frontend no está hablando con el backend que debería**.

Así como la capitanía de un puerto decide en qué muelle atraca cada barco y avisa cuando dos quieren el mismo lugar, Capitanía le asigna un puerto a cada proyecto, los enciende y apaga por ti y te avisa cuando algo quedó desalineado.

> Solo macOS por ahora. Windows y Linux están en el plan (ver [Limitaciones](#limitaciones)).

## Qué hace

- **Encender y apagar proyectos** con un clic, por proyecto o por grupo (por ejemplo, el BE y el FE de un mismo producto). Al apagar, cierra también los procesos hijos (autoreload de Django, `npm run dev`), así el puerto queda libre de verdad.
- **Diagnóstico de integración**: revisa cada proyecto y marca si está *Integrado*, *Desalineado* o *Con errores*:
  - que el comando fije el puerto que el proyecto tiene asignado (y que Vite use `--strictPort`);
  - que el frontend apunte al puerto de **su** backend, leyendo los `.env*` y el proxy de `vite.config` / `next.config`. Si apunta al puerto de *otro* proyecto, es error: es el caso en el que la app "funciona" con datos ajenos;
  - que el `CORS_ALLOWED_ORIGINS` del backend acepte al frontend que lo llama;
  - que nadie más esté usando su puerto, o si el proyecto está corriendo por fuera (terminal, VS Code) en otro puerto.
- **Panel de puertos**: todo lo que escucha en tu Mac, separado en *tus proyectos*, *desarrollo sin registrar*, *protegidos* (bases de datos, Redis) y *apps del sistema*. Los procesos se asocian al proyecto por su **carpeta**, no por el número de puerto.
- **Logs legibles**: entiende el formato de Django (`HTTP GET /api/x 200 [0.05]`), separa peticiones y problemas, oculta el ruido (OPTIONS, estáticos, DEBUG) y agrupa las líneas repetidas.
- **Servicios**: arranca y detiene servicios de Homebrew (Postgres, Redis…) y contenedores de Docker.
- **Formulario de proyectos** con sugerencia de puertos libres por tipo (Django 80xx, Vite 51xx, Next 30xx…) y aviso de choques.
- **Ícono en la barra de menú** (opcional) para prender o apagar sin abrir el panel.

## Requisitos

- macOS 13 o superior
- [Node.js](https://nodejs.org) 20 o superior
- git (si no lo tienes, `xcode-select --install` lo instala junto con las herramientas de Xcode)
- Opcional: Xcode Command Line Tools (`xcode-select --install`), solo si quieres el ícono de la barra de menú o la app en `/Applications`
- Opcional: Homebrew y/o Docker, si quieres manejar sus servicios desde el panel

## Instalación

Un solo comando en la Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/Danoviel/Capitan-a/main/install.sh | bash
```

Descarga Capitanía en `~/Capitania`, revisa los requisitos, instala las dependencias, lo deja como servicio que arranca solo al iniciar sesión, pone **Capitania.app** en `/Applications` y abre el panel en **http://localhost:7788**.

¿Prefieres ver el código antes de ejecutarlo? Clónalo y usa el mismo instalador:

```bash
git clone https://github.com/Danoviel/Capitan-a.git capitania
cd capitania
./install.sh
```

| Opción | Qué hace |
|---|---|
| `--menubar` | Instala también el ícono de la barra de menú |
| `--sin-servicio` | No lo deja arrancando al iniciar sesión; lo levantas tú con `npm start` |

Con `curl`, las opciones van después de `bash -s --`, por ejemplo: `curl -fsSL … | bash -s -- --menubar`.

Para actualizar, vuelve a correr el instalador: hace `git pull` y reinstala. Ojo: al reiniciar el servicio se apagan los proyectos que tenía encendidos.

### Desinstalar

```bash
cd ~/Capitania                      # o donde lo hayas clonado
npm run daemon:uninstall            # quita el servicio
./scripts/build-menubar.sh --uninstall   # si instalaste el ícono
rm -rf /Applications/Capitania.app ~/Library/Logs/Capitania
```

Después puedes borrar la carpeta del repo. Tus proyectos no se tocan: Capitanía nunca modifica sus archivos.

## Agregar tus proyectos

La primera vez el panel arranca vacío. Usa **+ Nuevo proyecto**: elige la carpeta, el comando de arranque y el puerto, y el formulario te sugiere puertos libres. Al guardar se crea `projects.json` en la raíz del repo.

También puedes escribirlo a mano partiendo de [`projects.example.json`](projects.example.json):

```json
{
  "id": "mi-app-be",
  "name": "Mi App BE",
  "group": "Mi App",
  "kind": "django",
  "cwd": "~/Proyectos/mi-app/backend",
  "command": "source .venv/bin/activate && python manage.py runserver 127.0.0.1:8001",
  "port": 8001,
  "links": [{ "label": "Admin", "path": "/admin/" }]
}
```

| Campo | Para qué sirve |
|---|---|
| `id` | Identificador único: minúsculas, números y guiones |
| `group` | Agrupa tarjetas. El diagnóstico asume que un FE habla con **el único backend de su mismo grupo** |
| `kind` | `django`, `vite`, `next`, `angular`, `node` o `custom` |
| `cwd` | Carpeta donde se ejecuta el comando. Acepta `~` |
| `command` | Tal cual lo escribirías en la terminal. Se ejecuta en un shell de login, así que `nvm`, `pyenv` y Homebrew funcionan |
| `port` | Puerto que el proyecto debe ocupar, o `null` si no expone ninguno |
| `env`, `url`, `links`, `notes` | Opcionales: variables extra, URL propia, accesos directos (admin, docs) y una nota visible en la tarjeta |

`protectedPorts` lista los puertos que el botón **Liberar** nunca toca. `projects.json` no se sube a git: tiene rutas de tu máquina. Si existe `projects.local.json`, tiene prioridad.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run daemon:install` | Compila el panel e instala o reinstala el servicio |
| `npm run daemon:restart` | Reinicia el servidor. **Apaga los proyectos que lanzó** |
| `npm run daemon:logs` | Sigue el log del servidor en vivo |
| `npm run daemon:uninstall` | Quita el servicio del arranque |
| `npm run typecheck` | Chequeo de tipos de los tres paquetes |

## Seguridad

Capitanía **ejecuta los comandos que tú configuras**, así que está hecho para no exponerse:

- escucha solo en `127.0.0.1`, nunca en la red;
- rechaza cualquier petición cuyo `Host` u `Origin` no sea el propio panel. Esto frena que una página web abierta en tu navegador le mande órdenes a `localhost` (CSRF, secuestro del WebSocket y DNS rebinding). `curl` desde tu terminal sí funciona.

## Cómo está hecho

```
shared/   contrato entre servidor y panel: tipos, constantes y reglas
server/   Node + TypeScript + Express + WebSocket
  http/       rutas y candado de origen
  app/        Supervisor: orquesta los casos de uso
  services/   procesos, puertos (lsof), diagnóstico, logs, servicios
web/      React + Vite + Tailwind
menubar/  app de barra de menú en Swift (cliente de la misma API)
scripts/  instalación del servicio y de las apps (config en scripts/config.sh)
```

### Desarrollo

El panel en modo desarrollo corre en `:5190` y usa el servidor del puerto `7788`:

```bash
npm run dev:web      # solo el panel, contra el servidor instalado
```

Para trabajar en el servidor, desinstala antes el servicio (`npm run daemon:uninstall`) y usa `npm run dev`, que levanta servidor y panel con recarga automática.

## Limitaciones

- **Solo macOS.** Usa `lsof`, `launchd` y grupos de procesos de Unix. Linux debería ser un cambio pequeño; Windows requiere otra forma de identificar procesos, porque no expone la carpeta de trabajo de otro proceso.
- El diagnóstico lee archivos de configuración conocidos (`.env*`, `vite.config`, `next.config`, `CORS_ALLOWED_ORIGINS` en `.env`). Si tu CORS vive solo en `settings.py`, no lo evalúa.

## Licencia

[MIT](LICENSE) © David Carhuaz
