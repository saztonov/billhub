import { useEffect, useState } from 'react'
import {
  Modal,
  Form,
  Select,
  InputNumber,
  Input,
  Row,
  Col,
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
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import { useUploadQueueStore } from '@/store/uploadQueueStore'

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
  const { sites, fetchSites } = useConstructionSiteStore()
  const addUploadTask = useUploadQueueStore((s) => s.addTask)

  useEffect(() => {
    if (open) {
      fetchFieldOptions()
      if (documentTypes.length === 0) fetchDocumentTypes()
      if (counterparties.length === 0) fetchCounterparties()
      if (sites.length === 0) fetchSites()
    }
  }, [open, fetchFieldOptions, fetchDocumentTypes, fetchCounterparties, fetchSites, documentTypes.length, counterparties.length, sites.length])

  const shippingOptions = getOptionsByField('shipping_conditions')

  // Опции объектов (только активные)
  const siteOptions = sites
    .filter((s) => s.isActive)
    .map((s) => ({ label: s.name, value: s.id }))

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
        message.error('Подрядчик не привязан к пользователю')
        return
      }

      // Получаем имя контрагента для S3-пути
      const cp = counterparties.find((c) => c.id === user.counterpartyId)
      if (!cp) {
        message.error('Подрядчик не найден')
        return
      }

      // Создаём заявку в БД (без загрузки файлов)
      const { requestId, requestNumber } = await createRequest(
        {
          deliveryDays: values.deliveryDays,
          deliveryDaysType: values.deliveryDaysType,
          shippingConditionId: values.shippingConditionId,
          siteId: values.siteId,
          comment: values.comment,
          totalFiles: fileList.length,
        },
        user.counterpartyId,
        user.id,
      )

      // Добавляем файлы в очередь фоновой загрузки
      addUploadTask({
        requestId,
        requestNumber,
        counterpartyName: cp.name,
        files: fileList.map((f) => ({
          file: f.file,
          documentTypeId: f.documentTypeId!,
          pageCount: f.pageCount,
        })),
        userId: user.id,
      })

      message.success('Заявка создана, файлы загружаются...')
      form.resetFields()
      setFileList([])
      setFormValues({})
      onClose()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Ошибка создания заявки'
      message.error(errorMsg)
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
      width={900}
      destroyOnClose
    >
      <Spin spinning={fieldOptions.length === 0 && open}>
        {/* Загрузка файлов */}
        <div style={{ marginBottom: 16 }}>
          <FileUploadList fileList={fileList} onChange={setFileList} />
        </div>

        {/* Поля формы — 2 колонки */}
        <Form
          form={form}
          layout="vertical"
          onValuesChange={handleValuesChange}
        >
          <Form.Item
            name="siteId"
            label={fieldLabel('Объект', !!formValues.siteId)}
            rules={[{ required: true, message: 'Выберите объект' }]}
          >
            <Select
              placeholder="Выберите объект"
              showSearch
              optionFilterProp="label"
              options={siteOptions}
            />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label={fieldLabel('Срок поставки', !!formValues.deliveryDays)}
                required
                style={{ marginBottom: 0 }}
              >
                <div style={{ display: 'flex', gap: 8 }}>
                  <Form.Item
                    name="deliveryDays"
                    noStyle
                    rules={[{ required: true, message: 'Укажите срок' }]}
                  >
                    <InputNumber min={1} style={{ flex: 1 }} placeholder="Кол-во дней" />
                  </Form.Item>
                  <Form.Item
                    name="deliveryDaysType"
                    noStyle
                    initialValue="working"
                  >
                    <Select
                      style={{ width: 150 }}
                      options={[
                        { label: 'рабочих', value: 'working' },
                        { label: 'календарных', value: 'calendar' },
                      ]}
                    />
                  </Form.Item>
                </div>
              </Form.Item>
            </Col>
            <Col span={12}>
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
            </Col>
          </Row>

          <Form.Item name="comment" label="Комментарий">
            <TextArea rows={2} placeholder="Необязательное поле" />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  )
}

export default CreateRequestModal
