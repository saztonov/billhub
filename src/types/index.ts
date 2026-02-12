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
export type EmployeeRole = 'admin' | 'manager' | 'viewer'

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

// Документооборот

/** Статус счёта */
export type InvoiceStatus = 'new' | 'recognized' | 'processed' | 'error'

/** Счёт (загруженный с OCR-распознаванием) */
export interface Invoice {
  id: string
  counterpartyId: string
  number: string
  date: string
  totalAmount: number
  status: InvoiceStatus
  fileKey: string
  fileName: string
  ocrResult: string | null
  createdAt: string
  counterpartyName?: string
}

/** Спецификация — строка счёта (создаётся на основе OCR) */
export interface Specification {
  id: string
  invoiceId: string
  position: number
  name: string
  unit: string
  quantity: number
  price: number
  amount: number
  createdAt: string
}

/** Прикреплённый документ контрагента/поставки */
export interface Document {
  id: string
  counterpartyId: string
  documentTypeId: string
  siteId: string
  fileName: string
  fileKey: string
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
export type UserRole = 'admin' | 'manager' | 'viewer'

/** Пользователь системы */
export interface User {
  id: string
  email: string
  role: UserRole
}

/** Состояние аутентификации */
export interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
}
