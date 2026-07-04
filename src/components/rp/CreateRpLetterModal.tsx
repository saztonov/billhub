import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Modal,
  Button,
  Form,
  Input,
  DatePicker,
  Upload,
  Tag,
  Typography,
  Alert,
  List,
  App,
} from 'antd'
import {
  UploadOutlined,
  CheckCircleTwoTone,
  CloseCircleTwoTone,
  LoadingOutlined,
  PaperClipOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useRpStore } from '@/store/rpStore'
import { useAuthStore } from '@/store/authStore'
import { api } from '@/services/api'
import { uploadRpLetterFile } from '@/services/s3'
import { logError } from '@/services/errorLogger'
import { buildRpLetterContent } from '@/components/rp/rpLetterContent'
import type { RpCombo } from '@/components/rp/CreateRpModal'
import type { RpLetterAttachmentRef } from '@/store/rpStore'
import type { ConstructionSite, PaymentRequest, RpDocumentRef, RpLetter } from '@/types'

const { Text } = Typography

/** Лимиты файлов письма (сервер проверяет то же самое) */
const MAX_FILES = 20
const MAX_FILE_SIZE_MB = Number(import.meta.env.VITE_MAX_FILE_SIZE_MB) || 100
const ACCEPT_EXTENSIONS = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.tiff,.tif,.bmp,.dwg'

/** Отправитель РП из настройки администрирования */
interface RpSender {
  contractorId: string
  name: string | null
  inn: string | null
}

/** Статус загрузки одного файла */
type FileState = 'pending' | 'uploading' | 'done' | 'error'

interface LetterFormValues {
  letterDate: Dayjs
  subject: string
  content: string
  responsiblePersonName: string
}

interface CreateRpLetterModalProps {
  open: boolean
  combo: RpCombo | null
  requestIds: string[]
  /** Снимок документов из шага 1 (договор + учредительные) — сохраняется в составе РП */
  documents: RpDocumentRef[]
  /** Выбранные заявки — для автосборки содержания */
  selectedRequests: PaymentRequest[]
  /** Объект строительства (payhub-сопоставление: проект + заказчик) */
  site: ConstructionSite | undefined
  onClose: () => void
  /** РП создана (письмо может ещё синхронизироваться) — обновить реестр */
  onCreated: () => void
}

/**
 * Модалка создания РП, шаг 2: форма письма PayHub (по образцу формы письма PayHub).
 * Автозаполнение: исходящее, проект/получатель — из объекта, отправитель — из настройки,
 * дата — сегодня, тема «РП», содержание — сумма/поставщик/описания, ответственный — ФИО.
 * Редактируются только текстовые поля и файлы; участники и проект фиксированы.
 */
