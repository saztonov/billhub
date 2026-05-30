/**
 * Интеграционные тесты Drizzle-репозиториев на реальном PostgreSQL (testcontainers).
 *
 * Запуск: `RUN_INTEGRATION=1 npm test` или в CI (`CI=true`). Без Docker — пропускаются.
 *
 * Покрывают:
 *  - применение baseline + миграций 001-006 через собственный runner (без ошибок);
 *  - контракт DrizzleCounterpartyRepository (CRUD + ошибки) на живой БД;
 *  - smoke supplier/user репозиториев;
 *  - EQUIVALENCE: одинаковый набор операций на SupabaseRepository (fake) и DrizzleRepository
 *    (testcontainers) даёт идентичный наблюдаемый результат (без волатильных id/createdAt/token).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import { runMigrations } from '../../cli/migrate.js';
import { DrizzleCounterpartyRepository } from './counterparty.drizzle.js';
import { DrizzleSupplierRepository } from './supplier.drizzle.js';
import { DrizzleUserRepository } from './user.drizzle.js';
import { SupabaseCounterpartyRepository } from '../supabase/counterparty.supabase.js';
import { FakeSupabase } from '../../test/fake-supabase.js';
import { NotFoundError, UniqueConstraintError, ForeignKeyConstraintError } from '../types.js';
import type { Counterparty } from '../../schemas/counterparty.js';

const RUN = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';
const INN_A = '7710140679';
const INN_B = '5001007322';

describe.skipIf(!RUN)('Drizzle integration (testcontainers PostgreSQL)', () => {
  let container!: StartedPostgreSqlContainer;
  let sql!: postgres.Sql;
  let db!: PostgresJsDatabase<typeof schema>;

  beforeAll(async () => {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const url = container.getConnectionUri();
    // baseline + 001-006 должны примениться без ошибок (covers-through для 001-006).
    await runMigrations({ databaseUrl: url, logger: () => {} });
    sql = postgres(url, { max: 4, onnotice: () => {} });
    db = drizzle(sql, { schema });
  }, 180_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (container) await container.stop();
  });

  beforeEach(async () => {
    await sql`TRUNCATE TABLE counterparties, suppliers, users RESTART IDENTITY CASCADE`;
  });

  describe('применение схемы', () => {
    it('таблица _migrations содержит baseline и covered-миграции', async () => {
      const rows = await sql<
        { version: number }[]
      >`SELECT version FROM public._migrations ORDER BY version`;
      const versions = rows.map((r) => r.version);
      expect(versions).toContain(0);
      expect(versions).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6]));
    });

    it('SQL-функции из baseline доступны', async () => {
      const [r] = await sql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_proc WHERE proname = 'list_counterparties_with_sb'
        ) AS exists`;
      expect(r?.exists).toBe(true);
    });
  });

  describe('DrizzleCounterpartyRepository контракт', () => {
    const repo = () => new DrizzleCounterpartyRepository(db);

    it('create + getById', async () => {
      const c = await repo().create({ name: 'ООО Ромашка', inn: INN_A });
      expect(c.name).toBe('ООО Ромашка');
      expect((await repo().getById(c.id)).id).toBe(c.id);
    });

    it('getById несуществующего → NotFoundError', async () => {
      await expect(repo().getById('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('findById null; findByInn', async () => {
      await repo().create({ name: 'A', inn: INN_A });
      expect(await repo().findById('00000000-0000-0000-0000-000000000000')).toBeNull();
      expect((await repo().findByInn(INN_A))?.inn).toBe(INN_A);
      expect(await repo().findByInn(INN_B)).toBeNull();
    });

    it('create дубль ИНН → UniqueConstraintError', async () => {
      await repo().create({ name: 'A', inn: INN_A });
      await expect(repo().create({ name: 'B', inn: INN_A })).rejects.toBeInstanceOf(
        UniqueConstraintError,
      );
    });

    it('update меняет поля; update несуществующего → NotFoundError', async () => {
      const c = await repo().create({ name: 'A', inn: INN_A });
      const upd = await repo().update(c.id, { name: 'B' });
      expect(upd.name).toBe('B');
      expect(upd.inn).toBe(INN_A);
      await expect(
        repo().update('00000000-0000-0000-0000-000000000000', { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('update конфликт ИНН → UniqueConstraintError', async () => {
      const a = await repo().create({ name: 'A', inn: INN_A });
      await repo().create({ name: 'B', inn: INN_B });
      await expect(repo().update(a.id, { inn: INN_B })).rejects.toBeInstanceOf(
        UniqueConstraintError,
      );
    });

    it('delete; delete несуществующего → NotFoundError', async () => {
      const c = await repo().create({ name: 'A', inn: INN_A });
      await repo().delete(c.id);
      expect(await repo().findById(c.id)).toBeNull();
      await expect(repo().delete('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('list через RPC возвращает созданные с totalCount', async () => {
      await repo().create({ name: 'Альфа', inn: INN_A });
      await repo().create({ name: 'Бета', inn: INN_B });
      const res = await repo().list({ page: 1, pageSize: 10, sbFilter: 'all' });
      expect(res.totalCount).toBe(2);
      expect(res.items.length).toBe(2);
    });
  });

  describe('Drizzle supplier/user smoke', () => {
    it('supplier create/getById/update', async () => {
      const repo = new DrizzleSupplierRepository(db);
      const s = await repo.create({ name: 'Поставщик', inn: INN_A });
      expect((await repo.getById(s.id)).id).toBe(s.id);
      const upd = await repo.update(s.id, { foundingDocumentsComment: 'ок' });
      expect(upd.foundingDocumentsComment).toBe('ок');
    });

    it('user create/getById/list', async () => {
      const repo = new DrizzleUserRepository(db);
      const u = await repo.create({
        email: 'a@b.ru',
        password: 'password1',
        fullName: 'Иванов',
        role: 'admin',
      });
      expect((await repo.getById(u.id)).email).toBe('a@b.ru');
      const list = await repo.list({ page: 1, pageSize: 10, role: 'admin' });
      expect(list.totalCount).toBe(1);
    });
  });

  describe('EQUIVALENCE: Supabase (fake) ↔ Drizzle (testcontainers)', () => {
    function normalize(c: Counterparty) {
      return {
        name: c.name,
        inn: c.inn,
        address: c.address,
        alternativeNames: c.alternativeNames,
      };
    }

    it('идентичный набор CRUD-операций даёт идентичный наблюдаемый результат', async () => {
      const drizzleRepo = new DrizzleCounterpartyRepository(db);
      const fake = new FakeSupabase();
      const supaRepo = new SupabaseCounterpartyRepository(fake as unknown as SupabaseClient);

      // 1. create
      const dA = await drizzleRepo.create({ name: 'Альфа', inn: INN_A, address: 'Москва' });
      const sA = await supaRepo.create({ name: 'Альфа', inn: INN_A, address: 'Москва' });
      expect(normalize(dA)).toEqual(normalize(sA));

      // 2. getById
      expect(normalize(await drizzleRepo.getById(dA.id))).toEqual(
        normalize(await supaRepo.getById(sA.id)),
      );

      // 3. findByInn
      expect(normalize((await drizzleRepo.findByInn(INN_A))!)).toEqual(
        normalize((await supaRepo.findByInn(INN_A))!),
      );

      // 4. update
      expect(normalize(await drizzleRepo.update(dA.id, { name: 'Бета' }))).toEqual(
        normalize(await supaRepo.update(sA.id, { name: 'Бета' })),
      );

      // 5. create дубля → обе бросают UniqueConstraintError
      await expect(drizzleRepo.create({ name: 'X', inn: INN_A })).rejects.toBeInstanceOf(
        UniqueConstraintError,
      );
      await expect(supaRepo.create({ name: 'X', inn: INN_A })).rejects.toBeInstanceOf(
        UniqueConstraintError,
      );

      // 6. findById несуществующего → обе null
      const missing = '00000000-0000-0000-0000-000000000000';
      expect(await drizzleRepo.findById(missing)).toBeNull();
      expect(await supaRepo.findById(missing)).toBeNull();

      // 7. delete существующего → void у обеих; повторный delete → NotFoundError у обеих
      await drizzleRepo.delete(dA.id);
      await supaRepo.delete(sA.id);
      await expect(drizzleRepo.delete(dA.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(supaRepo.delete(sA.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // Явная проверка кода 23503 (FK RESTRICT) — supplier_security_checks.author_id -> users RESTRICT.
  describe('FK RESTRICT → ForeignKeyConstraintError', () => {
    it('удаление пользователя, на которого ссылается supplier_security_checks (RESTRICT)', async () => {
      const userRepo = new DrizzleUserRepository(db);
      const supplierRepo = new DrizzleSupplierRepository(db);
      const u = await userRepo.create({
        email: 'sb@b.ru',
        password: 'password1',
        fullName: 'СБ',
        role: 'security',
      });
      const s = await supplierRepo.create({ name: 'П', inn: INN_A });
      await sql`
        INSERT INTO supplier_security_checks (supplier_id, author_id, event_type)
        VALUES (${s.id}, ${u.id}, 'requested')`;
      await expect(userRepo.delete(u.id)).rejects.toBeInstanceOf(ForeignKeyConstraintError);
    });
  });
});
