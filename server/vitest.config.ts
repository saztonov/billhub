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
      /**
       * Покрытие меряется по слою, который ведётся test-driven в текущих итерациях
       * (Strangler-Fig repository-слой, схемы, миграционный CLI, утилиты, резолюция провайдера).
       * Реализации репозиториев (supabase/drizzle), плагины БД, drift и декларативная Drizzle-схема
       * требуют живого бэкенда (Supabase / Docker-testcontainers) и покрываются интеграционными
       * тестами. Бизнес-роуты/сервисы/очереди — отдельные итерации 4–6 и QH-трек (см. план).
       */
      include: [
        'src/cli/**/*.ts',
        'src/schemas/**/*.ts',
        'src/utils/**/*.ts',
        'src/repositories/**/*.ts',
        'src/plugins/repositories.ts',
      ],
      exclude: [
        'src/**/*.{test,spec}.ts',
        'src/test/**',
        'src/repositories/drizzle/**', // интеграционные (Docker/testcontainers)
        'src/repositories/*.repository.ts', // type-only интерфейсы
        'src/repositories/index.ts', // barrel (type-only)
      ],
    },
  },
});
