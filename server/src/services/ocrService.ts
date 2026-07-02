import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { recognizeInvoiceStructured } from './openrouter.js';
import type { OcrParsedItem } from './openrouter.js';
import type { OcrProcessingRepository } from '../repositories/drizzle/ocr-processing.drizzle.js';
import { recordS3Result } from './observability/s3-error-rate.js';
import { createObservabilityLogger } from './observability/logger.js';

/** Логгер модуля с redaction (Iteration 7). */
const logger = createObservabilityLogger('ocr-service');

/* ------------------------------------------------------------------ */
/*  Константы                                                          */
/* ------------------------------------------------------------------ */

/** ID типа документа "Счет" */
const INVOICE_DOC_TYPE_ID = 'c3c0b242-8a0c-4e20-b9ad-363ebf462a5b';

/** Допуск при проверке суммы (quantity * price vs amount) */
const AMOUNT_TOLERANCE = 0.01;

/** Максимальное количество параллельных запросов к API */
const OCR_CONCURRENCY = 3;

/** Максимальное количество страниц PDF */
const MAX_PDF_PAGES = 20;

/* ------------------------------------------------------------------ */
/*  Типы                                                               */
/* ------------------------------------------------------------------ */

/** Прогресс распознавания */
export interface OcrProgress {
  stage: 'downloading' | 'rendering' | 'recognizing' | 'validating' | 'saving';
  fileIndex: number;
  totalFiles: number;
  pageIndex?: number;
  totalPages?: number;
}

/**
 * Зависимости сервиса (передаются извне, не привязан к Fastify).
 * Данные — через OcrProcessingRepository (Drizzle/Yandex PG), файлы — через S3.
 */
export interface OcrDependencies {
  ocrRepo: OcrProcessingRepository;
  s3Client: S3Client;
  s3Bucket: string;
}

/* ------------------------------------------------------------------ */
/*  Вспомогательные функции                                            */
/* ------------------------------------------------------------------ */

/** Скачивает файл из S3 как Buffer */
async function downloadS3File(
  s3Client: S3Client,
  bucket: string,
  fileKey: string,
): Promise<Buffer> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: fileKey });
  // Учёт исхода S3-операции для мониторинга error-rate (Iteration 7).
  let response;
  try {
    response = await s3Client.send(command);
    recordS3Result(true);
  } catch (err) {
    recordS3Result(false);
    throw err;
  }

  if (!response.Body) {
    throw new Error(`S3: пустое тело ответа для ${fileKey}`);
  }

  // Преобразуем поток в Buffer
  const stream = response.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/** Рендерит все страницы PDF в JPEG через poppler-utils (pdftoppm) */
