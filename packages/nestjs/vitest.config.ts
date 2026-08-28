import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@singhak/nodeui-core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
});
