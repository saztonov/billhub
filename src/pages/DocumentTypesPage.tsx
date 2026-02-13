import { useEffect, useState } from 'react'
import {
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
import { useDocumentTypeStore } from '@/store/documentTypeStore'
import type { DocumentType } from '@/types'

const DocumentTypesPage = () => {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<DocumentType | null>(null)
  const [form] = Form.useForm()
  const {
    documentTypes,
    isLoading,
    fetchDocumentTypes,
    createDocumentType,
    updateDocumentType,
    deleteDocumentType,
  } = useDocumentTypeStore()

  useEffect(() => {
    fetchDocumentTypes()
  }, [fetchDocumentTypes])

  const handleCreate = () => {
    setEditingRecord(null)
    form.resetFields()
    setIsModalOpen(true)
  }

  const handleEdit = (record: DocumentType) => {
    setEditingRecord(record)
    form.setFieldsValue(record)
    setIsModalOpen(true)
  }

  const handleDelete = async (id: string) => {
    await deleteDocumentType(id)
    message.success('Тип документа удалён')
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    const payload = {
      name: values.name,
      description: values.description || '',
      is_required: values.isRequired || false,
    }
    if (editingRecord) {
      await updateDocumentType(editingRecord.id, payload)
      message.success('Тип документа обновлён')
    } else {
      await createDocumentType(payload)
      message.success('Тип документа создан')
    }
    setIsModalOpen(false)
    form.resetFields()
  }

  const columns = [
    { title: 'Наименование', dataIndex: 'name', key: 'name' },
    { title: 'Описание', dataIndex: 'description', key: 'description' },
    {
      title: 'Обязательный',
      dataIndex: 'isRequired',
      key: 'isRequired',
      render: (val: boolean) => (
        <Tag color={val ? 'green' : 'default'}>{val ? 'Да' : 'Нет'}</Tag>
      ),
    },
    {
      title: 'Действия',
      key: 'actions',
      render: (_: unknown, record: DocumentType) => (
        <Space>
          <Button icon={<EditOutlined />} onClick={() => handleEdit(record)} size="small" />
          <Popconfirm title="Удалить тип документа?" onConfirm={() => handleDelete(record.id)}>
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
        dataSource={documentTypes}
        rowKey="id"
        loading={isLoading}
        scroll={{ x: 800 }}
      />
      <Modal
        title={editingRecord ? 'Редактировать тип документа' : 'Новый тип документа'}
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
          <Form.Item name="description" label="Описание">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="isRequired" label="Обязательный" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default DocumentTypesPage
