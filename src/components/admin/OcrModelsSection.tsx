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
      inputPriceMillion: model.inputPrice * 1_000_000,
      outputPriceMillion: model.outputPrice * 1_000_000,
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)

      // Конвертация из $/1M токенов в $/токен для хранения
      const inputPrice = values.inputPriceMillion / 1_000_000
      const outputPrice = values.outputPriceMillion / 1_000_000

      if (editingModel) {
        await updateModel(editingModel.id, {
          id: values.id,
          name: values.name,
          inputPrice,
          outputPrice,
        })
        message.success('Модель обновлена')
      } else {
        if (models.some((m) => m.id === values.id)) {
          message.error('Модель с таким ID уже существует')
          setSaving(false)
          return
        }
        await addModel({
          id: values.id,
          name: values.name,
          inputPrice,
          outputPrice,
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
      title: 'Вход ($/1M)',
      dataIndex: 'inputPrice',
      key: 'inputPrice',
      width: 130,
      render: (v: number) => v != null ? `$${(v * 1_000_000).toFixed(2)}` : '—',
    },
    {
      title: 'Выход ($/1M)',
      dataIndex: 'outputPrice',
      key: 'outputPrice',
      width: 130,
      render: (v: number) => v != null ? `$${(v * 1_000_000).toFixed(2)}` : '—',
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
            name="inputPriceMillion"
            label="Цена за 1M входящих токенов ($)"
            rules={[{ required: true, message: 'Введите цену' }]}
          >
            <InputNumber
              min={0}
              step={0.01}
              style={{ width: '100%' }}
              placeholder="0.15"
            />
          </Form.Item>
          <Form.Item
            name="outputPriceMillion"
            label="Цена за 1M исходящих токенов ($)"
            rules={[{ required: true, message: 'Введите цену' }]}
          >
            <InputNumber
              min={0}
              step={0.01}
              style={{ width: '100%' }}
              placeholder="0.60"
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

export default OcrModelsSection
