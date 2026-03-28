import { create } from 'zustand'
import { api } from '@/services/api'
import type { PaymentRequestFieldOption } from '@/types'

interface PaymentRequestSettingsStoreState {
  fieldOptions: PaymentRequestFieldOption[]
  isLoading: boolean
  error: string | null
  fetchFieldOptions: () => Promise<void>
  createFieldOption: (data: {
    field_code: string
    value: string
    is_active?: boolean
    display_order?: number
  }) => Promise<void>
  updateFieldOption: (id: string, data: Record<string, unknown>) => Promise<void>
  deleteFieldOption: (id: string) => Promise<void>
  getOptionsByField: (fieldCode: string) => PaymentRequestFieldOption[]
}

export const usePaymentRequestSettingsStore = create<PaymentRequestSettingsStoreState>(
  (set, get) => ({
    fieldOptions: [],
    isLoading: false,
    error: null,

    fetchFieldOptions: async () => {
      set({ isLoading: true, error: null })
      try {
        const data = await api.get<PaymentRequestFieldOption[]>('/api/references/field-options')
        set({ fieldOptions: data ?? [], isLoading: false })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ошибка загрузки опций'
        set({ error: message, isLoading: false })
      }
    },

    createFieldOption: async (data) => {
      set({ isLoading: true, error: null })
      try {
        await api.post('/api/references/field-options', data)
        await get().fetchFieldOptions()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ошибка создания опции'
        set({ error: message, isLoading: false })
      }
    },

    updateFieldOption: async (id, data) => {
      set({ isLoading: true, error: null })
      try {
        await api.put(`/api/references/field-options/${id}`, data)
        await get().fetchFieldOptions()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ошибка обновления опции'
        set({ error: message, isLoading: false })
      }
    },

    deleteFieldOption: async (id) => {
      set({ isLoading: true, error: null })
      try {
        await api.delete(`/api/references/field-options/${id}`)
        await get().fetchFieldOptions()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ошибка удаления опции'
        set({ error: message, isLoading: false })
      }
    },

    getOptionsByField: (fieldCode) => {
      return get().fieldOptions.filter(
        (opt) => opt.fieldCode === fieldCode && opt.isActive,
      )
    },
  }),
)
