import {
  Descriptions,
  Tag,
  Button,
  Typography,
  Space,
  Tooltip,
  Form,
  Select,
  InputNumber,
  Input,
  Row,
  Col,
} from 'antd'
import type { FormInstance } from 'antd'
import {
  DownloadOutlined,
  EyeOutlined,
  EditOutlined,
  FileAddOutlined,
} from '@ant-design/icons'
import FileUploadList from './FileUploadList'
import type { FileItem } from './FileUploadList'
import DeliveryCalculation from './DeliveryCalculation'
import { formatDate, extractRequestNumber } from '@/utils/requestFormatters'
import type { PaymentRequest } from '@/types'

const { Text } = Typography

/** Маска суммы: пробелы-разделители тысяч, точка для дробной части */
export const invoiceAmountMask = (e: React.ChangeEvent<HTMLInputElement>) => {
  const raw = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.')
  const dotIdx = raw.indexOf('.')
  const clean = dotIdx >= 0 ? raw.slice(0, dotIdx + 1) + raw.slice(dotIdx + 1).replace(/\./g, '') : raw
  const parts = clean.split('.')
  if (parts[1] && parts[1].length > 2) parts[1] = parts[1].slice(0, 2)
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return parts.join('.')
}

/** Валидатор суммы > 0 */
export const invoiceAmountValidator = (_: unknown, value: unknown) => {
  const num = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'))
  if (!value || isNaN(num) || num <= 0) return Promise.reject(new Error('Сумма должна быть больше 0'))
  return Promise.resolve()
}

interface RequestDetailsSectionProps {
  request: PaymentRequest
  actualRequest: PaymentRequest
  isEditing: boolean
  resubmitMode?: boolean
  isCounterpartyUser: boolean
  isMobile: boolean
  editForm: FormInstance
  resubmitForm: FormInstance
  editFileList: FileItem[]
  setEditFileList: (files: FileItem[]) => void
  showEditFileValidation: boolean
  siteOptions: { label: string; value: string }[]
  supplierOptions: { label: string; value: string }[]
  shippingOptions: { id: string; value: string }[]
  currentAssignment: { assignedUserFullName?: string } | null
  paymentsTotalPaid: number
  setPreviewFile: (f: { fileKey: string; fileName: string; mimeType: string | null } | null) => void
  downloading: string | null
  handleDownload: (fileKey: string, fileName: string) => void
  setDpModalOpen: (open: boolean) => void
  fetchRequests: () => void
}

