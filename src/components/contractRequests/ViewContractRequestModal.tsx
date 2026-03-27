import { useState, useEffect, useCallback } from 'react'
import {
  Modal,
  Descriptions,
  Tag,
  Button,
  Flex,
  Table,
  Popconfirm,
  App,
  Form,
  Select,
  Input,
  Collapse,
  Space,
  Tooltip,
} from 'antd'
import {
  FileAddOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  CheckOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '@/store/authStore'
import { useContractRequestStore } from '@/store/contractRequestStore'
import type { EditContractRequestData } from '@/store/contractRequestStore'
import { useContractCommentStore } from '@/store/contractCommentStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import { useSupplierStore } from '@/store/supplierStore'
import { downloadFileBlob } from '@/services/s3'
import { CONTRACT_SUBJECT_LABELS, REVISION_TARGET_LABELS } from '@/types'
import type { ContractRequest, ContractRequestFile, RevisionTarget } from '@/types'
import { formatSize, formatDate } from '@/utils/requestFormatters'
import useIsMobile from '@/hooks/useIsMobile'
import ContractCommentsChat from '@/components/contractRequests/ContractCommentsChat'
import ContractApprovalLog from '@/components/contractRequests/ContractApprovalLog'
import ContractRevisionModal from '@/components/contractRequests/ContractRevisionModal'
import AddContractFilesModal from '@/components/contractRequests/AddContractFilesModal'
import FilePreviewModal from '@/components/paymentRequests/FilePreviewModal'

interface ViewContractRequestModalProps {
  open: boolean
  request: ContractRequest | null
  onClose: () => void
}

/** Варианты предмета договора для Select */
const SUBJECT_OPTIONS = Object.entries(CONTRACT_SUBJECT_LABELS).map(([value, label]) => ({
  value,
  label,
}))

const ViewContractRequestModal = ({ open, request, onClose }: ViewContractRequestModalProps) => {
  const { message } = App.useApp()
  const isMobile = useIsMobile()
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'
  const isOmts = user?.department === 'omts'
  const isShtab = user?.department === 'shtab'
  const isCounterpartyUser = user?.role === 'counterparty_user'

  // Сторы
  const {
    currentRequestFiles,
    isLoading,
    isSubmitting,
    fetchRequestFiles,
    toggleFileRejection,
    approveRequest,
    sendToRevision,
    completeRevision,
    markOriginalReceived,
    deleteRequest,
    updateRequest,
  } = useContractRequestStore()

  const markAsRead = useContractCommentStore((s) => s.markAsRead)
  const { sites, fetchSites } = useConstructionSiteStore()
  const { suppliers, fetchSuppliers } = useSupplierStore()

  // Локальное состояние
  const [downloading, setDownloading] = useState<string | null>(null)
  const [addFilesModalOpen, setAddFilesModalOpen] = useState(false)
  const [revisionModalOpen, setRevisionModalOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editForm] = Form.useForm()
  const [previewFile, setPreviewFile] = useState<{
    fileKey: string
    fileName: string
    mimeType: string | null
  } | null>(null)

  // Актуальные данные заявки
  const actualRequest = request

  // Загрузка данных при открытии
  useEffect(() => {
    if (open && request) {
      fetchRequestFiles(request.id)
      // Отмечаем комментарии как прочитанные
      if (user?.id) markAsRead(user.id, request.id)
    }
  }, [open, request, fetchRequestFiles, markAsRead, user?.id])

  // Сброс состояния при закрытии
  useEffect(() => {
    if (!open) {
      setIsEditing(false)
      setAddFilesModalOpen(false)
      setRevisionModalOpen(false)
      setPreviewFile(null)
    }
  }, [open])

  // Загрузка справочников при редактировании
  useEffect(() => {
    if (isEditing) {
      if (sites.length === 0) fetchSites()
      if (suppliers.length === 0) fetchSuppliers()
    }
  }, [isEditing, sites.length, suppliers.length, fetchSites, fetchSuppliers])

  // --- Обработчики скачивания ---

  /** Скачивание одного файла */
  const handleDownload = useCallback(async (fileKey: string, fileName: string) => {
    setDownloading(fileKey)
    try {
      const blob = await downloadFileBlob(fileKey)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(null)
    }
  }, [])

  // --- Обработчики действий ---

  /** Согласование (ОМТС / admin) */
  const handleApprove = useCallback(async () => {
    if (!request || !user) return
    try {
      await approveRequest(request.id, user.id)
      message.success('Заявка согласована')
      onClose()
    } catch {
      message.error('Ошибка согласования')
    }
  }, [request, user, approveRequest, message, onClose])

  /** Отправка на доработку (ОМТС / admin) */
  const handleSendToRevision = useCallback(async (targets: RevisionTarget[]) => {
    if (!request || !user) return
    await sendToRevision(request.id, targets, user.id)
    message.success('Заявка отправлена на доработку')
    onClose()
  }, [request, user, sendToRevision, message, onClose])

  /** Завершение доработки (Штаб / Подрядчик) */
  const handleCompleteRevision = useCallback(async (target: RevisionTarget) => {
    if (!request || !user) return
    try {
      await completeRevision(request.id, target, user.id)
      message.success('Доработка завершена')
      onClose()
    } catch {
      message.error('Ошибка завершения доработки')
    }
  }, [request, user, completeRevision, message, onClose])

  /** Оригинал получен (ОМТС / admin) */
  const handleMarkOriginalReceived = useCallback(async () => {
    if (!request || !user) return
    try {
      await markOriginalReceived(request.id, user.id)
      message.success('Оригинал отмечен как полученный')
      onClose()
    } catch {
      message.error('Ошибка подтверждения оригинала')
    }
  }, [request, user, markOriginalReceived, message, onClose])

  /** Удаление заявки (admin) */
  const handleDelete = useCallback(async () => {
    if (!request) return
    try {
      await deleteRequest(request.id)
      message.success('Заявка удалена')
      onClose()
    } catch {
      message.error('Ошибка удаления заявки')
    }
  }, [request, deleteRequest, message, onClose])

  // --- Редактирование ---

  /** Начало редактирования */
  const startEditing = useCallback(() => {
    if (!actualRequest) return
    editForm.setFieldsValue({
      siteId: actualRequest.siteId,
      supplierId: actualRequest.supplierId,
      partiesCount: actualRequest.partiesCount,
      subjectType: actualRequest.subjectType,
      subjectDetail: actualRequest.subjectDetail ?? '',
    })
    setIsEditing(true)
  }, [actualRequest, editForm])

  /** Сохранение редактирования */
  const handleEditSave = useCallback(async () => {
    if (!request || !user) return
    try {
      const values = await editForm.validateFields()
      const data: EditContractRequestData = {
        siteId: values.siteId,
        supplierId: values.supplierId,
        partiesCount: values.partiesCount,
        subjectType: values.subjectType,
        subjectDetail: values.subjectDetail?.trim() || null,
      }
      await updateRequest(request.id, data, user.id)
      message.success('Заявка обновлена')
      setIsEditing(false)
    } catch {
      // Ошибки валидации формы или API
    }
  }, [request, user, editForm, updateRequest, message])

  if (!request) return null

  const req = actualRequest ?? request
  const statusCode = req.statusCode

  // --- Определение доступных действий ---

  // ОМТС или admin могут согласовать / отправить на доработку при статусе "Согласование ОМТС"
  const canOmtsActions = (isOmts || isAdmin) && statusCode === 'approv_omts'
  // ОМТС или admin могут подтвердить получение оригинала
  const canMarkOriginal = (isOmts || isAdmin) && statusCode === 'approved_waiting'
  // Штаб может завершить доработку, если в targets есть 'shtab'
  const canShtabComplete = isShtab && statusCode === 'on_revision' && (req.revisionTargets ?? []).includes('shtab')
  // Подрядчик может завершить доработку, если в targets есть 'counterparty'
  const canCounterpartyComplete = isCounterpartyUser && statusCode === 'on_revision' && (req.revisionTargets ?? []).includes('counterparty')
  // Право на отклонение/подтверждение файлов (ОМТС и admin)
  const canRejectFiles = isOmts || isAdmin
  // Право на добавление файлов (подрядчик или ОМТС/admin)
  const canAddFiles = isCounterpartyUser || isOmts || isAdmin

  // Опции для Select
  const siteOptions = sites.filter((s) => s.isActive).map((s) => ({ label: s.name, value: s.id }))
  const supplierOptions = suppliers.map((s) => ({ label: s.name, value: s.id }))

  // --- Рендер статуса с тегами доработки ---
  const renderStatus = () => (
    <Space size={4} wrap>
      <Tag color={req.statusColor ?? 'default'}>{req.statusName}</Tag>
      {statusCode === 'on_revision' && (req.revisionTargets ?? []).map((t: RevisionTarget) => (
        <Tag key={t} color="orange">{REVISION_TARGET_LABELS[t]}</Tag>
      ))}
    </Space>
  )

  // --- Колонки таблицы файлов ---
  const fileColumns = isMobile
    ? [
        {
          title: 'Файл',
          dataIndex: 'fileName',
          key: 'fileName',
          ellipsis: true,
          render: (_: unknown, file: ContractRequestFile) => (
            <span style={{ fontSize: 12, ...(file.isRejected ? { textDecoration: 'line-through', color: '#999' } : {}) }}>
              {file.fileName}
            </span>
          ),
        },
        {
          title: '',
          key: 'actions',
          width: canRejectFiles ? 100 : 64,
          render: (_: unknown, file: ContractRequestFile) => (
            <Space size={4}>
              {canRejectFiles && (
                <Button
                  icon={file.isRejected ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                  size="small"
                  style={file.isRejected ? { color: '#52c41a', borderColor: '#52c41a' } : { color: '#ff4d4f', borderColor: '#ff4d4f' }}
                  onClick={() => user && toggleFileRejection(file.id, user.id)}
                />
              )}
              <Button
                icon={<DownloadOutlined />}
                size="small"
                loading={downloading === file.fileKey}
                onClick={() => handleDownload(file.fileKey, file.fileName)}
              />
            </Space>
          ),
        },
      ]
    : (() => {
        const cols: Record<string, unknown>[] = [
          {
            title: 'No',
            key: 'index',
            width: 50,
            render: (_: unknown, __: ContractRequestFile, index: number) => index + 1,
          },
          {
            title: 'Файл',
            dataIndex: 'fileName',
            key: 'fileName',
            ellipsis: true,
            render: (_: unknown, file: ContractRequestFile) => (
              <span style={file.isRejected ? { textDecoration: 'line-through', color: '#999' } : undefined}>
                {file.fileName}
              </span>
            ),
          },
          {
            title: 'Размер',
            key: 'fileSize',
            width: 100,
            render: (_: unknown, file: ContractRequestFile) => formatSize(file.fileSize),
          },
          {
            title: 'Дата',
            key: 'createdAt',
            width: 140,
            render: (_: unknown, file: ContractRequestFile) => formatDate(file.createdAt),
          },
          {
            title: '',
            key: 'actions',
            width: canRejectFiles ? 120 : 80,
            render: (_: unknown, file: ContractRequestFile) => (
              <Space size={4}>
                {canRejectFiles && (
                  <Tooltip title={file.isRejected ? 'Подтвердить' : 'Отклонить'}>
                    <Button
                      icon={file.isRejected ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                      size="small"
                      style={file.isRejected ? { color: '#52c41a', borderColor: '#52c41a' } : { color: '#ff4d4f', borderColor: '#ff4d4f' }}
                      onClick={() => user && toggleFileRejection(file.id, user.id)}
                    />
                  </Tooltip>
                )}
                <Tooltip title="Просмотр">
                  <Button
                    icon={<EyeOutlined />}
                    size="small"
                    onClick={() => setPreviewFile({ fileKey: file.fileKey, fileName: file.fileName, mimeType: file.mimeType })}
                  />
                </Tooltip>
                <Tooltip title="Скачать">
                  <Button
                    icon={<DownloadOutlined />}
                    size="small"
                    loading={downloading === file.fileKey}
                    onClick={() => handleDownload(file.fileKey, file.fileName)}
                  />
                </Tooltip>
              </Space>
            ),
          },
        ]
        return cols
      })()

  // --- Footer с кнопками действий ---
  const footerWrap = isMobile ? { display: 'flex', flexWrap: 'wrap' as const, gap: 8 } : undefined

  let modalFooter: React.ReactNode
  if (isEditing) {
    modalFooter = (
      <Space wrap={isMobile} style={footerWrap}>
        <Button onClick={() => setIsEditing(false)}>Отмена</Button>
        <Button type="primary" loading={isSubmitting} onClick={handleEditSave}>Сохранить</Button>
      </Space>
    )
  } else {
    modalFooter = (
      <Space wrap={isMobile} style={footerWrap}>
        {/* ОМТС / admin: согласование */}
        {canOmtsActions && (
          <Popconfirm
            title="Согласование заявки"
            description="Подтвердите корректность файлов и данных"
            onConfirm={handleApprove}
            okText="Согласовать"
            cancelText="Отмена"
          >
            <Button type="primary" icon={<CheckOutlined />} loading={isSubmitting}>Согласовать</Button>
          </Popconfirm>
        )}
        {/* ОМТС / admin: на доработку */}
        {canOmtsActions && (
          <Button
            icon={<EditOutlined />}
            style={{ borderColor: '#faad14', color: '#faad14' }}
            onClick={() => setRevisionModalOpen(true)}
          >
            На доработку
          </Button>
        )}
        {/* ОМТС / admin: оригинал получен */}
        {canMarkOriginal && (
          <Popconfirm
            title="Оригинал получен?"
            description="Подтвердите получение оригинала договора"
            onConfirm={handleMarkOriginalReceived}
            okText="Подтвердить"
            cancelText="Отмена"
          >
            <Button type="primary" icon={<CheckOutlined />} loading={isSubmitting}>Оригинал получен</Button>
          </Popconfirm>
        )}
        {/* Штаб: завершение доработки */}
        {canShtabComplete && (
          <Popconfirm
            title="Завершить доработку?"
            onConfirm={() => handleCompleteRevision('shtab')}
            okText="Да"
            cancelText="Отмена"
          >
            <Button style={{ borderColor: '#52c41a', color: '#52c41a' }} icon={<CheckOutlined />} loading={isSubmitting}>
              Согласовано
            </Button>
          </Popconfirm>
        )}
        {/* Подрядчик: завершение доработки */}
        {canCounterpartyComplete && (
          <Popconfirm
            title="Подтвердить выполнение доработки?"
            onConfirm={() => handleCompleteRevision('counterparty')}
            okText="Да"
            cancelText="Отмена"
          >
            <Button style={{ borderColor: '#52c41a', color: '#52c41a' }} icon={<CheckOutlined />} loading={isSubmitting}>
              Выполнено
            </Button>
          </Popconfirm>
        )}
        {/* Admin: редактирование */}
        {isAdmin && !isEditing && (
          <Button icon={<EditOutlined />} onClick={startEditing}>Редактировать</Button>
        )}
        {/* Admin: удаление */}
        {isAdmin && (
          <Popconfirm
            title="Удалить заявку?"
            description="Заявка будет помечена как удалённая"
            onConfirm={handleDelete}
            okText="Удалить"
            cancelText="Отмена"
          >
            <Button danger icon={<DeleteOutlined />}>Удалить</Button>
          </Popconfirm>
        )}
        <Button onClick={onClose}>Закрыть</Button>
      </Space>
    )
  }

  return (
    <>
      <Modal
        title={`Заявка на договор ${req.requestNumber}`}
        open={open}
        onCancel={onClose}
        footer={modalFooter}
        width={isMobile ? '100%' : '80%'}
        centered={!isMobile}
        style={isMobile ? { top: 0, maxWidth: '100vw', margin: 0, padding: 0 } : { maxHeight: '85vh' }}
        styles={{
          body: isMobile
            ? { height: 'calc(100vh - 110px)', overflowY: 'auto', overflowX: 'hidden', padding: '12px 8px' }
            : { maxHeight: 'calc(85vh - 120px)', overflowY: 'auto', overflowX: 'hidden' },
        }}
        destroyOnClose
      >
        {/* Реквизиты заявки */}
        {isEditing ? (
          <Form form={editForm} layout="vertical" style={{ marginBottom: 16 }}>
            <Descriptions column={isMobile ? 1 : 2} size="small" bordered={false} style={{ marginBottom: 8 }}>
              <Descriptions.Item label="Номер">{req.requestNumber}</Descriptions.Item>
              <Descriptions.Item label="Подрядчик">{req.counterpartyName ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Статус">{renderStatus()}</Descriptions.Item>
              <Descriptions.Item label="Дата создания">{formatDate(req.createdAt)}</Descriptions.Item>
            </Descriptions>
            <Flex gap={8} wrap="wrap" style={{ marginBottom: 8 }}>
              <Form.Item name="siteId" label="Объект" rules={[{ required: true, message: 'Выберите объект' }]} style={{ flex: 1, minWidth: 200 }}>
                <Select placeholder="Выберите объект" showSearch optionFilterProp="label" options={siteOptions} />
              </Form.Item>
              <Form.Item name="supplierId" label="Поставщик" rules={[{ required: true, message: 'Выберите поставщика' }]} style={{ flex: 1, minWidth: 200 }}>
                <Select placeholder="Выберите поставщика" showSearch optionFilterProp="label" options={supplierOptions} />
              </Form.Item>
              <Form.Item name="partiesCount" label="Кол-во сторон" rules={[{ required: true, message: 'Укажите кол-во' }]} style={{ width: 120 }}>
                <Select options={[{ label: '2', value: 2 }, { label: '3', value: 3 }]} />
              </Form.Item>
            </Flex>
            <Flex gap={8} wrap="wrap">
              <Form.Item name="subjectType" label="Предмет договора" rules={[{ required: true, message: 'Выберите предмет' }]} style={{ flex: 1, minWidth: 200 }}>
                <Select placeholder="Выберите предмет" options={SUBJECT_OPTIONS} />
              </Form.Item>
              <Form.Item name="subjectDetail" label="Уточнение предмета" style={{ flex: 1, minWidth: 200 }}>
                <Input placeholder="Необязательное поле" allowClear />
              </Form.Item>
            </Flex>
          </Form>
        ) : (
          <Descriptions column={isMobile ? 1 : 2} size="small" bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Номер">{req.requestNumber}</Descriptions.Item>
            <Descriptions.Item label="Объект">{req.siteName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Подрядчик">{req.counterpartyName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Поставщик">{req.supplierName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Кол-во сторон">{req.partiesCount}</Descriptions.Item>
            <Descriptions.Item label="Предмет договора">
              {CONTRACT_SUBJECT_LABELS[req.subjectType] ?? req.subjectType}
            </Descriptions.Item>
            {req.subjectDetail && (
              <Descriptions.Item label="Уточнение предмета" span={2}>{req.subjectDetail}</Descriptions.Item>
            )}
            <Descriptions.Item label="Статус">{renderStatus()}</Descriptions.Item>
            <Descriptions.Item label="Дата создания">{formatDate(req.createdAt)}</Descriptions.Item>
            {req.originalReceivedAt && (
              <Descriptions.Item label="Оригинал получен">{formatDate(req.originalReceivedAt)}</Descriptions.Item>
            )}
            {req.creatorFullName && (
              <Descriptions.Item label="Автор">{req.creatorFullName}</Descriptions.Item>
            )}
          </Descriptions>
        )}

        {/* История согласования */}
        <Collapse
          defaultActiveKey={['history']}
          style={{ marginBottom: 12 }}
          items={[{
            key: 'history',
            label: 'История согласования',
            children: <ContractApprovalLog statusHistory={req.statusHistory} />,
          }]}
        />

        {/* Файлы */}
        <Collapse
          defaultActiveKey={['files']}
          style={{ marginBottom: 12 }}
          items={[{
            key: 'files',
            label: `Файлы (${currentRequestFiles.length})`,
            extra: canAddFiles ? (
              <Space size={4} onClick={(e) => e.stopPropagation()}>
                <Button
                  size="small"
                  icon={<FileAddOutlined />}
                  onClick={() => setAddFilesModalOpen(true)}
                >
                  {isMobile ? null : 'Добавить'}
                </Button>
              </Space>
            ) : null,
            children: (
              <Table
                size="small"
                columns={fileColumns as any}
                dataSource={currentRequestFiles}
                rowKey="id"
                loading={isLoading}
                pagination={false}
                locale={{ emptyText: 'Нет файлов' }}
                rowClassName={(record: ContractRequestFile) => record.isRejected ? 'file-rejected-row' : ''}
              />
            ),
          }]}
        />

        {/* Комментарии */}
        <Collapse
          defaultActiveKey={['comments']}
          style={{ marginBottom: 12 }}
          items={[{
            key: 'comments',
            label: 'Комментарии',
            children: (
              <ContractCommentsChat contractRequestId={req.id} />
            ),
          }]}
        />
      </Modal>

      {/* Модалка предпросмотра файла */}
      <FilePreviewModal
        open={!!previewFile}
        onClose={() => setPreviewFile(null)}
        fileKey={previewFile?.fileKey ?? null}
        fileName={previewFile?.fileName ?? ''}
        mimeType={previewFile?.mimeType ?? null}
      />

      {/* Модалка отправки на доработку */}
      <ContractRevisionModal
        open={revisionModalOpen}
        onClose={() => setRevisionModalOpen(false)}
        onConfirm={handleSendToRevision}
      />

      {/* Модалка добавления файлов */}
      <AddContractFilesModal
        open={addFilesModalOpen}
        onClose={() => {
          setAddFilesModalOpen(false)
          if (request) fetchRequestFiles(request.id)
        }}
        requestId={req.id}
        requestNumber={req.requestNumber}
        counterpartyName={req.counterpartyName ?? ''}
      />
    </>
  )
}

export default ViewContractRequestModal
