-- 0004_fix_storage_keys.sql — опциональная idempotent нормализация легаси-префиксов S3-ключей
-- (план Iteration 9; ADR-0004 «Object keys не меняются»).
--
-- НАЗНАЧЕНИЕ. По ADR-0004 ключи объектов в R2 и Cloud.ru идентичны — поля *.file_key в БД НЕ
-- трогаются, и эта миграция по умолчанию НИЧЕГО не делает (карта префиксов пуста → no-op).
-- Если обзор фактических ключей R2 в Iteration 9 выявит ИСТОРИЧЕСКИ ОТЛИЧАЮЩИЙСЯ префикс
-- (легаси из старой реализации), оператор заполняет карту `mappings` ниже — и тогда миграция
-- однократно переписывает затронутые ключи в каноническую схему buildFileKey
-- (server/src/routes/files.ts).
--
-- ПРИМЕНЕНИЕ. Запускается ПОСЛЕ dump-and-restore (scripts/dump-and-restore.sh, шаг 5), т.е. по
-- УЖЕ загруженным данным. Идемпотентна: повторный прогон не трогает ключи, уже приведённые к
-- новому префиксу (они больше не матчат старый префикс). Безопасна на пустой БД (0 строк).
-- Migration runner (server/src/cli/migrate.ts) тоже подхватывает её как версию 4; при bootstrap
-- по пустой БД эффект нулевой, фактический data-fix выполняет повторный явный прогон в шаге 5.
--
-- ВАЖНО: НЕ содержит top-level BEGIN/COMMIT — runner сам оборачивает миграцию в транзакцию
-- (PL/pgSQL BEGIN/END внутри DO $$ … $$ допустим).

DO $$
DECLARE
  -- Карта легаси-префиксов: пары [старый_префикс, новый_префикс].
  -- ПУСТАЯ по умолчанию (ADR-0004). Пример заполнения, если найден легаси-префикс 'uploads/':
  --   mappings := ARRAY[ ARRAY['uploads/', ''] ];
  mappings text[] := '{}';

  -- Таблицы и колонки, хранящие S3-ключи (migration-inventory §4).
  -- Несуществующие в конкретной схеме пары пропускаются (guard через to_regclass / columns).
  targets text[] := ARRAY[
    ARRAY['payment_request_files', 'file_key'],
    ARRAY['contract_request_files', 'file_key'],
    ARRAY['payment_payment_files', 'file_key'],
    ARRAY['approval_decision_files', 'file_key'],
    ARRAY['founding_document_files', 'file_key'],
    ARRAY['documents', 'file_key']
  ];

  t text[];
  m text[];
  affected bigint;
  total bigint := 0;
BEGIN
  IF array_length(mappings, 1) IS NULL THEN
    RAISE NOTICE '0004_fix_storage_keys: карта префиксов пуста — no-op (ADR-0004, ключи не меняются).';
    RETURN;
  END IF;

  FOREACH t SLICE 1 IN ARRAY targets LOOP
    -- Таблица существует?
    IF to_regclass('public.' || t[1]) IS NULL THEN
      CONTINUE;
    END IF;
    -- Колонка существует?
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t[1] AND column_name = t[2]
    ) THEN
      CONTINUE;
    END IF;

    FOREACH m SLICE 1 IN ARRAY mappings LOOP
      EXECUTE format(
        'UPDATE public.%I SET %I = %L || substring(%I FROM %s) WHERE %I LIKE %L',
        t[1], t[2], m[2], t[2], (length(m[1]) + 1)::text, t[2], m[1] || '%'
      );
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected > 0 THEN
        RAISE NOTICE '0004_fix_storage_keys: %.% префикс % → % : % строк', t[1], t[2], m[1], m[2], affected;
        total := total + affected;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE '0004_fix_storage_keys: всего обновлено ключей: %', total;
END $$;
