import { useEffect, useMemo, useState, useCallback } from 'react'
import { Typography, Table, Button, InputNumber, Descriptions, Drawer, Space, Splitter, Select, Tag, Input, message } from 'antd'
import { ArrowLeftOutlined, FileSearchOutlined, EyeInvisibleOutlined, SearchOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useParams, useNavigate } from 'react-router-dom'
import { useMaterialsStore } from '@/store/materialsStore'
import type { MaterialsVerification } from '@/store/materialsStore'
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
  materialsVerification: MaterialsVerification | null
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
          .select('request_number, approved_at, cost_type_id, materials_verification, counterparties(name), suppliers(name), construction_sites(name), cost_types(name)')
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
          materialsVerification: (row.materials_verification as MaterialsVerification | null) ?? null,
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

  // Обработчик смены статуса проверки материалов
  const handleVerificationClick = useCallback(async () => {
    if (!paymentRequestId || !user || !requestInfo) return
    const current = requestInfo.materialsVerification
    if (current?.status === 'verified') return

    const now = new Date().toISOString()
    let newVerification: MaterialsVerification

    if (!current) {
      // null -> on_check
      newVerification = {
        status: 'on_check',
        checkedBy: user.id,
        checkedByName: user.fullName,
        checkedAt: now,
      }
    } else {
      // on_check -> verified
      newVerification = {
        ...current,
        status: 'verified',
        verifiedBy: user.id,
        verifiedByName: user.fullName,
        verifiedAt: now,
      }
    }

    try {
      const { error } = await supabase
        .from('payment_requests')
        .update({ materials_verification: newVerification })
        .eq('id', paymentRequestId)
      if (error) throw error
      setRequestInfo((prev) => prev ? { ...prev, materialsVerification: newVerification } : prev)
    } catch {
      message.error('Ошибка обновления статуса проверки')
    }
  }, [paymentRequestId, user, requestInfo])

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
        sorter: (a: RecognizedMaterial, b: RecognizedMaterial) =>
          (a.materialName ?? '').localeCompare(b.materialName ?? '', 'ru'),
        filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
          <div style={{ padding: 8 }}>
            <Input
              placeholder="Поиск по наименованию"
              value={selectedKeys[0]}
              onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
              onPressEnter={() => confirm()}
              style={{ marginBottom: 8, display: 'block' }}
              size="small"
            />
            <Space>
              <Button type="primary" onClick={() => confirm()} icon={<SearchOutlined />} size="small" style={{ width: 90 }}>
                Найти
              </Button>
              <Button onClick={() => { clearFilters?.(); confirm() }} size="small" style={{ width: 90 }}>
                Сброс
              </Button>
            </Space>
          </div>
        ),
        filterIcon: (filtered: boolean) => <SearchOutlined style={{ color: filtered ? '#1677ff' : undefined }} />,
        onFilter: (value, record: RecognizedMaterial) =>
          (record.materialName ?? '').toLowerCase().includes(String(value).toLowerCase()),
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
              <Descriptions.Item label="Счетов">{invoiceFiles.length}</Descriptions.Item>
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
            <Space>
              {previewButton}
              {(() => {
                const v = requestInfo.materialsVerification
                const isVerified = v?.status === 'verified'
                const isOnCheck = v?.status === 'on_check'

                if (isVerified) {
                  return (
                    <>
                      <Tag color="green">Проверен</Tag>
                      <span style={{ fontSize: 12, color: '#888' }}>
                        {v?.verifiedByName}, {formatDate(v?.verifiedAt ?? null, false)}
                      </span>
                    </>
                  )
                }

                if (isOnCheck) {
                  return (
                    <>
                      <Tag color="orange">На проверке</Tag>
                      <Button
                        onClick={handleVerificationClick}
                        style={{ borderColor: '#52c41a', color: '#52c41a' }}
                      >
                        Проверен
                      </Button>
                      <span style={{ fontSize: 12, color: '#888' }}>
                        {v?.checkedByName}, {formatDate(v?.checkedAt ?? null, false)}
                      </span>
                    </>
                  )
                }

                return (
                  <Button
                    onClick={handleVerificationClick}
                    style={{ borderColor: '#fa8c16', color: '#fa8c16' }}
                  >
                    На проверке
                  </Button>
                )
              })()}
            </Space>
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
