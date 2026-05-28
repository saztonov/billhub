import { useState, useEffect } from 'react'
import { Select, Typography, Flex, Button, Input } from 'antd'
import { SettingOutlined } from '@ant-design/icons'
import { useSupplierStore } from '@/store/supplierStore'
import { useAuthStore } from '@/store/authStore'
import { useFoundingDocumentStore } from '@/store/foundingDocumentStore'
import FoundingDocumentsTable from './FoundingDocumentsTable'
import FoundingDocTypesModal from './FoundingDocTypesModal'

const { Text } = Typography

/**
 * Поле общего комментария по учредительным документам поставщика.
 * Контролируемое поле с авто-сохранением по onBlur и синхронизацией
 * со внешним значением при смене поставщика через «adjust state during render».
 */
const GeneralCommentInput = ({
  initialValue,
  onSave,
}: {
  initialValue: string
  onSave: (value: string) => void
}) => {
  const [value, setValue] = useState(initialValue)
  const [prevInitial, setPrevInitial] = useState(initialValue)
  const [isFocused, setIsFocused] = useState(false)

  if (initialValue !== prevInitial) {
    setPrevInitial(initialValue)
    if (!isFocused) {
      setValue(initialValue)
    }
  }

  return (
    <Input.TextArea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => {
        setIsFocused(false)
        if (value !== initialValue) onSave(value)
      }}
      placeholder="Общий комментарий по учредительным документам поставщика"
      autoSize={{ minRows: 2, maxRows: 6 }}
    />
  )
}

const FoundingDocumentsTab = () => {
  const { suppliers, fetchSuppliers } = useSupplierStore()
  const user = useAuthStore((s) => s.user)
  const fetchDocuments = useFoundingDocumentStore((s) => s.fetchDocuments)
  const generalComment = useFoundingDocumentStore((s) => s.generalComment)
  const fetchGeneralComment = useFoundingDocumentStore((s) => s.fetchGeneralComment)
  const updateGeneralComment = useFoundingDocumentStore((s) => s.updateGeneralComment)
  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [typesModalOpen, setTypesModalOpen] = useState(false)

  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    fetchSuppliers()
  }, [fetchSuppliers])

  // При смене поставщика подгружаем общий комментарий
  useEffect(() => {
    if (supplierId) {
      fetchGeneralComment(supplierId)
    }
  }, [supplierId, fetchGeneralComment])

  /** При закрытии модалки видов — обновляем таблицу, если выбран поставщик */
  const handleTypesModalClose = () => {
    setTypesModalOpen(false)
    if (supplierId) {
      fetchDocuments(supplierId)
    }
  }

  const handleGeneralCommentSave = (value: string) => {
    if (!supplierId) return
    updateGeneralComment(supplierId, value)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ marginBottom: 16, flexShrink: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Select
          placeholder="Выберите поставщика"
          value={supplierId}
          onChange={setSupplierId}
          showSearch
          optionFilterProp="label"
          allowClear
          style={{ width: 400 }}
          options={suppliers.map((s) => ({
            label: s.inn ? `${s.name} (ИНН: ${s.inn})` : s.name,
            value: s.id,
          }))}
        />
        {isAdmin && (
          <Button
            icon={<SettingOutlined />}
            onClick={() => setTypesModalOpen(true)}
          >
            Виды документов
          </Button>
        )}
      </div>
      {supplierId ? (
        <>
          <FoundingDocumentsTable supplierId={supplierId} />
          <div style={{ flexShrink: 0, marginTop: 12 }}>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>
              Общий комментарий
            </Text>
            <GeneralCommentInput
              key={supplierId}
              initialValue={generalComment}
              onSave={handleGeneralCommentSave}
            />
          </div>
        </>
      ) : (
        <Flex align="center" justify="center" style={{ flex: 1 }}>
          <Text type="secondary">Выберите поставщика для просмотра учредительных документов</Text>
        </Flex>
      )}
      {isAdmin && (
        <FoundingDocTypesModal
          open={typesModalOpen}
          onClose={handleTypesModalClose}
        />
      )}
    </div>
  )
}

export default FoundingDocumentsTab
