/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest для backend BillHub.
 * - Node environment (без jsdom).
 * - tsx через esbuild (default vitest transform).
 * - Setup-файл подгружает env с тестовыми значениями.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@server': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/test/**', 'src/server.ts', 'src/types/**'],
    },
  },
});
