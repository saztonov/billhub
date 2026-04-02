import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Readable } from 'node:stream';
import pino from 'pino';
import { recognizeInvoiceStructured } from './openrouter.js';
import type { OcrParsedItem } from './openrouter.js';

/** Логгер модуля */
const logger = pino({ name: 'ocr-service' });

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

/** Разрешение рендеринга (пикселей по большей стороне) */
const RENDER_MAX_DIM = 2048;

/* ------------------------------------------------------------------ */
/*  Типы                                                               */
/* ------------------------------------------------------------------ */

/** Настройки OCR-модели */
interface OcrModelSetting {
  id: string;
  name: string;
  inputPrice: number;
  outputPrice: number;
}

/** Прогресс распознавания */
export interface OcrProgress {
  stage: 'downloading' | 'rendering' | 'recognizing' | 'validating' | 'saving';
  fileIndex: number;
  totalFiles: number;
  pageIndex?: number;
  totalPages?: number;
}

/** Зависимости сервиса (передаются извне, не привязан к Fastify) */
export interface OcrDependencies {
  supabase: SupabaseClient;
  s3Client: S3Client;
  s3Bucket: string;
}

/* ------------------------------------------------------------------ */
/*  Вспомогательные функции                                            */
/* ------------------------------------------------------------------ */

/** Загрузка настроек OCR из БД */
async function loadOcrSettings(supabase: SupabaseClient): Promise<{
  autoEnabled: boolean;
  activeModelId: string;
  models: OcrModelSetting[];
}> {
  const { data, error } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['ocr_auto_enabled', 'ocr_active_model_id', 'ocr_models']);
  if (error) throw error;

  const settings: Record<string, unknown> = {};
  for (const row of data ?? []) {
    settings[row.key as string] = row.value;
  }

  const autoVal = settings['ocr_auto_enabled'] as { enabled?: boolean } | undefined;
  const modelVal = settings['ocr_active_model_id'] as { modelId?: string } | undefined;
  const modelsVal = settings['ocr_models'] as { models?: OcrModelSetting[] } | undefined;

  return {
    autoEnabled: autoVal?.enabled ?? false,
    activeModelId: modelVal?.modelId ?? '',
    models: modelsVal?.models ?? [],
  };
}

/** Скачивает файл из S3 как Buffer */
async function downloadS3File(
  s3Client: S3Client,
  bucket: string,
  fileKey: string,
): Promise<Buffer> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: fileKey });
  const response = await s3Client.send(command);

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

/** Фабрика canvas для pdfjs-dist v4 на базе node-canvas (класс-конструктор) */
let NodeCanvasFactoryClass: new () => object;

async function getNodeCanvasFactory(): Promise<new () => object> {
  if (NodeCanvasFactoryClass) return NodeCanvasFactoryClass;

  const { createCanvas } = await import('canvas');

  NodeCanvasFactoryClass = class {
    create(width: number, height: number) {
      const canvas = createCanvas(width, height);
      const context = canvas.getContext('2d');
      return { canvas, context };
    }
    reset(canvasAndContext: { canvas: { width: number; height: number } }, width: number, height: number) {
      canvasAndContext.canvas.width = width;
      canvasAndContext.canvas.height = height;
    }
    destroy(canvasAndContext: { canvas: { width: number; height: number } }) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
    }
  };

  return NodeCanvasFactoryClass;
}

/** Рендерит страницу PDF в base64 JPEG через pdfjs-dist + node-canvas */
async function renderPdfPageToBase64(
  pdfBuffer: Buffer,
  pageNum: number,
): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = await import('canvas');
  const CanvasFactory = await getNodeCanvasFactory();

  // Копируем данные в новый ArrayBuffer — pdfjs-dist может detach исходный
  const dataCopy = new Uint8Array(pdfBuffer.byteLength);
  dataCopy.set(new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength));
  const pdfDoc = await pdfjsLib.getDocument({
    data: dataCopy,
    useSystemFonts: true,
    CanvasFactory,
  }).promise;

  try {
    const page = await pdfDoc.getPage(pageNum);

    // Масштаб для получения ~2048px по большей стороне
    const viewport = page.getViewport({ scale: 1 });
    const maxDim = Math.max(viewport.width, viewport.height);
    const scale = Math.min(RENDER_MAX_DIM / maxDim, 2);
    const scaledViewport = page.getViewport({ scale });

    const canvas = createCanvas(
      Math.floor(scaledViewport.width),
      Math.floor(scaledViewport.height),
    );
    const ctx = canvas.getContext('2d');

    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport: scaledViewport,
    }).promise;

    const jpegBuffer = canvas.toBuffer('image/jpeg', { quality: 0.85 });
    const base64 = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;

    logger.info(
      { pageNum, canvasWidth: canvas.width, canvasHeight: canvas.height, jpegSizeKb: Math.round(jpegBuffer.length / 1024) },
      'PDF страница отрендерена: %dx%d, JPEG %d КБ',
      canvas.width, canvas.height, Math.round(jpegBuffer.length / 1024),
    );

    // Очистка памяти
    page.cleanup();

    return base64;
  } finally {
    await pdfDoc.destroy();
  }
}