const RequestDetailsSection = ({
  request,
  actualRequest,
  isEditing,
  resubmitMode,
  isCounterpartyUser,
  isMobile,
  editForm,
  resubmitForm,
  editFileList,
  setEditFileList,
  showEditFileValidation,
  siteOptions,
  supplierOptions,
  shippingOptions,
  currentAssignment,
  paymentsTotalPaid,
  setPreviewFile,
  downloading,
  handleDownload,
  setDpModalOpen,
}: RequestDetailsSectionProps) => {
  // Формат опций отгрузки для Select
  const shippingSelectOptions = shippingOptions.map((o) => ({ label: o.value, value: o.id }))

  if (isEditing) {
    return (
      <Form form={editForm} layout="vertical" style={{ marginBottom: 16 }}>
        <Descriptions column={isMobile ? 1 : 2} size="small" bordered={false} style={{ marginBottom: 4 }}>
          <Descriptions.Item label="Номер">{extractRequestNumber(request.requestNumber)}</Descriptions.Item>
          <Descriptions.Item label="Подрядчик">{request.counterpartyName}</Descriptions.Item>
        </Descriptions>
        <Row gutter={[8, 0]}>
          <Col xs={24} sm={12} md={6}>
            <Form.Item name="siteId" label="Объект" rules={[{ required: true, message: 'Выберите объект' }]}>
              <Select placeholder="Выберите объект" showSearch optionFilterProp="label" options={siteOptions} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={5}>
            <Form.Item name="supplierId" label="Поставщик">
              <Select placeholder="Выберите поставщика" showSearch allowClear optionFilterProp="label" options={supplierOptions} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={5}>
            <Form.Item label="Срок поставки" required style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                <Form.Item name="deliveryDays" noStyle rules={[{ required: true, message: 'Укажите срок' }]}>
                  <InputNumber min={1} style={{ width: 70 }} placeholder="Дни" />
                </Form.Item>
                <Form.Item name="deliveryDaysType" noStyle>
                  <Select style={{ width: 100 }} options={[{ label: 'раб.', value: 'working' }, { label: 'кал.', value: 'calendar' }]} />
                </Form.Item>
              </div>
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={5}>
            <Form.Item name="shippingConditionId" label="Условия отгрузки" rules={[{ required: true, message: 'Выберите условия' }]}>
              <Select placeholder="Выберите условия" options={shippingSelectOptions} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={3}>
            <Form.Item name="invoiceAmount" label="Сумма счета" rules={[{ validator: invoiceAmountValidator }]} getValueFromEvent={invoiceAmountMask}>
              <Input addonAfter="₽" style={{ width: '100%' }} placeholder="Сумма" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={[8, 0]}>
          <Col span={24}>
            <Form.Item name="comment" label="Краткое описание">
              <Input.TextArea
                maxLength={64}
                showCount={{ formatter: ({ count, maxLength }) => `Осталось: ${(maxLength ?? 64) - count}` }}
                autoSize={{ minRows: 1, maxRows: 2 }}
                placeholder="Краткое описание заявки"
              />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item noStyle shouldUpdate={(prev, curr) => prev.deliveryDays !== curr.deliveryDays || prev.deliveryDaysType !== curr.deliveryDaysType || prev.shippingConditionId !== curr.shippingConditionId}>
          {({ getFieldValue }) => (
            <DeliveryCalculation deliveryDays={getFieldValue('deliveryDays')} deliveryDaysType={getFieldValue('deliveryDaysType') || 'working'} shippingConditionId={getFieldValue('shippingConditionId')} defaultExpanded={false} />
          )}
        </Form.Item>
        <Text strong style={{ display: 'block', marginBottom: 8 }}><FileAddOutlined /> Догрузить файлы</Text>
        <FileUploadList fileList={editFileList} onChange={setEditFileList} showValidation={showEditFileValidation} />
      </Form>
    )
  }

  if (resubmitMode) {
    return (
      <>
        <Descriptions column={isMobile ? 1 : 2} size="small" bordered style={{ marginBottom: 16 }}>
          <Descriptions.Item label="Номер">{extractRequestNumber(request.requestNumber)}</Descriptions.Item>
          <Descriptions.Item label="Подрядчик">{request.counterpartyName}</Descriptions.Item>
          <Descriptions.Item label="Объект">{request.siteName ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Статус">
            <Tag color={request.statusColor ?? 'default'} style={{ whiteSpace: 'pre-line', lineHeight: 1.3 }}>
              {request.statusName}
              {request.statusName?.startsWith('Согласование ОМТС') && (currentAssignment?.assignedUserFullName || request.assignedUserFullName)
                ? `\n${currentAssignment?.assignedUserFullName || request.assignedUserFullName}`
                : ''}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Дата создания">{formatDate(request.createdAt, !isCounterpartyUser)}</Descriptions.Item>
          <Descriptions.Item label="Краткое описание" span={2}>{request.comment ?? '—'}</Descriptions.Item>
        </Descriptions>
        <Form form={resubmitForm} layout="vertical" style={{ marginBottom: 16 }}>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={8}>
              <Form.Item label="Срок поставки" required style={{ marginBottom: 0 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Form.Item name="deliveryDays" noStyle rules={[{ required: true, message: 'Укажите срок' }]}>
                    <InputNumber min={1} style={{ width: 80 }} placeholder="Дни" />
                  </Form.Item>
                  <Form.Item name="deliveryDaysType" noStyle initialValue="working">
                    <Select style={{ flex: 1, minWidth: 100 }} options={[{ label: 'рабочих', value: 'working' }, { label: 'календарных', value: 'calendar' }]} />
                  </Form.Item>
                </div>
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="shippingConditionId" label="Условия отгрузки" rules={[{ required: true, message: 'Выберите условия' }]}>
                <Select placeholder="Выберите условия" options={shippingSelectOptions} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="invoiceAmount" label="Сумма счета" required rules={[{ validator: invoiceAmountValidator }]} getValueFromEvent={invoiceAmountMask}>
                <Input addonAfter="₽" style={{ width: '100%' }} placeholder="Сумма" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.deliveryDays !== curr.deliveryDays || prev.deliveryDaysType !== curr.deliveryDaysType || prev.shippingConditionId !== curr.shippingConditionId}>
            {({ getFieldValue }) => (
              <DeliveryCalculation deliveryDays={getFieldValue('deliveryDays')} deliveryDaysType={getFieldValue('deliveryDaysType') || 'working'} shippingConditionId={getFieldValue('shippingConditionId')} defaultExpanded={false} />
            )}
          </Form.Item>
        </Form>
      </>
    )
  }

  // Режим просмотра
  return (
    <Descriptions column={isMobile ? 1 : 2} size="small" bordered style={{ marginBottom: 16 }}>
      <Descriptions.Item label="Номер">{extractRequestNumber(request.requestNumber)}</Descriptions.Item>
      <Descriptions.Item label="Подрядчик">{request.counterpartyName}</Descriptions.Item>
      <Descriptions.Item label="Объект">{request.siteName ?? '—'}</Descriptions.Item>
      <Descriptions.Item label="Поставщик">{request.supplierName ?? '—'}</Descriptions.Item>
      <Descriptions.Item label="Статус">
        <Tag color={request.statusColor ?? 'default'} style={{ whiteSpace: 'pre-line', lineHeight: 1.3 }}>
          {request.statusName}
          {request.statusName?.startsWith('Согласование ОМТС') && (currentAssignment?.assignedUserFullName || request.assignedUserFullName)
            ? `\n${currentAssignment?.assignedUserFullName || request.assignedUserFullName}`
            : ''}
        </Tag>
      </Descriptions.Item>
      <Descriptions.Item label="Срок поставки">{request.deliveryDays} {request.deliveryDaysType === 'calendar' ? 'кал.' : 'раб.'} дн.</Descriptions.Item>
      <Descriptions.Item label="Условия отгрузки">{request.shippingConditionValue}</Descriptions.Item>
      <Descriptions.Item label="Сумма счета">
        {request.invoiceAmount != null
          ? `${request.invoiceAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`
          : '—'}
      </Descriptions.Item>
      <Descriptions.Item label="Оплачено">
        {paymentsTotalPaid > 0
          ? `${paymentsTotalPaid.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`
          : '0,00 ₽'}
      </Descriptions.Item>
      <Descriptions.Item label="Статус оплаты">
        <Tag color={request.paidStatusColor ?? 'default'}>{request.paidStatusName ?? '—'}</Tag>
      </Descriptions.Item>
      <Descriptions.Item label="Дата создания">{formatDate(request.createdAt, !isCounterpartyUser)}</Descriptions.Item>
      <Descriptions.Item label="РП">
        {actualRequest?.dpNumber ? (
          <Space size={4}>
            <span>
              №{actualRequest.dpNumber} от {actualRequest.dpDate ? new Date(actualRequest.dpDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '—'}
              {actualRequest.dpAmount != null && `, ${actualRequest.dpAmount.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₽`}
            </span>
            {actualRequest.dpFileKey && (
              <>
                <Tooltip title="Просмотр файла РП">
                  <Button icon={<EyeOutlined />} size="small" onClick={() => setPreviewFile({ fileKey: actualRequest.dpFileKey!, fileName: actualRequest.dpFileName ?? 'rp-file', mimeType: null })} />
                </Tooltip>
                <Tooltip title="Скачать файл РП">
                  <Button icon={<DownloadOutlined />} size="small" loading={downloading === actualRequest.dpFileKey} onClick={() => handleDownload(actualRequest.dpFileKey!, actualRequest.dpFileName ?? 'rp-file')} />
                </Tooltip>
              </>
            )}
            {!isCounterpartyUser && (
              <Tooltip title="Редактировать РП">
                <Button icon={<EditOutlined />} size="small" onClick={() => setDpModalOpen(true)} />
              </Tooltip>
            )}
          </Space>
        ) : (
          <Space size={8}>
            <span>—</span>
            {request.approvedAt && !isCounterpartyUser && (
              <Button size="small" type="link" onClick={() => setDpModalOpen(true)}>Заполнить</Button>
            )}
          </Space>
        )}
      </Descriptions.Item>
      <Descriptions.Item label="Краткое описание" span={2}>{request.comment ?? '—'}</Descriptions.Item>
    </Descriptions>
  )
}

export default RequestDetailsSection
