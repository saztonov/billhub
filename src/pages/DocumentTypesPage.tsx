import { useEffect, useState } from 'react'
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Popconfirm,
  App,
  Segmented,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { useTableScrollY } from '@/hooks/useTableScrollY'
import { useDocumentTypeStore } from '@/store/documentTypeStore'
import type { DocumentType, DocumentTypeCategory } from '@/types'

const CATEGORY_OPTIONS = [
  { label: 'Операционные', value: 'operational' },
  { label: 'Учредительные', value: 'founding' },
]

const DocumentTypesPage = () => {
  const { message } = App.useApp()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<DocumentType | null>(null)
  const [category, setCategory] = useState<DocumentTypeCategory>('operational')
  const [form] = Form.useForm()
  const {
    documentTypes,
    foundingTypes,
    isLoading,
    fetchDocumentTypes,
    createDocumentType,
    updateDocumentType,
    deleteDocumentType,
  } = useDocumentTypeStore()

  // Выбираем нужный массив в зависимости от категории
  const displayTypes = category === 'founding' ? foundingTypes : documentTypes

  useEffect(() => {
    fetchDocumentTypes(category)
  }, [fetchDocumentTypes, category])

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
    await fetchDocumentTypes(category)
    message.success('Тип документа удален')
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    if (editingRecord) {
      await updateDocumentType(editingRecord.id, { name: values.name, category })
      message.success('Тип документа обновлен')
    } else {
      await createDocumentType({ name: values.name, category })
      message.success('Тип документа создан')
    }
    await fetchDocumentTypes(category)
    setIsModalOpen(false)
    form.resetFields()
  }

  const columns = [
    { title: 'Наименование', dataIndex: 'name', key: 'name' },
    {
      title: 'Действия',
      key: 'actions',
      width: 100,
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

  const { containerRef, scrollY } = useTableScrollY([displayTypes.length])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexShrink: 0 }}>
        <Segmented
          options={CATEGORY_OPTIONS}
          value={category}
          onChange={(val) => setCategory(val as DocumentTypeCategory)}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          Добавить
        </Button>
      </div>
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }}>
        <Table
          columns={columns}
          dataSource={displayTypes}
          rowKey="id"
          loading={isLoading}
          scroll={{ x: 800, y: scrollY }}
          pagination={false}
        />
      </div>
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
        </Form>
      </Modal>
    </div>
  )
}

export default DocumentTypesPage
