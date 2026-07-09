// Общие утилитарные типы

/** Универсальный ответ API */
export interface ApiResponse<T> {
  data: T | null
  error: string | null
}

/** Параметры пагинации */
export interface PaginationParams {
  page: number
  pageSize: number
}

/** Параметры сортировки (совместимо с Ant Design Table) */
export interface SortParams {
  field: string
  order: 'ascend' | 'descend'
}

// Справочники

/** Контрагент (подрядчик) */
export interface Counterparty {
  id: string
  name: string
  inn: string
  address: string
  alternativeNames: string[]
  registrationToken: string | null
  isActive?: boolean
  createdAt: string
}

/** Тип события проверки поставщика отделом СБ */
export type SecurityCheckEventType = 'requested' | 'approved' | 'rejected'

/** Событие проверки поставщика (запрос или решение) */
export interface SupplierSecurityCheck {
  id: string
  supplierId: string
  authorId: string
  authorFullName: string
  eventType: SecurityCheckEventType
  comment: string | null
  createdAt: string
}

/** Поставщик */
export interface Supplier {
  id: string
  name: string
  inn: string
  alternativeNames: string[]
  createdAt: string
  // Агрегаты по проверке отделом СБ
  lastSecurityCheck?: { status: 'approved' | 'rejected'; createdAt: string } | null
  hasPendingRequest?: boolean
  // Денормализованный статус последнего решения СБ (из suppliers.last_security_status)
  lastSecurityStatus?: 'approved' | 'rejected' | null
}

/** Строка импорта поставщика */
export interface ImportSupplierRow {
  name: string
  inn: string
}

/** Роль сотрудника в системе */
export type EmployeeRole = 'admin' | 'user'

/** Сотрудник */
export interface Employee {
  id: string
  fullName: string
  position: string
  department: string
  email: string
  phone: string
  role: EmployeeRole
  isActive: boolean
  createdAt: string
}

/** Объект строительства */
export interface ConstructionSite {
  id: string
  name: string
  isActive: boolean
  createdAt: string
  // Сопоставление с PayHub: канонический внешний ID + снимок для отображения.
  // Отсутствуют для роли counterparty_user (API их не отдаёт).
  payhubProjectId?: number | null
  payhubProjectCode?: string | null
  payhubProjectName?: string | null
  payhubContractorId?: string | null
  payhubContractorName?: string | null
  payhubContractorInn?: string | null
}

/** Подразделение (enum) */
export type Department = 'omts' | 'shtab' | 'smetny'

/** Маппинг enum → название для UI */
export const DEPARTMENT_LABELS: Record<Department, string> = {
  omts: 'ОМТС',
  shtab: 'Штаб',
  smetny: 'Сметный',
}

/** Департамент этапа согласования: отдел пользователя либо 'rp' (этап «РП», stage 3) */
export type ApprovalDepartment = Department | 'rp'

/** Подписи департаментов этапов согласования (включая этап «РП») */
export const STAGE_DEPARTMENT_LABELS: Record<ApprovalDepartment, string> = {
  ...DEPARTMENT_LABELS,
  rp: 'РП',
}

/** Подписи этапов цепочки согласования по номеру стадии */
export const STAGE_LABELS: Record<number, string> = {
  1: 'Штаб',
  2: 'ОМТС',
  3: 'РП',
}

/** Категория типа документа */
export type DocumentTypeCategory = 'operational' | 'founding'

/** Тип документа */
export interface DocumentType {
  id: string
  name: string
  category: DocumentTypeCategory
  createdAt: string
}

/** Строка таблицы учредительных документов поставщика */
export interface FoundingDocumentRow {
  typeId: string
  typeName: string
  docId: string | null
  isAvailable: boolean
  checkedByName: string | null
  checkedAt: string | null
  comment: string
  fileCount: number
}

/** Файл учредительного документа */
export interface FoundingDocumentFile {
  id: string
  fileName: string
  fileKey: string
  fileSize: number | null
  mimeType: string | null
  comment: string
  createdBy: string
  createdByName: string | null
  createdAt: string
}

