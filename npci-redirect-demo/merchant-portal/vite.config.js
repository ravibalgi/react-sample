import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = `http://localhost:${process.env.SERVER_PORT ?? 5050}`;

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    // The NPCI POST lands on the same origin the React app is served from, and
    // the dev server forwards it to the Node receiver. In production a reverse
    // proxy (nginx / ALB / API gateway) does the same routing.
    proxy: {
      '/npci': backend,
      '/api': backend,
    },
  },
});
