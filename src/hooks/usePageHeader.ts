import { useEffect, type ReactNode } from 'react'
import { useHeaderStore } from '@/store/headerStore'

export function usePageHeader(
  title: string,
  extra?: ReactNode,
  actions?: ReactNode,
  deps: unknown[] = []
) {
  const setHeader = useHeaderStore((s) => s.setHeader)
  const clearHeader = useHeaderStore((s) => s.clearHeader)

  useEffect(() => {
    setHeader(title, extra, actions)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, setHeader, ...deps])

  useEffect(() => {
    return () => clearHeader()
  }, [clearHeader])
}
