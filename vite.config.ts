import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Three.js alone is ~560 kB minified; it is split into the lazily
    // loaded 3D view chunk, so the default 500 kB warning is expected.
    chunkSizeWarningLimit: 600,
  },
})
