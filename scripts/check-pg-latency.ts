/**
 * Лаунчер замера latency до PostgreSQL (Iteration 8).
 *
 * Делегирует в server/src/cli/check-pg-latency.ts через tsx (резолвит server-зависимости —
 * postgres.js). Берёт DATABASE_URL из окружения. Запуск на целевой VPS против Yandex PG:
 *   DATABASE_URL=postgresql://...verify-full npx tsx scripts/check-pg-latency.ts
 * Exit 0 — median ≤ 30 мс и p95 ≤ 50 мс; 1 — пороги провалены; 2 — ошибка/нет DATABASE_URL.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(scriptDir, '../server')

const res = spawnSync('npx', ['tsx', 'src/cli/check-pg-latency.ts'], {
  cwd: serverDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

process.exit(res.status ?? 2)
