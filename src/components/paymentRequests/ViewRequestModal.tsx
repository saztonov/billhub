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
  Form,
  Select,
  InputNumber,
  Row,
  Col,
  message,
} from 'antd'
import {
  DownloadOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  SendOutlined,
  EditOutlined,
  FileAddOutlined,
} from '@ant-design/icons'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import type { EditRequestData } from '@/store/paymentRequestStore'
import { useApprovalStore } from '@/store/approvalStore'
import { useAuthStore } from '@/store/authStore'
import { usePaymentRequestSettingsStore } from '@/store/paymentRequestSettingsStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
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
  /** Возможность редактирования (admin / ответственный менеджер) */
  canEdit?: boolean
  /** Обработчик сохранения изменений */
  onEdit?: (id: string, data: EditRequestData, files: FileItem[]) => void
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

const ViewRequestModal = ({ open, request, onClose, resubmitMode, onResubmit, canEdit, onEdit }: ViewRequestModalProps) => {
  const { currentRequestFiles, fetchRequestFiles, isLoading, isSubmitting } = usePaymentRequestStore()
  const { currentDecisions, currentLogs, fetchDecisions, fetchLogs } = useApprovalStore()
  const user = useAuthStore((s) => s.user)
  const isCounterpartyUser = user?.role === 'counterparty_user'
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [previewFile, setPreviewFile] = useState<PaymentRequestFile | null>(null)
  const [resubmitFileList, setResubmitFileList] = useState<FileItem[]>([])
  const [resubmitComment, setResubmitComment] = useState('')

  // Режим редактирования
  const [isEditing, setIsEditing] = useState(false)
  const [editForm] = Form.useForm()
  const [editFileList, setEditFileList] = useState<FileItem[]>([])
  const { fieldOptions, fetchFieldOptions, getOptionsByField } = usePaymentRequestSettingsStore()
  const { sites, fetchSites } = useConstructionSiteStore()

  useEffect(() => {
    if (open && request) {
      fetchRequestFiles(request.id)
      fetchDecisions(request.id)
      fetchLogs(request.id)
    }
  }, [open, request, fetchRequestFiles, fetchDecisions, fetchLogs])

  // Сброс состояния при закрытии
  useEffect(() => {
    if (!open) {
      setResubmitFileList([])
      setResubmitComment('')
      setIsEditing(false)
      setEditFileList([])
    }
  }, [open])

  // Загрузка справочников при входе в режим редактирования
  useEffect(() => {
    if (isEditing) {
      if (fieldOptions.length === 0) fetchFieldOptions()
      if (sites.length === 0) fetchSites()
    }
  }, [isEditing, fieldOptions.length, sites.length, fetchFieldOptions, fetchSites])

  const shippingOptions = getOptionsByField('shipping_conditions')
  const siteOptions = sites.filter((s) => s.isActive).map((s) => ({ label: s.name, value: s.id }))

  /** Начать редактирование */
  const startEditing = () => {
    if (!request) return
    editForm.setFieldsValue({
      siteId: request.siteId,
      deliveryDays: request.deliveryDays,
      deliveryDaysType: request.deliveryDaysType,
      shippingConditionId: request.shippingConditionId,
      comment: request.comment ?? '',
    })
    setIsEditing(true)
  }

  /** Сохранить изменения */
  const handleEditSave = async () => {
    if (!request || !onEdit) return
    try {
      const values = await editForm.validateFields()
      onEdit(request.id, values as EditRequestData, editFileList)
      setIsEditing(false)
      setEditFileList([])
    } catch {
      // Ошибки валидации формы
    }
  }

  /** Маппинг имён полей для логов */
  const fieldLabels: Record<string, string> = {
    delivery_days: 'Срок поставки',
    delivery_days_type: 'Тип дней',
    shipping_condition_id: 'Условия отгрузки',
    site_id: 'Объект',
    comment: 'Комментарий',
  }

  /** Лог событий для контрагента */
  const counterpartyLog = useMemo(() => {
    if (!request) return []
    const log: { icon: React.ReactNode; text: string; date?: string }[] = []

    // Отклонения
    const rejected = currentDecisions.filter((d) => d.status === 'rejected')
    for (const d of rejected) {
      const reason = d.comment ? `Отклонено. Причина: ${d.comment}` : 'Отклонено'
      log.push({ icon: <CloseCircleOutlined style={{ color: '#f5222d' }} />, text: reason, date: d.decidedAt ?? undefined })
    }

    // Комментарий повторной отправки
    if (request.resubmitComment) {
      log.push({ icon: <SendOutlined style={{ color: '#1677ff' }} />, text: `Повторно отправлено. Комментарий: ${request.resubmitComment}` })
    }

    // Комментарии согласования
    const approvedWithComment = currentDecisions.filter((d) => d.status === 'approved' && d.comment)
    for (const d of approvedWithComment) {
      log.push({ icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />, text: `Согласовано. Комментарий: ${d.comment}`, date: d.decidedAt ?? undefined })
    }

    // Логи редактирования и догрузки
    for (const l of currentLogs) {
      if (l.action === 'edit') {
        const changes = (l.details?.changes as { field: string; newValue: unknown }[]) ?? []
        const changedFields = changes.map((c) => fieldLabels[c.field] ?? c.field).join(', ')
        log.push({ icon: <EditOutlined style={{ color: '#722ed1' }} />, text: `Изменено: ${changedFields}`, date: l.createdAt })
      } else if (l.action === 'file_upload') {
        const count = (l.details?.count as number) ?? 0
        log.push({ icon: <FileAddOutlined style={{ color: '#1677ff' }} />, text: `Догружено файлов: ${count}`, date: l.createdAt })
      }
    }

    // Сортировка по дате
    log.sort((a, b) => {
      if (!a.date) return 1
      if (!b.date) return -1
      return new Date(a.date).getTime() - new Date(b.date).getTime()
    })

    return log
  }, [request, currentDecisions, currentLogs])

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
  let modalFooter: React.ReactNode
  if (resubmitMode) {
    modalFooter = (
      <Space>
        <Button onClick={onClose}>Отмена</Button>
        <Button type="primary" icon={<SendOutlined />} loading={isSubmitting} onClick={handleResubmitSubmit}>
          Отправить повторно
        </Button>
      </Space>
    )
  } else if (isEditing) {
    modalFooter = (
      <Space>
        <Button onClick={() => { setIsEditing(false); setEditFileList([]) }}>Отмена</Button>
        <Button type="primary" loading={isSubmitting} onClick={handleEditSave}>Сохранить</Button>
      </Space>
    )
  } else {
    modalFooter = (
      <Space>
        {canEdit && !isCounterpartyUser && (
          <Button icon={<EditOutlined />} onClick={startEditing}>Редактировать</Button>
        )}
        <Button onClick={onClose}>Закрыть</Button>
      </Space>
    )
  }

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
        {/* Реквизиты — просмотр или редактирование */}
        {isEditing ? (
          <Form form={editForm} layout="vertical" style={{ marginBottom: 16 }}>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="Номер">{request.requestNumber}</Descriptions.Item>
              <Descriptions.Item label="Подрядчик">{request.counterpartyName}</Descriptions.Item>
            </Descriptions>
            <Form.Item name="siteId" label="Объект" rules={[{ required: true, message: 'Выберите объект' }]}>
              <Select placeholder="Выберите объект" showSearch optionFilterProp="label" options={siteOptions} />
            </Form.Item>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="Срок поставки" required style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Form.Item name="deliveryDays" noStyle rules={[{ required: true, message: 'Укажите срок' }]}>
                      <InputNumber min={1} style={{ flex: 1 }} placeholder="Кол-во дней" />
                    </Form.Item>
                    <Form.Item name="deliveryDaysType" noStyle>
                      <Select style={{ width: 150 }} options={[
                        { label: 'рабочих', value: 'working' },
                        { label: 'календарных', value: 'calendar' },
                      ]} />
                    </Form.Item>
                  </div>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="shippingConditionId" label="Условия отгрузки" rules={[{ required: true, message: 'Выберите условия' }]}>
                  <Select placeholder="Выберите условия" options={shippingOptions.map((o) => ({ label: o.value, value: o.id }))} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="comment" label="Комментарий">
              <TextArea rows={2} placeholder="Необязательное поле" />
            </Form.Item>

            {/* Догрузка файлов при редактировании */}
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              <FileAddOutlined /> Догрузить файлы
            </Text>
            <FileUploadList fileList={editFileList} onChange={setEditFileList} />
          </Form>
        ) : (
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
        )}

        {/* Секция согласования — между реквизитами и файлами */}
        {isCounterpartyUser ? (
          // Для контрагента — упрощенный лог
          counterpartyLog.length > 0 && (
            <>
              <Text strong style={{ marginBottom: 8, display: 'block' }}>Согласование</Text>
              <List
                size="small"
                dataSource={counterpartyLog}
                style={{ marginBottom: 16 }}
                renderItem={(item) => (
                  <List.Item>
                    <Space>
                      {item.icon}
                      <Text>{item.text}</Text>
                      {item.date && <Text type="secondary">{formatDate(item.date)}</Text>}
                    </Space>
                  </List.Item>
                )}
              />
            </>
          )
        ) : (
          // Для admin/user — полная цепочка + логи
          (currentDecisions.length > 0 || currentLogs.length > 0) && (
            <>
              <Text strong style={{ marginBottom: 8, display: 'block' }}>Согласование</Text>
              {currentDecisions.length > 0 && (
                <List
                  size="small"
                  dataSource={currentDecisions}
                  style={{ marginBottom: currentLogs.length > 0 ? 8 : 16 }}
                  renderItem={(decision) => {
                    const icon = decision.status === 'approved'
                      ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                      : decision.status === 'rejected'
                        ? <CloseCircleOutlined style={{ color: '#f5222d' }} />
                        : <ClockCircleOutlined style={{ color: '#faad14' }} />
                    const statusText = decision.status === 'approved'
                      ? 'Согласовано'
                      : decision.status === 'rejected' ? 'Отклонено' : 'Ожидает'
                    return (
                      <List.Item>
                        <Space>
                          {icon}
                          <Text>Этап {decision.stageOrder}</Text>
                          <Tag>{decision.departmentName}</Tag>
                          <Text type="secondary">{statusText}</Text>
                          {decision.userEmail && <Text type="secondary">({decision.userEmail})</Text>}
                          {decision.decidedAt && <Text type="secondary">{formatDate(decision.decidedAt)}</Text>}
                        </Space>
                        {decision.comment && (
                          <Text type="secondary" style={{ display: 'block', marginLeft: 22 }}>{decision.comment}</Text>
                        )}
                      </List.Item>
                    )
                  }}
                />
              )}
              {currentLogs.length > 0 && (
                <List
                  size="small"
                  dataSource={currentLogs}
                  style={{ marginBottom: 16 }}
                  renderItem={(log) => {
                    if (log.action === 'edit') {
                      const changes = (log.details?.changes as { field: string; newValue: unknown }[]) ?? []
                      const changedFields = changes.map((c) => fieldLabels[c.field] ?? c.field).join(', ')
                      return (
                        <List.Item>
                          <Space>
                            <EditOutlined style={{ color: '#722ed1' }} />
                            <Text>Изменено: {changedFields}</Text>
                            {log.userEmail && <Text type="secondary">({log.userEmail})</Text>}
                            <Text type="secondary">{formatDate(log.createdAt)}</Text>
                          </Space>
                        </List.Item>
                      )
                    }
                    if (log.action === 'file_upload') {
                      const count = (log.details?.count as number) ?? 0
                      return (
                        <List.Item>
                          <Space>
                            <FileAddOutlined style={{ color: '#1677ff' }} />
                            <Text>Догружено файлов: {count}</Text>
                            {log.userEmail && <Text type="secondary">({log.userEmail})</Text>}
                            <Text type="secondary">{formatDate(log.createdAt)}</Text>
                          </Space>
                        </List.Item>
                      )
                    }
                    return null
                  }}
                />
              )}
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