/** Обязательный документ объекта (маппинг DocumentType <-> ConstructionSite) */
export interface SiteRequiredDocument {
  id: string
  siteId: string
  documentTypeId: string
  createdAt: string
  siteName?: string
  documentTypeName?: string
}

// Универсальные статусы

/** Статус (универсальная таблица для всех документов) */
export interface Status {
  id: string
  entityType: string
  code: string
  name: string
  color: string | null
  isActive: boolean
  displayOrder: number
  visibleRoles: string[]
  createdAt: string
}

// Заявки на оплату

/** Опция dropdown-поля заявки (справочник) */
export interface PaymentRequestFieldOption {
  id: string
  fieldCode: string
  value: string
  isActive: boolean
  displayOrder: number
  createdAt: string
}

/** Запись в хронологии этапов согласования */
export interface StageHistoryEntry {
  stage: number
  department: string
  event: 'received' | 'approved' | 'rejected' | 'revision' | 'revision_complete'
  at: string
  userEmail?: string
  userFullName?: string
  comment?: string
  isOmtsRp?: boolean
}

/** Тип заявки на оплату (0012) */
export type PaymentRequestType = 'contractor' | 'contractor_work' | 'own_purchase'

/** Подписи типов заявок */
export const PAYMENT_REQUEST_TYPE_LABELS: Record<PaymentRequestType, string> = {
  contractor: 'Подрядчик',
  contractor_work: 'Подрядчик Работа',
  own_purchase: 'Своя закупка',
}

/** Короткие подписи типов заявок для бейджа в реестре (только admin/user) */
export const PAYMENT_REQUEST_TYPE_BADGE_LABELS: Record<PaymentRequestType, string> = {
  contractor: 'мат. подряд',
  contractor_work: 'СМР',
  own_purchase: 'собств.закуп',
}

/** Полные подписи типов заявок для шапки модалки просмотра (только admin/user) */
export const PAYMENT_REQUEST_TYPE_FULL_LABELS: Record<PaymentRequestType, string> = {
  contractor: 'Материалы подрядчика',
  contractor_work: 'СМР подрядчика',
  own_purchase: 'Своя закупка материалов',
}

/** Цвета бейджа типа заявки (Ant Design Tag) */
export const PAYMENT_REQUEST_TYPE_BADGE_COLORS: Record<PaymentRequestType, string> = {
  contractor: 'blue',
  contractor_work: 'purple',
  own_purchase: 'green',
}

/** Заявка на оплату */
export interface PaymentRequest {
  id: string
  requestNumber: string
  requestType: PaymentRequestType
  counterpartyId: string
  siteId: string
  statusId: string
  deliveryDays: number | null
  deliveryDaysType: string
  shippingConditionId: string | null
  comment: string | null
  createdBy: string
  totalFiles: number
  uploadedFiles: number
  createdAt: string
  withdrawnAt: string | null
  withdrawalComment: string | null
  currentStage: number | null
  approvedAt: string | null
  rejectedAt: string | null
  rejectedStage: number | null // Номер этапа (1=Штаб, 2=ОМТС, 3=РП), на котором была отклонена заявка
  resubmitComment: string | null
  resubmitCount: number
  invoiceAmount: number | null // Сумма счета в рублях
  // История изменения сумм при повторных отправках; в списочных ответах отсутствует
  // (облегчённая проекция) — приходит только в детали GET /api/payment-requests/:id
  invoiceAmountHistory?: { amount: number; changedAt: string }[]
  previousStatusId: string | null // Статус до перевода на доработку
  stageHistory: StageHistoryEntry[] // Хронология этапов согласования
  isDeleted: boolean // Мягкое удаление
  deletedAt: string | null // Дата мягкого удаления
  paidStatusId: string | null // Статус оплаты (FK на statuses, entity_type='paid')
  totalPaid: number // Денормализованная сумма оплат
  supplierId: string | null // Поставщик
  dpNumber: string | null // Номер РП
  dpDate: string | null // Дата РП
  dpAmount: number | null // Сумма РП
  dpFileKey: string | null // Ключ файла РП в S3
  dpFileName: string | null // Имя файла РП
  rpLinked?: boolean // Заявка входит в РП: поле «РП» заполняется автоматически (ручная правка скрыта)
  omtsEnteredAt: string | null // Дата попадания на этап ОМТС
  omtsApprovedAt: string | null // Дата согласования обычным ОМТС
  costTypeId: string | null // Вид затрат
  // Joined
  counterpartyName?: string
  counterpartyInn?: string
  supplierName?: string
  supplierInn?: string
  supplierLastSecurityStatus?: 'approved' | 'rejected' | null
  siteName?: string
  statusName?: string
  statusColor?: string | null
  paidStatusName?: string
  paidStatusColor?: string | null
  shippingConditionValue?: string
  assignedUserId?: string | null
  assignedUserEmail?: string | null
  assignedUserFullName?: string | null
  costTypeName?: string | null
}

