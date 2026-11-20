import { defineConfig } from 'vite';

export default defineConfig(({ command, isPreview }) => ({
  mode: command === 'serve' && !isPreview ? 'test' : undefined,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
          if (id.includes('node_modules/pixi.js/') || id.includes('node_modules/@pixi/')) return 'pixi';
        },
      },
    },
  },
}));
