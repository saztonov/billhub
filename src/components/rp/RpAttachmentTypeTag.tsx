import { Tag } from 'antd'

/** Тег типа вложения письма PayHub: 'rp' — синий «РП», иначе — нейтральный «Другой». */
const RpAttachmentTypeTag = ({ fileType }: { fileType: string }) => (
  <Tag color={fileType === 'rp' ? 'blue' : undefined} style={{ marginLeft: 8, flexShrink: 0 }}>
    {fileType === 'rp' ? 'РП' : 'Другой'}
  </Tag>
)

export default RpAttachmentTypeTag
