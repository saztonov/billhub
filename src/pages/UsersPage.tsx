import { Tabs } from 'antd'
import UsersTab from '@/components/users/UsersTab'
import DepartmentsTab from '@/components/departments/DepartmentsTab'

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
      <Tabs items={items} />
    </div>
  )
}

export default UsersPage
