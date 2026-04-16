import { useState, useMemo, useCallback } from 'react'
import {
  Table,
  Button,
  Space,
  Typography,
  Tooltip,
  Popconfirm,
  Modal,
  Form,
  DatePicker,
  InputNumber,
  Upload,
  App,
  Tag,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  DownloadOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { usePaymentPaymentStore } from '@/store/paymentPaymentStore'
import { useAuthStore } from '@/store/authStore'
import { uploadPaymentFile, downloadFileBlob } from '@/services/s3'
import { checkFileMagicBytes } from '@/utils/fileValidation'
import { useNativeDropZone } from '@/hooks/useNativeDropZone'
import FilePreviewModal from '@/components/paymentRequests/FilePreviewModal'
import type { PaymentPayment, PaymentPaymentFile } from '@/types'

const { Text } = Typography

// Допустимые MIME-типы
const ACCEPTED_TYPES = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/bmp',
  'application/pdf',
  'image/vnd.dwg',
]
const ACCEPT_EXTENSIONS = '.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.tiff,.tif,.bmp,.pdf,.dwg,.rtf'
const MAX_FILE_SIZE_MB = Number(import.meta.env.VITE_MAX_FILE_SIZE_MB) || 100
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

interface PaymentsTableProps {
  paymentRequestId: string
  counterpartyName: string
  canManage: boolean
  onTotalChanged?: () => void
}

interface PendingFile {
  id: string
  file: File
}

