import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

/**
 * Конфигурация ESLint для BillHub.
 *
 * Зафиксированы baseline-правила Iteration 1:
 * - cutover-critical минимум: 0 errors на main, warnings допустимы.
 * - Полный strict-type-checked + декомпозиция файлов + 0 any — отдельный quality-hardening трек (QH-A/B).
 * - React Compiler hints (preserve-manual-memoization, set-state-in-effect, refs) переключены в warn:
 *   починятся прицельно в quality-hardening, без блокировки cutover.
 */
export default defineConfig([
  globalIgnores([
    'dist',
    'server',
    'scripts',
    'node_modules',
    'sql',
    'docs',
    'temp',
    'e2e',
    'playwright.config.ts',
    '.husky',
    '.vscode',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      /**
       * Параметры/переменные с префиксом _ намеренно не используются (legacy-сигнатуры stores).
       * Это допустимый паттерн; не считаем ошибкой.
       */
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      /**
       * any остаётся в коде в 14 местах (AntD Table/Upload/Form generics).
       * Чистится в quality-hardening QH-B вместе с переходом на strict-type-checked.
       * До QH-B — warning, не блокирует CI.
       */
      '@typescript-eslint/no-explicit-any': 'warn',

      /**
       * React Compiler-hints в React 19 — серьёзная архитектурная работа (рефакторинг effects/memo).
       * Делается прицельно в quality-hardening или по мере касания файла.
       * До QH — warning.
       */
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-render': 'warn',

      /**
       * Экспорт констант/функций из компонент-файлов ломает HMR Vite, но не runtime.
       * Решается выносом в отдельный файл (декомпозиция, QH-A). До QH-A — warning.
       */
      'react-refresh/only-export-components': 'warn',
    },
  },
])
