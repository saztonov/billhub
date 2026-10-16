/** Типы интеграции SIGNAL DOCS (выгрузка счетов заявок на оплату) — ответы /api/sgnl */

export interface SgnlErrorInfo {
  code: string
  httpStatus?: number
  message: string
}

/** Проект SIGNAL для сопоставления объекта */
export interface SgnlProjectOption {
  id: string
  name: string
  code: string | null
}

export type SgnlExportStatus = 'pending' | 'done' | 'failed' | 'skipped'

export interface SgnlProjectReport {
  projectId: string
  projectName: string | null
  basePath: string | null
  sites: string[]
  files: number
  uploaded: number
  failed: number
  foldersToCreate: string[]
  error?: string
}

export interface SgnlSyncReport {
  dryRun: boolean
  siteId: string | null
  startedAt: string
  finishedAt: string
  totals: { candidates: number; uploaded: number; failed: number }
  projects: SgnlProjectReport[]
  skipped: {
    unmappedSites: { siteId: string; siteName: string; files: number }[]
    noSupplierFiles: number
  }
  errors: { requestNumber: string; fileName: string; path: string; error: string }[]
  aborted?: string
}

/** Ответ GET /api/sgnl/status */
export interface SgnlStatus {
  configured: boolean
  enabled: boolean
  cron: string | null
  baseUrl?: string
  ok: boolean
  latencyMs?: number
  error?: SgnlErrorInfo
  writeAccess?: { ok: boolean; error?: SgnlErrorInfo }
  stats: { counts: Record<SgnlExportStatus, number>; lastExportedAt: string | null }
  lastRun: SgnlSyncReport | null
}

/** Строка журнала с ошибкой (GET /api/sgnl/errors) */
export interface SgnlExportErrorRow {
  id: string
  requestNumber: string | null
  fileName: string | null
  siteName: string | null
  targetPath: string
  targetName: string
  attempts: number
  lastError: string | null
  updatedAt: string
}
