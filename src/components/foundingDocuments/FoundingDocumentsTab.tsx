import { useState, useEffect } from 'react'
import { Select, Typography, Flex, Button } from 'antd'
import { SettingOutlined } from '@ant-design/icons'
import { useSupplierStore } from '@/store/supplierStore'
import { useAuthStore } from '@/store/authStore'
import { useFoundingDocumentStore } from '@/store/foundingDocumentStore'
import FoundingDocumentsTable from './FoundingDocumentsTable'
import FoundingDocTypesModal from './FoundingDocTypesModal'

const { Text } = Typography

const FoundingDocumentsTab = () => {
  const { suppliers, fetchSuppliers } = useSupplierStore()
  const user = useAuthStore((s) => s.user)
  const fetchDocuments = useFoundingDocumentStore((s) => s.fetchDocuments)
  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [typesModalOpen, setTypesModalOpen] = useState(false)

  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    fetchSuppliers()
  }, [fetchSuppliers])

  /** При закрытии модалки видов — обновляем таблицу, если выбран поставщик */
  const handleTypesModalClose = () => {
    setTypesModalOpen(false)
    if (supplierId) {
      fetchDocuments(supplierId)
    }
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
          options={suppliers.map((s) => ({ label: s.name, value: s.id }))}
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
        <FoundingDocumentsTable supplierId={supplierId} />
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
