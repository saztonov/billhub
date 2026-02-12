import { useEffect, useState } from 'react'
import {
  Typography,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Switch,
  Tag,
  Popconfirm,
  message,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import { useAuthStore } from '@/store/authStore'
import type { ConstructionSite } from '@/types'

const { Title } = Typography
const { TextArea } = Input

const ConstructionSitesPage = () => {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<ConstructionSite | null>(null)
  const [form] = Form.useForm()

  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'

  const {
    sites,
    isLoading,
    fetchSites,
    createSite,
    updateSite,
    deleteSite,
  } = useConstructionSiteStore()

  useEffect(() => {
    fetchSites()
  }, [fetchSites])

  const handleCreate = () => {
    setEditingRecord(null)
    form.resetFields()
    form.setFieldsValue({ isActive: true })
    setIsModalOpen(true)
  }

  const handleEdit = (record: ConstructionSite) => {
    setEditingRecord(record)
    form.setFieldsValue(record)
    setIsModalOpen(true)
  }

  const handleDelete = async (id: string) => {
    await deleteSite(id)
    message.success('Объект удалён')
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    if (editingRecord) {
      await updateSite(editingRecord.id, values)
      message.success('Объект обновлён')
    } else {
      await createSite(values)
      message.success('Объект создан')
    }
    setIsModalOpen(false)
    form.resetFields()
  }

  const columns = [
    {
      title: 'Наименование',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Адрес',
      dataIndex: 'address',
      key: 'address',
    },
    {
      title: 'Описание',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: 'Активен',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      render: (val: boolean) => (
        <Tag color={val ? 'green' : 'default'}>{val ? 'Да' : 'Нет'}</Tag>
      ),
    },
    ...(isAdmin
      ? [
          {
            title: 'Действия',
            key: 'actions',
            width: 120,
            render: (_: unknown, record: ConstructionSite) => (
              <Space>
                <Button
                  icon={<EditOutlined />}
                  onClick={() => handleEdit(record)}
                  size="small"
                />
                <Popconfirm
                  title="Удалить объект?"
                  onConfirm={() => handleDelete(record.id)}
                >
                  <Button icon={<DeleteOutlined />} danger size="small" />
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : []),
  ]

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Title level={2} style={{ margin: 0 }}>
          Объекты строительства
        </Title>
        {isAdmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            Добавить
          </Button>
        )}
      </div>

      <Table
        columns={columns}
        dataSource={sites}
        rowKey="id"
        loading={isLoading}
        scroll={{ x: 800 }}
      />

      <Modal
        title={editingRecord ? 'Редактировать объект' : 'Новый объект'}
        open={isModalOpen}
        onOk={handleSubmit}
        onCancel={() => setIsModalOpen(false)}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="Наименование"
            rules={[{ required: true, message: 'Введите наименование' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="address" label="Адрес">
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Описание">
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item name="isActive" label="Активен" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default ConstructionSitesPage
