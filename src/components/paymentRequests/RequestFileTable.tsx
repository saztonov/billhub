import { useMemo } from 'react'
import {
  Tag,
  Button,
  Typography,
  Space,
  Tooltip,
  Table,
  Collapse,
} from 'antd'
import {
  DownloadOutlined,
  EyeOutlined,
  PlusOutlined,
  CloseCircleOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import { formatSize, formatDateShortWithTime } from '@/utils/requestFormatters'
import type { PaymentRequestFile, Department } from '@/types'
import { DEPARTMENT_LABELS } from '@/types'

const { Text } = Typography

interface RequestFileTableProps {
  files: PaymentRequestFile[]
  isMobile: boolean
  canRejectFiles: boolean
  downloading: string | null
  downloadingAll: boolean
  isLoading: boolean
  isEditing: boolean
  resubmitMode?: boolean
  hasAdditionalFiles: boolean
  toggleFileRejection: (fileId: string, userId: string) => void
  handleDownload: (fileKey: string, fileName: string) => void
  setPreviewFile: (f: { fileKey: string; fileName: string; mimeType: string | null } | null) => void
  handleDownloadAll: () => void
  setAddFilesModalOpen: (open: boolean) => void
  userId?: string
}

const RequestFileTable = ({
  files,
  isMobile,
  canRejectFiles,
  downloading,
  downloadingAll,
  isLoading,
  isEditing,
  resubmitMode,
  hasAdditionalFiles,
  toggleFileRejection,
  handleDownload,
  setPreviewFile,
  handleDownloadAll,
  setAddFilesModalOpen,
  userId,
}: RequestFileTableProps) => {
  // Колонки таблицы файлов
  const fileColumns: Record<string, unknown>[] = useMemo(() => {
    if (isMobile) {
      return [
        {
          title: 'Файл', dataIndex: 'fileName', key: 'fileName', ellipsis: true,
          render: (_: unknown, file: PaymentRequestFile) => (
            <span style={{ fontSize: 12, ...(file.isRejected ? { textDecoration: 'line-through', color: '#999' } : {}) }}>{file.fileName}</span>
          ),
        },
        {
          title: '', key: 'actions', width: canRejectFiles ? 100 : 64,
          render: (_: unknown, file: PaymentRequestFile) => (
            <Space size={4}>
              {canRejectFiles && (
                <Button
                  icon={file.isRejected ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                  size="small"
                  style={file.isRejected ? { color: '#52c41a', borderColor: '#52c41a' } : { color: '#ff4d4f', borderColor: '#ff4d4f' }}
                  onClick={() => userId && toggleFileRejection(file.id, userId)}
                />
              )}
              <Button icon={<EyeOutlined />} size="small" onClick={() => setPreviewFile(file)} />
              <Button icon={<DownloadOutlined />} size="small" loading={downloading === file.fileKey} onClick={() => handleDownload(file.fileKey, file.fileName)} />
            </Space>
          ),
        },
      ]
    }

    const cols: Record<string, unknown>[] = [
      { title: '№', key: 'index', width: 50, render: (_: unknown, __: PaymentRequestFile, index: number) => index + 1 },
      {
        title: 'Файл', dataIndex: 'fileName', key: 'fileName', width: hasAdditionalFiles ? '40%' : '50%', ellipsis: true,
        render: (_: unknown, file: PaymentRequestFile) => (
          <span style={file.isRejected ? { textDecoration: 'line-through', color: '#999' } : undefined}>{file.fileName}</span>
        ),
      },
      {
        title: 'Размер', key: 'fileSize', width: 100,
        render: (_: unknown, file: PaymentRequestFile) => (
          <Text type="secondary">
            {formatSize(file.fileSize)}
            {file.pageCount != null && ` · ${file.pageCount} стр.`}
          </Text>
        ),
      },
      {
        title: 'Тип документа', key: 'documentType',
        render: (_: unknown, file: PaymentRequestFile) => file.documentTypeName ? <Tag>{file.documentTypeName}</Tag> : null,
      },
      {
        title: 'Дата', key: 'createdAt', width: 140,
        render: (_: unknown, file: PaymentRequestFile) => formatDateShortWithTime(file.createdAt),
      },
    ]

    if (hasAdditionalFiles) {
      cols.push({
        title: 'Догружен', key: 'resubmit', width: 180,
        render: (_: unknown, file: PaymentRequestFile) => {
          if (!file.isAdditional && !file.isResubmit) return null
          if (file.uploaderRole === 'counterparty_user') {
            const cpName = file.uploaderCounterpartyName
            return <Tag color="blue">{cpName ? `Подрядчик (${cpName})` : 'Подрядчик'}</Tag>
          }
          if (file.uploaderRole === 'user' || file.uploaderRole === 'admin') {
            const dept = file.uploaderDepartment as Department | null
            const label = dept ? DEPARTMENT_LABELS[dept] : '—'
            return <Tag color="green">{label}</Tag>
          }
          return null
        },
      })
    }

    cols.push({
      title: '', key: 'actions', width: canRejectFiles ? 120 : 80,
      render: (_: unknown, file: PaymentRequestFile) => (
        <Space size={4}>
          {canRejectFiles && (
            <Tooltip title={file.isRejected ? 'Подтвердить' : 'Отклонить'}>
              <Button
                icon={file.isRejected ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                size="small"
                style={file.isRejected ? { color: '#52c41a', borderColor: '#52c41a' } : { color: '#ff4d4f', borderColor: '#ff4d4f' }}
                onClick={() => userId && toggleFileRejection(file.id, userId)}
              />
            </Tooltip>
          )}
          <Tooltip title="Просмотр">
            <Button icon={<EyeOutlined />} size="small" onClick={() => setPreviewFile(file)} />
          </Tooltip>
          <Tooltip title="Скачать">
            <Button icon={<DownloadOutlined />} size="small" loading={downloading === file.fileKey} onClick={() => handleDownload(file.fileKey, file.fileName)} />
          </Tooltip>
        </Space>
      ),
    })

    return cols
  }, [isMobile, canRejectFiles, hasAdditionalFiles, downloading, userId, toggleFileRejection, handleDownload, setPreviewFile])

  return (
    <Collapse
      defaultActiveKey={['files']}
      style={{ marginBottom: 12 }}
      items={[{
        key: 'files',
        label: `Файлы (${files.length})`,
        extra: (
          <Space size={4} onClick={(e) => e.stopPropagation()}>
            {!isEditing && !resubmitMode && (
              <Button size="small" icon={<PlusOutlined />} onClick={() => setAddFilesModalOpen(true)}>{isMobile ? null : 'Добавить'}</Button>
            )}
            {files.length > 0 && (
              <Button size="small" icon={<DownloadOutlined />} loading={downloadingAll} onClick={handleDownloadAll}>{isMobile ? null : 'Скачать все'}</Button>
            )}
          </Space>
        ),
        children: (
          <Table size="small" columns={fileColumns as any} dataSource={files} rowKey="id" loading={isLoading} pagination={false} locale={{ emptyText: 'Нет файлов' }} rowClassName={(record: PaymentRequestFile) => record.isRejected ? 'file-rejected-row' : ''} />
        ),
      }]}
    />
  )
}

export default RequestFileTable
