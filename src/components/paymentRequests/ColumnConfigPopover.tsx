import { useState } from 'react'
import { Popover, Button, Checkbox, Space, Divider } from 'antd'
import { SettingOutlined, UpOutlined, DownOutlined } from '@ant-design/icons'
import type { ColumnConfig } from '@/hooks/useColumnConfig'

export interface ColumnRegistryItem {
  key: string
  title: string
}

interface Props {
  /** Столбцы, доступные в текущем контексте (без "Действия") */
  availableColumns: ColumnRegistryItem[]
  config: ColumnConfig
  onChange: (config: ColumnConfig) => void
  onReset: () => void
}

/** Возвращает упорядоченный список столбцов с учётом columnOrder */
function getOrderedColumns(available: ColumnRegistryItem[], columnOrder: string[]): ColumnRegistryItem[] {
  if (columnOrder.length === 0) return available

  const sorted = [...available]
  sorted.sort((a, b) => {
    const idxA = columnOrder.indexOf(a.key)
    const idxB = columnOrder.indexOf(b.key)
    if (idxA === -1 && idxB === -1) return 0
    if (idxA === -1) return 1
    if (idxB === -1) return -1
    return idxA - idxB
  })
  return sorted
}

export default function ColumnConfigPopover({ availableColumns, config, onChange, onReset }: Props) {
  const [open, setOpen] = useState(false)

  const ordered = getOrderedColumns(availableColumns, config.columnOrder)

  const toggleColumn = (key: string) => {
    const hidden = config.hiddenColumns.includes(key)
      ? config.hiddenColumns.filter((k) => k !== key)
      : [...config.hiddenColumns, key]
    onChange({ ...config, hiddenColumns: hidden })
  }

  const moveColumn = (key: string, direction: 'up' | 'down') => {
    const keys = ordered.map((c) => c.key)
    const idx = keys.indexOf(key)
    if (idx === -1) return
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= keys.length) return

    // Меняем местами
    const newOrder = [...keys]
    newOrder[idx] = keys[targetIdx]
    newOrder[targetIdx] = key

    onChange({ ...config, columnOrder: newOrder })
  }

  const content = (
    <div style={{ width: 260 }}>
      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
        {ordered.map((col, idx) => (
          <div
            key={col.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 0',
            }}
          >
            <Space size={2}>
              <Button
                type="text"
                size="small"
                icon={<UpOutlined />}
                disabled={idx === 0}
                onClick={() => moveColumn(col.key, 'up')}
                style={{ width: 24, height: 24, padding: 0 }}
              />
              <Button
                type="text"
                size="small"
                icon={<DownOutlined />}
                disabled={idx === ordered.length - 1}
                onClick={() => moveColumn(col.key, 'down')}
                style={{ width: 24, height: 24, padding: 0 }}
              />
            </Space>
            <Checkbox
              checked={!config.hiddenColumns.includes(col.key)}
              onChange={() => toggleColumn(col.key)}
              style={{ flex: 1 }}
            >
              <span style={{ fontSize: 13 }}>{col.title}</span>
            </Checkbox>
          </div>
        ))}
      </div>
      <Divider style={{ margin: '8px 0' }} />
      <Button type="link" size="small" onClick={onReset} style={{ padding: 0 }}>
        Сбросить
      </Button>
    </div>
  )

  return (
    <Popover
      content={content}
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
      title="Настройка столбцов"
    >
      <Button
        icon={<SettingOutlined />}
        size="small"
        style={{ flexShrink: 0 }}
      />
    </Popover>
  )
}
