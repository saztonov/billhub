import { useState, useMemo } from 'react'
import {
  Modal,
  Upload,
  Table,
  Select,
  App,
  Typography,
  Tag,
  Progress,
  Space,
} from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import * as XLSX from 'xlsx'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import type { Counterparty } from '@/types'

const { Text } = Typography

// Действие при совпадении ИНН
type DuplicateAction = 'skip' | 'add_alternative' | 'replace_name'

interface ParsedRow {
  key: number
  name: string
  inn: string
  error?: string
  // Данные существующего контрагента при совпадении ИНН
  existingCounterparty?: Counterparty
  duplicateAction?: DuplicateAction
}

interface ImportCounterpartiesModalProps {
  open: boolean
  onClose: () => void
}

// Поиск индекса колонки по заголовку
const findColumnIndex = (headers: string[], variants: string[]): number => {
  return headers.findIndex((h) => {
    const lower = (h ?? '').toString().toLowerCase().trim()
    return variants.some((v) => lower.includes(v))
  })
}

// Валидация ИНН
const validateInn = (inn: string): boolean => {
  if (!/^\d+$/.test(inn)) return false
  return inn.length === 10 || inn.length === 12
}

const ImportCounterpartiesModal = ({ open, onClose }: ImportCounterpartiesModalProps) => {
  const { message } = App.useApp()
  const {
    counterparties,
    batchInsertCounterparties,
    updateCounterpartyForImport,
    fetchCounterparties,
  } = useCounterpartyStore()

  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  // Маппинг ИНН -> существующий контрагент
  const existingByInn = useMemo(() => {
    const map = new Map<string, Counterparty>()
    counterparties.forEach((c) => {
      if (c.inn) map.set(c.inn, c)
    })
    return map
  }, [counterparties])

  // Парсинг Excel-файла
  const handleFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const json = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })

        if (json.length === 0) {
          message.error('Файл пуст')
          return
        }

        // Определяем колонки по заголовкам
        const firstRow = json[0].map((v) => (v ?? '').toString())
        let nameIdx = findColumnIndex(firstRow, ['наименование', 'название', 'name', 'наим'])
        let innIdx = findColumnIndex(firstRow, ['инн', 'inn'])
        let dataStartIdx = 0

        if (nameIdx >= 0 && innIdx >= 0) {
          dataStartIdx = 1
        } else {
          // Заголовки не найдены — первая колонка = название, вторая = ИНН
          nameIdx = 0
          innIdx = 1
          dataStartIdx = 0
        }

        // Проверка дублей ИНН внутри файла
        const seenInns = new Set<string>()
        const rows: ParsedRow[] = []

        for (let i = dataStartIdx; i < json.length; i++) {
          const row = json[i]
          if (!row || row.length === 0) continue

          const name = (row[nameIdx] ?? '').toString().trim()
          const inn = (row[innIdx] ?? '').toString().trim()

          if (!name && !inn) continue

          let error: string | undefined

          if (!name) {
            error = 'Не указано наименование'
          } else if (!inn) {
            error = 'Не указан ИНН'
          } else if (!validateInn(inn)) {
            error = 'ИНН должен содержать 10 или 12 цифр'
          } else if (seenInns.has(inn)) {
            error = 'Дубликат ИНН в файле'
          }

          if (!error && inn) seenInns.add(inn)

          const existing = inn ? existingByInn.get(inn) : undefined

          rows.push({
            key: i,
            name,
            inn,
            error,
            existingCounterparty: error ? undefined : existing,
            duplicateAction: existing && !error ? 'skip' : undefined,
          })
        }

        if (rows.length === 0) {
          message.error('Не найдено данных для импорта')
          return
        }

        setParsedRows(rows)
      } catch {
        message.error('Ошибка чтения файла')
      }
    }
    reader.readAsArrayBuffer(file)
    return false
  }

  // Изменение действия для дубликата
  const handleActionChange = (key: number, action: DuplicateAction) => {
    setParsedRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, duplicateAction: action } : r))
    )
  }

  // Импорт
  const handleImport = async () => {
    const newRows = parsedRows.filter((r) => !r.error && !r.existingCounterparty)
    const duplicateRows = parsedRows.filter(
      (r) => !r.error && r.existingCounterparty && r.duplicateAction && r.duplicateAction !== 'skip'
    )

    const totalOps = newRows.length + duplicateRows.length
    if (totalOps === 0) {
      message.warning('Нет записей для импорта')
      return
    }

    setIsImporting(true)
    setProgress({ done: 0, total: totalOps })

    try {
      let created = 0
      let updated = 0

      // Вставка новых контрагентов батчами по 20
      if (newRows.length > 0) {
        created = await batchInsertCounterparties(
          newRows.map((r) => ({ name: r.name, inn: r.inn })),
          (done, total) => {
            setProgress({ done, total: total + duplicateRows.length })
          }
        )
      }

      // Обработка дубликатов
      for (const row of duplicateRows) {
        const existing = row.existingCounterparty!
        const altNames = [...(existing.alternativeNames || [])]

        if (row.duplicateAction === 'add_alternative') {
          // Добавляем импортируемое наименование в альтернативные
          altNames.push(row.name)
          await updateCounterpartyForImport(existing.id, existing.name, altNames)
        } else if (row.duplicateAction === 'replace_name') {
          // Старое наименование в альтернативные, новое — основным
          altNames.push(existing.name)
          await updateCounterpartyForImport(existing.id, row.name, altNames)
        }
        updated++
        setProgress((p) => ({ ...p, done: created + updated }))
      }

      await fetchCounterparties()

      const skipped = parsedRows.filter(
        (r) => r.error || (r.existingCounterparty && r.duplicateAction === 'skip')
      ).length

      message.success(
        `Импорт завершен. Добавлено: ${created}, обновлено: ${updated}, пропущено: ${skipped}`
      )

      handleClose()
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка импорта')
    } finally {
      setIsImporting(false)
    }
  }

  const handleClose = () => {
    setParsedRows([])
    setProgress({ done: 0, total: 0 })
    setIsImporting(false)
    onClose()
  }

  // Статистика
  const stats = useMemo(() => {
    const errors = parsedRows.filter((r) => r.error).length
    const duplicates = parsedRows.filter((r) => r.existingCounterparty && !r.error).length
    const newOnes = parsedRows.filter((r) => !r.error && !r.existingCounterparty).length
    return { errors, duplicates, newOnes, total: parsedRows.length }
  }, [parsedRows])

  const columns = [
    {
      title: 'Наименование (из файла)',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: ParsedRow) => (
        <Text type={record.error ? 'danger' : undefined}>{name || '—'}</Text>
      ),
    },
    {
      title: 'ИНН',
      dataIndex: 'inn',
      key: 'inn',
      width: 140,
      render: (inn: string, record: ParsedRow) => (
        <Text type={record.error ? 'danger' : undefined}>{inn || '—'}</Text>
      ),
    },
    {
      title: 'Статус',
      key: 'status',
      width: 200,
      render: (_: unknown, record: ParsedRow) => {
        if (record.error) return <Tag color="red">{record.error}</Tag>
        if (record.existingCounterparty) return <Tag color="orange">Дубликат ИНН</Tag>
        return <Tag color="green">Новый</Tag>
      },
    },
    {
      title: 'Существующий контрагент',
      key: 'existing',
      render: (_: unknown, record: ParsedRow) => {
        if (!record.existingCounterparty) return null
        const ec = record.existingCounterparty
        return (
          <Space direction="vertical" size={0}>
            <Text strong>{ec.name}</Text>
            {ec.alternativeNames?.length > 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Альт.: {ec.alternativeNames.join('; ')}
              </Text>
            )}
          </Space>
        )
      },
    },
    {
      title: 'Действие',
      key: 'action',
      width: 250,
      render: (_: unknown, record: ParsedRow) => {
        if (record.error || !record.existingCounterparty) return null
        return (
          <Select
            value={record.duplicateAction}
            onChange={(val) => handleActionChange(record.key, val)}
            style={{ width: '100%' }}
            options={[
              { value: 'skip', label: 'Пропустить' },
              { value: 'add_alternative', label: 'Добавить в альтернативные' },
              { value: 'replace_name', label: 'Заменить наименование' },
            ]}
          />
        )
      },
    },
  ]

  return (
    <Modal
      title="Импорт контрагентов из Excel"
      open={open}
      onCancel={handleClose}
      onOk={handleImport}
      okText="Импортировать"
      cancelText="Отмена"
      okButtonProps={{
        disabled: parsedRows.length === 0 || isImporting,
        loading: isImporting,
      }}
      width={1000}
      destroyOnClose
    >
      {parsedRows.length === 0 ? (
        <Upload.Dragger
          accept=".xlsx,.xls"
          beforeUpload={handleFile}
          showUploadList={false}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">Перетащите файл Excel или нажмите для выбора</p>
          <p className="ant-upload-hint">Поддерживаются форматы .xlsx и .xls</p>
        </Upload.Dragger>
      ) : (
        <>
          <Space style={{ marginBottom: 16 }}>
            <Tag>Всего: {stats.total}</Tag>
            <Tag color="green">Новых: {stats.newOnes}</Tag>
            <Tag color="orange">Дубликатов: {stats.duplicates}</Tag>
            {stats.errors > 0 && <Tag color="red">Ошибок: {stats.errors}</Tag>}
          </Space>

          {isImporting && (
            <Progress
              percent={Math.round((progress.done / progress.total) * 100)}
              format={() => `${progress.done} / ${progress.total}`}
              style={{ marginBottom: 16 }}
            />
          )}

          <Table
            columns={columns}
            dataSource={parsedRows}
            rowKey="key"
            size="small"
            pagination={{ pageSize: 50 }}
            scroll={{ y: 400 }}
          />
        </>
      )}
    </Modal>
  )
}

export default ImportCounterpartiesModal
