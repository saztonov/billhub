import { describe, it, expect } from 'vitest';
import { resolveDbProvider } from './repositories.js';

describe('resolveDbProvider', () => {
  it('по умолчанию (без env) → supabase', () => {
    expect(resolveDbProvider({} as NodeJS.ProcessEnv)).toBe('supabase');
  });

  it('DB_PROVIDER=drizzle в dev → drizzle', () => {
    expect(
      resolveDbProvider({ NODE_ENV: 'development', DB_PROVIDER: 'drizzle' } as NodeJS.ProcessEnv),
    ).toBe('drizzle');
  });

  it('DB_PROVIDER=supabase в test → supabase', () => {
    expect(
      resolveDbProvider({ NODE_ENV: 'test', DB_PROVIDER: 'supabase' } as NodeJS.ProcessEnv),
    ).toBe('supabase');
  });

  it('недопустимое значение DB_PROVIDER падает с понятной ошибкой', () => {
    expect(() => resolveDbProvider({ DB_PROVIDER: 'mysql' } as NodeJS.ProcessEnv)).toThrow(
      /Недопустимое значение DB_PROVIDER/,
    );
  });

  it('production + DB_PROVIDER=supabase падает (startup-инвариант)', () => {
    expect(() =>
      resolveDbProvider({ NODE_ENV: 'production', DB_PROVIDER: 'supabase' } as NodeJS.ProcessEnv),
    ).toThrow(/В production обязателен DB_PROVIDER=drizzle/);
  });

  it('production без DB_PROVIDER падает (default=supabase запрещён в prod)', () => {
    expect(() => resolveDbProvider({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(
      /В production обязателен DB_PROVIDER=drizzle/,
    );
  });

  it('production + DB_PROVIDER=drizzle проходит', () => {
    expect(
      resolveDbProvider({ NODE_ENV: 'production', DB_PROVIDER: 'drizzle' } as NodeJS.ProcessEnv),
    ).toBe('drizzle');
  });
});
