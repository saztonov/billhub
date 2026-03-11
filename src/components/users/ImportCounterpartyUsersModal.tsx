import { useState, useMemo } from 'react'
import {
  Modal,
  Upload,
  Table,
  App,
  Typography,
  Tag,
  Progress,
  Space,
  Button,
} from 'antd'
import { InboxOutlined, DownloadOutlined } from '@ant-design/icons'
import * as XLSX from 'xlsx'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useUserStore } from '@/store/userStore'
import type { BatchImportUserResult } from '@/store/userStore'

const { Text } = Typography

// Статус каждой строки после анализа
type RowStatus =
  | 'new_counterparty'
  | 'existing_counterparty'
  | 'conflict_email'
  | 'duplicate_email'
  | 'error'

interface ParsedRow {
  key: number
  counterpartyName: string
  inn: string
  fullName: string
  email: string
  password: string
  status: RowStatus
  statusDetail: string
  existingCounterpartyId?: string
}

interface ImportResult {
  email: string
  counterpartyName: string
  result: BatchImportUserResult
}

interface ImportCounterpartyUsersModalProps {
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

// Валидация email
const validateEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

const STATUS_LABELS: Record<RowStatus, string> = {
  new_counterparty: 'Новый подрядчик',
  existing_counterparty: 'Существующий подрядчик',
  conflict_email: 'Конфликт: email занят',
  duplicate_email: 'Дубликат email в файле',
  error: 'Ошибка',
}

const STATUS_COLORS: Record<RowStatus, string> = {
  new_counterparty: 'blue',
  existing_counterparty: 'green',
  conflict_email: 'orange',
  duplicate_email: 'orange',
  error: 'red',
}

const ImportCounterpartyUsersModal = ({ open, onClose }: ImportCounterpartyUsersModalProps) => {
  const { message } = App.useApp()
  const { counterparties, createCounterpartiesForImport, fetchCounterparties } =
    useCounterpartyStore()
  const { users, batchCreateCounterpartyUsers } = useUserStore()

  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  // Маппинг ИНН → существующий контрагент
  const existingByInn = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    counterparties.forEach((c) => {
      if (c.inn) map.set(c.inn, { id: c.id, name: c.name })
    })
    return map
  }, [counterparties])

  // Множество существующих email (в нижнем регистре)
  const existingEmails = useMemo(() => {
    return new Set(users.map((u) => u.email.toLowerCase()))
  }, [users])

  // Скачивание шаблона Excel
  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Название подрядчика', 'ИНН', 'ФИО', 'Email', 'Пароль'],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Шаблон')
    XLSX.writeFile(wb, 'шаблон_импорта_пользователей.xlsx')
  }

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

        const firstRow = json[0].map((v) => (v ?? '').toString())
        let nameIdx = findColumnIndex(firstRow, ['название', 'наименование', 'подрядчик', 'name'])
        let innIdx = findColumnIndex(firstRow, ['инн', 'inn'])
        let fioIdx = findColumnIndex(firstRow, ['фио', 'full_name', 'фамилия'])
        let emailIdx = findColumnIndex(firstRow, ['email', 'почта'])
        let passwordIdx = findColumnIndex(firstRow, ['пароль', 'password'])
        let dataStartIdx = 0

        if (nameIdx >= 0 && innIdx >= 0 && emailIdx >= 0) {
          dataStartIdx = 1
        } else {
          // Порядок по умолчанию: название, ИНН, ФИО, email, пароль
          nameIdx = 0
          innIdx = 1
          fioIdx = 2
          emailIdx = 3
          passwordIdx = 4
          dataStartIdx = 0
        }

        const seenEmails = new Set<string>()
        const rows: ParsedRow[] = []

        for (let i = dataStartIdx; i < json.length; i++) {
          const row = json[i]
          if (!row || row.every((cell) => !cell)) continue

          const counterpartyName = (row[nameIdx] ?? '').toString().trim()
          const inn = (row[innIdx] ?? '').toString().trim()
          const fullName = fioIdx >= 0 ? (row[fioIdx] ?? '').toString().trim() : ''
          const email = (row[emailIdx] ?? '').toString().trim().toLowerCase()
          const password = passwordIdx >= 0 ? (row[passwordIdx] ?? '').toString().trim() : ''

          if (!counterpartyName && !inn && !email) continue

          let status: RowStatus = 'new_counterparty'
          let statusDetail = ''
          let existingCounterpartyId: string | undefined

          // Валидация
          if (!counterpartyName) {
            status = 'error'
            statusDetail = 'Не указано название подрядчика'
          } else if (!inn) {
            status = 'error'
            statusDetail = 'Не указан ИНН'
          } else if (!validateInn(inn)) {
            status = 'error'
            statusDetail = 'ИНН должен содержать 10 или 12 цифр'
          } else if (!fullName) {
            status = 'error'
            statusDetail = 'Не указано ФИО'
          } else if (!email) {
            status = 'error'
            statusDetail = 'Не указан email'
          } else if (!validateEmail(email)) {
            status = 'error'
            statusDetail = 'Некорректный формат email'
          } else if (!password) {
            status = 'error'
            statusDetail = 'Не указан пароль'
          } else if (password.length < 6) {
            status = 'error'
            statusDetail = 'Пароль должен содержать минимум 6 символов'
          } else if (seenEmails.has(email)) {
            status = 'duplicate_email'
            statusDetail = STATUS_LABELS.duplicate_email
          } else if (existingEmails.has(email)) {
            status = 'conflict_email'
            statusDetail = STATUS_LABELS.conflict_email
          } else {
            seenEmails.add(email)
            const existing = existingByInn.get(inn)
            if (existing) {
              status = 'existing_counterparty'
              statusDetail = `Привязан к: ${existing.name}`
              existingCounterpartyId = existing.id
            } else {
              status = 'new_counterparty'
              statusDetail = STATUS_LABELS.new_counterparty
            }
          }

          rows.push({
            key: i,
            counterpartyName,
            inn,
            fullName,
            email,
            password,
            status,
            statusDetail,
            existingCounterpartyId,
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

  // Статистика по строкам
  const stats = useMemo(() => {
    const ready = parsedRows.filter(
      (r) => r.status === 'new_counterparty' || r.status === 'existing_counterparty'
    ).length
    const skipped = parsedRows.filter(
      (r) => r.status === 'conflict_email' || r.status === 'duplicate_email'
    ).length
    const errors = parsedRows.filter((r) => r.status === 'error').length
    return { ready, skipped, errors, total: parsedRows.length }
  }, [parsedRows])

  // Запуск импорта
  const handleImport = async () => {
    const readyRows = parsedRows.filter(
      (r) => r.status === 'new_counterparty' || r.status === 'existing_counterparty'
    )
    if (readyRows.length === 0) {
      message.warning('Нет записей для импорта')
      return
    }

    setIsImporting(true)
    setProgress({ done: 0, total: readyRows.length })

    try {
      // Уникальные новые подрядчики (по ИНН)
      const newCounterpartyRows = readyRows
        .filter((r) => r.status === 'new_counterparty')
        .reduce<{ name: string; inn: string }[]>((acc, r) => {
          if (!acc.find((a) => a.inn === r.inn)) {
            acc.push({ name: r.counterpartyName, inn: r.inn })
          }
          return acc
        }, [])

      // Маппинг ИНН → ID (начинаем с существующих)
      const innToId = new Map<string, string>(
        readyRows
          .filter((r) => r.existingCounterpartyId)
          .map((r) => [r.inn, r.existingCounterpartyId!])
      )

      // Создаём новых подрядчиков и добавляем ID в маппинг
      if (newCounterpartyRows.length > 0) {
        const created = await createCounterpartiesForImport(newCounterpartyRows)
        created.forEach(({ inn, id }) => innToId.set(inn, id))
        await fetchCounterparties()
      }

      // Формируем строки для создания пользователей
      const userRows = readyRows
        .filter((r) => innToId.has(r.inn))
        .map((r) => ({
          counterpartyId: innToId.get(r.inn)!,
          email: r.email,
          password: r.password,
          fullName: r.fullName,
        }))

      const results = await batchCreateCounterpartyUsers(userRows, (done, total) => {
        setProgress({ done, total })
      })

      // Собираем итоговые результаты
      const finalResults: ImportResult[] = results.map((r, i) => ({
        email: r.email,
        counterpartyName: readyRows[i].counterpartyName,
        result: r,
      }))

      setImportResults(finalResults)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка импорта')
    } finally {
      setIsImporting(false)
    }
  }

  const handleClose = () => {
    setParsedRows([])
    setImportResults(null)
    setProgress({ done: 0, total: 0 })
    setIsImporting(false)
    onClose()
  }

  // Колонки таблицы предпросмотра
  const previewColumns = [
    {
      title: 'Подрядчик',
      dataIndex: 'counterpartyName',
      key: 'counterpartyName',
      ellipsis: true,
      render: (name: string, record: ParsedRow) => (
        <Text type={record.status === 'error' ? 'danger' : undefined}>{name || '—'}</Text>
      ),
    },
    { title: 'ИНН', dataIndex: 'inn', key: 'inn', width: 130 },
    { title: 'ФИО', dataIndex: 'fullName', key: 'fullName', ellipsis: true },
    { title: 'Email', dataIndex: 'email', key: 'email', ellipsis: true },
    {
      title: 'Пароль',
      key: 'password',
      width: 80,
      render: () => <Text type="secondary">••••••</Text>,
    },
    {
      title: 'Статус',
      key: 'status',
      width: 260,
      render: (_: unknown, record: ParsedRow) => (
        <Tag color={STATUS_COLORS[record.status]}>{record.statusDetail}</Tag>
      ),
    },
  ]

  // Колонки таблицы результатов
  const resultColumns = [
    { title: 'Email', dataIndex: 'email', key: 'email' },
    { title: 'Подрядчик', dataIndex: 'counterpartyName', key: 'counterpartyName', ellipsis: true },
    {
      title: 'Результат',
      key: 'result',
      render: (_: unknown, record: ImportResult) => {
        if (record.result.status === 'success') return <Tag color="green">Создан</Tag>
        return <Tag color="red">{record.result.errorMessage || 'Ошибка'}</Tag>
      },
    },
  ]

  // Определяем footer в зависимости от текущего состояния
  const modalFooter = importResults ? (
    <Button onClick={handleClose}>Закрыть</Button>
  ) : parsedRows.length > 0 ? (
    <Space>
      <Button onClick={handleClose} disabled={isImporting}>
        Отмена
      </Button>
      <Button
        type="primary"
        onClick={handleImport}
        loading={isImporting}
        disabled={stats.ready === 0}
      >
        Импортировать ({stats.ready})
      </Button>
    </Space>
  ) : (
    <Button onClick={handleClose}>Отмена</Button>
  )

  const modalTitle = importResults ? 'Результаты импорта' : 'Импорт пользователей-подрядчиков'

  return (
    <Modal
      title={modalTitle}
      open={open}
      onCancel={handleClose}
      footer={modalFooter}
      width={1000}
      destroyOnClose
    >
      {/* Шаг 1: загрузка файла */}
      {parsedRows.length === 0 && !importResults && (
        <>
          <Upload.Dragger
            accept=".xlsx,.xls"
            beforeUpload={handleFile}
            showUploadList={false}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Перетащите файл Excel или нажмите для выбора</p>
            <p className="ant-upload-hint">
              Столбцы: Название подрядчика, ИНН, ФИО, Email, Пароль
            </p>
          </Upload.Dragger>
          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <Button icon={<DownloadOutlined />} size="small" onClick={handleDownloadTemplate}>
              Скачать шаблон
            </Button>
          </div>
        </>
      )}

      {/* Шаг 2: предпросмотр */}
      {parsedRows.length > 0 && !importResults && (
        <>
          <Space style={{ marginBottom: 16 }} wrap>
            <Tag>Всего: {stats.total}</Tag>
            <Tag color="blue">Будет создано: {stats.ready}</Tag>
            {stats.skipped > 0 && <Tag color="orange">Пропущено: {stats.skipped}</Tag>}
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
            columns={previewColumns}
            dataSource={parsedRows}
            rowKey="key"
            size="small"
            pagination={{ pageSize: 50 }}
            scroll={{ y: 400 }}
          />
        </>
      )}

      {/* Шаг 3: результаты */}
      {importResults && (
        <>
          <Space style={{ marginBottom: 16 }} wrap>
            <Tag color="green">
              Создано: {importResults.filter((r) => r.result.status === 'success').length}
            </Tag>
            <Tag color="red">
              Ошибок: {importResults.filter((r) => r.result.status === 'error').length}
            </Tag>
          </Space>
          <Table
            columns={resultColumns}
            dataSource={importResults}
            rowKey="email"
            size="small"
            pagination={{ pageSize: 50 }}
            scroll={{ y: 400 }}
          />
        </>
      )}
    </Modal>
  )
}

export default ImportCounterpartyUsersModal
