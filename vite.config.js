import { defineConfig } from 'vite';

export default defineConfig({
  server: { open: true },
  build: { chunkSizeWarningLimit: 1000 },
});