/** Получает количество страниц в PDF */
async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Копируем данные в новый ArrayBuffer — pdfjs-dist может detach исходный
  const dataCopy = new Uint8Array(pdfBuffer.byteLength);
  dataCopy.set(new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength));
  const pdfDoc = await pdfjsLib.getDocument({ data: dataCopy }).promise;
  const count = pdfDoc.numPages;
  await pdfDoc.destroy();
  return count;
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
  const lines = mismatched.map((item) =>
    `Строка "${item.name}": количество=${item.quantity}, цена=${item.price}, сумма=${item.amount}, ожидаемая сумма=${((item.quantity ?? 0) * (item.price ?? 0)).toFixed(2)}. Перепроверь значения.`,
  );
  return `В предыдущей попытке обнаружены расхождения quantity*price != amount для следующих строк:\n${lines.join('\n')}\nПерепроверь эти строки особенно внимательно.`;
}

/** Ищет или создает запись в справочнике материалов */
async function findOrCreateMaterial(
  supabase: SupabaseClient,
  name: string,
  unit: string | null,
): Promise<string> {
  let query = supabase
    .from('materials_dictionary')
    .select('id')
    .eq('name', name);

  if (unit) {
    query = query.eq('unit', unit);
  } else {
    query = query.is('unit', null);
  }

  const { data } = await query.limit(1);
  if (data && data.length > 0) {
    return (data[0] as Record<string, unknown>).id as string;
  }

  // Создание
  const insertData: Record<string, unknown> = { name };
  if (unit) insertData.unit = unit;

  const { data: newData, error } = await supabase
    .from('materials_dictionary')
    .insert(insertData)
    .select('id')
    .single();

  if (error) {
    // Возможна гонка -- пробуем еще раз найти
    const { data: retryData } = await query.limit(1);
    if (retryData && retryData.length > 0) {
      return (retryData[0] as Record<string, unknown>).id as string;
    }
    throw error;
  }

  return (newData as Record<string, unknown>).id as string;
}

