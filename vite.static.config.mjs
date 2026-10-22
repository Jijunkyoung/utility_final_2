import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        equipment: resolve(import.meta.dirname, 'equipment.html'),
        alerts: resolve(import.meta.dirname, 'alerts.html'),
        history: resolve(import.meta.dirname, 'history.html'),
        cost: resolve(import.meta.dirname, 'cost.html'),
        energy: resolve(import.meta.dirname, 'energy.html'),
        map: resolve(import.meta.dirname, 'map.html')
      }
    }
  }
});
