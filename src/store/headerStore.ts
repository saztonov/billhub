import { create } from 'zustand'
import type { ReactNode } from 'react'

interface HeaderStoreState {
  title: string | null
  extra: ReactNode | null
  actions: ReactNode | null
  setHeader: (title: string, extra?: ReactNode, actions?: ReactNode) => void
  clearHeader: () => void
}

export const useHeaderStore = create<HeaderStoreState>((set) => ({
  title: null,
  extra: null,
  actions: null,

  setHeader: (title, extra = null, actions = null) => {
    set({ title, extra, actions })
  },

  clearHeader: () => {
    set({ title: null, extra: null, actions: null })
  },
}))
