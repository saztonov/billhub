import { useEffect, useState } from 'react'
import { Table, Button, Select, Space, Popconfirm, App, Card, Typography } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { useRpStageStore } from '@/store/rpStageStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import { DEPARTMENT_LABELS } from '@/types'
import type { RpStageAssignee } from '@/types'

const { Text } = Typography

/**
 * Настройки этапа согласования «РП»: назначения «объект строительства → сотрудник».
 * Строго один сотрудник на объект; кандидаты — активные сотрудники Штаба и ОМТС.
 */
const RpSettingsTab = () => {
  const { message } = App.useApp()
  const {
    assignees,
    candidates,
    isLoading,
    fetchAssignees,
    addAssignee,
    removeAssignee,
    fetchCandidates,
  } = useRpStageStore()
  const { sites: allSites, fetchSites: fetchConstructionSites } = useConstructionSiteStore()

  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  useEffect(() => {
    fetchAssignees()
    fetchCandidates()
    fetchConstructionSites()
  }, [fetchAssignees, fetchCandidates, fetchConstructionSites])

  // Активные объекты без назначенного сотрудника (один сотрудник на объект)
  const availableSites = allSites.filter(
    (s) => s.isActive && !assignees.some((a) => a.siteId === s.id),
  )

  const handleAdd = async () => {
    if (!selectedSiteId || !selectedUserId) return
    try {
      await addAssignee(selectedSiteId, selectedUserId)
      setSelectedSiteId(null)
      setSelectedUserId(null)
      message.success('Сотрудник назначен')
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка назначения')
    }
  }

  const handleRemove = async (id: string) => {
    try {
      await removeAssignee(id)
      message.success('Назначение удалено')
    } catch {
      message.error('Ошибка удаления назначения')
    }
  }

  const columns = [
    {
      title: 'Сотрудник',
      dataIndex: 'userFullName',
      key: 'userFullName',
      sorter: (a: RpStageAssignee, b: RpStageAssignee) =>
        a.userFullName.localeCompare(b.userFullName),
    },
    {
      title: 'Отдел',
      dataIndex: 'userDepartment',
      key: 'userDepartment',
      width: 120,
      render: (dept: RpStageAssignee['userDepartment']) => (dept ? DEPARTMENT_LABELS[dept] : '—'),
    },
    {
      title: 'Объект строительства',
      dataIndex: 'siteName',
      key: 'siteName',
      sorter: (a: RpStageAssignee, b: RpStageAssignee) => a.siteName.localeCompare(b.siteName),
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: RpStageAssignee) => (
        <Popconfirm title="Удалить назначение?" onConfirm={() => handleRemove(record.id)}>
          <Button icon={<DeleteOutlined />} danger size="small" />
        </Popconfirm>
      ),
    },
  ]

  return (
    <Card size="small" title="Согласующие этапа РП">
      <Space direction="vertical" style={{ width: '100%' }}>
        <Text type="secondary">
          Заявки по объекту после согласования Штабом и ОМТС дополнительно согласовываются
          назначенным сотрудником (этап РП). На объект назначается один сотрудник; объекты без
          назначенного сотрудника этап РП не проходят.
        </Text>
        <Space wrap>
          <Select
            style={{ width: 320 }}
            placeholder="Выберите сотрудника"
            value={selectedUserId}
            onChange={setSelectedUserId}
            allowClear
            showSearch
            optionFilterProp="label"
            options={candidates.map((u) => ({
              label: u.department
                ? `${u.fullName} (${DEPARTMENT_LABELS[u.department]})`
                : u.fullName,
              value: u.id,
            }))}
          />
          <Select
            style={{ width: 320 }}
            placeholder="Выберите объект"
            value={selectedSiteId}
            onChange={setSelectedSiteId}
            allowClear
            showSearch
            optionFilterProp="label"
            options={availableSites.map((s) => ({
              label: s.name,
              value: s.id,
            }))}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAdd}
            disabled={!selectedSiteId || !selectedUserId}
          >
            Добавить
          </Button>
        </Space>
        <Table
          columns={columns}
          dataSource={assignees}
          rowKey="id"
          loading={isLoading}
          pagination={false}
          size="small"
        />
      </Space>
    </Card>
  )
}

export default RpSettingsTab
