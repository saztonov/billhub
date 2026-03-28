import { useEffect } from 'react'
import { Button, Switch } from 'antd'
import { PlusOutlined, FileExcelOutlined } from '@ant-design/icons'
import { useHeaderStore } from '@/store/headerStore'
import { createElement } from 'react'

interface UsePaymentRequestHeaderParams {
  activeTab: string
  isMobile: boolean
  isAdmin: boolean
  isCounterpartyUser: boolean
  userDeptInChain: boolean
  showDeleted: boolean
  setShowDeleted: (val: boolean) => void
  setIsCreateOpen: (val: boolean) => void
  setIsExportOpen: (val: boolean) => void
  // Суммы
  totalInvoiceAmountAll: number
  totalPaidAll: number
  totalPendingAmountAll: number
  totalInvoiceAmount: number
  unassignedOmtsCount: number
}

/** Форматирование суммы в рубли */
function fmtRub(val: number): string {
  return val.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽'
}

/** Стиль карточки с информацией */
const infoBadgeStyle: React.CSSProperties = {
  padding: '4px 12px',
  border: '1px solid #d9d9d9',
  borderRadius: '6px',
  backgroundColor: '#fafafa',
  whiteSpace: 'nowrap',
  fontSize: 13,
}

/** Разделитель между показателями */
function Separator() {
  return createElement('span', { style: { color: '#d9d9d9', margin: '0 8px' } }, '|')
}

/** Метка показателя */
function Label({ children }: { children: string }) {
  return createElement('span', { style: { color: '#8c8c8c', marginRight: 6 } }, children)
}

/** Значение показателя */
function Value({ children, color }: { children: React.ReactNode; color?: string }) {
  return createElement('span', { style: { fontWeight: 500, color: color ?? 'inherit' } }, children)
}

/**
 * Хук управления заголовком страницы заявок.
 * Формирует extra-панель с суммами и кнопки действий для HeaderStore.
 */
export function usePaymentRequestHeader({
  activeTab,
  isMobile,
  isAdmin,
  isCounterpartyUser,
  userDeptInChain,
  showDeleted,
  setShowDeleted,
  setIsCreateOpen,
  setIsExportOpen,
  totalInvoiceAmountAll,
  totalPaidAll,
  totalPendingAmountAll,
  totalInvoiceAmount,
  unassignedOmtsCount,
}: UsePaymentRequestHeaderParams) {
  const setHeader = useHeaderStore((s) => s.setHeader)
  const clearHeader = useHeaderStore((s) => s.clearHeader)

  useEffect(() => {
    // На мобильном не показываем extra и actions в Header
    if (isMobile) {
      setHeader('Заявки на оплату', null, null)
      return
    }

    // --- Extra-панель с суммами ---
    const extra = createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
      // Вкладка «Все» — три показателя
      activeTab === 'all' && createElement('div', { style: infoBadgeStyle },
        createElement(Label, null, 'Согласовано РП:'),
        createElement(Value, null, fmtRub(totalInvoiceAmountAll)),
        createElement(Separator, null),
        createElement(Label, null, 'РП на согласовании:'),
        createElement(Value, null, fmtRub(totalPendingAmountAll)),
        createElement(Separator, null),
        createElement(Label, null, 'Оплачено РП:'),
        createElement(Value, null, fmtRub(totalPaidAll)),
      ),
      // Вкладка «На согласование» — сумма счетов + не назначено (для админа)
      activeTab === 'pending' && userDeptInChain && createElement(
        'div', { style: { display: 'contents' } },
        createElement('div', { style: infoBadgeStyle },
          createElement(Label, null, 'Сумма счетов:'),
          createElement(Value, null, fmtRub(totalInvoiceAmount)),
        ),
        isAdmin && createElement('div', { style: infoBadgeStyle },
          createElement(Label, null, 'Не назначено:'),
          createElement(Value, { color: unassignedOmtsCount > 0 ? '#faad14' : undefined }, String(unassignedOmtsCount)),
        ),
      ),
    )

    // --- Кнопки действий ---
    const actions = createElement('div', { style: { display: 'flex', gap: 12, alignItems: 'center' } },
      // Переключатель удалённых (только для админа)
      isAdmin && createElement('span', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
        createElement(Switch, { size: 'small', checked: showDeleted, onChange: setShowDeleted }),
        createElement('span', { style: { fontSize: 13, color: '#8c8c8c', whiteSpace: 'nowrap' } }, 'Удаленные'),
      ),
      // Экспорт реестра (не для контрагентов)
      !isCounterpartyUser && createElement(Button, {
        icon: createElement(FileExcelOutlined, null),
        onClick: () => setIsExportOpen(true),
        style: { borderColor: '#52c41a', color: '#52c41a' },
      }, 'Реестр заявок'),
      // Кнопка добавления
      createElement(Button, {
        type: 'primary',
        icon: createElement(PlusOutlined, null),
        onClick: () => setIsCreateOpen(true),
      }, 'Добавить'),
    )

    setHeader('Заявки на оплату', extra, actions)
  }, [
    activeTab, totalInvoiceAmountAll, totalPaidAll, totalPendingAmountAll,
    totalInvoiceAmount, unassignedOmtsCount, isAdmin, isCounterpartyUser,
    userDeptInChain, showDeleted, setHeader, isMobile,
    setShowDeleted, setIsCreateOpen, setIsExportOpen,
  ])

  // Очистка заголовка при размонтировании
  useEffect(() => {
    return () => clearHeader()
  }, [clearHeader])
}
