/**
 * bootstrap-filter.ts — TS-обёртка над sed-фильтром Supabase-специфики (Iteration 8).
 *
 * Единый источник правды фильтра — scripts/lib/supabase-schema-filter.sed (его же использует
 * scripts/bootstrap-schema.sh в production). Здесь НЕ дублируется regex-логика: функция
 * вызывает тот же sed-скрипт через child_process, чтобы тесты (bootstrap dry-run на
 * testcontainers) проверяли РОВНО ту фильтрацию, что применяется в production (принцип 6).
 *
 * Требует GNU sed в PATH (CI Ubuntu; на Windows-dev без sed — вызвавший тест помечает skip).
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Корень репозитория (server/src/cli → ../../..). */
const REPO_ROOT = path.resolve(__dirname, '../../..');

/** Путь к raw pg_dump Supabase (источник bootstrap-схемы). */
export const SCHEMA_SQL_PATH = path.join(REPO_ROOT, 'sql', 'schema', 'schema.sql');
/** Путь к единому sed-фильтру. */
export const SED_FILTER_PATH = path.join(REPO_ROOT, 'scripts', 'lib', 'supabase-schema-filter.sed');
/** Каталог инкрементальных миграций. */
export const MIGRATIONS_DIR = path.join(REPO_ROOT, 'sql', 'migrations');

/** Доступен ли sed в PATH (для условного запуска тестов на платформах без sed). */
export function hasSed(): boolean {
  try {
    execFileSync('sed', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Применяет sed-фильтр (scripts/lib/supabase-schema-filter.sed) к schema.sql и возвращает
 * отфильтрованный SQL. Бросает, если sed недоступен или файлы не найдены.
 */
export function filterSchemaViaSed(
  schemaPath: string = SCHEMA_SQL_PATH,
  sedFilterPath: string = SED_FILTER_PATH,
): string {
  if (!existsSync(schemaPath)) throw new Error(`schema.sql не найден: ${schemaPath}`);
  if (!existsSync(sedFilterPath)) throw new Error(`sed-фильтр не найден: ${sedFilterPath}`);
  return execFileSync('sed', ['-E', '-f', sedFilterPath, schemaPath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}
