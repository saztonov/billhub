import { useEffect, useState, useMemo } from 'react'
import { Modal, Form, Input, DatePicker, Upload, Button, App, Space, Tooltip, Row, Col } from 'antd'
import { UploadOutlined, EyeOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd/es/upload'
import dayjs from 'dayjs'
import { uploadRequestFile } from '@/services/s3'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import { logError } from '@/services/errorLogger'
import DpFillPreviewPane from './DpFillPreviewPane'

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
  const [previewExpanded, setPreviewExpanded] = useState(false)
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

  // Сброс split-режима при закрытии модалки
  useEffect(() => {
    if (!open) setPreviewExpanded(false)
  }, [open])

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
      setPreviewExpanded(false)
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
    setPreviewExpanded(false)
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

  // Что показывать в превью: новый выбранный файл приоритетнее загруженного
  const selectedFile = fileList[0]?.originFileObj as File | undefined
  const existingFileKey = isEditMode ? initialData?.dpFileKey ?? null : null
  const existingFileName = initialData?.dpFileName ?? ''
  const hasAnyFile = !!selectedFile || !!existingFileKey

  // Имя файла для превью
  const previewFileName = selectedFile?.name ?? existingFileName

  // Автоматически сворачиваем превью, если в split-режиме файл пропал (например, удалили выбранный, а загруженного нет)
  useEffect(() => {
    if (previewExpanded && !hasAnyFile) setPreviewExpanded(false)
  }, [previewExpanded, hasAnyFile])

  const togglePreview = () => setPreviewExpanded((v) => !v)

  // Параметры Modal в зависимости от режима
  const modalWidth = previewExpanded ? '95vw' : undefined
  const modalStyle = useMemo(
    () => (previewExpanded ? { top: 20, maxWidth: 1600, paddingBottom: 0 } : undefined),
    [previewExpanded],
  )
  const bodyStyle = previewExpanded
    ? { padding: 0, maxHeight: 'calc(95vh - 110px)', overflow: 'hidden' as const }
    : undefined

  // Форма РП — выносим в переменную, чтобы переиспользовать в обоих режимах
  const formNode = (
    <Form form={form} layout="vertical" style={{ marginTop: previewExpanded ? 0 : 16 }}>
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
          {hasAnyFile && (
            <Tooltip title={previewExpanded ? 'Свернуть превью' : 'Показать превью файла'}>
              <Button
                icon={<EyeOutlined />}
                type={previewExpanded ? 'primary' : 'default'}
                onClick={togglePreview}
              >
                {previewExpanded ? 'Скрыть превью' : 'Просмотр'}
              </Button>
            </Tooltip>
          )}
        </Space>
      </Form.Item>
    </Form>
  )

  return (
    <Modal
      title={isEditMode ? 'Редактировать данные РП' : 'Заполнить данные РП'}
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      okText="Сохранить"
      cancelText="Отмена"
      confirmLoading={submitting}
      destroyOnHidden
      width={modalWidth}
      style={modalStyle}
      styles={bodyStyle ? { body: bodyStyle } : undefined}
    >
      {previewExpanded ? (
        <Row gutter={0} style={{ height: 'calc(95vh - 110px)' }}>
          <Col xs={24} lg={16} style={{ borderRight: '1px solid #f0f0f0', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <DpFillPreviewPane
              file={selectedFile ?? null}
              fileKey={selectedFile ? null : existingFileKey}
              fileName={previewFileName}
              onCollapse={() => setPreviewExpanded(false)}
              height="100%"
            />
          </Col>
          <Col xs={24} lg={8} style={{ padding: 16, overflow: 'auto', height: '100%' }}>
            {formNode}
          </Col>
        </Row>
      ) : (
        formNode
      )}
    </Modal>
  )
}

export default DpFillModal
