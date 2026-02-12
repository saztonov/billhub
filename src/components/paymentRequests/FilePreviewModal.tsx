import { useEffect, useState } from 'react'
import { Modal, Spin, Typography } from 'antd'
import { getDownloadUrl } from '@/services/s3'

const { Text } = Typography

interface FilePreviewModalProps {
  open: boolean
  onClose: () => void
  fileKey: string | null
  fileName: string
  mimeType: string | null
}

/** Проверяет, является ли MIME-тип изображением */
function isImage(mime: string | null): boolean {
  return !!mime && mime.startsWith('image/')
}

/** Проверяет, является ли MIME-тип PDF */
function isPdf(mime: string | null): boolean {
  return mime === 'application/pdf'
}

/** Проверяет, является ли MIME-тип Office-документом */
function isOffice(mime: string | null): boolean {
  if (!mime) return false
  return [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ].includes(mime)
}

const FilePreviewModal = ({ open, onClose, fileKey, fileName, mimeType }: FilePreviewModalProps) => {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !fileKey) {
      setUrl(null)
      return
    }
    setLoading(true)
    getDownloadUrl(fileKey)
      .then((u) => setUrl(u))
      .finally(() => setLoading(false))
  }, [open, fileKey])

  /** Рендер содержимого по типу файла */
  const renderContent = () => {
    if (loading || !url) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Spin size="large" />
        </div>
      )
    }

    if (isImage(mimeType)) {
      return (
        <div style={{ textAlign: 'center' }}>
          <img
            src={url}
            alt={fileName}
            style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
          />
        </div>
      )
    }

    if (isPdf(mimeType)) {
      return (
        <iframe
          src={url}
          title={fileName}
          style={{ width: '100%', height: '70vh', border: 'none' }}
        />
      )
    }

    if (isOffice(mimeType)) {
      const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`
      return (
        <iframe
          src={viewerUrl}
          title={fileName}
          style={{ width: '100%', height: '70vh', border: 'none' }}
        />
      )
    }

    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Text type="secondary">Предпросмотр недоступен для данного типа файла</Text>
      </div>
    )
  }

  return (
    <Modal
      title={fileName}
      open={open}
      onCancel={onClose}
      footer={null}
      width={900}
      destroyOnClose
    >
      {renderContent()}
    </Modal>
  )
}

export default FilePreviewModal
