import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Button, Form, App } from 'antd'
import dayjs from 'dayjs'
import { useRpStore } from '@/store/rpStore'
import { useAuthStore } from '@/store/authStore'
import { api } from '@/services/api'
import { uploadRpLetterFile, uploadRpServiceFile } from '@/services/s3'
import { logError } from '@/services/errorLogger'
import { buildRpLetterContent } from '@/components/rp/rpLetterContent'
import { svgDataUrlToPngDataUrl, downloadDataUrl, dataUrlToFile } from '@/utils/qrToPng'
import FilePreviewModal from '@/components/paymentRequests/FilePreviewModal'
import AttachInvoiceFilesModal, {
  type SelectedInvoiceFile,
} from '@/components/rp/AttachInvoiceFilesModal'
import RpLetterFormBody, {
  type LetterFormValues,
  type FileState,
  type RpSender,
} from '@/components/rp/RpLetterFormBody'
import { getMimeFromFileName } from '@/utils/mimeFromExtension'
import type { RpCombo } from '@/components/rp/CreateRpModal'
import type { RpLetterAttachmentRef } from '@/store/rpStore'
import type {
  ConstructionSite,
  PaymentRequest,
  RpDocumentRef,
  RpLetter,
  RpAttachmentType,
} from '@/types'

/** Лимиты файлов письма (сервер проверяет то же самое) */
const MAX_FILES = 20
const MAX_FILE_SIZE_MB = Number(import.meta.env.VITE_MAX_FILE_SIZE_MB) || 100

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
  const registerServiceFiles = useRpStore((s) => s.registerServiceFiles)
  const finalizeLetter = useRpStore((s) => s.finalizeLetter)
  const attachInvoiceServiceFiles = useRpStore((s) => s.attachInvoiceServiceFiles)
  const deleteRp = useRpStore((s) => s.deleteRp)

  const [sender, setSender] = useState<RpSender | null>(null)
  /** Состояние загрузки настройки отправителя: сбой сети != «не настроен» */
  const [senderState, setSenderState] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [files, setFiles] = useState<File[]>([])
  const [fileStates, setFileStates] = useState<FileState[]>([])
  /** Тип каждого файла (параллельно files): 'rp' — скан чистовика, 'other' — прочие. */
  const [fileTypes, setFileTypes] = useState<RpAttachmentType[]>([])
  /** Локальный файл для предпросмотра в модалке (не открываем новую вкладку). */
  const [previewLocal, setPreviewLocal] = useState<File | null>(null)
  /** Выбранные счета заявок (прикрепляются как служебные файлы РП при завершении). */
  const [selectedInvoices, setSelectedInvoices] = useState<SelectedInvoiceFile[]>([])
  /** Открыто окно выбора счетов «+ Файл». */
  const [invoicePickerOpen, setInvoicePickerOpen] = useState(false)
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
    setFileTypes([])
    setPreviewLocal(null)
    setSelectedInvoices([])
    setInvoicePickerOpen(false)
    setCreatedRp(null)
    setRegNumber(null)
    setQrPng(null)
    setQrSvg(null)
    setSubmitting(false)
    setUploadedRefs([])
    setRegistered(false)
    form.setFieldsValue({
      letterDate: dayjs(),
      invoiceNumber: '',
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
    const nextTypes = [...fileTypes]
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
      nextTypes.push('other')
    }
    setFiles(next)
    setFileTypes(nextTypes)
    setFileStates(next.map((_, i) => fileStates[i] ?? 'pending'))
  }

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index))
    setFileTypes(fileTypes.filter((_, i) => i !== index))
    setFileStates(fileStates.filter((_, i) => i !== index))
  }

  const removeInvoice = (index: number) => {
    setSelectedInvoices((prev) => prev.filter((_, i) => i !== index))
  }

  /** Смена типа файла; выбор «РП» сбрасывает прежний файл «РП» в «Другой» (не более одного). */
  const setFileType = (index: number, type: RpAttachmentType) => {
    setFileTypes((prev) =>
      prev.map((t, i) => {
        if (i === index) return type
        if (type === 'rp' && t === 'rp') return 'other'
        return t
      }),
    )
  }

  const collectValues = async (): Promise<LetterFormValues | null> => {
    try {
      return await form.validateFields()
    } catch {
      return null
    }
  }

  /**
   * Готовит QR: сначала PNG (canvas), при сбое — исходный SVG. Возвращает фактически
   * подготовленный data-URL и формат (чтобы сохранить QR без чтения асинхронного стейта).
   */
  const prepareQr = async (
    svgDataUrl: string | null,
  ): Promise<{ dataUrl: string; ext: 'png' | 'svg' } | null> => {
    setQrSvg(svgDataUrl)
    setQrPng(null)
    if (!svgDataUrl) return null
    try {
      const png = await svgDataUrlToPngDataUrl(svgDataUrl)
      setQrPng(png)
      return { dataUrl: png, ext: 'png' }
    } catch (err) {
      logError({
        errorType: 'js_error',
        errorMessage: err instanceof Error ? err.message : 'Не удалось конвертировать QR в PNG',
        component: 'CreateRpLetterModal',
      })
      return { dataUrl: svgDataUrl, ext: 'svg' }
    }
  }

  /**
   * Сохраняет QR письма в служебные файлы РП. Best-effort: сбой не срывает создание РП.
   * При отмене черновика существующая очистка РП удалит и этот файл.
   */
  const saveQrServiceFile = async (
    rpId: string,
    regNumberValue: string | null,
    qr: { dataUrl: string; ext: 'png' | 'svg' },
  ) => {
    try {
      const base = regNumberValue ? `QR_${regNumberValue}` : 'QR_письмо'
      const file = dataUrlToFile(qr.dataUrl, `${base}.${qr.ext}`)
      const { key } = await uploadRpServiceFile(rpId, file)
      await registerServiceFiles(rpId, [
        { fileKey: key, fileName: file.name, mimeType: file.type || null, sizeBytes: file.size },
      ])
    } catch (err) {
      message.warning('QR не сохранён в служебные файлы — при необходимости добавьте вручную')
      logError({
        errorType: 'api_error',
        errorMessage:
          err instanceof Error ? err.message : 'Не удалось сохранить QR в служебные файлы',
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'saveQrServiceFile', rpId },
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
          fileType: fileTypes[i] ?? 'other',
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

  /**
   * Прикрепить выбранные счета заявок к РП как служебные файлы (в PayHub не уходят).
   * Идемпотентно на сервере; сбой не срывает создание РП — предупреждаем.
   */
  const attachSelectedInvoices = async (rpId: string) => {
    if (selectedInvoices.length === 0) return
    try {
      await attachInvoiceServiceFiles(
        rpId,
        selectedInvoices.map((f) => f.id),
      )
    } catch (err) {
      message.warning('РП создана, но счета не прикрепились — добавьте их вручную в «Файлы РП»')
      logError({
        errorType: 'api_error',
        errorMessage: err instanceof Error ? err.message : 'Ошибка прикрепления счетов к РП',
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'attachInvoiceServiceFiles', rpId },
      })
    }
  }

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
        invoiceNumber: values.invoiceNumber.trim() || null,
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
        const qr = await prepareQr(res.qrSvgDataUrl)
        // Сохраняем QR в служебные файлы РП (best-effort, не блокирует создание).
        if (qr) await saveQrServiceFile(res.rp.id, res.regNumber, qr)
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
    await attachSelectedInvoices(rp.id)
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
    await attachSelectedInvoices(rp.id)
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
      <RpLetterFormBody
        form={form}
        submitting={submitting}
        siteMapped={siteMapped}
        hasCreatedRp={!!createdRp}
        regNumber={regNumber}
        sender={sender}
        senderState={senderState}
        projectLabel={projectLabel}
        recipientLabel={recipientLabel}
        qrPng={qrPng}
        qrSvg={qrSvg}
        onDownloadQr={handleDownloadQr}
        selectedInvoices={selectedInvoices}
        onOpenInvoicePicker={() => setInvoicePickerOpen(true)}
        onRemoveInvoice={removeInvoice}
        files={files}
        fileStates={fileStates}
        fileTypes={fileTypes}
        onAddFiles={addFiles}
        onSetFileType={setFileType}
        onPreviewFile={setPreviewLocal}
        onRemoveFile={removeFile}
      />
      <FilePreviewModal
        open={!!previewLocal}
        onClose={() => setPreviewLocal(null)}
        fileKey={null}
        file={previewLocal}
        fileName={previewLocal?.name ?? ''}
        mimeType={previewLocal ? previewLocal.type || getMimeFromFileName(previewLocal.name) : null}
      />
      <AttachInvoiceFilesModal
        open={invoicePickerOpen}
        requestIds={requestIds}
        initialSelectedIds={selectedInvoices.map((f) => f.id)}
        onClose={() => setInvoicePickerOpen(false)}
        onAttach={(files) => {
          setSelectedInvoices(files)
          setInvoicePickerOpen(false)
        }}
      />
    </Modal>
  )
}

export default CreateRpLetterModal
