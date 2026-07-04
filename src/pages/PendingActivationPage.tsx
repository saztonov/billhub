import { Button, Result } from 'antd'
import { useAuthStore } from '@/store/authStore'

/**
 * Публичная страница «доступ ожидает активации». Пользователь зарегистрирован в Keycloak и
 * добавлен на портал, но админ ещё не активировал доступ (группа billhub-active). Сюда
 * редиректит callback после само-регистрации; выход гасит сессию Keycloak.
 */
const PendingActivationPage = () => {
  const logout = useAuthStore((s) => s.logout)

  return (
    <Result
      status="info"
      title="Доступ ожидает активации"
      subTitle="Ваша учётная запись создана и добавлена на портал. Доступ откроется после активации администратором — при необходимости свяжитесь с ним."
      extra={
        <Button onClick={() => void logout()} key="logout">
          Выйти
        </Button>
      }
    />
  )
}

export default PendingActivationPage
