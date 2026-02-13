import { useEffect, useState } from 'react'
import {
  Card,
  Select,
  Button,
  Space,
  Empty,
  message,
  Spin,
  Popconfirm,
  Typography,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { useApprovalStore, type GroupedStage } from '@/store/approvalStore'
import { useDepartmentStore } from '@/store/departmentStore'

const { Text } = Typography

const ApprovalChainsPage = () => {
  const { stages, isLoading, fetchStages, saveStages } = useApprovalStore()
  const { departments, fetchDepartments } = useDepartmentStore()

  // Локальное состояние редактора
  const [localStages, setLocalStages] = useState<GroupedStage[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchStages()
    fetchDepartments()
  }, [fetchStages, fetchDepartments])

  // Синхронизация при загрузке из БД
  useEffect(() => {
    if (stages.length === 0) {
      setLocalStages([{ stageOrder: 1, departmentIds: [] }])
      return
    }
    // Группируем по stage_order
    const grouped = new Map<number, string[]>()
    for (const s of stages) {
      const arr = grouped.get(s.stageOrder) ?? []
      arr.push(s.departmentId)
      grouped.set(s.stageOrder, arr)
    }
    const result: GroupedStage[] = []
    for (const [order, ids] of grouped) {
      result.push({ stageOrder: order, departmentIds: ids })
    }
    result.sort((a, b) => a.stageOrder - b.stageOrder)
    setLocalStages(result)
  }, [stages])

  const activeDepartments = departments.filter((d) => d.isActive)
  const deptOptions = activeDepartments.map((d) => ({
    label: d.name,
    value: d.id,
  }))

  const handleAddStage = () => {
    const nextOrder = localStages.length > 0
      ? Math.max(...localStages.map((s) => s.stageOrder)) + 1
      : 1
    setLocalStages([...localStages, { stageOrder: nextOrder, departmentIds: [] }])
  }

  const handleRemoveStage = (index: number) => {
    const updated = localStages.filter((_, i) => i !== index)
    // Пересчитываем порядок
    setLocalStages(updated.map((s, i) => ({ ...s, stageOrder: i + 1 })))
  }

  const handleChangeDepartments = (index: number, departmentIds: string[]) => {
    const updated = [...localStages]
    updated[index] = { ...updated[index], departmentIds }
    setLocalStages(updated)
  }

  const handleSave = async () => {
    // Проверяем что все этапы имеют хотя бы одно подразделение
    const empty = localStages.find((s) => s.departmentIds.length === 0)
    if (empty) {
      message.warning('Укажите подразделения для каждого этапа')
      return
    }

    setSaving(true)
    try {
      await saveStages(localStages)
      message.success('Цепочка согласования сохранена')
    } catch {
      message.error('Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    setSaving(true)
    try {
      await saveStages([])
      setLocalStages([{ stageOrder: 1, departmentIds: [] }])
      message.success('Цепочка согласования очищена')
    } catch {
      message.error('Ошибка очистки')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading && localStages.length === 0) {
    return <Spin style={{ display: 'block', marginTop: 40 }} />
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text type="secondary">
          Настройте этапы согласования. Заявки будут проходить этапы последовательно.
          Если на этапе несколько подразделений — согласование параллельное.
        </Text>
        <Space>
          {stages.length > 0 && (
            <Popconfirm title="Очистить цепочку согласования?" onConfirm={handleClear}>
              <Button danger loading={saving}>
                Очистить
              </Button>
            </Popconfirm>
          )}
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={saving}
          >
            Сохранить
          </Button>
        </Space>
      </div>

      {localStages.length === 0 ? (
        <Empty description="Этапы не настроены. Заявки будут создаваться без согласования." />
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          {localStages.map((stage, index) => (
            <Card
              key={index}
              size="small"
              title={`Этап ${stage.stageOrder}`}
              extra={
                localStages.length > 1 && (
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleRemoveStage(index)}
                    size="small"
                  />
                )
              }
            >
              <Select
                mode="multiple"
                placeholder="Выберите подразделения"
                value={stage.departmentIds}
                onChange={(ids) => handleChangeDepartments(index, ids)}
                options={deptOptions}
                style={{ width: '100%' }}
                showSearch
                optionFilterProp="label"
              />
            </Card>
          ))}
        </Space>
      )}

      <Button
        type="dashed"
        icon={<PlusOutlined />}
        onClick={handleAddStage}
        style={{ width: '100%', marginTop: 12 }}
      >
        Добавить этап
      </Button>
    </div>
  )
}

export default ApprovalChainsPage
