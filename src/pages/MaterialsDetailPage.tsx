import { useEffect, useMemo, useState, useCallback } from 'react'
import { Typography, Table, Button, InputNumber, Descriptions, Drawer, Space, Splitter, Select, message } from 'antd'
import { ArrowLeftOutlined, FileSearchOutlined, EyeInvisibleOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useParams, useNavigate } from 'react-router-dom'
import { useMaterialsStore } from '@/store/materialsStore'
import { useAuthStore } from '@/store/authStore'
import { useTableScrollY } from '@/hooks/useTableScrollY'
import { useInvoiceSyncViewer } from '@/hooks/useInvoiceSyncViewer'
import { supabase } from '@/services/supabase'
import { getDownloadUrl } from '@/services/s3'
import { formatDate } from '@/utils/requestFormatters'
import { logError } from '@/services/errorLogger'
import InvoiceViewer from '@/components/materials/InvoiceViewer'
import { useCostTypeStore } from '@/store/costTypeStore'
import type { RecognizedMaterial } from '@/types'

const { Title } = Typography

/** Информация о заявке для шапки */
interface RequestInfo {
  requestNumber: string
  counterpartyName: string
  supplierName: string
  siteName: string
  approvedAt: string | null
  costTypeId: string | null
  costTypeName: string | null
}

