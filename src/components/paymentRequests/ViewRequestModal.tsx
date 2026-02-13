import { useEffect, useMemo, useState } from 'react'
import {
  Modal,
  Descriptions,
  Tag,
  List,
  Button,
  Typography,
  Space,
  Tooltip,
  Table,
} from 'antd'
import {
  DownloadOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import { useApprovalStore } from '@/store/approvalStore'
import { useAuthStore } from '@/store/authStore'
import { getDownloadUrl } from '@/services/s3'
import FilePreviewModal from './FilePreviewModal'
import type { PaymentRequest, PaymentRequestFile } from '@/types'

const { Text } = Typography

interface ViewRequestModalProps {
  open: boolean
  request: PaymentRequest | null
  onClose: () => void
}

/** Форматирование размера файла */
function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

/** Форматирование даты */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const ViewRequestModal = ({ open, request, onClose }: ViewRequestModalProps) => {
  const { currentRequestFiles, fetchRequestFiles, isLoading } = usePaymentRequestStore()
  const { currentDecisions, fetchDecisions } = useApprovalStore()
  const user = useAuthStore((s) => s.user)
  const isCounterpartyUser = user?.role === 'counterparty_user'
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [previewFile, setPreviewFile] = useState<PaymentRequestFile | null>(null)

  useEffect(() => {
    if (open && request) {
      fetchRequestFiles(request.id)
      fetchDecisions(request.id)
    }
  }, [open, request, fetchRequestFiles, fetchDecisions])

  /** Комментарий статуса (отклонение/отзыв/согласование) */
  const statusComment = useMemo(() => {
    if (!request) return null
    if (request.rejectedAt) {
      const rejected = currentDecisions.find((d) => d.status === 'rejected')
      return rejected?.comment || null
    }
    if (request.withdrawnAt) {
      return request.withdrawalComment || null
    }
    if (request.approvedAt) {
      const approved = [...currentDecisions]
        .filter((d) => d.status === 'approved' && d.comment)
        .pop()
      return approved?.comment || null
    }
    return null
  }, [request, currentDecisions])

  /** Скачать все файлы */
  const handleDownloadAll = async () => {
    if (!currentRequestFiles.length) return
    setDownloadingAll(true)
    try {
      const downloads = currentRequestFiles.map(async (file) => {
        const url = await getDownloadUrl(file.fileKey)
        const resp = await fetch(url)
        const blob = await resp.blob()
        const blobUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = file.fileName
        a.click()
        URL.revokeObjectURL(blobUrl)
      })
      await Promise.allSettled(downloads)
    } finally {
      setDownloadingAll(false)
    }
  }

  const handleDownload = async (fileKey: string, fileName: string) => {
    setDownloading(fileKey)
    try {
      const url = await getDownloadUrl(fileKey)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.target = '_blank'
      a.click()
    } finally {
      setDownloading(null)
    }
  }

  if (!request) return null

  /** Столбцы таблицы файлов */
  const fileColumns = [
    {
      title: 'Файл',
      dataIndex: 'fileName',
      key: 'fileName',
      width: '50%',
      ellipsis: true,
    },
    {
      title: 'Размер',
      key: 'fileSize',
      width: 100,
      render: (_: unknown, file: PaymentRequestFile) => (
        <Text type="secondary">
          {formatSize(file.fileSize)}
          {file.pageCount != null && ` · ${file.pageCount} стр.`}
        </Text>
      ),
    },
    {
      title: 'Тип документа',
      key: 'documentType',
      render: (_: unknown, file: PaymentRequestFile) =>
        file.documentTypeName ? <Tag>{file.documentTypeName}</Tag> : null,
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_: unknown, file: PaymentRequestFile) => (
        <Space size={4}>
          <Tooltip title="Просмотр">
            <Button
              icon={<EyeOutlined />}
              size="small"
              onClick={() => setPreviewFile(file)}
            />
          </Tooltip>
          <Tooltip title="Скачать">
            <Button
              icon={<DownloadOutlined />}
              size="small"
              loading={downloading === file.fileKey}
              onClick={() => handleDownload(file.fileKey, file.fileName)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ]

  return (
    <>
      <Modal
        title={`Заявка ${request.requestNumber}`}
        open={open}
        onCancel={onClose}
        footer={<Button onClick={onClose}>Закрыть</Button>}
        width="80%"
      >
        <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
          <Descriptions.Item label="Номер">{request.requestNumber}</Descriptions.Item>
          <Descriptions.Item label="Подрядчик">{request.counterpartyName}</Descriptions.Item>
          <Descriptions.Item label="Объект">{request.siteName ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Статус">
            <Tag color={request.statusColor ?? 'default'}>{request.statusName}</Tag>
            {statusComment && (
              <Text type="secondary" style={{ marginLeft: 8 }}>{statusComment}</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Срок поставки">{request.deliveryDays} {request.deliveryDaysType === 'calendar' ? 'кал.' : 'раб.'} дн.</Descriptions.Item>
          <Descriptions.Item label="Условия отгрузки">{request.shippingConditionValue}</Descriptions.Item>
          <Descriptions.Item label="Дата создания">{formatDate(request.createdAt)}</Descriptions.Item>
          {request.comment && (
            <Descriptions.Item label="Комментарий" span={2}>{request.comment}</Descriptions.Item>
          )}
        </Descriptions>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text strong>
            Файлы ({currentRequestFiles.length})
          </Text>
          {currentRequestFiles.length > 0 && (
            <Button
              size="small"
              icon={<DownloadOutlined />}
              loading={downloadingAll}
              onClick={handleDownloadAll}
            >
              Скачать все
            </Button>
          )}
        </div>

        <Table
          size="small"
          columns={fileColumns as any}
          dataSource={currentRequestFiles}
          rowKey="id"
          loading={isLoading}
          pagination={false}
          locale={{ emptyText: 'Нет файлов' }}
        />

        {/* Секция согласования — только для admin/user */}
        {!isCounterpartyUser && currentDecisions.length > 0 && (
          <>
            <Text strong style={{ marginTop: 16, marginBottom: 8, display: 'block' }}>
              Согласование
            </Text>
            <List
              size="small"
              dataSource={currentDecisions}
              renderItem={(decision) => {
                const icon = decision.status === 'approved'
                  ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                  : decision.status === 'rejected'
                    ? <CloseCircleOutlined style={{ color: '#f5222d' }} />
                    : <ClockCircleOutlined style={{ color: '#faad14' }} />
                const statusText = decision.status === 'approved'
                  ? 'Согласовано'
                  : decision.status === 'rejected'
                    ? 'Отклонено'
                    : 'Ожидает'
                return (
                  <List.Item>
                    <Space>
                      {icon}
                      <Text>Этап {decision.stageOrder}</Text>
                      <Tag>{decision.departmentName}</Tag>
                      <Text type="secondary">{statusText}</Text>
                      {decision.userEmail && (
                        <Text type="secondary">({decision.userEmail})</Text>
                      )}
                      {decision.decidedAt && (
                        <Text type="secondary">{formatDate(decision.decidedAt)}</Text>
                      )}
                    </Space>
                    {decision.comment && (
                      <Text type="secondary" style={{ display: 'block', marginLeft: 22 }}>
                        {decision.comment}
                      </Text>
                    )}
                  </List.Item>
                )
              }}
            />
          </>
        )}
      </Modal>

      <FilePreviewModal
        open={!!previewFile}
        onClose={() => setPreviewFile(null)}
        fileKey={previewFile?.fileKey ?? null}
        fileName={previewFile?.fileName ?? ''}
        mimeType={previewFile?.mimeType ?? null}
      />
    </>
  )
}

export default ViewRequestModal
