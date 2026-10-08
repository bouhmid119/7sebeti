import { defineConfig } from 'tsup';

// Workspace packages ship TypeScript sources, so they are bundled into the app.
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  noExternal: [/^@7sebeti\//],
});
