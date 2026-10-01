/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      output: { manualChunks: { three: ['three'], r3f: ['@react-three/fiber', '@react-three/drei'] } },
    },
    chunkSizeWarningLimit: 800,
  },
  server: { port: 5199 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
