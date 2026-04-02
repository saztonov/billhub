import { useState, useRef, useEffect, useCallback } from 'react'
import { Input, DatePicker } from 'antd'
import dayjs from 'dayjs'

interface InlineTextCellProps {
  value: string | null
  onSave: (value: string | null) => Promise<void>
}

/** Инлайн-редактируемая текстовая ячейка */
export const InlineTextCell = ({ value, onSave }: InlineTextCellProps) => {
  const [editing, setEditing] = useState(false)
  const [localValue, setLocalValue] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<any>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
    }
  }, [editing])

  // Синхронизация с внешним значением
  useEffect(() => {
    if (!editing) setLocalValue(value ?? '')
  }, [value, editing])

  const handleSave = useCallback(async () => {
    const trimmed = localValue.trim()
    const newVal = trimmed || null
    setEditing(false)
    if (newVal === (value ?? null)) return
    setSaving(true)
    try {
      await onSave(newVal)
    } finally {
      setSaving(false)
    }
  }, [localValue, value, onSave])

  if (editing) {
    return (
      <Input
        ref={inputRef}
        size="small"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleSave}
        onPressEnter={handleSave}
        style={{ width: '100%' }}
      />
    )
  }

  return (
    <div
      onClick={(e) => { e.stopPropagation(); setEditing(true) }}
      style={{ cursor: 'pointer', minHeight: 22, color: value ? undefined : '#bfbfbf' }}
    >
      {saving ? '...' : (value || '—')}
    </div>
  )
}

interface InlineDateCellProps {
  value: string | null
  onSave: (value: string | null) => Promise<void>
}

/** Форматирование даты для отображения */
function formatDateDisplay(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Инлайн-редактируемая ячейка с выбором даты */
export const InlineDateCell = ({ value, onSave }: InlineDateCellProps) => {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleChange = useCallback(async (date: dayjs.Dayjs | null) => {
    setEditing(false)
    const newVal = date ? date.format('YYYY-MM-DD') : null
    if (newVal === (value ?? null)) return
    setSaving(true)
    try {
      await onSave(newVal)
    } finally {
      setSaving(false)
    }
  }, [value, onSave])

  if (editing) {
    return (
      <DatePicker
        size="small"
        defaultOpen
        autoFocus
        value={value ? dayjs(value) : null}
        format="DD.MM.YYYY"
        onChange={handleChange}
        onOpenChange={(open) => { if (!open) setEditing(false) }}
        style={{ width: '100%' }}
      />
    )
  }

  return (
    <div
      onClick={(e) => { e.stopPropagation(); setEditing(true) }}
      style={{ cursor: 'pointer', minHeight: 22, color: value ? undefined : '#bfbfbf' }}
    >
      {saving ? '...' : (value ? formatDateDisplay(value) : '—')}
    </div>
  )
}
