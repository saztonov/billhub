# ADR-0004: Стратегия миграции файлов Cloudflare R2 → Cloud.ru S3

**Status:** accepted (2026-05-30)

## Context

Файлы BillHub (счета, договорные документы, файлы решений, учредительные документы) хранятся в S3-совместимом хранилище Cloudflare R2. Этап 1 переводит хранение на Cloud.ru S3 — оба провайдера поддерживаются текущим кодом через переменную `STORAGE_PROVIDER`.

Схема ключей объектов (генерируется backend-ом в `server/src/routes/files.ts`, функция `buildFileKey`):

| context | Шаблон ключа |
|---|---|
| `request` | `{counterparty}/{requestNumber}/{timestamp}_{filename}` |
| `decision` | `approval-decisions/{entityId}/{timestamp}_{filename}` |
| `payment` | `{counterparty}/payment/{entityId}/{timestamp}_{filename}` |
| `contract` | `{counterparty}/contract/{entityId}/{timestamp}_{filename}` |
| `general` | `{counterparty}/{timestamp}_{filename}` |
| `founding` | `founding-docs/{entityId}/{timestamp}_{filename}` |

Где `{counterparty}` — санитизированное имя контрагента (транслитерация + замена пробелов). Все ключи начинаются с папки контрагента или с фиксированного префикса (`approval-decisions/`, `founding-docs/`). При смене S3-провайдера ключи **не меняются** — меняется только endpoint и credentials.

Принципы программы:
1. Старый прод (Cloudflare R2 + backend на старой VPS) не модифицируется до cutover. Двойная запись запрещена.
4. Cutover только после прохождения функциональных + нагрузочных тестов на новой инфре (приложение работает с Cloud.ru S3 на копии файлов до cutover).
2. Этап 1 не удаляет код, поддерживающий оба провайдера.

## Decision

**Manifest-based copy через `rclone`, в два прохода: первичная синхронизация (за дни до cutover) и финальная дельта (в cutover-окне).**

### Этапы

**За 1–2 недели до cutover (в рамках итерации 9):**

1. **Создание manifest старого состояния R2:**
   ```bash
   aws s3api list-objects-v2 \
     --endpoint-url $R2_ENDPOINT \
     --bucket $R2_BUCKET \
     --query 'Contents[].{Key:Key, Size:Size, LastModified:LastModified, ETag:ETag}' \
     > manifest_r2_T1.json
   ```
   Сохраняется в репозиторий как артефакт cutover (под `docs/cutover-artifacts/`).
2. **Первичный copy через rclone:**
   ```bash
   rclone copy r2:$R2_BUCKET cloudru:$CLOUDRU_BUCKET \
     --transfers 16 --checkers 32 \
     --s3-chunk-size 16M \
     --progress
   ```
   Параллелизм подбирается по факту, чтобы не упереться в лимиты обоих провайдеров.
3. **Verification:**
   - `rclone check r2:$R2_BUCKET cloudru:$CLOUDRU_BUCKET --size-only` — сравнение по size (MD5 НЕ используется, см. ниже).
   - Сравнение manifest: count(объектов в Cloud.ru) == count(в manifest_r2_T1.json); суммарный размер совпадает с допуском ±0.1% (на случай дельты, накопившейся между моментом T1 и моментом check).
   - **Выборочный byte-range audit:** 50 случайных ключей, для каждого — `aws s3api get-object --range bytes=0-1023` из R2 и из Cloud.ru, побайтовое сравнение; то же для последних 1 KB. Скрипт `scripts/audit-s3-sample.ts`.

**В cutover-окне (итерация 10):**

4. **Финальная дельта:**
   ```bash
   rclone sync --update r2:$R2_BUCKET cloudru:$CLOUDRU_BUCKET \
     --transfers 16 --checkers 32 \
     --s3-chunk-size 16M
   ```
   `--update` копирует только новые/изменённые объекты (по mtime + size). За окно от T1 до cutover дельта обычно небольшая (десятки–сотни новых файлов).
5. **Повторная verification:** `rclone check --size-only` → 0 расхождений. Manifest актуализируется.
6. **DNS switch + смена `STORAGE_PROVIDER=cloudru` на новой VPS** (новая VPS была уже сконфигурирована на `cloudru` для тестов; здесь это просто факт, что прод-трафик пойдёт на неё).

### Почему не MD5/ETag для verification

