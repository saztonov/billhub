import { useState } from 'react'
import { Table, Button, Modal, Form, Input, InputNumber, Popconfirm, Space, App } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { useOcrStore } from '@/store/ocrStore'
import type { OcrModelSetting } from '@/types'

/** Секция управления моделями OCR */
const OcrModelsSection = () => {
  const { message } = App.useApp()
  const { models, addModel, updateModel, removeModel } = useOcrStore()

  const [modalOpen, setModalOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<OcrModelSetting | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const openAddModal = () => {
    setEditingModel(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEditModal = (model: OcrModelSetting) => {
    setEditingModel(model)
    form.setFieldsValue({
      id: model.id,
      name: model.name,
      inputPrice: model.inputPrice,
      outputPrice: model.outputPrice,
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)

      if (editingModel) {
        await updateModel(editingModel.id, {
          id: values.id,
          name: values.name,
          inputPrice: values.inputPrice,
          outputPrice: values.outputPrice,
        })
        message.success('Модель обновлена')
      } else {
        // Проверка на дубликат ID
        if (models.some((m) => m.id === values.id)) {
          message.error('Модель с таким ID уже существует')
          setSaving(false)
          return
        }
        await addModel({
          id: values.id,
          name: values.name,
          inputPrice: values.inputPrice,
          outputPrice: values.outputPrice,
        })
        message.success('Модель добавлена')
      }

      setModalOpen(false)
      form.resetFields()
    } catch {
      message.error('Ошибка сохранения модели')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await removeModel(id)
      message.success('Модель удалена')
    } catch {
      message.error('Ошибка удаления модели')
    }
  }

  const columns = [
    {
      title: 'ID модели',
      dataIndex: 'id',
      key: 'id',
      ellipsis: true,
    },
    {
      title: 'Название',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Цена вход ($/токен)',
      dataIndex: 'inputPrice',
      key: 'inputPrice',
      width: 160,
      render: (v: number) => v?.toFixed(8) ?? '—',
    },
    {
      title: 'Цена выход ($/токен)',
      dataIndex: 'outputPrice',
      key: 'outputPrice',
      width: 160,
      render: (v: number) => v?.toFixed(8) ?? '—',
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: OcrModelSetting) => (
        <Space>
          <Button
            icon={<EditOutlined />}
            size="small"
            onClick={() => openEditModal(record)}
          />
          <Popconfirm
            title="Удалить модель?"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button icon={<DeleteOutlined />} danger size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAddModal}>
          Добавить модель
        </Button>
      </Space>

      <Table
        columns={columns}
        dataSource={models}
        rowKey="id"
        pagination={false}
        size="small"
      />

      <Modal
        title={editingModel ? 'Редактировать модель' : 'Добавить модель'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="id"
            label="ID модели"
            rules={[{ required: true, message: 'Введите ID модели' }]}
          >
            <Input
              placeholder="google/gemini-3-flash-preview"
              disabled={!!editingModel}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="Название"
            rules={[{ required: true, message: 'Введите название' }]}
          >
            <Input placeholder="Gemini 3 Flash" />
          </Form.Item>
          <Form.Item
            name="inputPrice"
            label="Цена за входящий токен ($)"
            rules={[{ required: true, message: 'Введите цену' }]}
          >
            <InputNumber
              min={0}
              step={0.00000001}
              style={{ width: '100%' }}
              placeholder="0.00000015"
            />
          </Form.Item>
          <Form.Item
            name="outputPrice"
            label="Цена за исходящий токен ($)"
            rules={[{ required: true, message: 'Введите цену' }]}
          >
            <InputNumber
              min={0}
              step={0.00000001}
              style={{ width: '100%' }}
              placeholder="0.0000006"
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

export default OcrModelsSection
