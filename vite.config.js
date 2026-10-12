import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // relative asset paths: works on GitHub Pages under /<repo>/
  server: { open: true },
  build: { chunkSizeWarningLimit: 1000 },
});
