import { useEffect, useState } from 'react'
import { Table, Button, Select, Space, Popconfirm, App, Card, Typography } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { useOmtsRpStore } from '@/store/omtsRpStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import type { OmtsRpSite } from '@/types'

const { Text } = Typography

const OmtsRpSettingsTab = () => {
  const { message } = App.useApp()
  const {
    sites, responsibleUserId, omtsUsers, isLoading,
    fetchSites, addSite, removeSite,
    fetchConfig, updateResponsible, fetchOmtsUsers,
  } = useOmtsRpStore()
  const { sites: allSites, fetchSites: fetchConstructionSites } = useConstructionSiteStore()

  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)

  useEffect(() => {
    fetchSites()
    fetchConfig()
    fetchOmtsUsers()
    fetchConstructionSites()
  }, [fetchSites, fetchConfig, fetchOmtsUsers, fetchConstructionSites])

  // Объекты, которые ещё не добавлены в список ОМТС РП
  const availableSites = allSites.filter(
    (s) => s.isActive && !sites.some((rs) => rs.constructionSiteId === s.id)
  )

  const handleAddSite = async () => {
    if (!selectedSiteId) return
    try {
      await addSite(selectedSiteId)
      setSelectedSiteId(null)
      message.success('Объект добавлен')
    } catch {
      message.error('Ошибка добавления объекта')
    }
  }

  const handleRemoveSite = async (id: string) => {
    try {
      await removeSite(id)
      message.success('Объект удалён')
    } catch {
      message.error('Ошибка удаления объекта')
    }
  }

  const handleChangeResponsible = async (userId: string) => {
    try {
      await updateResponsible(userId || null)
      message.success('Ответственное лицо обновлено')
    } catch {
      message.error('Ошибка обновления ответственного')
    }
  }

  const columns = [
    {
      title: 'Объект строительства',
      dataIndex: 'siteName',
      key: 'siteName',
      sorter: (a: OmtsRpSite, b: OmtsRpSite) => (a.siteName ?? '').localeCompare(b.siteName ?? ''),
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: OmtsRpSite) => (
        <Popconfirm title="Удалить объект из списка?" onConfirm={() => handleRemoveSite(record.constructionSiteId)}>
          <Button icon={<DeleteOutlined />} danger size="small" />
        </Popconfirm>
      ),
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card size="small" title="Специальное ответственное лицо ОМТС РП">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text type="secondary">
            Пользователь ОМТС, который дополнительно согласовывает заявки по выбранным объектам
          </Text>
          <Select
            style={{ width: 400 }}
            placeholder="Выберите ответственное лицо"
            value={responsibleUserId ?? undefined}
            onChange={handleChangeResponsible}
            allowClear
            showSearch
            optionFilterProp="label"
            options={omtsUsers.map((u) => ({
              label: u.fullName,
              value: u.id,
              description: u.email,
            }))}
          />
        </Space>
      </Card>

      <Card size="small" title="Объекты с двойным согласованием ОМТС">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text type="secondary">
            Для этих объектов после согласования ответственным ОМТС заявка дополнительно согласовывается специальным лицом
          </Text>
          <Space>
            <Select
              style={{ width: 400 }}
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
              onClick={handleAddSite}
              disabled={!selectedSiteId}
            >
              Добавить
            </Button>
          </Space>
          <Table
            columns={columns}
            dataSource={sites}
            rowKey="constructionSiteId"
            loading={isLoading}
            pagination={false}
            size="small"
          />
        </Space>
      </Card>
    </div>
  )
}

export default OmtsRpSettingsTab
