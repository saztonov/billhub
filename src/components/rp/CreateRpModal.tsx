import { useEffect, useMemo, useState } from 'react'
import { Modal, Button, List, Checkbox, Typography, Space, Empty, Spin, App } from 'antd'
import { EyeOutlined, DownloadOutlined } from '@ant-design/icons'
import FilePreviewModal from '@/components/paymentRequests/FilePreviewModal'
import { useRpStore } from '@/store/rpStore'
import { downloadFilesAsZip } from '@/utils/downloadZip'
import { formatDateShort } from '@/utils/requestFormatters'
import type { RpDocumentRef } from '@/types'

const { Text } = Typography

export interface RpCombo {
  supplierId: string
  counterpartyId: string
  siteId: string
}

interface CreateRpModalProps {
  open: boolean
  combo: RpCombo | null
  requestIds: string[]
  onClose: () => void
  onCreated: () => void
}

interface PreviewTarget {
  fileKey: string
  fileName: string
  mimeType: string | null
}

/** Модалка создания РП: выбор/просмотр/скачивание документов договора и поставщика. */
const CreateRpModal = ({ open, combo, requestIds, onClose, onCreated }: CreateRpModalProps) => {
  const { message } = App.useApp()
  const documents = useRpStore((s) => s.documents)
  const documentsLoading = useRpStore((s) => s.documentsLoading)
  const loadDocuments = useRpStore((s) => s.loadDocuments)
  const clearDocuments = useRpStore((s) => s.clearDocuments)
  const createLetter = useRpStore((s) => s.createLetter)

  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  const [downloadMode, setDownloadMode] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [downloading, setDownloading] = useState(false)
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (open && combo) {
      loadDocuments(combo.supplierId, combo.counterpartyId, combo.siteId)
      setDownloadMode(false)
      setSelectedKeys([])
    }
    if (!open) clearDocuments()
  }, [open, combo, loadDocuments, clearDocuments])

  // Все документы (для формирования состава РП и скачивания).
  const allRefs = useMemo<RpDocumentRef[]>(() => {
    if (!documents) return []
    const contract = documents.contract.map((d) => ({
      source: 'contract' as const,
      fileKey: d.fileKey,
      fileName: d.fileName,
      mimeType: d.mimeType,
      contractNumber: d.contractNumber,
      contractDate: d.contractDate,
    }))
    const founding = documents.founding.map((d) => ({
      source: 'founding' as const,
      fileKey: d.fileKey,
      fileName: d.fileName,
      mimeType: d.mimeType,
    }))
    return [...contract, ...founding]
  }, [documents])

  const toggleKey = (key: string) => {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  const handleDownload = async () => {
    const files = allRefs.filter((r) => selectedKeys.includes(r.fileKey))
    if (files.length === 0) {
      message.info('Не выбрано ни одного документа')
      return
    }
    setDownloading(true)
    try {
      const added = await downloadFilesAsZip(files, 'РП-документы')
      if (added === 0) message.error('Не удалось скачать документы')
      setDownloadMode(false)
      setSelectedKeys([])
    } finally {
      setDownloading(false)
    }
  }

  const handleDownloadAll = async () => {
    if (allRefs.length === 0) {
      message.info('Нет документов для скачивания')
      return
    }
    setDownloadingAll(true)
    try {
      const added = await downloadFilesAsZip(allRefs, 'РП-документы')
      if (added === 0) message.error('Не удалось скачать документы')
    } finally {
      setDownloadingAll(false)
    }
  }

  const handleCreate = async () => {
    if (!combo) return
    setCreating(true)
    try {
      const letter = await createLetter({
        supplierId: combo.supplierId,
        counterpartyId: combo.counterpartyId,
        siteId: combo.siteId,
        paymentRequestIds: requestIds,
        documents: allRefs,
      })
      if (letter) {
        message.success(`РП ${letter.number} создана`)
        onCreated()
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка создания РП')
    } finally {
      setCreating(false)
    }
  }

  const renderDoc = (
    key: string,
    fileName: string,
    mimeType: string | null,
    meta: string | undefined,
  ) => (
    <List.Item
      actions={[
        <Button
          key="view"
          type="text"
          icon={<EyeOutlined />}
          onClick={() => setPreview({ fileKey: key, fileName, mimeType })}
        />,
      ]}
    >
      <Space>
        {downloadMode && (
          <Checkbox checked={selectedKeys.includes(key)} onChange={() => toggleKey(key)} />
        )}
        <div>
          <div>{fileName}</div>
          {meta && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {meta}
            </Text>
          )}
        </div>
      </Space>
    </List.Item>
  )

  return (
    <>
      <Modal
        open={open}
        title="Создание РП — документы"
        width={720}
        centered
        style={{ maxHeight: '90vh' }}
        styles={{
          body: {
            height: 'calc(90vh - 110px)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          },
        }}
        onCancel={onClose}
        footer={[
          <Button key="cancel" onClick={onClose}>
            Отмена
          </Button>,
          <Button key="create" type="primary" loading={creating} onClick={handleCreate}>
            Создать РП ({requestIds.length})
          </Button>,
        ]}
      >
        <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexShrink: 0 }}>
          {!downloadMode ? (
            <>
              <Button icon={<DownloadOutlined />} onClick={() => setDownloadMode(true)}>
                Скачать
              </Button>
              <Button
                icon={<DownloadOutlined />}
                loading={downloadingAll}
                onClick={handleDownloadAll}
              >
                Скачать все
              </Button>
            </>
          ) : (
            <>
              <Button type="primary" loading={downloading} onClick={handleDownload}>
                Скачать выбранные
              </Button>
              <Button
                onClick={() => {
                  setDownloadMode(false)
                  setSelectedKeys([])
                }}
              >
                Отмена
              </Button>
            </>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {documentsLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin />
            </div>
          ) : (
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              <div>
                <Text strong>Договор</Text>
                {documents && documents.contract.length > 0 ? (
                  <List
                    size="small"
                    dataSource={documents.contract}
                    renderItem={(d) =>
                      renderDoc(
                        d.fileKey,
                        d.fileName,
                        d.mimeType,
                        [
                          d.contractNumber ? `№ ${d.contractNumber}` : null,
                          d.contractDate ? `от ${formatDateShort(d.contractDate)}` : null,
                        ]
                          .filter(Boolean)
                          .join('  '),
                      )
                    }
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет документов" />
                )}
              </div>

              <div>
                <Text strong>Документы поставщика</Text>
                {documents && documents.founding.length > 0 ? (
                  <List
                    size="small"
                    dataSource={documents.founding}
                    renderItem={(d) => renderDoc(d.fileKey, d.fileName, d.mimeType, d.typeName)}
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет документов" />
                )}
              </div>
            </Space>
          )}
        </div>
      </Modal>

      <FilePreviewModal
        open={!!preview}
        onClose={() => setPreview(null)}
        fileKey={preview?.fileKey ?? ''}
        fileName={preview?.fileName ?? ''}
        mimeType={preview?.mimeType ?? null}
      />
    </>
  )
}

export default CreateRpModal
