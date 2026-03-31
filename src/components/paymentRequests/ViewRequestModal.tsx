import { useEffect, useMemo, useState } from 'react'
import {
  Modal,
  Button,
  Typography,
  Space,
  Input,
  Form,
  App,
  Popconfirm,
  Collapse,
} from 'antd'
import {
  SendOutlined,
  EditOutlined,
  CheckOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import { usePaymentPaymentStore } from '@/store/paymentPaymentStore'
import type { EditRequestData } from '@/store/paymentRequestStore'
import { useApprovalStore } from '@/store/approvalStore'
import { useAuthStore } from '@/store/authStore'
import { usePaymentRequestSettingsStore } from '@/store/paymentRequestSettingsStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import { useSupplierStore } from '@/store/supplierStore'
import { useAssignmentStore } from '@/store/assignmentStore'
import { useOmtsRpStore } from '@/store/omtsRpStore'
import { useDocumentTypeStore } from '@/store/documentTypeStore'
import { downloadFileBlob } from '@/services/s3'
// JSZip загружается динамически при скачивании архива
import FilePreviewModal from './FilePreviewModal'
import type { FileItem } from './FileUploadList'
import DeliveryCalculation from './DeliveryCalculation'
import ApprovalLog from './ApprovalLog'
import OmtsAssignmentBlock from './OmtsAssignmentBlock'
import PaymentsTable from './PaymentsTable'
import CommentsChat from './CommentsChat'
import { useCommentStore } from '@/store/commentStore'
import RejectModal from './RejectModal'
import AddFilesModal from './AddFilesModal'
import DpFillModal from './DpFillModal'
import RequestDetailsSection from './RequestDetailsSection'
import RequestFileTable from './RequestFileTable'
import RevisionModals from './RevisionModals'
import { formatDate, extractRequestNumber, sanitizeFileName } from '@/utils/requestFormatters'
import { notifyRequestRevision } from '@/utils/notificationService'
import useIsMobile from '@/hooks/useIsMobile'
import type { PaymentRequest } from '@/types'

const { Text } = Typography
const { TextArea } = Input

interface ViewRequestModalProps {
  open: boolean
  request: PaymentRequest | null
  onClose: () => void
  resubmitMode?: boolean
  onResubmit?: (comment: string, files: FileItem[], fieldUpdates: {
    deliveryDays: number
    deliveryDaysType: string
    shippingConditionId: string
    invoiceAmount: number
  }) => void
  canEdit?: boolean
  onEdit?: (id: string, data: EditRequestData, files: FileItem[]) => void
  canApprove?: boolean
  onApprove?: (requestId: string, comment: string) => void
  onReject?: (requestId: string, comment: string, files?: { id: string; file: File }[]) => void
  onRevisionComplete?: () => void
}

const ViewRequestModal = ({ open, request, onClose, resubmitMode, onResubmit, canEdit, onEdit, canApprove, onApprove, onReject, onRevisionComplete }: ViewRequestModalProps) => {
  const { message } = App.useApp()
  const isMobile = useIsMobile()
  const { requests, currentRequestFiles, fetchRequestFiles, fetchRequests, isLoading, isSubmitting, toggleFileRejection } = usePaymentRequestStore()
  const { payments, fetchPayments } = usePaymentPaymentStore()
  const { currentDecisions, currentLogs, fetchDecisions, fetchLogs, clearCurrentData, sendToRevision, completeRevision } = useApprovalStore()
  const omtsRpResponsibleUserId = useOmtsRpStore((s) => s.responsibleUserId)
  const fetchOmtsRpConfig = useOmtsRpStore((s) => s.fetchConfig)
  const fetchOmtsRpSites = useOmtsRpStore((s) => s.fetchSites)
  const user = useAuthStore((s) => s.user)
  const isCounterpartyUser = user?.role === 'counterparty_user'
  const {
    currentAssignment,
    assignmentHistory,
    omtsUsers,
    fetchCurrentAssignment,
    fetchAssignmentHistory,
    fetchOmtsUsers,
    assignResponsible,
  } = useAssignmentStore()
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [previewFile, setPreviewFile] = useState<{ fileKey: string; fileName: string; mimeType: string | null } | null>(null)
  const [resubmitComment, setResubmitComment] = useState('')

  // Модалка отклонения
  const [rejectModalOpen, setRejectModalOpen] = useState(false)
  // Комментарий для "На доработку"
  const [revisionComment, setRevisionComment] = useState('')
  const [revisionModalOpen, setRevisionModalOpen] = useState(false)
  const [revisionCompleteModalOpen, setRevisionCompleteModalOpen] = useState(false)
  const [addFilesModalOpen, setAddFilesModalOpen] = useState(false)
  const [dpModalOpen, setDpModalOpen] = useState(false)

  // Режим редактирования
  const [isEditing, setIsEditing] = useState(false)
  const [editForm] = Form.useForm()
  const [editFileList, setEditFileList] = useState<FileItem[]>([])
  const [showEditFileValidation, setShowEditFileValidation] = useState(false)
  const [resubmitForm] = Form.useForm()
  const [revisionCompleteForm] = Form.useForm()
  const { fieldOptions, fetchFieldOptions, getOptionsByField } = usePaymentRequestSettingsStore()
  const { sites, fetchSites } = useConstructionSiteStore()
  const { suppliers, fetchSuppliers } = useSupplierStore()
  const { fetchDocumentTypes } = useDocumentTypeStore()
  const markAsRead = useCommentStore((s) => s.markAsRead)

  useEffect(() => {
    if (open && request) {
      clearCurrentData()
      fetchRequestFiles(request.id)
      fetchPayments(request.id)
      fetchDecisions(request.id)
      fetchLogs(request.id)
      fetchCurrentAssignment(request.id)
      fetchAssignmentHistory(request.id)
      fetchDocumentTypes()
      if (user?.role === 'admin') fetchOmtsUsers()
      if (user?.role !== 'counterparty_user') {
        fetchOmtsRpConfig()
        fetchOmtsRpSites()
      }
      // Отмечаем комментарии как прочитанные
      if (user?.id) markAsRead(user.id, request.id)
    }
  }, [open, request, fetchRequestFiles, fetchPayments, fetchDecisions, fetchLogs, clearCurrentData, fetchCurrentAssignment, fetchAssignmentHistory, fetchDocumentTypes, fetchOmtsUsers, user?.role, fetchOmtsRpConfig, fetchOmtsRpSites, markAsRead, user?.id])

  useEffect(() => {
    if (!open) {
      setResubmitComment('')
      try { if (resubmitMode) resubmitForm.resetFields() } catch { /* форма не подключена к DOM */ }
      setIsEditing(false)
      setEditFileList([])
      setShowEditFileValidation(false)
      setRejectModalOpen(false)
      setRevisionComment('')
      setRevisionModalOpen(false)
      setAddFilesModalOpen(false)
      setDpModalOpen(false)
    }
  }, [open, resubmitForm])

  useEffect(() => {
    if (isEditing || resubmitMode || revisionCompleteModalOpen) {
      if (fieldOptions.length === 0) fetchFieldOptions()
      if (sites.length === 0) fetchSites()
      if (suppliers.length === 0) fetchSuppliers()
    }
  }, [isEditing, resubmitMode, revisionCompleteModalOpen, fieldOptions.length, sites.length, suppliers.length, fetchFieldOptions, fetchSites, fetchSuppliers])

  // Сумма оплат и права на управление оплатами
  const paymentsTotalPaid = useMemo(() => payments.filter(p => p.isExecuted).reduce((sum, p) => sum + p.amount, 0), [payments])
  const canManagePayments = user?.role === 'admin' || user?.department === 'shtab' || user?.department === 'omts'

  // Актуальные данные заявки из store (для обновления после сохранения РП)
  const actualRequest = useMemo(() => {
    if (!request) return null
    return requests.find((r) => r.id === request.id) ?? request
  }, [request, requests])

  const shippingOptions = getOptionsByField('shipping_conditions')
  const siteOptions = sites.filter((s) => s.isActive).map((s) => ({ label: s.name, value: s.id }))
  const supplierOptions = suppliers.map((s) => ({ label: s.name, value: s.id }))

  const startEditing = () => {
    if (!request) return
    editForm.setFieldsValue({
      siteId: request.siteId,
      supplierId: request.supplierId ?? undefined,
      deliveryDays: request.deliveryDays,
      deliveryDaysType: request.deliveryDaysType,
      shippingConditionId: request.shippingConditionId,
      comment: request.comment ?? '',
      invoiceAmount: request.invoiceAmount != null
        ? (() => {
            const parts = String(request.invoiceAmount).split('.')
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
            return parts.join('.')
          })()
        : undefined,
    })
    setIsEditing(true)
  }

  const handleEditSave = async () => {
    if (!request || !onEdit) return
    try {
      const values = await editForm.validateFields()
      if (editFileList.length > 0) {
        const filesWithoutType = editFileList.filter((f) => !f.documentTypeId)
        if (filesWithoutType.length > 0) {
          setShowEditFileValidation(true)
          message.error('Укажите тип для каждого файла')
          return
        }
      }
      const parsedValues = {
        ...values,
        invoiceAmount: values.invoiceAmount
          ? Number(String(values.invoiceAmount).replace(/\s/g, ''))
          : values.invoiceAmount,
      }
      onEdit(request.id, parsedValues as EditRequestData, editFileList)
      setIsEditing(false)
      setEditFileList([])
      setShowEditFileValidation(false)
    } catch {
      // Ошибки валидации формы
    }
  }

  const handleDownloadAll = async () => {
    if (!currentRequestFiles.length || !request) return
    setDownloadingAll(true)
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const results = await Promise.allSettled(
        currentRequestFiles.map(async (file) => {
          const blob = await downloadFileBlob(file.fileKey)
          zip.file(sanitizeFileName(file.fileName), blob)
        }),
      )
      const failed = results.filter((r) => r.status === 'rejected').length
      if (failed === currentRequestFiles.length) return
      const content = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(content)
      const a = document.createElement('a')
      a.href = url
      a.download = `${extractRequestNumber(request.requestNumber)}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloadingAll(false)
    }
  }

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
    } finally {
      setDownloading(null)
    }
  }

  const handleViewDecisionFile = (fileKey: string, fileName: string, mimeType: string | null) => {
    setPreviewFile({ fileKey, fileName, mimeType })
  }

  const handleDownloadDecisionFile = async (fileKey: string, fileName: string) => {
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
  }

  const sortedFiles = useMemo(() => {
    return [...currentRequestFiles].sort((a, b) => {
      // Сортировка по дате от новых к старым
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
  }, [currentRequestFiles])

  // Собираем файлы из решений (прикреплённые при отклонении)
  const decisionFiles = useMemo(() => {
    return currentDecisions.flatMap(d => d.files ?? [])
  }, [currentDecisions])

  const hasAdditionalFiles = sortedFiles.some((f) => f.isAdditional || f.isResubmit)

  const handleResubmitSubmit = async () => {
    let formValues: { deliveryDays: number; deliveryDaysType: string; shippingConditionId: string; invoiceAmount: number }
    try {
      formValues = await resubmitForm.validateFields()
    } catch (err: unknown) {
      const valErr = err as { errorFields?: { errors: string[] }[] }
      if (valErr.errorFields) {
        const msgs = valErr.errorFields.flatMap((f) => f.errors)
        message.error(msgs.join('. '))
      }
      return
    }
    onResubmit?.(resubmitComment, [], {
      ...formValues,
      invoiceAmount: Number(String(formValues.invoiceAmount).replace(/\s/g, '')),
    })
  }

  if (!request) return null

  // Согласованная заявка (не на доработке)
  const isApprovedRequest = !!request.approvedAt && !request.previousStatusId
  // Разрешение на отклонение файлов: согласующие ИЛИ редактирование согласованной заявки
  const canRejectFiles = canApprove || (isEditing && isApprovedRequest)

  // Проверяем, может ли текущий пользователь отправить на доработку (ОМТС, ОМТС РП, admin)
  const isAdmin = user?.role === 'admin'
  const isOmtsUser = user?.department === 'omts'
  const isOmtsRpResponsible = user?.id === omtsRpResponsibleUserId
  const hasPendingOmtsOrOmtsRpDecision = currentDecisions.some(
    (d) => d.status === 'pending' && (d.department === 'omts' || d.isOmtsRp)
  )
  const canSendToRevision = ((isAdmin || isOmtsUser || isOmtsRpResponsible) && hasPendingOmtsOrOmtsRpDecision)
    || (!!canEdit && isApprovedRequest)

  // Заявка в статусе "На доработку" (previous_status_id заполнен)
  const isRevisionStatus = !!request.previousStatusId

  const handleSendToRevision = async () => {
    if (!request) return
    try {
      await sendToRevision(request.id, revisionComment)
      if (user?.id) {
        notifyRequestRevision(request.id, user.id)
      }
      message.success('Заявка отправлена на доработку')
      setRevisionModalOpen(false)
      setRevisionComment('')
      onRevisionComplete?.()
      onClose()
    } catch {
      message.error('Ошибка отправки на доработку')
    }
  }

  const handleCompleteRevision = async (values: {
    deliveryDays: number
    deliveryDaysType: string
    shippingConditionId: string
    invoiceAmount: number
  }) => {
    if (!request) return
    try {
      await completeRevision(request.id, values)
      message.success('Доработка завершена')
      setRevisionCompleteModalOpen(false)
      onRevisionComplete?.()
      onClose()
    } catch {
      message.error('Ошибка завершения доработки')
    }
  }

  // Footer
  const footerWrap = isMobile ? { display: 'flex', flexWrap: 'wrap' as const, gap: 8 } : undefined
  let modalFooter: React.ReactNode
  if (resubmitMode) {
    modalFooter = (
      <Space wrap={isMobile} style={footerWrap}>
        <Button onClick={onClose}>Отмена</Button>
        <Button type="primary" icon={<SendOutlined />} loading={isSubmitting} onClick={handleResubmitSubmit}>Отправить повторно</Button>
      </Space>
    )
  } else if (isEditing) {
    modalFooter = (
      <Space wrap={isMobile} style={footerWrap}>
        <Button onClick={() => { setIsEditing(false); setEditFileList([]) }}>Отмена</Button>
        <Button type="primary" loading={isSubmitting} onClick={handleEditSave}>Сохранить</Button>
      </Space>
    )
  } else {
    modalFooter = (
      <Space wrap={isMobile} style={footerWrap}>
        {isRevisionStatus && isAdmin && <Button style={{ borderColor: '#52c41a', color: '#52c41a' }} icon={<CheckOutlined />} onClick={() => setRevisionCompleteModalOpen(true)}>Доработано</Button>}
        {canSendToRevision && <Button icon={<EditOutlined />} style={{ borderColor: '#faad14', color: '#faad14' }} onClick={() => setRevisionModalOpen(true)}>На доработку</Button>}
        {canEdit && !isCounterpartyUser && <Button icon={<EditOutlined />} onClick={startEditing}>Редактировать</Button>}
        {canApprove && (
          <Popconfirm title="Согласование заявки" description="Подтвердите корректность всех файлов и условий" onConfirm={() => onApprove?.(request.id, '')} okText="Согласовать" cancelText="Отмена">
            <Button type="primary" icon={<CheckOutlined />}>Согласовать</Button>
          </Popconfirm>
        )}
        {canApprove && <Button danger icon={<StopOutlined />} onClick={() => setRejectModalOpen(true)}>Отклонить</Button>}
        {isRevisionStatus && isCounterpartyUser && <Button style={{ borderColor: '#52c41a', color: '#52c41a' }} icon={<CheckOutlined />} onClick={() => setRevisionCompleteModalOpen(true)}>Доработано</Button>}
        <Button onClick={onClose}>Закрыть</Button>
      </Space>
    )
  }

  return (
    <>
      <Modal
        title={resubmitMode
          ? (isMobile ? `Повторная — ${extractRequestNumber(request.requestNumber)}` : `Повторная отправка — Заявка ${extractRequestNumber(request.requestNumber)}`)
          : `Заявка ${extractRequestNumber(request.requestNumber)}`}
        open={open}
        onCancel={onClose}
        footer={modalFooter}
        width={isMobile ? '100%' : '80%'}
        mask={{ closable: false }}
        centered={!isMobile}
        style={isMobile ? { top: 0, maxWidth: '100vw', margin: 0, padding: 0 } : { maxHeight: '85vh' }}
        styles={{
          body: isMobile
            ? { height: 'calc(100vh - 110px)', overflowY: 'auto', overflowX: 'hidden', padding: '12px 8px' }
            : { maxHeight: 'calc(85vh - 120px)', overflowY: 'auto', overflowX: 'hidden' },
        }}
      >
        {/* Реквизиты */}
        <RequestDetailsSection
          request={request}
          actualRequest={actualRequest ?? request}
          isEditing={isEditing}
          resubmitMode={resubmitMode}
          isCounterpartyUser={!!isCounterpartyUser}
          isMobile={isMobile}
          editForm={editForm}
          resubmitForm={resubmitForm}
          editFileList={editFileList}
          setEditFileList={setEditFileList}
          showEditFileValidation={showEditFileValidation}
          siteOptions={siteOptions}
          supplierOptions={supplierOptions}
          shippingOptions={shippingOptions}
          currentAssignment={currentAssignment}
          paymentsTotalPaid={paymentsTotalPaid}
          setPreviewFile={setPreviewFile}
          downloading={downloading}
          handleDownload={handleDownload}
          setDpModalOpen={setDpModalOpen}
          fetchRequests={fetchRequests}
        />

        {!isEditing && !resubmitMode && (
          <DeliveryCalculation deliveryDays={request.deliveryDays} deliveryDaysType={request.deliveryDaysType as 'working' | 'calendar'} shippingConditionId={request.shippingConditionId} defaultExpanded={false} />
        )}

        {!isEditing && (user?.department === 'omts' || user?.role === 'admin') && (
          <OmtsAssignmentBlock
            request={request}
            isAdmin={user?.role === 'admin'}
            userId={user?.id}
            currentAssignment={currentAssignment}
            assignmentHistory={assignmentHistory}
            omtsUsers={omtsUsers}
            assignResponsible={assignResponsible}
          />
        )}

        {request.invoiceAmountHistory && request.invoiceAmountHistory.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>История сумм</Text>
            {request.invoiceAmountHistory.map((entry, idx) => (
              <div key={idx} style={{ marginBottom: 4 }}>
                <Text type="secondary">
                  Сумма {idx + 1}-й заявки: {entry.amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽
                  {' '}({formatDate(entry.changedAt, false)})
                </Text>
              </div>
            ))}
          </div>
        )}

        <Collapse
          defaultActiveKey={['approval']}
          style={{ marginBottom: 12 }}
          items={[{
            key: 'approval',
            label: 'Согласование',
            children: (
              <ApprovalLog
                request={request}
                decisions={currentDecisions}
                logs={currentLogs}
                isCounterpartyUser={!!isCounterpartyUser}
              />
            ),
          }]}
        />

        {/* Таблица файлов */}
        <RequestFileTable
          files={sortedFiles}
          decisionFiles={decisionFiles}
          isMobile={isMobile}
          canRejectFiles={!!canRejectFiles}
          downloading={downloading}
          downloadingAll={downloadingAll}
          isLoading={isLoading}
          isEditing={isEditing}
          hasAdditionalFiles={hasAdditionalFiles}
          toggleFileRejection={toggleFileRejection}
          handleDownload={handleDownload}
          setPreviewFile={setPreviewFile}
          handleDownloadAll={handleDownloadAll}
          setAddFilesModalOpen={setAddFilesModalOpen}
          onViewDecisionFile={handleViewDecisionFile}
          onDownloadDecisionFile={handleDownloadDecisionFile}
          userId={user?.id}
        />

        {!isEditing && !resubmitMode && request && (
          <Collapse
            defaultActiveKey={['payments']}
            style={{ marginBottom: 12 }}
            items={[{
              key: 'payments',
              label: 'Оплаты',
              children: (
                <PaymentsTable
                  paymentRequestId={request.id}
                  counterpartyName={request.counterpartyName ?? ''}
                  canManage={!!canManagePayments}
                  onTotalChanged={() => fetchRequests()}
                />
              ),
            }]}
          />
        )}

        {request && (
          <Collapse
            defaultActiveKey={['comments']}
            style={{ marginBottom: 12 }}
            items={[{
              key: 'comments',
              label: 'Комментарии',
              children: (
                <CommentsChat paymentRequestId={request.id} />
              ),
            }]}
          />
        )}

        {resubmitMode && (
          <div style={{ marginTop: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>Комментарий к повторной отправке</Text>
            <TextArea rows={3} placeholder="Необязательное поле" value={resubmitComment} onChange={(e) => setResubmitComment(e.target.value)} />
          </div>
        )}
      </Modal>

      <FilePreviewModal open={!!previewFile} onClose={() => setPreviewFile(null)} fileKey={previewFile?.fileKey ?? null} fileName={previewFile?.fileName ?? ''} mimeType={previewFile?.mimeType ?? null} />

      <AddFilesModal
        open={addFilesModalOpen}
        onClose={() => { setAddFilesModalOpen(false); if (request) fetchRequestFiles(request.id) }}
        requestId={request.id}
        requestNumber={request.requestNumber}
        counterpartyName={request.counterpartyName ?? ''}
        isResubmit={resubmitMode}
      />

      <DpFillModal
        open={dpModalOpen}
        onClose={() => { setDpModalOpen(false); fetchRequests() }}
        requestId={request.id}
        requestNumber={request.requestNumber}
        counterpartyName={request.counterpartyName ?? ''}
        initialData={actualRequest?.dpNumber ? {
          dpNumber: actualRequest.dpNumber,
          dpDate: actualRequest.dpDate!,
          dpAmount: actualRequest.dpAmount!,
          dpFileKey: actualRequest.dpFileKey!,
          dpFileName: actualRequest.dpFileName!,
        } : null}
      />

      <RejectModal
        open={rejectModalOpen}
        onConfirm={(comment, files) => {
          onReject?.(request.id, comment, files.length > 0 ? files : undefined)
          setRejectModalOpen(false)
        }}
        onCancel={() => setRejectModalOpen(false)}
      />

      {/* Модалки доработки */}
      <RevisionModals
        request={request}
        revisionModalOpen={revisionModalOpen}
        revisionComment={revisionComment}
        setRevisionComment={setRevisionComment}
        handleSendToRevision={handleSendToRevision}
        setRevisionModalOpen={setRevisionModalOpen}
        onRevisionCommentRequired={() => message.warning('Укажите комментарий')}
        revisionCompleteModalOpen={revisionCompleteModalOpen}
        revisionCompleteForm={revisionCompleteForm}
        handleCompleteRevision={handleCompleteRevision}
        setRevisionCompleteModalOpen={setRevisionCompleteModalOpen}
        shippingOptions={shippingOptions}
      />
    </>
  )
}

export default ViewRequestModal
