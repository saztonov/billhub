import { useEffect, useState, useCallback } from 'react'
import { Table, Checkbox, Button, Input } from 'antd'
import { PaperClipOutlined } from '@ant-design/icons'
import { useFoundingDocumentStore } from '@/store/foundingDocumentStore'
import { useTableScrollY } from '@/hooks/useTableScrollY'
import FoundingDocumentFilesModal from './FoundingDocumentFilesModal'
import type { FoundingDocumentRow } from '@/types'

interface Props {
  supplierId: string
}

/** Ячейка комментария с локальным состоянием — сохраняет по onBlur */
const CommentCell = ({
  initialValue,
  onSave,
}: {
  initialValue: string
  onSave: (value: string) => void
}) => {
  const [value, setValue] = useState(initialValue)

  return (
    <Input.TextArea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value !== initialValue) onSave(value)
      }}
      rows={1}
      autoSize={{ minRows: 1, maxRows: 3 }}
      style={{ resize: 'none' }}
    />
  )
}

const FoundingDocumentsTable = ({ supplierId }: Props) => {
  const { documents, isLoading, fetchDocuments, updateDocument } =
    useFoundingDocumentStore()

  // Состояние модалки файлов
  const [filesModal, setFilesModal] = useState<{
    open: boolean
    typeId: string
    typeName: string
    docId: string | null
  }>({ open: false, typeId: '', typeName: '', docId: null })

  useEffect(() => {
    fetchDocuments(supplierId)
  }, [supplierId, fetchDocuments])

  const handleCheckboxChange = useCallback(
    async (typeId: string, checked: boolean) => {
      await updateDocument(supplierId, typeId, { isAvailable: checked })
    },
    [supplierId, updateDocument]
  )

  const handleCommentSave = useCallback(
    async (typeId: string, value: string) => {
      await updateDocument(supplierId, typeId, { comment: value })
    },
    [supplierId, updateDocument]
  )

  const openFilesModal = useCallback(
    (row: FoundingDocumentRow) => {
      setFilesModal({
        open: true,
        typeId: row.typeId,
        typeName: row.typeName,
        docId: row.docId,
      })
    },
    []
  )

  const columns = [
    {
      title: '№',
      key: 'index',
      width: 50,
      render: (_: unknown, __: unknown, index: number) => index + 1,
    },
    {
      title: 'Вид документа',
      dataIndex: 'typeName',
      key: 'typeName',
    },
    {
      title: 'Есть',
      dataIndex: 'isAvailable',
      key: 'isAvailable',
      width: 70,
      align: 'center' as const,
      render: (val: boolean, record: FoundingDocumentRow) => (
        <Checkbox
          checked={val}
          onChange={(e) => handleCheckboxChange(record.typeId, e.target.checked)}
        />
      ),
    },
    {
      title: 'ФИО ответственного',
      dataIndex: 'checkedByName',
      key: 'checkedByName',
      width: 200,
      ellipsis: true,
      render: (val: string | null, record: FoundingDocumentRow) =>
        record.isAvailable ? val : null,
    },
    {
      title: 'Файлы',
      key: 'files',
      width: 100,
      align: 'center' as const,
      render: (_: unknown, record: FoundingDocumentRow) => (
        <Button
          type="link"
          size="small"
          icon={<PaperClipOutlined />}
          onClick={() => openFilesModal(record)}
        >
          {record.fileCount > 0 ? record.fileCount : null}
        </Button>
      ),
    },
    {
      title: 'Комментарий',
      key: 'comment',
      render: (_: unknown, record: FoundingDocumentRow) => (
        <CommentCell
          key={`${record.typeId}-${record.comment}`}
          initialValue={record.comment}
          onSave={(val) => handleCommentSave(record.typeId, val)}
        />
      ),
    },
  ]

  const { containerRef, scrollY } = useTableScrollY([documents.length])

  return (
    <>
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }}>
        <Table
          columns={columns}
          dataSource={documents}
          rowKey="typeId"
          loading={isLoading}
          scroll={{ x: 800, y: scrollY }}
          pagination={false}
          size="small"
          locale={{ emptyText: 'Нет видов учредительных документов. Добавьте их в Администрировании -> Типы документов' }}
        />
      </div>
      <FoundingDocumentFilesModal
        open={filesModal.open}
        onClose={() => setFilesModal((prev) => ({ ...prev, open: false }))}
        supplierId={supplierId}
        typeId={filesModal.typeId}
        typeName={filesModal.typeName}
        docId={filesModal.docId}
      />
    </>
  )
}

export default FoundingDocumentsTable
