import { useState } from 'react'
import { Modal, App } from 'antd'
import { useUploadQueueStore } from '@/store/uploadQueueStore'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import { useAuthStore } from '@/store/authStore'
import FileUploadList from './FileUploadList'
import type { FileItem } from './FileUploadList'

interface AddFilesModalProps {
  open: boolean
  onClose: () => void
  requestId: string
  requestNumber: string
  counterpartyName: string
}

const AddFilesModal = ({ open, onClose, requestId, requestNumber, counterpartyName }: AddFilesModalProps) => {
  const { message } = App.useApp()
  const user = useAuthStore((s) => s.user)
  const addTask = useUploadQueueStore((s) => s.addTask)
  const fetchRequestFiles = usePaymentRequestStore((s) => s.fetchRequestFiles)
  const [fileList, setFileList] = useState<FileItem[]>([])
  const [showValidation, setShowValidation] = useState(false)

  const handleClose = () => {
    setFileList([])
    setShowValidation(false)
    onClose()
  }

  const handleSave = () => {
    if (fileList.length === 0) {
      message.warning('Добавьте хотя бы один файл')
      return
    }
    const filesWithoutType = fileList.filter((f) => !f.documentTypeId)
    if (filesWithoutType.length > 0) {
      setShowValidation(true)
      message.error('Укажите тип для каждого файла')
      return
    }
    if (!user) return

    addTask({
      type: 'request_files',
      requestId,
      requestNumber,
      counterpartyName,
      files: fileList.map((f) => ({
        file: f.file,
        documentTypeId: f.documentTypeId!,
        pageCount: f.pageCount,
        isResubmit: false,
      })),
      userId: user.id,
    })

    message.success('Файлы добавлены в очередь загрузки')
    handleClose()

    // Обновляем список файлов с задержкой, чтобы очередь успела начать обработку
    setTimeout(() => {
      fetchRequestFiles(requestId)
    }, 2000)
  }

  return (
    <Modal
      title="Добавить файлы"
      open={open}
      onCancel={handleClose}
      onOk={handleSave}
      okText="Сохранить"
      cancelText="Отмена"
      width={700}
      maskClosable={false}
      destroyOnClose
    >
      <FileUploadList fileList={fileList} onChange={setFileList} showValidation={showValidation} />
    </Modal>
  )
}

export default AddFilesModal
