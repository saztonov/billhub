import { useEffect, useState } from 'react'
import { Modal, Form, Input, DatePicker, Upload, Button, App, Space, Tooltip } from 'antd'
import { UploadOutlined, EyeOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd/es/upload'
import dayjs from 'dayjs'
import { uploadRequestFile } from '@/services/s3'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import { logError } from '@/services/errorLogger'
import LocalFilePreviewModal from './LocalFilePreviewModal'
import FilePreviewModal from './FilePreviewModal'
import { getMimeFromFileName } from '@/utils/mimeFromExtension'

interface DpInitialData {
  dpNumber: string
  dpDate: string
  dpAmount: number
  dpFileKey: string
  dpFileName: string
}

interface DpFillModalProps {
  open: boolean
  onClose: () => void
  requestId: string
  requestNumber: string
  counterpartyName: string
  initialData?: DpInitialData | null
  defaultAmount?: number | null
}

// Форматирование числа с разделителями тысяч (для предзаполнения)
const formatAmount = (n: number) =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

const DpFillModal = ({ open, onClose, requestId, requestNumber, counterpartyName, initialData, defaultAmount }: DpFillModalProps) => {
  const { message } = App.useApp()
  const updateDpData = usePaymentRequestStore((s) => s.updateDpData)
  const [form] = Form.useForm()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [localPreview, setLocalPreview] = useState<File | null>(null)
  const [remotePreviewOpen, setRemotePreviewOpen] = useState(false)
  const isEditMode = !!initialData

  // Предзаполнение формы при открытии
  useEffect(() => {
    if (!open) return
    if (initialData) {
      form.setFieldsValue({
        dpNumber: initialData.dpNumber,
        dpDate: dayjs(initialData.dpDate),
        dpAmount: formatAmount(initialData.dpAmount),
      })
    } else if (defaultAmount != null) {
      // Создание РП — подставляем согласованную сумму заявки (редактируемое)
      form.setFieldsValue({
        dpAmount: formatAmount(defaultAmount),
      })
    }
  }, [open, initialData, defaultAmount, form])

  const handleOk = async () => {
    let values: { dpNumber: string; dpDate: dayjs.Dayjs; dpAmount: string }
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    if (fileList.length === 0 && !isEditMode) {
      message.error('Прикрепите файл РП')
      return
    }

    setSubmitting(true)
    try {
      let fileKey = initialData?.dpFileKey ?? ''
      let fileName = initialData?.dpFileName ?? ''

      if (fileList.length > 0 && fileList[0].originFileObj) {
        const file = fileList[0].originFileObj as File
        const result = await uploadRequestFile(counterpartyName, requestNumber, file)
        fileKey = result.key
        fileName = file.name
      }

      const amount = Number(String(values.dpAmount).replace(/\s/g, '').replace(',', '.'))

      await updateDpData(requestId, {
        dpNumber: values.dpNumber,
        dpDate: values.dpDate.format('YYYY-MM-DD'),
        dpAmount: amount,
        dpFileKey: fileKey,
        dpFileName: fileName,
      })

      message.success('Данные РП сохранены')
      form.resetFields()
      setFileList([])
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка сохранения РП'
      logError({ errorType: 'api_error', errorMessage: msg, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'DpFillModal.save' } })
      message.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancel = () => {
    form.resetFields()
    setFileList([])
    onClose()
  }

  // Маска суммы
  const amountMask = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.')
    const dotIdx = raw.indexOf('.')
    const clean = dotIdx >= 0 ? raw.slice(0, dotIdx + 1) + raw.slice(dotIdx + 1).replace(/\./g, '') : raw
    const parts = clean.split('.')
    if (parts[1] && parts[1].length > 2) parts[1] = parts[1].slice(0, 2)
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
    return parts.join('.')
  }

  const amountValidator = (_: unknown, value: unknown) => {
    const num = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'))
    if (!value || isNaN(num) || num <= 0) return Promise.reject(new Error('Сумма должна быть больше 0'))
    return Promise.resolve()
  }

  // Файл для предпросмотра: либо вновь выбранный, либо существующий (через ключ)
  const selectedFile = fileList[0]?.originFileObj as File | undefined
  const hasExistingFile = isEditMode && initialData?.dpFileKey && fileList.length === 0
  const existingFileName = initialData?.dpFileName ?? ''

  return (
    <>
      <Modal
        title={isEditMode ? 'Редактировать данные РП' : 'Заполнить данные РП'}
        open={open}
        onOk={handleOk}
        onCancel={handleCancel}
        okText="Сохранить"
        cancelText="Отмена"
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="dpNumber" label="Номер РП" rules={[{ required: true, message: 'Введите номер РП' }]}>
            <Input placeholder="Например: 145821" />
          </Form.Item>
          <Form.Item name="dpDate" label="Дата РП" rules={[{ required: true, message: 'Выберите дату РП' }]}>
            <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} placeholder="Выберите дату" />
          </Form.Item>
          <Form.Item name="dpAmount" label="Сумма РП" rules={[{ validator: amountValidator }]} getValueFromEvent={amountMask}>
            <Input suffix="₽" placeholder="Сумма" />
          </Form.Item>
          <Form.Item label="Файл РП" required>
            <Space wrap>
              <Upload
                fileList={fileList}
                beforeUpload={() => false}
                onChange={({ fileList: fl }) => setFileList(fl.slice(-1))}
                maxCount={1}
                showUploadList={{ showPreviewIcon: false, showRemoveIcon: true }}
              >
                <Button icon={<UploadOutlined />}>Выбрать файл</Button>
              </Upload>
              {selectedFile && (
                <Tooltip title="Предпросмотр выбранного файла">
                  <Button
                    icon={<EyeOutlined />}
                    onClick={() => setLocalPreview(selectedFile)}
                  />
                </Tooltip>
              )}
              {hasExistingFile && (
                <Tooltip title="Просмотр загруженного файла">
                  <Button
                    icon={<EyeOutlined />}
                    onClick={() => setRemotePreviewOpen(true)}
                  >
                    {existingFileName}
                  </Button>
                </Tooltip>
              )}
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <LocalFilePreviewModal
        open={!!localPreview}
        onClose={() => setLocalPreview(null)}
        file={localPreview}
        fileName={localPreview?.name ?? ''}
      />

      {isEditMode && initialData?.dpFileKey && (
        <FilePreviewModal
          open={remotePreviewOpen}
          onClose={() => setRemotePreviewOpen(false)}
          fileKey={initialData.dpFileKey}
          fileName={initialData.dpFileName ?? 'rp-file'}
          mimeType={getMimeFromFileName(initialData.dpFileName)}
        />
      )}
    </>
  )
}

export default DpFillModal
