/**
 * Лаунчер byte-range audit миграции файлов R2 → Cloud.ru (Iteration 9, ADR-0004).
 *
 * Делегирует в server/src/cli/audit-s3-sample.ts через tsx (резолвит @aws-sdk/client-s3).
 * Манифест — аргумент (по умолчанию docs/cutover-artifacts/manifest_r2_T1.json), размер выборки —
 * SAMPLE_SIZE (по умолчанию 50). Источник/назначение — переменные R2_ и CLOUDRU_ из окружения.
 *   SAMPLE_SIZE=50 npx tsx scripts/audit-s3-sample.ts docs/cutover-artifacts/manifest_r2_T1.json
 * Exit 0 — все ключи зелёные; 1 — есть расхождения; 2 — ошибка/нет манифеста.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(scriptDir, '../server')

const res = spawnSync('npx', ['tsx', 'src/cli/audit-s3-sample.ts', ...process.argv.slice(2)], {
  cwd: serverDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

process.exit(res.status ?? 2)
