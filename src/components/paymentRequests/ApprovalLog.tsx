import { useMemo } from 'react'
import { Typography, Space, Tag, Tooltip, Button } from 'antd'
import {
  DownloadOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  SendOutlined,
  EditOutlined,
  FileAddOutlined,
} from '@ant-design/icons'
import { formatDate } from '@/utils/requestFormatters'
import type { PaymentRequest, ApprovalDecision, ApprovalDecisionFile, PaymentRequestLog, StageHistoryEntry } from '@/types'
import { DEPARTMENT_LABELS } from '@/types'

const { Text } = Typography

/** Маппинг имён полей для логов */
const FIELD_LABELS: Record<string, string> = {
  delivery_days: 'Срок поставки',
  delivery_days_type: 'Тип дней',
  shipping_condition_id: 'Условия отгрузки',
  site_id: 'Объект',
  comment: 'Комментарий',
}

interface ApprovalLogProps {
  request: PaymentRequest
  decisions: ApprovalDecision[]
  logs: PaymentRequestLog[]
  isCounterpartyUser: boolean
  downloading: string | null
  onViewFile: (fileKey: string, fileName: string, mimeType: string | null) => void
  onDownloadFile: (fileKey: string, fileName: string) => void
}

/** Кнопки просмотра/скачивания файла решения */
const DecisionFileActions = ({ files, downloading, onViewFile, onDownloadFile }: {
  files: ApprovalDecisionFile[]
  downloading: string | null
  onViewFile: (fileKey: string, fileName: string, mimeType: string | null) => void
  onDownloadFile: (fileKey: string, fileName: string) => void
}) => (
  <div style={{ marginLeft: 22, marginTop: 8 }}>
    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
      Прикрепленные файлы:
    </Text>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {files.map((file) => (
        <div key={file.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, fontSize: 12 }}>{file.fileName}</Text>
          <Space size="small">
            <Tooltip title="Просмотр">
              <Button
                size="small"
                icon={<EyeOutlined />}
                onClick={() => onViewFile(file.fileKey, file.fileName, file.mimeType)}
              />
            </Tooltip>
            <Tooltip title="Скачать">
              <Button
                size="small"
                icon={<DownloadOutlined />}
                loading={downloading === file.fileKey}
                onClick={() => onDownloadFile(file.fileKey, file.fileName)}
              />
            </Tooltip>
          </Space>
        </div>
      ))}
    </div>
  </div>
)

/** Маппинг событий хронологии */
const EVENT_CONFIG: Record<string, { icon: React.ReactNode; label: string }> = {
  received: { icon: <SendOutlined style={{ color: '#1677ff' }} />, label: 'Заявка получена' },
  approved: { icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />, label: 'Согласовано' },
  rejected: { icon: <CloseCircleOutlined style={{ color: '#f5222d' }} />, label: 'Отклонено' },
  revision: { icon: <EditOutlined style={{ color: '#faad14' }} />, label: 'На доработку' },
  revision_complete: { icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />, label: 'Доработано' },
}

/** Возвращает первые 2 слова из ФИО (fallback на email) */
function getShortName(fullName?: string, email?: string): string | undefined {
  if (fullName) {
    const words = fullName.trim().split(/\s+/)
    return words.slice(0, 2).join(' ')
  }
  return email
}

/** Формирует текст этапа */
function stageLabel(entry: StageHistoryEntry): string {
  const dept = entry.isOmtsRp ? 'ОМТС РП' : (DEPARTMENT_LABELS[entry.department as keyof typeof DEPARTMENT_LABELS] ?? entry.department)
  return `Этап ${entry.stage}. ${dept}`
}

