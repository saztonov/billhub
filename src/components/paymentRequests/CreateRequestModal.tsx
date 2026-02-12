import { useEffect, useState } from 'react'
import {
  Modal,
  Form,
  Select,
  InputNumber,
  Input,
  message,
  Spin,
} from 'antd'
import { CheckCircleFilled } from '@ant-design/icons'
import FileUploadList from './FileUploadList'
import type { FileItem } from './FileUploadList'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import { usePaymentRequestSettingsStore } from '@/store/paymentRequestSettingsStore'
import { useDocumentTypeStore } from '@/store/documentTypeStore'
import { useAuthStore } from '@/store/authStore'
import { useCounterpartyStore } from '@/store/counterpartyStore'

const { TextArea } = Input

interface CreateRequestModalProps {
  open: boolean
  onClose: () => void
}

/** Зелёная галочка рядом с label, если поле заполнено */
function fieldLabel(label: string, isFilled: boolean) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {label}
      {isFilled && <CheckCircleFilled style={{ color: '#52c41a', fontSize: 14 }} />}
    </span>
  )
}

const CreateRequestModal = ({ open, onClose }: CreateRequestModalProps) => {
  const [form] = Form.useForm()
  const [fileList, setFileList] = useState<FileItem[]>([])
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})

  const user = useAuthStore((s) => s.user)
  const { createRequest, isSubmitting } = usePaymentRequestStore()
  const { fieldOptions, fetchFieldOptions, getOptionsByField } = usePaymentRequestSettingsStore()
  const { documentTypes, fetchDocumentTypes } = useDocumentTypeStore()
  const { counterparties, fetchCounterparties } = useCounterpartyStore()

  useEffect(() => {
    if (open) {
      fetchFieldOptions()
      if (documentTypes.length === 0) fetchDocumentTypes()
      if (counterparties.length === 0) fetchCounterparties()
    }
  }, [open, fetchFieldOptions, fetchDocumentTypes, fetchCounterparties, documentTypes.length, counterparties.length])

  // Определяем, выбрана ли "Срочная"
  const urgencyOptions = getOptionsByField('urgency')
  const urgentOption = urgencyOptions.find((o) => o.value === 'Срочная')
  const isUrgent = formValues.urgencyId === urgentOption?.id
  const shippingOptions = getOptionsByField('shipping_conditions')

  const handleValuesChange = (_: unknown, allValues: Record<string, unknown>) => {
    setFormValues(allValues)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()

      // Проверка: хотя бы один файл с типом
      if (fileList.length === 0) {
        message.error('Добавьте хотя бы один файл')
        return
      }
      const filesWithoutType = fileList.filter((f) => !f.documentTypeId)
      if (filesWithoutType.length > 0) {
        message.error('Укажите тип для каждого файла')
        return
      }

      if (!user?.counterpartyId) {
        message.error('Контрагент не привязан к пользователю')
        return
      }

      // Получаем имя контрагента для S3-пути
      const cp = counterparties.find((c) => c.id === user.counterpartyId)
      if (!cp) {
        message.error('Контрагент не найден')
        return
      }

      await createRequest(
        {
          urgencyId: values.urgencyId,
          urgencyReason: values.urgencyReason,
          deliveryDays: values.deliveryDays,
          shippingConditionId: values.shippingConditionId,
          comment: values.comment,
          files: fileList.map((f) => ({
            file: f.file,
            documentTypeId: f.documentTypeId!,
          })),
        },
        user.counterpartyId,
        cp.name,
        user.id,
      )

      message.success('Заявка создана')
      form.resetFields()
      setFileList([])
      setFormValues({})
      onClose()
    } catch {
      // Ошибка уже обработана в store
    }
  }

  const handleCancel = () => {
    form.resetFields()
    setFileList([])
    setFormValues({})
    onClose()
  }

  return (
    <Modal
      title="Новая заявка на оплату"
      open={open}
      onOk={handleSubmit}
      onCancel={handleCancel}
      okText="Создать"
      cancelText="Отмена"
      confirmLoading={isSubmitting}
      width={700}
      destroyOnClose
    >
      <Spin spinning={fieldOptions.length === 0 && open}>
        {/* Загрузка файлов */}
        <div style={{ marginBottom: 16 }}>
          <FileUploadList fileList={fileList} onChange={setFileList} />
        </div>

        {/* Поля формы */}
        <Form
          form={form}
          layout="vertical"
          onValuesChange={handleValuesChange}
        >
          <Form.Item
            name="urgencyId"
            label={fieldLabel('Срочность', !!formValues.urgencyId)}
            rules={[{ required: true, message: 'Выберите срочность' }]}
          >
            <Select
              placeholder="Выберите срочность"
              options={urgencyOptions.map((o) => ({ label: o.value, value: o.id }))}
            />
          </Form.Item>

          {isUrgent && (
            <Form.Item
              name="urgencyReason"
              label={fieldLabel('Причина срочности', !!formValues.urgencyReason)}
              rules={[{ required: true, message: 'Укажите причину срочности' }]}
            >
              <TextArea rows={2} placeholder="Укажите причину" />
            </Form.Item>
          )}

          <Form.Item
            name="deliveryDays"
            label={fieldLabel('Срок поставки, дней', !!formValues.deliveryDays)}
            rules={[{ required: true, message: 'Укажите срок поставки' }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} placeholder="Количество дней" />
          </Form.Item>

          <Form.Item
            name="shippingConditionId"
            label={fieldLabel('Условия отгрузки', !!formValues.shippingConditionId)}
            rules={[{ required: true, message: 'Выберите условия отгрузки' }]}
          >
            <Select
              placeholder="Выберите условия"
              options={shippingOptions.map((o) => ({ label: o.value, value: o.id }))}
            />
          </Form.Item>

          <Form.Item name="comment" label="Комментарий">
            <TextArea rows={2} placeholder="Необязательное поле" />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  )
}

export default CreateRequestModal
