import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * C159.1: the embed client's library build, an ES module and an IIFE (`window.OpenVerify`) for a
 * plain `<script>` tag, with no runtime dependency; `tsc -p tsconfig.build.json` writes the types
 * beside them. The size test (at most 6 KB gzipped) builds into a fresh directory of its own.
 */
export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('src/index.ts', import.meta.url)),
      name: 'OpenVerify',
      formats: ['es', 'iife'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'openverify.iife.js'),
    },
    emptyOutDir: true,
    sourcemap: true,
  },
});
