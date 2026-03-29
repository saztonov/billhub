/** Конвертация строки snake_case в camelCase */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/** Рекурсивная конвертация ключей объекта из snake_case в camelCase */
export function toCamelCase<T>(data: unknown): T {
  if (data === null || data === undefined) return data as T;

  if (Array.isArray(data)) {
    return data.map((item) => toCamelCase(item)) as T;
  }

  if (typeof data === 'object' && !(data instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const camelKey = snakeToCamel(key);
      result[camelKey] = toCamelCase(value);
    }
    return result as T;
  }

  return data as T;
}
