import { useEffect, useState } from 'react'
import {
  Modal,
  Form,
  Input,
  DatePicker,
  App,
  Divider,
  Typography,
  List,
  Button,
  Empty,
  Spin,
} from 'antd'
import { PaperClipOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useRpStore } from '@/store/rpStore'
import type { RpLetterAttachmentRef } from '@/store/rpStore'
import { uploadRpLetterFile } from '@/services/s3'
import { logError } from '@/services/errorLogger'
import RpFilesDropModal, { type RpDropFile } from '@/components/rp/RpFilesDropModal'
import RpAttachmentTypeTag from '@/components/rp/RpAttachmentTypeTag'
import type { RpLetter, RpAttachmentView } from '@/types'

const { Text } = Typography

interface EditFormValues {
  letterDate: Dayjs
  subject: string
  content: string
  responsiblePersonName: string
}

interface EditRpLetterModalProps {
  open: boolean
  letter: RpLetter | null
  onClose: () => void
  onSaved: () => void
}

const fmtSize = (bytes: number | null) =>
  bytes != null ? `${(bytes / (1024 * 1024)).toFixed(1)} МБ` : ''

/**
 * Правка текста письма РП из реестра: дата, тема, содержание, ответственный.
 * Участники и проект не меняются. Если письмо уже создано в PayHub — сохранение
 * перезаписывает и его (PATCH на сервере). Дополнительно можно дозагрузить файлы к
 * письму (через площадку перетаскивания) — они уходят в PayHub фоново.
 */
const EditRpLetterModal = ({ open, letter, onClose, onSaved }: EditRpLetterModalProps) => {
  const { message } = App.useApp()
  const [form] = Form.useForm<EditFormValues>()
  const editLetterText = useRpStore((s) => s.editLetterText)
  const loadRpFiles = useRpStore((s) => s.loadRpFiles)
  const appendLetterAttachments = useRpStore((s) => s.appendLetterAttachments)
  const [submitting, setSubmitting] = useState(false)

  // Уже приложенные вложения письма PayHub (read-only, для контекста).
  const [attachments, setAttachments] = useState<RpAttachmentView[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [dropOpen, setDropOpen] = useState(false)

  // Письмо оформлялось (есть статус синхронизации) — только тогда можно дозагружать файлы.
  const canAddFiles = !!letter && letter.payhubLetterStatus !== null

  const reloadFiles = async (id: string) => {
    setFilesLoading(true)
    try {
      const res = await loadRpFiles(id)
      setAttachments(res.payhub)
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: err instanceof Error ? err.message : 'Ошибка загрузки файлов письма',
        component: 'EditRpLetterModal',
      })
      setAttachments([])
    } finally {
      setFilesLoading(false)
    }
  }

  useEffect(() => {
    if (!open || !letter) return
    form.setFieldsValue({
      letterDate: letter.letterDate ? dayjs(letter.letterDate) : dayjs(),
      subject: letter.payhubLetterPayload?.subject ?? '',
      content: letter.payhubLetterPayload?.content ?? '',
      responsiblePersonName: letter.payhubLetterPayload?.responsiblePersonName ?? '',
    })
    void reloadFiles(letter.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, letter, form])

  const handleSave = async () => {
    if (!letter) return
    let values: EditFormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSubmitting(true)
    try {
      await editLetterText(letter.id, {
        letterDate: values.letterDate.format('YYYY-MM-DD'),
        subject: values.subject.trim(),
        content: values.content.trim(),
        responsiblePersonName: values.responsiblePersonName.trim() || null,
      })
      message.success('Письмо обновлено')
      onSaved()
      onClose()
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Не удалось обновить письмо')
    } finally {
      setSubmitting(false)
    }
  }

  // Загрузка отобранных в площадке файлов и их регистрация за письмом (фоновая синхронизация).
  const handleUploadFiles = async (files: RpDropFile[]) => {
    if (!letter) return
    const refs: RpLetterAttachmentRef[] = []
    for (const f of files) {
      const { key } = await uploadRpLetterFile(letter.id, f.file)
      refs.push({
        fileKey: key,
        fileName: f.file.name,
        mimeType: f.file.type || null,
        sizeBytes: f.file.size,
        fileType: f.type,
      })
    }
    await appendLetterAttachments(letter.id, refs)
    message.success('Файлы добавлены, письмо синхронизируется')
    await reloadFiles(letter.id)
    onSaved()
  }

  return (
    <Modal
      open={open}
      title={`Редактирование письма${letter?.payhubLetterRegNumber ? ` ${letter.payhubLetterRegNumber}` : ''}`}
      width={640}
      centered
      okText="Сохранить"
      cancelText="Отмена"
      confirmLoading={submitting}
      onOk={handleSave}
      onCancel={onClose}
      styles={{ body: { maxHeight: 'calc(90vh - 110px)', overflowY: 'auto' } }}
    >
      <Form form={form} layout="vertical" disabled={submitting}>
        <Form.Item
          label="Дата письма"
          name="letterDate"
          rules={[{ required: true, message: 'Укажите дату' }]}
        >
          <DatePicker format="DD.MM.YYYY" style={{ width: 200 }} allowClear={false} />
        </Form.Item>
        <Form.Item
          label="Тема"
          name="subject"
          rules={[{ required: true, message: 'Укажите тему', whitespace: true }]}
        >
          <Input maxLength={500} />
        </Form.Item>
        <Form.Item label="Содержание" name="content">
          <Input.TextArea rows={3} maxLength={4000} showCount />
        </Form.Item>
        <Form.Item label="Ответственный" name="responsiblePersonName">
          <Input maxLength={200} />
        </Form.Item>
      </Form>

      <Divider style={{ margin: '4px 0 12px' }} />
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <Text strong>Файлы письма</Text>
        <Button
          size="small"
          icon={<PlusOutlined />}
          style={{ marginLeft: 'auto' }}
          disabled={submitting || !canAddFiles}
          onClick={() => setDropOpen(true)}
        >
          Добавить файлы
        </Button>
      </div>
      {!canAddFiles && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          Для этой РП письмо не оформлялось — добавить файлы нельзя.
        </Text>
      )}
      {filesLoading ? (
        <div style={{ textAlign: 'center', padding: 16 }}>
          <Spin />
        </div>
      ) : attachments.length > 0 ? (
        <List
          size="small"
          dataSource={attachments}
          renderItem={(f) => (
            <List.Item>
              <PaperClipOutlined />
              <Text style={{ marginLeft: 8 }} ellipsis>
                {f.fileName}
              </Text>
              <RpAttachmentTypeTag fileType={f.fileType} />
              <Text type="secondary" style={{ marginLeft: 8, flexShrink: 0 }}>
                {fmtSize(f.sizeBytes)}
              </Text>
            </List.Item>
          )}
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет файлов письма" />
      )}

      <RpFilesDropModal
        open={dropOpen}
        title="Добавить файлы к письму"
        withType
        onClose={() => setDropOpen(false)}
        onSubmit={handleUploadFiles}
      />
    </Modal>
  )
}

export default EditRpLetterModal
