import { useEffect, useMemo, useState } from 'react'
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Popconfirm,
  Tooltip,
  App,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, MinusCircleOutlined, LinkOutlined, UploadOutlined, SearchOutlined } from '@ant-design/icons'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useAuthStore } from '@/store/authStore'
import ImportCounterpartiesModal from '@/components/counterparties/ImportCounterpartiesModal'
import type { Counterparty } from '@/types'

const CounterpartiesPage = () => {
  const { message } = App.useApp()
  const user = useAuthStore((s) => s.user)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<Counterparty | null>(null)
  const [form] = Form.useForm()
  const [searchText, setSearchText] = useState('')
  const {
    counterparties,
    isLoading,
    fetchCounterparties,
    createCounterparty,
    updateCounterparty,
    deleteCounterparty,
  } = useCounterpartyStore()

  useEffect(() => {
    fetchCounterparties()
  }, [fetchCounterparties])

  const filteredCounterparties = useMemo(() => {
    if (!searchText.trim()) return counterparties
    const query = searchText.trim().toLowerCase()
    return counterparties.filter((c) =>
      c.name.toLowerCase().includes(query) ||
      c.inn.toLowerCase().includes(query) ||
      c.alternativeNames?.some((n) => n.toLowerCase().includes(query))
    )
  }, [counterparties, searchText])

  const handleCreate = () => {
    setEditingRecord(null)
    form.resetFields()
    setIsModalOpen(true)
  }

  const handleEdit = (record: Counterparty) => {
    setEditingRecord(record)
    form.setFieldsValue(record)
    setIsModalOpen(true)
  }

  const handleDelete = async (id: string) => {
    await deleteCounterparty(id)
    message.success('Подрядчик удалён')
  }

  const handleCopyRegistrationLink = async (record: Counterparty) => {
    if (!record.registrationToken) {
      message.error('Токен регистрации не найден')
      return
    }
    const url = `${window.location.origin}/register?token=${record.registrationToken}`
    try {
      await navigator.clipboard.writeText(url)
      message.success('Ссылка для регистрации скопирована')
    } catch {
      message.error('Не удалось скопировать ссылку')
    }
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    if (editingRecord) {
      await updateCounterparty(editingRecord.id, values)
      message.success('Подрядчик обновлён')
    } else {
      await createCounterparty(values)
      message.success('Подрядчик создан')
    }
    setIsModalOpen(false)
    form.resetFields()
  }

  const columns = [
    { title: 'Наименование', dataIndex: 'name', key: 'name' },
    { title: 'ИНН', dataIndex: 'inn', key: 'inn' },
    {
      title: 'Альтернативное наименование',
      dataIndex: 'alternativeNames',
      key: 'alternativeNames',
      render: (names: string[]) => names?.join('; ') || '',
    },
    {
      title: 'Действия',
      key: 'actions',
      render: (_: unknown, record: Counterparty) => (
        <Space>
          <Tooltip title="Скопировать ссылку для регистрации">
            <Button icon={<LinkOutlined />} onClick={() => handleCopyRegistrationLink(record)} size="small" />
          </Tooltip>
          <Button icon={<EditOutlined />} onClick={() => handleEdit(record)} size="small" />
          <Popconfirm title="Удалить подрядчика?" onConfirm={() => handleDelete(record.id)}>
            <Button icon={<DeleteOutlined />} danger size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Input.Search
        prefix={<SearchOutlined />}
        placeholder="Поиск по наименованию, ИНН или альтернативному наименованию"
        allowClear
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        style={{ marginBottom: 16 }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
        {user?.role === 'admin' && (
          <Button icon={<UploadOutlined />} onClick={() => setIsImportModalOpen(true)}>
            Импорт из Excel
          </Button>
        )}
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          Добавить
        </Button>
      </div>
      <Table
        columns={columns}
        dataSource={filteredCounterparties}
        rowKey="id"
        loading={isLoading}
        scroll={{ x: 800 }}
      />
      <Modal
        title={editingRecord ? 'Редактировать подрядчика' : 'Новый подрядчик'}
        open={isModalOpen}
        onOk={handleSubmit}
        onCancel={() => setIsModalOpen(false)}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Наименование" rules={[{ required: true, message: 'Введите наименование' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="inn" label="ИНН" rules={[{ required: true, message: 'Введите ИНН' }]}>
            <Input />
          </Form.Item>
          <Form.List name="alternativeNames">
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 8 }}>
                  <span>Альтернативные наименования</span>
                  <Button
                    type="link"
                    icon={<PlusOutlined />}
                    onClick={() => add('')}
                    size="small"
                    style={{ marginLeft: 8 }}
                  >
                    Добавить
                  </Button>
                </div>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                    <Form.Item
                      {...field}
                      rules={[{ required: true, message: 'Введите наименование' }]}
                      style={{ marginBottom: 0, flex: 1 }}
                    >
                      <Input placeholder="Альтернативное наименование" style={{ width: 380 }} />
                    </Form.Item>
                    <MinusCircleOutlined
                      onClick={() => remove(field.name)}
                      style={{ color: '#ff4d4f' }}
                    />
                  </Space>
                ))}
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
      <ImportCounterpartiesModal
        open={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />
    </div>
  )
}

export default CounterpartiesPage
