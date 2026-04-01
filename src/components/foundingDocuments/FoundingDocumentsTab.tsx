import { useState, useEffect } from 'react'
import { Select, Typography, Flex } from 'antd'
import { useSupplierStore } from '@/store/supplierStore'
import FoundingDocumentsTable from './FoundingDocumentsTable'

const { Text } = Typography

const FoundingDocumentsTab = () => {
  const { suppliers, fetchSuppliers } = useSupplierStore()
  const [supplierId, setSupplierId] = useState<string | null>(null)

  useEffect(() => {
    fetchSuppliers()
  }, [fetchSuppliers])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ marginBottom: 16, flexShrink: 0 }}>
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
      </div>
      {supplierId ? (
        <FoundingDocumentsTable supplierId={supplierId} />
      ) : (
        <Flex align="center" justify="center" style={{ flex: 1 }}>
          <Text type="secondary">Выберите поставщика для просмотра учредительных документов</Text>
        </Flex>
      )}
    </div>
  )
}

export default FoundingDocumentsTab
