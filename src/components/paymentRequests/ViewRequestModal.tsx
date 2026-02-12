import { useEffect, useState } from 'react'
import {
  Modal,
  Descriptions,
  Tag,
  List,
  Button,
  Typography,
  Space,
  Spin,
} from 'antd'
import { DownloadOutlined, EyeOutlined } from '@ant-design/icons'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import { getDownloadUrl } from '@/services/s3'
import FilePreviewModal from './FilePreviewModal'
import type { PaymentRequest, PaymentRequestFile } from '@/types'

const { Text } = Typography

interface ViewRequestModalProps {
  open: boolean
  request: PaymentRequest | null
  onClose: () => void
}

/** Форматирование размера файла */
function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

/** Форматирование даты */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const ViewRequestModal = ({ open, request, onClose }: ViewRequestModalProps) => {
  const { currentRequestFiles, fetchRequestFiles, isLoading } = usePaymentRequestStore()
  const [downloading, setDownloading] = useState<string | null>(null)
  const [previewFile, setPreviewFile] = useState<PaymentRequestFile | null>(null)

  useEffect(() => {
    if (open && request) {
      fetchRequestFiles(request.id)
    }
  }, [open, request, fetchRequestFiles])

  const handleDownload = async (fileKey: string, fileName: string) => {
    setDownloading(fileKey)
    try {
      const url = await getDownloadUrl(fileKey)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.target = '_blank'
      a.click()
    } finally {
      setDownloading(null)
    }
  }

  if (!request) return null

  return (
    <>
      <Modal
        title={`Заявка ${request.requestNumber}`}
        open={open}
        onCancel={onClose}
        footer={<Button onClick={onClose}>Закрыть</Button>}
        width={650}
      >
        <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
          <Descriptions.Item label="Номер">{request.requestNumber}</Descriptions.Item>
          <Descriptions.Item label="Контрагент">{request.counterpartyName}</Descriptions.Item>
          {request.siteName && (
            <Descriptions.Item label="Объект">{request.siteName}</Descriptions.Item>
          )}
          <Descriptions.Item label="Статус">
            <Tag color={request.statusColor ?? 'default'}>{request.statusName}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Срочность">{request.urgencyValue}</Descriptions.Item>
          {request.urgencyReason && (
            <Descriptions.Item label="Причина срочности">{request.urgencyReason}</Descriptions.Item>
          )}
          <Descriptions.Item label="Срок поставки">{request.deliveryDays} дн.</Descriptions.Item>
          <Descriptions.Item label="Условия отгрузки">{request.shippingConditionValue}</Descriptions.Item>
          {request.comment && (
            <Descriptions.Item label="Комментарий">{request.comment}</Descriptions.Item>
          )}
          <Descriptions.Item label="Дата создания">{formatDate(request.createdAt)}</Descriptions.Item>
        </Descriptions>

        <Text strong style={{ marginBottom: 8, display: 'block' }}>
          Файлы ({currentRequestFiles.length})
        </Text>

        <Spin spinning={isLoading}>
          <List
            size="small"
            dataSource={currentRequestFiles}
            locale={{ emptyText: 'Нет файлов' }}
            renderItem={(file) => (
              <List.Item
                actions={[
                  <Button
                    key="preview"
                    icon={<EyeOutlined />}
                    size="small"
                    onClick={() => setPreviewFile(file)}
                  >
                    Просмотр
                  </Button>,
                  <Button
                    key="download"
                    icon={<DownloadOutlined />}
                    size="small"
                    loading={downloading === file.fileKey}
                    onClick={() => handleDownload(file.fileKey, file.fileName)}
                  >
                    Скачать
                  </Button>,
                ]}
              >
                <Space>
                  <Text>{file.fileName}</Text>
                  <Text type="secondary">{formatSize(file.fileSize)}</Text>
                  {file.documentTypeName && (
                    <Tag>{file.documentTypeName}</Tag>
                  )}
                </Space>
              </List.Item>
            )}
          />
        </Spin>
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

export default ViewRequestModal
