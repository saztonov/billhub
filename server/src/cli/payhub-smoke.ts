/**
 * payhub-smoke — ручная проверка интеграции с внешним API PayHub против живого стенда.
 *
 * По умолчанию — только read-only сценарии (справочники + поиск писем).
 * Флаг `--write` дополнительно прогоняет write-сценарии: создание письма с ensure_share
 * (проверка share_url/QR), lookup по полученному reg_number, PATCH своего письма,
 * полный цикл вложения (presign -> PUT в S3 -> привязка -> список -> ссылка на скачивание).
 * Write-сценарии создают тестовое письмо в PayHub — запускать только против тестового стенда.
 *
 * Требуемые env: PAYHUB_BASE_URL, PAYHUB_API_TOKEN (см. server/.env.example).
 * Опционально: PAYHUB_SMOKE_PROJECT_ID — id проекта PayHub для write-сценариев
 * (по умолчанию берётся первый проект из справочника).
 *
 * Запуск: `npm --prefix server run payhub:smoke` (read-only)
 *         `npm --prefix server run payhub:smoke -- --write`
 * Exit 1 — если хотя бы один шаг завершился ошибкой.
 */
import { createPayHubClientFromEnv, type PayHubClient } from '../services/payhub/payhub-client.js';
import { PayHubApiError } from '../services/payhub/payhub-errors.js';

interface StepResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** Формат ошибки шага для вывода */
function describeError(error: unknown): string {
  if (error instanceof PayHubApiError) {
    return `${error.code} (HTTP ${error.status}): ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Выполняет шаг, печатает результат, копит вердикт */
async function runStep(
  results: StepResult[],
  name: string,
  fn: () => Promise<string>,
): Promise<boolean> {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`  OK   ${name}: ${detail}`);
    return true;
  } catch (error) {
    const detail = describeError(error);
    results.push({ name, ok: false, detail });
    console.error(`  FAIL ${name}: ${detail}`);
    return false;
  }
}

/** Read-only сценарии: справочники + поиск писем */
async function runReadScenarios(client: PayHubClient, results: StepResult[]): Promise<void> {
  await runStep(results, 'catalog/projects', async () => {
    const projects = await client.listProjects();
    return `${projects.length} проектов`;
  });
  await runStep(results, 'catalog/contractors', async () => {
    const contractors = await client.listContractors();
    return `${contractors.length} контрагентов`;
  });
  await runStep(results, 'catalog/letter-statuses', async () => {
    const statuses = await client.listLetterStatuses();
    return `${statuses.length} статусов`;
  });
  await runStep(results, 'letters (list)', async () => {
    const list = await client.listLetters({ limit: 5 });
    return `${list.letters.length} писем в выборке`;
  });
  await runStep(results, 'ping', async () => {
    const ping = await client.ping();
    return `${ping.latencyMs} мс`;
  });
}

/** Write-сценарии: письмо + share + lookup + PATCH + цикл вложения */
async function runWriteScenarios(client: PayHubClient, results: StepResult[]): Promise<void> {
  // Проект для тестового письма: PAYHUB_SMOKE_PROJECT_ID или первый из справочника
  let projectId = Number(process.env.PAYHUB_SMOKE_PROJECT_ID ?? '');
  if (!Number.isFinite(projectId) || projectId <= 0) {
    const projects = await client.listProjects();
    if (projects.length === 0) {
      console.error('  FAIL write: справочник проектов пуст — задайте PAYHUB_SMOKE_PROJECT_ID');
      results.push({ name: 'write:project', ok: false, detail: 'нет доступных проектов' });
      return;
    }
    projectId = projects[0]!.id;
  }

  const stamp = new Date().toISOString();
  const today = stamp.slice(0, 10);
  let letterId = '';
  let regNumber: string | null | undefined;

  const created = await runStep(results, 'letters (create + ensure_share)', async () => {
    const result = await client.createLetter({
      project_id: projectId,
      direction: 'outgoing',
      letter_date: today,
      number: `SMOKE-${stamp}`,
      subject: 'Smoke-тест интеграции BillHub',
      ensure_share: true,
    });
    letterId = result.letter.id;
    regNumber = result.letter.reg_number;
    if (!result.share?.share_url) throw new Error('в ответе нет share.share_url');
    if (!result.share.qr_svg && !result.share.qr_svg_data_url) {
      throw new Error('в ответе нет QR (qr_svg/qr_svg_data_url)');
    }
    return `id=${letterId}, reg_number=${regNumber ?? '—'}, share=${result.share.share_url}`;
  });
  if (!created) return;

  await runStep(results, 'letters/:id (get)', async () => {
    const letter = await client.getLetter(letterId);
    return `id=${letter.id}, direction=${letter.direction}`;
  });

  if (regNumber) {
    await runStep(results, 'letters/lookup (по reg_number)', async () => {
      const found = await client.lookupLetter({ reg_number: regNumber ?? undefined });
      if (found.letter.id !== letterId) throw new Error('lookup вернул другое письмо');
      return `найдено, share=${found.share?.share_url ?? '—'}`;
    });
  }

  await runStep(results, 'letters/:id (patch своего письма)', async () => {
    const updated = await client.updateLetter(letterId, {
      subject: 'Smoke-тест интеграции BillHub (обновлено)',
    });
    return `subject="${updated.subject ?? ''}"`;
  });

  await runStep(results, 'letters/:id/share (идемпотентно)', async () => {
    const share = await client.shareLetter(letterId);
    if (!share.share_url) throw new Error('в ответе нет share_url');
    return share.share_url;
  });

  let attachmentId = '';
  const uploaded = await runStep(results, 'attachments (presign -> PUT -> привязка)', async () => {
    const bytes = Buffer.from(`Smoke-тест вложения BillHub ${stamp}`, 'utf-8');
    const attachment = await client.uploadAttachment(letterId, {
      name: `smoke-${today}.txt`,
      bytes,
      mime_type: 'text/plain',
    });
    attachmentId = attachment.id;
    return `id=${attachmentId}, size=${bytes.byteLength} байт`;
  });
  if (!uploaded) return;

  await runStep(results, 'letters/:id/attachments (список)', async () => {
    const attachments = await client.listAttachments(letterId);
    if (!attachments.some((a) => a.id === attachmentId)) {
      throw new Error('загруженное вложение отсутствует в списке');
    }
    return `${attachments.length} вложений`;
  });

  await runStep(results, 'attachments/:id/download-url', async () => {
    const { url } = await client.getAttachmentDownloadUrl(attachmentId, 60);
    if (!url) throw new Error('в ответе нет url');
    return 'presigned-ссылка получена';
  });
}

async function main(): Promise<void> {
  const writeMode = process.argv.includes('--write');

  const client = createPayHubClientFromEnv();
  if (!client) {
    console.error('Интеграция PayHub не настроена: задайте PAYHUB_BASE_URL и PAYHUB_API_TOKEN');
    process.exit(1);
  }

  console.log(
    `PayHub smoke: ${client.baseUrl} (режим: ${writeMode ? 'read + write' : 'read-only'})`,
  );

  const results: StepResult[] = [];
  console.log('Read-only сценарии:');
  await runReadScenarios(client, results);

  if (writeMode) {
    console.log('Write-сценарии (создают тестовое письмо в PayHub):');
    await runWriteScenarios(client, results);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`Итого: ${results.length - failed.length}/${results.length} шагов успешно`);
  if (failed.length > 0) {
    console.error(`Провалено: ${failed.map((r) => r.name).join(', ')}`);
    process.exit(1);
  }
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
