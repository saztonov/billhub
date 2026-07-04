import { useEffect, useMemo, useState } from 'react'
import { Table, Button, Space, Modal, Form, Input, Switch, Tag, Popconfirm, App } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { useTableScrollY } from '@/hooks/useTableScrollY'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import { usePayHubCatalogStore } from '@/store/payhubCatalogStore'
import { useAuthStore } from '@/store/authStore'
import { PayhubReferenceSelect } from '@/components/references/PayhubReferenceSelect'
import { projectLabel, contractorLabel, type PayhubOption } from '@/utils/payhubLabels'
import type { ConstructionSite } from '@/types'

const ConstructionSitesPage = () => {
  const { message } = App.useApp()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<ConstructionSite | null>(null)
  const [form] = Form.useForm()

  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'
  // Столбцы PayHub видят внутренние роли; counterparty_user их не получает (API их не отдаёт)
  const canSeePayhub = user?.role === 'admin' || user?.role === 'user'

  const { sites, isLoading, fetchSites, createSite, updateSite, deleteSite } =
    useConstructionSiteStore()

  const {
    projects,
    contractors,
    configured: payhubConfigured,
    ok: payhubOk,
    fetchCatalog,
  } = usePayHubCatalogStore()
  const catalogReady = payhubConfigured && payhubOk

  useEffect(() => {
    fetchSites()
  }, [fetchSites])

  // Каталоги PayHub нужны только admin (для инлайн-выбора); user видит снимки из объекта
  useEffect(() => {
    if (isAdmin) fetchCatalog()
  }, [isAdmin, fetchCatalog])

  const projectOptions = useMemo<PayhubOption[]>(
    () => projects.map((p) => ({ value: p.id, label: projectLabel(p.code, p.name, p.id) })),
    [projects],
  )
  const contractorOptions = useMemo<PayhubOption[]>(
    () => contractors.map((c) => ({ value: c.id, label: contractorLabel(c.name, c.inn, c.id) })),
    [contractors],
  )

  // Плейсхолдер зависит от состояния интеграции PayHub
  const payhubPlaceholder = catalogReady
    ? undefined
    : payhubConfigured
      ? 'PayHub недоступен'
      : 'PayHub не настроен'

  const handleProjectChange = async (
    record: ConstructionSite,
    value: number | string | undefined,
  ) => {
    const proj = value !== undefined ? projects.find((p) => p.id === value) : undefined
    const ok = await updateSite(
      record.id,
      value === undefined
        ? { payhubProjectId: null, payhubProjectCode: null, payhubProjectName: null }
        : {
            payhubProjectId: value as number,
            payhubProjectCode: proj?.code ?? null,
            payhubProjectName: proj?.name ?? null,
          },
    )
    if (!ok) message.error('Не удалось сохранить проект PayHub')
  }

  const handleContractorChange = async (
    record: ConstructionSite,
    value: number | string | undefined,
  ) => {
    const c = value !== undefined ? contractors.find((x) => x.id === value) : undefined
    const ok = await updateSite(
      record.id,
      value === undefined
        ? { payhubContractorId: null, payhubContractorName: null, payhubContractorInn: null }
        : {
            payhubContractorId: String(value),
            payhubContractorName: c?.name ?? null,
            payhubContractorInn: c?.inn ?? null,
          },
    )
    if (!ok) message.error('Не удалось сохранить заказчика PayHub')
  }

  const handleCreate = () => {
    setEditingRecord(null)
    form.resetFields()
    form.setFieldsValue({ isActive: true })
    setIsModalOpen(true)
  }

  const handleEdit = (record: ConstructionSite) => {
    setEditingRecord(record)
    form.setFieldsValue(record)
    setIsModalOpen(true)
  }

  const handleDelete = async (id: string) => {
    await deleteSite(id)
    message.success('Объект удалён')
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    if (editingRecord) {
      await updateSite(editingRecord.id, values)
      message.success('Объект обновлён')
    } else {
      await createSite(values)
      message.success('Объект создан')
    }
    setIsModalOpen(false)
    form.resetFields()
  }

  const columns = [
    // Самый левый столбец «КОД» — код сопоставленного PayHub-проекта (снимок); только admin/user
    ...(canSeePayhub
      ? [
          {
            title: 'КОД',
            dataIndex: 'payhubProjectCode',
            key: 'payhubProjectCode',
            width: 100,
            fixed: 'left' as const,
            render: (val: string | null | undefined) => val ?? '—',
          },
        ]
      : []),
    {
      title: 'Наименование',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Активен',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      render: (val: boolean) => <Tag color={val ? 'green' : 'default'}>{val ? 'Да' : 'Нет'}</Tag>,
    },
    ...(canSeePayhub
      ? [
          {
            title: 'PayHub-проект',
            key: 'payhubProject',
            width: 240,
            render: (_: unknown, record: ConstructionSite) => {
              if (!isAdmin) {
                return record.payhubProjectId != null
                  ? projectLabel(
                      record.payhubProjectCode,
                      record.payhubProjectName,
                      record.payhubProjectId,
                    )
                  : '—'
              }
              const opts = [...projectOptions]
              if (
                record.payhubProjectId != null &&
                !projects.some((p) => p.id === record.payhubProjectId)
              ) {
                opts.unshift({
                  value: record.payhubProjectId,
                  label: projectLabel(
                    record.payhubProjectCode,
                    record.payhubProjectName,
                    record.payhubProjectId,
                  ),
                })
              }
              return (
                <PayhubReferenceSelect
                  value={record.payhubProjectId}
                  options={opts}
                  disabled={!catalogReady}
                  placeholder={payhubPlaceholder ?? 'Выберите проект'}
                  onChange={(v) => handleProjectChange(record, v)}
                />
              )
            },
          },
          {
            title: 'Заказчик',
            key: 'payhubContractor',
            width: 240,
            render: (_: unknown, record: ConstructionSite) => {
              if (!isAdmin) {
                return record.payhubContractorId != null
                  ? contractorLabel(
                      record.payhubContractorName,
                      record.payhubContractorInn,
                      record.payhubContractorId,
                    )
                  : '—'
              }
              const opts = [...contractorOptions]
              if (
                record.payhubContractorId != null &&
                !contractors.some((c) => c.id === record.payhubContractorId)
              ) {
                opts.unshift({
                  value: record.payhubContractorId,
                  label: contractorLabel(
                    record.payhubContractorName,
                    record.payhubContractorInn,
                    record.payhubContractorId,
                  ),
                })
              }
              return (
                <PayhubReferenceSelect
                  value={record.payhubContractorId}
                  options={opts}
                  disabled={!catalogReady}
                  placeholder={payhubPlaceholder ?? 'Выберите заказчика'}
                  onChange={(v) => handleContractorChange(record, v)}
                />
              )
            },
          },
        ]
      : []),
    ...(isAdmin
      ? [
          {
            title: 'Действия',
            key: 'actions',
            width: 120,
            render: (_: unknown, record: ConstructionSite) => (
              <Space>
                <Button icon={<EditOutlined />} onClick={() => handleEdit(record)} size="small" />
                <Popconfirm title="Удалить объект?" onConfirm={() => handleDelete(record.id)}>
                  <Button icon={<DeleteOutlined />} danger size="small" />
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : []),
  ]

  const { containerRef, scrollY } = useTableScrollY([sites.length])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {isAdmin && (
        <div
          style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16, flexShrink: 0 }}
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            Добавить
          </Button>
        </div>
      )}

      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }}>
        <Table
          columns={columns}
          dataSource={sites}
          rowKey="id"
          loading={isLoading}
          scroll={{ x: canSeePayhub ? 1200 : 800, y: scrollY }}
          pagination={{
            defaultPageSize: 20,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50', '100'],
            showTotal: (total, range) => `${range[0]}-${range[1]} из ${total}`,
          }}
        />
      </div>

      <Modal
        title={editingRecord ? 'Редактировать объект' : 'Новый объект'}
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
    </div>
  )
}

export default ConstructionSitesPage
