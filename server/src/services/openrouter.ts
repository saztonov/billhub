import pino from 'pino';
import { config } from '../config.js';

/** Логгер модуля */
const logger = pino({ name: 'openrouter' });

/* ------------------------------------------------------------------ */
/*  Константы                                                          */
/* ------------------------------------------------------------------ */

const CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODELS_URL = 'https://openrouter.ai/api/v1/models';

/** Максимальное количество повторных попыток при 429 */
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

/* ------------------------------------------------------------------ */
/*  Типы                                                               */
/* ------------------------------------------------------------------ */

/** Строка, распознанная OCR (из ответа LLM) */
export interface OcrParsedItem {
  article?: string;
  name: string;
  unit?: string;
  quantity?: number;
  price?: number;
  amount?: number;
}

/** Результат структурированного распознавания */
export interface OcrStructuredResult {
  items: OcrParsedItem[];
  inputTokens: number;
  outputTokens: number;
}

/** Модель OpenRouter */
export interface OpenRouterModel {
  id: string;
  name: string;
}

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface ModelsApiResponse {
  data: Array<{ id: string; name: string }>;
}

/* ------------------------------------------------------------------ */
/*  Системный промпт                                                   */
/* ------------------------------------------------------------------ */

const OCR_STRUCTURED_SYSTEM_PROMPT = [
  'Ты -- система OCR-распознавания счетов. Извлеки из изображения все строки спецификации.',
  'Для каждой строки извлеки: артикул (если есть), наименование материала, единицу измерения, количество, цену за единицу, сумму.',
  '',
  'Верни результат СТРОГО в формате JSON (без markdown-обрамления, без ```json```, только чистый JSON):',
  '{"items":[{"article":"...","name":"...","unit":"шт","quantity":10,"price":100.00,"amount":1000.00}]}',
  '',
  'Правила:',
  '- article: артикул/код товара, null если отсутствует',
  '- name: полное наименование материала/товара/услуги',
  '- unit: единица измерения (шт, м, кг, л, м2, м3 и т.д.)',
  '- quantity: количество (число)',
  '- price: цена за единицу (число)',
  '- amount: сумма по строке (число)',
  '- Если поле не удалось распознать -- укажи null',
  '- Не включай строки с итогами, НДС, скидками -- только позиции спецификации',
].join('\n');

/* ------------------------------------------------------------------ */
/*  Заголовки запросов                                                  */
/* ------------------------------------------------------------------ */

function getHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.openrouterApiKey}`,
    'HTTP-Referer': 'https://billhub.ru',
    'X-Title': 'BillHub',
  };
}

/* ------------------------------------------------------------------ */
/*  Fetch с retry при 429                                              */
/* ------------------------------------------------------------------ */

async function fetchWithRetry(url: string, options: RequestInit): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, options);

    if (response.status !== 429 || attempt === MAX_RETRIES) {
      return response;
    }

    lastError = new Error(`Rate limit (429) на попытке ${attempt + 1}`);
    const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
    logger.warn({ attempt: attempt + 1, delay }, 'Rate limit 429, повтор через %dмс', delay);
    await new Promise((r) => setTimeout(r, delay));
  }

  throw lastError;
}

/* ------------------------------------------------------------------ */
/*  Публичное API                                                      */
/* ------------------------------------------------------------------ */

/** Распознает счет и возвращает структурированный результат (JSON) */
export async function recognizeInvoiceStructured(
  imageBase64: string,
  modelId: string,
  hint?: string,
): Promise<OcrStructuredResult> {
  const imageUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`;

  const userText = hint
    ? `Распознай данные из этого счета. Обрати внимание: ${hint}`
    : 'Распознай данные из этого счета.';

  const body = {
    model: modelId,
    messages: [
      { role: 'system' as const, content: OCR_STRUCTURED_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: userText },
          { type: 'image_url' as const, image_url: { url: imageUrl } },
        ],
      },
    ],
  };

  const response = await fetchWithRetry(CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ошибка OpenRouter API (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenRouter API вернул пустой ответ');
  }

  // Извлекаем JSON из ответа (может быть обрамлен ```json...```)
  const jsonStr = content.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();

  logger.info({ rawContentLength: content.length, jsonStrLength: jsonStr.length }, 'Ответ OpenRouter получен');
  logger.debug({ rawContent: content.substring(0, 500) }, 'Содержимое ответа OpenRouter');

  let parsed: { items: OcrParsedItem[] };
  try {
    parsed = JSON.parse(jsonStr) as { items: OcrParsedItem[] };
  } catch (parseErr) {
    logger.error({ jsonStr: jsonStr.substring(0, 500), error: String(parseErr) }, 'Ошибка парсинга JSON ответа OpenRouter');
    throw new Error(`Не удалось распарсить JSON из ответа OpenRouter: ${String(parseErr)}`);
  }

  logger.info({ itemsCount: (parsed.items ?? []).length }, 'Распознано позиций из ответа');

  return {
    items: parsed.items ?? [],
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

/** Получает список доступных моделей из OpenRouter API */
export async function fetchAvailableModels(): Promise<OpenRouterModel[]> {
  const response = await fetch(MODELS_URL, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ошибка получения моделей OpenRouter (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as ModelsApiResponse;
  return data.data.map((model) => ({ id: model.id, name: model.name }));
}
