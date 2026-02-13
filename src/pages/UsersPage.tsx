import { Typography, Tabs } from 'antd'
import UsersTab from '@/components/users/UsersTab'
import DepartmentsTab from '@/components/departments/DepartmentsTab'

const { Title } = Typography

const UsersPage = () => {
  const items = [
    {
      key: 'users',
      label: 'Пользователи',
      children: <UsersTab />,
    },
    {
      key: 'departments',
      label: 'Подразделения',
      children: <DepartmentsTab />,
    },
  ]

  return (
    <div>
      <Title level={2} style={{ marginBottom: 16 }}>Пользователи</Title>
      <Tabs items={items} />
    </div>
  )
}

export default UsersPage
