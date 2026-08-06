import { useEffect, useState } from 'react'
import { App, Checkbox, Form, Input, Modal, Select } from 'antd'
import { useUserStore, type UserRecord } from '@/store/userStore'
import { useAuthStore } from '@/store/authStore'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import type { Department, UserRole } from '@/types'
import { DEPARTMENT_LABELS } from '@/types'

interface EditUserModalProps {
  open: boolean
  record: UserRecord | null
  onClose: () => void
  onSaved: () => void
}

/** Канонизация адреса — та же, что на сервере (trim + lowercase). */
const canonicalEmail = (value: string | undefined): string => (value ?? '').trim().toLowerCase()

/**
 * Редактирование пользователя (профиль, роль, объекты) и смена email для входа.
 *
 * Смена email рвёт сессии пользователя, поэтому запрашивается отдельное подтверждение и только
 * при фактическом изменении адреса: правка одного лишь регистра сменой не считается (сервер
 * сравнивает адреса через lower()). В supabase-bridge поле недоступно — там логин хранится
 * в Supabase Auth, а не в таблице пользователей портала.
 */
const EditUserModal = ({ open, record, onClose, onSaved }: EditUserModalProps) => {
  const { message, modal } = App.useApp()
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [selectedRole, setSelectedRole] = useState<UserRole>('user')
  const [allSitesChecked, setAllSitesChecked] = useState(false)
  const [selectedDepartment, setSelectedDepartment] = useState<Department | null>(null)

  const updateUser = useUserStore((s) => s.updateUser)
  const currentUser = useAuthStore((s) => s.user)
  const authMode = useAuthStore((s) => s.authMode)
  const logout = useAuthStore((s) => s.logout)
  const counterparties = useCounterpartyStore((s) => s.counterparties)
  const sites = useConstructionSiteStore((s) => s.sites)

  const canEditEmail = authMode !== 'supabase-bridge'
  const showSiteFields = selectedRole !== 'counterparty_user' && selectedRole !== 'security'
  const isShtab = selectedDepartment === 'shtab'
  const activeSites = sites.filter((s) => s.isActive)

  useEffect(() => {
    if (!open || !record) return
    setSelectedRole(record.role)
    setAllSitesChecked(record.allSites)
    setSelectedDepartment(record.department || null)
    form.setFieldsValue({
      email: record.email,
      full_name: record.fullName,
      role: record.role,
      counterparty_id: record.counterpartyId,
      department: record.department,
      all_sites: record.allSites,
      site_ids: record.siteIds,
    })
  }, [open, record, form])

  const handleCancel = () => {
    setSelectedDepartment(null)
    form.resetFields()
    onClose()
  }

  /** Подтверждение смены логина: пользователь потеряет доступ по старому адресу. */
  const confirmEmailChange = (nextEmail: string): Promise<boolean> =>
    new Promise((resolve) => {
      modal.confirm({
        title: 'Сменить email для входа?',
        content: (
          <div>
            <div>
              Пользователь будет входить по адресу <strong>{nextEmail}</strong>; старый адрес
              перестанет работать. Пароль сохраняется.
            </div>
            <div style={{ marginTop: 8 }}>
              Активные сессии отзываются, неиспользованные ссылки сброса пароля гасятся. Уже
              открытая вкладка пользователя может продолжать работать не более 15 минут.
            </div>
          </div>
        ),
        okText: 'Сменить',
        cancelText: 'Отмена',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      })
    })

  const handleSubmit = async () => {
    if (!record || submitting) return
    const values = await form.validateFields()
    const isLimitedRole = values.role === 'counterparty_user' || values.role === 'security'

    const currentEmail = canonicalEmail(record.email)
    const nextEmail = canonicalEmail(values.email)
    const emailChanged = canEditEmail && nextEmail !== currentEmail

    if (emailChanged) {
      const confirmed = await confirmEmailChange(nextEmail)
      if (!confirmed) return
    }

    setSubmitting(true)
    try {
      await updateUser(record.id, {
        full_name: values.full_name ?? '',
        role: values.role,
        counterparty_id: values.role === 'counterparty_user' ? values.counterparty_id : null,
        department: values.role === 'security' ? null : values.department || null,
        all_sites: isLimitedRole ? false : (values.all_sites ?? false),
        site_ids: isLimitedRole ? [] : (values.site_ids ?? []),
        ...(emailChanged ? { email: nextEmail, expected_email: currentEmail } : {}),
      })
      message.success(emailChanged ? 'Email изменён' : 'Пользователь обновлён')
      form.resetFields()
      onSaved()
      // Себе сменили логин — текущая сессия уже отозвана сервером, уходим на форму входа.
      if (emailChanged && record.id === currentUser?.id) {
        await logout()
      }
    } catch (err) {
      // Модалка остаётся открытой: админ видит причину и может исправить адрес.
      message.error(err instanceof Error ? err.message : 'Ошибка обновления пользователя')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="Редактировать пользователя"
      open={open}
      onOk={handleSubmit}
      onCancel={handleCancel}
      okText="Сохранить"
      cancelText="Отмена"
      confirmLoading={submitting}
      maskClosable={!submitting}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="email"
          label="Email (логин)"
          extra={
            canEditEmail
              ? 'Смена адреса отзовёт сессии пользователя, пароль сохранится'
              : 'В текущем режиме авторизации email меняется на стороне Supabase Auth'
          }
          rules={[
            { required: true, message: 'Укажите email' },
            { type: 'email', message: 'Неверный формат email' },
            { max: 255, message: 'Не более 255 символов' },
          ]}
        >
          <Input disabled={!canEditEmail} autoComplete="off" />
        </Form.Item>
        <Form.Item name="full_name" label="ФИО">
          <Input />
        </Form.Item>
        <Form.Item name="role" label="Роль" rules={[{ required: true, message: 'Выберите роль' }]}>
          <Select
            onChange={(value: UserRole) => {
              setSelectedRole(value)
              if (value === 'counterparty_user' || value === 'security') {
                setAllSitesChecked(false)
                setSelectedDepartment(null)
                form.setFieldsValue({ all_sites: false, site_ids: [], department: undefined })
              }
            }}
          >
            <Select.Option value="admin">Администратор</Select.Option>
            <Select.Option value="user">Пользователь</Select.Option>
            <Select.Option value="counterparty_user">Подрядчик</Select.Option>
            <Select.Option value="security">Отдел СБ</Select.Option>
          </Select>
        </Form.Item>
        {selectedRole === 'counterparty_user' && (
          <Form.Item
            name="counterparty_id"
            label="Подрядчик"
            rules={[{ required: true, message: 'Выберите подрядчика' }]}
          >
            <Select placeholder="Выберите подрядчика" showSearch optionFilterProp="children">
              {counterparties.map((c) => (
                <Select.Option key={c.id} value={c.id}>
                  {c.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        )}
        {selectedRole !== 'counterparty_user' && selectedRole !== 'security' && (
          <Form.Item name="department" label="Подразделение">
            <Select
              placeholder="Выберите подразделение"
              allowClear
              onChange={(value: Department | undefined) => {
                setSelectedDepartment(value || null)
                if (value === 'shtab') {
                  setAllSitesChecked(false)
                  form.setFieldsValue({ all_sites: false })
                  form.validateFields(['site_ids']).catch(() => {})
                }
              }}
            >
              <Select.Option value="shtab">{DEPARTMENT_LABELS.shtab}</Select.Option>
              <Select.Option value="omts">{DEPARTMENT_LABELS.omts}</Select.Option>
              <Select.Option value="smetny">{DEPARTMENT_LABELS.smetny}</Select.Option>
            </Select>
          </Form.Item>
        )}
        {showSiteFields && (
          <>
            {!isShtab && (
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
            )}
            {!allSitesChecked && (
              <Form.Item
                name="site_ids"
                label="Объекты строительства"
                rules={
                  isShtab
                    ? [
                        {
                          required: true,
                          message: 'Для подразделения Штаб выберите объекты (1-2)',
                        },
                        () => ({
                          validator(_, value) {
                            if (value && value.length > 2) {
                              return Promise.reject(
                                new Error('Для подразделения Штаб максимум 2 объекта'),
                              )
                            }
                            return Promise.resolve()
                          },
                        }),
                      ]
                    : []
                }
              >
                <Select
                  mode="multiple"
                  placeholder="Выберите объекты"
                  showSearch
                  optionFilterProp="children"
                  allowClear
                  maxCount={isShtab ? 2 : undefined}
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

export default EditUserModal
