import { useEffect, useState } from 'react'
import { Modal, List, Button, Typography, Tag, Space, Empty, Spin, Popconfirm, App } from 'antd'
import {
  PlusOutlined,
  EyeOutlined,
  DownloadOutlined,
  DeleteOutlined,
  PaperClipOutlined,
} from '@ant-design/icons'
import { useRpStore } from '@/store/rpStore'
import { downloadFileBlob, uploadRpServiceFile } from '@/services/s3'
import { logError } from '@/services/errorLogger'
import { getMimeFromFileName } from '@/utils/mimeFromExtension'
import FilePreviewModal from '@/components/paymentRequests/FilePreviewModal'
import RpFilesDropModal, { type RpDropFile } from '@/components/rp/RpFilesDropModal'
import type { RpLetter, RpFilesResult } from '@/types'

const { Text } = Typography

interface RpFilesModalProps {
  open: boolean
  letter: RpLetter | null
  /** Управление файлами (admin / назначенец РП); при false — только просмотр/скачивание. */
  canManage: boolean
  onClose: () => void
}

interface PreviewTarget {
  fileKey: string
  fileName: string
  mimeType: string | null
}

const fmtSize = (bytes: number | null) =>
  bytes != null ? `${(bytes / (1024 * 1024)).toFixed(1)} МБ` : ''

/**
 * Модалка «Файлы РП»: список вложений письма PayHub (просмотр/скачивание) и отдельный
 * список служебных файлов РП (загрузка/просмотр/скачивание/удаление). Предпросмотр — в модалке.
 * При canManage=false — read-only: без загрузки и удаления служебных файлов.
 */
