import { useEffect, useState } from 'react'
import { Button, Card, InputNumber, Space, App, Typography } from 'antd'
import { useUokThresholdStore } from '@/store/uokThresholdStore'

const { Text } = Typography

/** Формат суммы с разделителями разрядов (пробел) */
const formatAmount = (value: number | string | undefined) =>
  value === undefined || value === '' ? '' : String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

/**
 * Настройки этапа согласования «УОК»: порог суммы счёта. Заявки с суммой строго свыше порога
 * после согласования ОМТС проходят этап УОК (сотрудники подразделения «УОК-офис»).
 */
const UokSettingsTab = () => {
  const { message } = App.useApp()
  const { amount, isLoading, fetchThreshold, saveThreshold } = useUokThresholdStore()
  const [value, setValue] = useState<number | null>(amount)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    fetchThreshold(true)
  }, [fetchThreshold])

  useEffect(() => {
    setValue(amount)
  }, [amount])

  const handleSave = async () => {
    if (value === null) return
    setIsSaving(true)
    try {
      await saveThreshold(value)
      message.success('Порог этапа УОК сохранён')
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Не удалось сохранить порог')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card size="small" title="Порог этапа УОК">
      <Space direction="vertical" style={{ width: '100%' }}>
        <Text type="secondary">
          Заявки с суммой счёта свыше порога после согласования ОМТС дополнительно согласовываются
          подразделением «УОК-офис» (этап УОК). Заявки на сумму не выше порога этап УОК не проходят.
          Порог применяется в момент согласования ОМТС.
        </Text>
        <Space wrap>
          <InputNumber
            style={{ width: 240 }}
            min={0}
            step={10_000}
            precision={0}
            value={value}
            onChange={(v) => setValue(v)}
            formatter={formatAmount}
            parser={(v) => Number((v ?? '').replace(/\s/g, '').replace(',', '.'))}
            suffix="₽"
            disabled={isLoading && amount === null}
          />
          <Button
            type="primary"
            onClick={handleSave}
            loading={isSaving}
            disabled={value === null || value === amount}
          >
            Сохранить
          </Button>
        </Space>
      </Space>
    </Card>
  )
}

export default UokSettingsTab
