import { useEffect, useState } from 'react'
import {
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
  App,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { useStatusStore } from '@/store/statusStore'
import { usePaymentRequestSettingsStore } from '@/store/paymentRequestSettingsStore'
import type { Status, PaymentRequestFieldOption } from '@/types'

const ENTITY_TYPE = 'payment_request'

const fieldCodeLabels: Record<string, string> = {
  shipping_conditions: 'Условия отгрузки',
}

const PaymentRequestSettingsPage = () => {
  const { message } = App.useApp()
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
      visible_roles: record.visibleRoles ?? [],
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
    {
      title: 'Код',
      dataIndex: 'code',
      key: 'code',
      width: 150,
      sorter: (a: Status, b: Status) => a.code.localeCompare(b.code),
    },
    {
      title: 'Название',
      dataIndex: 'name',
      key: 'name',
      sorter: (a: Status, b: Status) => a.name.localeCompare(b.name),
    },
    {
      title: 'Цвет',
      dataIndex: 'color',
      key: 'color',
      width: 120,
      sorter: (a: Status, b: Status) => {
        const aVal = a.color || ''
        const bVal = b.color || ''
        return aVal.localeCompare(bVal)
      },
      render: (color: string | null) => color ? <Tag color={color}>{color}</Tag> : '—',
    },
    {
      title: 'Активен',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      sorter: (a: Status, b: Status) => (a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1),
      render: (val: boolean) => <Tag color={val ? 'green' : 'default'}>{val ? 'Да' : 'Нет'}</Tag>,
    },
    {
      title: 'Видимость', dataIndex: 'visibleRoles', key: 'visibleRoles', width: 200,
      render: (roles: string[]) => {
        if (!roles || roles.length === 0) return <Tag>Все роли</Tag>
        const labels: Record<string, string> = {
          admin: 'Админ',
          user: 'Сотрудник',
          counterparty_user: 'Подрядчик',
        }
        return roles.map((r) => <Tag key={r}>{labels[r] ?? r}</Tag>)
      },
    },
    {
      title: 'Порядок',
      dataIndex: 'displayOrder',
      key: 'displayOrder',
      width: 100,
      sorter: (a: Status, b: Status) => a.displayOrder - b.displayOrder,
    },
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
      message.success('Условие обновлено')
    } else {
      await createFieldOption(values)
      message.success('Условие создано')
    }
    setOptionModal(false)
  }

  const handleDeleteOption = async (id: string) => {
    await deleteFieldOption(id)
    message.success('Условие удалено')
  }

  const optionColumns = [
    {
      title: 'Поле',
      dataIndex: 'fieldCode',
      key: 'fieldCode',
      width: 180,
      sorter: (a: PaymentRequestFieldOption, b: PaymentRequestFieldOption) => a.fieldCode.localeCompare(b.fieldCode),
      render: (code: string) => fieldCodeLabels[code] ?? code,
    },
    {
      title: 'Значение',
      dataIndex: 'value',
      key: 'value',
      sorter: (a: PaymentRequestFieldOption, b: PaymentRequestFieldOption) => a.value.localeCompare(b.value),
    },
    {
      title: 'Активна',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      sorter: (a: PaymentRequestFieldOption, b: PaymentRequestFieldOption) => (a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1),
      render: (val: boolean) => <Tag color={val ? 'green' : 'default'}>{val ? 'Да' : 'Нет'}</Tag>,
    },
    {
      title: 'Порядок',
      dataIndex: 'displayOrder',
      key: 'displayOrder',
      width: 100,
      sorter: (a: PaymentRequestFieldOption, b: PaymentRequestFieldOption) => a.displayOrder - b.displayOrder,
    },
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
            pagination={{
              showSizeChanger: true,
              pageSizeOptions: ['10', '20', '50', '100'],
              defaultPageSize: 20,
              showTotal: (total, range) => `${range[0]}-${range[1]} из ${total}`,
            }}
          />
        </>
      ),
    },
    {
      key: 'options',
      label: 'Условия отгрузки',
      children: (
        <>
          <div style={{ marginBottom: 16 }}>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateOption}>
              Добавить условие
            </Button>
          </div>
          <Table
            columns={optionColumns}
            dataSource={fieldOptions}
            rowKey="id"
            loading={optionsLoading}
            scroll={{ x: 600 }}
            pagination={{
              showSizeChanger: true,
              pageSizeOptions: ['10', '20', '50', '100'],
              defaultPageSize: 20,
              showTotal: (total, range) => `${range[0]}-${range[1]} из ${total}`,
            }}
          />
        </>
      ),
    },
  ]

  return (
    <div>
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
          <Form.Item name="visible_roles" label="Видимость для ролей">
            <Select
              mode="multiple"
              placeholder="Все роли (по умолчанию)"
              options={[
                { label: 'Администратор', value: 'admin' },
                { label: 'Сотрудник', value: 'user' },
                { label: 'Подрядчик', value: 'counterparty_user' },
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

      {/* Модал условия */}
      <Modal
        title={editingOption ? 'Редактировать условие' : 'Новое условие'}
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
            <Input placeholder="Например: Самовывоз" />
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
