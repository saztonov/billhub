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
import type { PaymentRequest, ApprovalDecision, ApprovalDecisionFile, PaymentRequestLog } from '@/types'
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

/** Лог для контрагента */
const CounterpartyLog = ({ request, decisions, logs, downloading, onViewFile, onDownloadFile }: Omit<ApprovalLogProps, 'isCounterpartyUser'>) => {
  const logItems = useMemo(() => {
    const items: { icon: React.ReactNode; text: string; date?: string; files?: ApprovalDecisionFile[] }[] = []

    items.push({
      icon: <SendOutlined style={{ color: '#1677ff' }} />,
      text: 'Отправлено на согласование',
      date: request.createdAt,
    })

    for (const d of decisions.filter((d) => d.status === 'rejected')) {
      const deptLabel = DEPARTMENT_LABELS[d.department] ?? ''
      const prefix = deptLabel ? `Отклонено (${deptLabel})` : 'Отклонено'
      const reason = d.comment ? `${prefix}. Причина: ${d.comment}` : prefix
      items.push({
        icon: <CloseCircleOutlined style={{ color: '#f5222d' }} />,
        text: reason,
        date: d.decidedAt ?? undefined,
        files: d.files && d.files.length > 0 ? d.files : undefined,
      })
    }

    if (request.approvedAt) {
      items.push({
        icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
        text: 'Согласовано',
        date: request.approvedAt,
      })
    }

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
const AdminLog = ({ decisions, logs, downloading, onViewFile, onDownloadFile }: Omit<ApprovalLogProps, 'isCounterpartyUser' | 'request'>) => {
  type LogEvent = {
    type: 'decision' | 'log'
    date: string
    decision?: ApprovalDecision
    log?: PaymentRequestLog
  }

  const events = useMemo(() => {
    const items: LogEvent[] = []

    for (const d of decisions) {
      items.push({ type: 'decision', date: d.decidedAt || d.createdAt, decision: d })
    }
    for (const l of logs) {
      items.push({ type: 'log', date: l.createdAt, log: l })
    }

    items.sort((a, b) => {
      const aPending = a.decision?.status === 'pending'
      const bPending = b.decision?.status === 'pending'
      if (aPending && !bPending) return 1
      if (!aPending && bPending) return -1
      return new Date(a.date).getTime() - new Date(b.date).getTime()
    })

    return items
  }, [decisions, logs])

  if (events.length === 0) return null

  return (
    <>
      <Text strong style={{ marginBottom: 8, display: 'block' }}>Согласование</Text>
      <div style={{ marginBottom: 16 }}>
        {events.map((event, idx) => {
          if (event.type === 'decision' && event.decision) {
            const decision = event.decision
            const icon = decision.status === 'approved'
              ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
              : decision.status === 'rejected'
                ? <CloseCircleOutlined style={{ color: '#f5222d' }} />
                : <ClockCircleOutlined style={{ color: '#faad14' }} />
            const statusText = decision.status === 'approved'
              ? 'Согласовано'
              : decision.status === 'rejected' ? 'Отклонено' : 'Ожидает'
            return (
              <div key={idx} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ width: '100%' }}>
                  <Space>
                    {icon}
                    <Text>Этап {decision.stageOrder}</Text>
                    <Tag>{DEPARTMENT_LABELS[decision.department]}</Tag>
                    <Text type="secondary">{statusText}</Text>
                    {decision.userEmail && <Text type="secondary">({decision.userEmail})</Text>}
                    {decision.decidedAt && <Text type="secondary">{formatDate(decision.decidedAt)}</Text>}
                  </Space>
                  {decision.comment && (
                    <Text type="secondary" style={{ display: 'block', marginLeft: 22 }}>{decision.comment}</Text>
                  )}
                  {decision.files && decision.files.length > 0 && (
                    <DecisionFileActions
                      files={decision.files}
                      downloading={downloading}
                      onViewFile={onViewFile}
                      onDownloadFile={onDownloadFile}
                    />
                  )}
                </div>
              </div>
            )
          }

          if (event.type === 'log' && event.log) {
            const log = event.log

            if (log.action === 'edit') {
              const changes = (log.details?.changes as { field: string; newValue: unknown }[]) ?? []
              const changedFields = changes.map((c) => FIELD_LABELS[c.field] ?? c.field).join(', ')
              return (
                <div key={idx} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <Space>
                    <EditOutlined style={{ color: '#722ed1' }} />
                    <Text>Изменено: {changedFields}</Text>
                    {log.userEmail && <Text type="secondary">({log.userEmail})</Text>}
                    <Text type="secondary">{formatDate(log.createdAt)}</Text>
                  </Space>
                </div>
              )
            }

            if (log.action === 'file_upload') {
              const count = (log.details?.count as number) ?? 0
              return (
                <div key={idx} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <Space>
                    <FileAddOutlined style={{ color: '#1677ff' }} />
                    <Text>Догружено файлов: {count}</Text>
                    {log.userEmail && <Text type="secondary">({log.userEmail})</Text>}
                    <Text type="secondary">{formatDate(log.createdAt)}</Text>
                  </Space>
                </div>
              )
            }

            if (log.action === 'resubmit') {
              const comment = (log.details?.comment as string) ?? ''
              const text = comment ? `Повторно отправлено. Комментарий: ${comment}` : 'Повторно отправлено'
              return (
                <div key={idx} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <Space>
                    <SendOutlined style={{ color: '#1677ff' }} />
                    <Text>{text}</Text>
                    {log.userEmail && <Text type="secondary">({log.userEmail})</Text>}
                    <Text type="secondary">{formatDate(log.createdAt)}</Text>
                  </Space>
                </div>
              )
            }
          }

          return null
        })}
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
      decisions={props.decisions}
      logs={props.logs}
      downloading={props.downloading}
      onViewFile={props.onViewFile}
      onDownloadFile={props.onDownloadFile}
    />
  )
}

export default ApprovalLog
