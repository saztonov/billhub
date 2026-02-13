import { supabase } from '@/services/supabase'

interface StageDecision {
  department_id: string
}

/**
 * Проверяет наличие специалистов для каждого подразделения этапа
 * и создаёт уведомления при отсутствии подходящего пользователя.
 */
export async function checkAndNotifyMissingSpecialists(
  paymentRequestId: string,
  stageDecisions: StageDecision[],
) {
  // Загружаем данные заявки
  const { data: prData } = await supabase
    .from('payment_requests')
    .select('site_id, request_number, construction_sites(name)')
    .eq('id', paymentRequestId)
    .single()
  if (!prData) return

  const siteId = prData.site_id as string
  const siteObj = prData.construction_sites as unknown as { name: string } | null
  const siteName = siteObj?.name ?? 'Не указан'
  const requestNumber = prData.request_number as string

  for (const decision of stageDecisions) {
    const deptId = decision.department_id

    // Ищем пользователей с нужным подразделением
    const { data: deptUsers } = await supabase
      .from('users')
      .select('id, all_sites')
      .eq('department_id', deptId)
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
        .eq('department_id', deptId)
        .eq('site_id', siteId)
        .eq('resolved', false)
        .limit(1)
      if (existing && existing.length > 0) continue

      // Получаем имя подразделения
      const { data: deptData } = await supabase
        .from('departments')
        .select('name')
        .eq('id', deptId)
        .single()
      const deptName = deptData?.name ?? 'Неизвестно'

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
        department_id: deptId,
        site_id: siteId,
      }))
      if (notifications.length > 0) {
        await supabase.from('notifications').insert(notifications)
      }
    }
  }
}
