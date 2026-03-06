import { useState } from 'react'
import { Modal, Form, Input, DatePicker, Upload, Button, App } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd/es/upload'
import dayjs from 'dayjs'
import { uploadRequestFile } from '@/services/s3'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import { logError } from '@/services/errorLogger'

interface DpFillModalProps {
  open: boolean
  onClose: () => void
  requestId: string
  requestNumber: string
  counterpartyName: string
}

const DpFillModal = ({ open, onClose, requestId, requestNumber, counterpartyName }: DpFillModalProps) => {
  const { message } = App.useApp()
  const updateDpData = usePaymentRequestStore((s) => s.updateDpData)
  const [form] = Form.useForm()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [submitting, setSubmitting] = useState(false)

  const handleOk = async () => {
    let values: { dpNumber: string; dpDate: dayjs.Dayjs; dpAmount: string }
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    if (fileList.length === 0) {
      message.error('Прикрепите файл РП')
      return
    }

    setSubmitting(true)
    try {
      const file = fileList[0].originFileObj as File
      const { key } = await uploadRequestFile(counterpartyName, requestNumber, file)

      const amount = Number(String(values.dpAmount).replace(/\s/g, '').replace(',', '.'))

      await updateDpData(requestId, {
        dpNumber: values.dpNumber,
        dpDate: values.dpDate.format('YYYY-MM-DD'),
        dpAmount: amount,
        dpFileKey: key,
        dpFileName: file.name,
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

  return (
    <Modal
      title="Заполнить данные РП"
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      okText="Сохранить"
      cancelText="Отмена"
      confirmLoading={submitting}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="dpNumber" label="Номер РП" rules={[{ required: true, message: 'Введите номер РП' }]}>
          <Input placeholder="Например: 145821" />
        </Form.Item>
        <Form.Item name="dpDate" label="Дата РП" rules={[{ required: true, message: 'Выберите дату РП' }]}>
          <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} placeholder="Выберите дату" />
        </Form.Item>
        <Form.Item name="dpAmount" label="Сумма РП" rules={[{ validator: amountValidator }]} getValueFromEvent={amountMask}>
          <Input addonAfter="₽" placeholder="Сумма" />
        </Form.Item>
        <Form.Item label="Файл РП" required>
          <Upload
            fileList={fileList}
            beforeUpload={() => false}
            onChange={({ fileList: fl }) => setFileList(fl.slice(-1))}
            maxCount={1}
          >
            <Button icon={<UploadOutlined />}>Выбрать файл</Button>
          </Upload>
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default DpFillModal
