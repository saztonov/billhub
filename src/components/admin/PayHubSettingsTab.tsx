import { useEffect, useState, useCallback } from 'react'
import { Card, Descriptions, Tag, Button, Typography, Space, App } from 'antd'
import { ReloadOutlined, ApiOutlined } from '@ant-design/icons'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import RpSenderSettingCard from '@/components/admin/RpSenderSettingCard'

const { Text, Paragraph } = Typography

/** Ответ GET /api/payhub/status */
interface PayHubStatus {
  configured: boolean
  ok: boolean
  baseUrl?: string
  latencyMs?: number
  error?: {
    code: string
    httpStatus?: number
    message: string
  }
}

/** Вкладка администрирования: статус интеграции с PayHub */
const PayHubSettingsTab = () => {
  const { message } = App.useApp()
  const [status, setStatus] = useState<PayHubStatus | null>(null)
  const [loading, setLoading] = useState(false)

  const checkStatus = useCallback(
    async (showResult = false) => {
      setLoading(true)
      try {
        const data = await api.get<PayHubStatus>('/api/payhub/status')
        setStatus(data)
        if (showResult) {
          if (!data.configured) message.warning('Интеграция PayHub не настроена')
          else if (data.ok) message.success(`PayHub доступен (${data.latencyMs} мс)`)
          else message.error(`PayHub недоступен: ${data.error?.code ?? 'ошибка'}`)
        }
      } catch (err) {
        setStatus(null)
        logError({
          errorType: 'api_error',
          errorMessage: `Ошибка проверки PayHub: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}`,
          component: 'PayHubSettingsTab',
        })
        if (showResult) message.error('Не удалось выполнить проверку подключения')
      } finally {
        setLoading(false)
      }
    },
    [message],
  )

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  return (
    <>
      <Card
        title={
          <Space>
            <ApiOutlined />
            Интеграция PayHub
          </Space>
        }
        extra={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => checkStatus(true)}>
            Проверить подключение
          </Button>
        }
        style={{ maxWidth: 720 }}
      >
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="Настройка">
            {status === null ? (
              <Tag>нет данных</Tag>
            ) : status.configured ? (
              <Tag color="green">настроено</Tag>
            ) : (
              <Tag>не настроено</Tag>
            )}
          </Descriptions.Item>
          {status?.baseUrl && (
            <Descriptions.Item label="Базовый URL">
              <Text code>{status.baseUrl}</Text>
            </Descriptions.Item>
          )}
          {status?.configured && (
            <Descriptions.Item label="Доступность">
              {status.ok ? (
                <Space>
                  <Tag color="green">доступно</Tag>
                  {status.latencyMs !== undefined && (
                    <Text type="secondary">{status.latencyMs} мс</Text>
                  )}
                </Space>
              ) : (
                <Space direction="vertical" size={4}>
                  <Tag color="red">ошибка</Tag>
                  {status.error && (
                    <Text type="danger">
                      {status.error.code}
                      {status.error.httpStatus !== undefined &&
                        ` (HTTP ${status.error.httpStatus})`}
                      {': '}
                      {status.error.message}
                    </Text>
                  )}
                </Space>
              )}
            </Descriptions.Item>
          )}
        </Descriptions>

        {status !== null && !status.configured && (
          <Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
            Для подключения задайте переменные окружения бэкенда <Text code>PAYHUB_BASE_URL</Text> и{' '}
            <Text code>PAYHUB_API_TOKEN</Text> (токен выпускается в PayHub: Администрирование →
            API-ключи), затем пересоздайте контейнер API.
          </Paragraph>
        )}
      </Card>
      <RpSenderSettingCard />
    </>
  )
}

export default PayHubSettingsTab
