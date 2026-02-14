import { Modal } from 'antd'
import { useEffect, useState } from 'react'

interface LocalFilePreviewModalProps {
  open: boolean
  onClose: () => void
  file: File | null
  fileName: string
}

/**
 * Компонент для предпросмотра локальных файлов до загрузки на S3
 * Использует URL.createObjectURL для создания временного blob URL
 */
function LocalFilePreviewModal(props: LocalFilePreviewModalProps) {
  const { open, onClose, file, fileName } = props
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  // Создаем и освобождаем blob URL
  useEffect(() => {
    if (!file || !open) {
      setObjectUrl(null)
      return
    }

    // Создаем временный URL для файла
    const url = URL.createObjectURL(file)
    setObjectUrl(url)

    // Cleanup: освобождаем память при размонтировании или закрытии
    return () => {
      URL.revokeObjectURL(url)
      setObjectUrl(null)
    }
  }, [file, open])

  const handleClose = () => {
    // Освобождаем URL перед закрытием
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
      setObjectUrl(null)
    }
    onClose()
  }

  // Определяем тип файла для рендеринга
  const isImage = (mimeType: string) => mimeType.startsWith('image/')
  const isPdf = (mimeType: string) => mimeType === 'application/pdf'

  const renderPreview = () => {
    if (!objectUrl || !file) {
      return <div style={{ padding: 20, textAlign: 'center' }}>Загрузка...</div>
    }

    const mimeType = file.type

    // Изображения
    if (isImage(mimeType)) {
      return (
        <div style={{ textAlign: 'center', maxHeight: '70vh', overflow: 'auto' }}>
          <img
            src={objectUrl}
            alt={fileName}
            style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
          />
        </div>
      )
    }

    // PDF
    if (isPdf(mimeType)) {
      return (
        <iframe
          src={objectUrl}
          title={fileName}
          style={{ width: '100%', height: '70vh', border: 'none' }}
        />
      )
    }

    // Office документы и другие файлы
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#8c8c8c' }}>
        <p>Предпросмотр недоступен для этого типа файла</p>
        <p style={{ fontSize: 12, marginTop: 8 }}>
          Файлы Word, Excel и другие документы можно просмотреть только после загрузки на сервер
        </p>
      </div>
    )
  }

  return (
    <Modal
      title={`Просмотр: ${fileName}`}
      open={open}
      onCancel={handleClose}
      footer={null}
      width="80%"
      centered
      destroyOnHidden
    >
      {renderPreview()}
    </Modal>
  )
}

export default LocalFilePreviewModal
