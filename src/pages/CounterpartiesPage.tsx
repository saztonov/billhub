import { useEffect, useState } from 'react'
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Popconfirm,
  message,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, MinusCircleOutlined } from '@ant-design/icons'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import type { Counterparty } from '@/types'

const CounterpartiesPage = () => {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<Counterparty | null>(null)
  const [form] = Form.useForm()
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
    message.success('Контрагент удалён')
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    if (editingRecord) {
      await updateCounterparty(editingRecord.id, values)
      message.success('Контрагент обновлён')
    } else {
      await createCounterparty(values)
      message.success('Контрагент создан')
    }
    setIsModalOpen(false)
    form.resetFields()
  }

  const columns = [
    { title: 'Наименование', dataIndex: 'name', key: 'name' },
    { title: 'ИНН', dataIndex: 'inn', key: 'inn' },
    { title: 'Адрес', dataIndex: 'address', key: 'address' },
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
          <Button icon={<EditOutlined />} onClick={() => handleEdit(record)} size="small" />
          <Popconfirm title="Удалить контрагента?" onConfirm={() => handleDelete(record.id)}>
            <Button icon={<DeleteOutlined />} danger size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          Добавить
        </Button>
      </div>
      <Table
        columns={columns}
        dataSource={counterparties}
        rowKey="id"
        loading={isLoading}
        scroll={{ x: 800 }}
      />
      <Modal
        title={editingRecord ? 'Редактировать контрагента' : 'Новый контрагент'}
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
          <Form.Item name="address" label="Адрес">
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
    </div>
  )
}

export default CounterpartiesPage