const CreateRpLetterModal = ({
  open,
  combo,
  requestIds,
  documents,
  selectedRequests,
  site,
  onClose,
  onCreated,
}: CreateRpLetterModalProps) => {
  const { message, modal } = App.useApp()
  const [form] = Form.useForm<LetterFormValues>()
  const fullName = useAuthStore((s) => s.user?.fullName)
  const createLetter = useRpStore((s) => s.createLetter)
  const registerLetterAttachments = useRpStore((s) => s.registerLetterAttachments)
  const finalizeLetter = useRpStore((s) => s.finalizeLetter)

  const [sender, setSender] = useState<RpSender | null>(null)
  /** Состояние загрузки настройки отправителя: сбой сети != «не настроен» */
  const [senderState, setSenderState] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [files, setFiles] = useState<File[]>([])
  const [fileStates, setFileStates] = useState<FileState[]>([])
  const [submitting, setSubmitting] = useState(false)
  /** РП уже создана (id) — дальше идёт этап файлов/finalize */
  const [createdRp, setCreatedRp] = useState<RpLetter | null>(null)
  /** Успешно загруженные, но ещё не зарегистрированные за РП файлы */
  const [uploadedRefs, setUploadedRefs] = useState<RpLetterAttachmentRef[]>([])
  /** Файлы уже зарегистрированы (защита от дублей при повторе finalize) */
  const [registered, setRegistered] = useState(false)
  /** Прерывание загрузки при закрытии модалки во время submitting (между файлами) */
  const abortedRef = useRef(false)

  const siteMapped = !!site?.payhubProjectId && !!site?.payhubContractorId

  // Сброс состояния и автозаполнение при каждом открытии.
  useEffect(() => {
    if (!open) return
    setFiles([])
    setFileStates([])
    setCreatedRp(null)
    setSubmitting(false)
    setUploadedRefs([])
    setRegistered(false)
    form.setFieldsValue({
      letterDate: dayjs(),
      subject: 'РП',
      content: buildRpLetterContent(selectedRequests),
      responsiblePersonName: fullName ?? '',
    })
    setSenderState('loading')
    api
      .get<{ sender: RpSender | null }>('/api/payhub/rp-sender')
      .then((data) => {
        setSender(data.sender)
        setSenderState('loaded')
      })
      .catch((err) => {
        setSender(null)
        setSenderState('error')
        logError({
          errorType: 'api_error',
          errorMessage: err instanceof Error ? err.message : 'Ошибка загрузки отправителя РП',
          component: 'CreateRpLetterModal',
        })
      })
  }, [open, form, fullName, selectedRequests])

  const projectLabel = useMemo(() => {
    if (!site?.payhubProjectId) return null
    const code = site.payhubProjectCode ? `${site.payhubProjectCode} — ` : ''
    return `${code}${site.payhubProjectName ?? site.payhubProjectId}`
  }, [site])

  const recipientLabel = useMemo(() => {
    if (!site?.payhubContractorId) return null
    const inn = site.payhubContractorInn ? ` (ИНН ${site.payhubContractorInn})` : ''
    return `${site.payhubContractorName ?? site.payhubContractorId}${inn}`
  }, [site])

  const addFiles = (incoming: File[]) => {
    const next = [...files]
    for (const f of incoming) {
      if (next.length >= MAX_FILES) {
        message.warning(`Не больше ${MAX_FILES} файлов`)
        break
      }
      if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        message.error(`«${f.name}» превышает лимит ${MAX_FILE_SIZE_MB} МБ`)
        continue
      }
      next.push(f)
    }
    setFiles(next)
    setFileStates(next.map(() => 'pending'))
  }

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index))
    setFileStates(fileStates.filter((_, i) => i !== index))
  }

  /** Последовательная загрузка файлов (пропускает уже загруженные при повторе). */
  const uploadFiles = async (
    rpId: string,
    states: FileState[],
  ): Promise<RpLetterAttachmentRef[]> => {
    const refs: RpLetterAttachmentRef[] = []
    for (let i = 0; i < files.length; i++) {
      if (states[i] === 'done') continue
      // Прервано закрытием модалки — оставшиеся файлы помечаем ошибкой и выходим.
      if (abortedRef.current) {
        states[i] = 'error'
        setFileStates([...states])
        continue
      }
      states[i] = 'uploading'
      setFileStates([...states])
      try {
        const { key } = await uploadRpLetterFile(rpId, files[i])
        refs.push({
          fileKey: key,
          fileName: files[i].name,
          mimeType: files[i].type || null,
          sizeBytes: files[i].size,
        })
        states[i] = 'done'
      } catch (err) {
        states[i] = 'error'
        logError({
          errorType: 'api_error',
          errorMessage: err instanceof Error ? err.message : 'Ошибка загрузки файла письма',
          errorStack: err instanceof Error ? err.stack : null,
          metadata: { action: 'uploadRpLetterFile', fileName: files[i].name },
        })
      }
      setFileStates([...states])
    }
    return refs
  }

  /** Завершение: регистрация загруженных файлов + постановка письма в очередь. */
  const finishLetter = async (rp: RpLetter, refs: RpLetterAttachmentRef[], suffix = '') => {
    if (!registered && refs.length > 0) {
      await registerLetterAttachments(rp.id, refs)
      setRegistered(true)
      setUploadedRefs([])
    }
    const ok = await finalizeLetter(rp.id)
    if (!ok) {
      message.error('Не удалось отправить письмо в обработку — повторите из реестра РП')
    } else {
      message.success(`РП создана, письмо отправлено в обработку${suffix}`)
    }
    onCreated()
  }

  const handleSubmit = async () => {
    if (!combo) return
    let values: LetterFormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSubmitting(true)
    abortedRef.current = false
    try {
      // Шаг 1: создание РП (письмо — снимком, синхронизация асинхронная).
      let rp = createdRp
      if (!rp) {
        rp = await createLetter({
          supplierId: combo.supplierId,
          counterpartyId: combo.counterpartyId,
          siteId: combo.siteId,
          paymentRequestIds: requestIds,
          documents,
          letterDate: values.letterDate.format('YYYY-MM-DD'),
          letter: {
            subject: values.subject.trim(),
            content: values.content.trim(),
            responsiblePersonName: values.responsiblePersonName.trim() || null,
            hasAttachments: files.length > 0,
          },
        })
        if (!rp) return
        setCreatedRp(rp)
      }

      // Шаг 2: файлы (если есть) + finalize.
      if (files.length === 0) {
        // hasAttachments=false — задача синхронизации поставлена сервером при создании
        message.success('РП создана, письмо отправлено в обработку')
        onCreated()
        return
      }
      const states = [...fileStates]
      const newRefs = await uploadFiles(rp.id, states)
      const allRefs = [...uploadedRefs, ...newRefs]
      setUploadedRefs(allRefs)
      if (states.some((s) => s === 'error')) {
        message.warning('Часть файлов не загрузилась — повторите или отправьте без них')
        return
      }
      await finishLetter(rp, allRefs)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка создания РП')
    } finally {
      setSubmitting(false)
    }
  }

  /** «Отправить без недогруженных файлов»: регистрируются только успешно загруженные. */
  const handleFinishWithoutFailed = async () => {
    if (!createdRp) return
    setSubmitting(true)
    try {
      await finishLetter(createdRp, uploadedRefs, ' (без недогруженных файлов)')
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка отправки письма')
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    // Во время загрузки — предложить прервать (между файлами), не запирать пользователя.
    if (submitting) {
      modal.confirm({
        title: 'Прервать загрузку файлов?',
        content:
          'Недогруженные файлы не будут приложены к письму. РП уже создана — письмо можно отправить кнопкой в реестре РП.',
        okText: 'Прервать',
        okButtonProps: { danger: true },
        cancelText: 'Продолжить',
        onOk: () => {
          abortedRef.current = true
          if (createdRp) onCreated()
          else onClose()
        },
      })
      return
    }
    if (createdRp) {
      modal.confirm({
        title: 'РП уже создана',
        content: 'Письмо ещё не отправлено в обработку. Отправить его можно кнопкой в реестре РП.',
        okText: 'Закрыть',
        cancelText: 'Остаться',
        onOk: () => onCreated(),
      })
      return
    }
    onClose()
  }

  const hasFailedFiles = fileStates.some((s) => s === 'error')

  const fileIcon = (state: FileState) => {
    if (state === 'uploading') return <LoadingOutlined />
    if (state === 'done') return <CheckCircleTwoTone twoToneColor="#52c41a" />
    if (state === 'error') return <CloseCircleTwoTone twoToneColor="#ff4d4f" />
    return <PaperClipOutlined />
  }

  return (
    <Modal
      open={open}
      title="Создание РП — письмо PayHub"
      width={680}
      centered
      style={{ maxHeight: '90vh' }}
      styles={{ body: { maxHeight: 'calc(90vh - 110px)', overflowY: 'auto' } }}
      onCancel={handleClose}
      footer={[
        <Button key="cancel" onClick={handleClose} disabled={submitting}>
          Отмена
        </Button>,
        hasFailedFiles && createdRp ? (
          <Button key="skip" onClick={handleFinishWithoutFailed} loading={submitting}>
            Отправить без недогруженных
          </Button>
        ) : null,
        <Button key="create" type="primary" loading={submitting} onClick={handleSubmit}>
          {createdRp ? 'Повторить' : `Создать (${requestIds.length})`}
        </Button>,
      ]}
    >
      {!siteMapped && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Объект не сопоставлен с PayHub"
          description="Проект или заказчик PayHub не заданы в справочнике «Объекты строительства». РП будет создана, а письмо — автоматически после заполнения сопоставления администратором."
        />
      )}
      {senderState === 'loaded' && !sender && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Отправитель РП не настроен (Администрирование → PayHub). РП будет создана, письмо — после настройки."
        />
      )}
      {senderState === 'error' && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="Не удалось загрузить отправителя РП. РП можно создать — письмо синхронизируется автоматически."
        />
      )}

      <Form form={form} layout="vertical" disabled={submitting || !!createdRp}>
        <Form.Item label="Направление">
          <Tag color="blue">Исходящее</Tag>
        </Form.Item>
        <Form.Item label="Проект">
          <Text>{projectLabel ?? <Text type="secondary">не сопоставлен</Text>}</Text>
        </Form.Item>
        <Form.Item label="Номер письма">
          <Input disabled placeholder="Присваивается автоматически генератором PayHub" />
        </Form.Item>
        <Form.Item
          label="Дата письма"
          name="letterDate"
          rules={[{ required: true, message: 'Укажите дату' }]}
        >
          <DatePicker format="DD.MM.YYYY" style={{ width: 200 }} allowClear={false} />
        </Form.Item>
        <Form.Item label="Отправитель">
          <Text>
            {sender ? (
              <>
                {sender.name ?? sender.contractorId}
                {sender.inn && <Text type="secondary"> (ИНН {sender.inn})</Text>}
              </>
            ) : senderState === 'loading' ? (
              <Text type="secondary">загрузка…</Text>
            ) : senderState === 'error' ? (
              <Text type="secondary">не удалось загрузить</Text>
            ) : (
              <Text type="secondary">не настроен</Text>
            )}
          </Text>
        </Form.Item>
        <Form.Item label="Получатель">
          <Text>{recipientLabel ?? <Text type="secondary">не сопоставлен</Text>}</Text>
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
        <Form.Item label="Файлы (прикрепляются к письму в PayHub)">
          <Upload
            multiple
            accept={ACCEPT_EXTENSIONS}
            fileList={[]}
            beforeUpload={(_file, fileList) => {
              // Ручной сбор File[]; Upload вызывает beforeUpload на каждый файл — батчим по первому.
              if (_file === fileList[0]) addFiles(fileList)
              return false
            }}
          >
            <Button icon={<UploadOutlined />} disabled={submitting || !!createdRp}>
              Добавить файлы
            </Button>
          </Upload>
        </Form.Item>
      </Form>

      {files.length > 0 && (
        <List
          size="small"
          dataSource={files.map((f, i) => ({ file: f, state: fileStates[i] ?? 'pending', i }))}
          renderItem={({ file, state, i }) => (
            <List.Item
              actions={
                !createdRp && !submitting
                  ? [
                      <Button key="rm" type="text" size="small" onClick={() => removeFile(i)}>
                        Убрать
                      </Button>,
                    ]
                  : undefined
              }
            >
              {fileIcon(state)}
              <Text style={{ marginLeft: 8 }} ellipsis>
                {file.name}
              </Text>
              <Text type="secondary" style={{ marginLeft: 8, flexShrink: 0 }}>
                {(file.size / (1024 * 1024)).toFixed(1)} МБ
              </Text>
            </List.Item>
          )}
        />
      )}
    </Modal>
  )
}

export default CreateRpLetterModal
