import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Popconfirm,
  Tag,
  Segmented,
  Tooltip,
  App,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  MinusCircleOutlined,
  UploadOutlined,
  SearchOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { useTableScrollY } from '@/hooks/useTableScrollY'
import { useSupplierStore } from '@/store/supplierStore'
import { useAuthStore } from '@/store/authStore'
import { api } from '@/services/api'
import { sendForSecurityReview } from '@/services/supplierSecurityCheckService'
import { logError } from '@/services/errorLogger'
import ImportSuppliersModal from '@/components/suppliers/ImportSuppliersModal'
import SupplierSbModal from '@/components/suppliers/SupplierSbModal'
import type { Supplier } from '@/types'

interface PageResponse {
  items: Supplier[]
  total: number
  page: number
  pageSize: number
}

type SbFilter = 'pending' | 'all'

const DEFAULT_PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300

/** Формат даты ДД.ММ.ГГГГ */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU')
}

const SuppliersPage = () => {
  const { message } = App.useApp()
  const user = useAuthStore((s) => s.user)
  const role = user?.role
  const isSecurity = role === 'security'
  const canManage = role === 'admin' || role === 'user'

  // CRUD-методы через стор (для редактирования, удаления, импорта, создания)
  const { createSupplier, updateSupplier, deleteSupplier } = useSupplierStore()

  // Состояние списка
  const [items, setItems] = useState<Supplier[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  // Поиск с debounce
  const [searchText, setSearchText] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Фильтр «На проверку / Все» — только для security, синхронизация с URL
  const [searchParams, setSearchParams] = useSearchParams()
  const sbFilter: SbFilter = useMemo(() => {
    if (!isSecurity) return 'all'
    return searchParams.get('sbFilter') === 'all' ? 'all' : 'pending'
  }, [isSecurity, searchParams])

  const handleSbFilterChange = useCallback((val: SbFilter) => {
    const next = new URLSearchParams(searchParams)
    next.set('sbFilter', val)
    setSearchParams(next, { replace: true })
    setPage(1)
  }, [searchParams, setSearchParams])

  // Модалки
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<Supplier | null>(null)
  const [form] = Form.useForm()
  const [sbModalOpen, setSbModalOpen] = useState(false)
  const [sbSupplier, setSbSupplier] = useState<Supplier | null>(null)

  // Debounce поиска
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(searchText.trim())
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [searchText])

  // Загрузка страницы с сервера
  const fetchPage = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sbFilter,
      })
      if (debouncedSearch) params.set('search', debouncedSearch)
      const data = await api.get<PageResponse>(`/api/references/suppliers?${params.toString()}`)
      setItems(data?.items ?? [])
      setTotal(data?.total ?? 0)
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Ошибка загрузки списка'
      message.error(text)
      logError({ errorType: 'api_error', errorMessage: text, component: 'SuppliersPage' })
    } finally {
      setIsLoading(false)
    }
  }, [page, pageSize, debouncedSearch, sbFilter, message])

  useEffect(() => {
    fetchPage()
  }, [fetchPage])

  // Открытие модалки по deep-link (location.state.openSupplierId)
  const location = useLocation()
  const openedFromState = useRef(false)
  useEffect(() => {
    const state = location.state as { openSupplierId?: string } | null
    if (!state?.openSupplierId || openedFromState.current) return
    openedFromState.current = true
    const local = items.find((s) => s.id === state.openSupplierId)
    if (local) {
      setSbSupplier(local)
      setSbModalOpen(true)
      return
    }
    api.get<Supplier>(`/api/references/suppliers/${state.openSupplierId}`)
      .then((data) => {
        if (data) {
          setSbSupplier(data)
          setSbModalOpen(true)
        } else {
          message.info('Поставщик удалён')
        }
      })
      .catch(() => message.info('Поставщик удалён'))
  }, [location.state, items, message])

  // CRUD-обработчики
  const handleCreate = useCallback(() => {
    setEditingRecord(null)
    form.resetFields()
    setIsEditModalOpen(true)
  }, [form])

  const handleEdit = useCallback((record: Supplier) => {
    setEditingRecord(record)
    form.setFieldsValue(record)
    setIsEditModalOpen(true)
  }, [form])

  const handleDelete = useCallback(async (id: string) => {
    await deleteSupplier(id)
    message.success('Поставщик удалён')
    fetchPage()
  }, [deleteSupplier, message, fetchPage])

  const handleSubmit = useCallback(async () => {
    const values = await form.validateFields()
    if (editingRecord) {
      await updateSupplier(editingRecord.id, values)
      message.success('Поставщик обновлён')
    } else {
      await createSupplier(values)
      message.success('Поставщик создан')
    }
    setIsEditModalOpen(false)
    form.resetFields()
    fetchPage()
  }, [form, editingRecord, updateSupplier, createSupplier, message, fetchPage])

  const handleSendForReview = useCallback(async (record: Supplier) => {
    try {
      await sendForSecurityReview(record.id)
      message.success('Поставщик отправлен на проверку СБ')
      fetchPage()
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Ошибка отправки на проверку'
      message.error(text)
    }
  }, [message, fetchPage])

  const handleRowClick = useCallback((record: Supplier) => {
    if (!canManage && !isSecurity) return
    setSbSupplier(record)
    setSbModalOpen(true)
  }, [canManage, isSecurity])

  // Колонки таблицы
  const columns: ColumnsType<Supplier> = useMemo(() => {
    const base: ColumnsType<Supplier> = [
      { title: 'Наименование', dataIndex: 'name', key: 'name' },
      { title: 'ИНН', dataIndex: 'inn', key: 'inn', width: 160 },
      {
        title: 'Альтернативное наименование',
        dataIndex: 'alternativeNames',
        key: 'alternativeNames',
        render: (names: string[]) => names?.join('; ') || '',
      },
      {
        title: 'Проверка СБ',
        key: 'sb',
        width: 180,
        render: (_: unknown, record: Supplier) => {
          if (record.hasPendingRequest) {
            return <Tag color="blue">На проверке</Tag>
          }
          const last = record.lastSecurityCheck
          if (!last) return <span style={{ color: '#bbb' }}>—</span>
          const isApproved = last.status === 'approved'
          return (
            <div>
              <Tag color={isApproved ? 'green' : 'red'}>{isApproved ? 'Согласовано' : 'Отклонено'}</Tag>
              <div style={{ fontSize: 12, color: '#999' }}>{formatDate(last.createdAt)}</div>
            </div>
          )
        },
      },
    ]

    if (!isSecurity) {
      base.push({
        title: 'Действия',
        key: 'actions',
        width: 160,
        render: (_: unknown, record: Supplier) => (
          <Space onClick={(e) => e.stopPropagation()}>
            <Button icon={<EditOutlined />} onClick={() => handleEdit(record)} size="small" />
            <Popconfirm title="Удалить поставщика?" onConfirm={() => handleDelete(record.id)}>
              <Button icon={<DeleteOutlined />} danger size="small" />
            </Popconfirm>
            {canManage && (
              <Tooltip title={record.hasPendingRequest ? 'Уже на проверке' : 'Отправить на проверку СБ'}>
                <Popconfirm
                  title="Отправить поставщика на проверку СБ?"
                  onConfirm={() => handleSendForReview(record)}
                  okText="Отправить"
                  cancelText="Отмена"
                  disabled={record.hasPendingRequest}
                >
                  <Button
                    icon={<SafetyCertificateOutlined />}
                    size="small"
                    disabled={record.hasPendingRequest}
                  />
                </Popconfirm>
              </Tooltip>
            )}
          </Space>
        ),
      })
    }

    return base
  }, [isSecurity, canManage, handleEdit, handleDelete, handleSendForReview])

  const { containerRef, scrollY } = useTableScrollY([items.length])

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {isSecurity ? (
            <Segmented<SbFilter>
              options={[
                { label: 'На проверку', value: 'pending' },
                { label: 'Все', value: 'all' },
              ]}
              value={sbFilter}
              onChange={(v) => handleSbFilterChange(v)}
            />
          ) : <div />}
          {canManage && (
            <Space>
              <Button icon={<UploadOutlined />} onClick={() => setIsImportModalOpen(true)}>
                Импорт из Excel
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                Добавить
              </Button>
            </Space>
          )}
        </div>
      </div>
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }}>
        <Table<Supplier>
          columns={columns}
          dataSource={items}
          rowKey="id"
          loading={isLoading}
          scroll={{ x: 900, y: scrollY }}
          onRow={(record) => ({
            onClick: () => handleRowClick(record),
            style: (canManage || isSecurity) ? { cursor: 'pointer' } : undefined,
          })}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50', '100'],
            showTotal: (t, range) => `${range[0]}-${range[1]} из ${t}`,
            onChange: (p, ps) => {
              setPage(p)
              setPageSize(ps)
            },
          }}
        />
      </div>

      {/* Модалка создания/редактирования поставщика (admin/user) */}
      <Modal
        title={editingRecord ? 'Редактировать поставщика' : 'Новый поставщик'}
        open={isEditModalOpen}
        onOk={handleSubmit}
        onCancel={() => setIsEditModalOpen(false)}
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
        onClose={() => {
          setIsImportModalOpen(false)
          fetchPage()
        }}
      />

      <SupplierSbModal
        open={sbModalOpen}
        supplier={sbSupplier}
        onClose={() => setSbModalOpen(false)}
        onDecisionSubmitted={fetchPage}
      />
    </div>
  )
}

export default SuppliersPage
