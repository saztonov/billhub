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
  Input,
} from 'antd'
import {
  DownloadOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  SendOutlined,
} from '@ant-design/icons'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import { useApprovalStore } from '@/store/approvalStore'
import { useAuthStore } from '@/store/authStore'
import { getDownloadUrl, downloadFileBlob } from '@/services/s3'
import JSZip from 'jszip'
import FilePreviewModal from './FilePreviewModal'
import FileUploadList from './FileUploadList'
import type { FileItem } from './FileUploadList'
import type { PaymentRequest, PaymentRequestFile } from '@/types'

const { Text } = Typography
const { TextArea } = Input

interface ViewRequestModalProps {
  open: boolean
  request: PaymentRequest | null
  onClose: () => void
  /** Режим повторной отправки отклоненной заявки */
  resubmitMode?: boolean
  /** Обработчик повторной отправки (комментарий, новые файлы) */
  onResubmit?: (comment: string, files: FileItem[]) => void
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

const ViewRequestModal = ({ open, request, onClose, resubmitMode, onResubmit }: ViewRequestModalProps) => {
  const { currentRequestFiles, fetchRequestFiles, isLoading, isSubmitting } = usePaymentRequestStore()
  const { currentDecisions, fetchDecisions } = useApprovalStore()
  const user = useAuthStore((s) => s.user)
  const isCounterpartyUser = user?.role === 'counterparty_user'
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [previewFile, setPreviewFile] = useState<PaymentRequestFile | null>(null)
  const [resubmitFileList, setResubmitFileList] = useState<FileItem[]>([])
  const [resubmitComment, setResubmitComment] = useState('')

  useEffect(() => {
    if (open && request) {
      fetchRequestFiles(request.id)
      fetchDecisions(request.id)
    }
  }, [open, request, fetchRequestFiles, fetchDecisions])

  // Сброс состояния при закрытии
  useEffect(() => {
    if (!open) {
      setResubmitFileList([])
      setResubmitComment('')
    }
  }, [open])

  /** Лог событий для контрагента */
  const counterpartyLog = useMemo(() => {
    if (!request) return []
    const log: { icon: React.ReactNode; text: string }[] = []

    // Отклонения
    const rejected = currentDecisions.filter((d) => d.status === 'rejected')
    for (const d of rejected) {
      const reason = d.comment ? `Отклонено. Причина: ${d.comment}` : 'Отклонено'
      log.push({
        icon: <CloseCircleOutlined style={{ color: '#f5222d' }} />,
        text: reason,
      })
    }

    // Комментарий повторной отправки
    if (request.resubmitComment) {
      log.push({
        icon: <SendOutlined style={{ color: '#1677ff' }} />,
        text: `Повторно отправлено. Комментарий: ${request.resubmitComment}`,
      })
    }

    // Комментарии согласования
    const approvedWithComment = currentDecisions.filter((d) => d.status === 'approved' && d.comment)
    for (const d of approvedWithComment) {
      log.push({
        icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
        text: `Согласовано. Комментарий: ${d.comment}`,
      })
    }

    return log
  }, [request, currentDecisions])

  /** Скачать все файлы в ZIP-архиве */
  const handleDownloadAll = async () => {
    if (!currentRequestFiles.length || !request) return
    setDownloadingAll(true)
    try {
      const zip = new JSZip()
      const results = await Promise.allSettled(
        currentRequestFiles.map(async (file) => {
          const blob = await downloadFileBlob(file.fileKey)
          zip.file(file.fileName, blob)
        }),
      )
      const failed = results.filter((r) => r.status === 'rejected').length
      if (failed === currentRequestFiles.length) return
      const content = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(content)
      const a = document.createElement('a')
      a.href = url
      a.download = `${request.requestNumber}.zip`
      a.click()
      URL.revokeObjectURL(url)
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

  // Сортировка файлов: догруженные (isResubmit) сверху
  const sortedFiles = useMemo(() => {
    return [...currentRequestFiles].sort((a, b) => {
      if (a.isResubmit && !b.isResubmit) return -1
      if (!a.isResubmit && b.isResubmit) return 1
      return 0
    })
  }, [currentRequestFiles])

  const hasResubmitFiles = (request?.resubmitCount ?? 0) > 0

  const handleResubmitSubmit = () => {
    onResubmit?.(resubmitComment, resubmitFileList)
  }

  if (!request) return null

  /** Столбцы таблицы файлов */
  const fileColumns: Record<string, unknown>[] = [
    {
      title: '№',
      key: 'index',
      width: 50,
      render: (_: unknown, __: PaymentRequestFile, index: number) => index + 1,
    },
    {
      title: 'Файл',
      dataIndex: 'fileName',
      key: 'fileName',
      width: hasResubmitFiles ? '40%' : '50%',
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
  ]

  // Колонка "Догружен" — только если была повторная отправка
  if (hasResubmitFiles) {
    fileColumns.push({
      title: 'Догружен',
      key: 'resubmit',
      width: 100,
      render: (_: unknown, file: PaymentRequestFile) =>
        file.isResubmit ? <Tag color="blue">Догружен</Tag> : null,
    })
  }

  // Колонка действий
  fileColumns.push({
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
  })

  // Footer модального окна
  const modalFooter = resubmitMode
    ? (
      <Space>
        <Button onClick={onClose}>Отмена</Button>
        <Button
          type="primary"
          icon={<SendOutlined />}
          loading={isSubmitting}
          onClick={handleResubmitSubmit}
        >
          Отправить повторно
        </Button>
      </Space>
    )
    : <Button onClick={onClose}>Закрыть</Button>

  return (
    <>
      <Modal
        title={resubmitMode ? `Повторная отправка — Заявка ${request.requestNumber}` : `Заявка ${request.requestNumber}`}
        open={open}
        onCancel={onClose}
        footer={modalFooter}
        width="80%"
        maskClosable={false}
      >
        {/* Реквизиты */}
        <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
          <Descriptions.Item label="Номер">{request.requestNumber}</Descriptions.Item>
          <Descriptions.Item label="Подрядчик">{request.counterpartyName}</Descriptions.Item>
          <Descriptions.Item label="Объект">{request.siteName ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Статус">
            <Tag color={request.statusColor ?? 'default'}>{request.statusName}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Срок поставки">{request.deliveryDays} {request.deliveryDaysType === 'calendar' ? 'кал.' : 'раб.'} дн.</Descriptions.Item>
          <Descriptions.Item label="Условия отгрузки">{request.shippingConditionValue}</Descriptions.Item>
          <Descriptions.Item label="Дата создания">{formatDate(request.createdAt)}</Descriptions.Item>
          {request.comment && (
            <Descriptions.Item label="Комментарий" span={2}>{request.comment}</Descriptions.Item>
          )}
        </Descriptions>

        {/* Секция согласования — между реквизитами и файлами */}
        {isCounterpartyUser ? (
          // Для контрагента — упрощенный лог
          counterpartyLog.length > 0 && (
            <>
              <Text strong style={{ marginBottom: 8, display: 'block' }}>
                Согласование
              </Text>
              <List
                size="small"
                dataSource={counterpartyLog}
                style={{ marginBottom: 16 }}
                renderItem={(item) => (
                  <List.Item>
                    <Space>
                      {item.icon}
                      <Text>{item.text}</Text>
                    </Space>
                  </List.Item>
                )}
              />
            </>
          )
        ) : (
          // Для admin/user — полная цепочка
          currentDecisions.length > 0 && (
            <>
              <Text strong style={{ marginBottom: 8, display: 'block' }}>
                Согласование
              </Text>
              <List
                size="small"
                dataSource={currentDecisions}
                style={{ marginBottom: 16 }}
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
          )
        )}

        {/* Файлы */}
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
          dataSource={sortedFiles}
          rowKey="id"
          loading={isLoading}
          pagination={false}
          locale={{ emptyText: 'Нет файлов' }}
        />

        {/* Режим повторной отправки: загрузка новых файлов + комментарий */}
        {resubmitMode && (
          <div style={{ marginTop: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              Догрузить файлы
            </Text>
            <FileUploadList fileList={resubmitFileList} onChange={setResubmitFileList} />

            <Text strong style={{ display: 'block', marginTop: 16, marginBottom: 8 }}>
              Комментарий к повторной отправке
            </Text>
            <TextArea
              rows={3}
              placeholder="Необязательное поле"
              value={resubmitComment}
              onChange={(e) => setResubmitComment(e.target.value)}
            />
          </div>
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
