/**
 * Snapshot-тест pino-redaction (план Iteration 7, §7, GATE): набор payload с секретами/ПДн
 * → в сериализованном логе НЕТ plain-значений (заменены на [Redacted]).
 */
import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { REDACT_PATHS, SENSITIVE_KEYS } from './logger.js';

/** pino-логгер, пишущий строки в массив (для grep по сериализованному выводу). */
function capturingLogger(): { logger: pino.Logger; lines: string[] } {
  const lines: string[] = [];
  const dest = {
    write(chunk: string): boolean {
      lines.push(chunk);
      return true;
    },
  };
  const logger = pino({ redact: { paths: REDACT_PATHS, censor: '[Redacted]' } }, dest);
  return { logger, lines };
}

describe('pino redaction', () => {
  it('SENSITIVE_KEYS покрывают требуемые поля плана §7', () => {
    for (const key of [
      'password',
      'token',
      'refresh_token',
      'presigned_url',
      'ocr_response',
      'recognized_text',
      'material_name',
    ]) {
      expect(SENSITIVE_KEYS).toContain(key);
    }
  });

  it('plain-значения секретов/ПДн отсутствуют в сериализованном логе (top-level)', () => {
    const { logger, lines } = capturingLogger();
    logger.info(
      {
        password: 'SENTINEL_password',
        currentPassword: 'SENTINEL_curpw',
        newPassword: 'SENTINEL_newpw',
        token: 'SENTINEL_token',
        refresh_token: 'SENTINEL_refresh',
        access_token: 'SENTINEL_access',
        presigned_url: 'https://SENTINEL_presigned',
        ocr_response: 'SENTINEL_ocr',
        recognized_text: 'SENTINEL_rectext',
        material_name: 'SENTINEL_material',
        rawContent: 'SENTINEL_rawcontent',
        jsonStr: 'SENTINEL_jsonstr',
      },
      'sensitive top-level',
    );
    const out = lines.join('\n');
    for (const sentinel of [
      'SENTINEL_password',
      'SENTINEL_curpw',
      'SENTINEL_newpw',
      'SENTINEL_token',
      'SENTINEL_refresh',
      'SENTINEL_access',
      'SENTINEL_presigned',
      'SENTINEL_ocr',
      'SENTINEL_rectext',
      'SENTINEL_material',
      'SENTINEL_rawcontent',
      'SENTINEL_jsonstr',
    ]) {
      expect(out).not.toContain(sentinel);
    }
    expect(out).toContain('[Redacted]');
  });

  it('секреты/ПДн на один уровень вложенности тоже скрыты', () => {
    const { logger, lines } = capturingLogger();
    logger.info(
      { result: { recognized_text: 'NESTED_rectext', material_name: 'NESTED_material' } },
      'sensitive nested',
    );
    const out = lines.join('\n');
    expect(out).not.toContain('NESTED_rectext');
    expect(out).not.toContain('NESTED_material');
  });
});
