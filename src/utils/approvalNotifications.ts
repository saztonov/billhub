import { supabase } from '@/services/supabase'
import { DEPARTMENT_LABELS, type Department } from '@/types'

/**
 * Проверяет наличие специалиста подразделения для объекта
 * и создаёт уведомления при отсутствии подходящего пользователя.
 */
export async function checkAndNotifyMissingSpecialists(
  paymentRequestId: string,
  siteId: string,
  department: Department,
): Promise<void> {
  try {
    // Загружаем данные заявки
    const { data: prData } = await supabase
      .from('payment_requests')
      .select('request_number, construction_sites(name)')
      .eq('id', paymentRequestId)
      .single()
    if (!prData) return

    const siteObj = prData.construction_sites as unknown as { name: string } | null
    const siteName = siteObj?.name ?? 'Не указан'
    const requestNumber = prData.request_number as string

    // Ищем пользователей подразделения для объекта
    const { data: deptUsers } = await supabase
      .from('users')
      .select('id, all_sites')
      .eq('department_id', department)
      .in('role', ['admin', 'user'])

    let hasSpecialist = false
    if (deptUsers && deptUsers.length > 0) {
      for (const u of deptUsers) {
        if (u.all_sites) {
          hasSpecialist = true
          break
        }
        // Проверяем привязку к объекту
        const { data: siteMapping } = await supabase
          .from('user_construction_sites_mapping')
          .select('id')
          .eq('user_id', u.id)
          .eq('construction_site_id', siteId)
          .limit(1)
        if (siteMapping && siteMapping.length > 0) {
          hasSpecialist = true
          break
        }
      }
    }

    if (!hasSpecialist) {
      // Дедупликация: проверяем нет ли нерешённого уведомления
      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .eq('type', 'missing_specialist')
        .eq('payment_request_id', paymentRequestId)
        .eq('department_id', department)
        .eq('site_id', siteId)
        .eq('resolved', false)
        .limit(1)
      if (existing && existing.length > 0) return

      const deptName = DEPARTMENT_LABELS[department]

      // Получаем всех admin/user для рассылки
      const { data: recipients } = await supabase
        .from('users')
        .select('id')
        .in('role', ['admin', 'user'])

      const notifications = (recipients ?? []).map((r: Record<string, unknown>) => ({
        type: 'missing_specialist',
        title: 'Отсутствует специалист для согласования',
        message: `Заявка №${requestNumber}: подразделение "${deptName}" не имеет специалиста для объекта "${siteName}"`,
        user_id: r.id as string,
        payment_request_id: paymentRequestId,
        department_id: department,
        site_id: siteId,
      }))
      if (notifications.length > 0) {
        await supabase.from('notifications').insert(notifications)
      }
    }
  } catch (err) {
    console.error('Ошибка проверки специалистов:', err)
  }
}

/**
 * Проверяет, назначен ли ответственный менеджер у контрагента заявки.
 * Если нет — создаёт уведомления для пользователей ОМТС и админов.
 */
export async function checkAndNotifyMissingManager(
  paymentRequestId: string,
): Promise<void> {
  try {
    // Загружаем данные заявки с контрагентом
    const { data: prData } = await supabase
      .from('payment_requests')
      .select('counterparty_id, request_number, counterparties(name, responsible_user_id)')
      .eq('id', paymentRequestId)
      .single()
    if (!prData) return

    const counterparty = prData.counterparties as unknown as { name: string; responsible_user_id: string | null } | null
    if (!counterparty) return

    // Если ответственный назначен — всё в порядке
    if (counterparty.responsible_user_id) return

    const requestNumber = prData.request_number as string
    const counterpartyName = counterparty.name

    // Дедупликация: проверяем нет ли нерешённого уведомления
    const { data: existing } = await supabase
      .from('notifications')
      .select('id')
      .eq('type', 'missing_manager')
      .eq('payment_request_id', paymentRequestId)
      .eq('resolved', false)
      .limit(1)
    if (existing && existing.length > 0) return

    // Получатели: пользователи ОМТС + все админы
    const { data: recipients } = await supabase
      .from('users')
      .select('id')
      .or(`department_id.eq.omts,role.eq.admin`)

    const notifications = (recipients ?? []).map((r: Record<string, unknown>) => ({
      type: 'missing_manager',
      title: 'Не назначен ответственный менеджер',
      message: `Заявка №${requestNumber}: контрагент "${counterpartyName}" не имеет назначенного ответственного менеджера в отделе закупок`,
      user_id: r.id as string,
      payment_request_id: paymentRequestId,
    }))

    if (notifications.length > 0) {
      await supabase.from('notifications').insert(notifications)
    }
  } catch (err) {
    console.error('Ошибка проверки менеджера:', err)
  }
}
