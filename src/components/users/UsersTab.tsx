import { useEffect, useState, useMemo, type Key } from 'react'
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Checkbox,
  Alert,
  App,
} from 'antd'
import { PlusOutlined, EditOutlined } from '@ant-design/icons'
import { useUserStore } from '@/store/userStore'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import CreateUserModal from '@/components/users/CreateUserModal'
import type { UserRole, Department } from '@/types'
import { DEPARTMENT_LABELS } from '@/types'
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
  const { message } = App.useApp()
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<UserRecord | null>(null)
  const [selectedRole, setSelectedRole] = useState<UserRole>('user')
  const [allSitesChecked, setAllSitesChecked] = useState(false)
  const [searchFullName, setSearchFullName] = useState('')
  const [searchCounterparty, setSearchCounterparty] = useState('')
  const [form] = Form.useForm()

  const { users, isLoading, error, fetchUsers, updateUser } = useUserStore()
  const { counterparties, fetchCounterparties } = useCounterpartyStore()
  const { sites, fetchSites } = useConstructionSiteStore()

  useEffect(() => {
    fetchUsers()
    fetchCounterparties()
    fetchSites()
  }, [fetchUsers, fetchCounterparties, fetchSites])

  const handleEdit = (record: UserRecord) => {
    setEditingRecord(record)
    setSelectedRole(record.role)
    setAllSitesChecked(record.allSites)
    form.setFieldsValue({
      full_name: record.fullName,
      role: record.role,
      counterparty_id: record.counterpartyId,
      department: record.department,
      all_sites: record.allSites,
      site_ids: record.siteIds,
    })
    setIsEditModalOpen(true)
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    if (!editingRecord) return
    await updateUser(editingRecord.id, {
      full_name: values.full_name ?? '',
      role: values.role,
      counterparty_id: values.role === 'counterparty_user' ? values.counterparty_id : null,
      department: values.department || null,
      all_sites: values.role === 'counterparty_user' ? false : (values.all_sites ?? false),
      site_ids: values.role === 'counterparty_user' ? [] : (values.site_ids ?? []),
    })
    message.success('Пользователь обновлён')
    setIsEditModalOpen(false)
    form.resetFields()
  }

  const handleCancel = () => {
    setIsEditModalOpen(false)
    form.resetFields()
  }

  // Генерация фильтров для объектов
  const siteFilters = useMemo(() => {
    const uniqueSites = new Set<string>()
    users.forEach(user => {
      if (user.allSites) {
        uniqueSites.add('__ALL__')
      } else {
        user.siteNames.forEach(name => uniqueSites.add(name))
      }
    })

    const filters = Array.from(uniqueSites).map(name => {
      if (name === '__ALL__') {
        return { text: 'Все объекты', value: '__ALL__' }
      }
      return { text: name, value: name }
    }).sort((a, b) => {
      if (a.value === '__ALL__') return -1
      if (b.value === '__ALL__') return 1
      return a.text.localeCompare(b.text)
    })

    filters.push({ text: 'Не указано', value: '__NONE__' })

    return filters
  }, [users])

  // Фильтрация данных по поисковым полям
  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      const matchFullName = !searchFullName ||
        (user.fullName?.toLowerCase() || '').includes(searchFullName.toLowerCase())
      const matchCounterparty = !searchCounterparty ||
        (user.counterpartyName?.toLowerCase() || '').includes(searchCounterparty.toLowerCase())
      return matchFullName && matchCounterparty
    })
  }, [users, searchFullName, searchCounterparty])

  const columns = [
    {
      title: 'ФИО',
      dataIndex: 'fullName',
      key: 'fullName',
      sorter: (a: UserRecord, b: UserRecord) => {
        const aVal = a.fullName || ''
        const bVal = b.fullName || ''
        return aVal.localeCompare(bVal)
      },
      render: (name: string) => name || '—',
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      sorter: (a: UserRecord, b: UserRecord) => a.email.localeCompare(b.email),
    },
    {
      title: 'Роль',
      dataIndex: 'role',
      key: 'role',
      sorter: (a: UserRecord, b: UserRecord) => a.role.localeCompare(b.role),
      filters: [
        { text: 'Администратор', value: 'admin' },
        { text: 'Пользователь', value: 'user' },
        { text: 'Подрядчик', value: 'counterparty_user' },
      ],
      onFilter: (value: boolean | Key, record: UserRecord) => record.role === value,
      render: (role: UserRole) => (
        <Tag color={roleColors[role]}>{roleLabels[role]}</Tag>
      ),
    },
    {
      title: 'Подрядчик',
      dataIndex: 'counterpartyName',
      key: 'counterpartyName',
      sorter: (a: UserRecord, b: UserRecord) => {
        const aVal = a.counterpartyName || ''
        const bVal = b.counterpartyName || ''
        return aVal.localeCompare(bVal)
      },
      render: (name: string | null) => name ?? '—',
    },
    {
      title: 'Подразделение',
      dataIndex: 'department',
      key: 'department',
      sorter: (a: UserRecord, b: UserRecord) => {
        if (a.department === null && b.department === null) return 0
        if (a.department === null) return 1
        if (b.department === null) return -1
        return a.department.localeCompare(b.department)
      },
      filters: [
        { text: DEPARTMENT_LABELS.omts, value: 'omts' },
        { text: DEPARTMENT_LABELS.shtab, value: 'shtab' },
        { text: DEPARTMENT_LABELS.smetny, value: 'smetny' },
        { text: 'Не указано', value: '__NULL__' },
      ],
      onFilter: (value: boolean | Key, record: UserRecord) => {
        if (value === '__NULL__') return record.department === null
        return record.department === value
      },
      render: (dept: Department | null) => dept ? DEPARTMENT_LABELS[dept] : '—',
    },
    {
      title: 'Объекты',
      key: 'sites',
      filters: siteFilters,
      onFilter: (value: boolean | Key, record: UserRecord) => {
        if (value === '__ALL__') return record.allSites
        if (value === '__NONE__') {
          return record.role === 'counterparty_user' ||
            (!record.allSites && record.siteNames.length === 0)
        }
        return record.siteNames.includes(value as string)
      },
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

  // Только активные объекты в селекте
  const activeSites = sites.filter((s) => s.isActive)

  const showSiteFields = selectedRole !== 'counterparty_user'

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Space>
          <Input.Search
            placeholder="Поиск по ФИО"
            allowClear
            style={{ width: 250 }}
            value={searchFullName}
            onChange={(e) => setSearchFullName(e.target.value)}
          />
          <Input.Search
            placeholder="Поиск по подрядчику"
            allowClear
            style={{ width: 250 }}
            value={searchCounterparty}
            onChange={(e) => setSearchCounterparty(e.target.value)}
          />
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsCreateModalOpen(true)}>
          Добавить
        </Button>
      </Space>
      {error && (
        <Alert
          type="error"
          message="Ошибка загрузки пользователей"
          description={error}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      <Table
        columns={columns}
        dataSource={filteredUsers}
        rowKey="id"
        loading={isLoading}
        scroll={{ x: 900 }}
        pagination={{
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          defaultPageSize: 20,
          showTotal: (total, range) => `${range[0]}-${range[1]} из ${total}`,
        }}
      />
      <CreateUserModal
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => {
          setIsCreateModalOpen(false)
          fetchUsers()
        }}
      />
      <Modal
        title="Редактировать пользователя"
        open={isEditModalOpen}
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
            name="full_name"
            label="ФИО"
          >
            <Input />
          </Form.Item>
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
          <Form.Item name="department" label="Подразделение">
            <Select
              placeholder="Выберите подразделение"
              allowClear
            >
              <Select.Option value="shtab">{DEPARTMENT_LABELS.shtab}</Select.Option>
              <Select.Option value="omts">{DEPARTMENT_LABELS.omts}</Select.Option>
              <Select.Option value="smetny">{DEPARTMENT_LABELS.smetny}</Select.Option>
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
