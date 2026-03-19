import { useMemo } from 'react'
import { Badge, Popover, Flex, Typography, Progress, Button, Tag, Empty } from 'antd'
import { ScanOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons'
import { useOcrQueueStore } from '@/store/ocrQueueStore'
import type { OcrQueueTask } from '@/store/ocrQueueStore'

const { Text } = Typography

/** Описание этапа */
const STAGE_LABELS: Record<string, string> = {
  downloading: 'Загрузка',
  recognizing: 'Распознавание',
  validating: 'Валидация',
  saving: 'Сохранение',
}

/** Вычисляет процент прогресса задачи */
function getTaskPercent(task: OcrQueueTask): number {
  if (!task.progress) return 0
  const { fileIndex, totalFiles, pageIndex, totalPages } = task.progress
  if (totalFiles <= 0) return 0

  const filePart = fileIndex / totalFiles
  const pagePart = totalPages && pageIndex != null
    ? (pageIndex / totalPages) / totalFiles
    : 0
  return Math.min(Math.round((filePart + pagePart) * 100), 99)
}

/** Текст прогресса задачи */
function getTaskProgressText(task: OcrQueueTask): string {
  if (!task.progress) return ''
  const { stage, fileIndex, totalFiles, pageIndex, totalPages } = task.progress
  const label = STAGE_LABELS[stage] ?? stage
  let text = `${label} | Файл ${fileIndex + 1}/${totalFiles}`
  if (totalPages) {
    text += ` | Стр. ${(pageIndex ?? 0) + 1}/${totalPages}`
  }
  return text
}

const OcrQueueWidget = () => {
  const tasks = useOcrQueueStore((s) => s.tasks)
  const retry = useOcrQueueStore((s) => s.retry)
  const clearCompleted = useOcrQueueStore((s) => s.clearCompleted)

  const { activeTasks, pendingCount, processingTask, errorTasks, badgeCount } = useMemo(() => {
    const all = Object.values(tasks)
    const pending = all.filter((t) => t.status === 'pending')
    const proc = all.find((t) => t.status === 'processing') ?? null
    const errors = all.filter((t) => t.status === 'error')
    const active = all.filter((t) => t.status === 'pending' || t.status === 'processing')
    return {
      activeTasks: active,
      pendingCount: pending.length,
      processingTask: proc,
      errorTasks: errors,
      badgeCount: active.length + errors.length,
    }
  }, [tasks])

  // Не показываем виджет если очередь пуста и нет ошибок
  if (badgeCount === 0) return null

  const popoverContent = (
    <div style={{ width: 340, maxHeight: 400, overflow: 'auto' }}>
      {/* Текущая задача */}
      {processingTask && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>
          <Flex justify="space-between" align="center">
            <Text strong style={{ fontSize: 13 }}>Распознавание</Text>
            <Tag color="processing">Обработка</Tag>
          </Flex>
          <Text style={{ fontSize: 12 }}>
            {processingTask.requestNumber || processingTask.paymentRequestId.slice(0, 8)}
          </Text>
          <Progress
            percent={getTaskPercent(processingTask)}
            size="small"
            status="active"
            style={{ marginBottom: 0 }}
          />
          <Text type="secondary" style={{ fontSize: 11 }}>
            {getTaskProgressText(processingTask)}
          </Text>
        </div>
      )}

      {/* В ожидании */}
      {pendingCount > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            В ожидании: {pendingCount}
          </Text>
        </div>
      )}

      {/* Ошибки */}
      {errorTasks.map((task) => (
        <div
          key={task.paymentRequestId}
          style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', background: '#fff2f0' }}
        >
          <Flex justify="space-between" align="center">
            <Text style={{ fontSize: 12 }}>
              {task.requestNumber || task.paymentRequestId.slice(0, 8)}
            </Text>
            <Flex gap={4}>
              <Button
                type="link"
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => retry(task.paymentRequestId)}
              >
                Повторить
              </Button>
            </Flex>
          </Flex>
          <Text type="danger" style={{ fontSize: 11 }}>{task.errorMessage}</Text>
        </div>
      ))}

      {/* Кнопка очистки */}
      {(errorTasks.length > 0 || Object.values(tasks).some((t) => t.status === 'success')) && (
        <Flex justify="center" style={{ padding: '8px 12px' }}>
          <Button
            type="link"
            size="small"
            icon={<DeleteOutlined />}
            onClick={clearCompleted}
          >
            Очистить
          </Button>
        </Flex>
      )}

      {/* Пустое состояние */}
      {activeTasks.length === 0 && errorTasks.length === 0 && (
        <Empty description="Очередь пуста" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 16 }} />
      )}
    </div>
  )

  return (
    <Popover
      content={popoverContent}
      trigger="click"
      placement="bottomRight"
    >
      <Badge count={badgeCount} size="small">
        <ScanOutlined style={{ fontSize: 20, cursor: 'pointer' }} />
      </Badge>
    </Popover>
  )
}

export default OcrQueueWidget
