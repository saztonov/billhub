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
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useAuthStore } from '@/store/authStore'
import { api } from '@/services/api'
import { sendForSecurityReview } from '@/services/counterpartySecurityCheckService'
import { logError } from '@/services/errorLogger'
import ImportCounterpartiesModal from '@/components/counterparties/ImportCounterpartiesModal'
import CounterpartySbModal from '@/components/counterparties/CounterpartySbModal'
import type { Counterparty } from '@/types'

interface PageResponse {
  items: Counterparty[]
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

const CounterpartiesPage = () => {
  const { message } = App.useApp()
  const user = useAuthStore((s) => s.user)
  const role = user?.role
  const isSecurity = role === 'security'
  const canManage = role === 'admin' || role === 'user'

  // CRUD-методы через стор (для редактирования, удаления, импорта, создания)
  const { createCounterparty, updateCounterparty, deleteCounterparty } = useCounterpartyStore()

  // Состояние списка
  const [items, setItems] = useState<Counterparty[]>([])
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
  const [editingRecord, setEditingRecord] = useState<Counterparty | null>(null)
  const [form] = Form.useForm()
  const [sbModalOpen, setSbModalOpen] = useState(false)
  const [sbCounterparty, setSbCounterparty] = useState<Counterparty | null>(null)

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
      const data = await api.get<PageResponse>(`/api/references/counterparties?${params.toString()}`)
      setItems(data?.items ?? [])
      setTotal(data?.total ?? 0)
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Ошибка загрузки списка'
      message.error(text)
      logError({ errorType: 'api_error', errorMessage: text, component: 'CounterpartiesPage' })
    } finally {
      setIsLoading(false)
    }
  }, [page, pageSize, debouncedSearch, sbFilter, message])

  useEffect(() => {
    fetchPage()
  }, [fetchPage])

  // Открытие модалки по deep-link (location.state.openCounterpartyId)
  const location = useLocation()
  const openedFromState = useRef(false)
  useEffect(() => {
    const state = location.state as { openCounterpartyId?: string } | null
    if (!state?.openCounterpartyId || openedFromState.current) return
    openedFromState.current = true
    // Если поставщик есть на текущей странице — открываем сразу; иначе подгружаем
    const local = items.find((c) => c.id === state.openCounterpartyId)
    if (local) {
      setSbCounterparty(local)
      setSbModalOpen(true)
      return
    }
    api.get<Counterparty>(`/api/references/counterparties/${state.openCounterpartyId}`)
      .then((data) => {
        if (data) {
          setSbCounterparty(data)
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

  const handleEdit = useCallback((record: Counterparty) => {
    setEditingRecord(record)
    form.setFieldsValue(record)
    setIsEditModalOpen(true)
  }, [form])

  const handleDelete = useCallback(async (id: string) => {
    await deleteCounterparty(id)
    message.success('Подрядчик удалён')
    fetchPage()
  }, [deleteCounterparty, message, fetchPage])

  const handleSubmit = useCallback(async () => {
    const values = await form.validateFields()
    if (editingRecord) {
      await updateCounterparty(editingRecord.id, values)
      message.success('Подрядчик обновлён')
    } else {
      await createCounterparty(values)
      message.success('Подрядчик создан')
    }
    setIsEditModalOpen(false)
    form.resetFields()
    fetchPage()
  }, [form, editingRecord, updateCounterparty, createCounterparty, message, fetchPage])

  const handleSendForReview = useCallback(async (record: Counterparty) => {
    try {
      await sendForSecurityReview(record.id)
      message.success('Поставщик отправлен на проверку СБ')
      fetchPage()
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Ошибка отправки на проверку'
      message.error(text)
    }
  }, [message, fetchPage])

  const handleRowClick = useCallback((record: Counterparty) => {
    if (!canManage && !isSecurity) return
    setSbCounterparty(record)
    setSbModalOpen(true)
  }, [canManage, isSecurity])

  // Колонки таблицы
  const columns: ColumnsType<Counterparty> = useMemo(() => {
    const base: ColumnsType<Counterparty> = [
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
        render: (_: unknown, record: Counterparty) => {
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
        render: (_: unknown, record: Counterparty) => (
          <Space onClick={(e) => e.stopPropagation()}>
            <Button icon={<EditOutlined />} onClick={() => handleEdit(record)} size="small" />
            <Popconfirm title="Удалить подрядчика?" onConfirm={() => handleDelete(record.id)}>
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
        <Table<Counterparty>
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

      {/* Модалка создания/редактирования контрагента (admin/user) */}
      <Modal
        title={editingRecord ? 'Редактировать подрядчика' : 'Новый подрядчик'}
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

      <ImportCounterpartiesModal
        open={isImportModalOpen}
        onClose={() => {
          setIsImportModalOpen(false)
          fetchPage()
        }}
      />

      <CounterpartySbModal
        open={sbModalOpen}
        counterparty={sbCounterparty}
        onClose={() => setSbModalOpen(false)}
        onDecisionSubmitted={fetchPage}
      />
    </div>
  )
}

export default CounterpartiesPage
