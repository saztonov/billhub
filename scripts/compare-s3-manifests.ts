/**
 * Лаунчер сверки S3-манифестов R2 vs Cloud.ru (Iteration 9, ADR-0004).
 *
 * Делегирует в server/src/cli/compare-s3-manifests.ts через tsx. Принимает два пути манифестов
 * (по умолчанию используются артефакты cutover):
 *   npx tsx scripts/compare-s3-manifests.ts \
 *     docs/cutover-artifacts/manifest_r2_T1.json docs/cutover-artifacts/manifest_cloudru_T1.json
 * Exit 0 — сошлись (±0.1%); 1 — расхождение; 2 — ошибка чтения.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(scriptDir, '../server')
const repoRoot = path.resolve(scriptDir, '..')

const defaults = [
  path.join(repoRoot, 'docs/cutover-artifacts/manifest_r2_T1.json'),
  path.join(repoRoot, 'docs/cutover-artifacts/manifest_cloudru_T1.json'),
]
const args = process.argv.slice(2).length >= 2 ? process.argv.slice(2) : defaults

const res = spawnSync('npx', ['tsx', 'src/cli/compare-s3-manifests.ts', ...args], {
  cwd: serverDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

process.exit(res.status ?? 2)
