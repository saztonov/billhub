import { useEffect, useState } from 'react'
import {
  Modal,
  Form,
  Select,
  InputNumber,
  Input,
  Row,
  Col,
  App,
  Spin,
} from 'antd'
import { CheckCircleFilled } from '@ant-design/icons'
import FileUploadList from './FileUploadList'
import type { FileItem } from './FileUploadList'
import { notifyNewRequestPending } from '@/utils/notificationService'
import DeliveryCalculation from './DeliveryCalculation'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import useIsMobile from '@/hooks/useIsMobile'
import { usePaymentRequestSettingsStore } from '@/store/paymentRequestSettingsStore'
import { useDocumentTypeStore } from '@/store/documentTypeStore'
import { useAuthStore } from '@/store/authStore'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useSupplierStore } from '@/store/supplierStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import { useUploadQueueStore } from '@/store/uploadQueueStore'


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
  const { message } = App.useApp()
  const isMobile = useIsMobile()
  const [form] = Form.useForm()
  const [fileList, setFileList] = useState<FileItem[]>([])
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})
  const [showFileValidation, setShowFileValidation] = useState(false)

  const user = useAuthStore((s) => s.user)
  const isCounterpartyUser = user?.role === 'counterparty_user'

  const { createRequest, isSubmitting } = usePaymentRequestStore()
  const { fieldOptions, fetchFieldOptions, getOptionsByField } = usePaymentRequestSettingsStore()
  const { documentTypes, fetchDocumentTypes } = useDocumentTypeStore()
  const { counterparties, fetchCounterparties } = useCounterpartyStore()
  const { suppliers, fetchSuppliers } = useSupplierStore()
  const { sites, fetchSites } = useConstructionSiteStore()
  const addUploadTask = useUploadQueueStore((s) => s.addTask)

  useEffect(() => {
    if (open) {
      fetchFieldOptions()
      if (documentTypes.length === 0) fetchDocumentTypes()
      if (counterparties.length === 0) fetchCounterparties()
      if (suppliers.length === 0) fetchSuppliers()
      if (sites.length === 0) fetchSites()
    }
  }, [open, fetchFieldOptions, fetchDocumentTypes, fetchCounterparties, fetchSuppliers, fetchSites, documentTypes.length, counterparties.length, suppliers.length, sites.length])

  const shippingOptions = getOptionsByField('shipping_conditions')

  // Опции контрагентов (только активные)
  const counterpartyOptions = counterparties
    .filter((c) => c.isActive !== false)
    .map((c) => ({ label: c.name, value: c.id }))

  // Опции поставщиков
  const supplierOptions = suppliers
    .map((s) => ({ label: s.name, value: s.id }))

  // Опции объектов (только активные)
  const siteOptions = sites
    .filter((s) => s.isActive)
    .map((s) => ({ label: s.name, value: s.id }))

  const handleValuesChange = (_: unknown, allValues: Record<string, unknown>) => {
    setFormValues(allValues)
  }

  const handleSubmit = async () => {
    try {
      // Проверка авторизации
      if (!user) {
        message.error('Пользователь не авторизован')
        return
      }

      const values = await form.validateFields()

      // Проверка: хотя бы один файл с типом
      if (fileList.length === 0) {
        message.error('Добавьте хотя бы один файл')
        return
      }
      const filesWithoutType = fileList.filter((f) => !f.documentTypeId)
      if (filesWithoutType.length > 0) {
        setShowFileValidation(true)
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
          invoiceAmount: Number(String(values.invoiceAmount).replace(/\s/g, '')),
          supplierId: values.supplierId || undefined,
        },
        counterpartyId,
        user.id,
      )

      // Уведомление Штабу о новой заявке
      notifyNewRequestPending(requestId, values.siteId, user.id, requestNumber)

      // Добавляем файлы в очередь фоновой загрузки
      addUploadTask({
        type: 'request_files',
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
      setShowFileValidation(false)
      onClose()
    } catch (err: unknown) {
      // Ошибка валидации формы — показываем перечень незаполненных полей
      const valErr = err as { errorFields?: { errors: string[] }[] }
      if (valErr.errorFields) {
        const msgs = valErr.errorFields.flatMap((f) => f.errors)
        message.error(msgs.join('. '))
        return
      }
      const errorMsg = err instanceof Error ? err.message : 'Ошибка создания заявки'
      message.error(errorMsg)
    }
  }

  const handleCancel = () => {
    form.resetFields()
    setFileList([])
    setFormValues({})
    setShowFileValidation(false)
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
      width={isMobile ? '100%' : '80%'}
      centered={!isMobile}
      style={isMobile ? { top: 0, maxWidth: '100vw', margin: 0, padding: 0 } : { maxHeight: '90vh' }}
      styles={{
        body: isMobile
          ? { height: 'calc(100vh - 110px)', overflowY: 'auto', overflowX: 'hidden', padding: '12px 8px' }
          : { maxHeight: 'calc(90vh - 110px)', overflowY: 'auto', overflowX: 'hidden' },
      }}
    >
      <Spin spinning={fieldOptions.length === 0 && open}>
        {/* Поля формы */}
        <Form
          form={form}
          layout="vertical"
          onValuesChange={handleValuesChange}
        >
          <Row gutter={[isMobile ? 0 : 4, 0]}>
            {/* Поле выбора контрагента - только для user и admin */}
            {!isCounterpartyUser && (
              <Col xs={24} sm={12} md={6}>
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

            <Col xs={24} sm={12} md={isCounterpartyUser ? 6 : 5}>
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

            <Col xs={24} sm={12} md={isCounterpartyUser ? 5 : 4}>
              <Form.Item
                name="supplierId"
                label={fieldLabel('Поставщик', !!formValues.supplierId)}
              >
                <Select
                  placeholder="Выберите поставщика"
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  options={supplierOptions}
                />
              </Form.Item>
            </Col>

            <Col xs={24} sm={12} md={isCounterpartyUser ? 5 : 4}>
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
                      style={{ flex: 1, minWidth: 100 }}
                      options={[
                        { label: 'раб.', value: 'working' },
                        { label: 'кал.', value: 'calendar' },
                      ]}
                    />
                  </Form.Item>
                </div>
              </Form.Item>
            </Col>

            <Col xs={24} sm={12} md={isCounterpartyUser ? 6 : 5}>
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

            <Col xs={24} sm={12} md={isCounterpartyUser ? 7 : 4}>
              <Form.Item
                name="invoiceAmount"
                label={fieldLabel('Сумма счета', !!formValues.invoiceAmount)}
                required
                rules={[
                  {
                    validator: (_, value) => {
                      const num = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'))
                      if (!value || isNaN(num) || num <= 0) {
                        return Promise.reject(new Error('Сумма должна быть больше 0'))
                      }
                      return Promise.resolve()
                    }
                  }
                ]}
                getValueFromEvent={(e) => {
                  const raw = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.')
                  const dotIdx = raw.indexOf('.')
                  const clean = dotIdx >= 0
                    ? raw.slice(0, dotIdx + 1) + raw.slice(dotIdx + 1).replace(/\./g, '')
                    : raw
                  const parts = clean.split('.')
                  if (parts[1] && parts[1].length > 2) parts[1] = parts[1].slice(0, 2)
                  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
                  return parts.join('.')
                }}
              >
                <Input
                  suffix="₽"
                  style={{ width: '100%' }}
                  placeholder="Сумма"
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item
                name="comment"
                label={fieldLabel('Краткое описание', !!(formValues.comment && String(formValues.comment).trim()))}
                rules={[{ required: true, message: 'Введите краткое описание' }]}
              >
                <Input.TextArea
                  maxLength={64}
                  showCount={{ formatter: ({ count, maxLength }) => `Осталось: ${(maxLength ?? 64) - count}` }}
                  autoSize={{ minRows: 1, maxRows: 2 }}
                  placeholder="Краткое описание заявки"
                />
              </Form.Item>
            </Col>
          </Row>

          {/* Расчет ориентировочного срока поставки */}
          <DeliveryCalculation
            deliveryDays={formValues.deliveryDays as number | null}
            deliveryDaysType={(formValues.deliveryDaysType as 'working' | 'calendar') || 'working'}
            shippingConditionId={formValues.shippingConditionId as string | undefined}
            defaultExpanded={true}
          />

        </Form>

        {/* Загрузка файлов */}
        <div style={{ marginTop: 8 }}>
          <FileUploadList fileList={fileList} onChange={setFileList} showValidation={showFileValidation} />
        </div>
      </Spin>
    </Modal>
  )
}

export default CreateRequestModal
