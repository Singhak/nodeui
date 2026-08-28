import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@singhak/nodeui-core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
});
