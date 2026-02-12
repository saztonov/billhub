import { useState } from 'react'
import { Upload, Select, Button, List, Typography, message } from 'antd'
import { InboxOutlined, DeleteOutlined, CheckCircleFilled } from '@ant-design/icons'
import { useDocumentTypeStore } from '@/store/documentTypeStore'
import type { UploadFile } from 'antd/es/upload/interface'

const { Dragger } = Upload
const { Text } = Typography

export interface FileItem {
  uid: string
  file: File
  documentTypeId: string | null
}

interface FileUploadListProps {
  fileList: FileItem[]
  onChange: (files: FileItem[]) => void
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
]

const ACCEPT_EXTENSIONS = '.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.tiff,.tif,.bmp,.pdf'

/** Форматирование размера файла */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

const FileUploadList = ({ fileList, onChange }: FileUploadListProps) => {
  const { documentTypes } = useDocumentTypeStore()
  const [dragKey, setDragKey] = useState(0)

  const handleBeforeUpload = (file: File) => {
    // Проверка по расширению, т.к. MIME может быть пустым
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    const validExts = ['doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'pdf']
    if (!validExts.includes(ext) && !ACCEPTED_TYPES.includes(file.type)) {
      message.error(`Неподдерживаемый формат: ${file.name}`)
      return false
    }
    const newItem: FileItem = {
      uid: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      file,
      documentTypeId: null,
    }
    onChange([...fileList, newItem])
    setDragKey((k) => k + 1)
    return false // Предотвращаем автозагрузку
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
      <Dragger
        key={dragKey}
        accept={ACCEPT_EXTENSIONS}
        multiple
        showUploadList={false}
        beforeUpload={handleBeforeUpload as unknown as (file: UploadFile) => boolean}
        style={{ marginBottom: fileList.length > 0 ? 16 : 0 }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">
          Перетащите файлы или нажмите для выбора
        </p>
        <p className="ant-upload-hint">
          doc, docx, xls, xlsx, jpg, png, tiff, bmp, pdf
        </p>
      </Dragger>

      {fileList.length > 0 && (
        <List
          size="small"
          dataSource={fileList}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Button
                  key="delete"
                  icon={<DeleteOutlined />}
                  danger
                  size="small"
                  onClick={() => handleRemove(item.uid)}
                />,
              ]}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                <Text
                  ellipsis={{ tooltip: item.file.name }}
                  style={{ maxWidth: 200, flexShrink: 0 }}
                >
                  {item.file.name}
                </Text>
                <Text type="secondary" style={{ flexShrink: 0 }}>
                  {formatSize(item.file.size)}
                </Text>
                <Select
                  placeholder="Тип документа"
                  size="small"
                  style={{ width: 200 }}
                  options={typeOptions}
                  value={item.documentTypeId ?? undefined}
                  onChange={(val) => handleTypeChange(item.uid, val)}
                />
                {item.documentTypeId && (
                  <CheckCircleFilled style={{ color: '#52c41a', fontSize: 16 }} />
                )}
              </div>
            </List.Item>
          )}
        />
      )}
    </div>
  )
}

export default FileUploadList
