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
  App,
  Collapse,
  Popconfirm,
  Upload,
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
  CheckOutlined,
  StopOutlined,
  InboxOutlined,
  CloseOutlined,
} from '@ant-design/icons'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import type { EditRequestData } from '@/store/paymentRequestStore'
import { useApprovalStore } from '@/store/approvalStore'
import { useAuthStore } from '@/store/authStore'
import { usePaymentRequestSettingsStore } from '@/store/paymentRequestSettingsStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import { useAssignmentStore } from '@/store/assignmentStore'
import { useDocumentTypeStore } from '@/store/documentTypeStore'
import { getDownloadUrl, downloadFileBlob } from '@/services/s3'
import JSZip from 'jszip'
import FilePreviewModal from './FilePreviewModal'
import FileUploadList from './FileUploadList'
import type { FileItem } from './FileUploadList'
import DeliveryCalculation from './DeliveryCalculation'
import type { PaymentRequest, PaymentRequestFile, ApprovalDecisionFile, ApprovalDecision, PaymentRequestLog } from '@/types'
import { DEPARTMENT_LABELS } from '@/types'

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
  /** Показывать кнопки согласования */
  canApprove?: boolean
  /** Обработчик согласования */
  onApprove?: (requestId: string, comment: string) => void
  /** Обработчик отклонения */
  onReject?: (requestId: string, comment: string, files?: { id: string; file: File }[]) => void
}

/** Форматирование размера файла */
function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

/** Форматирование даты */
function formatDate(dateStr: string, withTime = true): string {
  const d = new Date(dateStr)
  const opts: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }
  if (withTime) {
    opts.hour = '2-digit'
    opts.minute = '2-digit'
  }
  return d.toLocaleDateString('ru-RU', opts)
}

/** Извлечение порядкового номера из request_number (для обратной совместимости со старым форматом) */
function extractRequestNumber(requestNumber: string): string {
  // Если есть старый формат "000018_140226", извлекаем порядковый номер
  const parts = requestNumber.split('_')
  if (parts.length > 1) {
    // Старый формат - убираем нули впереди
    return parseInt(parts[0], 10).toString()
  }
  // Новый формат - возвращаем как есть
  return requestNumber
}

const { Dragger } = Upload

// Поддерживаемые расширения файлов для отклонения
const ACCEPT_REJECT_EXTENSIONS = '.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.tiff,.tif,.bmp,.pdf'

