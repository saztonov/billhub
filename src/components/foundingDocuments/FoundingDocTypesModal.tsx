import { useEffect, useState } from 'react'
import {
  Modal,
  Table,
  Button,
  Space,
  Input,
  Popconfirm,
  Form,
  App,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { useDocumentTypeStore } from '@/store/documentTypeStore'
import type { DocumentType } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
}

/** Модалка управления списком видов учредительных документов (category='founding') */
const FoundingDocTypesModal = ({ open, onClose }: Props) => {
  const { message } = App.useApp()
  const {
    foundingTypes,
    isLoading,
    fetchDocumentTypes,
    createDocumentType,
    updateDocumentType,
    deleteDocumentType,
  } = useDocumentTypeStore()

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<DocumentType | null>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    if (open) {
      fetchDocumentTypes('founding')
    }
  }, [open, fetchDocumentTypes])

  const handleCreate = () => {
    setEditingRecord(null)
    form.resetFields()
    setIsFormOpen(true)
  }

  const handleEdit = (record: DocumentType) => {
    setEditingRecord(record)
    form.setFieldsValue({ name: record.name })
    setIsFormOpen(true)
  }

  const handleDelete = async (id: string) => {
    await deleteDocumentType(id)
    await fetchDocumentTypes('founding')
    message.success('Вид документа удален')
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    if (editingRecord) {
      await updateDocumentType(editingRecord.id, { name: values.name, category: 'founding' })
      message.success('Вид документа обновлен')
    } else {
      await createDocumentType({ name: values.name, category: 'founding' })
      message.success('Вид документа создан')
    }
    await fetchDocumentTypes('founding')
    setIsFormOpen(false)
    form.resetFields()
  }

  const columns = [
    {
      title: 'Наименование',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_: unknown, record: DocumentType) => (
        <Space size={4}>
          <Button icon={<EditOutlined />} size="small" onClick={() => handleEdit(record)} />
          <Popconfirm title="Удалить вид документа?" onConfirm={() => handleDelete(record.id)}>
            <Button icon={<DeleteOutlined />} size="small" danger />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Modal
      title="Виды учредительных документов"
      open={open}
      onCancel={onClose}
      footer={null}
      width={500}
      destroyOnClose
    >
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="primary" icon={<PlusOutlined />} size="small" onClick={handleCreate}>
          Добавить
        </Button>
      </div>
      <Table
        columns={columns}
        dataSource={foundingTypes}
        rowKey="id"
        loading={isLoading}
        pagination={false}
        size="small"
        locale={{ emptyText: 'Нет видов учредительных документов' }}
      />

      {/* Вложенная модалка создания/редактирования */}
      <Modal
        title={editingRecord ? 'Редактировать' : 'Новый вид документа'}
        open={isFormOpen}
        onOk={handleSubmit}
        onCancel={() => setIsFormOpen(false)}
        okText="Сохранить"
        cancelText="Отмена"
        width={400}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="Наименование"
            rules={[{ required: true, message: 'Введите наименование' }]}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Modal>
  )
}

export default FoundingDocTypesModal
