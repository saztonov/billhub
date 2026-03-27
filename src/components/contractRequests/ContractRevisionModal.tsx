import { useState } from 'react'
import { Modal, Checkbox, Space, App } from 'antd'
import type { RevisionTarget } from '@/types'

interface ContractRevisionModalProps {
  open: boolean
  onClose: () => void
  onConfirm: (targets: RevisionTarget[]) => Promise<void>
}

const ContractRevisionModal = ({ open, onClose, onConfirm }: ContractRevisionModalProps) => {
  const { message } = App.useApp()
  const [targets, setTargets] = useState<RevisionTarget[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  /** Переключение чекбокса */
  const handleToggle = (target: RevisionTarget) => {
    setTargets((prev) =>
      prev.includes(target) ? prev.filter((t) => t !== target) : [...prev, target]
    )
  }

  /** Подтверждение отправки на доработку */
  const handleConfirm = async () => {
    if (targets.length === 0) {
      message.error('Выберите хотя бы один пункт')
      return
    }
    setIsSubmitting(true)
    try {
      await onConfirm(targets)
      setTargets([])
      onClose()
    } catch {
      message.error('Ошибка отправки на доработку')
    } finally {
      setIsSubmitting(false)
    }
  }

  /** Отмена и сброс состояния */
  const handleCancel = () => {
    setTargets([])
    onClose()
  }

  return (
    <Modal
      title="Отправить на доработку"
      open={open}
      onCancel={handleCancel}
      onOk={handleConfirm}
      okText="Отправить"
      cancelText="Отмена"
      confirmLoading={isSubmitting}
      width={420}
      destroyOnClose
    >
      <Space direction="vertical" size="middle" style={{ width: '100%', paddingTop: 8 }}>
        <Checkbox
          checked={targets.includes('shtab')}
          onChange={() => handleToggle('shtab')}
        >
          Согласование Штаб
        </Checkbox>
        <Checkbox
          checked={targets.includes('counterparty')}
          onChange={() => handleToggle('counterparty')}
        >
          На доработку Подрядчику
        </Checkbox>
      </Space>
    </Modal>
  )
}

export default ContractRevisionModal
