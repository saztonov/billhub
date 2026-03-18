import { useEffect, useState, useRef } from 'react'
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Popconfirm,
  App,
  Switch,
  Tag,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import * as XLSX from 'xlsx'
import { useTableScrollY } from '@/hooks/useTableScrollY'
import { useCostTypeStore } from '@/store/costTypeStore'
import { logError } from '@/services/errorLogger'
import type { CostType } from '@/types'

interface CostTypesPageProps {
  canEdit: boolean
}

const CostTypesPage = ({ canEdit }: CostTypesPageProps) => {
  const { message } = App.useApp()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<CostType | null>(null)
  const [form] = Form.useForm()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const {
    costTypes,
    isLoading,
    fetchCostTypes,
    createCostType,
    updateCostType,
    deleteCostType,
    batchInsertCostTypes,
  } = useCostTypeStore()

  useEffect(() => {
    fetchCostTypes()
  }, [fetchCostTypes])

  const handleCreate = () => {
    setEditingRecord(null)
    form.resetFields()
    form.setFieldsValue({ isActive: true })
    setIsModalOpen(true)
  }

  const handleEdit = (record: CostType) => {
    setEditingRecord(record)
    form.setFieldsValue({ name: record.name, isActive: record.isActive })
    setIsModalOpen(true)
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteCostType(id)
      message.success('Вид затрат удалён')
    } catch (err) {
      logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка удаления вида затрат' })
      message.error('Ошибка при удалении')
    }
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editingRecord) {
        await updateCostType(editingRecord.id, values.name, values.isActive)
        message.success('Вид затрат обновлён')
      } else {
        await createCostType(values.name)
        message.success('Вид затрат создан')
      }
      setIsModalOpen(false)
      form.resetFields()
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return
      logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка сохранения вида затрат' })
      message.error('Ошибка при сохранении')
    }
  }

  // Импорт из Excel
  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Сброс input для повторного выбора того же файла
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }

    try {
      const arrayBuffer = await file.arrayBuffer()
      const workbook = XLSX.read(arrayBuffer, { type: 'array' })
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet)

      const names = rows
        .map((row) => {
          const value = row['Наименование']
          return typeof value === 'string' ? value.trim() : ''
        })
        .filter(Boolean)

      if (names.length === 0) {
        message.warning('Не найдена колонка "Наименование" или она пуста')
        return
      }

      const hideLoading = message.loading(`Импорт: 0 / ${names.length}...`, 0)

      const created = await batchInsertCostTypes(names, (done, total) => {
        hideLoading()
        if (done < total) {
          message.loading(`Импорт: ${done} / ${total}...`, 0)
        }
      })

      hideLoading()
      message.success(`Импортировано видов затрат: ${created}`)
    } catch (err) {
      logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка импорта видов затрат' })
      message.error('Ошибка при импорте файла')
    }
  }

  const columns = [
    {
      title: 'Наименование',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Статус',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 120,
      render: (isActive: boolean) =>
        isActive ? (
          <Tag color="green">Активен</Tag>
        ) : (
          <Tag color="default">Неактивен</Tag>
        ),
    },
    ...(canEdit
      ? [
          {
            title: 'Действия',
            key: 'actions',
            width: 120,
            render: (_: unknown, record: CostType) => (
              <Space>
                <Button
                  icon={<EditOutlined />}
                  onClick={() => handleEdit(record)}
                  size="small"
                />
                <Popconfirm
                  title="Удалить вид затрат?"
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

  const { containerRef, scrollY } = useTableScrollY([costTypes.length])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {canEdit && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16, flexShrink: 0, gap: 8 }}>
          <Button icon={<UploadOutlined />} onClick={handleImportClick}>
            Импорт из Excel
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            Добавить
          </Button>
          {/* Скрытый input для выбора файла */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      )}
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }}>
        <Table
          columns={columns}
          dataSource={costTypes}
          rowKey="id"
          loading={isLoading}
          scroll={{ x: 800, y: scrollY }}
          pagination={false}
          rowClassName={(record: CostType) => (record.isActive ? '' : 'ant-table-row-inactive')}
        />
      </div>
      <Modal
        title={editingRecord ? 'Редактировать вид затрат' : 'Новый вид затрат'}
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
          <Form.Item name="isActive" label="Активен" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
      <style>{`
        .ant-table-row-inactive td {
          opacity: 0.5;
        }
      `}</style>
    </div>
  )
}

export default CostTypesPage
