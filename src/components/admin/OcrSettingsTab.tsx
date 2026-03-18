import { useEffect, useState, useCallback } from 'react'
import {
  Card, Row, Col, Statistic, Switch, Select, Button,
  Space, Typography, Progress, App, Segmented,
} from 'antd'
import { PlayCircleOutlined } from '@ant-design/icons'
import { useOcrStore } from '@/store/ocrStore'
import { supabase } from '@/services/supabase'
import { processPaymentRequestOcr } from '@/services/ocrService'
import type { OcrProgress } from '@/services/ocrService'
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

  // Период статистики токенов
  const [statPeriod, setStatPeriod] = useState<string>('day')

  // Ручное распознавание
  const [approvedRequests, setApprovedRequests] = useState<ApprovedRequest[]>([])
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [isRecognizing, setIsRecognizing] = useState(false)
  const [progressPercent, setProgressPercent] = useState(0)
  const [progressText, setProgressText] = useState('')
  const [loadingRequests, setLoadingRequests] = useState(false)

  // Загрузка согласованных заявок
  const loadApprovedRequests = useCallback(async () => {
    setLoadingRequests(true)
    try {
      // Согласованные заявки
      const { data, error } = await supabase
        .from('payment_requests')
        .select('id, request_number, invoice_amount, counterparties(name), construction_sites(name), statuses!payment_requests_status_id_fkey(code)')
        .not('approved_at', 'is', null)
        .eq('is_deleted', false)
        .order('approved_at', { ascending: false })
        .limit(200)
      if (error) throw error

      // Получаем id заявок, у которых уже есть распознанные материалы
      const ids = (data ?? []).map((r: Record<string, unknown>) => r.id as string)
      const { data: recognizedData } = await supabase
        .from('recognized_materials')
        .select('payment_request_id')
        .in('payment_request_id', ids.length > 0 ? ids : ['__none__'])

      const recognizedSet = new Set(
        (recognizedData ?? []).map((r: Record<string, unknown>) => r.payment_request_id as string),
      )

      const requests: ApprovedRequest[] = (data ?? []).map((row: Record<string, unknown>) => {
        const cp = row.counterparties as Record<string, unknown> | null
        const site = row.construction_sites as Record<string, unknown> | null
        return {
          id: row.id as string,
          requestNumber: row.request_number as string,
          counterpartyName: (cp?.name as string) ?? '',
          siteName: (site?.name as string) ?? '',
          invoiceAmount: row.invoice_amount as number | null,
          recognized: recognizedSet.has(row.id as string),
        }
      })

      setApprovedRequests(requests)
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

  // Обработчик прогресса OCR
  const handleProgress = useCallback((progress: OcrProgress) => {
    const { stage, fileIndex, totalFiles, pageIndex, totalPages } = progress
    const stageLabel = STAGE_LABELS[stage] ?? stage

    let percent = 0
    if (totalFiles > 0) {
      const fileProgress = fileIndex / totalFiles
      const pageProgress = totalPages && pageIndex != null
        ? (pageIndex / totalPages) / totalFiles
        : 0
      percent = Math.round((fileProgress + pageProgress) * 100)
    }

    setProgressPercent(Math.min(percent, 99))
    setProgressText(
      `${stageLabel} Файл ${fileIndex + 1}/${totalFiles}` +
      (totalPages ? ` | Страница ${(pageIndex ?? 0) + 1}/${totalPages}` : ''),
    )
  }, [])

  // Запуск ручного распознавания
  const handleRecognize = async () => {
    if (!selectedRequestId) return

    setIsRecognizing(true)
    setProgressPercent(0)
    setProgressText('Подготовка...')

    try {
      await processPaymentRequestOcr(selectedRequestId, handleProgress)
      setProgressPercent(100)
      setProgressText('Готово')
      message.success('Распознавание завершено')
      // Обновить логи, статистику и список заявок
      fetchLogs(1, 20)
      fetchTokenStats()
      loadApprovedRequests()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Неизвестная ошибка'
      message.error(`Ошибка распознавания: ${errorMsg}`)
      logError({
        errorType: 'api_error',
        errorMessage: `Ошибка ручного OCR: ${errorMsg}`,
        component: 'OcrSettingsTab',
      })
    } finally {
      setIsRecognizing(false)
    }
  }

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

      {/* Управление моделями */}
      <Card size="small" title="Модели OCR">
        <OcrModelsSection />
      </Card>

      {/* Ручное распознавание */}
      <Card size="small" title="Ручное распознавание">
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
              disabled={!selectedRequestId || isRecognizing}
              loading={isRecognizing}
            >
              Распознать
            </Button>
          </Space>

          {isRecognizing && (
            <div>
              <Progress percent={progressPercent} status="active" />
              <Text type="secondary">{progressText}</Text>
            </div>
          )}
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
