import { Typography } from 'antd'
import SavingsReportSection from '@/components/admin/SavingsReportSection'

const { Title } = Typography

/** Вкладка «Отчёты» админки. Пока один отчёт — экономия по заявкам на оплату. */
const ReportsTab = () => (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
    <Title level={4} style={{ marginTop: 0, marginBottom: 12 }}>
      Экономия по заявкам на оплату
    </Title>
    <div style={{ flex: 1, overflow: 'hidden' }}>
      <SavingsReportSection />
    </div>
  </div>
)

export default ReportsTab
