import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { App } from 'antd'
import type { ReactNode } from 'react'
import { useRpManagement } from './useRpManagement'
import { useRpStore } from '@/store/rpStore'
import { api } from '@/services/api'
import type { RpLetter } from '@/types'
import type { FilterValues } from '@/components/paymentRequests/RequestFilters'

vi.mock('@/services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/services/errorLogger', () => ({
  logError: vi.fn(),
}))

/** Минимальная строка реестра для теста */
function letter(overrides: Partial<RpLetter>): RpLetter {
  return {
    id: 'id',
    number: 'РП-000001',
    letterDate: null,
    createdAt: '2026-07-01T10:00:00Z',
    sentDate: null,
    status: 'draft',
    totalAmount: 1000,
    description: '',
    supplierId: 'sup-1',
    supplierName: '',
    supplierInn: '',
    counterpartyId: 'cp-1',
    counterpartyName: '',
    counterpartyInn: '',
    siteId: 'site-1',
    siteName: '',
    createdBy: 'user-1',
    createdByName: null,
    invoiceNumber: null,
    requests: [],
    paymentStatus: 'unpaid',
    paidAt: null,
    payhubLetterId: null,
    payhubLetterRegNumber: null,
    payhubLetterUrl: null,
    payhubLetterStatus: null,
    payhubLetterError: null,
    payhubLetterPayload: null,
    filesCount: 0,
    hasRpFile: false,
    ...overrides,
  }
}

/** antd App-контекст (useRpManagement использует App.useApp) */
function wrapper({ children }: { children: ReactNode }) {
  return <App>{children}</App>
}

function run(enabled: boolean, filters: FilterValues = {}) {
  return renderHook(
    () =>
      useRpManagement({
        enabled,
        approvedRequests: [],
        filteredApprovedRequests: [],
        sites: [],
        filters,
        setViewRecord: vi.fn(),
        refreshTrigger: 0,
        bumpRefresh: vi.fn(),
        setActiveTab: vi.fn(),
      }),
    { wrapper },
  )
}

describe('useRpManagement — загрузка реестра и счётчик', () => {
  const items = [
    letter({ id: '1', supplierId: 'sup-1' }),
    letter({ id: '2', supplierId: 'sup-2', number: 'РП-000002' }),
  ]

  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    vi.mocked(api.get).mockResolvedValue(items)
    useRpStore.setState({ letters: [], lettersLoaded: false, lettersLoading: false })
  })

  it('грузит реестр на маунте независимо от активной вкладки (enabled: true)', async () => {
    const { result } = run(true)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/rp'))
    await waitFor(() => expect(result.current.lettersLoaded).toBe(true))
    expect(result.current.lettersTotal).toBe(2)
  })

  it('не дёргает /api/rp для counterparty (enabled: false)', async () => {
    run(false)
    await Promise.resolve()
    expect(api.get).not.toHaveBeenCalledWith('/api/rp')
  })

  it('lettersTotal не зависит от фильтров, filteredLetters — фильтруется', async () => {
    const { result } = run(true, { supplierId: 'sup-2' })
    await waitFor(() => expect(result.current.lettersLoaded).toBe(true))
    expect(result.current.lettersTotal).toBe(2)
    expect(result.current.filteredLetters.map((l) => l.id)).toEqual(['2'])
  })
})