/** Лог для контрагента */
const CounterpartyLog = ({ request, decisions, logs, downloading, onViewFile, onDownloadFile }: Omit<ApprovalLogProps, 'isCounterpartyUser'>) => {
  const logItems = useMemo(() => {
    type LogItem = { icon: React.ReactNode; text: string; date?: string; files?: ApprovalDecisionFile[] }
    const items: LogItem[] = []

    // Хронология из stageHistory
    for (const entry of request.stageHistory ?? []) {
      const config = EVENT_CONFIG[entry.event]
      if (!config) continue
      // Для событий ОМТС (stage=2) показываем автора
      const isOmtsStage = entry.stage === 2
      const authorName = isOmtsStage ? getShortName(entry.userFullName, entry.userEmail) : undefined
      let text = `${stageLabel(entry)} — ${config.label}`
      if (authorName) text += ` (${authorName})`
      if (entry.comment) text += `. Комментарий: ${entry.comment}`
      const item: LogItem = { icon: config.icon, text, date: entry.at }

      // Для отклонений добавляем файлы из decisions
      if (entry.event === 'rejected') {
        const rejDecision = decisions.find(d =>
          d.status === 'rejected' && d.stageOrder === entry.stage &&
          d.decidedAt && Math.abs(new Date(d.decidedAt).getTime() - new Date(entry.at).getTime()) < 5000
        )
        if (rejDecision?.files && rejDecision.files.length > 0) {
          item.files = rejDecision.files
        }
      }

      items.push(item)
    }

    // Дополнительные логи (edit, file_upload, resubmit)
    for (const l of logs) {
      if (l.action === 'edit') {
        const changes = (l.details?.changes as { field: string; newValue: unknown }[]) ?? []
        const changedFields = changes.map((c) => FIELD_LABELS[c.field] ?? c.field).join(', ')
        items.push({ icon: <EditOutlined style={{ color: '#722ed1' }} />, text: `Изменено: ${changedFields}`, date: l.createdAt })
      } else if (l.action === 'file_upload') {
        const count = (l.details?.count as number) ?? 0
        items.push({ icon: <FileAddOutlined style={{ color: '#1677ff' }} />, text: `Догружено файлов: ${count}`, date: l.createdAt })
      } else if (l.action === 'resubmit') {
        const comment = (l.details?.comment as string) ?? ''
        const text = comment ? `Повторно отправлено. Комментарий: ${comment}` : 'Повторно отправлено'
        items.push({ icon: <SendOutlined style={{ color: '#1677ff' }} />, text, date: l.createdAt })
      }
    }

    items.sort((a, b) => {
      if (!a.date) return 1
      if (!b.date) return -1
      return new Date(a.date).getTime() - new Date(b.date).getTime()
    })

    return items
  }, [request, decisions, logs])

  if (logItems.length === 0) return null

  return (
    <>
      <Text strong style={{ marginBottom: 8, display: 'block' }}>Согласование</Text>
      <div style={{ marginBottom: 16 }}>
        {logItems.map((item, idx) => (
          <div key={idx} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
            <Space>
              {item.icon}
              <Text>{item.text}</Text>
              {item.date && <Text type="secondary">{formatDate(item.date, false)}</Text>}
            </Space>
            {item.files && item.files.length > 0 && (
              <DecisionFileActions
                files={item.files}
                downloading={downloading}
                onViewFile={onViewFile}
                onDownloadFile={onDownloadFile}
              />
            )}
          </div>
        ))}
      </div>
    </>
  )
}