const PaymentsTable = ({ paymentRequestId, counterpartyName, canManage, onTotalChanged }: PaymentsTableProps) => {
  const { message } = App.useApp()
  const { payments, isLoading, isSubmitting, createPayment, updatePayment, deletePayment, addPaymentFile, removePaymentFile, fetchPayments } = usePaymentPaymentStore()
  const user = useAuthStore((s) => s.user)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingPayment, setEditingPayment] = useState<PaymentPayment | null>(null)
  const [form] = Form.useForm()
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [downloading, setDownloading] = useState<string | null>(null)

  const handleNativeDrop = useCallback((files: File[]) => {
    for (const f of files) handleFileBeforeUpload(f)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const { ref: dropZoneRef, isDragOver } = useNativeDropZone(handleNativeDrop)
  const [previewFile, setPreviewFile] = useState<{ fileKey: string; fileName: string; mimeType: string | null } | null>(null)

  const totalPaid = useMemo(() => payments.filter(p => p.isExecuted).reduce((sum, p) => sum + p.amount, 0), [payments])

  const handleAdd = () => {
    setEditingPayment(null)
    form.resetFields()
    setPendingFiles([])
    setModalOpen(true)
  }

  const handleEdit = (payment: PaymentPayment) => {
    setEditingPayment(payment)
    form.setFieldsValue({
      paymentDate: dayjs(payment.paymentDate),
      amount: payment.amount,
    })
    setPendingFiles([])
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    if (!user) return
    try {
      const values = await form.validateFields()
      const paymentDate = values.paymentDate.format('YYYY-MM-DD')

      if (editingPayment) {
        await updatePayment(editingPayment.id, {
          paymentDate,
          amount: values.amount,
        }, user.id)

        // Загружаем новые файлы
        for (const pf of pendingFiles) {
          const { key } = await uploadPaymentFile(counterpartyName, editingPayment.id, pf.file)
          await addPaymentFile(editingPayment.id, {
            fileName: pf.file.name,
            fileKey: key,
            fileSize: pf.file.size,
            mimeType: pf.file.type || null,
          }, user.id)
        }

        message.success('Оплата обновлена')
      } else {
        const paymentId = await createPayment(paymentRequestId, {
          paymentDate,
          amount: values.amount,
        }, user.id)

        // Загружаем файлы
        for (const pf of pendingFiles) {
          const { key } = await uploadPaymentFile(counterpartyName, paymentId, pf.file)
          await addPaymentFile(paymentId, {
            fileName: pf.file.name,
            fileKey: key,
            fileSize: pf.file.size,
            mimeType: pf.file.type || null,
          }, user.id)
        }

        if (pendingFiles.length > 0) {
          await fetchPayments(paymentRequestId)
        }
        message.success('Оплата добавлена')
      }

      setModalOpen(false)
      setPendingFiles([])
      onTotalChanged?.()
    } catch {
      // Ошибки валидации формы
    }
  }

  const handleDelete = async (id: string) => {
    await deletePayment(id)
    message.success('Оплата удалена')
    onTotalChanged?.()
  }

  const handleRemoveFile = async (fileId: string, fileKey: string, paymentId: string) => {
    await removePaymentFile(fileId, fileKey, paymentId)
    await fetchPayments(paymentRequestId)
    message.success('Файл удалён')
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

  const handleFileBeforeUpload = async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      message.error(`Тип файла "${file.name}" не поддерживается`)
      return Upload.LIST_IGNORE
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      message.error(`Файл "${file.name}" превышает ${MAX_FILE_SIZE_MB} МБ`)
      return Upload.LIST_IGNORE
    }
    const valid = await checkFileMagicBytes(file)
    if (!valid) {
      message.error(`Файл "${file.name}" не прошёл проверку`)
      return Upload.LIST_IGNORE
    }
    setPendingFiles((prev) => [...prev, { id: crypto.randomUUID(), file }])
    return Upload.LIST_IGNORE
  }

  const formatAmount = (amount: number) =>
    amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽'

  const columns: Record<string, unknown>[] = [
    {
      title: '№', dataIndex: 'paymentNumber', key: 'paymentNumber', width: 60,
    },
    {
      title: 'Дата оплаты', dataIndex: 'paymentDate', key: 'paymentDate', width: 130,
      render: (date: string) => dayjs(date).format('DD.MM.YYYY'),
    },
    {
      title: 'Сумма', dataIndex: 'amount', key: 'amount', width: 160, align: 'right' as const,
      render: (amount: number) => formatAmount(amount),
    },
    {
      title: 'Оплата', dataIndex: 'isExecuted', key: 'isExecuted', width: 130,
      render: (isExecuted: boolean) => isExecuted
        ? <Tag color="green">Исполнена</Tag>
        : <Tag color="orange">Планируется</Tag>,
    },
    {
      title: 'Платежные поручения', key: 'files',
      render: (_: unknown, record: PaymentPayment) => (
        <Space size={4} wrap>
          {record.files.map((f: PaymentPaymentFile) => (
            <Space key={f.id} size={2}>
              <Tooltip title={f.fileName}>
                <Button
                  size="small"
                  type="link"
                  style={{ padding: 0, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  onClick={() => setPreviewFile({ fileKey: f.fileKey, fileName: f.fileName, mimeType: f.mimeType })}
                >
                  {f.fileName}
                </Button>
              </Tooltip>
              <Tooltip title="Скачать">
                <Button icon={<DownloadOutlined />} size="small" type="text" loading={downloading === f.fileKey} onClick={() => handleDownload(f.fileKey, f.fileName)} />
              </Tooltip>
              {canManage && (
                <Popconfirm title="Удалить файл?" onConfirm={() => handleRemoveFile(f.id, f.fileKey, record.id)}>
                  <Button icon={<DeleteOutlined />} size="small" type="text" danger />
                </Popconfirm>
              )}
            </Space>
          ))}
          {record.files.length === 0 && <Text type="secondary">—</Text>}
        </Space>
      ),
    },
  ]

  if (canManage) {
    columns.push({
      title: '', key: 'actions', width: 80,
      render: (_: unknown, record: PaymentPayment) => (
        <Space size={4}>
          <Tooltip title="Редактировать">
            <Button icon={<EditOutlined />} size="small" onClick={() => handleEdit(record)} />
          </Tooltip>
          <Popconfirm title="Удалить оплату?" onConfirm={() => handleDelete(record.id)}>
            <Tooltip title="Удалить">
              <Button icon={<DeleteOutlined />} danger size="small" />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    })
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text strong>Оплаты</Text>
        {canManage && (
          <Button size="small" icon={<PlusOutlined />} onClick={handleAdd}>Добавить оплату</Button>
        )}
      </div>

      <Table
        size="small"
        columns={columns as any}
        dataSource={payments}
        rowKey="id"
        loading={isLoading}
        pagination={false}
        locale={{ emptyText: 'Нет оплат' }}
        summary={() => {
          if (payments.length === 0) return null
          return (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} />
              <Table.Summary.Cell index={1}>
                <Text strong>Итого</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right">
                <Text strong>{formatAmount(totalPaid)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3} />
              <Table.Summary.Cell index={4} />
              {canManage && <Table.Summary.Cell index={5} />}
            </Table.Summary.Row>
          )
        }}
      />

      {/* Модал добавления/редактирования оплаты */}
      <Modal
        title={editingPayment ? 'Редактирование оплаты' : 'Новая оплата'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => { setModalOpen(false); setPendingFiles([]) }}
        okText="Сохранить"
        cancelText="Отмена"
        confirmLoading={isSubmitting}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="paymentDate" label="Дата оплаты" rules={[{ required: true, message: 'Укажите дату' }]}>
            <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="amount" label="Сумма" rules={[{ required: true, message: 'Укажите сумму' }, { type: 'number', min: 0.01, message: 'Сумма должна быть больше 0' }]}>
            <InputNumber min={0.01} step={0.01} style={{ width: '100%' }} suffix="₽" precision={2} />
          </Form.Item>
        </Form>

        {/* Существующие файлы (при редактировании) */}
        {editingPayment && editingPayment.files.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Прикреплённые файлы:</Text>
            {editingPayment.files.map((f) => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Text style={{ flex: 1 }} ellipsis>{f.fileName}</Text>
                <Button icon={<EyeOutlined />} size="small" type="text" onClick={() => setPreviewFile({ fileKey: f.fileKey, fileName: f.fileName, mimeType: f.mimeType })} />
                <Popconfirm title="Удалить файл?" onConfirm={() => handleRemoveFile(f.id, f.fileKey, editingPayment.id)}>
                  <Button icon={<DeleteOutlined />} size="small" type="text" danger />
                </Popconfirm>
              </div>
            ))}
          </div>
        )}

        {/* Загрузка новых файлов */}
        <div>
          <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Добавить документы:</Text>
          <div ref={dropZoneRef}>
            <Upload.Dragger
              multiple
              accept={ACCEPT_EXTENSIONS}
              beforeUpload={handleFileBeforeUpload as any}
              showUploadList={false}
              style={{ borderColor: isDragOver ? '#1677ff' : undefined, background: isDragOver ? '#e6f4ff' : undefined }}
            >
              <p><UploadOutlined style={{ fontSize: 24, color: '#999' }} /></p>
              <p style={{ margin: 0 }}>Перетащите файлы или нажмите для выбора</p>
            </Upload.Dragger>
          </div>
          {pendingFiles.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {pendingFiles.map((pf) => (
                <div key={pf.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Text style={{ flex: 1 }} ellipsis>{pf.file.name}</Text>
                  <Button icon={<DeleteOutlined />} size="small" type="text" danger onClick={() => setPendingFiles((prev) => prev.filter((f) => f.id !== pf.id))} />
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      <FilePreviewModal
        open={!!previewFile}
        onClose={() => setPreviewFile(null)}
        fileKey={previewFile?.fileKey ?? null}
        fileName={previewFile?.fileName ?? ''}
        mimeType={previewFile?.mimeType ?? null}
      />
    </div>
  )
}

export default PaymentsTable
