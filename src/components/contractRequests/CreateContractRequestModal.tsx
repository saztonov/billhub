import { useState, useEffect, useMemo, useCallback } from 'react'
import { Modal, Form, Select, Input, Row, Col, App } from 'antd'
import { CheckCircleFilled } from '@ant-design/icons'
import { useAuthStore } from '@/store/authStore'
import { useContractRequestStore } from '@/store/contractRequestStore'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import { useSupplierStore } from '@/store/supplierStore'
import { useUploadQueueStore } from '@/store/uploadQueueStore'
import { CONTRACT_SUBJECT_LABELS, type ContractSubjectType } from '@/types'
import useIsMobile from '@/hooks/useIsMobile'
import ContractFileUpload from '@/components/contractRequests/ContractFileUpload'

interface FileItem {
  uid: string
  file: File
}

interface CreateContractRequestModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

/** Опции предмета договора из справочника */
const subjectOptions = (Object.entries(CONTRACT_SUBJECT_LABELS) as [ContractSubjectType, string][])
  .map(([value, label]) => ({ value, label }))

/** Опции количества сторон */
const partiesOptions = [
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
]

/** Зелёная галочка для заполненных полей */
const fieldLabel = (label: string, filled: boolean) => (
  <span>
    {label}{' '}
    <CheckCircleFilled
      style={{ color: '#52c41a', visibility: filled ? 'visible' : 'hidden', fontSize: 12 }}
    />
  </span>
)

