import { useEffect, useState } from 'react'
import { Modal, Form, Input, DatePicker, App } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useRpStore } from '@/store/rpStore'
import type { RpLetter } from '@/types'

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

/**
 * Правка текста письма РП из реестра: дата, тема, содержание, ответственный.
 * Участники и проект не меняются. Если письмо уже создано в PayHub — сохранение
 * перезаписывает и его (PATCH на сервере).
 */
const EditRpLetterModal = ({ open, letter, onClose, onSaved }: EditRpLetterModalProps) => {
  const { message } = App.useApp()
  const [form] = Form.useForm<EditFormValues>()
  const editLetterText = useRpStore((s) => s.editLetterText)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open || !letter) return
    form.setFieldsValue({
      letterDate: letter.letterDate ? dayjs(letter.letterDate) : dayjs(),
      subject: letter.payhubLetterPayload?.subject ?? '',
      content: letter.payhubLetterPayload?.content ?? '',
      responsiblePersonName: letter.payhubLetterPayload?.responsiblePersonName ?? '',
    })
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
    </Modal>
  )
}

export default EditRpLetterModal
