import { Alert, Descriptions, Space, Table, Tag, Typography } from 'antd'
import type { SgnlProjectReport, SgnlSyncReport } from '@/types/sgnl'

const { Text } = Typography

interface SgnlReportViewProps {
  report: SgnlSyncReport
}

function formatDateTime(value: string): string {
  return value ? new Date(value).toLocaleString('ru-RU') : '—'
}

/** Отчёт прогона выгрузки (или предпросмотра) в SIGNAL: итоги, проекты, пропуски, ошибки */
const SgnlReportView = ({ report }: SgnlReportViewProps) => {
  const projectColumns = [
    {
      title: 'Проект SIGNAL',
      key: 'project',
      render: (_: unknown, r: SgnlProjectReport) => (
        <Space direction="vertical" size={0}>
          <Text>{r.projectName ?? r.projectId}</Text>
          {r.basePath && <Text type="secondary">Подпапка: {r.basePath}</Text>}
          <Text type="secondary" style={{ fontSize: 12 }}>
            {r.sites.join(', ')}
          </Text>
        </Space>
      ),
    },
    { title: 'Файлов', dataIndex: 'files', key: 'files', width: 90 },
    ...(report.dryRun
      ? []
      : [
          { title: 'Выгружено', dataIndex: 'uploaded', key: 'uploaded', width: 110 },
          {
            title: 'Ошибок',
            dataIndex: 'failed',
            key: 'failed',
            width: 90,
            render: (v: number) => (v > 0 ? <Text type="danger">{v}</Text> : v),
          },
        ]),
    {
      title: report.dryRun ? 'Будут созданы папки' : 'Созданы папки',
      key: 'folders',
      render: (_: unknown, r: SgnlProjectReport) =>
        r.error ? (
          <Text type="danger">{r.error}</Text>
        ) : r.foldersToCreate.length === 0 ? (
          <Text type="secondary">—</Text>
        ) : (
          <details>
            <summary>{r.foldersToCreate.length} шт.</summary>
            {r.foldersToCreate.map((path) => (
              <div key={path} style={{ fontSize: 12 }}>
                {path}
              </div>
            ))}
          </details>
        ),
    },
  ]

  const { skipped } = report

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {report.aborted && (
        <Alert type="error" showIcon message={`Прогон прерван: ${report.aborted}`} />
      )}
      <Descriptions column={{ xs: 1, md: 3 }} size="small" bordered>
        <Descriptions.Item label="Режим">
          {report.dryRun ? <Tag>предпросмотр</Tag> : <Tag color="blue">выгрузка</Tag>}
        </Descriptions.Item>
        <Descriptions.Item label="Начало">{formatDateTime(report.startedAt)}</Descriptions.Item>
        <Descriptions.Item label="Окончание">{formatDateTime(report.finishedAt)}</Descriptions.Item>
        <Descriptions.Item label={report.dryRun ? 'К выгрузке' : 'Кандидатов'}>
          {report.totals.candidates}
        </Descriptions.Item>
        {!report.dryRun && (
          <Descriptions.Item label="Выгружено">{report.totals.uploaded}</Descriptions.Item>
        )}
        {!report.dryRun && (
          <Descriptions.Item label="Ошибок">
            {report.totals.failed > 0 ? <Text type="danger">{report.totals.failed}</Text> : 0}
          </Descriptions.Item>
        )}
      </Descriptions>

      {report.projects.length > 0 && (
        <Table
          size="small"
          rowKey={(r) => `${r.projectId}|${r.basePath ?? ''}`}
          columns={projectColumns}
          dataSource={report.projects}
          pagination={false}
          scroll={{ x: 700 }}
        />
      )}

      {(skipped.unmappedSites.length > 0 || skipped.noSupplierFiles > 0) && (
        <Alert
          type="info"
          showIcon
          message="Не выгружаются"
          description={
            <Space direction="vertical" size={2}>
              {skipped.unmappedSites.map((s) => (
                <Text key={s.siteId}>
                  {s.siteName} — нет проекта SIGNAL ({s.files} счетов)
                </Text>
              ))}
              {skipped.noSupplierFiles > 0 && (
                <Text>Заявки без поставщика — {skipped.noSupplierFiles} счетов</Text>
              )}
            </Space>
          }
        />
      )}

      {report.errors.length > 0 && (
        <details>
          <summary>
            <Text type="danger">Ошибки по файлам ({report.errors.length})</Text>
          </summary>
          {report.errors.map((e, i) => (
            <div key={i} style={{ fontSize: 12, marginTop: 4 }}>
              №{e.requestNumber} {e.fileName} → {e.path}: <Text type="danger">{e.error}</Text>
            </div>
          ))}
        </details>
      )}
    </Space>
  )
}

export default SgnlReportView
