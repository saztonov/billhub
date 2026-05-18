import { Modal } from 'antd'
import { useEffect, useMemo } from 'react'
import OfficeFileViewer from '@/components/common/OfficeFileViewer'
import { getMimeFromFileName, isOfficeMime } from '@/utils/mimeFromExtension'

interface LocalFilePreviewModalProps {
  open: boolean
  onClose: () => void
  file: File | null
  fileName: string
}

/**
 * Компонент для предпросмотра локальных файлов до загрузки на S3
 * Изображения и PDF — через URL.createObjectURL, Office-документы — через OfficeFileViewer
 */
function LocalFilePreviewModal(props: LocalFilePreviewModalProps) {
  const { open, onClose, file, fileName } = props

  // mime: либо из самого File, либо вычисляем по расширению (бывают пустые file.type)
  const mime = file?.type || getMimeFromFileName(fileName)
  const isImage = mime?.startsWith('image/') ?? false
  const isPdf = mime === 'application/pdf'
  const isOffice = isOfficeMime(mime)

  // Blob URL только для image/pdf — office рендерится из ArrayBuffer без URL
  const objectUrl = useMemo(() => {
    if (!file || !open) return null
    if (!isImage && !isPdf) return null
    return URL.createObjectURL(file)
  }, [file, open, isImage, isPdf])

  // Освобождаем blob URL при размонтировании или смене файла
  useEffect(() => {
    if (!objectUrl) return
    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [objectUrl])

  const handleClose = () => {
    onClose()
  }

  const renderPreview = () => {
    if (!file) {
      return <div style={{ padding: 20, textAlign: 'center' }}>Загрузка...</div>
    }

    if (isImage && objectUrl) {
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

    if (isPdf && objectUrl) {
      return (
        <iframe
          src={objectUrl}
          title={fileName}
          style={{ width: '100%', height: '70vh', border: 'none' }}
        />
      )
    }

    if (isOffice) {
      return <OfficeFileViewer source={{ type: 'file', file }} fileName={fileName} height="70vh" />
    }

    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#8c8c8c' }}>
        <p>Предпросмотр недоступен для этого типа файла</p>
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