const ViewRequestModal = ({ open, request, onClose, resubmitMode, onResubmit, canEdit, onEdit, canApprove, onApprove, onReject }: ViewRequestModalProps) => {
  const { message } = App.useApp()
  const { currentRequestFiles, fetchRequestFiles, isLoading, isSubmitting } = usePaymentRequestStore()
  const { currentDecisions, currentLogs, fetchDecisions, fetchLogs, clearCurrentData } = useApprovalStore()
  const user = useAuthStore((s) => s.user)
  const isCounterpartyUser = user?.role === 'counterparty_user'
  const {
    currentAssignment,
    assignmentHistory,
    omtsUsers,
    fetchCurrentAssignment,
    fetchAssignmentHistory,
    fetchOmtsUsers,
    assignResponsible,
  } = useAssignmentStore()
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [previewFile, setPreviewFile] = useState<{ fileKey: string; fileName: string; mimeType: string | null } | null>(null)
  const [resubmitFileList, setResubmitFileList] = useState<FileItem[]>([])
  const [resubmitComment, setResubmitComment] = useState('')

  // Модалка отклонения
  const [rejectModalOpen, setRejectModalOpen] = useState(false)
  const [rejectComment, setRejectComment] = useState('')
  const [rejectFiles, setRejectFiles] = useState<{ id: string; file: File }[]>([])

  // Режим редактирования
  const [isEditing, setIsEditing] = useState(false)
  const [editForm] = Form.useForm()
  const [editFileList, setEditFileList] = useState<FileItem[]>([])
  const { fieldOptions, fetchFieldOptions, getOptionsByField } = usePaymentRequestSettingsStore()
  const { sites, fetchSites } = useConstructionSiteStore()
  const { fetchDocumentTypes } = useDocumentTypeStore()

  useEffect(() => {
    if (open && request) {
      clearCurrentData()
      fetchRequestFiles(request.id)
      fetchDecisions(request.id)
      fetchLogs(request.id)
      fetchCurrentAssignment(request.id)
      fetchAssignmentHistory(request.id)
      fetchDocumentTypes() // Загрузка типов документов для FileUploadList

      // Загрузить список ОМТС если user может назначать
      if (user?.role === 'admin') {
        fetchOmtsUsers()
      }
    }
  }, [open, request, fetchRequestFiles, fetchDecisions, fetchLogs, clearCurrentData, fetchCurrentAssignment, fetchAssignmentHistory, fetchDocumentTypes, fetchOmtsUsers, user?.role])

  // Сброс состояния при закрытии
  useEffect(() => {
    if (!open) {
      setResubmitFileList([])
      setResubmitComment('')
      setIsEditing(false)
      setEditFileList([])
      setRejectModalOpen(false)
      setRejectComment('')
      setRejectFiles([])
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
      invoiceAmount: request.invoiceAmount ?? undefined,
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
    const log: { icon: React.ReactNode; text: string; date?: string; files?: ApprovalDecisionFile[] }[] = []

    // Первичная отправка
    log.push({
      icon: <SendOutlined style={{ color: '#1677ff' }} />,
      text: 'Отправлено на согласование',
      date: request.createdAt,
    })

    // Отклонения
    const rejected = currentDecisions.filter((d) => d.status === 'rejected')
    for (const d of rejected) {
      const reason = d.comment ? `Отклонено. Причина: ${d.comment}` : 'Отклонено'
      log.push({
        icon: <CloseCircleOutlined style={{ color: '#f5222d' }} />,
        text: reason,
        date: d.decidedAt ?? undefined,
        files: d.files && d.files.length > 0 ? d.files : undefined
      })
    }

    // Финальное согласование (только когда вся заявка согласована)
    if (request.approvedAt) {
      log.push({
        icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
        text: 'Согласовано',
        date: request.approvedAt,
      })
    }

    // Логи редактирования, догрузки и повторной отправки
    for (const l of currentLogs) {
      if (l.action === 'edit') {
        const changes = (l.details?.changes as { field: string; newValue: unknown }[]) ?? []
        const changedFields = changes.map((c) => fieldLabels[c.field] ?? c.field).join(', ')
        log.push({ icon: <EditOutlined style={{ color: '#722ed1' }} />, text: `Изменено: ${changedFields}`, date: l.createdAt })
      } else if (l.action === 'file_upload') {
        const count = (l.details?.count as number) ?? 0
        log.push({ icon: <FileAddOutlined style={{ color: '#1677ff' }} />, text: `Догружено файлов: ${count}`, date: l.createdAt })
      } else if (l.action === 'resubmit') {
        const comment = (l.details?.comment as string) ?? ''
        const text = comment ? `Повторно отправлено. Комментарий: ${comment}` : 'Повторно отправлено'
        log.push({ icon: <SendOutlined style={{ color: '#1677ff' }} />, text, date: l.createdAt })
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

  /** Объединенный лог для user/admin */
  const adminLog = useMemo(() => {
    type LogEvent = {
      type: 'decision' | 'log'
      date: string
      decision?: ApprovalDecision
      log?: PaymentRequestLog
    }

    const events: LogEvent[] = []

    // Добавляем все решения
    for (const d of currentDecisions) {
      events.push({
        type: 'decision',
        date: d.decidedAt || d.createdAt,
        decision: d,
      })
    }

    // Добавляем все логи
    for (const l of currentLogs) {
      events.push({
        type: 'log',
        date: l.createdAt,
        log: l,
      })
    }

    // Сортируем по дате; pending-записи всегда в конце (у них нет decidedAt)
    events.sort((a, b) => {
      const aPending = a.decision?.status === 'pending'
      const bPending = b.decision?.status === 'pending'
      if (aPending && !bPending) return 1
      if (!aPending && bPending) return -1
      return new Date(a.date).getTime() - new Date(b.date).getTime()
    })

    console.log('[ViewRequestModal] adminLog события:', events.map(e => ({
      type: e.type,
      date: e.date,
      decision: e.decision ? `Этап ${e.decision.stageOrder} ${e.decision.department} ${e.decision.status}` : null,
      log: e.log?.action
    })))

    return events
  }, [currentDecisions, currentLogs])

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
      a.download = `${extractRequestNumber(request.requestNumber)}.zip`
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

  /** Просмотр файла решения об отклонении */
  const handleViewDecisionFile = (fileKey: string, fileName: string, mimeType: string | null) => {
    setPreviewFile({ fileKey, fileName, mimeType })
  }

  /** Скачивание файла решения об отклонении */
  const handleDownloadDecisionFile = async (fileKey: string, fileName: string) => {
    setDownloading(fileKey)
    try {
      // Передаем fileName для установки Content-Disposition: attachment
      const url = await getDownloadUrl(fileKey, 3600, fileName)
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
    // Проверка: если есть файлы, у каждого должен быть указан тип документа
    if (resubmitFileList.length > 0) {
      const filesWithoutType = resubmitFileList.filter((f) => !f.documentTypeId)
      if (filesWithoutType.length > 0) {
        message.error('Укажите тип для каждого файла')
        return
      }
    }
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
        {canApprove && (
          <Popconfirm
            title="Согласование заявки"
            description="Подтвердите согласование заявки"
            onConfirm={() => onApprove?.(request.id, '')}
            okText="Согласовать"
            cancelText="Отмена"
          >
            <Button type="primary" icon={<CheckOutlined />}>Согласовать</Button>
          </Popconfirm>
        )}
        {canApprove && (
          <Button danger icon={<StopOutlined />} onClick={() => setRejectModalOpen(true)}>Отклонить</Button>
        )}
        <Button onClick={onClose}>Закрыть</Button>
      </Space>
    )
  }

  return (
    <>
      <Modal
        title={resubmitMode ? `Повторная отправка — Заявка ${extractRequestNumber(request.requestNumber)}` : `Заявка ${extractRequestNumber(request.requestNumber)}`}
        open={open}
        onCancel={onClose}
        footer={modalFooter}
        width="80%"
        centered
        style={{ maxHeight: '85vh' }}
        styles={{ body: { maxHeight: 'calc(85vh - 120px)', overflowY: 'auto', overflowX: 'hidden' } }}
      >
        {/* Реквизиты — просмотр или редактирование */}
        {isEditing ? (
          <Form form={editForm} layout="vertical" style={{ marginBottom: 16 }}>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="Номер">{extractRequestNumber(request.requestNumber)}</Descriptions.Item>
              <Descriptions.Item label="Подрядчик">{request.counterpartyName}</Descriptions.Item>
            </Descriptions>
            <Form.Item name="siteId" label="Объект" rules={[{ required: true, message: 'Выберите объект' }]}>
              <Select placeholder="Выберите объект" showSearch optionFilterProp="label" options={siteOptions} />
            </Form.Item>
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item label="Срок поставки" required style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Form.Item name="deliveryDays" noStyle rules={[{ required: true, message: 'Укажите срок' }]}>
                      <InputNumber min={1} style={{ width: 80 }} placeholder="Дни" />
                    </Form.Item>
                    <Form.Item name="deliveryDaysType" noStyle>
                      <Select style={{ width: 120 }} options={[
                        { label: 'рабочих', value: 'working' },
                        { label: 'календарных', value: 'calendar' },
                      ]} />
                    </Form.Item>
                  </div>
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="shippingConditionId" label="Условия отгрузки" rules={[{ required: true, message: 'Выберите условия' }]}>
                  <Select placeholder="Выберите условия" options={shippingOptions.map((o) => ({ label: o.value, value: o.id }))} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name="invoiceAmount"
                  label="Сумма счета"
                  rules={[
                    {
                      validator: (_, value) => {
                        if (!value || Number(value) <= 0) {
                          return Promise.reject(new Error('Сумма должна быть больше 0'))
                        }
                        return Promise.resolve()
                      }
                    }
                  ]}
                >
                  <Space.Compact style={{ width: '100%' }}>
                    <InputNumber
                      min={0.01}
                      precision={2}
                      style={{ width: '100%' }}
                      placeholder="Сумма"
                      parser={(value) => Number(value?.replace(',', '.') || 0)}
                    />
                    <Input style={{ width: 50 }} value="₽" readOnly />
                  </Space.Compact>
                </Form.Item>
              </Col>
            </Row>

            {/* Расчет ориентировочного срока поставки при редактировании */}
            <Form.Item noStyle shouldUpdate={(prev, curr) => prev.deliveryDays !== curr.deliveryDays || prev.deliveryDaysType !== curr.deliveryDaysType}>
              {({ getFieldValue }) => (
                <DeliveryCalculation
                  deliveryDays={getFieldValue('deliveryDays')}
                  deliveryDaysType={getFieldValue('deliveryDaysType') || 'working'}
                  defaultExpanded={false}
                />
              )}
            </Form.Item>

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
            <Descriptions.Item label="Номер">{extractRequestNumber(request.requestNumber)}</Descriptions.Item>
            <Descriptions.Item label="Подрядчик">{request.counterpartyName}</Descriptions.Item>
            <Descriptions.Item label="Объект">{request.siteName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Статус">
              <Tag color={request.statusColor ?? 'default'}>{request.statusName}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Срок поставки">{request.deliveryDays} {request.deliveryDaysType === 'calendar' ? 'кал.' : 'раб.'} дн.</Descriptions.Item>
            <Descriptions.Item label="Условия отгрузки">{request.shippingConditionValue}</Descriptions.Item>
            <Descriptions.Item label="Сумма счета">
              {request.invoiceAmount != null
                ? `${request.invoiceAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`
                : '—'
              }
            </Descriptions.Item>
            <Descriptions.Item label="Дата создания">{formatDate(request.createdAt, !isCounterpartyUser)}</Descriptions.Item>
            {request.comment && (
              <Descriptions.Item label="Комментарий" span={2}>{request.comment}</Descriptions.Item>
            )}
          </Descriptions>
        )}

        {/* Расчет ориентировочного срока поставки в режиме просмотра */}
        {!isEditing && (
          <DeliveryCalculation
            deliveryDays={request.deliveryDays}
            deliveryDaysType={request.deliveryDaysType as 'working' | 'calendar'}
            defaultExpanded={false}
          />
        )}

        {/* Блок назначения ответственного (только для ОМТС или admin) */}
        {!isEditing && (user?.department === 'omts' || user?.role === 'admin') && (
          <div style={{ marginTop: 24, marginBottom: 24 }}>
            <Text strong style={{ display: 'block', marginBottom: 12 }}>Ответственный ОМТС</Text>
            <Space orientation="vertical" style={{ width: '100%' }}>
              {user?.role === 'admin' ? (
                <Select
                  value={currentAssignment?.assignedUserId ?? undefined}
                  placeholder="Выберите ответственного"
                  style={{ width: '100%' }}
                  allowClear
                  onChange={async (value) => {
                    if (!request || !user?.id) return
                    try {
                      await assignResponsible(request.id, value, user.id)
                      message.success('Ответственный назначен')
                    } catch {
                      message.error('Ошибка назначения')
                    }
                  }}
                  options={omtsUsers.map((u) => ({
                    label: u.fullName,
                    value: u.id,
                  }))}
                />
              ) : (
                <Text>
                  {currentAssignment?.assignedUserFullName ||
                   currentAssignment?.assignedUserEmail ||
                   'Не назначен'}
                </Text>
              )}

              {/* История назначений */}
              {assignmentHistory.length > 0 && (
                <Collapse ghost>
                  <Collapse.Panel header="История назначений" key="1">
                    <List
                      size="small"
                      dataSource={assignmentHistory}
                      renderItem={(item) => (
                        <List.Item>
                          <Space direction="vertical" size={0}>
                            <Text strong>
                              {item.assignedUserFullName || item.assignedUserEmail}
                            </Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              Назначил: {item.assignedByUserEmail} • {formatDate(item.assignedAt)}
                            </Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Collapse.Panel>
                </Collapse>
              )}
            </Space>
          </div>
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
                    <div style={{ width: '100%' }}>
                      <Space>
                        {item.icon}
                        <Text>{item.text}</Text>
                        {item.date && <Text type="secondary">{formatDate(item.date, false)}</Text>}
                      </Space>
                      {item.files && item.files.length > 0 && (
                        <div style={{ marginLeft: 22, marginTop: 8 }}>
                          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                            Прикрепленные файлы:
                          </Text>
                          <Space direction="vertical" size="small" style={{ width: '100%' }}>
                            {item.files.map((file) => (
                              <div key={file.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Text style={{ flex: 1, fontSize: 12 }}>{file.fileName}</Text>
                                <Space size="small">
                                  <Tooltip title="Просмотр">
                                    <Button
                                      size="small"
                                      icon={<EyeOutlined />}
                                      onClick={() => handleViewDecisionFile(file.fileKey, file.fileName, file.mimeType)}
                                    />
                                  </Tooltip>
                                  <Tooltip title="Скачать">
                                    <Button
                                      size="small"
                                      icon={<DownloadOutlined />}
                                      onClick={() => handleDownloadDecisionFile(file.fileKey, file.fileName)}
                                    />
                                  </Tooltip>
                                </Space>
                              </div>
                            ))}
                          </Space>
                        </div>
                      )}
                    </div>
                  </List.Item>
                )}
              />
            </>
          )
        ) : (
          // Для admin/user — объединенный хронологический лог
          adminLog.length > 0 && (
            <>
              <Text strong style={{ marginBottom: 8, display: 'block' }}>Согласование</Text>
              <List
                size="small"
                dataSource={adminLog}
                style={{ marginBottom: 16 }}
                renderItem={(event) => {
                  if (event.type === 'decision' && event.decision) {
                    const decision = event.decision
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
                        <div style={{ width: '100%' }}>
                          <Space>
                            {icon}
                            <Text>Этап {decision.stageOrder}</Text>
                            <Tag>{DEPARTMENT_LABELS[decision.department]}</Tag>
                            <Text type="secondary">{statusText}</Text>
                            {decision.userEmail && <Text type="secondary">({decision.userEmail})</Text>}
                            {decision.decidedAt && <Text type="secondary">{formatDate(decision.decidedAt)}</Text>}
                          </Space>
                          {decision.comment && (
                            <Text type="secondary" style={{ display: 'block', marginLeft: 22 }}>{decision.comment}</Text>
                          )}
                          {decision.files && decision.files.length > 0 && (
                            <div style={{ marginLeft: 22, marginTop: 8 }}>
                              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                                Прикрепленные файлы:
                              </Text>
                              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                {decision.files.map((file: ApprovalDecisionFile) => (
                                  <div key={file.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Text style={{ flex: 1, fontSize: 12 }}>{file.fileName}</Text>
                                    <Space size="small">
                                      <Tooltip title="Просмотр">
                                        <Button
                                          size="small"
                                          icon={<EyeOutlined />}
                                          onClick={() => handleViewDecisionFile(file.fileKey, file.fileName, file.mimeType)}
                                        />
                                      </Tooltip>
                                      <Tooltip title="Скачать">
                                        <Button
                                          size="small"
                                          icon={<DownloadOutlined />}
                                          onClick={() => handleDownloadDecisionFile(file.fileKey, file.fileName)}
                                        />
                                      </Tooltip>
                                    </Space>
                                  </div>
                                ))}
                              </Space>
                            </div>
                          )}
                        </div>
                      </List.Item>
                    )
                  }

                  if (event.type === 'log' && event.log) {
                    const log = event.log

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

                    if (log.action === 'resubmit') {
                      const comment = (log.details?.comment as string) ?? ''
                      const text = comment ? `Повторно отправлено. Комментарий: ${comment}` : 'Повторно отправлено'
                      return (
                        <List.Item>
                          <Space>
                            <SendOutlined style={{ color: '#1677ff' }} />
                            <Text>{text}</Text>
                            {log.userEmail && <Text type="secondary">({log.userEmail})</Text>}
                            <Text type="secondary">{formatDate(log.createdAt)}</Text>
                          </Space>
                        </List.Item>
                      )
                    }
                  }

                  return null
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

      {/* Модалка отклонения заявки */}
      <Modal
        title="Отклонение заявки"
        open={rejectModalOpen}
        onOk={() => {
          if (!rejectComment.trim()) return
          onReject?.(request.id, rejectComment, rejectFiles.length > 0 ? rejectFiles : undefined)
          setRejectModalOpen(false)
          setRejectComment('')
          setRejectFiles([])
        }}
        onCancel={() => {
          setRejectModalOpen(false)
          setRejectComment('')
          setRejectFiles([])
        }}
        okText="Отклонить"
        okButtonProps={{ danger: true, disabled: !rejectComment.trim() }}
        width={600}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <div>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>Комментарий *</div>
            <TextArea
              rows={3}
              placeholder="Укажите причину отклонения"
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              status={!rejectComment.trim() ? 'error' : undefined}
            />
          </div>
          <div>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>Прикрепить файлы (необязательно)</div>
            <Dragger
              accept={ACCEPT_REJECT_EXTENSIONS}
              multiple
              fileList={[]}
              beforeUpload={(file) => {
                setRejectFiles((prev) => [...prev, { id: crypto.randomUUID(), file }])
                return false
              }}
              showUploadList={false}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">Нажмите или перетащите файлы</p>
              <p className="ant-upload-hint">Поддерживаются: PDF, изображения, Word, Excel</p>
            </Dragger>
            {rejectFiles.length > 0 && (
              <List
                size="small"
                style={{ marginTop: 16 }}
                bordered
                dataSource={rejectFiles}
                renderItem={(item) => (
                  <List.Item
                    actions={[
                      <Button
                        type="text"
                        icon={<CloseOutlined />}
                        size="small"
                        onClick={() => setRejectFiles((prev) => prev.filter((f) => f.id !== item.id))}
                      />,
                    ]}
                  >
                    {item.file.name}
                  </List.Item>
                )}
              />
            )}
          </div>
        </Space>
      </Modal>
    </>
  )
}

export default ViewRequestModal
