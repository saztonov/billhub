import { useState, useEffect, useMemo } from 'react'
import { Typography, Input, Button, Space, Popconfirm, App, Select, Tag } from 'antd'
import { SendOutlined, EditOutlined, DeleteOutlined, CloseOutlined, CheckOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useContractCommentStore } from '@/store/contractCommentStore'
import { useAuthStore } from '@/store/authStore'
import useIsMobile from '@/hooks/useIsMobile'
import type { ContractRequestComment, Department } from '@/types'
import { DEPARTMENT_LABELS } from '@/types'

/** Метки адресатов для отображения */
const RECIPIENT_LABELS: Record<string, string> = {
  omts: 'ОМТС',
  shtab: 'Штаб',
  counterparty: 'Подрядчик',
}

const { Text } = Typography
const { TextArea } = Input

interface ContractCommentsChatProps {
  contractRequestId: string
}

const ContractCommentsChat = ({ contractRequestId }: ContractCommentsChatProps) => {
  const { message } = App.useApp()
  const { comments, isLoading, isSubmitting, fetchComments, addComment, updateComment, deleteComment } = useContractCommentStore()
  const user = useAuthStore((s) => s.user)
  const isMobile = useIsMobile()
  const isAdmin = user?.role === 'admin'

  const [newText, setNewText] = useState('')
  const [recipient, setRecipient] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  // Варианты адресатов зависят от роли пользователя
  const recipientOptions = useMemo(() => {
    const options = [{ value: '', label: 'Всем' }]
    if (user?.role === 'counterparty_user') {
      options.push({ value: 'omts', label: 'ОМТС' })
      options.push({ value: 'shtab', label: 'Штаб' })
    } else if (user?.department === 'shtab') {
      options.push({ value: 'omts', label: 'ОМТС' })
      options.push({ value: 'counterparty', label: 'Подрядчик' })
    } else if (user?.department === 'omts') {
      options.push({ value: 'shtab', label: 'Штаб' })
      options.push({ value: 'counterparty', label: 'Подрядчик' })
    } else if (user?.role === 'admin' || user?.role === 'user') {
      // Админ или пользователь без привязки к отделу — все варианты
      options.push({ value: 'omts', label: 'ОМТС' })
      options.push({ value: 'shtab', label: 'Штаб' })
      options.push({ value: 'counterparty', label: 'Подрядчик' })
    }
    return options
  }, [user?.role, user?.department])

  useEffect(() => {
    fetchComments(contractRequestId)
  }, [contractRequestId, fetchComments])

  /** Отправка нового комментария */
  const handleSend = async () => {
    if (!newText.trim() || !user) return
    try {
      await addComment(contractRequestId, newText.trim(), user.id, recipient)
      setNewText('')
      setRecipient(null)
    } catch {
      message.error('Не удалось отправить комментарий')
    }
  }

  /** Отправка по Enter (без Shift) */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  /** Сохранение отредактированного комментария */
  const handleEditSave = async () => {
    if (!editingId || !editText.trim()) return
    try {
      await updateComment(editingId, editText.trim())
      setEditingId(null)
      setEditText('')
    } catch {
      message.error('Не удалось обновить комментарий')
    }
  }

  /** Удаление комментария */
  const handleDelete = async (commentId: string) => {
    try {
      await deleteComment(commentId)
      message.success('Комментарий удалён')
    } catch {
      message.error('Не удалось удалить комментарий')
    }
  }

  /** Переход в режим редактирования */
  const startEditing = (comment: ContractRequestComment) => {
    setEditingId(comment.id)
    setEditText(comment.text)
  }

  /** Формирование отображаемого имени автора */
  const getAuthorDisplayName = (comment: ContractRequestComment): string => {
    if (comment.authorRole === 'counterparty_user') {
      const name = comment.authorCounterpartyName
      const email = comment.authorEmail
      if (name && email) return `${name} ${email}`
      return name ?? email ?? '—'
    }
    const parts: string[] = []
    if (comment.authorDepartment) {
      const label = DEPARTMENT_LABELS[comment.authorDepartment as Department]
      if (label) parts.push(label)
    }
    if (comment.authorFullName) {
      parts.push(comment.authorFullName)
    }
    return parts.join(', ') || comment.authorEmail || '—'
  }

  // Редактировать/удалять можно только самый последний комментарий в чате, и только если он принадлежит текущему пользователю
  const canEditComment = (comment: ContractRequestComment) => {
    if (isAdmin) return true
    return comments[0]?.id === comment.id && comment.authorId === user?.id
  }

  const canDeleteComment = (comment: ContractRequestComment) => {
    if (isAdmin) return true
    return comments[0]?.id === comment.id && comment.authorId === user?.id
  }

  return (
    <div>
      <div
        style={{
          maxHeight: 300,
          overflowY: 'auto',
          border: '1px solid #f0f0f0',
          borderRadius: 6,
          padding: comments.length > 0 ? 12 : 0,
          marginBottom: 8,
          background: '#fafafa',
        }}
      >
        {isLoading && comments.length === 0 && (
          <div style={{ padding: 12, textAlign: 'center' }}>
            <Text type="secondary">Загрузка...</Text>
          </div>
        )}
        {!isLoading && comments.length === 0 && (
          <div style={{ padding: 12, textAlign: 'center' }}>
            <Text type="secondary">Нет комментариев</Text>
          </div>
        )}
        {comments.map((comment) => (
          <div key={comment.id} style={{ marginBottom: 12, padding: '8px 12px', background: '#fff', borderRadius: 6, border: '1px solid #f0f0f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
              <div>
                <Text strong style={{ fontSize: 13 }}>{getAuthorDisplayName(comment)}</Text>
                {comment.recipient && (
                  <Tag color="blue" style={{ marginLeft: 6, fontSize: 11 }}>
                    {RECIPIENT_LABELS[comment.recipient] ?? comment.recipient}
                  </Tag>
                )}
                <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                  {dayjs(comment.createdAt).format('DD.MM.YYYY HH:mm')}
                  {comment.updatedAt && ' (ред.)'}
                </Text>
              </div>
              {(canEditComment(comment) || canDeleteComment(comment)) && editingId !== comment.id && (
                <Space size={4}>
                  {canEditComment(comment) && (
                    <Button icon={<EditOutlined />} size="small" type="text" onClick={() => startEditing(comment)} />
                  )}
                  {canDeleteComment(comment) && (
                    <Popconfirm title="Удалить комментарий?" onConfirm={() => handleDelete(comment.id)} okText="Да" cancelText="Нет">
                      <Button icon={<DeleteOutlined />} size="small" type="text" danger />
                    </Popconfirm>
                  )}
                </Space>
              )}
            </div>
            {editingId === comment.id ? (
              <div>
                <TextArea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  style={{ marginBottom: 8 }}
                />
                <Space size={4}>
                  <Button size="small" icon={<CheckOutlined />} type="primary" loading={isSubmitting} onClick={handleEditSave}>Сохранить</Button>
                  <Button size="small" icon={<CloseOutlined />} onClick={() => { setEditingId(null); setEditText('') }}>Отмена</Button>
                </Space>
              </div>
            ) : (
              <Text style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{comment.text}</Text>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8, alignItems: isMobile ? 'stretch' : 'flex-end' }}>
        {recipientOptions.length > 1 && (
          <Select
            value={recipient ?? ''}
            onChange={(val) => setRecipient(val || null)}
            options={recipientOptions}
            style={{ width: isMobile ? '100%' : 130, flexShrink: 0 }}
            size="middle"
          />
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flex: 1 }}>
          <TextArea
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Написать комментарий... (Enter для отправки)"
            autoSize={{ minRows: 1, maxRows: 3 }}
            style={{ flex: 1 }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={isSubmitting}
            disabled={!newText.trim()}
            onClick={handleSend}
          />
        </div>
      </div>
    </div>
  )
}

export default ContractCommentsChat
