import {
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
  Select,
} from 'antd'
import type { FormInstance } from 'antd'
import {
  UploadOutlined,
  CheckCircleTwoTone,
  CloseCircleTwoTone,
  LoadingOutlined,
  PaperClipOutlined,
  DeleteOutlined,
  EyeOutlined,
  DownloadOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import type { RpAttachmentType } from '@/types'
import type { SelectedInvoiceFile } from '@/components/rp/AttachInvoiceFilesModal'

const { Text } = Typography

/** Значения формы письма PayHub. */
export interface LetterFormValues {
  letterDate: Dayjs
  invoiceNumber: string
  subject: string
  content: string
  responsiblePersonName: string
}

/** Статус загрузки одного файла письма. */
export type FileState = 'pending' | 'uploading' | 'done' | 'error'

/** Отправитель РП из настройки администрирования. */
export interface RpSender {
  contractorId: string
  name: string | null
  inn: string | null
}

/** Расширения файлов письма (сервер проверяет то же). */
const ACCEPT_EXTENSIONS = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.tiff,.tif,.bmp,.dwg'

const fileIcon = (state: FileState) => {
  if (state === 'uploading') return <LoadingOutlined />
  if (state === 'done') return <CheckCircleTwoTone twoToneColor="#52c41a" />
  if (state === 'error') return <CloseCircleTwoTone twoToneColor="#ff4d4f" />
  return <PaperClipOutlined />
}

interface RpLetterFormBodyProps {
  form: FormInstance<LetterFormValues>
  submitting: boolean
  siteMapped: boolean
  /** РП с письмом создана (1 этап пройден) — влияет на алерты/QR. */
  hasCreatedRp: boolean
  regNumber: string | null
  sender: RpSender | null
  senderState: 'loading' | 'loaded' | 'error'
  projectLabel: string | null
  recipientLabel: string | null
  qrPng: string | null
  qrSvg: string | null
  onDownloadQr: () => void
  selectedInvoices: SelectedInvoiceFile[]
  onOpenInvoicePicker: () => void
  onRemoveInvoice: (index: number) => void
  files: File[]
  fileStates: FileState[]
  fileTypes: RpAttachmentType[]
  onAddFiles: (files: File[]) => void
  onSetFileType: (index: number, type: RpAttachmentType) => void
  onPreviewFile: (file: File) => void
  onRemoveFile: (index: number) => void
}

/**
 * Тело модалки создания РП (шаг 2): алерты состояния, форма письма PayHub,
 * список выбранных счетов заявок и список прикладываемых к письму файлов.
 * Вынесено из CreateRpLetterModal (лимит 600 строк на файл).
 */
const RpLetterFormBody = ({
  form,
  submitting,
  siteMapped,
  hasCreatedRp,
  regNumber,
  sender,
  senderState,
  projectLabel,
  recipientLabel,
  qrPng,
  qrSvg,
  onDownloadQr,
  selectedInvoices,
  onOpenInvoicePicker,
  onRemoveInvoice,
  files,
  fileStates,
  fileTypes,
  onAddFiles,
  onSetFileType,
  onPreviewFile,
  onRemoveFile,
}: RpLetterFormBodyProps) => {
  return (
    <>
      {!siteMapped && !hasCreatedRp && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Объект не сопоставлен с PayHub"
          description="Проект или заказчик PayHub не заданы в справочнике «Объекты строительства». Письмо и QR создать нельзя — РП будет создана, а письмо синхронизируется автоматически после заполнения сопоставления администратором."
        />
      )}
      {senderState === 'loaded' && !sender && !hasCreatedRp && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Отправитель РП не настроен (Администрирование → PayHub). Письмо синхронизируется после настройки."
        />
      )}
      {senderState === 'error' && !hasCreatedRp && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="Не удалось загрузить отправителя РП. РП можно создать — письмо синхронизируется автоматически."
        />
      )}
      {hasCreatedRp && (
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
        <Form.Item label="Номер счёта">
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="invoiceNumber" noStyle>
              <Input maxLength={100} placeholder="Номер счёта" allowClear />
            </Form.Item>
            <Button icon={<PlusOutlined />} disabled={submitting} onClick={onOpenInvoicePicker}>
              Файл
            </Button>
          </Space.Compact>
        </Form.Item>
        {selectedInvoices.length > 0 && (
          <Form.Item label="Счета из заявок (в служебные файлы РП)">
            <List
              size="small"
              dataSource={selectedInvoices}
              renderItem={(f, i) => (
                <List.Item
                  actions={
                    !submitting
                      ? [
                          <Button
                            key="rm"
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            title="Убрать"
                            onClick={() => onRemoveInvoice(i)}
                          />,
                        ]
                      : []
                  }
                >
                  <PaperClipOutlined />
                  <Text style={{ marginLeft: 8 }} ellipsis>
                    {f.fileName}
                  </Text>
                  <Text type="secondary" style={{ marginLeft: 8, flexShrink: 0 }}>
                    Заявка {f.requestNumber}
                  </Text>
                </List.Item>
              )}
            />
          </Form.Item>
        )}
        {hasCreatedRp && (qrPng || qrSvg) && (
          <Form.Item label="QR-код письма">
            <Space direction="vertical" size={8}>
              <Image
                src={qrPng ?? qrSvg ?? undefined}
                width={160}
                alt="QR-код письма PayHub"
                style={{ border: '1px solid #f0f0f0', background: '#fff' }}
              />
              <Button icon={<DownloadOutlined />} onClick={onDownloadQr}>
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
              if (_file === fileList[0]) onAddFiles(fileList)
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
          dataSource={files.map((f, i) => ({
            file: f,
            state: fileStates[i] ?? 'pending',
            type: fileTypes[i] ?? 'other',
            i,
          }))}
          renderItem={({ file, state, type, i }) => (
            <List.Item
              actions={[
                <Select<RpAttachmentType>
                  key="type"
                  size="small"
                  value={type}
                  disabled={submitting}
                  style={{ width: 104 }}
                  onChange={(v) => onSetFileType(i, v)}
                  options={[
                    { value: 'other', label: 'Другой' },
                    { value: 'rp', label: 'РП' },
                  ]}
                />,
                ...(!submitting
                  ? [
                      <Button
                        key="view"
                        type="text"
                        size="small"
                        icon={<EyeOutlined />}
                        title="Просмотр"
                        onClick={() => onPreviewFile(file)}
                      />,
                      <Button
                        key="rm"
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        title="Убрать"
                        onClick={() => onRemoveFile(i)}
                      />,
                    ]
                  : []),
              ]}
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
    </>
  )
}

export default RpLetterFormBody
