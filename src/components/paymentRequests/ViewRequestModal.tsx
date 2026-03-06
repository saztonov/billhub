import { useEffect, useMemo, useState } from 'react'
import {
  Modal,
  Descriptions,
  Tag,
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
  Popconfirm,
  Collapse,
} from 'antd'
import {
  DownloadOutlined,
  EyeOutlined,
  SendOutlined,
  EditOutlined,
  FileAddOutlined,
  CheckOutlined,
  StopOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import { usePaymentPaymentStore } from '@/store/paymentPaymentStore'
import type { EditRequestData } from '@/store/paymentRequestStore'
import { useApprovalStore } from '@/store/approvalStore'
import { useAuthStore } from '@/store/authStore'
import { usePaymentRequestSettingsStore } from '@/store/paymentRequestSettingsStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import { useSupplierStore } from '@/store/supplierStore'
import { useAssignmentStore } from '@/store/assignmentStore'
import { useOmtsRpStore } from '@/store/omtsRpStore'
import { useDocumentTypeStore } from '@/store/documentTypeStore'
import { downloadFileBlob } from '@/services/s3'
import JSZip from 'jszip'
import FilePreviewModal from './FilePreviewModal'
import FileUploadList from './FileUploadList'
import type { FileItem } from './FileUploadList'
import DeliveryCalculation from './DeliveryCalculation'
import ApprovalLog from './ApprovalLog'
import OmtsAssignmentBlock from './OmtsAssignmentBlock'
import PaymentsTable from './PaymentsTable'
import CommentsChat from './CommentsChat'
import RejectModal from './RejectModal'
import AddFilesModal from './AddFilesModal'
import { formatSize, formatDate, extractRequestNumber, sanitizeFileName } from '@/utils/requestFormatters'
import type { PaymentRequest, PaymentRequestFile, Department } from '@/types'
import { DEPARTMENT_LABELS } from '@/types'

const { Text } = Typography
const { TextArea } = Input

interface ViewRequestModalProps {
  open: boolean
  request: PaymentRequest | null
  onClose: () => void
  resubmitMode?: boolean
  onResubmit?: (comment: string, files: FileItem[], fieldUpdates: {
    deliveryDays: number
    deliveryDaysType: string
    shippingConditionId: string
    invoiceAmount: number
  }) => void
  canEdit?: boolean
  onEdit?: (id: string, data: EditRequestData, files: FileItem[]) => void
  canApprove?: boolean
  onApprove?: (requestId: string, comment: string) => void
  onReject?: (requestId: string, comment: string, files?: { id: string; file: File }[]) => void
}

const ViewRequestModal = ({ open, request, onClose, resubmitMode, onResubmit, canEdit, onEdit, canApprove, onApprove, onReject }: ViewRequestModalProps) => {
  const { message } = App.useApp()
  const { currentRequestFiles, fetchRequestFiles, fetchRequests, isLoading, isSubmitting } = usePaymentRequestStore()
  const { payments, fetchPayments } = usePaymentPaymentStore()
  const { currentDecisions, currentLogs, fetchDecisions, fetchLogs, clearCurrentData, sendToRevision } = useApprovalStore()
  const omtsRpResponsibleUserId = useOmtsRpStore((s) => s.responsibleUserId)
  const fetchOmtsRpConfig = useOmtsRpStore((s) => s.fetchConfig)
  const fetchOmtsRpSites = useOmtsRpStore((s) => s.fetchSites)
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
  // Комментарий для "На доработку"
  const [revisionComment, setRevisionComment] = useState('')
  const [revisionModalOpen, setRevisionModalOpen] = useState(false)
  const [addFilesModalOpen, setAddFilesModalOpen] = useState(false)

  // Режим редактирования
  const [isEditing, setIsEditing] = useState(false)
  const [editForm] = Form.useForm()
  const [editFileList, setEditFileList] = useState<FileItem[]>([])
  const [showEditFileValidation, setShowEditFileValidation] = useState(false)
  const [showResubmitFileValidation, setShowResubmitFileValidation] = useState(false)
  const [resubmitForm] = Form.useForm()
  const { fieldOptions, fetchFieldOptions, getOptionsByField } = usePaymentRequestSettingsStore()
  const { sites, fetchSites } = useConstructionSiteStore()
  const { suppliers, fetchSuppliers } = useSupplierStore()
  const { fetchDocumentTypes } = useDocumentTypeStore()

  useEffect(() => {
    if (open && request) {
      clearCurrentData()
      fetchRequestFiles(request.id)
      fetchPayments(request.id)
      fetchDecisions(request.id)
      fetchLogs(request.id)
      fetchCurrentAssignment(request.id)
      fetchAssignmentHistory(request.id)
      fetchDocumentTypes()
      if (user?.role === 'admin') fetchOmtsUsers()
      fetchOmtsRpConfig()
      fetchOmtsRpSites()
    }
  }, [open, request, fetchRequestFiles, fetchPayments, fetchDecisions, fetchLogs, clearCurrentData, fetchCurrentAssignment, fetchAssignmentHistory, fetchDocumentTypes, fetchOmtsUsers, user?.role, fetchOmtsRpConfig, fetchOmtsRpSites])

  useEffect(() => {
    if (!open) {
      setResubmitFileList([])
      setResubmitComment('')
      try { resubmitForm.resetFields() } catch { /* форма не подключена к DOM */ }
      setIsEditing(false)
      setEditFileList([])
      setShowEditFileValidation(false)
      setShowResubmitFileValidation(false)
      setRejectModalOpen(false)
      setRevisionComment('')
      setRevisionModalOpen(false)
      setAddFilesModalOpen(false)
    }
  }, [open, resubmitForm])

  useEffect(() => {
    if (isEditing || resubmitMode) {
      if (fieldOptions.length === 0) fetchFieldOptions()
      if (sites.length === 0) fetchSites()
      if (suppliers.length === 0) fetchSuppliers()
    }
  }, [isEditing, resubmitMode, fieldOptions.length, sites.length, suppliers.length, fetchFieldOptions, fetchSites, fetchSuppliers])

  // Сумма оплат и права на управление оплатами
  const paymentsTotalPaid = useMemo(() => payments.reduce((sum, p) => sum + p.amount, 0), [payments])
  const canManagePayments = user?.role === 'admin' || user?.department === 'shtab' || user?.department === 'omts'

  const shippingOptions = getOptionsByField('shipping_conditions')
  const siteOptions = sites.filter((s) => s.isActive).map((s) => ({ label: s.name, value: s.id }))
  const supplierOptions = suppliers.map((s) => ({ label: s.name, value: s.id }))

  const startEditing = () => {
    if (!request) return
    editForm.setFieldsValue({
      siteId: request.siteId,
      supplierId: request.supplierId ?? undefined,
      deliveryDays: request.deliveryDays,
      deliveryDaysType: request.deliveryDaysType,
      shippingConditionId: request.shippingConditionId,
      comment: request.comment ?? '',
      invoiceAmount: request.invoiceAmount != null
        ? (() => {
            const parts = String(request.invoiceAmount).split('.')
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
            return parts.join('.')
          })()
        : undefined,
    })
    setIsEditing(true)
  }

  const handleEditSave = async () => {
    if (!request || !onEdit) return
    try {
      const values = await editForm.validateFields()
      if (editFileList.length > 0) {
        const filesWithoutType = editFileList.filter((f) => !f.documentTypeId)
        if (filesWithoutType.length > 0) {
          setShowEditFileValidation(true)
          message.error('Укажите тип для каждого файла')
          return
        }
      }
      const parsedValues = {
        ...values,
        invoiceAmount: values.invoiceAmount
          ? Number(String(values.invoiceAmount).replace(/\s/g, ''))
          : values.invoiceAmount,
      }
      onEdit(request.id, parsedValues as EditRequestData, editFileList)
      setIsEditing(false)
      setEditFileList([])
      setShowEditFileValidation(false)
    } catch {
      // Ошибки валидации формы
    }
  }

  const handleDownloadAll = async () => {
    if (!currentRequestFiles.length || !request) return
    setDownloadingAll(true)
    try {
      const zip = new JSZip()
      const results = await Promise.allSettled(
        currentRequestFiles.map(async (file) => {
          const blob = await downloadFileBlob(file.fileKey)
          zip.file(sanitizeFileName(file.fileName), blob)
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
      const blob = await downloadFileBlob(fileKey)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(null)
    }
  }

  const handleViewDecisionFile = (fileKey: string, fileName: string, mimeType: string | null) => {
    setPreviewFile({ fileKey, fileName, mimeType })
  }

  const handleDownloadDecisionFile = async (fileKey: string, fileName: string) => {
    setDownloading(fileKey)
    try {
      const blob = await downloadFileBlob(fileKey)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(null)
    }
  }

  const sortedFiles = useMemo(() => {
    return [...currentRequestFiles].sort((a, b) => {
      if (a.isResubmit && !b.isResubmit) return -1
      if (!a.isResubmit && b.isResubmit) return 1
      return 0
    })
  }, [currentRequestFiles])

  const hasResubmitFiles = (request?.resubmitCount ?? 0) > 0
  const hasStaffFiles = sortedFiles.some((f) => f.uploaderRole === 'user' || f.uploaderRole === 'admin')

  const handleResubmitSubmit = async () => {
    let formValues: { deliveryDays: number; deliveryDaysType: string; shippingConditionId: string; invoiceAmount: number }
    try {
      formValues = await resubmitForm.validateFields()
    } catch (err: unknown) {
      const valErr = err as { errorFields?: { errors: string[] }[] }
      if (valErr.errorFields) {
        const msgs = valErr.errorFields.flatMap((f) => f.errors)
        message.error(msgs.join('. '))
      }
      return
    }
    if (resubmitFileList.length > 0) {
      const filesWithoutType = resubmitFileList.filter((f) => !f.documentTypeId)
      if (filesWithoutType.length > 0) {
        setShowResubmitFileValidation(true)
        message.error('Укажите тип для каждого файла')
        return
      }
    }
    onResubmit?.(resubmitComment, resubmitFileList, {
      ...formValues,
      invoiceAmount: Number(String(formValues.invoiceAmount).replace(/\s/g, '')),
    })
  }

  if (!request) return null

  // Колонки таблицы файлов
  const fileColumns: Record<string, unknown>[] = [
    { title: '№', key: 'index', width: 50, render: (_: unknown, __: PaymentRequestFile, index: number) => index + 1 },
    { title: 'Файл', dataIndex: 'fileName', key: 'fileName', width: hasResubmitFiles ? '40%' : '50%', ellipsis: true },
    {
      title: 'Размер', key: 'fileSize', width: 100,
      render: (_: unknown, file: PaymentRequestFile) => (
        <Text type="secondary">
          {formatSize(file.fileSize)}
          {file.pageCount != null && ` · ${file.pageCount} стр.`}
        </Text>
      ),
    },
    {
      title: 'Тип документа', key: 'documentType',
      render: (_: unknown, file: PaymentRequestFile) => file.documentTypeName ? <Tag>{file.documentTypeName}</Tag> : null,
    },
  ]

  if (hasResubmitFiles || hasStaffFiles) {
    fileColumns.push({
      title: 'Догружен', key: 'resubmit', width: 120,
      render: (_: unknown, file: PaymentRequestFile) => {
        if (file.isResubmit) return <Tag color="blue">Подрядчик</Tag>
        if (file.uploaderRole === 'user' || file.uploaderRole === 'admin') {
          const dept = file.uploaderDepartment as Department | null
          const label = dept ? DEPARTMENT_LABELS[dept] : '—'
          return <Tag color="green">{label}</Tag>
        }
        return null
      },
    })
  }

  fileColumns.push({
    title: '', key: 'actions', width: 80,
    render: (_: unknown, file: PaymentRequestFile) => (
      <Space size={4}>
        <Tooltip title="Просмотр">
          <Button icon={<EyeOutlined />} size="small" onClick={() => setPreviewFile(file)} />
        </Tooltip>
        <Tooltip title="Скачать">
          <Button icon={<DownloadOutlined />} size="small" loading={downloading === file.fileKey} onClick={() => handleDownload(file.fileKey, file.fileName)} />
        </Tooltip>
      </Space>
    ),
  })

  // Маска суммы
  const invoiceAmountMask = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.')
    const dotIdx = raw.indexOf('.')
    const clean = dotIdx >= 0 ? raw.slice(0, dotIdx + 1) + raw.slice(dotIdx + 1).replace(/\./g, '') : raw
    const parts = clean.split('.')
    if (parts[1] && parts[1].length > 2) parts[1] = parts[1].slice(0, 2)
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
    return parts.join('.')
  }

  const invoiceAmountValidator = (_: unknown, value: unknown) => {
    const num = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'))
    if (!value || isNaN(num) || num <= 0) return Promise.reject(new Error('Сумма должна быть больше 0'))
    return Promise.resolve()
  }

  // Проверяем, может ли текущий пользователь отправить на доработку (ОМТС РП)
  const hasPendingOmtsRpDecision = currentDecisions.some(
    (d) => d.status === 'pending' && d.isOmtsRp
  )
  const isOmtsRpResponsible = user?.id === omtsRpResponsibleUserId
  const canSendToRevision = canApprove && hasPendingOmtsRpDecision && isOmtsRpResponsible

  const handleSendToRevision = async () => {
    if (!request) return
    try {
      await sendToRevision(request.id, revisionComment)
      message.success('Заявка отправлена на доработку')
      setRevisionModalOpen(false)
      setRevisionComment('')
      fetchDecisions(request.id)
      fetchLogs(request.id)
    } catch {
      message.error('Ошибка отправки на доработку')
    }
  }

  // Footer
  let modalFooter: React.ReactNode
  if (resubmitMode) {
    modalFooter = (
      <Space>
        <Button onClick={onClose}>Отмена</Button>
        <Button type="primary" icon={<SendOutlined />} loading={isSubmitting} onClick={handleResubmitSubmit}>Отправить повторно</Button>
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
        {canEdit && !isCounterpartyUser && <Button icon={<EditOutlined />} onClick={startEditing}>Редактировать</Button>}
        {canApprove && (
          <Popconfirm title="Согласование заявки" description="Подтвердите согласование заявки" onConfirm={() => onApprove?.(request.id, '')} okText="Согласовать" cancelText="Отмена">
            <Button type="primary" icon={<CheckOutlined />}>Согласовать</Button>
          </Popconfirm>
        )}
        {canSendToRevision && <Button icon={<EditOutlined />} style={{ borderColor: '#faad14', color: '#faad14' }} onClick={() => setRevisionModalOpen(true)}>На доработку</Button>}
        {canApprove && <Button danger icon={<StopOutlined />} onClick={() => setRejectModalOpen(true)}>Отклонить</Button>}
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
        maskClosable={false}
        centered
        style={{ maxHeight: '85vh' }}
        styles={{ body: { maxHeight: 'calc(85vh - 120px)', overflowY: 'auto', overflowX: 'hidden' } }}
      >
        {/* Реквизиты */}
        {isEditing ? (
          <Form form={editForm} layout="vertical" style={{ marginBottom: 16 }}>
            <Descriptions column={2} size="small" bordered={false} style={{ marginBottom: 4 }}>
              <Descriptions.Item label="Номер">{extractRequestNumber(request.requestNumber)}</Descriptions.Item>
              <Descriptions.Item label="Подрядчик">{request.counterpartyName}</Descriptions.Item>
            </Descriptions>
            <Row gutter={8}>
              <Col span={6}>
                <Form.Item name="siteId" label="Объект" rules={[{ required: true, message: 'Выберите объект' }]}>
                  <Select placeholder="Выберите объект" showSearch optionFilterProp="label" options={siteOptions} />
                </Form.Item>
              </Col>
              <Col span={5}>
                <Form.Item name="supplierId" label="Поставщик">
                  <Select placeholder="Выберите поставщика" showSearch allowClear optionFilterProp="label" options={supplierOptions} />
                </Form.Item>
              </Col>
              <Col span={5}>
                <Form.Item label="Срок поставки" required style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Form.Item name="deliveryDays" noStyle rules={[{ required: true, message: 'Укажите срок' }]}>
                      <InputNumber min={1} style={{ width: 70 }} placeholder="Дни" />
                    </Form.Item>
                    <Form.Item name="deliveryDaysType" noStyle>
                      <Select style={{ width: 100 }} options={[{ label: 'раб.', value: 'working' }, { label: 'кал.', value: 'calendar' }]} />
                    </Form.Item>
                  </div>
                </Form.Item>
              </Col>
              <Col span={5}>
                <Form.Item name="shippingConditionId" label="Условия отгрузки" rules={[{ required: true, message: 'Выберите условия' }]}>
                  <Select placeholder="Выберите условия" options={shippingOptions.map((o) => ({ label: o.value, value: o.id }))} />
                </Form.Item>
              </Col>
              <Col span={3}>
                <Form.Item name="invoiceAmount" label="Сумма счета" rules={[{ validator: invoiceAmountValidator }]} getValueFromEvent={invoiceAmountMask}>
                  <Input addonAfter="₽" style={{ width: '100%' }} placeholder="Сумма" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item noStyle shouldUpdate={(prev, curr) => prev.deliveryDays !== curr.deliveryDays || prev.deliveryDaysType !== curr.deliveryDaysType || prev.shippingConditionId !== curr.shippingConditionId}>
              {({ getFieldValue }) => (
                <DeliveryCalculation deliveryDays={getFieldValue('deliveryDays')} deliveryDaysType={getFieldValue('deliveryDaysType') || 'working'} shippingConditionId={getFieldValue('shippingConditionId')} defaultExpanded={false} />
              )}
            </Form.Item>
            <Text strong style={{ display: 'block', marginBottom: 8 }}><FileAddOutlined /> Догрузить файлы</Text>
            <FileUploadList fileList={editFileList} onChange={setEditFileList} showValidation={showEditFileValidation} />
          </Form>
        ) : resubmitMode ? (
          <>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Номер">{extractRequestNumber(request.requestNumber)}</Descriptions.Item>
              <Descriptions.Item label="Подрядчик">{request.counterpartyName}</Descriptions.Item>
              <Descriptions.Item label="Объект">{request.siteName ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Статус"><Tag color={request.statusColor ?? 'default'}>{request.statusName}</Tag></Descriptions.Item>
              <Descriptions.Item label="Дата создания">{formatDate(request.createdAt, !isCounterpartyUser)}</Descriptions.Item>
            </Descriptions>
            <Form form={resubmitForm} layout="vertical" style={{ marginBottom: 16 }}>
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item label="Срок поставки" required style={{ marginBottom: 0 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Form.Item name="deliveryDays" noStyle rules={[{ required: true, message: 'Укажите срок' }]}>
                        <InputNumber min={1} style={{ width: 80 }} placeholder="Дни" />
                      </Form.Item>
                      <Form.Item name="deliveryDaysType" noStyle initialValue="working">
                        <Select style={{ width: 120 }} options={[{ label: 'рабочих', value: 'working' }, { label: 'календарных', value: 'calendar' }]} />
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
                  <Form.Item name="invoiceAmount" label="Сумма счета" required rules={[{ validator: invoiceAmountValidator }]} getValueFromEvent={invoiceAmountMask}>
                    <Input addonAfter="₽" style={{ width: '100%' }} placeholder="Сумма" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item noStyle shouldUpdate={(prev, curr) => prev.deliveryDays !== curr.deliveryDays || prev.deliveryDaysType !== curr.deliveryDaysType || prev.shippingConditionId !== curr.shippingConditionId}>
                {({ getFieldValue }) => (
                  <DeliveryCalculation deliveryDays={getFieldValue('deliveryDays')} deliveryDaysType={getFieldValue('deliveryDaysType') || 'working'} shippingConditionId={getFieldValue('shippingConditionId')} defaultExpanded={false} />
                )}
              </Form.Item>
            </Form>
          </>
        ) : (
          <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Номер">{extractRequestNumber(request.requestNumber)}</Descriptions.Item>
            <Descriptions.Item label="Подрядчик">{request.counterpartyName}</Descriptions.Item>
            <Descriptions.Item label="Объект">{request.siteName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Поставщик">{request.supplierName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Статус"><Tag color={request.statusColor ?? 'default'}>{request.statusName}</Tag></Descriptions.Item>
            <Descriptions.Item label="Срок поставки">{request.deliveryDays} {request.deliveryDaysType === 'calendar' ? 'кал.' : 'раб.'} дн.</Descriptions.Item>
            <Descriptions.Item label="Условия отгрузки">{request.shippingConditionValue}</Descriptions.Item>
            <Descriptions.Item label="Сумма счета">
              {request.invoiceAmount != null
                ? `${request.invoiceAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`
                : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Оплачено">
              {paymentsTotalPaid > 0
                ? `${paymentsTotalPaid.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`
                : '0,00 ₽'}
            </Descriptions.Item>
            <Descriptions.Item label="Статус оплаты">
              <Tag color={request.paidStatusColor ?? 'default'}>{request.paidStatusName ?? '—'}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Дата создания">{formatDate(request.createdAt, !isCounterpartyUser)}</Descriptions.Item>
          </Descriptions>
        )}

        {!isEditing && !resubmitMode && (
          <DeliveryCalculation deliveryDays={request.deliveryDays} deliveryDaysType={request.deliveryDaysType as 'working' | 'calendar'} shippingConditionId={request.shippingConditionId} defaultExpanded={false} />
        )}

        {!isEditing && (user?.department === 'omts' || user?.role === 'admin') && (
          <OmtsAssignmentBlock
            request={request}
            isAdmin={user?.role === 'admin'}
            userId={user?.id}
            currentAssignment={currentAssignment}
            assignmentHistory={assignmentHistory}
            omtsUsers={omtsUsers}
            assignResponsible={assignResponsible}
          />
        )}

        {request.invoiceAmountHistory && request.invoiceAmountHistory.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>История сумм</Text>
            {request.invoiceAmountHistory.map((entry, idx) => (
              <div key={idx} style={{ marginBottom: 4 }}>
                <Text type="secondary">
                  Сумма {idx + 1}-й заявки: {entry.amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽
                  {' '}({formatDate(entry.changedAt, false)})
                </Text>
              </div>
            ))}
          </div>
        )}

        <Collapse
          defaultActiveKey={['approval']}
          style={{ marginBottom: 12 }}
          items={[{
            key: 'approval',
            label: 'Согласование',
            children: (
              <ApprovalLog
                request={request}
                decisions={currentDecisions}
                logs={currentLogs}
                isCounterpartyUser={isCounterpartyUser}
                downloading={downloading}
                onViewFile={handleViewDecisionFile}
                onDownloadFile={handleDownloadDecisionFile}
              />
            ),
          }]}
        />

        <Collapse
          defaultActiveKey={['files']}
          style={{ marginBottom: 12 }}
          items={[{
            key: 'files',
            label: `Файлы (${currentRequestFiles.length})`,
            extra: (
              <Space size={4} onClick={(e) => e.stopPropagation()}>
                {!isEditing && !resubmitMode && (
                  <Button size="small" icon={<PlusOutlined />} onClick={() => setAddFilesModalOpen(true)}>Добавить</Button>
                )}
                {currentRequestFiles.length > 0 && (
                  <Button size="small" icon={<DownloadOutlined />} loading={downloadingAll} onClick={handleDownloadAll}>Скачать все</Button>
                )}
              </Space>
            ),
            children: (
              <Table size="small" columns={fileColumns as any} dataSource={sortedFiles} rowKey="id" loading={isLoading} pagination={false} locale={{ emptyText: 'Нет файлов' }} />
            ),
          }]}
        />

        {!isEditing && !resubmitMode && request && (
          <Collapse
            defaultActiveKey={['payments']}
            style={{ marginBottom: 12 }}
            items={[{
              key: 'payments',
              label: 'Оплаты',
              children: (
                <PaymentsTable
                  paymentRequestId={request.id}
                  counterpartyName={request.counterpartyName ?? ''}
                  canManage={!!canManagePayments}
                  onTotalChanged={() => fetchRequests()}
                />
              ),
            }]}
          />
        )}

        {request && (
          <Collapse
            defaultActiveKey={['comments']}
            style={{ marginBottom: 12 }}
            items={[{
              key: 'comments',
              label: 'Комментарии',
              children: (
                <CommentsChat paymentRequestId={request.id} />
              ),
            }]}
          />
        )}

        {resubmitMode && (
          <div style={{ marginTop: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>Догрузить файлы</Text>
            <FileUploadList fileList={resubmitFileList} onChange={setResubmitFileList} showValidation={showResubmitFileValidation} />
            <Text strong style={{ display: 'block', marginTop: 16, marginBottom: 8 }}>Комментарий к повторной отправке</Text>
            <TextArea rows={3} placeholder="Необязательное поле" value={resubmitComment} onChange={(e) => setResubmitComment(e.target.value)} />
          </div>
        )}
      </Modal>

      <FilePreviewModal open={!!previewFile} onClose={() => setPreviewFile(null)} fileKey={previewFile?.fileKey ?? null} fileName={previewFile?.fileName ?? ''} mimeType={previewFile?.mimeType ?? null} />

      <AddFilesModal
        open={addFilesModalOpen}
        onClose={() => { setAddFilesModalOpen(false); if (request) fetchRequestFiles(request.id) }}
        requestId={request.id}
        requestNumber={request.requestNumber}
        counterpartyName={request.counterpartyName ?? ''}
      />

      <RejectModal
        open={rejectModalOpen}
        onConfirm={(comment, files) => {
          onReject?.(request.id, comment, files.length > 0 ? files : undefined)
          setRejectModalOpen(false)
        }}
        onCancel={() => setRejectModalOpen(false)}
      />

      <Modal
        title="На доработку"
        open={revisionModalOpen}
        onOk={handleSendToRevision}
        onCancel={() => { setRevisionModalOpen(false); setRevisionComment('') }}
        okText="Отправить"
        cancelText="Отмена"
      >
        <TextArea
          rows={3}
          placeholder="Комментарий (необязательно)"
          value={revisionComment}
          onChange={(e) => setRevisionComment(e.target.value)}
        />
      </Modal>
    </>
  )
}

export default ViewRequestModal
