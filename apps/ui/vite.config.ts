import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    allowedHosts: ['.monkeycode-ai.live'],
  },
  build: {
    outDir: '../../packages/core/static',
    emptyOutDir: true,
  },
});