const RpFilesModal = ({ open, letter, canManage, onClose }: RpFilesModalProps) => {
  const { message } = App.useApp()
  const loadRpFiles = useRpStore((s) => s.loadRpFiles)
  const registerServiceFiles = useRpStore((s) => s.registerServiceFiles)
  const deleteServiceFile = useRpStore((s) => s.deleteServiceFile)

  const [files, setFiles] = useState<RpFilesResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  const [dropOpen, setDropOpen] = useState(false)

  const reload = async (id: string) => {
    setLoading(true)
    try {
      setFiles(await loadRpFiles(id))
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: err instanceof Error ? err.message : 'Ошибка загрузки файлов РП',
        component: 'RpFilesModal',
      })
      setFiles({ payhub: [], service: [] })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open || !letter) return
    setPreview(null)
    void reload(letter.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, letter])

  const handleDownload = async (fileKey: string, fileName: string) => {
    setDownloading(fileKey)
    try {
      const blob = await downloadFileBlob(fileKey)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка скачивания файла')
    } finally {
      setDownloading(null)
    }
  }

  // Загрузка отобранных в площадке служебных файлов: каждый файл грузим в S3 и сразу
  // регистрируем — при сбое на следующем уже загруженные не осиротеют (они зарегистрированы).
  // Бросок ошибки оставляет площадку открытой (её handleOk ловит его молча).
  const handleDropSubmit = async (dropped: RpDropFile[]) => {
    if (!letter || dropped.length === 0) return
    try {
      for (const d of dropped) {
        const { key } = await uploadRpServiceFile(letter.id, d.file)
        await registerServiceFiles(letter.id, [
          {
            fileKey: key,
            fileName: d.file.name,
            mimeType: d.file.type || null,
            sizeBytes: d.file.size,
          },
        ])
      }
      await reload(letter.id)
      message.success('Служебные файлы загружены')
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка загрузки служебных файлов')
      await reload(letter.id)
      throw err
    }
  }

  const handleDelete = async (fileId: string) => {
    if (!letter) return
    try {
      await deleteServiceFile(letter.id, fileId)
      await reload(letter.id)
      message.success('Файл удалён')
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка удаления файла')
    }
  }

  const previewBtn = (fileKey: string, fileName: string, mimeType: string | null) => (
    <Button
      key="view"
      type="text"
      size="small"
      icon={<EyeOutlined />}
      title="Просмотр"
      onClick={() =>
        setPreview({ fileKey, fileName, mimeType: mimeType ?? getMimeFromFileName(fileName) })
      }
    />
  )

  const downloadBtn = (fileKey: string, fileName: string) => (
    <Button
      key="dl"
      type="text"
      size="small"
      icon={<DownloadOutlined />}
      title="Скачать"
      loading={downloading === fileKey}
      onClick={() => handleDownload(fileKey, fileName)}
    />
  )

  return (
    <Modal
      open={open}
      title={`Файлы РП${letter?.payhubLetterRegNumber ? ` — ${letter.payhubLetterRegNumber}` : ''}`}
      width={680}
      centered
      onCancel={onClose}
      footer={<Button onClick={onClose}>Закрыть</Button>}
      styles={{ body: { maxHeight: 'calc(90vh - 110px)', overflowY: 'auto' } }}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : (
        <>
          <Text strong>Файлы письма PayHub</Text>
          {files && files.payhub.length > 0 ? (
            <List
              size="small"
              dataSource={files.payhub}
              renderItem={(f) => (
                <List.Item
                  actions={[
                    previewBtn(f.fileKey, f.fileName, f.mimeType),
                    downloadBtn(f.fileKey, f.fileName),
                  ]}
                >
                  <PaperClipOutlined />
                  <Text style={{ marginLeft: 8 }} ellipsis>
                    {f.fileName}
                  </Text>
                  {f.fileType === 'rp' && (
                    <Tag color="blue" style={{ marginLeft: 8, flexShrink: 0 }}>
                      РП
                    </Tag>
                  )}
                  <Text type="secondary" style={{ marginLeft: 8, flexShrink: 0 }}>
                    {fmtSize(f.sizeBytes)}
                  </Text>
                </List.Item>
              )}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет файлов письма" />
          )}

          <div style={{ display: 'flex', alignItems: 'center', marginTop: 16, marginBottom: 4 }}>
            <Text strong>Служебные файлы</Text>
            {canManage && (
              <Space style={{ marginLeft: 'auto' }}>
                <Button size="small" icon={<PlusOutlined />} onClick={() => setDropOpen(true)}>
                  Добавить
                </Button>
              </Space>
            )}
          </div>

          {files && files.service.length > 0 ? (
            <List
              size="small"
              dataSource={files.service}
              renderItem={(f) => (
                <List.Item
                  actions={[
                    previewBtn(f.fileKey, f.fileName, f.mimeType),
                    downloadBtn(f.fileKey, f.fileName),
                    ...(canManage
                      ? [
                          <Popconfirm
                            key="del"
                            title="Удалить файл из РП?"
                            okText="Удалить"
                            okButtonProps={{ danger: true }}
                            cancelText="Отмена"
                            onConfirm={() => handleDelete(f.id)}
                          >
                            <Button
                              type="text"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              title="Удалить"
                            />
                          </Popconfirm>,
                        ]
                      : []),
                  ]}
                >
                  <PaperClipOutlined />
                  <Text style={{ marginLeft: 8 }} ellipsis>
                    {f.fileName}
                  </Text>
                  <Text type="secondary" style={{ marginLeft: 8, flexShrink: 0 }}>
                    {fmtSize(f.sizeBytes)}
                  </Text>
                </List.Item>
              )}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет служебных файлов" />
          )}
        </>
      )}

      <FilePreviewModal
        open={!!preview}
        onClose={() => setPreview(null)}
        fileKey={preview?.fileKey ?? null}
        fileName={preview?.fileName ?? ''}
        mimeType={preview?.mimeType ?? null}
      />

      {canManage && (
        <RpFilesDropModal
          open={dropOpen}
          title="Добавить служебные файлы"
          onClose={() => setDropOpen(false)}
          onSubmit={handleDropSubmit}
        />
      )}
    </Modal>
  )
}

export default RpFilesModal
