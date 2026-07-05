import { Button, Space } from 'antd'
import { PlusOutlined } from '@ant-design/icons'

interface RpCreateToolbarProps {
  /** Активен режим выбора заявок. */
  selectionMode: boolean
  /** Число выбранных заявок. */
  selectedCount: number
  /** Включить режим выбора. */
  onStart: () => void
  /** Открыть мастер создания РП по выбранным заявкам. */
  onCreate: () => void
  /** Выйти из режима выбора. */
  onCancel: () => void
}

/** Тулбар создания РП на вкладке «Согласовано» (только десктоп). */
const RpCreateToolbar = ({
  selectionMode,
  selectedCount,
  onStart,
  onCreate,
  onCancel,
}: RpCreateToolbarProps) => (
  <Space style={{ flexShrink: 0 }}>
    {!selectionMode ? (
      <Button type="primary" icon={<PlusOutlined />} size="small" onClick={onStart}>
        Создать РП
      </Button>
    ) : (
      <>
        <Button type="primary" size="small" disabled={selectedCount === 0} onClick={onCreate}>
          Создать ({selectedCount})
        </Button>
        <Button size="small" onClick={onCancel}>
          Отмена
        </Button>
      </>
    )}
  </Space>
)

export default RpCreateToolbar
