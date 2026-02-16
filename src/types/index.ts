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

/** Контрагент (поставщик) */
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
}

/** Подразделение (enum) */
export type Department = 'omts' | 'shtab' | 'smetny'

/** Маппинг enum → название для UI */
export const DEPARTMENT_LABELS: Record<Department, string> = {
  omts: 'ОМТС',
  shtab: 'Штаб',
  smetny: 'Сметный',
}

/** Тип документа */
export interface DocumentType {
  id: string
  name: string
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

/** Заявка на оплату */
export interface PaymentRequest {
  id: string
  requestNumber: string
  counterpartyId: string
  siteId: string
  statusId: string
  deliveryDays: number
  deliveryDaysType: string
  shippingConditionId: string
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
  rejectedStage: number | null // Номер этапа (1=Штаб, 2=ОМТС), на котором была отклонена заявка
  resubmitComment: string | null
  resubmitCount: number
  invoiceAmount: number | null // Сумма счета в рублях
  // Joined
  counterpartyName?: string
  siteName?: string
  statusName?: string
  statusColor?: string | null
  shippingConditionValue?: string
  assignedUserId?: string | null
  assignedUserEmail?: string | null
  assignedUserFullName?: string | null
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
  // Joined
  documentTypeName?: string
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
export type DistributionLetterStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'ordered'

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
  department: Department
  status: ApprovalDecisionStatus
  userId: string | null
  comment: string
  decidedAt: string | null
  createdAt: string
  userEmail?: string
  files?: ApprovalDecisionFile[] // Файлы, прикрепленные к решению (для отклонения)
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

// Аутентификация

/** Роль пользователя */
export type UserRole = 'admin' | 'user' | 'counterparty_user'

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
export type NotificationType = 'missing_specialist' | 'info' | 'error'

/** Уведомление */
export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  message: string
  userId: string
  isRead: boolean
  paymentRequestId: string | null
  department: Department | null
  siteId: string | null
  resolved: boolean
  resolvedAt: string | null
  createdAt: string
  siteName?: string
  requestNumber?: string
}

/** Состояние аутентификации */
export interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
}
