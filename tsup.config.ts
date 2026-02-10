import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2022',
  },
  {
    entry: {
      'generated/index': 'src/generated/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: false,
    sourcemap: true,
    clean: false,
    target: 'es2022',
  },
]);
