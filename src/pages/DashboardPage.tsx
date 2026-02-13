import { Typography, Card, Row, Col, Statistic } from 'antd'
import {
  FileTextOutlined,
  SendOutlined,
  TeamOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'

const { Title } = Typography

const DashboardPage = () => {
  return (
    <div>
      <Title level={2}>Панель управления</Title>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Подрядчики"
              value={0}
              prefix={<TeamOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Счета"
              value={0}
              prefix={<FileTextOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Распред. письма"
              value={0}
              prefix={<SendOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="На согласовании"
              value={0}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}

export default DashboardPage
