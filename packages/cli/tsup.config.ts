import { defineConfig } from 'tsup';

export default defineConfig([
  {
    // The bin and the preload are CommonJS: `node --require` cannot load ESM.
    entry: { cli: 'src/cli.ts', preload: 'src/preload.ts' },
    format: ['cjs'],
    sourcemap: true,
    clean: true,
    target: 'node18',
    outExtension: () => ({ js: '.cjs' }),
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['cjs'],
    dts: true,
    sourcemap: true,
    target: 'node18',
    outExtension: () => ({ js: '.cjs' }),
  },
]);