/** Лог действий по заявке на оплату */
export interface PaymentRequestLog {
  id: string
  paymentRequestId: string
  userId: string
  action: string
  details: Record<string, unknown> | null
  createdAt: string
  // Joined
  userEmail?: string
  userFullName?: string
}

/** История назначения ответственного за заявку */
export interface PaymentRequestAssignment {
  id: string
  paymentRequestId: string
  assignedUserId: string
  assignedByUserId: string
  assignedAt: string
  isCurrent: boolean
  createdAt: string
  // Joined fields
  assignedUserEmail?: string
  assignedUserFullName?: string
  assignedByUserEmail?: string
}

/** Файл заявки на оплату */
export interface PaymentRequestFile {
  id: string
  paymentRequestId: string
  documentTypeId: string
  fileName: string
  fileKey: string
  fileSize: number | null
  mimeType: string | null
  pageCount: number | null
  createdBy: string
  createdAt: string
  isResubmit: boolean
  isAdditional: boolean
  isRejected: boolean
  rejectedBy: string | null
  rejectedAt: string | null
  // Joined
  documentTypeName?: string
  uploaderRole?: string
  uploaderDepartment?: string | null
  uploaderCounterpartyName?: string | null
}

/** Оплата по заявке */
export interface PaymentPayment {
  id: string
  paymentRequestId: string
  paymentNumber: number
  paymentDate: string
  amount: number
  isExecuted: boolean // true = Исполнена (есть файл), false = Планируется
  createdBy: string
  updatedBy: string | null
  createdAt: string
  updatedAt: string | null
  files: PaymentPaymentFile[]
}

/** Файл оплаты */
export interface PaymentPaymentFile {
  id: string
  paymentPaymentId: string
  fileName: string
  fileKey: string
  fileSize: number | null
  mimeType: string | null
  createdBy: string
  createdAt: string
}

/** Комментарий (чат) заявки на оплату */
export interface PaymentRequestComment {
  id: string
  paymentRequestId: string
  authorId: string
  text: string
  createdAt: string
  updatedAt: string | null
  // Joined
  authorFullName?: string
  authorEmail?: string
  authorRole?: string
  authorDepartment?: string | null
  authorCounterpartyName?: string
  recipient?: string | null
}

// Заявки на согласование договора

/** Предмет договора */
export type ContractSubjectType = 'general' | 'metal' | 'non_metallic' | 'concrete'

/** Маппинг предмета договора на название */
export const CONTRACT_SUBJECT_LABELS: Record<ContractSubjectType, string> = {
  general: 'Общий',
  metal: 'Поставка металлопродукции',
  non_metallic: 'Поставка нерудных материалов',
  concrete: 'Поставка бетона',
}

/** Цель доработки договора */
export type RevisionTarget = 'shtab' | 'counterparty'

/** Маппинг цели доработки на название */
export const REVISION_TARGET_LABELS: Record<RevisionTarget, string> = {
  shtab: 'Согласование Штаб',
  counterparty: 'На доработку Подрядчику',
}

/** Карта возврата заявки на договор на предыдущий этап (code -> code предыдущего) */
export const CONTRACT_PREVIOUS_STATUS_CODE: Record<string, string> = {
  on_revision: 'approv_omts',
  approved_waiting: 'approv_omts',
  concluded: 'approved_waiting',
  rejected: 'approv_omts',
}

