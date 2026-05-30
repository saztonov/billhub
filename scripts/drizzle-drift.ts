/**
 * Лаунчер CI drift-проверки (ADR-0002).
 *
 * Запуск: `node scripts/drizzle-drift.ts` (Node 22+/24 со стриппингом типов).
 * Делегирует в server/src/db/drift.ts через tsx (резолвит .js-спецификаторы и server-зависимости).
 * Требует Docker (testcontainers). exit 0 = схема совпадает, exit 1 = drift/ошибка.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(scriptDir, '../server')

const res = spawnSync('npx', ['tsx', 'src/db/drift.ts'], {
  cwd: serverDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

process.exit(res.status ?? 1)
