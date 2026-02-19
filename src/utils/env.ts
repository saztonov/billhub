// Определяем активную среду: test | production (по умолчанию production)
const APP_ENV = (import.meta.env.VITE_APP_ENV as string) || 'production'
const isTest = APP_ENV === 'test'

/** Возвращает значение переменной окружения в зависимости от VITE_APP_ENV */
export function getEnvVar(prodKey: string, testKey: string): string {
  if (isTest) {
    return (import.meta.env[testKey] as string) || (import.meta.env[prodKey] as string) || ''
  }
  return (import.meta.env[prodKey] as string) || ''
}

export { isTest, APP_ENV }
