import { getEnvVar } from '@/utils/env'

const OPENROUTER_API_KEY = getEnvVar('VITE_OPENROUTER_API_KEY', 'VITE_TEST_OPENROUTER_API_KEY')
const CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODELS_URL = 'https://openrouter.ai/api/v1/models'

/** Системный промпт для OCR-распознавания счетов */
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

interface OpenRouterModel {
  id: string
  name: string
}

interface ModelsApiResponse {
  data: Array<{ id: string; name: string }>
}

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>
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

/** Распознаёт счёт по изображению через OpenRouter vision API */
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
