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
  Popconfirm,
  message,
  Tag,
} from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { useSettingsStore } from '@/store/settingsStore'
import type { OcrModel } from '@/types'

const { Title } = Typography

const OcrSettingsPage = () => {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form] = Form.useForm()
  const {
    ocrModels,
    activeModelId,
    isLoading,
    fetchOcrModels,
    addOcrModel,
    deleteOcrModel,
    setActiveModel,
  } = useSettingsStore()

  useEffect(() => {
    fetchOcrModels()
  }, [fetchOcrModels])

  const handleAdd = () => {
    form.resetFields()
    setIsModalOpen(true)
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    await addOcrModel(values)
    message.success('Модель добавлена')
    setIsModalOpen(false)
  }

  const handleDelete = async (id: string) => {
    await deleteOcrModel(id)
    message.success('Модель удалена')
  }

  const handleSetActive = async (id: string) => {
    await setActiveModel(id)
    message.success('Активная модель изменена')
  }

  const columns = [
    { title: 'Название', dataIndex: 'name', key: 'name' },
    { title: 'Model ID (OpenRouter)', dataIndex: 'modelId', key: 'modelId' },
    {
      title: 'Статус',
      key: 'status',
      render: (_: unknown, record: OcrModel) => (
        record.id === activeModelId
          ? <Tag color="green">Активная</Tag>
          : <Tag>Неактивная</Tag>
      ),
    },
    {
      title: 'Действия',
      key: 'actions',
      render: (_: unknown, record: OcrModel) => (
        <Space>
          {record.id !== activeModelId && (
            <Button size="small" onClick={() => handleSetActive(record.id)}>
              Сделать активной
            </Button>
          )}
          <Popconfirm title="Удалить модель?" onConfirm={() => handleDelete(record.id)}>
            <Button icon={<DeleteOutlined />} danger size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={2} style={{ margin: 0 }}>Настройки OCR</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          Добавить модель
        </Button>
      </div>
      <Table
        columns={columns}
        dataSource={ocrModels}
        rowKey="id"
        loading={isLoading}
      />
      <Modal
        title="Добавить OCR-модель"
        open={isModalOpen}
        onOk={handleSubmit}
        onCancel={() => setIsModalOpen(false)}
        okText="Добавить"
        cancelText="Отмена"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Название" rules={[{ required: true, message: 'Введите название' }]}>
            <Input placeholder="GPT-4 Vision" />
          </Form.Item>
          <Form.Item name="modelId" label="Model ID (OpenRouter)" rules={[{ required: true, message: 'Введите model ID' }]}>
            <Input placeholder="openai/gpt-4o" />
          </Form.Item>
          <Form.Item name="isActive" label="Сделать активной" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default OcrSettingsPage
