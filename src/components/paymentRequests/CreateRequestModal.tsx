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
import DeliveryCalculation from './DeliveryCalculation'
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
  const isCounterpartyUser = user?.role === 'counterparty_user'

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

  // Опции контрагентов (только активные)
  const counterpartyOptions = counterparties
    .filter((c) => c.isActive !== false)
    .map((c) => ({ label: c.name, value: c.id }))

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

      // Определяем counterpartyId в зависимости от роли
      const counterpartyId = isCounterpartyUser ? user?.counterpartyId : values.counterpartyId

      if (!counterpartyId) {
        message.error('Подрядчик не выбран')
        return
      }

      // Получаем имя контрагента для S3-пути
      const cp = counterparties.find((c) => c.id === counterpartyId)
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
        counterpartyId,
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
      width="80%"
      style={{ maxHeight: '90vh' }}
      styles={{ body: { maxHeight: 'calc(90vh - 110px)', overflowY: 'auto', overflowX: 'hidden' } }}
      maskClosable={false}
      destroyOnClose
    >
      <Spin spinning={fieldOptions.length === 0 && open}>
        {/* Поля формы */}
        <Form
          form={form}
          layout="vertical"
          onValuesChange={handleValuesChange}
        >
          <Row gutter={4}>
            {/* Поле выбора контрагента - только для user и admin */}
            {!isCounterpartyUser && (
              <Col span={6}>
                <Form.Item
                  name="counterpartyId"
                  label={fieldLabel('Контрагент', !!formValues.counterpartyId)}
                  rules={[{ required: true, message: 'Выберите контрагента' }]}
                >
                  <Select
                    placeholder="Выберите контрагента"
                    showSearch
                    optionFilterProp="label"
                    options={counterpartyOptions}
                  />
                </Form.Item>
              </Col>
            )}

            <Col span={isCounterpartyUser ? 6 : 5}>
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
            </Col>

            <Col span={isCounterpartyUser ? 5 : 4}>
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
                    <InputNumber min={1} style={{ width: 80 }} placeholder="Дни" />
                  </Form.Item>
                  <Form.Item
                    name="deliveryDaysType"
                    noStyle
                    initialValue="working"
                  >
                    <Select
                      style={{ width: 100 }}
                      options={[
                        { label: 'раб.', value: 'working' },
                        { label: 'кал.', value: 'calendar' },
                      ]}
                    />
                  </Form.Item>
                </div>
              </Form.Item>
            </Col>

            <Col span={isCounterpartyUser ? 6 : 5}>
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

            <Col span={isCounterpartyUser ? 7 : 4}>
              <Form.Item
                name="invoiceAmount"
                label={fieldLabel('Сумма счета', !!formValues.invoiceAmount)}
                rules={[
                  { type: 'number', min: 0.01, message: 'Сумма должна быть больше 0' }
                ]}
              >
                <InputNumber
                  min={0.01}
                  precision={2}
                  style={{ width: '100%' }}
                  placeholder="Сумма"
                  addonAfter="₽"
                />
              </Form.Item>
            </Col>
          </Row>

          {/* Расчет ориентировочного срока поставки */}
          <DeliveryCalculation
            deliveryDays={formValues.deliveryDays as number | null}
            deliveryDaysType={(formValues.deliveryDaysType as 'working' | 'calendar') || 'working'}
            defaultExpanded={true}
          />

          <Form.Item name="comment" label="Комментарий">
            <TextArea rows={2} placeholder="Необязательное поле" />
          </Form.Item>
        </Form>

        {/* Загрузка файлов */}
        <div style={{ marginTop: 8 }}>
          <FileUploadList fileList={fileList} onChange={setFileList} />
        </div>
      </Spin>
    </Modal>
  )
}

export default CreateRequestModal
