import { defineConfig } from 'tsup';

// Fully bundled: the production image ships this single file without node_modules.
// The banner gives bundled CommonJS dependencies a working require().
export default defineConfig({
  entry: ['src/migrate.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  noExternal: [/.*/],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
