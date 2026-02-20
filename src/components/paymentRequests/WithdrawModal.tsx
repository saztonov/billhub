import { useState, useEffect } from 'react'
import { Modal, Input } from 'antd'

const { TextArea } = Input

interface WithdrawModalProps {
  open: boolean
  onConfirm: (comment: string) => void
  onCancel: () => void
}

const WithdrawModal = ({ open, onConfirm, onCancel }: WithdrawModalProps) => {
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (!open) setComment('')
  }, [open])

  return (
    <Modal
      title="Отзыв заявки"
      open={open}
      onOk={() => {
        onConfirm(comment)
        setComment('')
      }}
      onCancel={() => {
        onCancel()
        setComment('')
      }}
      okText="Отозвать"
      okButtonProps={{ danger: true }}
    >
      <TextArea
        rows={3}
        placeholder="Комментарий (необязательно)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
    </Modal>
  )
}

export default WithdrawModal
