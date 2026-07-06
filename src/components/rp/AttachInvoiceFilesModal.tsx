import { useEffect, useMemo, useState } from 'react'
import { Modal, Button, Checkbox, List, Typography, Empty, Spin, Space, App } from 'antd'
import { PaperClipOutlined } from '@ant-design/icons'
import { useRpStore } from '@/store/rpStore'
import { logError } from '@/services/errorLogger'
import type { RpInvoiceCandidateGroup } from '@/store/rpStore'

const { Text } = Typography

/** Выбранный счёт для прикрепления к РП (передаётся в форму создания). */
export interface SelectedInvoiceFile {
  id: string
  fileName: string
  requestNumber: string
}

interface AttachInvoiceFilesModalProps {
  open: boolean
  /** Заявки этой РП — источник кандидатов-счетов. */
  requestIds: string[]
  /** id уже выбранных счетов (для предвыбора чекбоксов при повторном открытии). */
  initialSelectedIds: string[]
  onClose: () => void
  /** Подтверждение выбора: полный список отмеченных счетов. */
  onAttach: (files: SelectedInvoiceFile[]) => void
}

const fmtSize = (bytes: number | null) =>
  bytes != null ? `${(bytes / (1024 * 1024)).toFixed(1)} МБ` : ''

/**
 * Окно «+ Файл»: активные (не зачёркнутые) счета выбранных заявок, сгруппированные по заявке,
 * с чекбоксами. «Прикрепить» возвращает выбранные счета в форму создания РП.
 */
const AttachInvoiceFilesModal = ({
  open,
  requestIds,
  initialSelectedIds,
  onClose,
  onAttach,
}: AttachInvoiceFilesModalProps) => {
  const { message } = App.useApp()
  const loadInvoiceCandidates = useRpStore((s) => s.loadInvoiceCandidates)

  const [groups, setGroups] = useState<RpInvoiceCandidateGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setChecked(new Set(initialSelectedIds))
    setLoading(true)
    loadInvoiceCandidates(requestIds)
      .then((data) => setGroups(data))
      .catch((err) => {
        setGroups([])
        message.error(err instanceof Error ? err.message : 'Ошибка загрузки счетов заявок')
        logError({
          errorType: 'api_error',
          errorMessage: err instanceof Error ? err.message : 'Ошибка загрузки счетов заявок',
          component: 'AttachInvoiceFilesModal',
        })
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const total = useMemo(() => groups.reduce((sum, g) => sum + g.files.length, 0), [groups])

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAttach = () => {
    const selected: SelectedInvoiceFile[] = []
    for (const g of groups) {
      for (const f of g.files) {
        if (checked.has(f.id)) {
          selected.push({ id: f.id, fileName: f.fileName, requestNumber: g.requestNumber })
        }
      }
    }
    onAttach(selected)
  }

  return (
    <Modal
      open={open}
      title="Счета из заявок"
      width={620}
      centered
      onCancel={onClose}
      styles={{ body: { maxHeight: 'calc(90vh - 110px)', overflowY: 'auto' } }}
      footer={[
        <Button key="cancel" onClick={onClose}>
          Отмена
        </Button>,
        <Button key="attach" type="primary" disabled={checked.size === 0} onClick={handleAttach}>
          Прикрепить ({checked.size})
        </Button>,
      ]}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : total === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Нет активных счетов в выбранных заявках"
        />
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {groups.map((g) => (
            <div key={g.requestId}>
              <Text strong>Заявка {g.requestNumber}</Text>
              <List
                size="small"
                dataSource={g.files}
                renderItem={(f) => (
                  <List.Item>
                    <Checkbox checked={checked.has(f.id)} onChange={() => toggle(f.id)}>
                      <Space size={6}>
                        <PaperClipOutlined />
                        <Text>{f.fileName}</Text>
                        <Text type="secondary">{fmtSize(f.sizeBytes)}</Text>
                      </Space>
                    </Checkbox>
                  </List.Item>
                )}
              />
            </div>
          ))}
        </Space>
      )}
    </Modal>
  )
}

export default AttachInvoiceFilesModal
