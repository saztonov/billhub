import { useEffect, useMemo, useState } from 'react'
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Popconfirm,
  App,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, MinusCircleOutlined, UploadOutlined, SearchOutlined } from '@ant-design/icons'
import { useTableScrollY } from '@/hooks/useTableScrollY'
import { useSupplierStore } from '@/store/supplierStore'
import { useAuthStore } from '@/store/authStore'
import ImportSuppliersModal from '@/components/suppliers/ImportSuppliersModal'
import type { Supplier } from '@/types'

const SuppliersPage = () => {
  const { message } = App.useApp()
  const user = useAuthStore((s) => s.user)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<Supplier | null>(null)
  const [form] = Form.useForm()
  const [searchText, setSearchText] = useState('')
  const {
    suppliers,
    isLoading,
    fetchSuppliers,
    createSupplier,
    updateSupplier,
    deleteSupplier,
  } = useSupplierStore()

  useEffect(() => {
    fetchSuppliers()
  }, [fetchSuppliers])

  const filteredSuppliers = useMemo(() => {
    if (!searchText.trim()) return suppliers
    const query = searchText.trim().toLowerCase()
    return suppliers.filter((s) =>
      s.name.toLowerCase().includes(query) ||
      s.inn.toLowerCase().includes(query) ||
      s.alternativeNames?.some((n) => n.toLowerCase().includes(query))
    )
  }, [suppliers, searchText])

  const { containerRef, scrollY } = useTableScrollY([filteredSuppliers.length])

  const handleCreate = () => {
    setEditingRecord(null)
    form.resetFields()
    setIsModalOpen(true)
  }

  const handleEdit = (record: Supplier) => {
    setEditingRecord(record)
    form.setFieldsValue(record)
    setIsModalOpen(true)
  }

  const handleDelete = async (id: string) => {
    await deleteSupplier(id)
    message.success('Поставщик удалён')
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    if (editingRecord) {
      await updateSupplier(editingRecord.id, values)
      message.success('Поставщик обновлён')
    } else {
      await createSupplier(values)
      message.success('Поставщик создан')
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
      render: (_: unknown, record: Supplier) => (
        <Space>
          <Button icon={<EditOutlined />} onClick={() => handleEdit(record)} size="small" />
          <Popconfirm title="Удалить поставщика?" onConfirm={() => handleDelete(record.id)}>
            <Button icon={<DeleteOutlined />} danger size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ flexShrink: 0 }}>
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
      </div>
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }}>
        <Table
          columns={columns}
          dataSource={filteredSuppliers}
          rowKey="id"
          loading={isLoading}
          scroll={{ x: 800, y: scrollY }}
          pagination={false}
        />
      </div>
      <Modal
        title={editingRecord ? 'Редактировать поставщика' : 'Новый поставщик'}
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
      <ImportSuppliersModal
        open={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />
    </div>
  )
}

export default SuppliersPage
