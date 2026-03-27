import { useCallback, useRef } from 'react'
import { Upload, Button, Typography, Flex, App } from 'antd'
import { InboxOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons'
import { checkFileMagicBytes } from '@/utils/fileValidation'
const { Dragger } = Upload
const { Text } = Typography

interface FileItem {
  uid: string
  file: File
}

interface ContractFileUploadProps {
  fileList: FileItem[]
  onChange: (files: FileItem[]) => void
}

/** Допустимые расширения файлов */
const VALID_EXTS = ['doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'pdf', 'dwg']
const ACCEPT_EXTENSIONS = VALID_EXTS.map((e) => `.${e}`).join(',')
const MAX_FILE_SIZE_MB = Number(import.meta.env.VITE_MAX_FILE_SIZE_MB ?? 100)
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

/** Форматирование размера файла */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

/** Типы файлов, которые можно предпросмотреть в браузере */
const PREVIEWABLE_EXTS = ['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'tif', 'pdf']

const ContractFileUpload = ({ fileList, onChange }: ContractFileUploadProps) => {
  const { message } = App.useApp()
  const fileListRef = useRef(fileList)
  fileListRef.current = fileList

  /** Предпросмотр файла в новой вкладке */
  const handlePreview = useCallback((file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!PREVIEWABLE_EXTS.includes(ext)) {
      message.info('Предпросмотр недоступен для этого формата')
      return
    }
    const url = URL.createObjectURL(file)
    window.open(url, '_blank')
    // Освобождаем память через 1 минуту
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }, [message])

  /** Обработка выбранных файлов с валидацией */
  const processFiles = useCallback((files: File[]) => {
    void (async () => {
      const items: FileItem[] = []
      for (const f of files) {
        const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
        if (!VALID_EXTS.includes(ext)) {
          message.error(`Неподдерживаемый формат: ${f.name}`)
          continue
        }
        if (f.size > MAX_FILE_SIZE_BYTES) {
          message.error(`Файл "${f.name}" превышает ${MAX_FILE_SIZE_MB} МБ`)
          continue
        }
        const isValid = await checkFileMagicBytes(f)
        if (!isValid) {
          message.error(`Файл "${f.name}" не соответствует заявленному формату`)
          continue
        }
        items.push({
          uid: `${Date.now()}_${Math.random().toString(36).slice(2)}_${items.length}`,
          file: f,
        })
      }
      if (items.length > 0) {
        onChange([...fileListRef.current, ...items])
      }
    })()
  }, [message, onChange])

  /** Удаление файла из списка */
  const handleRemove = useCallback((uid: string) => {
    onChange(fileList.filter((f) => f.uid !== uid))
  }, [fileList, onChange])

  return (
    <div>
      <Dragger
        accept={ACCEPT_EXTENSIONS}
        multiple
        showUploadList={false}
        beforeUpload={(file) => {
          processFiles([file])
          return false
        }}
        style={{ marginBottom: 8 }}
      >
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">Нажмите или перетащите файлы</p>
      </Dragger>

      {fileList.length > 0 && (
        <Flex vertical gap={4}>
          {fileList.map((item) => (
            <Flex
              key={item.uid}
              align="center"
              gap={8}
              style={{ padding: '4px 8px', background: '#fafafa', borderRadius: 4 }}
            >
              <Text ellipsis style={{ flex: 1 }}>{item.file.name}</Text>
              <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>{formatSize(item.file.size)}</Text>
              <Button
                size="small"
                icon={<EyeOutlined />}
                onClick={() => handlePreview(item.file)}
              />
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => handleRemove(item.uid)}
              />
            </Flex>
          ))}
        </Flex>
      )}
    </div>
  )
}

export default ContractFileUpload
