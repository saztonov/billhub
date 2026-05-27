import { useEffect, useState } from 'react'
import { Modal, Form, Input, Button, Space, Tag, Timeline, App, Empty, Typography, Spin } from 'antd'
import { useAuthStore } from '@/store/authStore'
import {
  fetchSecurityChecks,
  submitSecurityDecision,
} from '@/services/counterpartySecurityCheckService'
import { logError } from '@/services/errorLogger'
import type { Counterparty, CounterpartySecurityCheck, SecurityCheckEventType } from '@/types'

const { Text } = Typography
const { TextArea } = Input

interface CounterpartySbModalProps {
  open: boolean
  counterparty: Counterparty | null
  onClose: () => void
  /** Вызывается после успешного создания решения СБ — для перезагрузки списка */
  onDecisionSubmitted?: () => void
}

/** Цвет и текст бейджа события */
function eventBadge(type: SecurityCheckEventType): { color: string; label: string } {
  switch (type) {
    case 'requested':
      return { color: 'blue', label: 'Отправлен на проверку' }
    case 'approved':
      return { color: 'green', label: 'Согласован' }
    case 'rejected':
      return { color: 'red', label: 'Отклонён' }
  }
}

/** Формат даты/времени для записей истории */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU')
}

const CounterpartySbModal = ({ open, counterparty, onClose, onDecisionSubmitted }: CounterpartySbModalProps) => {
  const { message } = App.useApp()
  const role = useAuthStore((s) => s.user?.role)
  const isSecurity = role === 'security'

  const [history, setHistory] = useState<CounterpartySecurityCheck[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState<'approved' | 'rejected' | null>(null)
  const [commentError, setCommentError] = useState<string | null>(null)

  // Загрузка истории при открытии
  useEffect(() => {
    if (!open || !counterparty) return
    let cancelled = false
    setIsLoading(true)
    fetchSecurityChecks(counterparty.id)
      .then((data) => {
        if (!cancelled) setHistory(data)
      })
      .catch((err) => {
        logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : String(err), component: 'CounterpartySbModal' })
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, counterparty])

  // Сброс полей при закрытии
  useEffect(() => {
    if (!open) {
      setComment('')
      setCommentError(null)
      setSubmitting(null)
    }
  }, [open])

  const handleDecision = async (decision: 'approved' | 'rejected') => {
    if (!counterparty) return
    const trimmed = comment.trim()
    if (decision === 'rejected' && trimmed.length < 3) {
      setCommentError('Комментарий обязателен (минимум 3 символа)')
      return
    }
    setCommentError(null)
    setSubmitting(decision)
    try {
      await submitSecurityDecision(counterparty.id, decision, trimmed)
      message.success(decision === 'approved' ? 'Поставщик согласован' : 'Поставщик отклонён')
      onDecisionSubmitted?.()
      onClose()
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Ошибка сохранения решения'
      message.error(text)
      logError({ errorType: 'api_error', errorMessage: text, component: 'CounterpartySbModal' })
    } finally {
      setSubmitting(null)
    }
  }

  const footer = isSecurity
    ? (
        <Space>
          <Button onClick={onClose} disabled={submitting !== null}>Отмена</Button>
          <Button
            danger
            onClick={() => handleDecision('rejected')}
            loading={submitting === 'rejected'}
            disabled={submitting === 'approved'}
          >
            Отклонить
          </Button>
          <Button
            type="primary"
            onClick={() => handleDecision('approved')}
            loading={submitting === 'approved'}
            disabled={submitting === 'rejected'}
          >
            Согласовать
          </Button>
        </Space>
      )
    : (
        <Button onClick={onClose}>Закрыть</Button>
      )

  return (
    <Modal
      title="Проверка поставщика отделом СБ"
      open={open}
      onCancel={onClose}
      footer={footer}
      width={640}
      destroyOnClose
    >
      {counterparty && (
        <>
          {/* Шапка */}
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ fontSize: 16 }}>{counterparty.name}</Text>
            <div>
              <Text type="secondary">ИНН: {counterparty.inn || '—'}</Text>
            </div>
            {counterparty.alternativeNames && counterparty.alternativeNames.length > 0 && (
              <div>
                <Text type="secondary">Альтернативные наименования: {counterparty.alternativeNames.join('; ')}</Text>
              </div>
            )}
          </div>

          {/* Поле комментария (только для security) */}
          {isSecurity && (
            <Form layout="vertical" style={{ marginBottom: 16 }}>
              <Form.Item
                label="Комментарий"
                help={commentError ?? 'Обязателен при отклонении (минимум 3 символа)'}
                validateStatus={commentError ? 'error' : undefined}
              >
                <TextArea
                  rows={3}
                  value={comment}
                  onChange={(e) => {
                    setComment(e.target.value)
                    if (commentError) setCommentError(null)
                  }}
                  placeholder="Комментарий к решению"
                  maxLength={2000}
                  showCount
                />
              </Form.Item>
            </Form>
          )}

          {/* История проверок */}
          <div>
            <Text strong>История проверок</Text>
            <div style={{ marginTop: 8 }}>
              {isLoading ? (
                <Spin />
              ) : history.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Проверок ещё не было" />
              ) : (
                <Timeline
                  items={history.map((item) => {
                    const badge = eventBadge(item.eventType)
                    return {
                      color: badge.color,
                      children: (
                        <div>
                          <Space size={8} wrap>
                            <Tag color={badge.color}>{badge.label}</Tag>
                            <Text>{item.authorFullName || 'Неизвестный автор'}</Text>
                            <Text type="secondary">{formatDateTime(item.createdAt)}</Text>
                          </Space>
                          {item.comment && (
                            <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{item.comment}</div>
                          )}
                        </div>
                      ),
                    }
                  })}
                />
              )}
            </div>
          </div>
        </>
      )}
    </Modal>
  )
}

export default CounterpartySbModal