async function renderPdfToJpegPages(
  pdfBuffer: Buffer,
): Promise<{ base64: string; pageNum: number }[]> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');

  const execFileAsync = promisify(execFile);

  // Сохраняем PDF во временный файл
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocr-'));
  const pdfPath = path.join(tmpDir, 'input.pdf');
  const outPrefix = path.join(tmpDir, 'page');

  try {
    await fs.writeFile(pdfPath, pdfBuffer);

    // pdftoppm рендерит PDF в JPEG с разрешением 200 DPI
    await execFileAsync('pdftoppm', [
      '-jpeg',
      '-jpegopt',
      'quality=85',
      '-r',
      '200',
      '-l',
      String(MAX_PDF_PAGES),
      pdfPath,
      outPrefix,
    ]);

    // Читаем результаты (файлы page-01.jpg, page-02.jpg, ...)
    const files = await fs.readdir(tmpDir);
    const jpegFiles = files.filter((f) => f.startsWith('page-') && f.endsWith('.jpg')).sort();

    const results: { base64: string; pageNum: number }[] = [];

    for (let i = 0; i < jpegFiles.length; i++) {
      const filePath = path.join(tmpDir, jpegFiles[i] as string);
      const jpegBuffer = await fs.readFile(filePath);
      const base64 = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;

      logger.info(
        { pageNum: i + 1, jpegSizeKb: Math.round(jpegBuffer.length / 1024) },
        'PDF страница отрендерена (poppler): JPEG %d КБ',
        Math.round(jpegBuffer.length / 1024),
      );

      results.push({ base64, pageNum: i + 1 });
    }

    return results;
  } finally {
    // Очистка временных файлов
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Конвертирует Buffer изображения в base64 data URL */
function imageBufferToBase64(buf: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buf.toString('base64')}`;
}

/** Проверяет расхождение суммы */
function validateAmounts(items: OcrParsedItem[]): OcrParsedItem[] {
  const mismatched: OcrParsedItem[] = [];
  for (const item of items) {
    if (item.quantity != null && item.price != null && item.amount != null) {
      const expected = item.quantity * item.price;
      if (Math.abs(expected - item.amount) > AMOUNT_TOLERANCE) {
        mismatched.push(item);
      }
    }
  }
  return mismatched;
}

/** Создает подсказку для повторного распознавания */
function buildRetryHint(mismatched: OcrParsedItem[]): string {
  const lines = mismatched.map(
    (item) =>
      `Строка "${item.name}": количество=${item.quantity}, цена=${item.price}, сумма=${item.amount}, ожидаемая сумма=${((item.quantity ?? 0) * (item.price ?? 0)).toFixed(2)}. Перепроверь значения.`,
  );
  return `В предыдущей попытке обнаружены расхождения quantity*price != amount для следующих строк:\n${lines.join('\n')}\nПерепроверь эти строки особенно внимательно.`;
}

/** Пул параллельных задач с ограничением concurrency */
async function promisePool<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length) as T[];
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      const task = tasks[idx];
      if (task) {
        results[idx] = await task();
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

/* ------------------------------------------------------------------ */
/*  Основная функция обработки                                         */
/* ------------------------------------------------------------------ */

/** Распознает все счета заявки */
export async function processPaymentRequestOcr(
  deps: OcrDependencies,
  paymentRequestId: string,
  onProgress?: (progress: OcrProgress) => void,
): Promise<void> {
  const { ocrRepo, s3Client, s3Bucket } = deps;

  const settings = await ocrRepo.getSettings();
  if (!settings.activeModelId) {
    throw new Error('Не выбрана модель OCR');
  }

  const activeModel = settings.models.find((m) => m.id === settings.activeModelId);

  // Получаем файлы-счета заявки (исключаем отклоненные)
  const files = await ocrRepo.getInvoiceFiles(paymentRequestId, INVOICE_DOC_TYPE_ID);

  const invoiceFiles = files.filter((f) => {
    const mime = f.mimeType ?? '';
    return mime.startsWith('image/') || mime === 'application/pdf';
  });

  if (invoiceFiles.length === 0) {
    logger.info({ paymentRequestId }, 'Нет файлов-счетов для распознавания');
    return;
  }

  // Удаляем старые распознанные данные
  await ocrRepo.deleteRecognizedMaterials(paymentRequestId);

  let globalPosition = 0;

  for (let fi = 0; fi < invoiceFiles.length; fi++) {
    const file = invoiceFiles[fi]!;
    const fileId = file.id;
    const fileKey = file.fileKey;
    const mimeType = file.mimeType ?? '';

    // Создаем запись в логе
    const logId = await ocrRepo.insertRecognitionLog({
      paymentRequestId,
      fileId,
      modelId: settings.activeModelId,
      status: 'processing',
    });

    try {
      onProgress?.({ stage: 'downloading', fileIndex: fi, totalFiles: invoiceFiles.length });

      // Скачиваем файл из S3
      const fileBuffer = await downloadS3File(s3Client, s3Bucket, fileKey);

      // Подготавливаем изображения для распознавания
      const imagesBase64: { base64: string; pageNum: number }[] = [];

      if (mimeType === 'application/pdf') {
        onProgress?.({
          stage: 'rendering',
          fileIndex: fi,
          totalFiles: invoiceFiles.length,
          pageIndex: 0,
          totalPages: 1,
        });

        // Рендерим PDF через poppler-utils (pdftoppm) — корректно рендерит шрифты
        const pdfPages = await renderPdfToJpegPages(fileBuffer);
        for (const page of pdfPages) {
          imagesBase64.push(page);
        }
      } else {
        // Изображение -- конвертируем напрямую
        const base64 = imageBufferToBase64(fileBuffer, mimeType);
        imagesBase64.push({ base64, pageNum: 1 });
      }

      let fileInputTokens = 0;
      let fileOutputTokens = 0;

      // Параллельное распознавание страниц с ограничением concurrency
      const pageResults = await promisePool(
        imagesBase64.map(({ base64, pageNum }, idx) => async () => {
          onProgress?.({
            stage: 'recognizing',
            fileIndex: fi,
            totalFiles: invoiceFiles.length,
            pageIndex: idx,
            totalPages: imagesBase64.length,
          });

          // Первая попытка
          let result = await recognizeInvoiceStructured(base64, settings.activeModelId);

          // Валидация
          const mismatched = validateAmounts(result.items);
          if (mismatched.length > 0 && result.items.length > 0) {
            // Повторная попытка с подсказкой
            const hint = buildRetryHint(mismatched);
            const retryResult = await recognizeInvoiceStructured(
              base64,
              settings.activeModelId,
              hint,
            );

            // Используем повторный результат если он лучше
            const retryMismatched = validateAmounts(retryResult.items);
            if (retryMismatched.length < mismatched.length) {
              result = retryResult;
            }

            // Записываем повторную попытку в лог
            await ocrRepo.insertRecognitionLog({
              paymentRequestId,
              fileId,
              modelId: settings.activeModelId,
              status: 'success',
              attemptNumber: 2,
              inputTokens: retryResult.inputTokens,
              outputTokens: retryResult.outputTokens,
              totalCost: activeModel
                ? retryResult.inputTokens * activeModel.inputPrice +
                  retryResult.outputTokens * activeModel.outputPrice
                : null,
              completedAt: new Date().toISOString(),
            });

            return {
              pageNum,
              result,
              retryTokens: { input: retryResult.inputTokens, output: retryResult.outputTokens },
            };
          }

          return { pageNum, result, retryTokens: null };
        }),
        OCR_CONCURRENCY,
      );

      onProgress?.({ stage: 'saving', fileIndex: fi, totalFiles: invoiceFiles.length });

      // Сохраняем результаты в порядке страниц
      for (const { pageNum, result, retryTokens } of pageResults) {
        fileInputTokens += result.inputTokens;
        fileOutputTokens += result.outputTokens;
        if (retryTokens) {
          fileInputTokens += retryTokens.input;
          fileOutputTokens += retryTokens.output;
        }

        logger.info(
          { paymentRequestId, fileId, pageNum, itemsCount: result.items.length },
          'Распознано позиций на странице: %d',
          result.items.length,
        );

        for (const item of result.items) {
          if (!item.name) continue;
          const materialId = await ocrRepo.findOrCreateMaterial(item.name, item.unit ?? null);
          globalPosition++;

          try {
            await ocrRepo.insertRecognizedMaterial({
              paymentRequestId,
              fileId,
              materialId,
              pageNumber: pageNum,
              position: globalPosition,
              article: item.article ?? null,
              quantity: item.quantity ?? null,
              price: item.price ?? null,
              amount: item.amount ?? null,
            });
          } catch (insertErr) {
            logger.error(
              {
                paymentRequestId,
                fileId,
                materialId,
                error: insertErr instanceof Error ? insertErr.message : String(insertErr),
              },
              'Ошибка сохранения распознанного материала',
            );
          }
        }
      }

      // Обновляем лог
      const totalCost = activeModel
        ? fileInputTokens * activeModel.inputPrice + fileOutputTokens * activeModel.outputPrice
        : null;

      await ocrRepo.updateRecognitionLog(logId, {
        status: 'success',
        inputTokens: fileInputTokens,
        outputTokens: fileOutputTokens,
        totalCost,
        completedAt: new Date().toISOString(),
      });

      logger.info(
        { paymentRequestId, fileId, inputTokens: fileInputTokens, outputTokens: fileOutputTokens },
        'Файл распознан успешно',
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Неизвестная ошибка OCR';

      await ocrRepo.updateRecognitionLog(logId, {
        status: 'error',
        errorMessage: errorMsg,
        completedAt: new Date().toISOString(),
      });

      logger.error({ paymentRequestId, fileId, error: errorMsg }, 'Ошибка OCR распознавания файла');
    }
  }
}
