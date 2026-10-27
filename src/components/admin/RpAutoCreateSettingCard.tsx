import { useEffect, useState } from 'react'
import { Card, Switch, Typography, Space, App } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'

const { Paragraph, Text } = Typography

/**
 * Настройка «Автосоздание РП»: при согласовании заявки на этапе «РП» в реестре создаётся РП,
 * а письмо PayHub со всеми файлами заявки, договора и учредительными документами уходит
 * в очередь синхронизации. Только для admin.
 */
const RpAutoCreateSettingCard = () => {
  const { message } = App.useApp()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const data = await api.get<{ enabled: boolean }>('/api/payhub/rp-auto-create')
        setEnabled(data.enabled)
      } catch (err) {
        logError({
          errorType: 'api_error',
          errorMessage: `Ошибка загрузки настройки автосоздания РП: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}`,
          component: 'RpAutoCreateSettingCard',
        })
      }
    })()
  }, [])

  const handleChange = async (value: boolean) => {
    setSaving(true)
    try {
      const data = await api.put<{ enabled: boolean }>('/api/payhub/rp-auto-create', {
        enabled: value,
      })
      setEnabled(data.enabled)
      message.success(data.enabled ? 'Автосоздание РП включено' : 'Автосоздание РП выключено')
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: `Ошибка сохранения настройки автосоздания РП: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}`,
        component: 'RpAutoCreateSettingCard',
      })
      message.error('Не удалось сохранить настройку')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card
      title={
        <Space>
          <ThunderboltOutlined />
          Автосоздание РП
        </Space>
      }
      style={{ maxWidth: 720, marginTop: 16 }}
    >
      <Paragraph type="secondary" style={{ marginTop: 0 }}>
        При согласовании заявки на этапе «РП» в реестре автоматически создаётся РП, а в PayHub —
        письмо со всеми файлами заявки (кроме зачёркнутых), договора и учредительными документами
        поставщика.
      </Paragraph>
      <Space>
        <Switch
          checked={enabled ?? false}
          loading={enabled === null || saving}
          disabled={enabled === null}
          onChange={handleChange}
        />
        <Text>{enabled ? 'Включено' : 'Выключено'}</Text>
      </Space>
    </Card>
  )
}

export default RpAutoCreateSettingCard
