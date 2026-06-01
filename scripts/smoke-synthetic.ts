/**
 * Лаунчер smoke на синтетике (Iteration 8).
 *
 * Делегирует в server/src/cli/smoke-synthetic.ts через tsx (резолвит server-зависимости:
 * testcontainers, postgres.js, bcryptjs, createApp). Требует Docker + GNU sed.
 *   npx tsx scripts/smoke-synthetic.ts
 * Exit 0 — smoke зелёный; 1 — провал.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(scriptDir, '../server')

const res = spawnSync('npx', ['tsx', 'src/cli/smoke-synthetic.ts'], {
  cwd: serverDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

process.exit(res.status ?? 1)
