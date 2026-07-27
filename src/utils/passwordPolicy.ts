/**
 * Политика паролей на фронте. Минимальная длина совпадает с серверной MIN_PASSWORD_LENGTH
 * (server/src/services/auth/password.service.ts) и JSON-схемами auth-роутов — иначе короткий
 * пароль проходит клиентскую валидацию, но отклоняется сервером (400).
 */
export const MIN_PASSWORD_LENGTH = 8

/** Правило Ant Design для проверки минимальной длины пароля в формах. */
export const minPasswordLengthRule = {
  min: MIN_PASSWORD_LENGTH,
  message: `Минимум ${MIN_PASSWORD_LENGTH} символов`,
}
