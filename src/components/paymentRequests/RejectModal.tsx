import { useState, useEffect } from 'react'
import { Modal, Input, Space, Upload, List, Button } from 'antd'
import { InboxOutlined, CloseOutlined } from '@ant-design/icons'

const { TextArea } = Input
const { Dragger } = Upload

const ACCEPT_EXTENSIONS = '.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.tiff,.tif,.bmp,.pdf'

interface RejectModalProps {
  open: boolean
  onConfirm: (comment: string, files: { id: string; file: File }[]) => void
  onCancel: () => void
}

const RejectModal = ({ open, onConfirm, onCancel }: RejectModalProps) => {
  const [comment, setComment] = useState('')
  const [files, setFiles] = useState<{ id: string; file: File }[]>([])

  useEffect(() => {
    if (!open) {
      setComment('')
      setFiles([])
    }
  }, [open])

  const handleOk = () => {
    if (!comment.trim()) return
    onConfirm(comment, files)
  }

  return (
    <Modal
      title="Отклонение заявки"
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText="Отклонить"
      okButtonProps={{ danger: true, disabled: !comment.trim() }}
      width={600}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <div>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>Комментарий *</div>
          <TextArea
            rows={3}
            placeholder="Укажите причину отклонения"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            status={!comment.trim() ? 'error' : undefined}
          />
        </div>
        <div>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>Прикрепить файлы (необязательно)</div>
          <Dragger
            accept={ACCEPT_EXTENSIONS}
            multiple
            fileList={[]}
            beforeUpload={(file) => {
              setFiles((prev) => [...prev, { id: crypto.randomUUID(), file }])
              return false
            }}
            showUploadList={false}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Нажмите или перетащите файлы</p>
            <p className="ant-upload-hint">Поддерживаются: PDF, изображения, Word, Excel</p>
          </Dragger>

          {files.length > 0 && (
            <List
              size="small"
              style={{ marginTop: 16 }}
              bordered
              dataSource={files}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button
                      type="text"
                      icon={<CloseOutlined />}
                      size="small"
                      onClick={() => setFiles((prev) => prev.filter((f) => f.id !== item.id))}
                    />,
                  ]}
                >
                  {item.file.name}
                </List.Item>
              )}
            />
          )}
        </div>
      </Space>
    </Modal>
  )
}

export default RejectModal
