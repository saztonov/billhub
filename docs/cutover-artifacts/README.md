# Cutover artifacts

Артефакты cutover (план Iteration 9/10, migration-inventory §9). Генерируются скриптами и
сохраняются здесь для аудита и отладки. Часть файлов создаётся в окне cutover и заполняется live.

## Файлы

| Файл | Генератор | Когда |
|---|---|---|
| `manifest_r2_T1.json` | `scripts/list-r2-manifest.sh` (SIDE=r2) | T1, за 1–2 недели до cutover |
| `manifest_cloudru_T1.json` | `scripts/list-r2-manifest.sh` (SIDE=cloudru) | после первичной синхронизации |
| `manifest_r2_cutover.json` | `scripts/list-r2-manifest.sh` (SIDE=r2 TAG=cutover) | в окне cutover |
| `manifest_cloudru_cutover.json` | `scripts/list-r2-manifest.sh` (SIDE=cloudru TAG=cutover) | в окне cutover |
| `rclone_copy_T1.log` | `scripts/sync-r2-to-cloudru.sh` | первичная синхронизация |
| `rclone_sync_cutover.log` | `scripts/sync-r2-to-cloudru.sh` (FINAL=1) | финальная дельта |
| `rclone_check_*.log` | `scripts/verify-s3-sync.sh` | после каждой синхронизации |
| `cutover_db_pg_restore.log` | `scripts/dump-and-restore.sh` | наполнение/окно cutover |
| `delta-replay-conflicts.log` | `scripts/delta-replay-yandex-to-supabase.ts` | только при rollback (ADR-0006) |
| `cutover_timeline.md` | заполняется вручную | live в окне cutover |

## Проверки (verification chain, ADR-0004)

1. `verify-s3-sync.sh` → `rclone check --size-only` = 0 расхождений.
2. `compare-s3-manifests.ts manifest_r2_T1.json manifest_cloudru_T1.json` → count/total_size ±0.1%.
3. `audit-s3-sample.ts manifest_r2_T1.json` → 50/50 случайных ключей byte-range зелёные.

Реальные манифесты с ключами могут содержать имена файлов из ПДн-контекста — НЕ коммитить их в
открытый репозиторий без необходимости. Формат — см. `manifest_r2_T1.example.json`.
