import { useEffect, useMemo, useState, useCallback } from 'react'
import { Button, Flex, Typography, Spin, Tooltip } from 'antd'
import { ZoomInOutlined, ZoomOutOutlined, ExpandOutlined, ShrinkOutlined } from '@ant-design/icons'
import OfficeFileViewer from '@/components/common/OfficeFileViewer'
import { getDownloadUrl } from '@/services/s3'
import { isImageMime, isPdfMime, isOfficeMime, getMimeFromFileName } from '@/utils/mimeFromExtension'

const { Text } = Typography

// Шаги масштабирования изображения
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]
const DEFAULT_ZOOM_INDEX = 3

interface DpFillPreviewPaneProps {
  file?: File | null
  fileKey?: string | null
  fileName: string
  onCollapse: () => void
  height?: string
}

// Встроенная панель предпросмотра файла РП (локального или из S3) внутри split-режима DpFillModal
const DpFillPreviewPane = ({ file, fileKey, fileName, onCollapse, height = '78vh' }: DpFillPreviewPaneProps) => {
  const mime = useMemo(() => file?.type || getMimeFromFileName(fileName), [file, fileName])
  const isImage = isImageMime(mime)
  const isPdf = isPdfMime(mime)
  const isOffice = isOfficeMime(mime)

  // Blob URL для локального файла (image/pdf)
  const localObjectUrl = useMemo(() => {
    if (!file) return null
    if (!isImage && !isPdf) return null
    return URL.createObjectURL(file)
  }, [file, isImage, isPdf])

  useEffect(() => {
    if (!localObjectUrl) return
    return () => URL.revokeObjectURL(localObjectUrl)
  }, [localObjectUrl])

  // Presigned URL для удалённого файла (image/pdf)
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null)
  const [remoteLoading, setRemoteLoading] = useState(false)

  useEffect(() => {
    if (file || !fileKey || isOffice) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRemoteUrl(null)
      return
    }
    let cancelled = false
    setRemoteLoading(true)
    getDownloadUrl(fileKey)
      .then((u) => { if (!cancelled) setRemoteUrl(u) })
      .finally(() => { if (!cancelled) setRemoteLoading(false) })
    return () => { cancelled = true }
  }, [file, fileKey, isOffice])

  // Зум только для изображений
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setZoomIndex(DEFAULT_ZOOM_INDEX)
  }, [file, fileKey])
  const zoom = ZOOM_STEPS[zoomIndex]
  const zoomPercent = Math.round(zoom * 100)
  const zoomIn = useCallback(() => setZoomIndex((i) => Math.min(i + 1, ZOOM_STEPS.length - 1)), [])
  const zoomOut = useCallback(() => setZoomIndex((i) => Math.max(i - 1, 0)), [])
  const zoomReset = useCallback(() => setZoomIndex(DEFAULT_ZOOM_INDEX), [])

  const previewUrl = localObjectUrl ?? remoteUrl

  const renderContent = () => {
    if (!file && !fileKey) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#8c8c8c' }}>
          <Text type="secondary">Файл не выбран</Text>
        </div>
      )
    }

    if (isOffice) {
      const source = file
        ? ({ type: 'file' as const, file })
        : fileKey ? ({ type: 'key' as const, fileKey }) : null
      if (!source) return null
      return <OfficeFileViewer source={source} fileName={fileName} height={height} />
    }

    if (remoteLoading || (!previewUrl && (isImage || isPdf))) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Spin size="large" />
        </div>
      )
    }

    if (isImage && previewUrl) {
      return (
        <div style={{ overflow: 'auto', height, textAlign: 'center', background: '#fafafa' }}>
          <img
            src={previewUrl}
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

    if (isPdf && previewUrl) {
      return (
        <iframe
          src={previewUrl}
          title={fileName}
          style={{ width: '100%', height, border: 'none' }}
        />
      )
    }

    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#8c8c8c' }}>
        <Text type="secondary">Предпросмотр недоступен для данного типа файла</Text>
      </div>
    )
  }

  const showZoom = isImage && !!previewUrl

  return (
    <Flex vertical style={{ height: '100%' }}>
      <Flex
        justify="space-between"
        align="center"
        gap={8}
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid #f0f0f0',
          background: '#fafafa',
          flexShrink: 0,
        }}
      >
        <Text ellipsis strong style={{ flex: 1, minWidth: 0 }}>{fileName || 'Без имени'}</Text>
        <Flex gap={4} align="center">
          {showZoom && (
            <>
              <Tooltip title="Уменьшить">
                <Button size="small" icon={<ZoomOutOutlined />} onClick={zoomOut} disabled={zoomIndex === 0} />
              </Tooltip>
              <Text style={{ fontSize: 12, minWidth: 40, textAlign: 'center' }}>{zoomPercent}%</Text>
              <Tooltip title="Увеличить">
                <Button size="small" icon={<ZoomInOutlined />} onClick={zoomIn} disabled={zoomIndex === ZOOM_STEPS.length - 1} />
              </Tooltip>
              <Tooltip title="Сбросить масштаб">
                <Button size="small" icon={<ExpandOutlined />} onClick={zoomReset} />
              </Tooltip>
            </>
          )}
          <Tooltip title="Свернуть превью">
            <Button size="small" icon={<ShrinkOutlined />} onClick={onCollapse}>Свернуть</Button>
          </Tooltip>
        </Flex>
      </Flex>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {renderContent()}
      </div>
    </Flex>
  )
}

export default DpFillPreviewPane
