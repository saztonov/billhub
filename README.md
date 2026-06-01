# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## Observability и внешний uptime-мониторинг (Этап 1, Iteration 7)

Бэкенд (`server/`) предоставляет health-эндпоинты для оркестратора и внешнего мониторинга:

- `GET /api/health/live` — liveness, без зависимостей, всегда `200`. Используется внешним
  uptime-мониторингом и health-check контейнера.
- `GET /api/health/ready` — readiness: PostgreSQL (`SELECT 1`, timeout 1с), S3 (`HEAD bucket`,
  кэш 30с), Redis (`ping`, timeout 500мс), применённая миграция. Возвращает `503` и JSON с
  per-dependency статусом при сбое любой зависимости.

### Настройка внешнего uptime-мониторинга (UptimeRobot / cronitor)

Этап 1 не использует Sentry SaaS / Prometheus (ADR-0001 §20). Внешний uptime закрывается
бесплатным внешним сервисом:

1. **UptimeRobot** (или cronitor) — создать два HTTP(s)-монитора:
   - `https://<домен>/api/health/live` — интервал 1 мин, ожидаемый код `200`.
   - `https://<домен>/api/health/ready` — интервал 1 мин, ожидаемый код `200` (на `503` алерт).
2. Алерт-контакты: email + Telegram-бот; срабатывание при **2 подряд** неудачных проверках.
3. Проверка алертов: остановить backend (`docker compose stop api`) → в течение ~2 мин должен
   прийти алерт; запустить обратно → recovery-уведомление.

### Внутренние мониторы (audit-события, без SaaS)

Запускаются как BullMQ recurring jobs (`server/src/plugins/maintenance.ts`), при превышении порога
пишут событие в `audit_log`:

- **DB connections** (каждые 30с): `pg_stat_activity` по `billhub_runtime` > 80% от `conn_limit`
  (`DATABASE_CONN_LIMIT`, ADR-0005 = 30) → `db_connections_high`.
- **Dead jobs** (каждую 1 мин): `jobs_log` со `status='dead'` за последний час > 0 → `dead_jobs_detected`.
- **S3 error-rate** (каждую 1 мин): доля ошибок S3-операций воркеров > 5%/мин → `s3_error_rate_high`.

### Backup-restore rehearsal

`scripts/backup-restore-rehearsal.sh` — задокументированная процедура восстановления Yandex
Managed PostgreSQL из бэкапа в отдельный тестовый кластер + smoke (расширения, последняя миграция,
ключевые таблицы). RPO/RTO — по ADR-0005. Прогоняется перед cutover и далее ежеквартально.