/** Резервные названия статусов договора (если статус не загружен из справочника) */
export const CONTRACT_STATUS_FALLBACK_LABELS: Record<string, string> = {
  approv_omts: 'Согласование ОМТС',
  on_revision: 'На доработке',
  approved_waiting: 'Согласовано, ожидание оригинала',
  concluded: 'Заключен',
  rejected: 'Отклонено',
}

/** Запись в истории статусов заявки на договор */
export interface ContractStatusHistoryEntry {
  event:
    | 'created'
    | 'revision'
    | 'revision_complete'
    | 'approved'
    | 'original_received'
    | 'assigned'
    | 'reverted_to_waiting'
    | 'status_reverted'
    | 'rejected'
  at: string
  userFullName?: string
  userEmail?: string
  revisionTargets?: string[]
  revisionTarget?: string
  comment?: string
  /** Имя целевого статуса для события status_reverted */
  toStatusName?: string
}

/** Заявка на согласование договора */
export interface ContractRequest {
  id: string
  requestNumber: string
  siteId: string
  counterpartyId: string
  supplierId: string
  partiesCount: number
  subjectType: ContractSubjectType
  subjectDetail: string | null
  statusId: string
  revisionTargets: RevisionTarget[]
  createdBy: string
  createdAt: string
  isDeleted: boolean
  deletedAt: string | null
  originalReceivedAt: string | null
  statusHistory: ContractStatusHistoryEntry[]
  responsibleUserId: string | null
  contractNumber: string | null
  contractSigningDate: string | null
  // Joined
  siteName?: string
  counterpartyName?: string
  counterpartyInn?: string
  supplierName?: string
  supplierInn?: string
  supplierLastSecurityStatus?: 'approved' | 'rejected' | null
  statusName?: string
  statusColor?: string | null
  statusCode?: string
  creatorFullName?: string
  responsibleUserFullName?: string
}

/** Файл заявки на согласование договора */
export interface ContractRequestFile {
  id: string
  contractRequestId: string
  fileName: string
  fileKey: string
  fileSize: number | null
  mimeType: string | null
  createdBy: string
  createdAt: string
  isAdditional: boolean
  isRejected: boolean
  rejectedBy: string | null
  rejectedAt: string | null
  isSignedContract: boolean
  // Joined
  uploaderRole?: string
  uploaderDepartment?: string | null
  uploaderCounterpartyName?: string | null
}

/** Комментарий (чат) заявки на согласование договора */
export interface ContractRequestComment {
  id: string
  contractRequestId: string
  authorId: string
  text: string
  createdAt: string
  updatedAt: string | null
  recipient?: string | null
  // Joined
  authorFullName?: string
  authorEmail?: string
  authorRole?: string
  authorDepartment?: string | null
  authorCounterpartyName?: string
}

/** Прикреплённый документ контрагента/поставки */
export interface Document {
  id: string
  counterpartyId: string
  documentTypeId: string
  siteId: string
  fileName: string
  fileKey: string
  isMarkedForDeletion: boolean
  markedForDeletionAt: string | null
  uploadedAt: string
  documentTypeName?: string
  siteName?: string
}

/** Статус распределительного письма */
export type DistributionLetterStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'ordered'

/** Распределительное письмо (РП) — документ на согласование */
export interface DistributionLetter {
  id: string
  invoiceId: string
  counterpartyId: string
  siteId: string
  number: string
  date: string
  totalAmount: number
  status: DistributionLetterStatus
  createdAt: string
  counterpartyName?: string
  siteName?: string
  invoiceNumber?: string
}

// Согласования

/** Статус решения по согласованию */
export type ApprovalDecisionStatus = 'pending' | 'approved' | 'rejected'

/** Решение по согласованию (факт) */
export interface ApprovalDecision {
  id: string
  paymentRequestId: string
  stageOrder: number
  department: ApprovalDepartment
  status: ApprovalDecisionStatus
  userId: string | null
  comment: string
  decidedAt: string | null
  createdAt: string
  userEmail?: string
  userFullName?: string
  files?: ApprovalDecisionFile[] // Файлы, прикрепленные к решению (для отклонения)
  isOmtsRp?: boolean
}

