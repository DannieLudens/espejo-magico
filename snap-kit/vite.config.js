import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry:    resolve(__dirname, 'src/snap-bridge.js'),
      name:     'SnapCameraKit',
      fileName: 'snap-kit-bundle',
      formats:  ['es']    // ES module → compatible con dynamic import() en snap-filter.js
    },
    outDir:  '../js',       // genera ../js/snap-kit-bundle.js
    emptyOutDir: false,     // no borrar los demás archivos en /js
    rollupOptions: {
      output: {
        entryFileNames: 'snap-kit-bundle.js'
      }
    },
    // Evitar warnings de tamaño de chunk (el SDK de Snap es ~500 kB)
    chunkSizeWarningLimit: 600
  }
});
