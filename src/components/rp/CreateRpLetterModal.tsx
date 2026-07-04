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
  Image,
  Space,
  App,
} from 'antd'
import {
  UploadOutlined,
  CheckCircleTwoTone,
  CloseCircleTwoTone,
  LoadingOutlined,
  PaperClipOutlined,
  DeleteOutlined,
  EyeOutlined,
  DownloadOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useRpStore } from '@/store/rpStore'
import { useAuthStore } from '@/store/authStore'
import { api } from '@/services/api'
import { uploadRpLetterFile } from '@/services/s3'
import { logError } from '@/services/errorLogger'
import { buildRpLetterContent } from '@/components/rp/rpLetterContent'
import { svgDataUrlToPngDataUrl, downloadDataUrl } from '@/utils/qrToPng'
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
 * Модалка создания РП, шаг 2: форма письма PayHub. Два этапа:
 *   1 этап — синхронно создаётся письмо в PayHub, возвращаются рег.номер и QR (PNG);
 *   2 этап — к письму догружаются приложенные файлы и (при правке) перезаписывается текст.
 * Между этапами отмена/крестик удаляют черновое письмо в PayHub. Если PayHub не готов —
 * 1 этап откатывается на старый асинхронный путь (без QR).
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
  const createLetterStage1 = useRpStore((s) => s.createLetterStage1)
  const registerLetterAttachments = useRpStore((s) => s.registerLetterAttachments)
  const finalizeLetter = useRpStore((s) => s.finalizeLetter)
  const deleteRp = useRpStore((s) => s.deleteRp)

  const [sender, setSender] = useState<RpSender | null>(null)
  /** Состояние загрузки настройки отправителя: сбой сети != «не настроен» */
  const [senderState, setSenderState] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [files, setFiles] = useState<File[]>([])
  const [fileStates, setFileStates] = useState<FileState[]>([])
  const [submitting, setSubmitting] = useState(false)
  /** РП с созданным письмом PayHub (1 этап sync) — дальше идёт 2 этап */
  const [createdRp, setCreatedRp] = useState<RpLetter | null>(null)
  /** Рег.номер письма PayHub (после 1 этапа) */
  const [regNumber, setRegNumber] = useState<string | null>(null)
  /** QR письма: PNG (для показа/скачивания) и исходный SVG (фолбэк) */
  const [qrPng, setQrPng] = useState<string | null>(null)
  const [qrSvg, setQrSvg] = useState<string | null>(null)
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
    setRegNumber(null)
    setQrPng(null)
    setQrSvg(null)
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
    setFileStates(next.map((_, i) => fileStates[i] ?? 'pending'))
  }

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index))
    setFileStates(fileStates.filter((_, i) => i !== index))
  }

  /** Просмотр локального (ещё не загруженного) файла в новой вкладке. */
  const previewFile = (file: File) => {
    const url = URL.createObjectURL(file)
    window.open(url, '_blank', 'noopener,noreferrer')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const collectValues = async (): Promise<LetterFormValues | null> => {
    try {
      return await form.validateFields()
    } catch {
      return null
    }
  }

  /** Готовит QR: сначала PNG (canvas), при сбое — исходный SVG. */
  const prepareQr = async (svgDataUrl: string | null) => {
    setQrSvg(svgDataUrl)
    setQrPng(null)
    if (!svgDataUrl) return
    try {
      setQrPng(await svgDataUrlToPngDataUrl(svgDataUrl))
    } catch (err) {
      logError({
        errorType: 'js_error',
        errorMessage: err instanceof Error ? err.message : 'Не удалось конвертировать QR в PNG',
        component: 'CreateRpLetterModal',
      })
    }
  }

  const handleDownloadQr = () => {
    const base = regNumber ? `QR_${regNumber}` : 'QR_письмо'
    if (qrPng) downloadDataUrl(qrPng, `${base}.png`)
    else if (qrSvg) downloadDataUrl(qrSvg, `${base}.svg`)
  }

  /** Последовательная загрузка файлов (пропускает уже загруженные при повторе). */
  const uploadFiles = async (
    rpId: string,
    states: FileState[],
  ): Promise<RpLetterAttachmentRef[]> => {
    const refs: RpLetterAttachmentRef[] = []
    for (let i = 0; i < files.length; i++) {
      if (states[i] === 'done') continue
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

  /** Текст письма из формы для finalize/PATCH. */
  const letterTextFrom = (values: LetterFormValues) => ({
    letterDate: values.letterDate.format('YYYY-MM-DD'),
    subject: values.subject.trim(),
    content: values.content.trim(),
    responsiblePersonName: values.responsiblePersonName.trim() || null,
  })

  /** 1 этап: создать РП и синхронно письмо PayHub (или откат на async). */
  const handleStage1 = async () => {
    if (!combo) return
    const values = await collectValues()
    if (!values) return
    setSubmitting(true)
    try {
      const res = await createLetterStage1({
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
      if (!res) return
      if (res.mode === 'sync') {
        setCreatedRp(res.rp)
        setRegNumber(res.regNumber)
        await prepareQr(res.qrSvgDataUrl)
        message.success(
          `Письмо создано${res.regNumber ? `: ${res.regNumber}` : ''}. Приложите файлы и завершите (2 этап).`,
        )
      } else {
        message.warning(
          'PayHub недоступен: QR недоступен, письмо синхронизируется автоматически позже.',
        )
        await completeAsyncFallback(res.rp)
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка создания письма')
    } finally {
      setSubmitting(false)
    }
  }

  /** async-fallback: письмо PayHub не создано — довершаем старым путём (файлы + finalize). */
  const completeAsyncFallback = async (rp: RpLetter) => {
    abortedRef.current = false
    if (files.length > 0) {
      const states = [...fileStates]
      const newRefs = await uploadFiles(rp.id, states)
      if (newRefs.length > 0) await registerLetterAttachments(rp.id, newRefs)
    }
    const ok = await finalizeLetter(rp.id)
    if (!ok) message.error('Не удалось отправить письмо в обработку — повторите из реестра РП')
    else message.success('РП создана, письмо синхронизируется автоматически')
    onCreated()
  }

  /** 2 этап: загрузка файлов + перезапись текста + постановка в очередь. */
  const finishStage2 = async (
    rp: RpLetter,
    values: LetterFormValues,
    refs: RpLetterAttachmentRef[],
    suffix = '',
  ) => {
    if (!registered && refs.length > 0) {
      await registerLetterAttachments(rp.id, refs)
      setRegistered(true)
    }
    const ok = await finalizeLetter(rp.id, letterTextFrom(values))
    if (!ok) {
      message.error('Не удалось завершить — повторите из реестра РП')
      return
    }
    message.success(`РП создана, файлы догружаются в письмо${suffix}`)
    onCreated()
  }

  const handleStage2 = async () => {
    if (!createdRp) return
    const values = await collectValues()
    if (!values) return
    setSubmitting(true)
    abortedRef.current = false
    try {
      const states = [...fileStates]
      const newRefs = files.length > 0 ? await uploadFiles(createdRp.id, states) : []
      const allRefs = [...uploadedRefs, ...newRefs]
      setUploadedRefs(allRefs)
      if (states.some((s) => s === 'error')) {
        message.warning('Часть файлов не загрузилась — повторите или отправьте без них')
        return
      }
      await finishStage2(createdRp, values, allRefs)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка завершения РП')
    } finally {
      setSubmitting(false)
    }
  }

  /** «Отправить без недогруженных файлов»: регистрируются только успешно загруженные. */
  const handleFinishWithoutFailed = async () => {
    if (!createdRp) return
    const values = await collectValues()
    if (!values) return
    setSubmitting(true)
    try {
      await finishStage2(createdRp, values, uploadedRefs, ' (без недогруженных файлов)')
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка отправки письма')
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    if (submitting) {
      modal.confirm({
        title: 'Прервать загрузку файлов?',
        content:
          'Недогруженные файлы не будут приложены. Письмо уже создано — завершить или удалить его можно в реестре РП.',
        okText: 'Прервать',
        okButtonProps: { danger: true },
        cancelText: 'Продолжить',
        onOk: () => {
          abortedRef.current = true
        },
      })
      return
    }
    // Письмо PayHub создано (1 этап), но 2 этап не завершён — удаляем письмо и черновик РП.
    if (createdRp) {
      modal.confirm({
        title: 'Отменить создание РП?',
        content: 'Письмо в PayHub будет удалено, черновик РП — тоже.',
        okText: 'Удалить',
        okButtonProps: { danger: true },
        cancelText: 'Не отменять',
        onOk: async () => {
          try {
            await deleteRp(createdRp.id)
            onClose()
          } catch (err) {
            message.error(
              err instanceof Error ? err.message : 'Не удалось удалить письмо в PayHub — повторите',
            )
          }
        },
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
      maskClosable={false}
      keyboard={false}
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
        <Button
          key="primary"
          type="primary"
          loading={submitting}
          onClick={createdRp ? handleStage2 : handleStage1}
        >
          {createdRp ? 'Создать РП, 2 этап' : 'Создать письмо, 1 этап'}
        </Button>,
      ]}
    >
      {!siteMapped && !createdRp && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Объект не сопоставлен с PayHub"
          description="Проект или заказчик PayHub не заданы в справочнике «Объекты строительства». Письмо и QR создать нельзя — РП будет создана, а письмо синхронизируется автоматически после заполнения сопоставления администратором."
        />
      )}
      {senderState === 'loaded' && !sender && !createdRp && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Отправитель РП не настроен (Администрирование → PayHub). Письмо синхронизируется после настройки."
        />
      )}
      {senderState === 'error' && !createdRp && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="Не удалось загрузить отправителя РП. РП можно создать — письмо синхронизируется автоматически."
        />
      )}
      {createdRp && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 12 }}
          message={`Письмо создано${regNumber ? `: ${regNumber}` : ''}`}
          description="Скачайте QR, вставьте его в документ письма, приложите файлы ниже и нажмите «Создать РП, 2 этап»."
        />
      )}

      <Form form={form} layout="vertical" disabled={submitting}>
        <Form.Item label="Направление">
          <Tag color="blue">Исходящее</Tag>
        </Form.Item>
        <Form.Item label="Проект">
          <Text>{projectLabel ?? <Text type="secondary">не сопоставлен</Text>}</Text>
        </Form.Item>
        <Form.Item label="Номер письма">
          <Input
            disabled
            value={regNumber ?? undefined}
            placeholder="Присваивается автоматически генератором PayHub"
          />
        </Form.Item>
        {createdRp && (qrPng || qrSvg) && (
          <Form.Item label="QR-код письма">
            <Space direction="vertical" size={8}>
              <Image
                src={qrPng ?? qrSvg ?? undefined}
                width={160}
                alt="QR-код письма PayHub"
                style={{ border: '1px solid #f0f0f0', background: '#fff' }}
              />
              <Button icon={<DownloadOutlined />} onClick={handleDownloadQr}>
                Скачать {qrPng ? 'PNG' : 'SVG'}
              </Button>
            </Space>
          </Form.Item>
        )}
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
            <Button icon={<UploadOutlined />} disabled={submitting}>
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
                !submitting
                  ? [
                      <Button
                        key="view"
                        type="text"
                        size="small"
                        icon={<EyeOutlined />}
                        title="Просмотр"
                        onClick={() => previewFile(file)}
                      />,
                      <Button
                        key="rm"
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        title="Убрать"
                        onClick={() => removeFile(i)}
                      />,
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