/** Форматирование суммы */
const fmtAmount = (v: number | null | undefined): string => {
  if (v == null) return '—'
  return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Breakpoint для переключения на Drawer (мобильные) */
const MOBILE_BREAKPOINT = 768

const MaterialsDetailPage = () => {
  const { paymentRequestId } = useParams<{ paymentRequestId: string }>()
  const navigate = useNavigate()

  const {
    materials,
    isLoadingMaterials,
    invoiceFiles,
    fetchMaterials,
    fetchInvoiceFiles,
    updateEstimateQuantity,
  } = useMaterialsStore()

  const user = useAuthStore((s) => s.user)
  const { costTypes, fetchCostTypes } = useCostTypeStore()
  const [requestInfo, setRequestInfo] = useState<RequestInfo | null>(null)
  const [isLoadingInfo, setIsLoadingInfo] = useState(false)
  const [splitViewOpen, setSplitViewOpen] = useState(false)
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(window.innerWidth < MOBILE_BREAKPOINT)

  // Хук синхронизации скана
  const {
    urls,
    isLoading: isLoadingUrls,
    currentFileId,
    currentPage,
    syncToMaterial,
    setCurrentFileId,
  } = useInvoiceSyncViewer(invoiceFiles, splitViewOpen)

  /** Открыть файлы счета в новой вкладке (средняя кнопка мыши) */
  const handleOpenInNewTab = useCallback(async () => {
    if (invoiceFiles.length === 0) return
    try {
      const url = await getDownloadUrl(invoiceFiles[0].fileKey)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: `Не удалось открыть файл в новой вкладке`,
        errorStack: err instanceof Error ? err.stack : null,
        component: 'MaterialsDetailPage',
      })
    }
  }, [invoiceFiles])

  const { containerRef, scrollY } = useTableScrollY([materials, splitViewOpen])

  // Отслеживание ширины экрана
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Проверка прав на редактирование поля «Кол-во смета»
  const canEditEstimate = useMemo(() => {
    if (!user) return false
    if (user.role === 'admin') return true
    if (user.department === 'smetny') return true
    return false
  }, [user])

  // Загрузка данных
  useEffect(() => {
    if (!paymentRequestId) return
    fetchMaterials(paymentRequestId)
    fetchInvoiceFiles(paymentRequestId)
    fetchCostTypes()
  }, [paymentRequestId, fetchMaterials, fetchInvoiceFiles, fetchCostTypes])

  // Загрузка информации о заявке
  useEffect(() => {
    if (!paymentRequestId) return
    let cancelled = false

    const load = async () => {
      setIsLoadingInfo(true)
      try {
        const { data, error } = await supabase
          .from('payment_requests')
          .select('request_number, approved_at, cost_type_id, counterparties(name), suppliers(name), construction_sites(name), cost_types(name)')
          .eq('id', paymentRequestId)
          .single()
        if (error) throw error
        if (cancelled) return

        const row = data as Record<string, unknown>
        const cp = row.counterparties as Record<string, unknown> | null
        const sup = row.suppliers as Record<string, unknown> | null
        const site = row.construction_sites as Record<string, unknown> | null
        const ct = row.cost_types as Record<string, unknown> | null

        setRequestInfo({
          requestNumber: row.request_number as string,
          counterpartyName: (cp?.name as string) ?? '—',
          supplierName: (sup?.name as string) ?? '—',
          siteName: (site?.name as string) ?? '—',
          approvedAt: row.approved_at as string | null,
          costTypeId: (row.cost_type_id as string) ?? null,
          costTypeName: (ct?.name as string) ?? null,
        })
      } catch (err) {
        logError({
          errorType: 'api_error',
          errorMessage: 'Не удалось загрузить информацию о заявке',
          errorStack: err instanceof Error ? err.stack : null,
          component: 'MaterialsDetailPage',
        })
      } finally {
        if (!cancelled) setIsLoadingInfo(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [paymentRequestId])

  // Обработчик изменения вида затрат
  const handleCostTypeChange = useCallback(
    async (val: string | undefined) => {
      if (!paymentRequestId) return
      try {
        const { error } = await supabase
          .from('payment_requests')
          .update({ cost_type_id: val ?? null })
          .eq('id', paymentRequestId)
        if (error) throw error
        const name = val ? costTypes.find((ct) => ct.id === val)?.name ?? null : null
        setRequestInfo((prev) => prev ? { ...prev, costTypeId: val ?? null, costTypeName: name } : prev)
        message.success('Вид затрат обновлён')
      } catch {
        message.error('Ошибка обновления вида затрат')
      }
    },
    [paymentRequestId, costTypes],
  )

  // Обработчик изменения «Кол-во смета»
  const handleEstimateChange = useCallback(
    (id: string, value: number | null) => {
      updateEstimateQuantity(id, value)
    },
    [updateEstimateQuantity],
  )

  // Обработчик клика по строке таблицы (синхронизация со сканом)
  const handleRowClick = useCallback(
    (record: RecognizedMaterial) => {
      setSelectedRowId(record.id)
      if (splitViewOpen) {
        syncToMaterial(record.fileId, record.pageNumber)
      }
    },
    [splitViewOpen, syncToMaterial],
  )

  // Обработчик открытия/закрытия просмотра
  const handleTogglePreview = useCallback(() => {
    setSplitViewOpen((prev) => !prev)
  }, [])

  const columns = useMemo<ColumnsType<RecognizedMaterial>>(
    () => [
      {
        title: '№',
        dataIndex: 'position',
        key: 'position',
        width: 60,
        align: 'center',
      },
      {
        title: 'Артикул',
        dataIndex: 'article',
        key: 'article',
        width: 120,
        render: (v: string | null) => v ?? '—',
      },
      {
        title: 'Наименование',
        dataIndex: 'materialName',
        key: 'materialName',
        ellipsis: true,
        render: (v: string | undefined) => v ?? '—',
      },
      {
        title: 'Ед.изм.',
        dataIndex: 'materialUnit',
        key: 'materialUnit',
        width: 90,
        render: (v: string | null | undefined) => v ?? '—',
      },
      {
        title: 'Количество',
        dataIndex: 'quantity',
        key: 'quantity',
        width: 110,
        align: 'right',
        render: (v: number | null) => fmtAmount(v),
      },
      {
        title: 'Цена',
        dataIndex: 'price',
        key: 'price',
        width: 120,
        align: 'right',
        render: (v: number | null) => fmtAmount(v),
      },
      {
        title: 'Сумма',
        dataIndex: 'amount',
        key: 'amount',
        width: 130,
        align: 'right',
        render: (v: number | null) => fmtAmount(v),
      },
      {
        title: 'Кол-во смета',
        dataIndex: 'estimateQuantity',
        key: 'estimateQuantity',
        width: 140,
        align: 'right',
        render: (value: number | null, record: RecognizedMaterial) => {
          if (!canEditEstimate) return fmtAmount(value)
          return (
            <InputNumber
              value={value}
              size="small"
              style={{ width: '100%' }}
              precision={2}
              onChange={(v) => handleEstimateChange(record.id, v)}
            />
          )
        },
      },
    ],
    [canEditEstimate, handleEstimateChange],
  )

  // Таблица материалов
  const materialsTable = (
    <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }}>
      <Table<RecognizedMaterial>
        dataSource={materials}
        columns={columns}
        rowKey="id"
        loading={isLoadingMaterials}
        pagination={false}
        scroll={{ y: scrollY }}
        size="small"
        onRow={(record) => ({
          onClick: () => handleRowClick(record),
          style: { cursor: splitViewOpen ? 'pointer' : undefined },
        })}
        rowClassName={(record) =>
          splitViewOpen && record.id === selectedRowId ? 'invoice-sync-selected' : ''
        }
      />
    </div>
  )

  // Кнопка просмотра счёта
  const previewButton = (
    <Button
      icon={splitViewOpen ? <EyeInvisibleOutlined /> : <FileSearchOutlined />}
      onClick={handleTogglePreview}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          handleOpenInNewTab()
        }
      }}
      type={splitViewOpen ? 'default' : 'primary'}
      ghost={splitViewOpen}
      title="Клик — просмотр рядом, колесико — новая вкладка"
    >
      {splitViewOpen ? 'Скрыть скан' : 'Просмотр счета'}
    </Button>
  )

  // Desktop split-view или мобильный Drawer
  const useSplitter = splitViewOpen && !isMobile

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px - 1px - 32px)', overflow: 'hidden', gap: 16 }}>
      {/* Шапка */}
      <div>
        <Space align="center" style={{ marginBottom: 12 }}>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/materials')}
          />
          <Title level={3} style={{ margin: 0 }}>
            {isLoadingInfo
              ? 'Загрузка...'
              : `Материалы заявки ${requestInfo?.requestNumber ?? ''}`}
          </Title>
        </Space>

        {requestInfo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <Descriptions size="small" column={{ xs: 1, sm: 2, md: 4 }} style={{ flex: 1 }}>
              <Descriptions.Item label="Подрядчик">{requestInfo.counterpartyName}</Descriptions.Item>
              <Descriptions.Item label="Поставщик">{requestInfo.supplierName}</Descriptions.Item>
              <Descriptions.Item label="Объект">{requestInfo.siteName}</Descriptions.Item>
              <Descriptions.Item label="Дата">{formatDate(requestInfo.approvedAt, false)}</Descriptions.Item>
              <Descriptions.Item label="Вид затрат">
                {canEditEstimate ? (
                  <Select
                    style={{ width: '100%', maxWidth: 300 }}
                    placeholder="Выберите вид затрат"
                    value={requestInfo.costTypeId ?? undefined}
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    options={costTypes.filter((ct) => ct.isActive).map((ct) => ({ value: ct.id, label: ct.name }))}
                    onChange={handleCostTypeChange}
                    size="small"
                  />
                ) : (
                  requestInfo.costTypeName ?? 'Не указан'
                )}
              </Descriptions.Item>
            </Descriptions>
            {previewButton}
          </div>
        )}
      </div>

      {/* Контент: Splitter или обычная таблица */}
      {useSplitter ? (
        <Splitter style={{ flex: 1, overflow: 'hidden' }}>
          <Splitter.Panel defaultSize="50%" min="30%" max="70%">
            {materialsTable}
          </Splitter.Panel>
          <Splitter.Panel>
            <InvoiceViewer
              files={invoiceFiles}
              urls={urls}
              isLoading={isLoadingUrls}
              currentFileId={currentFileId}
              currentPage={currentPage}
              onFileChange={setCurrentFileId}
              onClose={() => setSplitViewOpen(false)}
            />
          </Splitter.Panel>
        </Splitter>
      ) : (
        materialsTable
      )}

      {/* Мобильный fallback — Drawer */}
      {splitViewOpen && isMobile && (
        <Drawer
          title="Просмотр счета"
          open
          onClose={() => setSplitViewOpen(false)}
          width={720}
          destroyOnClose
        >
          <InvoiceViewer
            files={invoiceFiles}
            urls={urls}
            isLoading={isLoadingUrls}
            currentFileId={currentFileId}
            currentPage={currentPage}
            onFileChange={setCurrentFileId}
            onClose={() => setSplitViewOpen(false)}
          />
        </Drawer>
      )}
    </div>
  )
}

export default MaterialsDetailPage
