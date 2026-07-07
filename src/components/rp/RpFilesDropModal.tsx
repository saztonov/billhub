import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal, Upload, Button, Select, Typography, Space, App } from 'antd'
import { InboxOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons'
import { useNativeDropZone } from '@/hooks/useNativeDropZone'
import { checkFileMagicBytes } from '@/utils/fileValidation'
import LocalFilePreviewModal from '@/components/paymentRequests/LocalFilePreviewModal'
import type { RpAttachmentType } from '@/types'
import type { UploadFile } from 'antd/es/upload/interface'

const { Dragger } = Upload
const { Text } = Typography

/** Файл, отобранный в площадке (с типом для вложений письма). */
export interface RpDropFile {
  file: File
  type: RpAttachmentType
}

interface RpFilesDropModalProps {
  open: boolean
  title: string
  /** Показывать выбор типа «РП/Другой» (для файлов письма); служебные файлы — без типа. */
  withType?: boolean
  onClose: () => void
  /** Загрузка отобранных файлов (выполняет родитель). Бросок ошибки оставляет модалку открытой. */
  onSubmit: (files: RpDropFile[]) => Promise<void>
}

/** Допустимые расширения/MIME (совпадают с площадкой заявки на оплату). */
const VALID_EXTS = [
  'doc',
  'docx',
  'xls',
  'xlsx',
  'jpg',
  'jpeg',
  'png',
  'tiff',
  'tif',
  'bmp',
  'pdf',
  'dwg',
  'rtf',
]
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
const ACCEPT_EXTENSIONS = '.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.tiff,.tif,.bmp,.pdf,.dwg,.rtf'
const MAX_FILE_SIZE_MB = Number(import.meta.env.VITE_MAX_FILE_SIZE_MB) || 100
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

interface Item {
  uid: string
  file: File
  type: RpAttachmentType
}

const fmtSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

/**
 * Модалка-площадка для перетаскивания файлов РП. Собирает файлы (+ тип для вложений письма)
 * и передаёт родителю через onSubmit — загрузку выполняет родитель (у письма и служебных
 * файлов она разная). Нативный DnD — через useNativeDropZone (совместимость с порталами).
 */
const RpFilesDropModal = ({ open, title, withType, onClose, onSubmit }: RpFilesDropModalProps) => {
  const { message } = App.useApp()
  const [items, setItems] = useState<Item[]>([])
  const [dragKey, setDragKey] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    if (open) {
      setItems([])
      setSubmitting(false)
      setPreviewFile(null)
    }
  }, [open])

  const processFiles = useCallback(
    (files: File[]) => {
      const valid: File[] = []
      for (const f of files) {
        const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
        if (!VALID_EXTS.includes(ext) && !ACCEPTED_TYPES.includes(f.type)) {
          message.error(`Неподдерживаемый формат: ${f.name}`)
          continue
        }
        if (f.size > MAX_FILE_SIZE_BYTES) {
          message.error(`Файл «${f.name}» превышает ${MAX_FILE_SIZE_MB} МБ`)
          continue
        }
        valid.push(f)
      }
      if (valid.length === 0) return
      void (async () => {
        const added: Item[] = []
        for (const f of valid) {
          const okContent = await checkFileMagicBytes(f)
          if (!okContent) {
            message.error(`Файл «${f.name}» не соответствует заявленному формату`)
            continue
          }
          added.push({
            uid: `${Date.now()}_${Math.random().toString(36).slice(2)}_${added.length}`,
            file: f,
            type: 'other',
          })
        }
        if (added.length > 0) setItems([...itemsRef.current, ...added])
        setDragKey((k) => k + 1)
      })()
    },
    [message],
  )

  const { ref: dropZoneRef, isDragOver } = useNativeDropZone(processFiles)

  const handleBeforeUpload = (file: File, batch: File[]) => {
    if (file === batch[0]) processFiles(batch)
    return false
  }

  const removeItem = (uid: string) => setItems((prev) => prev.filter((i) => i.uid !== uid))
  const setType = (uid: string, type: RpAttachmentType) =>
    setItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, type } : i)))

  const handleOk = async () => {
    if (items.length === 0) {
      message.info('Добавьте файлы')
      return
    }
    setSubmitting(true)
    try {
      await onSubmit(items.map((i) => ({ file: i.file, type: i.type })))
      setItems([])
      onClose()
    } catch {
      // Родитель уже показал ошибку — модалку оставляем открытой.
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      width={700}
      centered
      okText="Загрузить"
      cancelText="Отмена"
      confirmLoading={submitting}
      onOk={handleOk}
      onCancel={submitting ? undefined : onClose}
      maskClosable={!submitting}
      destroyOnHidden
    >
      <div ref={dropZoneRef} style={{ position: 'relative' }}>
        <Dragger
          key={dragKey}
          accept={ACCEPT_EXTENSIONS}
          multiple
          showUploadList={false}
          disabled={submitting}
          beforeUpload={handleBeforeUpload as unknown as (file: UploadFile) => boolean}
          style={{
            marginBottom: items.length > 0 ? 16 : 0,
            borderColor: isDragOver ? '#1677ff' : undefined,
            background: isDragOver ? '#e6f4ff' : undefined,
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">Перетащите файлы или нажмите для выбора</p>
          <p className="ant-upload-hint">doc, docx, xls, xlsx, jpg, png, tiff, bmp, pdf, dwg</p>
        </Dragger>
      </div>

      {items.map((item) => (
        <div
          key={item.uid}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 0',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <Text ellipsis={{ tooltip: item.file.name }} style={{ flex: '1 1 60%', minWidth: 0 }}>
            {item.file.name}
          </Text>
          <Text type="secondary" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
            {fmtSize(item.file.size)}
          </Text>
          {withType && (
            <Select<RpAttachmentType>
              size="small"
              value={item.type}
              disabled={submitting}
              style={{ width: 104, flexShrink: 0 }}
              onChange={(v) => setType(item.uid, v)}
              options={[
                { value: 'other', label: 'Другой' },
                { value: 'rp', label: 'РП' },
              ]}
            />
          )}
          <Space size={4}>
            <Button size="small" icon={<EyeOutlined />} onClick={() => setPreviewFile(item.file)} />
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={submitting}
              onClick={() => removeItem(item.uid)}
            />
          </Space>
        </div>
      ))}

      <LocalFilePreviewModal
        open={!!previewFile}
        onClose={() => setPreviewFile(null)}
        file={previewFile}
        fileName={previewFile?.name ?? ''}
      />
    </Modal>
  )
}

export default RpFilesDropModal
