import { defineConfig } from 'vite'
import mkcert from 'vite-plugin-mkcert'

// Same proxy for both `dev` and `preview` so the documented HTTPS commands behave alike.
const wsProxy = {
  '/ws': {
    target: 'ws://localhost:8080',
    ws: true,
    changeOrigin: true,
  },
}

export default defineConfig({
  plugins: [mkcert()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: wsProxy,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    proxy: wsProxy,
  },
})
