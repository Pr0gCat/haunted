import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    lib: 'src/lib.ts',
    'mcp/index': 'src/mcp/index.ts',
    'cli/index': 'src/cli/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: process.env.NODE_ENV === 'production',
  treeshake: true,
  external: ['prisma', '@prisma/client'],
  esbuildOptions(options) {
    options.platform = 'node';
    options.target = 'node20';
  },
});