import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, open: false },
  build: { outDir: 'dist', sourcemap: false },
  // cytoscape-hyse ships a pre-built ESM bundle; Vite can pre-bundle it like any dep.
  optimizeDeps: { include: ['cytoscape', 'cytoscape-hyse'] },
});
