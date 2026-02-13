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
  kpp: string
  address: string
  contactPerson: string
  phone: string
  email: string
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
  address: string
  description: string
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
  description: string
  isRequired: boolean
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
  siteId: string | null
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

/** Цепочка согласования (конструктор) */
export interface ApprovalChain {
  id: string
  name: string
  description: string
  isActive: boolean
  createdAt: string
}

/** Этап (шаг) в цепочке согласования */
export interface ApprovalStep {
  id: string
  chainId: string
  stepOrder: number
  employeeId: string
  role: string
  isRequired: boolean
  employeeName?: string
}

/** Статус согласования */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

/** Факт согласования/отклонения */
export interface Approval {
  id: string
  distributionLetterId: string
  stepId: string
  employeeId: string
  status: ApprovalStatus
  comment: string
  decidedAt: string | null
  createdAt: string
  employeeName?: string
  stepOrder?: number
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
}

/** Состояние аутентификации */
export interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
}
