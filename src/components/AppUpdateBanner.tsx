import { useState } from 'react'
import { Button } from 'antd'
import { useVersionCheck } from '@/hooks/useVersionCheck'

/**
 * Глобальный баннер «доступна новая версия». Показывается, когда вкладка
 * работает на устаревшем бандле. «Отменить» скрывает баннер локально (до
 * перезагрузки/ремонта), при следующем расхождении версий он появится снова.
 */
const AppUpdateBanner = () => {
  const { updateAvailable } = useVersionCheck()
  const [dismissed, setDismissed] = useState(false)
  if (!updateAvailable || dismissed) return null

  return (
    <div className="app-update-banner" role="status">
      <span className="app-update-banner__text">Доступна новая версия приложения</span>
      <div className="app-update-banner__actions">
        <Button type="primary" onClick={() => window.location.reload()}>
          Обновить
        </Button>
        <Button onClick={() => setDismissed(true)}>Отменить</Button>
      </div>
    </div>
  )
}

export default AppUpdateBanner
