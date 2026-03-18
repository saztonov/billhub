import { useState } from 'react'
import { Table, Tag, Modal, Button, Space } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useOcrStore } from '@/store/ocrStore'
import type { OcrRecognitionLog } from '@/types'

/** Карта статусов для цветных тегов */
const STATUS_MAP: Record<string, { color: string; label: string }> = {
  pending: { color: 'default', label: 'Ожидание' },
  processing: { color: 'processing', label: 'Обработка' },
  success: { color: 'success', label: 'Успех' },
  error: { color: 'error', label: 'Ошибка' },
}

/** Форматирование даты */
const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('ru-RU')
}

/** Секция лога распознавания OCR */
const OcrLogSection = () => {
  const navigate = useNavigate()
  const {
    logs, isLoadingLogs, logsTotal, fetchLogs,
    logMaterials, isLoadingLogMaterials, fetchLogMaterials,
  } = useOcrStore()

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [materialsModalOpen, setMaterialsModalOpen] = useState(false)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [selectedRequestNumber, setSelectedRequestNumber] = useState<string>('')

  const handleRowClick = async (record: OcrRecognitionLog) => {
    setSelectedRequestId(record.paymentRequestId)
    setSelectedRequestNumber(record.requestNumber ?? record.paymentRequestId)
    setMaterialsModalOpen(true)
    await fetchLogMaterials(record.paymentRequestId)
  }

  const handlePageChange = (newPage: number, newPageSize: number) => {
    setPage(newPage)
    setPageSize(newPageSize)
    fetchLogs(newPage, newPageSize)
  }

  const logColumns = [
    {
      title: 'Номер заявки',
      dataIndex: 'requestNumber',
      key: 'requestNumber',
      width: 140,
      render: (v: string | undefined, record: OcrRecognitionLog) => v ?? record.paymentRequestId.slice(0, 8),
    },
    {
      title: 'Модель',
      dataIndex: 'modelId',
      key: 'modelId',
      ellipsis: true,
      width: 200,
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: string) => {
        const info = STATUS_MAP[status] ?? { color: 'default', label: status }
        return <Tag color={info.color}>{info.label}</Tag>
      },
    },
    {
      title: 'Вх. токены',
      dataIndex: 'inputTokens',
      key: 'inputTokens',
      width: 110,
      render: (v: number | null) => v?.toLocaleString('ru-RU') ?? '—',
    },
    {
      title: 'Исх. токены',
      dataIndex: 'outputTokens',
      key: 'outputTokens',
      width: 110,
      render: (v: number | null) => v?.toLocaleString('ru-RU') ?? '—',
    },
    {
      title: 'Стоимость',
      dataIndex: 'totalCost',
      key: 'totalCost',
      width: 110,
      render: (v: number | null) => v != null ? `$${v.toFixed(4)}` : '—',
    },
    {
      title: 'Попытка',
      dataIndex: 'attemptNumber',
      key: 'attemptNumber',
      width: 90,
    },
    {
      title: 'Время',
      dataIndex: 'startedAt',
      key: 'startedAt',
      width: 170,
      render: formatDate,
    },
    {
      title: 'Ошибка',
      dataIndex: 'errorMessage',
      key: 'errorMessage',
      ellipsis: true,
      render: (v: string | null) => v ?? '—',
    },
  ]

  const materialColumns = [
    {
      title: '№',
      dataIndex: 'position',
      key: 'position',
      width: 50,
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
    },
    {
      title: 'Ед. изм.',
      dataIndex: 'materialUnit',
      key: 'materialUnit',
      width: 80,
      render: (v: string | null) => v ?? '—',
    },
    {
      title: 'Кол-во',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 90,
      render: (v: number | null) => v?.toLocaleString('ru-RU') ?? '—',
    },
    {
      title: 'Цена',
      dataIndex: 'price',
      key: 'price',
      width: 100,
      render: (v: number | null) => v?.toLocaleString('ru-RU', { minimumFractionDigits: 2 }) ?? '—',
    },
    {
      title: 'Сумма',
      dataIndex: 'amount',
      key: 'amount',
      width: 110,
      render: (v: number | null) => v?.toLocaleString('ru-RU', { minimumFractionDigits: 2 }) ?? '—',
    },
  ]

  return (
    <>
      <Table
        columns={logColumns}
        dataSource={logs}
        rowKey="id"
        loading={isLoadingLogs}
        size="small"
        onRow={(record) => ({
          onClick: () => handleRowClick(record),
          style: { cursor: 'pointer' },
        })}
        pagination={{
          current: page,
          pageSize,
          total: logsTotal,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50'],
          onChange: handlePageChange,
        }}
      />

      <Modal
        title={`Распознанные материалы — Заявка ${selectedRequestNumber}`}
        open={materialsModalOpen}
        onCancel={() => setMaterialsModalOpen(false)}
        width={900}
        footer={
          <Space>
            <Button onClick={() => setMaterialsModalOpen(false)}>
              Закрыть
            </Button>
            {selectedRequestId && (
              <Button
                type="primary"
                onClick={() => {
                  setMaterialsModalOpen(false)
                  navigate(`/materials/${selectedRequestId}`)
                }}
              >
                Перейти к материалам
              </Button>
            )}
          </Space>
        }
        destroyOnClose
      >
        <Table
          columns={materialColumns}
          dataSource={logMaterials}
          rowKey="id"
          loading={isLoadingLogMaterials}
          size="small"
          pagination={false}
          scroll={{ y: 400 }}
        />
      </Modal>
    </>
  )
}

export default OcrLogSection
