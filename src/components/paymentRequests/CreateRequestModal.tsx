import { useEffect, useState } from 'react'
import { Modal, Form, Select, InputNumber, Input, Row, Col, App, Spin, Segmented } from 'antd'
import { CheckCircleFilled } from '@ant-design/icons'
import FileUploadList from './FileUploadList'
import type { FileItem } from './FileUploadList'
import { notifyNewRequestPending } from '@/utils/notificationService'
import DeliveryCalculation from './DeliveryCalculation'
import { api } from '@/services/api'
import type { PaymentRequestType } from '@/types'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import useIsMobile from '@/hooks/useIsMobile'
import { usePaymentRequestSettingsStore } from '@/store/paymentRequestSettingsStore'
import { useDocumentTypeStore } from '@/store/documentTypeStore'
import { useAuthStore } from '@/store/authStore'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useSupplierStore } from '@/store/supplierStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import { useUploadQueueStore } from '@/store/uploadQueueStore'
import { buildSupplierOptions, renderSupplierOption } from '@/utils/supplierSb'

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
  const [requestType, setRequestType] = useState<PaymentRequestType>('contractor')
  const [generalContractor, setGeneralContractor] = useState<{
    counterpartyId: string
    name: string | null
    inn: string | null
  } | null>(null)

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
      setRequestType('contractor')
      fetchFieldOptions()
      if (documentTypes.length === 0) fetchDocumentTypes()
      if (counterparties.length === 0) fetchCounterparties()
      if (suppliers.length === 0) fetchSuppliers()
      if (sites.length === 0) fetchSites()
      // Генподрядчик (для типа «Своя закупка») — доступен admin/user
      if (!isCounterpartyUser) {
        api
          .get<{
            contractor: { counterpartyId: string; name: string | null; inn: string | null } | null
          }>('/api/references/counterparties/general-contractor')
          .then((r) => setGeneralContractor(r.contractor))
          .catch(() => setGeneralContractor(null))
      }
    }
  }, [
    open,
    isCounterpartyUser,
    fetchFieldOptions,
    fetchDocumentTypes,
    fetchCounterparties,
    fetchSuppliers,
    fetchSites,
    documentTypes.length,
    counterparties.length,
    suppliers.length,
    sites.length,
  ])

  const shippingOptions = getOptionsByField('shipping_conditions')

  // Видимость полей по типу заявки:
  //   contractor      — все поля;
  //   contractor_work — без поставщика, срока поставки и условий отгрузки;
  //   own_purchase    — контрагент фикс. СУ-10, без срока поставки (поставщик и условия остаются)
  const showSupplier = requestType !== 'contractor_work'
  const showDelivery = requestType === 'contractor'
  const showShipping = requestType !== 'contractor_work'
  const isOwnPurchase = requestType === 'own_purchase'

  // Опции контрагентов (только активные)
  const counterpartyOptions = counterparties
    .filter((c) => c.isActive !== false)
    .map((c) => ({ label: c.inn ? `${c.name}, ${c.inn}` : c.name, value: c.id }))

  // Опции поставщиков (отклонённые СБ — недоступны для выбора)
  const supplierOptions = buildSupplierOptions(suppliers)

  // Опции объектов (только активные)
  const siteOptions = sites.filter((s) => s.isActive).map((s) => ({ label: s.name, value: s.id }))

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

      // Определяем counterpartyId: своя закупка — всегда генподрядчик (СУ-10)
      let counterpartyId: string | undefined
      if (isOwnPurchase) {
        if (!generalContractor) {
          message.error('Генподрядчик (СУ-10) не настроен — обратитесь к администратору')
          return
        }
        counterpartyId = generalContractor.counterpartyId
      } else {
        counterpartyId = isCounterpartyUser ? user?.counterpartyId : values.counterpartyId
      }

      if (!counterpartyId) {
        message.error('Подрядчик не выбран')
        return
      }

      // Имя контрагента для S3-пути
      const counterpartyName =
        counterparties.find((c) => c.id === counterpartyId)?.name ??
        (isOwnPurchase ? (generalContractor?.name ?? '') : '')
      if (!counterpartyName) {
        message.error('Подрядчик не найден')
        return
      }

      // Создаём заявку в БД (без загрузки файлов)
      const { requestId, requestNumber } = await createRequest(
        {
          requestType,
          deliveryDays: showDelivery ? values.deliveryDays : undefined,
          deliveryDaysType: showDelivery ? values.deliveryDaysType : undefined,
          shippingConditionId: showShipping ? values.shippingConditionId : undefined,
          siteId: values.siteId,
          comment: values.comment,
          totalFiles: fileList.length,
          invoiceAmount: Number(String(values.invoiceAmount).replace(/\s/g, '')),
          supplierId: showSupplier ? values.supplierId || undefined : undefined,
        },
        counterpartyId,
        user.id,
      )

      // Уведомление Штабу — только для обычных заявок; прочие типы согласуются автоматически
      if (requestType === 'contractor') {
        notifyNewRequestPending(requestId, values.siteId, user.id, requestNumber)
      }

      // Добавляем файлы в очередь фоновой загрузки
      addUploadTask({
        type: 'request_files',
        requestId,
        requestNumber,
        counterpartyName,
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
      setRequestType('contractor')
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
    setRequestType('contractor')
    onClose()
  }

  // Шапка модалки: заголовок + переключатель типа заявки (только admin/user)
  const modalTitle = isCounterpartyUser ? (
    'Новая заявка на оплату'
  ) : (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', paddingRight: 32 }}
    >
      <span>Новая заявка на оплату</span>
      <Segmented
        value={requestType}
        onChange={(v) => setRequestType(v as PaymentRequestType)}
        options={[
          { label: 'Подрядчик', value: 'contractor' },
          { label: 'Подрядчик Работа', value: 'contractor_work' },
          { label: 'Своя закупка', value: 'own_purchase' },
        ]}
      />
    </div>
  )

  return (
    <Modal
      title={modalTitle}
      open={open}
      onOk={handleSubmit}
      onCancel={handleCancel}
      okText="Создать"
      cancelText="Отмена"
      confirmLoading={isSubmitting}
      width={isMobile ? '100%' : '80%'}
      centered={!isMobile}
      style={
        isMobile ? { top: 0, maxWidth: '100vw', margin: 0, padding: 0 } : { maxHeight: '90vh' }
      }
      styles={{
        body: isMobile
          ? {
              height: 'calc(100vh - 110px)',
              overflowY: 'auto',
              overflowX: 'hidden',
              padding: '12px 8px',
            }
          : { maxHeight: 'calc(90vh - 110px)', overflowY: 'auto', overflowX: 'hidden' },
      }}
    >
      <Spin spinning={fieldOptions.length === 0 && open}>
        {/* Поля формы */}
        <Form form={form} layout="vertical" onValuesChange={handleValuesChange}>
          <Row gutter={[isMobile ? 0 : 4, 0]}>
            {/* Поле выбора контрагента - только для user и admin */}
            {!isCounterpartyUser && !isOwnPurchase && (
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
                    popupMatchSelectWidth={false}
                    options={counterpartyOptions}
                  />
                </Form.Item>
              </Col>
            )}

            {/* Своя закупка: контрагент всегда генподрядчик (СУ-10), выбор заблокирован */}
            {!isCounterpartyUser && isOwnPurchase && (
              <Col xs={24} sm={12} md={6}>
                <Form.Item label="Контрагент">
                  <Input
                    disabled
                    value={
                      generalContractor
                        ? generalContractor.inn
                          ? `${generalContractor.name}, ${generalContractor.inn}`
                          : (generalContractor.name ?? '')
                        : 'Генподрядчик не настроен'
                    }
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

            {showSupplier && (
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
                    popupMatchSelectWidth={false}
                    options={supplierOptions}
                    optionRender={renderSupplierOption}
                  />
                </Form.Item>
              </Col>
            )}

            {showDelivery && (
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
                    <Form.Item name="deliveryDaysType" noStyle initialValue="working">
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
            )}

            {showShipping && (
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
            )}

            <Col xs={24} sm={12} md={isCounterpartyUser ? 7 : 4}>
              <Form.Item
                name="invoiceAmount"
                label={fieldLabel('Сумма счета', !!formValues.invoiceAmount)}
                required
                rules={[
                  {
                    validator: (_, value) => {
                      const num = Number(
                        String(value ?? '')
                          .replace(/\s/g, '')
                          .replace(',', '.'),
                      )
                      if (!value || isNaN(num) || num <= 0) {
                        return Promise.reject(new Error('Сумма должна быть больше 0'))
                      }
                      return Promise.resolve()
                    },
                  },
                ]}
                getValueFromEvent={(e) => {
                  const raw = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.')
                  const dotIdx = raw.indexOf('.')
                  const clean =
                    dotIdx >= 0
                      ? raw.slice(0, dotIdx + 1) + raw.slice(dotIdx + 1).replace(/\./g, '')
                      : raw
                  const parts = clean.split('.')
                  if (parts[1] && parts[1].length > 2) parts[1] = parts[1].slice(0, 2)
                  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
                  return parts.join('.')
                }}
              >
                <Input suffix="₽" style={{ width: '100%' }} placeholder="Сумма" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item
                name="comment"
                label={fieldLabel(
                  'Краткое описание',
                  !!(formValues.comment && String(formValues.comment).trim()),
                )}
                rules={[{ required: true, message: 'Введите краткое описание' }]}
              >
                <Input.TextArea
                  maxLength={64}
                  showCount={{
                    formatter: ({ count, maxLength }) => `Осталось: ${(maxLength ?? 64) - count}`,
                  }}
                  autoSize={{ minRows: 1, maxRows: 2 }}
                  placeholder="Краткое описание заявки"
                />
              </Form.Item>
            </Col>
          </Row>

          {/* Расчет ориентировочного срока поставки — только когда виден срок поставки */}
          {showDelivery && (
            <DeliveryCalculation
              deliveryDays={formValues.deliveryDays as number | null}
              deliveryDaysType={
                (formValues.deliveryDaysType as 'working' | 'calendar') || 'working'
              }
              shippingConditionId={formValues.shippingConditionId as string | undefined}
              defaultExpanded={true}
            />
          )}
        </Form>

        {/* Загрузка файлов */}
        <div style={{ marginTop: 8 }}>
          <FileUploadList
            fileList={fileList}
            onChange={setFileList}
            showValidation={showFileValidation}
          />
        </div>
      </Spin>
    </Modal>
  )
}

export default CreateRequestModal
