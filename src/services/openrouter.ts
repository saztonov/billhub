import { getEnvVar } from '@/utils/env'
import type { OcrParsedItem } from '@/types'

const OPENROUTER_API_KEY = getEnvVar('VITE_OPENROUTER_API_KEY', 'VITE_TEST_OPENROUTER_API_KEY')
const CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODELS_URL = 'https://openrouter.ai/api/v1/models'

/** Системный промпт для OCR-распознавания счетов (старый, текстовый формат) */
const OCR_SYSTEM_PROMPT = [
  'Ты — система OCR-распознавания счетов.',
  'Извлеки из изображения счёта следующие данные:',
  '- Номер счёта',
  '- Дата счёта',
  '- Поставщик (наименование, ИНН, КПП, адрес)',
  '- Позиции спецификации: наименование, количество, единица измерения, цена, сумма',
  '- Итого (общая сумма)',
  '',
  'Верни результат в структурированном текстовом формате.',
  'Если какое-то поле не удалось распознать — укажи "Не распознано".',
].join('\n')

/** Системный промпт для структурированного OCR (JSON) */
const OCR_STRUCTURED_SYSTEM_PROMPT = [
  'Ты — система OCR-распознавания счетов. Извлеки из изображения все строки спецификации.',
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
  '- Если поле не удалось распознать — укажи null',
  '- Не включай строки с итогами, НДС, скидками — только позиции спецификации',
].join('\n')

interface OpenRouterModel {
  id: string
  name: string
}

interface ModelsApiResponse {
  data: Array<{ id: string; name: string }>
}

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/** Результат структурированного распознавания */
export interface OcrStructuredResult {
  items: OcrParsedItem[]
  inputTokens: number
  outputTokens: number
}

/** Заголовки для запросов к OpenRouter API */
function getHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    'HTTP-Referer': window.location.origin,
    'X-Title': 'BillHub',
  }
}

/** Распознаёт счёт по изображению через OpenRouter vision API (текстовый формат) */
export async function recognizeInvoice(
  imageBase64: string,
  modelId: string,
): Promise<string> {
  const imageUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`

  const body = {
    model: modelId,
    messages: [
      { role: 'system' as const, content: OCR_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'Распознай данные из этого счёта.' },
          { type: 'image_url' as const, image_url: { url: imageUrl } },
        ],
      },
    ],
  }

  const response = await fetch(CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Ошибка OpenRouter API (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as ChatCompletionResponse
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('OpenRouter API вернул пустой ответ')
  }

  return content
}

/** Распознаёт счёт и возвращает структурированный результат (JSON) */
export async function recognizeInvoiceStructured(
  imageBase64: string,
  modelId: string,
  hint?: string,
): Promise<OcrStructuredResult> {
  const imageUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`

  const userText = hint
    ? `Распознай данные из этого счёта. Обрати внимание: ${hint}`
    : 'Распознай данные из этого счёта.'

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
  }

  const response = await fetch(CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Ошибка OpenRouter API (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as ChatCompletionResponse
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('OpenRouter API вернул пустой ответ')
  }

  // Извлекаем JSON из ответа (может быть обрамлён ```json...```)
  const jsonStr = content.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
  const parsed = JSON.parse(jsonStr) as { items: OcrParsedItem[] }

  return {
    items: parsed.items ?? [],
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  }
}

/** Получает список доступных моделей из OpenRouter API */
export async function fetchAvailableModels(): Promise<OpenRouterModel[]> {
  const response = await fetch(MODELS_URL, {
    method: 'GET',
    headers: getHeaders(),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Ошибка получения моделей OpenRouter (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as ModelsApiResponse
  return data.data.map((model) => ({ id: model.id, name: model.name }))
}