/** Файл, прикрепленный к решению об отклонении */
export interface ApprovalDecisionFile {
  id: string
  approvalDecisionId: string
  fileName: string
  fileKey: string
  fileSize: number | null
  mimeType: string | null
  createdBy: string
  createdAt: string
}

// Настройки

/** Модель OCR (настройки OpenRouter) */
export interface OcrModel {
  id: string
  name: string
  modelId: string
  isActive: boolean
  createdAt: string
}

/** Модель OCR из настроек (settings) */
export interface OcrModelSetting {
  id: string
  name: string
  inputPrice: number
  outputPrice: number
}

/** Вид затрат */
export interface CostType {
  id: string
  name: string
  isActive: boolean
  createdAt: string
}

/** Материал из справочника */
export interface MaterialDictionary {
  id: string
  name: string
  unit: string | null
  createdAt: string
}

/** Распознанный материал */
export interface RecognizedMaterial {
  id: string
  paymentRequestId: string
  fileId: string | null
  materialId: string
  pageNumber: number | null
  position: number
  article: string | null
  quantity: number | null
  price: number | null
  amount: number | null
  estimateQuantity: number | null
  createdAt: string
  // Joined
  materialName?: string
  materialUnit?: string | null
}

/** Лог OCR-распознавания */
export interface OcrRecognitionLog {
  id: string
  paymentRequestId: string
  fileId: string | null
  modelId: string
  status: 'pending' | 'processing' | 'success' | 'error'
  errorMessage: string | null
  attemptNumber: number
  inputTokens: number | null
  outputTokens: number | null
  totalCost: number | null
  startedAt: string
  completedAt: string | null
  // Joined
  requestNumber?: string
}

/** Статистика токенов OCR */
export interface OcrTokenStats {
  inputTokens: number
  outputTokens: number
  totalCost: number
}

/** Строка, распознанная OCR (из ответа LLM) */
export interface OcrParsedItem {
  article?: string
  name: string
  unit?: string
  quantity?: number
  price?: number
  amount?: number
}

// Аутентификация

/** Роль пользователя */
export type UserRole = 'admin' | 'user' | 'counterparty_user' | 'security'

/** Пользователь системы */
export interface User {
  id: string
  email: string
  fullName: string
  role: UserRole
  counterpartyId: string | null
  department: Department | null
  allSites: boolean
  isActive: boolean
}

/** Тип уведомления */
export type NotificationType =
  | 'missing_specialist'
  | 'info'
  | 'error'
  | 'status_changed'
  | 'new_request_pending'
  | 'request_assigned'
  | 'new_comment'
  | 'new_file'
  | 'sb_review_requested'
  | 'sb_review_decided'

/** Уведомление */
export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  message: string
  userId: string
  isRead: boolean
  paymentRequestId: string | null
  contractRequestId: string | null
  supplierId: string | null
  department: Department | null
  siteId: string | null
  resolved: boolean
  resolvedAt: string | null
  createdAt: string
  siteName?: string
  requestNumber?: string
  contractRequestNumber?: string
  supplierName?: string
}

/** Тип ошибки в логах */
export type ErrorLogType =
  | 'js_error'
  | 'unhandled_rejection'
  | 'react_error'
  | 'api_error'
  | 'export_error'
  | 'chunk_load_error'

/** Запись лога ошибки */
export interface ErrorLog {
  id: string
  createdAt: string
  errorType: ErrorLogType
  errorMessage: string
  errorStack: string | null
  url: string | null
  userId: string | null
  userAgent: string | null
  component: string | null
  metadata: Record<string, unknown> | null
  // Joined
  userEmail?: string
}

/** Назначение этапа «РП»: объект строительства → сотрудник (один сотрудник на объект) */
export interface RpStageAssignee {
  id: string
  userId: string
  userFullName: string
  userEmail: string
  userDepartment: Department | null
  siteId: string
  siteName: string
}

/** Кандидат в назначенцы этапа «РП» (активный сотрудник Штаба/ОМТС) */
export interface RpStageCandidate {
  id: string
  email: string
  fullName: string
  department: Department | null
}

/** Состояние аутентификации */
export interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
}