/** Лог для admin/user */
const AdminLog = ({ request, decisions, logs, downloading, onViewFile, onDownloadFile }: Omit<ApprovalLogProps, 'isCounterpartyUser'>) => {
  type LogItem = {
    icon: React.ReactNode
    text: string
    date: string
    userEmail?: string
    userFullName?: string
    comment?: string
    files?: ApprovalDecisionFile[]
    isPending?: boolean
    tag?: string
    tagColor?: string
  }

  const items = useMemo(() => {
    const result: LogItem[] = []

    // Хронология из stageHistory
    for (const entry of request.stageHistory ?? []) {
      const config = EVENT_CONFIG[entry.event]
      if (!config) continue
      const dept = entry.isOmtsRp ? 'ОМТС РП' : (DEPARTMENT_LABELS[entry.department as keyof typeof DEPARTMENT_LABELS] ?? entry.department)
      const item: LogItem = {
        icon: config.icon,
        text: `${config.label}`,
        date: entry.at,
        userEmail: entry.userEmail,
        userFullName: entry.userFullName,
        comment: entry.comment,
        tag: `Этап ${entry.stage}. ${dept}`,
        tagColor: entry.isOmtsRp ? 'purple' : undefined,
      }

      // Для отклонений добавляем файлы из decisions
      if (entry.event === 'rejected') {
        const rejDecision = decisions.find(d =>
          d.status === 'rejected' && d.stageOrder === entry.stage &&
          d.decidedAt && Math.abs(new Date(d.decidedAt).getTime() - new Date(entry.at).getTime()) < 5000
        )
        if (rejDecision?.files && rejDecision.files.length > 0) {
          item.files = rejDecision.files
        }
      }

      result.push(item)
    }

    // Pending decisions (ожидают решения) — если нет записи в stageHistory
    for (const d of decisions.filter(dd => dd.status === 'pending')) {
      const dept = d.isOmtsRp ? 'ОМТС РП' : (DEPARTMENT_LABELS[d.department] ?? d.department)
      result.push({
        icon: <ClockCircleOutlined style={{ color: '#faad14' }} />,
        text: 'Ожидает',
        date: d.createdAt,
        tag: `Этап ${d.stageOrder}. ${dept}`,
        tagColor: d.isOmtsRp ? 'purple' : undefined,
        isPending: true,
      })
    }

    // Дополнительные логи (edit, file_upload, resubmit)
    for (const l of logs) {
      if (l.action === 'edit') {
        const changes = (l.details?.changes as { field: string; newValue: unknown }[]) ?? []
        const changedFields = changes.map((c) => FIELD_LABELS[c.field] ?? c.field).join(', ')
        result.push({ icon: <EditOutlined style={{ color: '#722ed1' }} />, text: `Изменено: ${changedFields}`, date: l.createdAt, userEmail: l.userEmail, userFullName: l.userFullName })
      } else if (l.action === 'file_upload') {
        const count = (l.details?.count as number) ?? 0
        result.push({ icon: <FileAddOutlined style={{ color: '#1677ff' }} />, text: `Догружено файлов: ${count}`, date: l.createdAt, userEmail: l.userEmail, userFullName: l.userFullName })
      } else if (l.action === 'resubmit') {
        const comment = (l.details?.comment as string) ?? ''
        const text = comment ? `Повторно отправлено. Комментарий: ${comment}` : 'Повторно отправлено'
        result.push({ icon: <SendOutlined style={{ color: '#1677ff' }} />, text, date: l.createdAt, userEmail: l.userEmail, userFullName: l.userFullName })
      }
    }

    // Сортировка: pending в конец, остальные хронологически
    result.sort((a, b) => {
      if (a.isPending && !b.isPending) return 1
      if (!a.isPending && b.isPending) return -1
      return new Date(a.date).getTime() - new Date(b.date).getTime()
    })

    return result
  }, [request, decisions, logs])

  if (items.length === 0) return null

  return (
    <>
      <Text strong style={{ marginBottom: 8, display: 'block' }}>Согласование</Text>
      <div style={{ marginBottom: 16 }}>
        {items.map((item, idx) => (
          <div key={idx} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ width: '100%' }}>
              <Space wrap>
                {item.icon}
                {item.tag && <Tag color={item.tagColor}>{item.tag}</Tag>}
                <Text>{item.text}</Text>
                {(item.userFullName || item.userEmail) && <Text type="secondary">({getShortName(item.userFullName, item.userEmail)})</Text>}
                <Text type="secondary">{formatDate(item.date)}</Text>
              </Space>
              {item.comment && (
                <Text type="secondary" style={{ display: 'block', marginLeft: 22 }}>Комментарий: {item.comment}</Text>
              )}
              {item.files && item.files.length > 0 && (
                <DecisionFileActions
                  files={item.files}
                  downloading={downloading}
                  onViewFile={onViewFile}
                  onDownloadFile={onDownloadFile}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

const ApprovalLog = (props: ApprovalLogProps) => {
  if (props.isCounterpartyUser) {
    return (
      <CounterpartyLog
        request={props.request}
        decisions={props.decisions}
        logs={props.logs}
        downloading={props.downloading}
        onViewFile={props.onViewFile}
        onDownloadFile={props.onDownloadFile}
      />
    )
  }

  return (
    <AdminLog
      request={props.request}
      decisions={props.decisions}
      logs={props.logs}
      downloading={props.downloading}
      onViewFile={props.onViewFile}
      onDownloadFile={props.onDownloadFile}
    />
  )
}

export default ApprovalLog
