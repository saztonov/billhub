import { useEffect, useMemo, useState, useCallback } from 'react'
import { Typography, Table, Button, InputNumber, Descriptions, Drawer, Space, Spin, Image } from 'antd'
import { ArrowLeftOutlined, FileSearchOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useParams, useNavigate } from 'react-router-dom'
import { useMaterialsStore } from '@/store/materialsStore'
import { useAuthStore } from '@/store/authStore'
import { useTableScrollY } from '@/hooks/useTableScrollY'
import { supabase } from '@/services/supabase'
import { getDownloadUrl } from '@/services/s3'
import { formatDate } from '@/utils/requestFormatters'
import { logError } from '@/services/errorLogger'
import type { RecognizedMaterial } from '@/types'

const { Title, Text } = Typography

/** Информация о заявке для шапки */
interface RequestInfo {
  requestNumber: string
  counterpartyName: string
  supplierName: string
  siteName: string
  approvedAt: string | null
}

/** Форматирование суммы */
const fmtAmount = (v: number | null | undefined): string => {
  if (v == null) return '—'
  return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ───────────────────────── Превью счета ─────────────────────────

interface InvoicePreviewProps {
  open: boolean
  onClose: () => void
  files: { id: string; fileKey: string; fileName: string; mimeType: string | null }[]
}

const InvoicePreview = ({ open, onClose, files }: InvoicePreviewProps) => {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || files.length === 0) return

    let cancelled = false
    const loadUrls = async () => {
      setLoading(true)
      const result: Record<string, string> = {}
      for (const file of files) {
        try {
          result[file.id] = await getDownloadUrl(file.fileKey)
        } catch (err) {
          logError({
            errorType: 'api_error',
            errorMessage: `Не удалось получить URL для файла ${file.fileName}`,
            errorStack: err instanceof Error ? err.stack : null,
            component: 'MaterialsDetailPage/InvoicePreview',
          })
        }
      }
      if (!cancelled) {
        setUrls(result)
        setLoading(false)
      }
    }
    loadUrls()
    return () => { cancelled = true }
  }, [open, files])

  return (
    <Drawer
      title="Просмотр счета"
      open={open}
      onClose={onClose}
      width={720}
      destroyOnClose
    >
      {loading && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
        </div>
      )}
      {!loading && files.length === 0 && (
        <Text type="secondary">Файлы счета не найдены</Text>
      )}
      {!loading &&
        files.map((file) => {
          const url = urls[file.id]
          if (!url) return null

          const isImage = file.mimeType?.startsWith('image/')
          const isPdf = file.mimeType === 'application/pdf'

          return (
            <div key={file.id} style={{ marginBottom: 24 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>
                {file.fileName}
              </Text>
              {isImage && (
                <Image
                  src={url}
                  alt={file.fileName}
                  style={{ maxWidth: '100%' }}
                />
              )}
              {isPdf && (
                <iframe
                  src={url}
                  title={file.fileName}
                  style={{ width: '100%', height: 600, border: '1px solid #d9d9d9', borderRadius: 6 }}
                />
              )}
              {!isImage && !isPdf && (
                <Button href={url} target="_blank" rel="noopener noreferrer">
                  Скачать файл
                </Button>
              )}
            </div>
          )
        })}
    </Drawer>
  )
}

// ───────────────────────── Страница «Материалы заявки» ─────────────────────────

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
  const [requestInfo, setRequestInfo] = useState<RequestInfo | null>(null)
  const [isLoadingInfo, setIsLoadingInfo] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

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

  const { containerRef, scrollY } = useTableScrollY([materials])

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
  }, [paymentRequestId, fetchMaterials, fetchInvoiceFiles])

  // Загрузка информации о заявке
  useEffect(() => {
    if (!paymentRequestId) return
    let cancelled = false

    const load = async () => {
      setIsLoadingInfo(true)
      try {
        const { data, error } = await supabase
          .from('payment_requests')
          .select('request_number, approved_at, counterparties(name), suppliers(name), construction_sites(name)')
          .eq('id', paymentRequestId)
          .single()
        if (error) throw error
        if (cancelled) return

        const row = data as Record<string, unknown>
        const cp = row.counterparties as Record<string, unknown> | null
        const sup = row.suppliers as Record<string, unknown> | null
        const site = row.construction_sites as Record<string, unknown> | null

        setRequestInfo({
          requestNumber: row.request_number as string,
          counterpartyName: (cp?.name as string) ?? '—',
          supplierName: (sup?.name as string) ?? '—',
          siteName: (site?.name as string) ?? '—',
          approvedAt: row.approved_at as string | null,
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

  // Обработчик изменения «Кол-во смета»
  const handleEstimateChange = useCallback(
    (id: string, value: number | null) => {
      updateEstimateQuantity(id, value)
    },
    [updateEstimateQuantity],
  )

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
            </Descriptions>
            <Button
              icon={<FileSearchOutlined />}
              onClick={() => setPreviewOpen(true)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  handleOpenInNewTab()
                }
              }}
              title="Клик — боковая панель, колесико — новая вкладка"
            >
              Просмотр счета
            </Button>
          </div>
        )}
      </div>

      {/* Таблица материалов */}
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }}>
        <Table<RecognizedMaterial>
          dataSource={materials}
          columns={columns}
          rowKey="id"
          loading={isLoadingMaterials}
          pagination={false}
          scroll={{ y: scrollY }}
          size="small"
        />
      </div>

      {/* Превью счета */}
      <InvoicePreview
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        files={invoiceFiles}
      />
    </div>
  )
}

export default MaterialsDetailPage
