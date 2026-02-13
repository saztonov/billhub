import { useEffect, useState } from 'react'
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Select,
  Tag,
  Checkbox,
  message,
} from 'antd'
import { EditOutlined } from '@ant-design/icons'
import { useUserStore } from '@/store/userStore'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useDepartmentStore } from '@/store/departmentStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import type { UserRole } from '@/types'
import type { UserRecord } from '@/store/userStore'

/** Метки ролей для отображения */
const roleLabels: Record<UserRole, string> = {
  admin: 'Администратор',
  user: 'Пользователь',
  counterparty_user: 'Подрядчик',
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
  const [allSitesChecked, setAllSitesChecked] = useState(false)
  const [form] = Form.useForm()

  const { users, isLoading, fetchUsers, updateUser } = useUserStore()
  const { counterparties, fetchCounterparties } = useCounterpartyStore()
  const { departments, fetchDepartments } = useDepartmentStore()
  const { sites, fetchSites } = useConstructionSiteStore()

  useEffect(() => {
    fetchUsers()
    fetchCounterparties()
    fetchDepartments()
    fetchSites()
  }, [fetchUsers, fetchCounterparties, fetchDepartments, fetchSites])

  const handleEdit = (record: UserRecord) => {
    setEditingRecord(record)
    setSelectedRole(record.role)
    setAllSitesChecked(record.allSites)
    form.setFieldsValue({
      role: record.role,
      counterparty_id: record.counterpartyId,
      department_id: record.departmentId,
      all_sites: record.allSites,
      site_ids: record.siteIds,
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
      all_sites: values.role === 'counterparty_user' ? false : (values.all_sites ?? false),
      site_ids: values.role === 'counterparty_user' ? [] : (values.site_ids ?? []),
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
      title: 'Подрядчик',
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
      title: 'Объекты',
      key: 'sites',
      render: (_: unknown, record: UserRecord) => {
        if (record.role === 'counterparty_user') return '—'
        if (record.allSites) return <Tag color="purple">Все объекты</Tag>
        if (record.siteNames.length === 0) return '—'
        return (
          <Space size={[0, 4]} wrap>
            {record.siteNames.map((name, i) => (
              <Tag key={i}>{name}</Tag>
            ))}
          </Space>
        )
      },
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

  // Только активные подразделения и объекты в селектах
  const activeDepartments = departments.filter((d) => d.isActive)
  const activeSites = sites.filter((s) => s.isActive)

  const showSiteFields = selectedRole !== 'counterparty_user'

  return (
    <div>
      <Table
        columns={columns}
        dataSource={users}
        rowKey="id"
        loading={isLoading}
        scroll={{ x: 900 }}
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
            <Select onChange={(value: UserRole) => {
              setSelectedRole(value)
              if (value === 'counterparty_user') {
                setAllSitesChecked(false)
                form.setFieldsValue({ all_sites: false, site_ids: [] })
              }
            }}>
              <Select.Option value="admin">Администратор</Select.Option>
              <Select.Option value="user">Пользователь</Select.Option>
              <Select.Option value="counterparty_user">Подрядчик</Select.Option>
            </Select>
          </Form.Item>
          {selectedRole === 'counterparty_user' && (
            <Form.Item
              name="counterparty_id"
              label="Подрядчик"
              rules={[{ required: true, message: 'Выберите подрядчика' }]}
            >
              <Select
                placeholder="Выберите подрядчика"
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
          {showSiteFields && (
            <>
              <Form.Item name="all_sites" valuePropName="checked">
                <Checkbox
                  onChange={(e) => {
                    setAllSitesChecked(e.target.checked)
                    if (e.target.checked) {
                      form.setFieldsValue({ site_ids: [] })
                    }
                  }}
                >
                  Все объекты
                </Checkbox>
              </Form.Item>
              {!allSitesChecked && (
                <Form.Item name="site_ids" label="Объекты строительства">
                  <Select
                    mode="multiple"
                    placeholder="Выберите объекты"
                    showSearch
                    optionFilterProp="children"
                    allowClear
                  >
                    {activeSites.map((s) => (
                      <Select.Option key={s.id} value={s.id}>
                        {s.name}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              )}
            </>
          )}
        </Form>
      </Modal>
    </div>
  )
}

export default UsersTab