// ============ Реестр РП (распределительные письма) ============

/** Статус оплаты РП (вычисляется из связанных заявок). */
export type RpPaymentStatus = 'paid' | 'partial' | 'unpaid'

/** Ссылка на заявку в записи реестра РП. */
export interface RpRequestRef {
  id: string
  requestNumber: string
}

/** Статус синхронизации письма PayHub (null — письмо не запрашивалось, старые РП). */
export type RpLetterSyncStatus = 'uploading' | 'pending' | 'waiting_config' | 'synced' | 'failed'

/** Снимок текстовых полей письма PayHub (для префилла редактирования). */
export interface RpLetterPayload {
  subject: string
  content: string
  responsiblePersonName: string | null
}

/** Строка реестра РП. */
export interface RpLetter {
  id: string
  number: string
  letterDate: string | null
  createdAt: string
  /** Дата отправки письма (ручной ввод из реестра; null — не заполнена). */
  sentDate: string | null
  status: string
  totalAmount: number
  description: string
  // Поставщик необязателен: РП по СМР создаётся без поставщика (0018).
  supplierId: string | null
  supplierName: string | null
  supplierInn: string | null
  counterpartyId: string
  counterpartyName: string
  counterpartyInn: string
  siteId: string
  siteName: string
  createdBy: string
  /** ФИО автора РП; null при пустом ФИО или отсутствии пользователя. */
  createdByName: string | null
  /** Номер счёта (ручной ввод при создании РП; в реестре справа от суммы). */
  invoiceNumber: string | null
  requests: RpRequestRef[]
  paymentStatus: RpPaymentStatus
  /** Дата последнего исполненного платежа; заполнена только при paymentStatus='paid'. */
  paidAt: string | null
  // Письмо PayHub
  payhubLetterId: string | null
  payhubLetterRegNumber: string | null
  payhubLetterUrl: string | null
  payhubLetterStatus: RpLetterSyncStatus | null
  payhubLetterError: string | null
  /** Снимок текста письма (для префилла редактирования из реестра). */
  payhubLetterPayload: RpLetterPayload | null
  /** Всего файлов РП (вложения письма PayHub + служебные) — счётчик в реестре. */
  filesCount: number
  /** Есть вложение письма типа 'rp' (скан чистовика) — зелёная скрепка в реестре. */
  hasRpFile: boolean
}

/** Тип файла вложения письма РП: 'rp' — скан чистовика; 'other' — прочие. */
export type RpAttachmentType = 'rp' | 'other'

/** Вложение письма PayHub для модалки «Файлы РП». */
export interface RpAttachmentView {
  id: string
  fileKey: string
  fileName: string
  mimeType: string | null
  sizeBytes: number | null
  fileType: string
  payhubAttachmentId: string | null
  createdAt: string
}

/** Служебный файл РП (billhub, в PayHub не уходит) для модалки «Файлы РП». */
export interface RpServiceFile {
  id: string
  fileKey: string
  fileName: string
  mimeType: string | null
  sizeBytes: number | null
  createdAt: string
}

/** Файлы РП: вложения письма PayHub + служебные файлы. */
export interface RpFilesResult {
  payhub: RpAttachmentView[]
  service: RpServiceFile[]
}

/** Документ договора для модалки создания РП. */
export interface RpContractDoc {
  id: string
  fileKey: string
  fileName: string
  mimeType: string | null
  contractNumber: string | null
  contractDate: string | null
  isSignedContract: boolean
}

/** Учредительный документ поставщика для модалки создания РП. */
export interface RpFoundingDoc {
  id: string
  fileKey: string
  fileName: string
  mimeType: string | null
  typeName: string
}

/** Документы для модалки создания РП (связка Поставщик+Подрядчик+Объект). */
export interface RpDocumentsResult {
  contract: RpContractDoc[]
  founding: RpFoundingDoc[]
}

/** Снимок выбранного документа, сохраняемый в составе РП. */
export interface RpDocumentRef {
  source: 'contract' | 'founding'
  fileKey: string
  fileName: string
  mimeType?: string | null
  contractNumber?: string | null
  contractDate?: string | null
}