У S3-совместимых провайдеров ETag равен MD5 объекта **только для single-part PUT** (объекты ≤ chunk-size загрузчика, обычно 5–16 MB). Для **multipart-объектов** (большие файлы загружаются чанками — у нас chunked upload именно так и работает) ETag = MD5 от конкатенации MD5 каждой части + `-N`, и он **разный у R2 и у Cloud.ru даже для идентичного содержимого**, потому что они используют разный chunk-size.

Поэтому verification — это:
- **`rclone check --size-only`** — быстрая проверка по size (надёжна на 99% — расхождение size = расхождение содержимого).
- **byte-range audit** на 50 случайных объектах — даёт криптографическую уверенность для выборки.
- **manifest count + total size** — двойная страховка от пропусков.

### Object keys не меняются

Ключи S3-объектов в R2 и в Cloud.ru — идентичны. Поля типа `files.s3_key`, `payment_request_files.file_key`, `contract_request_files.file_key`, `founding_document_files.file_key`, `approval_decision_files.file_key` в БД **не трогаются**.

Если на момент cutover в R2 обнаружится исторический префикс, отличный от текущей схемы (например, объекты с legacy-префиксом из старой реализации) — однократный `UPDATE` в миграции `0009_fix_storage_keys.sql` нормализует пути. Это решение принимается в итерации 9 по итогам обзора фактических ключей в R2.

### Что делать со старым R2

Cloudflare R2 **не очищается и не модифицируется** ни в Этапе 1, ни в Этапе 2:
- Во время cutover-окна — никаких изменений в R2 (бакет можно перевести в read-only через bucket policy, опционально).
- После cutover R2 остаётся read-only fallback минимум 30 дней.
- После 30+ дней стабильности — переводится в архивное хранение или отключается (отдельное решение).

## Consequences

**Плюсы:**
- Manifest-based — независимый источник правды для сверки.
- Полная репетиция (первичный copy + check + audit) проходит за дни до cutover; в окне — только финальная дельта.
- Object keys не меняются → нет миграции БД-полей.
- Двойная запись и любая модификация R2 исключены (принцип 1).
- Verification устойчив к multipart-различиям ETag.

**Минусы:**
- Первичный copy для большого объёма (100+ GB) может занять несколько часов; для TB — дни. Это нужно планировать заранее.
- В окне cutover финальный `rclone sync --update` зависит от объёма дельты — типично минуты, в худшем случае десятки минут.
- Byte-range audit на 50 объектах — выборка, не 100% гарантия побайтовой идентичности всего корпуса.

## Alternatives

| Вариант | Плюсы | Минусы | Решение |
|---|---|---|---|
| `rclone copy + check --size-only + byte-range audit` | Простота, repeatable | Не 100% криптографическая верификация | ✅ |
| `rclone check --checksum` | Криптографическая верификация | Не работает для multipart (ETag разные) | ❌ |
| `aws s3 sync` через два профиля | Стандартный AWS tooling | Менее богатый dry-run, slower для big trees | Резерв |
| Migration через S3 Cross-Region Replication | Управляемый AWS-инструмент | Не работает между Cloudflare и Cloud.ru (разные провайдеры) | ❌ |
| Двойная запись через backend (старый код пишет в R2 и Cloud.ru) | Нет окна синхронизации | Нарушает принцип 1, требует deploy на старом проде | ❌ |

## Procedure (cutover-окно фрагмент)

```bash
# Внутри cutover-окна, шаг 4
rclone sync --update \
  r2:billhub-r2 cloudru:billhub-s3 \
  --transfers 16 --checkers 32 \
  --s3-chunk-size 16M \
  --log-file=rclone_cutover.log

# Verification
rclone check --size-only r2:billhub-r2 cloudru:billhub-s3 \
  > rclone_check_cutover.log 2>&1
# Должно вернуть 0 differences

# Manifest update
aws s3api list-objects-v2 \
  --endpoint-url $CLOUDRU_ENDPOINT \
  --bucket billhub-s3 \
  --query 'Contents[].{Key:Key, Size:Size}' \
  > manifest_cloudru_cutover.json
# Сравнение с manifest_r2 в скрипте scripts/compare-s3-manifests.ts
```

## Связанные ADR

- [ADR-0001: Отклонения от стандарта v3](0001-deviations-from-corp-standard.md)
- [ADR-0005: RPO/RTO](0005-rpo-rto.md)
- [ADR-0006: Rollback процедура](0006-rollback-procedure.md) — R2 остаётся read-only fallback ≥30 дней.
