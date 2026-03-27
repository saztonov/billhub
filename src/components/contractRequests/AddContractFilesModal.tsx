import { useState, useEffect } from 'react'
import { Modal, App } from 'antd'
import { useAuthStore } from '@/store/authStore'
import { useUploadQueueStore } from '@/store/uploadQueueStore'
import ContractFileUpload from '@/components/contractRequests/ContractFileUpload'

interface FileItem {
  uid: string
  file: File
}

interface AddContractFilesModalProps {
  open: boolean
  onClose: () => void
  requestId: string
  requestNumber: string
  counterpartyName: string
}

const AddContractFilesModal = ({
  open,
  onClose,
  requestId,
  requestNumber,
  counterpartyName,
}: AddContractFilesModalProps) => {
  const { message } = App.useApp()
  const [fileList, setFileList] = useState<FileItem[]>([])
  const user = useAuthStore((s) => s.user)
  const addTask = useUploadQueueStore((s) => s.addTask)

  // Сброс списка файлов при закрытии
  useEffect(() => {
    if (!open) setFileList([])
  }, [open])

  /** Добавление файлов в очередь загрузки */
  const handleSave = () => {
    if (fileList.length === 0) {
      message.warning('Добавьте хотя бы один файл')
      return
    }

    addTask({
      type: 'contract_files',
      requestId,
      requestNumber,
      counterpartyName,
      files: fileList.map((f) => ({
        file: f.file,
        documentTypeId: undefined,
        pageCount: null,
        isResubmit: false,
        isAdditional: true,
      })),
      userId: user!.id,
    })

    message.success('Файлы добавлены в очередь загрузки')
    onClose()
  }

  return (
    <Modal
      title="Добавить файлы"
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      okText="Добавить"
      cancelText="Отмена"
      width={560}
      destroyOnClose
    >
      <ContractFileUpload fileList={fileList} onChange={setFileList} />
    </Modal>
  )
}

export default AddContractFilesModal
