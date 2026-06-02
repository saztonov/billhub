/**
 * Лаунчер rollback-скрипта delta-replay (ADR-0006, Сценарий B/C). Имя файла зафиксировано в ADR-0006.
 *
 * Делегирует в server/src/cli/delta-replay-yandex-to-supabase.ts через tsx (резолвит postgres.js
 * и @supabase/supabase-js). ЯВНАЯ операционная процедура — НЕ runtime-fallback (принцип 2).
 *   npx tsx scripts/delta-replay-yandex-to-supabase.ts \
 *     --source-url <yandex-pg> --supabase-url <url> --supabase-key <service-role> --since <ISO>
 * Exit 0 — без провалов (конфликты в delta-replay-conflicts.log); 1 — есть провалы; 2 — неверные аргументы.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(scriptDir, '../server')

const res = spawnSync(
  'npx',
  ['tsx', 'src/cli/delta-replay-yandex-to-supabase.ts', ...process.argv.slice(2)],
  {
    cwd: serverDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
)

process.exit(res.status ?? 2)
