import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  Card, Row, Col, Statistic, Switch, Select, Button,
  Space, Typography, Progress, App, Segmented, Tag, Flex,
} from 'antd'
import { PlayCircleOutlined, ApiOutlined, CloudOutlined, ReloadOutlined } from '@ant-design/icons'
import { useOcrStore } from '@/store/ocrStore'
import { useOcrQueueStore } from '@/store/ocrQueueStore'
import { api } from '@/services/api'
import { testS3Connection } from '@/services/s3'
import { logError } from '@/services/errorLogger'
import OcrModelsSection from '@/components/admin/OcrModelsSection'
import OcrLogSection from '@/components/admin/OcrLogSection'

const { Text } = Typography

/** Согласованная заявка для выбора */
interface ApprovedRequest {
  id: string
  requestNumber: string
  counterpartyName: string
  siteName: string
  invoiceAmount: number | null
  recognized: boolean
}

/** Описание этапа для Progress */
const STAGE_LABELS: Record<string, string> = {
  downloading: 'Загрузка файла...',
  recognizing: 'Распознавание...',
  validating: 'Валидация...',
  saving: 'Сохранение...',
}

/** Форматирование числа токенов */
const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

const OcrSettingsTab = () => {
  const { message } = App.useApp()
  const {
    autoEnabled, activeModelId, models, isLoadingSettings,
    tokenStats, fetchSettings, fetchLogs, fetchTokenStats,
    setAutoEnabled, setActiveModelId,
  } = useOcrStore()

  // Диагностика
  const [isTestingLlm, setIsTestingLlm] = useState(false)
  const [isTestingS3, setIsTestingS3] = useState(false)

  // Период статистики токенов
  const [statPeriod, setStatPeriod] = useState<string>('day')

  // Очередь OCR
  const queueTasks = useOcrQueueStore((s) => s.tasks)
  const enqueue = useOcrQueueStore((s) => s.enqueue)
  const retryTask = useOcrQueueStore((s) => s.retry)

  // Ручное распознавание
  const [approvedRequests, setApprovedRequests] = useState<ApprovedRequest[]>([])
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [loadingRequests, setLoadingRequests] = useState(false)

  // Данные очереди для UI
  const queueInfo = useMemo(() => {
    const all = Object.values(queueTasks)
    const processing = all.find((t) => t.status === 'processing') ?? null
    const pending = all.filter((t) => t.status === 'pending')
    const errors = all.filter((t) => t.status === 'error')
    const isSelectedProcessing = selectedRequestId
      ? queueTasks[selectedRequestId]?.status === 'processing'
      : false
    const isSelectedPending = selectedRequestId
      ? queueTasks[selectedRequestId]?.status === 'pending'
      : false
    return { processing, pending, errors, isSelectedProcessing, isSelectedPending, isQueueBusy: !!processing }
  }, [queueTasks, selectedRequestId])

  // Загрузка согласованных заявок
  const loadApprovedRequests = useCallback(async () => {
    setLoadingRequests(true)
    try {
      const data = await api.get<ApprovedRequest[]>('/api/ocr/approved-requests')
      setApprovedRequests(data ?? [])
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: `Ошибка загрузки заявок: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}`,
        component: 'OcrSettingsTab',
      })
    } finally {
      setLoadingRequests(false)
    }
  }, [])

  // Загрузка данных при монтировании
  useEffect(() => {
    fetchSettings()
    fetchLogs(1, 20)
    fetchTokenStats()
    loadApprovedRequests()
  }, [fetchSettings, fetchLogs, fetchTokenStats, loadApprovedRequests])

  // Запуск ручного распознавания через очередь
  const handleRecognize = () => {
    if (!selectedRequestId) return
    const req = approvedRequests.find((r) => r.id === selectedRequestId)
    enqueue(selectedRequestId, 'manual', req?.requestNumber)
    message.info('Заявка добавлена в очередь распознавания')
  }

  // Обновляем данные при завершении задачи в очереди
  useEffect(() => {
    const successCount = Object.values(queueTasks).filter((t) => t.status === 'success').length
    if (successCount > 0) {
      fetchLogs(1, 20)
      fetchTokenStats()
      loadApprovedRequests()
    }
  }, [queueTasks, fetchLogs, fetchTokenStats, loadApprovedRequests])

  const handleAutoToggle = async (checked: boolean) => {
    try {
      await setAutoEnabled(checked)
      message.success(checked ? 'Автораспознавание включено' : 'Автораспознавание выключено')
    } catch {
      message.error('Ошибка изменения настройки')
    }
  }

  const handleModelChange = async (modelId: string) => {
    try {
      await setActiveModelId(modelId)
      message.success('Активная модель обновлена')
    } catch {
      message.error('Ошибка обновления модели')
    }
  }

  // Проверка LLM-ключа
  const handleTestLlm = async () => {
    setIsTestingLlm(true)
    try {
      const result = await api.get<{ count: number }>('/api/ocr/test-llm')
      message.success(`OpenRouter API ключ работает. Доступно моделей: ${result?.count ?? 0}`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Неизвестная ошибка'
      message.error(`Ошибка проверки LLM ключа: ${errorMsg}`)
      logError({
        errorType: 'api_error',
        errorMessage: `Ошибка проверки LLM ключа: ${errorMsg}`,
        component: 'OcrSettingsTab',
      })
    } finally {
      setIsTestingLlm(false)
    }
  }

  // Проверка S3 хранилища
  const handleTestS3 = async () => {
    setIsTestingS3(true)
    try {
      const result = await testS3Connection()
      message.success(`S3 хранилище доступно. Провайдер: ${result.provider}`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Неизвестная ошибка'
      message.error(`Ошибка подключения к S3: ${errorMsg}`)
      logError({
        errorType: 'api_error',
        errorMessage: `Ошибка проверки S3: ${errorMsg}`,
        component: 'OcrSettingsTab',
      })
    } finally {
      setIsTestingS3(false)
    }
  }

  const currentStats = tokenStats[statPeriod]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, padding: '0 0 16px' }}>
      {/* Статистика токенов */}
      <Card size="small" loading={isLoadingSettings}>
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Segmented
            value={statPeriod}
            onChange={(val) => setStatPeriod(val as string)}
            options={[
              { label: 'День', value: 'day' },
              { label: 'Неделя', value: 'week' },
              { label: 'Месяц', value: 'month' },
              { label: 'Все время', value: 'all' },
            ]}
          />
          <Row gutter={24}>
            <Col>
              <Statistic title="Вх. токены" value={currentStats ? formatTokens(currentStats.inputTokens) : '—'} />
            </Col>
            <Col>
              <Statistic title="Исх. токены" value={currentStats ? formatTokens(currentStats.outputTokens) : '—'} />
            </Col>
            <Col>
              <Statistic title="Стоимость" value={currentStats ? `$${currentStats.totalCost.toFixed(4)}` : '—'} />
            </Col>
          </Row>
        </Space>
      </Card>

      {/* Настройки */}
      <Card size="small" title="Настройки OCR">
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space align="center">
            <Switch
              checked={autoEnabled}
              onChange={handleAutoToggle}
              loading={isLoadingSettings}
            />
            <Text>Автоматическое распознавание</Text>
          </Space>

          <Space direction="vertical" style={{ width: '100%' }}>
            <Text>Активная модель</Text>
            <Select
              style={{ width: 400, maxWidth: '100%' }}
              placeholder="Выберите модель"
              value={activeModelId || undefined}
              onChange={handleModelChange}
              options={models.map((m) => ({
                label: `${m.name} (${m.id})`,
                value: m.id,
              }))}
            />
          </Space>
        </Space>
      </Card>

      {/* Диагностика */}
      <Card size="small" title="Диагностика">
        <Space wrap>
          <Button
            icon={<ApiOutlined />}
            onClick={handleTestLlm}
            loading={isTestingLlm}
          >
            Проверить LLM-ключ
          </Button>
          <Button
            icon={<CloudOutlined />}
            onClick={handleTestS3}
            loading={isTestingS3}
          >
            Проверить S3 хранилище
          </Button>
        </Space>
      </Card>

      {/* Управление моделями */}
      <Card size="small" title="Модели OCR">
        <OcrModelsSection />
      </Card>

      {/* Ручное распознавание */}
      <Card size="small" title="Распознавание">
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap>
            <Select
              showSearch
              style={{ width: 500, maxWidth: '100%' }}
              placeholder="Выберите заявку..."
              value={selectedRequestId}
              onChange={setSelectedRequestId}
              filterOption={(input, option) => {
                const req = approvedRequests.find((r) => r.id === option?.value)
                if (!req) return false
                const searchStr = `${req.requestNumber} ${req.counterpartyName} ${req.siteName}`.toLowerCase()
                return searchStr.includes(input.toLowerCase())
              }}
              loading={loadingRequests}
              allowClear
              notFoundContent={loadingRequests ? 'Загрузка...' : 'Нет согласованных заявок'}
              optionLabelProp="label"
            >
              {approvedRequests.map((req) => (
                <Select.Option key={req.id} value={req.id} label={`${req.requestNumber} — ${req.counterpartyName}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <Text strong style={{ flexShrink: 0 }}>{req.requestNumber}</Text>
                    <Text ellipsis style={{ flex: 1, textAlign: 'left' }}>{req.siteName}</Text>
                    <Text type="secondary" style={{ flexShrink: 0 }}>
                      {req.invoiceAmount != null ? `${req.invoiceAmount.toLocaleString('ru-RU')} ₽` : ''}
                    </Text>
                    {req.recognized && <Text type="success" style={{ flexShrink: 0 }}>OCR</Text>}
                  </div>
                  <Text type="secondary" style={{ fontSize: 12 }}>{req.counterpartyName}</Text>
                </Select.Option>
              ))}
            </Select>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleRecognize}
              disabled={!selectedRequestId || queueInfo.isSelectedProcessing || queueInfo.isSelectedPending}
              loading={queueInfo.isSelectedProcessing}
            >
              Распознать
            </Button>
          </Space>

          {/* Прогресс текущей задачи */}
          {queueInfo.processing && (
            <div>
              <Flex align="center" gap={8}>
                <Tag color="processing">Обработка</Tag>
                <Text style={{ fontSize: 13 }}>
                  {queueInfo.processing.requestNumber || queueInfo.processing.paymentRequestId.slice(0, 8)}
                </Text>
              </Flex>
              {queueInfo.processing.progress && (
                <>
                  <Progress
                    percent={(() => {
                      const p = queueInfo.processing.progress
                      if (!p || p.totalFiles <= 0) return 0
                      const filePart = p.fileIndex / p.totalFiles
                      const pagePart = p.totalPages && p.pageIndex != null
                        ? (p.pageIndex / p.totalPages) / p.totalFiles
                        : 0
                      return Math.min(Math.round((filePart + pagePart) * 100), 99)
                    })()}
                    status="active"
                  />
                  <Text type="secondary">
                    {STAGE_LABELS[queueInfo.processing.progress.stage] ?? ''}{' '}
                    Файл {queueInfo.processing.progress.fileIndex + 1}/{queueInfo.processing.progress.totalFiles}
                    {queueInfo.processing.progress.totalPages
                      ? ` | Страница ${(queueInfo.processing.progress.pageIndex ?? 0) + 1}/${queueInfo.processing.progress.totalPages}`
                      : ''}
                  </Text>
                </>
              )}
            </div>
          )}

          {/* Очередь ожидания */}
          {queueInfo.pending.length > 0 && (
            <Text type="secondary">В очереди: {queueInfo.pending.length}</Text>
          )}

          {/* Ошибки */}
          {queueInfo.errors.map((task) => (
            <Flex key={task.paymentRequestId} align="center" gap={8} style={{ background: '#fff2f0', padding: '4px 8px', borderRadius: 4 }}>
              <Tag color="error">Ошибка</Tag>
              <Text style={{ fontSize: 12, flex: 1 }}>
                {task.requestNumber || task.paymentRequestId.slice(0, 8)}: {task.errorMessage}
              </Text>
              <Button
                type="link"
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => retryTask(task.paymentRequestId)}
              >
                Повторить
              </Button>
            </Flex>
          ))}
        </Space>
      </Card>

      {/* Лог распознавания */}
      <Card size="small" title="Лог распознавания">
        <OcrLogSection />
      </Card>
    </div>
    </div>
  )
}

export default OcrSettingsTab
