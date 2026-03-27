import { Typography, Tag } from 'antd'
import {
  CheckCircleOutlined,
  SendOutlined,
  EditOutlined,
  FileProtectOutlined,
} from '@ant-design/icons'
import type { ContractStatusHistoryEntry } from '@/types'
import { REVISION_TARGET_LABELS, type RevisionTarget } from '@/types'

const { Text } = Typography

interface ContractApprovalLogProps {
  statusHistory: ContractStatusHistoryEntry[]
}

/** Конфигурация событий */
const EVENT_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  created: { icon: <SendOutlined />, label: 'Заявка создана', color: '#1677ff' },
  revision: { icon: <EditOutlined />, label: 'Отправлено на доработку', color: '#faad14' },
  revision_complete: { icon: <CheckCircleOutlined />, label: 'Доработка завершена', color: '#52c41a' },
  approved: { icon: <CheckCircleOutlined />, label: 'Согласовано', color: '#52c41a' },
  original_received: { icon: <FileProtectOutlined />, label: 'Оригинал получен', color: '#389e0d' },
}

/** Форматирование даты и времени */
function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const ContractApprovalLog = ({ statusHistory }: ContractApprovalLogProps) => {
  if (!statusHistory || statusHistory.length === 0) {
    return <Text type="secondary">Нет записей</Text>
  }

  // Сортируем от новых к старым
  const sorted = [...statusHistory].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sorted.map((entry, idx) => {
        const config = EVENT_CONFIG[entry.event]
        if (!config) return null
        return (
          <div
            key={idx}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '6px 0',
              borderBottom: idx < sorted.length - 1 ? '1px solid #f0f0f0' : 'none',
            }}
          >
            <span style={{ color: config.color, fontSize: 16, marginTop: 2 }}>{config.icon}</span>
            <div style={{ flex: 1 }}>
              <div>
                <Text strong style={{ fontSize: 13 }}>{config.label}</Text>
                <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                  {formatDateTime(entry.at)}
                </Text>
              </div>
              {entry.userFullName && (
                <Text type="secondary" style={{ fontSize: 12 }}>{entry.userFullName}</Text>
              )}
              {entry.revisionTargets && entry.revisionTargets.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  {entry.revisionTargets.map((t) => (
                    <Tag key={t} color="orange" style={{ fontSize: 11 }}>
                      {REVISION_TARGET_LABELS[t as RevisionTarget] ?? t}
                    </Tag>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default ContractApprovalLog
