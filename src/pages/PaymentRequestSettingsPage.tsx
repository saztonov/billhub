import { useEffect, useState } from 'react'
import {
  Typography,
  Tabs,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  InputNumber,
  Switch,
  Select,
  Popconfirm,
  Tag,
  message,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { useStatusStore } from '@/store/statusStore'
import { usePaymentRequestSettingsStore } from '@/store/paymentRequestSettingsStore'
import type { Status, PaymentRequestFieldOption } from '@/types'

const { Title } = Typography
const ENTITY_TYPE = 'payment_request'

const fieldCodeLabels: Record<string, string> = {
  urgency: 'Срочность',
  shipping_conditions: 'Условия отгрузки',
}

const PaymentRequestSettingsPage = () => {
  // Статусы
  const {
    statuses, isLoading: statusLoading,
    fetchStatuses, createStatus, updateStatus, deleteStatus,
  } = useStatusStore()

  // Опции полей
  const {
    fieldOptions, isLoading: optionsLoading,
    fetchFieldOptions, createFieldOption, updateFieldOption, deleteFieldOption,
  } = usePaymentRequestSettingsStore()

  const [statusModal, setStatusModal] = useState(false)
  const [editingStatus, setEditingStatus] = useState<Status | null>(null)
  const [statusForm] = Form.useForm()

  const [optionModal, setOptionModal] = useState(false)
  const [editingOption, setEditingOption] = useState<PaymentRequestFieldOption | null>(null)
  const [optionForm] = Form.useForm()

  useEffect(() => {
    fetchStatuses(ENTITY_TYPE)
    fetchFieldOptions()
  }, [fetchStatuses, fetchFieldOptions])

  // --- Статусы ---
  const handleCreateStatus = () => {
    setEditingStatus(null)
    statusForm.resetFields()
    setStatusModal(true)
  }

  const handleEditStatus = (record: Status) => {
    setEditingStatus(record)
    statusForm.setFieldsValue({
      code: record.code,
      name: record.name,
      color: record.color,
      is_active: record.isActive,
      display_order: record.displayOrder,
    })
    setStatusModal(true)
  }

  const handleSubmitStatus = async () => {
    const values = await statusForm.validateFields()
    if (editingStatus) {
      await updateStatus(editingStatus.id, values)
      message.success('Статус обновлён')
    } else {
      await createStatus({ ...values, entity_type: ENTITY_TYPE })
      message.success('Статус создан')
    }
    setStatusModal(false)
    fetchStatuses(ENTITY_TYPE)
  }

  const handleDeleteStatus = async (id: string) => {
    await deleteStatus(id)
    message.success('Статус удалён')
    fetchStatuses(ENTITY_TYPE)
  }

  const statusColumns = [
    { title: 'Код', dataIndex: 'code', key: 'code', width: 150 },
    { title: 'Название', dataIndex: 'name', key: 'name' },
    {
      title: 'Цвет', dataIndex: 'color', key: 'color', width: 120,
      render: (color: string | null) => color ? <Tag color={color}>{color}</Tag> : '—',
    },
    {
      title: 'Активен', dataIndex: 'isActive', key: 'isActive', width: 100,
      render: (val: boolean) => <Tag color={val ? 'green' : 'default'}>{val ? 'Да' : 'Нет'}</Tag>,
    },
    { title: 'Порядок', dataIndex: 'displayOrder', key: 'displayOrder', width: 100 },
    {
      title: 'Действия', key: 'actions', width: 100,
      render: (_: unknown, record: Status) => (
        <Space>
          <Button icon={<EditOutlined />} size="small" onClick={() => handleEditStatus(record)} />
          <Popconfirm title="Удалить статус?" onConfirm={() => handleDeleteStatus(record.id)}>
            <Button icon={<DeleteOutlined />} danger size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  // --- Опции полей ---
  const handleCreateOption = () => {
    setEditingOption(null)
    optionForm.resetFields()
    setOptionModal(true)
  }

  const handleEditOption = (record: PaymentRequestFieldOption) => {
    setEditingOption(record)
    optionForm.setFieldsValue({
      field_code: record.fieldCode,
      value: record.value,
      is_active: record.isActive,
      display_order: record.displayOrder,
    })
    setOptionModal(true)
  }

  const handleSubmitOption = async () => {
    const values = await optionForm.validateFields()
    if (editingOption) {
      await updateFieldOption(editingOption.id, values)
      message.success('Опция обновлена')
    } else {
      await createFieldOption(values)
      message.success('Опция создана')
    }
    setOptionModal(false)
  }

  const handleDeleteOption = async (id: string) => {
    await deleteFieldOption(id)
    message.success('Опция удалена')
  }

  const optionColumns = [
    {
      title: 'Поле', dataIndex: 'fieldCode', key: 'fieldCode', width: 180,
      render: (code: string) => fieldCodeLabels[code] ?? code,
    },
    { title: 'Значение', dataIndex: 'value', key: 'value' },
    {
      title: 'Активна', dataIndex: 'isActive', key: 'isActive', width: 100,
      render: (val: boolean) => <Tag color={val ? 'green' : 'default'}>{val ? 'Да' : 'Нет'}</Tag>,
    },
    { title: 'Порядок', dataIndex: 'displayOrder', key: 'displayOrder', width: 100 },
    {
      title: 'Действия', key: 'actions', width: 100,
      render: (_: unknown, record: PaymentRequestFieldOption) => (
        <Space>
          <Button icon={<EditOutlined />} size="small" onClick={() => handleEditOption(record)} />
          <Popconfirm title="Удалить опцию?" onConfirm={() => handleDeleteOption(record.id)}>
            <Button icon={<DeleteOutlined />} danger size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const tabItems = [
    {
      key: 'statuses',
      label: 'Статусы заявок',
      children: (
        <>
          <div style={{ marginBottom: 16 }}>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateStatus}>
              Добавить статус
            </Button>
          </div>
          <Table
            columns={statusColumns}
            dataSource={statuses}
            rowKey="id"
            loading={statusLoading}
            scroll={{ x: 700 }}
            pagination={false}
          />
        </>
      ),
    },
    {
      key: 'options',
      label: 'Опции полей',
      children: (
        <>
          <div style={{ marginBottom: 16 }}>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateOption}>
              Добавить опцию
            </Button>
          </div>
          <Table
            columns={optionColumns}
            dataSource={fieldOptions}
            rowKey="id"
            loading={optionsLoading}
            scroll={{ x: 600 }}
            pagination={false}
          />
        </>
      ),
    },
  ]

  return (
    <div>
      <Title level={2}>Настройки заявок</Title>
      <Tabs items={tabItems} />

      {/* Модал статуса */}
      <Modal
        title={editingStatus ? 'Редактировать статус' : 'Новый статус'}
        open={statusModal}
        onOk={handleSubmitStatus}
        onCancel={() => setStatusModal(false)}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={statusForm} layout="vertical" initialValues={{ is_active: true, display_order: 0 }}>
          <Form.Item name="code" label="Код" rules={[{ required: true, message: 'Введите код' }]}>
            <Input disabled={!!editingStatus} placeholder="Например: in_progress" />
          </Form.Item>
          <Form.Item name="name" label="Название" rules={[{ required: true, message: 'Введите название' }]}>
            <Input placeholder="Например: В работе" />
          </Form.Item>
          <Form.Item name="color" label="Цвет Tag">
            <Select allowClear placeholder="Выберите цвет"
              options={[
                { label: 'Зелёный', value: 'green' },
                { label: 'Красный', value: 'red' },
                { label: 'Оранжевый', value: 'orange' },
                { label: 'Синий', value: 'blue' },
                { label: 'Серый', value: 'default' },
                { label: 'Фиолетовый', value: 'purple' },
              ]}
            />
          </Form.Item>
          <Form.Item name="display_order" label="Порядок отображения">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="is_active" label="Активен" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      {/* Модал опции */}
      <Modal
        title={editingOption ? 'Редактировать опцию' : 'Новая опция'}
        open={optionModal}
        onOk={handleSubmitOption}
        onCancel={() => setOptionModal(false)}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={optionForm} layout="vertical" initialValues={{ is_active: true, display_order: 0 }}>
          <Form.Item name="field_code" label="Поле" rules={[{ required: true, message: 'Выберите поле' }]}>
            <Select
              disabled={!!editingOption}
              placeholder="Выберите поле"
              options={Object.entries(fieldCodeLabels).map(([code, label]) => ({
                label, value: code,
              }))}
            />
          </Form.Item>
          <Form.Item name="value" label="Значение" rules={[{ required: true, message: 'Введите значение' }]}>
            <Input placeholder="Например: Срочная" />
          </Form.Item>
          <Form.Item name="display_order" label="Порядок отображения">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="is_active" label="Активна" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default PaymentRequestSettingsPage
