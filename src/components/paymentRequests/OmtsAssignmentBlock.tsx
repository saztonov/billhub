import { Typography, Space, Select, Collapse, App } from 'antd'
import { formatDate } from '@/utils/requestFormatters'
import type { PaymentRequest } from '@/types'

const { Text } = Typography

interface AssignmentHistoryItem {
  id?: string
  assignedAt: string
  assignedUserFullName?: string | null
  assignedUserEmail?: string | null
  assignedByUserEmail?: string | null
}

interface OmtsAssignmentBlockProps {
  request: PaymentRequest
  isAdmin: boolean
  userId: string | undefined
  currentAssignment: { assignedUserId?: string | null; assignedUserFullName?: string | null; assignedUserEmail?: string | null } | null
  assignmentHistory: AssignmentHistoryItem[]
  omtsUsers: { id: string; fullName: string }[]
  assignResponsible: (requestId: string, userId: string, assignedBy: string) => Promise<void>
}

const OmtsAssignmentBlock = ({
  request,
  isAdmin,
  userId,
  currentAssignment,
  assignmentHistory,
  omtsUsers,
  assignResponsible,
}: OmtsAssignmentBlockProps) => {
  const { message } = App.useApp()

  return (
    <div style={{ marginTop: 24, marginBottom: 24 }}>
      <Text strong style={{ display: 'block', marginBottom: 12 }}>Ответственный ОМТС</Text>
      <Space orientation="vertical" style={{ width: '100%' }}>
        {isAdmin ? (
          <Select
            value={currentAssignment?.assignedUserId ?? undefined}
            placeholder="Выберите ответственного"
            style={{ width: '100%' }}
            allowClear
            onChange={async (value) => {
              if (!userId) return
              try {
                await assignResponsible(request.id, value, userId)
                message.success('Ответственный назначен')
              } catch {
                message.error('Ошибка назначения')
              }
            }}
            options={omtsUsers.map((u) => ({
              label: u.fullName,
              value: u.id,
            }))}
          />
        ) : (
          <Text>
            {currentAssignment?.assignedUserFullName ||
             currentAssignment?.assignedUserEmail ||
             'Не назначен'}
          </Text>
        )}

        {assignmentHistory.length > 0 && (
          <Collapse ghost items={[{
            key: '1',
            label: 'История назначений',
            children: assignmentHistory.map((item) => (
              <div key={item.id ?? item.assignedAt} style={{ padding: '4px 0' }}>
                <div>
                  <Text strong>
                    {item.assignedUserFullName || item.assignedUserEmail}
                  </Text>
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Назначил: {item.assignedByUserEmail} • {formatDate(item.assignedAt)}
                </Text>
              </div>
            )),
          }]} />
        )}
      </Space>
    </div>
  )
}

export default OmtsAssignmentBlock
