import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Хук для нативного drag & drop (минуя React event delegation).
 * Решает проблему с antd Dragger в React 19 + порталах (Modal).
 */
export function useNativeDropZone(onDrop: (files: File[]) => void) {
  const ref = useRef<HTMLDivElement>(null)
  const [isDragOver, setDragOver] = useState(false)
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = ref.current
    if (el && e.relatedTarget && el.contains(e.relatedTarget as Node)) return
    setDragOver(false)
  }, [])

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      onDropRef.current([...files])
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('dragover', handleDragOver)
    el.addEventListener('dragleave', handleDragLeave)
    el.addEventListener('drop', handleDrop)
    return () => {
      el.removeEventListener('dragover', handleDragOver)
      el.removeEventListener('dragleave', handleDragLeave)
      el.removeEventListener('drop', handleDrop)
    }
  }, [handleDragOver, handleDragLeave, handleDrop])

  return { ref, isDragOver }
}
