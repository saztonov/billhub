import { useState } from 'react'
import {
  Modal,
  Form,
  Input,
  Select,
  Checkbox,
  App,
} from 'antd'
import { useUserStore } from '@/store/userStore'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import type { UserRole } from '@/types'
import { DEPARTMENT_LABELS } from '@/types'

interface CreateUserModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

const CreateUserModal = ({ open, onClose, onSuccess }: CreateUserModalProps) => {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [selectedRole, setSelectedRole] = useState<UserRole>('user')
  const [allSitesChecked, setAllSitesChecked] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { createUser } = useUserStore()
  const { counterparties } = useCounterpartyStore()
  const { sites } = useConstructionSiteStore()

  const activeSites = sites.filter((s) => s.isActive)
  const showSiteFields = selectedRole !== 'counterparty_user'

  const handleSubmit = async () => {
    const values = await form.validateFields()
    setIsSubmitting(true)
    try {
      await createUser({
        email: values.email,
        password: values.password,
        full_name: values.full_name,
        role: values.role,
        counterparty_id: values.role === 'counterparty_user' ? values.counterparty_id : null,
        department: values.department || null,
        all_sites: values.role === 'counterparty_user' ? false : (values.all_sites ?? false),
        site_ids: values.role === 'counterparty_user' ? [] : (values.site_ids ?? []),
      })
      message.success('Пользователь создан')
      form.resetFields()
      setSelectedRole('user')
      setAllSitesChecked(false)
      onSuccess()
    } catch {
      message.error('Ошибка создания пользователя')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = () => {
    form.resetFields()
    setSelectedRole('user')
    setAllSitesChecked(false)
    onClose()
  }

  return (
    <Modal
      title="Новый пользователь"
      open={open}
      onOk={handleSubmit}
      onCancel={handleCancel}
      okText="Создать"
      cancelText="Отмена"
      confirmLoading={isSubmitting}
    >
      <Form form={form} layout="vertical" initialValues={{ role: 'user' }}>
        <Form.Item
          name="full_name"
          label="ФИО"
          rules={[{ required: true, message: 'Введите ФИО' }]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="email"
          label="Email"
          rules={[
            { required: true, message: 'Введите email' },
            { type: 'email', message: 'Некорректный email' },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="password"
          label="Пароль"
          rules={[
            { required: true, message: 'Введите пароль' },
            { min: 8, message: 'Минимум 8 символов' },
          ]}
        >
          <Input.Password />
        </Form.Item>
        <Form.Item
          name="password_confirm"
          label="Подтверждение пароля"
          dependencies={['password']}
          rules={[
            { required: true, message: 'Подтвердите пароль' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) {
                  return Promise.resolve()
                }
                return Promise.reject(new Error('Пароли не совпадают'))
              },
            }),
          ]}
        >
          <Input.Password />
        </Form.Item>
        <Form.Item
          name="role"
          label="Роль"
          rules={[{ required: true, message: 'Выберите роль' }]}
        >
          <Select onChange={(value: UserRole) => {
            setSelectedRole(value)
            if (value === 'counterparty_user') {
              setAllSitesChecked(false)
              form.setFieldsValue({ all_sites: false, site_ids: [] })
            }
          }}>
            <Select.Option value="admin">Администратор</Select.Option>
            <Select.Option value="user">Пользователь</Select.Option>
            <Select.Option value="counterparty_user">Подрядчик</Select.Option>
          </Select>
        </Form.Item>
        {selectedRole === 'counterparty_user' && (
          <Form.Item
            name="counterparty_id"
            label="Подрядчик"
            rules={[{ required: true, message: 'Выберите подрядчика' }]}
          >
            <Select
              placeholder="Выберите подрядчика"
              showSearch
              optionFilterProp="children"
            >
              {counterparties.map((c) => (
                <Select.Option key={c.id} value={c.id}>
                  {c.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        )}
        <Form.Item name="department" label="Подразделение">
          <Select
            placeholder="Выберите подразделение"
            allowClear
          >
            <Select.Option value="shtab">{DEPARTMENT_LABELS.shtab}</Select.Option>
            <Select.Option value="omts">{DEPARTMENT_LABELS.omts}</Select.Option>
            <Select.Option value="smetny">{DEPARTMENT_LABELS.smetny}</Select.Option>
          </Select>
        </Form.Item>
        {showSiteFields && (
          <>
            <Form.Item name="all_sites" valuePropName="checked">
              <Checkbox
                onChange={(e) => {
                  setAllSitesChecked(e.target.checked)
                  if (e.target.checked) {
                    form.setFieldsValue({ site_ids: [] })
                  }
                }}
              >
                Все объекты
              </Checkbox>
            </Form.Item>
            {!allSitesChecked && (
              <Form.Item name="site_ids" label="Объекты строительства">
                <Select
                  mode="multiple"
                  placeholder="Выберите объекты"
                  showSearch
                  optionFilterProp="children"
                  allowClear
                >
                  {activeSites.map((s) => (
                    <Select.Option key={s.id} value={s.id}>
                      {s.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            )}
          </>
        )}
      </Form>
    </Modal>
  )
}

export default CreateUserModal
