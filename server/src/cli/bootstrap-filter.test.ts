/**
 * Unit-тесты sed-фильтра bootstrap-схемы (Iteration 8).
 *
 * Проверяют, что scripts/lib/supabase-schema-filter.sed, применённый к реальному
 * sql/schema/schema.sql, убирает Supabase-специфику и НЕ ломает прикладную схему.
 * Требует sed (GNU) — на платформах без sed тест помечается skip (Docker/CI запускают на Linux).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  hasSed,
  filterSchemaViaSed,
  SCHEMA_SQL_PATH,
  SED_FILTER_PATH,
} from './bootstrap-filter.js';

describe.skipIf(!hasSed())('bootstrap-filter: sed-фильтрация schema.sql', () => {
  const filtered = filterSchemaViaSed();
  const raw = readFileSync(SCHEMA_SQL_PATH, 'utf8');

  it('убирает psql-метакоманды \\restrict / \\unrestrict', () => {
    expect(raw).toMatch(/^\\restrict/m); // в исходнике есть
    expect(filtered).not.toMatch(/^\\restrict/m);
    expect(filtered).not.toMatch(/^\\unrestrict/m);
  });

  it('убирает SET transaction_timeout (совместимость с PG 16)', () => {
    expect(filtered).not.toMatch(/^SET transaction_timeout/m);
  });

  it("убирает сброс search_path (set_config('search_path'))", () => {
    expect(filtered).not.toMatch(/set_config\('search_path'/);
  });

  it('убирает CREATE SCHEMA public и COMMENT ON SCHEMA public', () => {
    expect(filtered).not.toMatch(/^CREATE SCHEMA public;$/m);
    expect(filtered).not.toMatch(/^COMMENT ON SCHEMA public /m);
  });

  it('удаляет FK users_id_fkey → auth.users (обе строки ALTER ... ADD CONSTRAINT)', () => {
    expect(raw).toMatch(/ADD CONSTRAINT users_id_fkey FOREIGN KEY \(id\) REFERENCES auth\.users/);
    expect(filtered).not.toMatch(/ADD CONSTRAINT users_id_fkey/);
    // Парного «осиротевшего» ALTER без действия остаться не должно.
    expect(filtered).not.toMatch(/ALTER TABLE ONLY public\.users\s*\n\s*\n/);
  });

  it('сохраняет легитимный FK users_counterparty_id_fkey → public.counterparties', () => {
    expect(filtered).toMatch(/ADD CONSTRAINT users_counterparty_id_fkey/);
    expect(filtered).toMatch(/REFERENCES public\.counterparties/);
  });

  it('сохраняет прикладную схему (таблицы users / payment_requests / counterparties)', () => {
    expect(filtered).toMatch(/CREATE TABLE public\.users/);
    expect(filtered).toMatch(/CREATE TABLE public\.payment_requests/);
    expect(filtered).toMatch(/CREATE TABLE public\.counterparties/);
  });

  it('оставшиеся auth.users — только в теле change_user_password (убирается миграцией 0003)', () => {
    // FK-строка удалена; остаются лишь обращения внутри тела функции (check_function_bodies=false).
    const occurrences = (filtered.match(/auth\.users/g) ?? []).length;
    expect(occurrences).toBeLessThanOrEqual(2);
    expect(filtered).toMatch(/change_user_password/);
  });

  it('sed-фильтр существует и не пуст', () => {
    const sed = readFileSync(SED_FILTER_PATH, 'utf8');
    expect(sed).toMatch(/supabase-schema-filter/);
  });
});
