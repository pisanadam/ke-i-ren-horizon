import { defineConfig } from 'vite';

// The dev template lives in src/ so that the repository root's index.html can
// be the finished, self-contained game — which is what GitHub Pages serves.
export default defineConfig({
  root: 'src',
  base: './',
  publicDir: false,
  server: {
    host: true,
    port: 5173
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1600
  }
});
