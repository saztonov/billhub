import { useEffect, useState, useCallback } from 'react'
import {
  Modal,
  Table,
  Button,
  Upload,
  Input,
  Space,
  App,
  Popconfirm,
} from 'antd'
import {
  UploadOutlined,
  DownloadOutlined,
  DeleteOutlined,
  EyeOutlined,
} from '@ant-design/icons'
import { useFoundingDocumentStore } from '@/store/foundingDocumentStore'
import { uploadFoundingFile, getProxyDownloadUrl } from '@/services/s3'
import { api } from '@/services/api'
import dayjs from 'dayjs'
import type { FoundingDocumentFile } from '@/types'
import FilePreviewModal from '@/components/paymentRequests/FilePreviewModal'

interface Props {
  open: boolean
  onClose: () => void
  supplierId: string
  typeId: string
  typeName: string
  /** id записи supplier_founding_documents (может быть null, если ещё не создана) */
  docId: string | null
}

const FoundingDocumentFilesModal = ({
  open,
  onClose,
  supplierId,
  typeId,
  typeName,
  docId,
}: Props) => {
  const { message } = App.useApp()
  const { files, isFilesLoading, fetchFiles, deleteFile, fetchDocuments } =
    useFoundingDocumentStore()
  const [uploading, setUploading] = useState(false)
  const [fileComment, setFileComment] = useState('')
  const [previewFile, setPreviewFile] = useState<FoundingDocumentFile | null>(null)

  useEffect(() => {
    if (open) {
      fetchFiles(supplierId, typeId)
    }
  }, [open, supplierId, typeId, fetchFiles])

  /** Обеспечиваем существование записи supplier_founding_documents перед загрузкой */
  const ensureDocId = useCallback(async (): Promise<string> => {
    if (docId) return docId
    // Создаем запись через upsert
    const result = await api.put<{ id: string }>(
      `/api/founding-documents/${supplierId}/${typeId}`,
      {}
    )
    // Обновляем таблицу чтобы получить новый docId
    await fetchDocuments(supplierId)
    return result.id
  }, [docId, supplierId, typeId, fetchDocuments])

  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      const entityId = await ensureDocId()
      const { key } = await uploadFoundingFile(entityId, file)

      // Подтверждаем загрузку и сохраняем метаданные
      await api.post('/api/files/confirm', {
        fileKey: key,
        entityType: 'founding_document_files',
        entityId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        comment: fileComment,
      })

      setFileComment('')
      await fetchFiles(supplierId, typeId)
      await fetchDocuments(supplierId)
      message.success('Файл загружен')
    } catch {
      message.error('Ошибка загрузки файла')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (fileId: string) => {
    try {
      await deleteFile(fileId)
      await fetchFiles(supplierId, typeId)
      await fetchDocuments(supplierId)
      message.success('Файл удален')
    } catch {
      message.error('Ошибка удаления файла')
    }
  }

  const handleDownload = (file: FoundingDocumentFile) => {
    const url = getProxyDownloadUrl(file.fileKey, file.fileName)
    window.open(url, '_blank')
  }

  const columns = [
    {
      title: 'Файл',
      dataIndex: 'fileName',
      key: 'fileName',
      ellipsis: true,
      render: (name: string, record: FoundingDocumentFile) => (
        <Button type="link" size="small" onClick={() => setPreviewFile(record)} style={{ padding: 0 }}>
          {name}
        </Button>
      ),
    },
    {
      title: 'Дата',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 120,
      render: (val: string) => dayjs(val).format('DD.MM.YYYY'),
    },
    {
      title: 'Добавил',
      dataIndex: 'createdByName',
      key: 'createdByName',
      width: 180,
      ellipsis: true,
    },
    {
      title: 'Комментарий',
      dataIndex: 'comment',
      key: 'comment',
      ellipsis: true,
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_: unknown, record: FoundingDocumentFile) => (
        <Space size={4}>
          <Button
            icon={<EyeOutlined />}
            size="small"
            onClick={() => setPreviewFile(record)}
          />
          <Button
            icon={<DownloadOutlined />}
            size="small"
            onClick={() => handleDownload(record)}
          />
          <Popconfirm title="Удалить файл?" onConfirm={() => handleDelete(record.id)}>
            <Button icon={<DeleteOutlined />} size="small" danger />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
    <Modal
      title={`Файлы: ${typeName}`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={700}
      destroyOnClose
    >
      <Table
        columns={columns}
        dataSource={files}
        rowKey="id"
        loading={isFilesLoading}
        pagination={false}
        size="small"
        locale={{ emptyText: 'Нет файлов' }}
      />

      <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <Input.TextArea
          placeholder="Комментарий к файлу (необязательно)"
          value={fileComment}
          onChange={(e) => setFileComment(e.target.value)}
          rows={1}
          style={{ flex: 1 }}
        />
        <Upload
          showUploadList={false}
          beforeUpload={(file) => {
            handleUpload(file)
            return false
          }}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.tiff,.tif,.bmp"
        >
          <Button icon={<UploadOutlined />} loading={uploading} type="primary">
            Загрузить
          </Button>
        </Upload>
      </div>
    </Modal>

    <FilePreviewModal
      open={!!previewFile}
      onClose={() => setPreviewFile(null)}
      fileKey={previewFile?.fileKey ?? null}
      fileName={previewFile?.fileName ?? ''}
      mimeType={previewFile?.mimeType ?? null}
    />
    </>
  )
}

export default FoundingDocumentFilesModal
