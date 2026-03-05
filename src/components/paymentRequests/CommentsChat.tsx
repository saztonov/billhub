import { useState, useEffect, useRef } from 'react'
import { Typography, Input, Button, Space, Popconfirm, App } from 'antd'
import { SendOutlined, EditOutlined, DeleteOutlined, CloseOutlined, CheckOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useCommentStore } from '@/store/commentStore'
import { useAuthStore } from '@/store/authStore'
import type { PaymentRequestComment } from '@/types'

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
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchComments(paymentRequestId)
  }, [paymentRequestId, fetchComments])

  useEffect(() => {
    // Прокрутка вниз при новых сообщениях
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [comments.length])

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

  // Определяем последний комментарий текущего пользователя
  const lastOwnComment = user
    ? [...comments].reverse().find((c) => c.authorId === user.id)
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
    <div style={{ marginTop: 16 }}>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>Комментарии</Text>

      <div
        ref={listRef}
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
                <Text strong style={{ fontSize: 13 }}>{comment.authorFullName ?? comment.authorEmail ?? '—'}</Text>
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
