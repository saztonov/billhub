import { Tooltip, Progress } from 'antd'
import type { PaymentRequest } from '@/types'
import { STAGE_LABELS, STAGE_SHTAB } from '@/types'
import { useUokThresholdStore } from '@/store/uokThresholdStore'
import {
  rejectedProgressPercent,
  requestStagePath,
  stageProgressPercent,
} from '@/utils/approvalStages'

interface ApprovalProgressCellProps {
  record: PaymentRequest
}

/**
 * Прогресс согласования заявки для подрядчика (Штаб → ОМТС → [УОК] → [РП]).
 * Знаменатель — фактический путь заявки: УОК по сумме/факту, РП по факту (см. requestStagePath).
 */
const ApprovalProgressCell = ({ record }: ApprovalProgressCellProps) => {
  const uokThreshold = useUokThresholdStore((s) => s.amount)

  if (record.approvedAt)
    return (
      <Tooltip title="Согласовано">
        <div style={{ width: '80%' }}>
          <Progress percent={100} size={{ height: 5 }} status="success" showInfo={false} />
        </div>
      </Tooltip>
    )

  const path = requestStagePath(record, uokThreshold)

  if (record.rejectedAt) {
    const rejectedLabel =
      record.rejectedStage === STAGE_SHTAB
        ? 'Штабе'
        : (STAGE_LABELS[record.rejectedStage ?? 0] ?? 'ОМТС')
    return (
      <Tooltip title={`Отклонено на ${rejectedLabel}`}>
        <div style={{ width: '80%' }}>
          <Progress
            percent={rejectedProgressPercent(path, record.rejectedStage)}
            size={{ height: 5 }}
            status="exception"
            showInfo={false}
          />
        </div>
      </Tooltip>
    )
  }

  if (record.withdrawnAt || !record.currentStage) return <span style={{ color: '#bfbfbf' }}>—</span>

  const stageLabel = STAGE_LABELS[record.currentStage] ?? 'ОМТС'
  return (
    <Tooltip title={`На стадии ${stageLabel}`}>
      <div style={{ width: '80%' }}>
        <Progress
          percent={stageProgressPercent(path, record.currentStage)}
          size={{ height: 5 }}
          strokeColor="#fa8c16"
          showInfo={false}
        />
      </div>
    </Tooltip>
  )
}

export default ApprovalProgressCell
