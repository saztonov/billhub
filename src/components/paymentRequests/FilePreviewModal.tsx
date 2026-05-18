import { useEffect, useState, useCallback } from 'react'
import { Modal, Spin, Typography, Flex, Button, Tooltip } from 'antd'
import { ZoomInOutlined, ZoomOutOutlined, ExpandOutlined } from '@ant-design/icons'
import { getDownloadUrl } from '@/services/s3'
import OfficeFileViewer from '@/components/common/OfficeFileViewer'
import { isImageMime, isPdfMime, isOfficeMime } from '@/utils/mimeFromExtension'

const { Text } = Typography

interface FilePreviewModalProps {
  open: boolean
  onClose: () => void
  fileKey: string | null
  fileName: string
  mimeType: string | null
}

/** Шаги зума */
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]
const DEFAULT_ZOOM_INDEX = 3 // 100%

const FilePreviewModal = ({ open, onClose, fileKey, fileName, mimeType }: FilePreviewModalProps) => {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX)

  useEffect(() => {
    if (!open || !fileKey) return
    // Для офисных файлов URL не нужен — рендеринг идёт через OfficeFileViewer (скачивание blob внутри)
    if (isOfficeMime(mimeType)) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    getDownloadUrl(fileKey)
      .then((u) => { if (!cancelled) setUrl(u) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => {
      cancelled = true
      setUrl(null)
      setZoomIndex(DEFAULT_ZOOM_INDEX)
    }
  }, [open, fileKey, mimeType])

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
  const showZoomControls = isImageMime(mimeType) && !loading && url

  /** Рендер содержимого по типу файла */
  const renderContent = () => {
    if (isOfficeMime(mimeType)) {
      if (!fileKey) {
        return (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Text type="secondary">Файл не найден</Text>
          </div>
        )
      }
      return <OfficeFileViewer source={{ type: 'key', fileKey }} fileName={fileName} height="80vh" />
    }

    if (loading || !url) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Spin size="large" />
        </div>
      )
    }

    if (isImageMime(mimeType)) {
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

    if (isPdfMime(mimeType)) {
      return (
        <iframe
          src={url}
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
