import { useMemo } from 'react'
import { Spin, Image, Button, Segmented, Typography, Space } from 'antd'
import { CloseOutlined, DownloadOutlined } from '@ant-design/icons'

const { Text } = Typography

interface InvoiceFile {
  id: string
  fileKey: string
  fileName: string
  mimeType: string | null
}

interface InvoiceViewerProps {
  files: InvoiceFile[]
  urls: Record<string, string>
  isLoading: boolean
  currentFileId: string | null
  currentPage: number
  onFileChange: (fileId: string) => void
  onClose: () => void
}

/** Панель просмотра скана счёта (правая часть split-view) */
const InvoiceViewer = ({
  files,
  urls,
  isLoading,
  currentFileId,
  currentPage,
  onFileChange,
  onClose,
}: InvoiceViewerProps) => {
  const currentFile = useMemo(
    () => files.find((f) => f.id === currentFileId) ?? files[0] ?? null,
    [files, currentFileId],
  )

  const currentUrl = useMemo(() => {
    if (!currentFile) return null
    const base = urls[currentFile.id]
    if (!base) return null
    // Для PDF добавляем навигацию к странице
    if (currentFile.mimeType === 'application/pdf' && currentPage > 1) {
      return `${base}#page=${currentPage}`
    }
    return base
  }, [currentFile, urls, currentPage])

  // Опции переключения файлов
  const fileOptions = useMemo(
    () => files.map((f, i) => ({ value: f.id, label: `Файл ${i + 1}` })),
    [files],
  )

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Text type="secondary">Файлы счета не найдены</Text>
      </div>
    )
  }

  const isImage = currentFile?.mimeType?.startsWith('image/')
  const isPdf = currentFile?.mimeType === 'application/pdf'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '1px solid #f0f0f0',
        flexShrink: 0,
      }}>
        <Space size="small">
          {files.length > 1 && (
            <Segmented
              size="small"
              options={fileOptions}
              value={currentFileId ?? files[0]?.id}
              onChange={(v) => onFileChange(v as string)}
            />
          )}
          {currentFile && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {currentFile.fileName}
            </Text>
          )}
        </Space>
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={onClose}
          title="Скрыть скан"
        />
      </div>

      {/* Контент */}
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {isImage && currentUrl && (
          <Image
            src={currentUrl}
            alt={currentFile?.fileName}
            style={{ maxWidth: '100%' }}
          />
        )}
        {isPdf && currentUrl && (
          <iframe
            key={currentUrl}
            src={currentUrl}
            title={currentFile?.fileName}
            style={{ width: '100%', height: '100%', border: 'none', minHeight: 500 }}
          />
        )}
        {!isImage && !isPdf && currentUrl && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Button
              icon={<DownloadOutlined />}
              href={currentUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Скачать файл
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default InvoiceViewer
