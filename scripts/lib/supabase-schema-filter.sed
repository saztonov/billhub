# =============================================================================
# supabase-schema-filter.sed — фильтр Supabase-специфики из raw pg_dump
# (sql/schema/schema.sql) при bootstrap чистой Yandex Managed PostgreSQL.
#
# ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ фильтра (план Iteration 6 «Финальная архитектура миграций»,
# принцип 6). Используется:
#   - scripts/bootstrap-schema.sh                 (production bootstrap: sed | psql)
#   - server/src/cli/bootstrap-filter.ts          (через filterSchemaViaSed на CI)
#   - bootstrap-schema.integration.test.ts        (dry-run на testcontainers PG)
#
# Запуск: sed -E -f scripts/lib/supabase-schema-filter.sed sql/schema/schema.sql
# Требуется GNU sed (Ubuntu LTS целевой VPS; \b и блоки {N;...} — GNU-расширения).
#
# Что НЕ трогаем: тела plpgsql-функций (в т.ч. change_user_password с auth.uid()/auth.users)
# создаются благодаря `SET check_function_bodies = false` в дампе; висящую функцию убирает
# миграция 0003_drop_supabase_auth_funcs.sql после bootstrap.
# =============================================================================

# psql-метакоманды \restrict / \unrestrict — не SQL, psql на Yandex их не поймёт через -f
# в составе одного потока корректно, а через postgres.js они вообще не команды.
/^\\(un)?restrict\b/d

# transaction_timeout — GUC появился в PostgreSQL 17. На более старых кластерах SET ломается.
/^SET transaction_timeout\b/d

# Сброс search_path в пустую строку (артефакт pg_dump). Дамп полностью квалифицирован public.*,
# сброс не нужен и мешает применению инкрементальных миграций в той же сессии.
/set_config\('search_path'/d

# Схема public уже существует в managed-кластере; CREATE SCHEMA public и COMMENT под неё
# падают (нет ownership у billhub_migration).
/^CREATE SCHEMA public;$/d
/^COMMENT ON SCHEMA public /d

# Прочие Supabase-схемы — на случай повторного pg_dump, включающего их объекты.
/^CREATE SCHEMA (IF NOT EXISTS )?(auth|storage|realtime|extensions|graphql|graphql_public|net|pgsodium|supabase_functions|supabase_migrations|vault|_realtime|_analytics)\b/d

# GRANT/REVOKE на Supabase-сервисных ролей (anon/authenticator/service_role/supabase_*/postgres).
/^(GRANT|REVOKE)\b.*\b(anon|authenticator|service_role|supabase_admin|supabase_auth_admin|supabase_storage_admin|dashboard_user|authenticated|postgres)\b/d

# CREATE EXTENSION — расширения включает администратор кластера ДО bootstrap (стандарт v3 §8).
/^CREATE EXTENSION\b/d
/^COMMENT ON EXTENSION\b/d

# FK public.users → auth.users: двухстрочный «ALTER TABLE ONLY public.users\n ADD CONSTRAINT
# ... REFERENCES auth.users(...)». При совпадении первой строки подтягиваем вторую (N) и, если
# это FK на auth.users, удаляем ОБЕ строки (иначе остался бы битый ALTER без действия).
/^ALTER TABLE ONLY public\.users$/{N;/REFERENCES auth\.users/d;}

# Страховка: одиночная строка с REFERENCES auth.users (если форматирование дампа изменится).
/REFERENCES auth\.users/d
