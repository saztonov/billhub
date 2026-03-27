import { useEffect, useState, useCallback } from 'react'
import { Modal, Spin, Typography, Flex, Button, Tooltip } from 'antd'
import { ZoomInOutlined, ZoomOutOutlined, ExpandOutlined } from '@ant-design/icons'
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

/** Шаги зума */
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]
const DEFAULT_ZOOM_INDEX = 3 // 100%

const FilePreviewModal = ({ open, onClose, fileKey, fileName, mimeType }: FilePreviewModalProps) => {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX)

  useEffect(() => {
    if (!open || !fileKey) {
      setUrl(null)
      setZoomIndex(DEFAULT_ZOOM_INDEX)
      return
    }
    setLoading(true)
    getDownloadUrl(fileKey)
      .then((u) => setUrl(u))
      .finally(() => setLoading(false))
  }, [open, fileKey])

  const zoomIn = useCallback(() => {
    setZoomIndex((i) => Math.min(i + 1, ZOOM_STEPS.length - 1))
  }, [])

  const zoomOut = useCallback(() => {
    setZoomIndex((i) => Math.max(i - 1, 0))
  }, [])

  const zoomReset = useCallback(() => {
    setZoomIndex(DEFAULT_ZOOM_INDEX)
  }, [])

  const zoom = ZOOM_STEPS[zoomIndex]
  const zoomPercent = Math.round(zoom * 100)
  const showZoomControls = isImage(mimeType) && !loading && url

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
        <div style={{ overflow: 'auto', maxHeight: '75vh', textAlign: 'center' }}>
          <img
            src={url}
            alt={fileName}
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'top center',
              maxWidth: '100%',
              objectFit: 'contain',
              transition: 'transform 0.2s ease',
            }}
          />
        </div>
      )
    }

    if (isPdf(mimeType)) {
      return (
        <iframe
          src={url}
          title={fileName}
          style={{ width: '100%', height: '80vh', border: 'none' }}
        />
      )
    }

    if (isOffice(mimeType)) {
      const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`
      return (
        <iframe
          src={viewerUrl}
          title={fileName}
          style={{ width: '100%', height: '80vh', border: 'none' }}
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
      title={
        <Flex justify="space-between" align="center" style={{ paddingRight: 32 }}>
          <Text ellipsis style={{ maxWidth: '60%' }}>{fileName}</Text>
          {showZoomControls && (
            <Flex gap={4} align="center">
              <Tooltip title="Уменьшить">
                <Button
                  size="small"
                  icon={<ZoomOutOutlined />}
                  onClick={zoomOut}
                  disabled={zoomIndex === 0}
                />
              </Tooltip>
              <Text style={{ fontSize: 12, minWidth: 40, textAlign: 'center' }}>{zoomPercent}%</Text>
              <Tooltip title="Увеличить">
                <Button
                  size="small"
                  icon={<ZoomInOutlined />}
                  onClick={zoomIn}
                  disabled={zoomIndex === ZOOM_STEPS.length - 1}
                />
              </Tooltip>
              <Tooltip title="Сбросить">
                <Button
                  size="small"
                  icon={<ExpandOutlined />}
                  onClick={zoomReset}
                />
              </Tooltip>
            </Flex>
          )}
        </Flex>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width="80vw"
      style={{ top: 20 }}
    >
      {renderContent()}
    </Modal>
  )
}

export default FilePreviewModal