const CreateContractRequestModal = ({ open, onClose, onCreated }: CreateContractRequestModalProps) => {
  const { message } = App.useApp()
  const isMobile = useIsMobile()
  const [form] = Form.useForm()
  const [fileList, setFileList] = useState<FileItem[]>([])
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})

  const user = useAuthStore((s) => s.user)
  const isCounterpartyUser = user?.role === 'counterparty_user'
  const createRequest = useContractRequestStore((s) => s.createRequest)
  const isSubmitting = useContractRequestStore((s) => s.isSubmitting)

  const counterparties = useCounterpartyStore((s) => s.counterparties)
  const fetchCounterparties = useCounterpartyStore((s) => s.fetchCounterparties)
  const sites = useConstructionSiteStore((s) => s.sites)
  const fetchSites = useConstructionSiteStore((s) => s.fetchSites)
  const suppliers = useSupplierStore((s) => s.suppliers)
  const fetchSuppliers = useSupplierStore((s) => s.fetchSuppliers)
  const addTask = useUploadQueueStore((s) => s.addTask)

  // Загрузка справочников при открытии
  useEffect(() => {
    if (open) {
      fetchCounterparties()
      fetchSites()
      fetchSuppliers()
    }
  }, [open, fetchCounterparties, fetchSites, fetchSuppliers])

  // Сброс формы при закрытии
  useEffect(() => {
    if (!open) {
      form.resetFields()
      setFileList([])
      setFormValues({})
    }
  }, [open, form])

  /** Опции контрагентов (только активные) */
  const counterpartyOptions = useMemo(() =>
    counterparties.filter((c) => c.isActive !== false).map((c) => ({ label: c.name, value: c.id })),
    [counterparties]
  )

  /** Опции объектов (только активные) */
  const siteOptions = useMemo(() =>
    sites.filter((s) => s.isActive).map((s) => ({ label: s.name, value: s.id })),
    [sites]
  )

  /** Опции поставщиков */
  const supplierOptions = useMemo(() =>
    suppliers.map((s) => ({ label: s.name, value: s.id })),
    [suppliers]
  )

  /** Обработка изменения значений формы */
  const handleValuesChange = useCallback((_: unknown, allValues: Record<string, unknown>) => {
    setFormValues(allValues)
  }, [])

  /** Создание заявки */
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()

      if (fileList.length === 0) {
        message.error('Добавьте хотя бы один файл')
        return
      }

      const counterpartyId = isCounterpartyUser ? user!.counterpartyId! : values.counterpartyId
      const counterpartyName = counterparties.find((c) => c.id === counterpartyId)?.name ?? ''

      const { requestId, requestNumber } = await createRequest(
        {
          siteId: values.siteId,
          counterpartyId,
          supplierId: values.supplierId,
          partiesCount: values.partiesCount,
          subjectType: values.subjectType,
          subjectDetail: values.subjectDetail || undefined,
          totalFiles: fileList.length,
        },
        user!.id,
      )

      // Добавляем файлы в очередь загрузки
      addTask({
        type: 'contract_files',
        requestId,
        requestNumber,
        counterpartyName,
        files: fileList.map((f) => ({
          file: f.file,
          documentTypeId: undefined,
          pageCount: null,
          isResubmit: false,
          isAdditional: false,
        })),
        userId: user!.id,
      })

      onCreated()
    } catch (err: unknown) {
      const valErr = err as { errorFields?: { errors: string[] }[] }
      if (valErr.errorFields) {
        const msgs = valErr.errorFields.flatMap((f) => f.errors)
        message.error(msgs.join('. '))
      }
    }
  }

  return (
    <Modal
      title="Новая заявка на договор"
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      okText="Создать"
      cancelText="Отмена"
      confirmLoading={isSubmitting}
      width={isMobile ? '100%' : 720}
      style={isMobile ? { top: 0, maxWidth: '100vw', margin: 0, padding: 0 } : undefined}
      styles={{
        body: isMobile
          ? { height: 'calc(100vh - 110px)', overflowY: 'auto' }
          : { maxHeight: 'calc(90vh - 110px)', overflowY: 'auto' },
      }}
      destroyOnClose
    >
      <Form form={form} layout="vertical" onValuesChange={handleValuesChange}>
        <Row gutter={[isMobile ? 0 : 16, 0]}>
          <Col xs={24} sm={12}>
            <Form.Item
              label={fieldLabel('Объект', !!formValues.siteId)}
              name="siteId"
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
          {!isCounterpartyUser && (
            <Col xs={24} sm={12}>
              <Form.Item
                label={fieldLabel('Подрядчик', !!formValues.counterpartyId)}
                name="counterpartyId"
                rules={[{ required: true, message: 'Выберите подрядчика' }]}
              >
                <Select
                  placeholder="Выберите подрядчика"
                  showSearch
                  optionFilterProp="label"
                  options={counterpartyOptions}
                />
              </Form.Item>
            </Col>
          )}
          <Col xs={24} sm={12}>
            <Form.Item
              label={fieldLabel('Поставщик', !!formValues.supplierId)}
              name="supplierId"
              rules={[{ required: true, message: 'Выберите поставщика' }]}
            >
              <Select
                placeholder="Выберите поставщика"
                showSearch
                optionFilterProp="label"
                options={supplierOptions}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label={fieldLabel('Кол-во сторон', !!formValues.partiesCount)}
              name="partiesCount"
              rules={[{ required: true, message: 'Выберите количество сторон' }]}
            >
              <Select placeholder="Выберите" options={partiesOptions} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label={fieldLabel('Предмет договора', !!formValues.subjectType)}
              name="subjectType"
              rules={[{ required: true, message: 'Выберите предмет договора' }]}
            >
              <Select placeholder="Выберите предмет" options={subjectOptions} />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item
              label="Предмет договора подробно"
              name="subjectDetail"
              rules={[{
                required: formValues.subjectType === 'general',
                message: 'Для предмета «Общий» обязательно заполните подробное описание',
              }]}
            >
              <Input.TextArea
                rows={3}
                placeholder={
                  formValues.subjectType === 'general'
                    ? 'Обязательное поле для предмета «Общий»'
                    : 'Необязательное поле'
                }
              />
            </Form.Item>
          </Col>
        </Row>

        <ContractFileUpload fileList={fileList} onChange={setFileList} />
      </Form>
    </Modal>
  )
}

export default CreateContractRequestModal
