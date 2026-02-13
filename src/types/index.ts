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

/** Подразделение */
export interface Department {
  id: string
  name: string
  description: string
  isActive: boolean
  createdAt: string
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
  urgencyId: string
  urgencyReason: string | null
  deliveryDays: number
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
  // Joined
  counterpartyName?: string
  siteName?: string
  statusName?: string
  statusColor?: string | null
  urgencyValue?: string
  shippingConditionValue?: string
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

/** Этап цепочки согласования (конфигурация) */
export interface ApprovalStage {
  id: string
  stageOrder: number
  departmentId: string
  createdAt: string
  departmentName?: string
}

/** Статус решения по согласованию */
export type ApprovalDecisionStatus = 'pending' | 'approved' | 'rejected'

/** Решение по согласованию (факт) */
export interface ApprovalDecision {
  id: string
  paymentRequestId: string
  stageOrder: number
  departmentId: string
  status: ApprovalDecisionStatus
  userId: string | null
  comment: string
  decidedAt: string | null
  createdAt: string
  departmentName?: string
  userEmail?: string
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
  role: UserRole
  counterpartyId: string | null
  departmentId: string | null
  allSites: boolean
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
  departmentId: string | null
  siteId: string | null
  resolved: boolean
  resolvedAt: string | null
  createdAt: string
  siteName?: string
  departmentName?: string
  requestNumber?: string
}

/** Состояние аутентификации */
export interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
}