/** Пул параллельных задач с ограничением concurrency */
async function promisePool<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
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

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => runWorker(),
  );
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
  const { supabase, s3Client, s3Bucket } = deps;

  const settings = await loadOcrSettings(supabase);
  if (!settings.activeModelId) {
    throw new Error('Не выбрана модель OCR');
  }

  const activeModel = settings.models.find((m) => m.id === settings.activeModelId);

  // Получаем файлы-счета заявки (исключаем отклоненные)
  const { data: files, error: filesError } = await supabase
    .from('payment_request_files')
    .select('id, file_key, file_name, mime_type')
    .eq('payment_request_id', paymentRequestId)
    .eq('document_type_id', INVOICE_DOC_TYPE_ID)
    .eq('is_rejected', false);
  if (filesError) throw filesError;

  const invoiceFiles = (files ?? []).filter((f: Record<string, unknown>) => {
    const mime = (f.mime_type as string) ?? '';
    return mime.startsWith('image/') || mime === 'application/pdf';
  });

  if (invoiceFiles.length === 0) {
    logger.info({ paymentRequestId }, 'Нет файлов-счетов для распознавания');
    return;
  }

  // Удаляем старые распознанные данные
  await supabase
    .from('recognized_materials')
    .delete()
    .eq('payment_request_id', paymentRequestId);

  let globalPosition = 0;

  for (let fi = 0; fi < invoiceFiles.length; fi++) {
    const file = invoiceFiles[fi] as Record<string, unknown>;
    const fileId = file.id as string;
    const fileKey = file.file_key as string;
    const mimeType = (file.mime_type as string) ?? '';

    // Создаем запись в логе
    const { data: logData, error: logInsertError } = await supabase
      .from('ocr_recognition_log')
      .insert({
        payment_request_id: paymentRequestId,
        file_id: fileId,
        model_id: settings.activeModelId,
        status: 'processing',
      })
      .select('id')
      .single();
    if (logInsertError) throw logInsertError;
    const logId = (logData as Record<string, unknown>).id as string;

    try {
      onProgress?.({ stage: 'downloading', fileIndex: fi, totalFiles: invoiceFiles.length });

      // Скачиваем файл из S3
      const fileBuffer = await downloadS3File(s3Client, s3Bucket, fileKey);

      // Подготавливаем изображения для распознавания
      const imagesBase64: { base64: string; pageNum: number }[] = [];

      if (mimeType === 'application/pdf') {
        const totalPages = await getPdfPageCount(fileBuffer);
        const maxPages = Math.min(totalPages, MAX_PDF_PAGES);

        // Рендерим страницы по одной для экономии памяти
        for (let p = 1; p <= maxPages; p++) {
          onProgress?.({
            stage: 'rendering',
            fileIndex: fi,
            totalFiles: invoiceFiles.length,
            pageIndex: p - 1,
            totalPages: maxPages,
          });

          const base64 = await renderPdfPageToBase64(fileBuffer, p);
          imagesBase64.push({ base64, pageNum: p });

          // DEBUG: сохраняем отрендеренную страницу в S3 для визуальной проверки
          try {
            const rawB64 = base64.replace(/^data:image\/jpeg;base64,/, '');
            const debugBuf = Buffer.from(rawB64, 'base64');
            await s3Client.send(new PutObjectCommand({
              Bucket: s3Bucket,
              Key: `_debug_ocr/page_${p}.jpg`,
              Body: debugBuf,
              ContentType: 'image/jpeg',
            }));
            logger.info({ page: p }, 'DEBUG: страница сохранена в S3 _debug_ocr/page_%d.jpg', p);
          } catch (debugErr) {
            logger.warn({ error: String(debugErr) }, 'DEBUG: не удалось сохранить страницу в S3');
          }
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
            await supabase.from('ocr_recognition_log').insert({
              payment_request_id: paymentRequestId,
              file_id: fileId,
              model_id: settings.activeModelId,
              status: 'success',
              attempt_number: 2,
              input_tokens: retryResult.inputTokens,
              output_tokens: retryResult.outputTokens,
              total_cost: activeModel
                ? retryResult.inputTokens * activeModel.inputPrice +
                  retryResult.outputTokens * activeModel.outputPrice
                : null,
              completed_at: new Date().toISOString(),
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
          const materialId = await findOrCreateMaterial(supabase, item.name, item.unit ?? null);
          globalPosition++;

          const { error: insertErr } = await supabase.from('recognized_materials').insert({
            payment_request_id: paymentRequestId,
            file_id: fileId,
            material_id: materialId,
            page_number: pageNum,
            position: globalPosition,
            article: item.article ?? null,
            quantity: item.quantity ?? null,
            price: item.price ?? null,
            amount: item.amount ?? null,
          });

          if (insertErr) {
            logger.error(
              { paymentRequestId, fileId, materialId, error: insertErr.message },
              'Ошибка сохранения распознанного материала',
            );
          }
        }
      }

      // Обновляем лог
      const totalCost = activeModel
        ? fileInputTokens * activeModel.inputPrice + fileOutputTokens * activeModel.outputPrice
        : null;

      await supabase
        .from('ocr_recognition_log')
        .update({
          status: 'success',
          input_tokens: fileInputTokens,
          output_tokens: fileOutputTokens,
          total_cost: totalCost,
          completed_at: new Date().toISOString(),
        })
        .eq('id', logId);

      logger.info(
        { paymentRequestId, fileId, inputTokens: fileInputTokens, outputTokens: fileOutputTokens },
        'Файл распознан успешно',
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Неизвестная ошибка OCR';

      await supabase
        .from('ocr_recognition_log')
        .update({
          status: 'error',
          error_message: errorMsg,
          completed_at: new Date().toISOString(),
        })
        .eq('id', logId);

      logger.error(
        { paymentRequestId, fileId, error: errorMsg },
        'Ошибка OCR распознавания файла',
      );
    }
  }
}
