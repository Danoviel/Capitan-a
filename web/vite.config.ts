import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { DEFAULT_SERVER_PORT, DEV_DASHBOARD_PORT } from '@capitania/shared';

const API_TARGET = `http://127.0.0.1:${DEFAULT_SERVER_PORT}`;

// En dev el dashboard corre en su propio puerto y proxea al servidor; en
// producción el servidor sirve este mismo build, así que las rutas relativas
// funcionan igual.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: DEV_DASHBOARD_PORT,
    strictPort: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/ws': { target: API_TARGET, ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
