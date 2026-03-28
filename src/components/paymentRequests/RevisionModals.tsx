import {
  Modal,
  Input,
  Form,
  Select,
  InputNumber,
  Row,
  Col,
} from 'antd'
import type { FormInstance } from 'antd'
import { invoiceAmountMask, invoiceAmountValidator } from './RequestDetailsSection'
import type { PaymentRequest } from '@/types'

const { TextArea } = Input

interface RevisionModalsProps {
  request: PaymentRequest
  // Модалка "На доработку"
  revisionModalOpen: boolean
  revisionComment: string
  setRevisionComment: (comment: string) => void
  handleSendToRevision: () => void
  setRevisionModalOpen: (open: boolean) => void
  onRevisionCommentRequired: () => void
  // Модалка "Проверьте данные"
  revisionCompleteModalOpen: boolean
  revisionCompleteForm: FormInstance
  handleCompleteRevision: (values: {
    deliveryDays: number
    deliveryDaysType: string
    shippingConditionId: string
    invoiceAmount: number
  }) => void
  setRevisionCompleteModalOpen: (open: boolean) => void
  shippingOptions: { id: string; value: string }[]
}

const RevisionModals = ({
  request,
  revisionModalOpen,
  revisionComment,
  setRevisionComment,
  handleSendToRevision,
  setRevisionModalOpen,
  onRevisionCommentRequired,
  revisionCompleteModalOpen,
  revisionCompleteForm,
  handleCompleteRevision,
  setRevisionCompleteModalOpen,
  shippingOptions,
}: RevisionModalsProps) => {
  const shippingSelectOptions = shippingOptions.map((o) => ({ label: o.value, value: o.id }))

  return (
    <>
      {/* Модалка "На доработку" */}
      <Modal
        title="На доработку"
        open={revisionModalOpen}
        onOk={() => {
          if (!revisionComment.trim()) {
            onRevisionCommentRequired()
            return
          }
          handleSendToRevision()
        }}
        onCancel={() => { setRevisionModalOpen(false); setRevisionComment('') }}
        okText="Отправить"
        cancelText="Отмена"
      >
        <TextArea
          rows={3}
          placeholder="Комментарий"
          value={revisionComment}
          onChange={(e) => setRevisionComment(e.target.value)}
          status={revisionComment.trim() ? undefined : 'error'}
        />
      </Modal>

      {/* Модалка "Проверьте данные" (завершение доработки) */}
      <Modal
        title="Проверьте данные"
        open={revisionCompleteModalOpen}
        onOk={() => revisionCompleteForm.submit()}
        onCancel={() => { setRevisionCompleteModalOpen(false); revisionCompleteForm.resetFields() }}
        okText="Подтвердить"
        cancelText="Отмена"
        afterOpenChange={(open) => {
          if (open && request) {
            revisionCompleteForm.setFieldsValue({
              deliveryDays: request.deliveryDays,
              deliveryDaysType: request.deliveryDaysType || 'working',
              shippingConditionId: request.shippingConditionId,
              invoiceAmount: request.invoiceAmount != null
                ? request.invoiceAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : '',
            })
          }
        }}
      >
        <Form
          form={revisionCompleteForm}
          layout="vertical"
          onFinish={(values) => {
            const amount = Number(String(values.invoiceAmount ?? '').replace(/\s/g, '').replace(',', '.'))
            handleCompleteRevision({
              deliveryDays: values.deliveryDays,
              deliveryDaysType: values.deliveryDaysType,
              shippingConditionId: values.shippingConditionId,
              invoiceAmount: amount,
            })
          }}
        >
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item label="Срок поставки, дней" required style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Form.Item name="deliveryDays" noStyle rules={[{ required: true, message: 'Укажите срок' }]}>
                    <InputNumber min={1} style={{ flex: 1 }} />
                  </Form.Item>
                  <Form.Item name="deliveryDaysType" noStyle>
                    <Select style={{ flex: 1, minWidth: 100 }} options={[{ label: 'рабочих', value: 'working' }, { label: 'календарных', value: 'calendar' }]} />
                  </Form.Item>
                </div>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="shippingConditionId" label="Условия отгрузки" rules={[{ required: true, message: 'Выберите условия' }]}>
                <Select placeholder="Выберите условия" options={shippingSelectOptions} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="invoiceAmount" label="Сумма счета" required rules={[{ validator: invoiceAmountValidator }]} getValueFromEvent={invoiceAmountMask}>
            <Input addonAfter="₽" style={{ width: '100%' }} placeholder="Сумма" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

export default RevisionModals
