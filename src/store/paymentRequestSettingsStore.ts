import { create } from 'zustand'
import { supabase } from '@/services/supabase'
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
        const { data, error } = await supabase
          .from('payment_request_field_options')
          .select('*')
          .order('field_code', { ascending: true })
          .order('display_order', { ascending: true })
        if (error) throw error
        const fieldOptions: PaymentRequestFieldOption[] = (data ?? []).map(
          (row: Record<string, unknown>) => ({
            id: row.id as string,
            fieldCode: row.field_code as string,
            value: row.value as string,
            isActive: row.is_active as boolean,
            displayOrder: row.display_order as number,
            createdAt: row.created_at as string,
          }),
        )
        set({ fieldOptions, isLoading: false })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ошибка загрузки опций'
        set({ error: message, isLoading: false })
      }
    },

    createFieldOption: async (data) => {
      set({ isLoading: true, error: null })
      try {
        const { error } = await supabase
          .from('payment_request_field_options')
          .insert(data)
        if (error) throw error
        await get().fetchFieldOptions()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ошибка создания опции'
        set({ error: message, isLoading: false })
      }
    },

    updateFieldOption: async (id, data) => {
      set({ isLoading: true, error: null })
      try {
        const { error } = await supabase
          .from('payment_request_field_options')
          .update(data)
          .eq('id', id)
        if (error) throw error
        await get().fetchFieldOptions()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ошибка обновления опции'
        set({ error: message, isLoading: false })
      }
    },

    deleteFieldOption: async (id) => {
      set({ isLoading: true, error: null })
      try {
        const { error } = await supabase
          .from('payment_request_field_options')
          .delete()
          .eq('id', id)
        if (error) throw error
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
