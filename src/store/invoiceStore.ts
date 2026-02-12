import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import type { Invoice, Specification } from '@/types'

interface InvoiceStoreState {
  invoices: Invoice[]
  currentInvoice: Invoice | null
  specifications: Specification[]
  isLoading: boolean
  error: string | null
  fetchInvoices: (counterpartyId?: string) => Promise<void>
  fetchInvoiceById: (id: string) => Promise<void>
  createInvoice: (data: Partial<Invoice>) => Promise<void>
  updateInvoice: (id: string, data: Partial<Invoice>) => Promise<void>
  deleteInvoice: (id: string) => Promise<void>
  fetchSpecifications: (invoiceId: string) => Promise<void>
  saveSpecifications: (invoiceId: string, specs: Partial<Specification>[]) => Promise<void>
}

export const useInvoiceStore = create<InvoiceStoreState>((set, get) => ({
  invoices: [],
  currentInvoice: null,
  specifications: [],
  isLoading: false,
  error: null,

  fetchInvoices: async (counterpartyId?) => {
    set({ isLoading: true, error: null })
    try {
      let query = supabase.from('invoices').select('*').order('created_at', { ascending: false })
      if (counterpartyId) {
        query = query.eq('counterparty_id', counterpartyId)
      }
      const { data, error } = await query
      if (error) throw error
      set({ invoices: data as Invoice[], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки счетов'
      set({ error: message, isLoading: false })
    }
  },

  fetchInvoiceById: async (id) => {
    set({ isLoading: true, error: null })
    try {
      const { data, error } = await supabase.from('invoices').select('*').eq('id', id).single()
      if (error) throw error
      set({ currentInvoice: data as Invoice, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки счёта'
      set({ error: message, isLoading: false })
    }
  },

  createInvoice: async (data) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('invoices').insert(data)
      if (error) throw error
      await get().fetchInvoices()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания счёта'
      set({ error: message, isLoading: false })
    }
  },

  updateInvoice: async (id, data) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('invoices').update(data).eq('id', id)
      if (error) throw error
      await get().fetchInvoices()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления счёта'
      set({ error: message, isLoading: false })
    }
  },

  deleteInvoice: async (id) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('invoices').delete().eq('id', id)
      if (error) throw error
      await get().fetchInvoices()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления счёта'
      set({ error: message, isLoading: false })
    }
  },

  fetchSpecifications: async (invoiceId) => {
    set({ isLoading: true, error: null })
    try {
      const { data, error } = await supabase
        .from('specifications')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('position', { ascending: true })
      if (error) throw error
      set({ specifications: data as Specification[], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки спецификаций'
      set({ error: message, isLoading: false })
    }
  },

  saveSpecifications: async (invoiceId, specs) => {
    set({ isLoading: true, error: null })
    try {
      // Удаляем старые спецификации
      await supabase.from('specifications').delete().eq('invoice_id', invoiceId)
      // Вставляем новые
      const rows = specs.map((spec, index) => ({
        ...spec,
        invoice_id: invoiceId,
        position: index + 1,
      }))
      const { error } = await supabase.from('specifications').insert(rows)
      if (error) throw error
      await get().fetchSpecifications(invoiceId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка сохранения спецификаций'
      set({ error: message, isLoading: false })
    }
  },
}))
