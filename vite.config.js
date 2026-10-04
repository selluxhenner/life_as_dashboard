import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  clearScreen: false,
  server: {
    port: Number(process.env.PORT) || 5500,
    strictPort: !!process.env.PORT,
    proxy: { '/api': 'http://127.0.0.1:8787' }
  },
  build: {
    outDir: 'www',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 900
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js']
  }
});
