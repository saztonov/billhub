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
} from 'antd'
import {
  DownloadOutlined,
  EyeOutlined,
  SendOutlined,
  EditOutlined,
  FileAddOutlined,
  CheckOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import type { EditRequestData } from '@/store/paymentRequestStore'
import { useApprovalStore } from '@/store/approvalStore'
import { useAuthStore } from '@/store/authStore'
import { usePaymentRequestSettingsStore } from '@/store/paymentRequestSettingsStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import { useAssignmentStore } from '@/store/assignmentStore'
import { useDocumentTypeStore } from '@/store/documentTypeStore'
import { downloadFileBlob } from '@/services/s3'
import JSZip from 'jszip'
import FilePreviewModal from './FilePreviewModal'
import FileUploadList from './FileUploadList'
import type { FileItem } from './FileUploadList'
import DeliveryCalculation from './DeliveryCalculation'
import ApprovalLog from './ApprovalLog'
import OmtsAssignmentBlock from './OmtsAssignmentBlock'
import RejectModal from './RejectModal'
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

  // Режим редактирования
  const [isEditing, setIsEditing] = useState(false)
  const [editForm] = Form.useForm()
  const [editFileList, setEditFileList] = useState<FileItem[]>([])
  const [showEditFileValidation, setShowEditFileValidation] = useState(false)
  const [showResubmitFileValidation, setShowResubmitFileValidation] = useState(false)
  const [resubmitForm] = Form.useForm()
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
      fetchDocumentTypes()
      if (user?.role === 'admin') fetchOmtsUsers()
    }
  }, [open, request, fetchRequestFiles, fetchDecisions, fetchLogs, clearCurrentData, fetchCurrentAssignment, fetchAssignmentHistory, fetchDocumentTypes, fetchOmtsUsers, user?.role])

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
    }
  }, [open, resubmitForm])

  useEffect(() => {
    if (isEditing || resubmitMode) {
      if (fieldOptions.length === 0) fetchFieldOptions()
      if (sites.length === 0) fetchSites()
    }
  }, [isEditing, resubmitMode, fieldOptions.length, sites.length, fetchFieldOptions, fetchSites])

  const shippingOptions = getOptionsByField('shipping_conditions')
  const siteOptions = sites.filter((s) => s.isActive).map((s) => ({ label: s.name, value: s.id }))

  const startEditing = () => {
    if (!request) return
    editForm.setFieldsValue({
      siteId: request.siteId,
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
        centered
        style={{ maxHeight: '85vh' }}
        styles={{ body: { maxHeight: 'calc(85vh - 120px)', overflowY: 'auto', overflowX: 'hidden' } }}
      >
        {/* Реквизиты */}
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
            <Form.Item name="comment" label="Комментарий">
              <TextArea rows={2} placeholder="Необязательное поле" />
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
            <Descriptions.Item label="Статус"><Tag color={request.statusColor ?? 'default'}>{request.statusName}</Tag></Descriptions.Item>
            <Descriptions.Item label="Срок поставки">{request.deliveryDays} {request.deliveryDaysType === 'calendar' ? 'кал.' : 'раб.'} дн.</Descriptions.Item>
            <Descriptions.Item label="Условия отгрузки">{request.shippingConditionValue}</Descriptions.Item>
            <Descriptions.Item label="Сумма счета">
              {request.invoiceAmount != null
                ? `${request.invoiceAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`
                : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Дата создания">{formatDate(request.createdAt, !isCounterpartyUser)}</Descriptions.Item>
            {request.comment && <Descriptions.Item label="Комментарий" span={2}>{request.comment}</Descriptions.Item>}
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

        <ApprovalLog
          request={request}
          decisions={currentDecisions}
          logs={currentLogs}
          isCounterpartyUser={isCounterpartyUser}
          downloading={downloading}
          onViewFile={handleViewDecisionFile}
          onDownloadFile={handleDownloadDecisionFile}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text strong>Файлы ({currentRequestFiles.length})</Text>
          {currentRequestFiles.length > 0 && (
            <Button size="small" icon={<DownloadOutlined />} loading={downloadingAll} onClick={handleDownloadAll}>Скачать все</Button>
          )}
        </div>
        <Table size="small" columns={fileColumns as any} dataSource={sortedFiles} rowKey="id" loading={isLoading} pagination={false} locale={{ emptyText: 'Нет файлов' }} />

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

      <RejectModal
        open={rejectModalOpen}
        onConfirm={(comment, files) => {
          onReject?.(request.id, comment, files.length > 0 ? files : undefined)
          setRejectModalOpen(false)
        }}
        onCancel={() => setRejectModalOpen(false)}
      />
    </>
  )
}

export default ViewRequestModal
