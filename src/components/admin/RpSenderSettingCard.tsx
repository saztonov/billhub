import { useEffect, useMemo, useState } from 'react'
import { Card, Select, Button, Typography, Space, Alert, App } from 'antd'
import { SendOutlined } from '@ant-design/icons'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import { usePayHubCatalogStore } from '@/store/payhubCatalogStore'

const { Text, Paragraph } = Typography

/** Сохранённый отправитель РП (снимок контрагента PayHub) */
interface RpSender {
  contractorId: string
  name: string | null
  inn: string | null
}

/** Пословный поиск: каждое слово запроса должно найтись в "имя ИНН" опции. */
const filterContractorOption = (input: string, option?: { label?: unknown }) => {
  const haystack = String(option?.label ?? '').toLowerCase()
  return input
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

/**
 * Настройка «Отправитель РП»: контрагент PayHub, от имени которого создаются
 * распределительные письма (один для всех РП). Только для admin.
 */
const RpSenderSettingCard = () => {
  const { message } = App.useApp()
  const contractors = usePayHubCatalogStore((s) => s.contractors)
  const catalogConfigured = usePayHubCatalogStore((s) => s.configured)
  const catalogOk = usePayHubCatalogStore((s) => s.ok)
  const catalogLoading = usePayHubCatalogStore((s) => s.loading)
  const fetchCatalog = usePayHubCatalogStore((s) => s.fetchCatalog)

  const [saved, setSaved] = useState<RpSender | null>(null)
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchCatalog()
    ;(async () => {
      try {
        const data = await api.get<{ sender: RpSender | null }>('/api/payhub/rp-sender')
        setSaved(data.sender)
        setSelectedId(data.sender?.contractorId)
      } catch (err) {
        logError({
          errorType: 'api_error',
          errorMessage: `Ошибка загрузки отправителя РП: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}`,
          component: 'RpSenderSettingCard',
        })
      } finally {
        setLoading(false)
      }
    })()
  }, [fetchCatalog])

  // Опции каталога; сохранённый снимок подмешивается, если его нет в свежем каталоге.
  const options = useMemo(() => {
    const base = contractors.map((c) => ({
      value: c.id,
      label: `${c.name ?? c.id}${c.inn ? ` (ИНН ${c.inn})` : ''}`,
    }))
    if (saved && !contractors.some((c) => c.id === saved.contractorId)) {
      base.unshift({
        value: saved.contractorId,
        label: `${saved.name ?? saved.contractorId}${saved.inn ? ` (ИНН ${saved.inn})` : ''}`,
      })
    }
    return base
  }, [contractors, saved])

  const handleSave = async () => {
    setSaving(true)
    try {
      let sender: RpSender | null = null
      if (selectedId) {
        const fromCatalog = contractors.find((c) => c.id === selectedId)
        sender = fromCatalog
          ? { contractorId: fromCatalog.id, name: fromCatalog.name, inn: fromCatalog.inn }
          : saved && saved.contractorId === selectedId
            ? saved
            : { contractorId: selectedId, name: null, inn: null }
      }
      const data = await api.put<{ sender: RpSender | null }>('/api/payhub/rp-sender', { sender })
      setSaved(data.sender)
      message.success(data.sender ? 'Отправитель РП сохранён' : 'Отправитель РП очищен')
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: `Ошибка сохранения отправителя РП: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}`,
        component: 'RpSenderSettingCard',
      })
      message.error('Не удалось сохранить отправителя РП')
    } finally {
      setSaving(false)
    }
  }

  const unchanged = (saved?.contractorId ?? undefined) === selectedId

  return (
    <Card
      title={
        <Space>
          <SendOutlined />
          Отправитель РП
        </Space>
      }
      style={{ maxWidth: 720, marginTop: 16 }}
    >
      <Paragraph type="secondary" style={{ marginTop: 0 }}>
        Контрагент PayHub, от имени которого создаются распределительные письма (один для всех РП).
        Поиск — по названию или ИНН.
      </Paragraph>
      {!saved && !loading && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Отправитель не настроен — письма РП не будут создаваться в PayHub"
        />
      )}
      <Space.Compact style={{ width: '100%' }}>
        <Select
          style={{ flex: 1 }}
          showSearch
          allowClear
          loading={loading || catalogLoading}
          disabled={loading || (!catalogOk && options.length === 0)}
          placeholder={
            catalogConfigured || catalogLoading
              ? 'Выберите контрагента PayHub'
              : 'Интеграция PayHub не настроена'
          }
          value={selectedId}
          onChange={(v) => setSelectedId(v ?? undefined)}
          options={options}
          filterOption={filterContractorOption}
        />
        <Button
          type="primary"
          loading={saving}
          disabled={unchanged || loading}
          onClick={handleSave}
        >
          Сохранить
        </Button>
      </Space.Compact>
      {saved && (
        <Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
          Текущий: <Text strong>{saved.name ?? saved.contractorId}</Text>
          {saved.inn && <Text type="secondary"> (ИНН {saved.inn})</Text>}
        </Paragraph>
      )}
    </Card>
  )
}

export default RpSenderSettingCard
