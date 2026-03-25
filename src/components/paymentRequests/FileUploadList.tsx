import { useCallback, useRef, useState } from 'react'
import { Upload, Select, Button, Typography, Space, App } from 'antd'
import { InboxOutlined, DeleteOutlined, CheckCircleFilled, EyeOutlined } from '@ant-design/icons'
import { useDocumentTypeStore } from '@/store/documentTypeStore'
import { getPdfPageCount } from '@/utils/pdfUtils'
import { checkFileMagicBytes } from '@/utils/fileValidation'
import { useNativeDropZone } from '@/hooks/useNativeDropZone'
import LocalFilePreviewModal from './LocalFilePreviewModal'
import type { UploadFile } from 'antd/es/upload/interface'

const { Dragger } = Upload
const { Text } = Typography

export interface FileItem {
  uid: string
  file: File
  documentTypeId: string | null
  pageCount: number | null
}

interface FileUploadListProps {
  fileList: FileItem[]
  onChange: (files: FileItem[]) => void
  /** Показывать ошибку валидации для файлов без типа документа */
  showValidation?: boolean
}

// Допустимые MIME-типы
const ACCEPTED_TYPES = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/bmp',
  'application/pdf',
  'image/vnd.dwg',
]

const ACCEPT_EXTENSIONS = '.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.tiff,.tif,.bmp,.pdf,.dwg'

/** Максимальный размер файла */
const MAX_FILE_SIZE_MB = Number(import.meta.env.VITE_MAX_FILE_SIZE_MB) || 100
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

/** Форматирование размера файла */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

const VALID_EXTS = ['doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'pdf', 'dwg']

const FileUploadList = ({ fileList, onChange, showValidation }: FileUploadListProps) => {
  const { message } = App.useApp()
  const { documentTypes } = useDocumentTypeStore()
  const [dragKey, setDragKey] = useState(0)
  const [previewFile, setPreviewFile] = useState<{ file: File; name: string } | null>(null)
  // Ref для актуального fileList — нужен в колбэках, чтобы избежать stale closure
  const fileListRef = useRef(fileList)
  fileListRef.current = fileList

  // Общая логика обработки файлов (используется и для клика, и для drag & drop)
  const processFiles = useCallback((files: File[]) => {
    const validFiles: File[] = []
    for (const f of files) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      if (!VALID_EXTS.includes(ext) && !ACCEPTED_TYPES.includes(f.type)) {
        message.error(`Неподдерживаемый формат: ${f.name}`)
        continue
      }
      if (f.size > MAX_FILE_SIZE_BYTES) {
        message.error(`Файл "${f.name}" превышает ${MAX_FILE_SIZE_MB} МБ`)
        continue
      }
      validFiles.push(f)
    }

    if (validFiles.length > 0) {
      void (async () => {
        const items: FileItem[] = []
        for (const f of validFiles) {
          const isValidContent = await checkFileMagicBytes(f)
          if (!isValidContent) {
            message.error(`Файл "${f.name}" не соответствует заявленному формату`)
            continue
          }
          const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
          const pageCount = isPdf ? await getPdfPageCount(f) : null
          items.push({
            uid: `${Date.now()}_${Math.random().toString(36).slice(2)}_${items.length}`,
            file: f,
            documentTypeId: null,
            pageCount,
          })
        }
        if (items.length > 0) {
          onChange([...fileListRef.current, ...items])
        }
        setDragKey((k) => k + 1)
      })()
    }
  }, [message, onChange])

  // Нативный drag & drop (минуя React event delegation для совместимости с React 19 + порталами)
  const { ref: dropZoneRef, isDragOver } = useNativeDropZone(processFiles)

  const handleBeforeUpload = (file: File, batch: File[]) => {
    if (file !== batch[0]) return false
    processFiles(batch)
    return false
  }

  const handleRemove = (uid: string) => {
    onChange(fileList.filter((f) => f.uid !== uid))
  }

  const handleTypeChange = (uid: string, documentTypeId: string) => {
    onChange(
      fileList.map((f) =>
        f.uid === uid ? { ...f, documentTypeId } : f,
      ),
    )
  }

  const typeOptions = documentTypes.map((dt) => ({
    label: dt.name,
    value: dt.id,
  }))

  return (
    <div>
      <div ref={dropZoneRef} style={{ position: 'relative' }}>
        <Dragger
          key={dragKey}
          accept={ACCEPT_EXTENSIONS}
          multiple
          showUploadList={false}
          beforeUpload={handleBeforeUpload as unknown as (file: UploadFile) => boolean}
          style={{ marginBottom: fileList.length > 0 ? 16 : 0, borderColor: isDragOver ? '#1677ff' : undefined, background: isDragOver ? '#e6f4ff' : undefined }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">
            Перетащите файлы или нажмите для выбора
          </p>
          <p className="ant-upload-hint">
            doc, docx, xls, xlsx, jpg, png, tiff, bmp, pdf, dwg
          </p>
        </Dragger>
      </div>

      {fileList.length > 0 && (
        <div>
          {fileList.map((item) => (
            <div key={item.uid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
              <Text
                ellipsis={{ tooltip: item.file.name }}
                style={{ flex: '1 1 70%', minWidth: 0 }}
              >
                {item.file.name}
              </Text>
              <Text type="secondary" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                {formatSize(item.file.size)}
              </Text>
              {item.pageCount != null && (
                <Text type="secondary" style={{ flexShrink: 0, whiteSpace: 'nowrap', marginLeft: 8 }}>
                  {item.pageCount} стр.
                </Text>
              )}
              <Select
                placeholder={<span>Тип документа <span style={{ color: '#ff4d4f' }}>*</span></span>}
                size="small"
                style={{ width: 180, flexShrink: 0 }}
                status={showValidation && !item.documentTypeId ? 'error' : undefined}
                popupMatchSelectWidth={false}
                styles={{ popup: { root: { maxWidth: 250 } } }}
                options={typeOptions}
                value={item.documentTypeId ?? undefined}
                onChange={(val) => handleTypeChange(item.uid, val)}
              />
              <CheckCircleFilled
                style={{
                  color: '#52c41a',
                  fontSize: 16,
                  flexShrink: 0,
                  visibility: item.documentTypeId ? 'visible' : 'hidden'
                }}
              />
              <Space size={4}>
                <Button
                  icon={<EyeOutlined />}
                  size="small"
                  onClick={() => setPreviewFile({ file: item.file, name: item.file.name })}
                />
                <Button
                  icon={<DeleteOutlined />}
                  danger
                  size="small"
                  onClick={() => handleRemove(item.uid)}
                />
              </Space>
            </div>
          ))}
        </div>
      )}

      {/* Модал предпросмотра файла */}
      <LocalFilePreviewModal
        open={!!previewFile}
        onClose={() => setPreviewFile(null)}
        file={previewFile?.file ?? null}
        fileName={previewFile?.name ?? ''}
      />
    </div>
  )
}

export default FileUploadList
