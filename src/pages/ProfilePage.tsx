import { useState } from 'react'
import { Typography, Card, Descriptions, Form, Input, Button, App, Space } from 'antd'
import { useAuthStore } from '@/store/authStore'
import type { UserRole, Department } from '@/types'
import { DEPARTMENT_LABELS } from '@/types'

const { Title } = Typography

const roleLabels: Record<UserRole, string> = {
  admin: 'Администратор',
  user: 'Пользователь',
  counterparty_user: 'Подрядчик',
}

const ProfilePage = () => {
  const { message } = App.useApp()
  const user = useAuthStore((s) => s.user)
  const changeOwnPassword = useAuthStore((s) => s.changeOwnPassword)
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()

  const handlePasswordChange = async () => {
    const values = await form.validateFields()
    setLoading(true)
    try {
      await changeOwnPassword(values.current_password, values.new_password)
      message.success('Пароль успешно изменён')
      form.resetFields()
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка смены пароля')
    } finally {
      setLoading(false)
    }
  }

  if (!user) return null

  return (
    <div>
      <Title level={2} style={{ marginBottom: 24 }}>Личный кабинет</Title>
      <Space direction="vertical" size="large" style={{ width: '100%', maxWidth: 600 }}>
        <Card title="Информация о пользователе">
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="ФИО">{user.fullName || '—'}</Descriptions.Item>
            <Descriptions.Item label="Email">{user.email}</Descriptions.Item>
            <Descriptions.Item label="Роль">{roleLabels[user.role]}</Descriptions.Item>
            {user.department && (
              <Descriptions.Item label="Подразделение">
                {DEPARTMENT_LABELS[user.department as Department]}
              </Descriptions.Item>
            )}
          </Descriptions>
        </Card>

        <Card title="Смена пароля">
          <Form form={form} layout="vertical" style={{ maxWidth: 400 }}>
            <Form.Item
              name="current_password"
              label="Текущий пароль"
              rules={[{ required: true, message: 'Введите текущий пароль' }]}
            >
              <Input.Password />
            </Form.Item>
            <Form.Item
              name="new_password"
              label="Новый пароль"
              rules={[
                { required: true, message: 'Введите новый пароль' },
                { min: 6, message: 'Минимум 6 символов' },
              ]}
            >
              <Input.Password />
            </Form.Item>
            <Form.Item
              name="confirm_password"
              label="Подтверждение пароля"
              dependencies={['new_password']}
              rules={[
                { required: true, message: 'Подтвердите пароль' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('new_password') === value) return Promise.resolve()
                    return Promise.reject(new Error('Пароли не совпадают'))
                  },
                }),
              ]}
            >
              <Input.Password />
            </Form.Item>
            <Form.Item>
              <Button type="primary" onClick={handlePasswordChange} loading={loading}>
                Сменить пароль
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </Space>
    </div>
  )
}

export default ProfilePage
