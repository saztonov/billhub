import { useState, useEffect } from 'react'
import { Modal, Select, App } from 'antd'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import { exportRegistryToExcel } from '@/utils/exportRegistry'
import type { PaymentRequest, Supplier, ConstructionSite, Status } from '@/types'

interface ExportRegistryModalProps {
  open: boolean
  onClose: () => void
  requests: PaymentRequest[]
  suppliers: Supplier[]
  sites: ConstructionSite[]
  statuses: Status[]
  userId: string
  isShtabUser: boolean
}

/** Ответ API: привязка пользователя к объектам */
interface UserSiteMapping {
  construction_site_id: string
}

/** Ответ API: статус оплаты */
interface PaidStatus {
  id: string
  code: string
}

const ExportRegistryModal = (props: ExportRegistryModalProps) => {
  const { open, onClose, requests, suppliers, sites, statuses, userId, isShtabUser } = props
  const { message } = App.useApp()

  const [selectedSiteId, setSelectedSiteId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)

  // Для Штаб -- загрузить привязанные объекты и предвыбрать
  useEffect(() => {
    if (!open) return
    if (!isShtabUser) {
      setSelectedSiteId(undefined)
      return
    }

    const loadShtabSite = async () => {
      try {
        const data = await api.get<UserSiteMapping[]>(
          `/api/users/${userId}/construction-sites`,
        )

        if (data && data.length > 0) {
          setSelectedSiteId(data[0].construction_site_id)
        }
      } catch (err) {
        logError({
          errorType: 'api_error',
          errorMessage: err instanceof Error ? err.message : 'Ошибка загрузки объектов пользователя',
          errorStack: err instanceof Error ? err.stack : null,
          metadata: { action: 'loadShtabSiteForExport' },
        })
      }
    }

    loadShtabSite()
  }, [open, isShtabUser, userId])

  const handleOk = async () => {
    if (!selectedSiteId) {
      message.warning('Выберите объект')
      return
    }

    const site = sites.find(s => s.id === selectedSiteId)
    if (!site) return

    // Фильтруем заявки по выбранному объекту
    const siteRequests = requests.filter(r => r.siteId === selectedSiteId)

    // Собираем все статусы (payment_request + paid)
    const allStatuses = statuses.map(s => ({ id: s.id, code: s.code }))

    // Загружаем статусы оплаты для определения not_paid
    setLoading(true)
    try {
      const paidStatuses = await api.get<PaidStatus[]>(
        '/api/statuses', { entityType: 'paid' },
      )

      const combinedStatuses = [
        ...allStatuses,
        ...(paidStatuses ?? []).map((s) => ({
          id: s.id,
          code: s.code,
        })),
      ]

      await exportRegistryToExcel({
        requests: siteRequests,
        suppliers,
        siteName: site.name,
        statusApprovedCode: 'approved',
        statusNotPaidCode: 'not_paid',
        statuses: combinedStatuses,
      })

      setLoading(false)
      message.success('Реестр сохранен')
      onClose()
    } catch (err: unknown) {
      setLoading(false)
      logError({
        errorType: 'api_error',
        errorMessage: err instanceof Error ? err.message : 'Ошибка экспорта реестра',
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'exportRegistry' },
      })
      message.error('Ошибка при сохранении реестра')
    }
  }

  return (
    <Modal
      title="Сохранить реестр РП?"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="ОК"
      cancelText="Отмена"
      confirmLoading={loading}
      destroyOnClose
    >
      <div style={{ marginTop: 16 }}>
        <div style={{ marginBottom: 8, fontWeight: 500 }}>Объект</div>
        <Select
          value={selectedSiteId}
          onChange={setSelectedSiteId}
          placeholder="Выберите объект"
          style={{ width: '100%' }}
          disabled={isShtabUser}
          showSearch
          optionFilterProp="label"
          options={sites.map(s => ({ value: s.id, label: s.name }))}
        />
      </div>
    </Modal>
  )
}

export default ExportRegistryModal
