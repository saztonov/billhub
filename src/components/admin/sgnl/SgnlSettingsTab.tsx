import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Popconfirm,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd'
import { ApiOutlined, CloudUploadOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import type { SgnlStatus, SgnlSyncReport } from '@/types/sgnl'
import SgnlReportView from './SgnlReportView'
import SgnlErrorsTable from './SgnlErrorsTable'

const { Text, Paragraph } = Typography

/** Вкладка администрирования: выгрузка счетов заявок на оплату в SIGNAL DOCS */
const SgnlSettingsTab = () => {
  const { message } = App.useApp()
  const [status, setStatus] = useState<SgnlStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [siteId, setSiteId] = useState<string | undefined>(undefined)
  const [preview, setPreview] = useState<SgnlSyncReport | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [runLoading, setRunLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const { sites, fetchSites } = useConstructionSiteStore()
  useEffect(() => {
    fetchSites()
  }, [fetchSites])

  const siteOptions = useMemo(
    () =>
      sites
        .filter((s) => s.sgnlProjectId)
        .map((s) => ({
          value: s.id,
          label: `${s.name} → ${s.sgnlProjectName ?? s.sgnlProjectId}`,
        })),
    [sites],
  )

  const loadStatus = useCallback(
    async (showResult = false) => {
      setLoading(true)
      try {
        const data = await api.get<SgnlStatus>('/api/sgnl/status')
        setStatus(data)
        if (showResult) {
          if (!data.configured) message.warning('Интеграция SIGNAL не настроена')
          else if (data.ok) message.success(`SIGNAL доступен (${data.latencyMs} мс)`)
          else message.error(`SIGNAL недоступен: ${data.error?.message ?? 'ошибка'}`)
        }
      } catch (err) {
        setStatus(null)
        logError({
          errorType: 'api_error',
          errorMessage: `Ошибка проверки SIGNAL: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}`,
          component: 'SgnlSettingsTab',
        })
        if (showResult) message.error('Не удалось получить статус SIGNAL')
      } finally {
        setLoading(false)
      }
    },
    [message],
  )

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const handlePreview = async () => {
    setPreviewLoading(true)
    try {
      const report = await api.post<SgnlSyncReport>('/api/sgnl/preview', siteId ? { siteId } : {})
      setPreview(report)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Предпросмотр не удался')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleRun = async () => {
    setRunLoading(true)
    try {
      await api.post('/api/sgnl/run', siteId ? { siteId } : {})
      message.success('Выгрузка поставлена в очередь. Итог появится в «Последний прогон».')
      setRefreshKey((k) => k + 1)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Не удалось запустить выгрузку')
    } finally {
      setRunLoading(false)
    }
  }

  const counts = status?.stats.counts
  const canRun = !!status?.configured && status.enabled && !!status.writeAccess?.ok

  return (
    <Space direction="vertical" size={16} style={{ width: '100%', overflow: 'auto' }}>
      <Card
        title={
          <Space>
            <ApiOutlined />
            Выгрузка счетов в SIGNAL DOCS
          </Space>
        }
        extra={
          <Button
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => {
              loadStatus(true)
              setRefreshKey((k) => k + 1)
            }}
          >
            Обновить
          </Button>
        }
        style={{ maxWidth: 960 }}
      >
        <Paragraph type="secondary">
          Счета из заявок на оплату (кроме отклонённых и отозванных) выгружаются в проект SIGNAL
          объекта по пути «12. Снабжение / Счета / Поставщик». Проект объекта выбирается в
          справочнике объектов строительства.
        </Paragraph>
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
                <Text type="danger">{status.error?.message ?? 'ошибка'}</Text>
              )}
            </Descriptions.Item>
          )}
          {status?.configured && status.ok && (
            <Descriptions.Item label="Права на загрузку">
              {status.writeAccess?.ok ? (
                <Tag color="green">есть</Tag>
              ) : (
                <Text type="danger">
                  нет — {status.writeAccess?.error?.message ?? 'ошибка'} (нужен scope
                  docs:version:create)
                </Text>
              )}
            </Descriptions.Item>
          )}
          <Descriptions.Item label="Выгрузка">
            {status?.enabled ? <Tag color="green">включена</Tag> : <Tag>выключена</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="Расписание">
            {status?.cron ? (
              <Text code>{status.cron}</Text>
            ) : (
              <Text type="secondary">только вручную</Text>
            )}
          </Descriptions.Item>
          {counts && (
            <Descriptions.Item label="Журнал">
              <Space wrap>
                <Tag color="green">выгружено: {counts.done}</Tag>
                <Tag color={counts.failed > 0 ? 'red' : 'default'}>ошибок: {counts.failed}</Tag>
                <Tag>в процессе: {counts.pending}</Tag>
                {status?.stats.lastExportedAt && (
                  <Text type="secondary">
                    последняя выгрузка:{' '}
                    {new Date(status.stats.lastExportedAt).toLocaleString('ru-RU')}
                  </Text>
                )}
              </Space>
            </Descriptions.Item>
          )}
        </Descriptions>

        {status !== null && !status.configured && (
          <Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
            Для подключения задайте переменные бэкенда <Text code>SGNL_CLIENT_ID</Text> и{' '}
            <Text code>SGNL_CLIENT_SECRET</Text> (интеграция в настройках компании HUB), включите{' '}
            <Text code>SGNL_SYNC_ENABLED=true</Text> и пересоздайте контейнеры api и worker.
          </Paragraph>
        )}

        <Space wrap style={{ marginTop: 16 }}>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Все сопоставленные объекты"
            style={{ minWidth: 320 }}
            options={siteOptions}
            value={siteId}
            onChange={setSiteId}
          />
          <Button
            icon={<EyeOutlined />}
            loading={previewLoading}
            disabled={!status?.configured}
            onClick={handlePreview}
          >
            Предпросмотр
          </Button>
          <Popconfirm
            title="Запустить выгрузку в SIGNAL?"
            description={siteId ? 'Только выбранный объект' : 'Все сопоставленные объекты'}
            onConfirm={handleRun}
            disabled={!canRun}
          >
            <Button
              type="primary"
              icon={<CloudUploadOutlined />}
              loading={runLoading}
              disabled={!canRun}
            >
              Выгрузить сейчас
            </Button>
          </Popconfirm>
        </Space>
      </Card>

      {preview && (
        <Card title="Предпросмотр" style={{ maxWidth: 1200 }}>
          <SgnlReportView report={preview} />
        </Card>
      )}

      <Card title="Последний прогон" style={{ maxWidth: 1200 }}>
        {status?.lastRun ? (
          <SgnlReportView report={status.lastRun} />
        ) : (
          <Alert type="info" showIcon message="Выгрузка ещё не запускалась" />
        )}
      </Card>

      <div style={{ maxWidth: 1200 }}>
        <SgnlErrorsTable refreshKey={refreshKey} />
      </div>
    </Space>
  )
}

export default SgnlSettingsTab
