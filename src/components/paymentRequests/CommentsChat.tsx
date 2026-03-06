import { useState, useEffect } from 'react'
import { Typography, Input, Button, Space, Popconfirm, App } from 'antd'
import { SendOutlined, EditOutlined, DeleteOutlined, CloseOutlined, CheckOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useCommentStore } from '@/store/commentStore'
import { useAuthStore } from '@/store/authStore'
import type { PaymentRequestComment, Department } from '@/types'
import { DEPARTMENT_LABELS } from '@/types'

const { Text } = Typography
const { TextArea } = Input

interface CommentsChatProps {
  paymentRequestId: string
}

const CommentsChat = ({ paymentRequestId }: CommentsChatProps) => {
  const { message } = App.useApp()
  const { comments, isLoading, isSubmitting, fetchComments, addComment, updateComment, deleteComment } = useCommentStore()
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'

  const [newText, setNewText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')


  useEffect(() => {
    fetchComments(paymentRequestId)
  }, [paymentRequestId, fetchComments])



  const handleSend = async () => {
    if (!newText.trim() || !user) return
    try {
      await addComment(paymentRequestId, newText.trim(), user.id)
      setNewText('')
    } catch {
      message.error('Не удалось отправить комментарий')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

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

  const handleDelete = async (commentId: string) => {
    try {
      await deleteComment(commentId)
      message.success('Комментарий удалён')
    } catch {
      message.error('Не удалось удалить комментарий')
    }
  }

  const startEditing = (comment: PaymentRequestComment) => {
    setEditingId(comment.id)
    setEditText(comment.text)
  }

  const getAuthorDisplayName = (comment: PaymentRequestComment): string => {
    if (comment.authorRole === 'counterparty_user') {
      return comment.authorCounterpartyName ?? comment.authorEmail ?? '—'
    }
    const parts: string[] = []
    if (comment.authorDepartment) {
      const label = DEPARTMENT_LABELS[comment.authorDepartment as Department]
      if (label) parts.push(label)
    }
    if (comment.authorFullName) {
      const words = comment.authorFullName.trim().split(/\s+/)
      // 3+ слова — имя и отчество (2-е и 3-е), 2 слова — оба
      const shortName = words.length >= 3
        ? `${words[1]} ${words[2]}`
        : words.join(' ')
      parts.push(shortName)
    }
    return parts.join(', ') || comment.authorEmail || '—'
  }

  // Определяем последний комментарий текущего пользователя
  // Комментарии отсортированы от новых к старым — первый найденный = последний по времени
  const lastOwnComment = user
    ? comments.find((c) => c.authorId === user.id)
    : null

  const canEditComment = (comment: PaymentRequestComment) => {
    if (isAdmin) return true
    return lastOwnComment?.id === comment.id
  }

  const canDeleteComment = (comment: PaymentRequestComment) => {
    if (isAdmin) return true
    return lastOwnComment?.id === comment.id
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

      <div style={{ display: 'flex', gap: 8 }}>
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
  )
}

export default CommentsChat
