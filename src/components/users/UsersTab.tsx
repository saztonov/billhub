import { useEffect, useState } from 'react'
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Select,
  Tag,
  message,
} from 'antd'
import { EditOutlined } from '@ant-design/icons'
import { useUserStore } from '@/store/userStore'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useDepartmentStore } from '@/store/departmentStore'
import type { UserRole } from '@/types'
import type { UserRecord } from '@/store/userStore'

/** Метки ролей для отображения */
const roleLabels: Record<UserRole, string> = {
  admin: 'Администратор',
  user: 'Пользователь',
  counterparty_user: 'Контрагент',
}

/** Цвета тегов ролей */
const roleColors: Record<UserRole, string> = {
  admin: 'red',
  user: 'blue',
  counterparty_user: 'green',
}

const UsersTab = () => {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<UserRecord | null>(null)
  const [selectedRole, setSelectedRole] = useState<UserRole>('user')
  const [form] = Form.useForm()

  const { users, isLoading, fetchUsers, updateUser } = useUserStore()
  const { counterparties, fetchCounterparties } = useCounterpartyStore()
  const { departments, fetchDepartments } = useDepartmentStore()

  useEffect(() => {
    fetchUsers()
    fetchCounterparties()
    fetchDepartments()
  }, [fetchUsers, fetchCounterparties, fetchDepartments])

  const handleEdit = (record: UserRecord) => {
    setEditingRecord(record)
    setSelectedRole(record.role)
    form.setFieldsValue({
      role: record.role,
      counterparty_id: record.counterpartyId,
      department_id: record.departmentId,
    })
    setIsModalOpen(true)
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    if (!editingRecord) return
    await updateUser(editingRecord.id, {
      role: values.role,
      counterparty_id: values.role === 'counterparty_user' ? values.counterparty_id : null,
      department_id: values.department_id || null,
    })
    message.success('Пользователь обновлён')
    setIsModalOpen(false)
    form.resetFields()
  }

  const handleCancel = () => {
    setIsModalOpen(false)
    form.resetFields()
  }

  const columns = [
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: 'Роль',
      dataIndex: 'role',
      key: 'role',
      render: (role: UserRole) => (
        <Tag color={roleColors[role]}>{roleLabels[role]}</Tag>
      ),
    },
    {
      title: 'Контрагент',
      dataIndex: 'counterpartyName',
      key: 'counterpartyName',
      render: (name: string | null) => name ?? '—',
    },
    {
      title: 'Подразделение',
      dataIndex: 'departmentName',
      key: 'departmentName',
      render: (name: string | null) => name ?? '—',
    },
    {
      title: 'Создан',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: string) => new Date(date).toLocaleDateString('ru-RU'),
    },
    {
      title: 'Действия',
      key: 'actions',
      render: (_: unknown, record: UserRecord) => (
        <Space>
          <Button icon={<EditOutlined />} onClick={() => handleEdit(record)} size="small" />
        </Space>
      ),
    },
  ]

  // Только активные подразделения в селекте
  const activeDepartments = departments.filter((d) => d.isActive)

  return (
    <div>
      <Table
        columns={columns}
        dataSource={users}
        rowKey="id"
        loading={isLoading}
        scroll={{ x: 800 }}
      />
      <Modal
        title="Редактировать пользователя"
        open={isModalOpen}
        onOk={handleSubmit}
        onCancel={handleCancel}
        okText="Сохранить"
        cancelText="Отмена"
      >
        {editingRecord && (
          <div style={{ marginBottom: 16 }}>
            <strong>Email:</strong> {editingRecord.email}
          </div>
        )}
        <Form form={form} layout="vertical">
          <Form.Item
            name="role"
            label="Роль"
            rules={[{ required: true, message: 'Выберите роль' }]}
          >
            <Select onChange={(value: UserRole) => setSelectedRole(value)}>
              <Select.Option value="admin">Администратор</Select.Option>
              <Select.Option value="user">Пользователь</Select.Option>
              <Select.Option value="counterparty_user">Контрагент</Select.Option>
            </Select>
          </Form.Item>
          {selectedRole === 'counterparty_user' && (
            <Form.Item
              name="counterparty_id"
              label="Контрагент"
              rules={[{ required: true, message: 'Выберите контрагента' }]}
            >
              <Select
                placeholder="Выберите контрагента"
                showSearch
                optionFilterProp="children"
              >
                {counterparties.map((c) => (
                  <Select.Option key={c.id} value={c.id}>
                    {c.name}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          )}
          <Form.Item name="department_id" label="Подразделение">
            <Select
              placeholder="Выберите подразделение"
              allowClear
              showSearch
              optionFilterProp="children"
            >
              {activeDepartments.map((d) => (
                <Select.Option key={d.id} value={d.id}>
                  {d.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default UsersTab
