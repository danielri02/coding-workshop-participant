import { SummaryStats } from '../components/SummaryStats'
import { duration, type Report } from './query'

/** Explain each aggregate alongside its sample size or business meaning. */
export function ReportSummary({ report }: { report: Report }) {
  const metrics =
    report.report === 'timings'
      ? report.milestones.map((metric) => ({
          label: metric.label,
          value: duration(metric.average_minutes),
          detail: `${metric.sample_count} recorded of ${report.row_count} matching incidents`,
        }))
      : report.report === 'workload'
        ? [
            {
              label: 'Engineers',
              value: report.rows.length,
              detail: 'Includes engineers with no assignments',
            },
            {
              label: 'Available',
              value: report.rows.filter((row) => row.is_available).length,
              detail: 'Availability is set on the engineer profile',
            },
            {
              label: 'Active assignments',
              value: report.rows.reduce((sum, row) => sum + row.active_count, 0),
              detail: 'Open, Assigned, In Progress and Blocked',
            },
            {
              label: 'Unassigned active incidents',
              value: report.unassigned_count,
              detail: 'Awaiting an engineer assignment',
            },
          ]
        : report.report === 'categories'
          ? [
              {
                label: 'Total incidents',
                value: report.rows.reduce((sum, row) => sum + row.incident_count, 0),
                detail: 'All statuses in the selected scope',
              },
              {
                label: 'Active incidents',
                value: report.rows.reduce((sum, row) => sum + row.active_count, 0),
                detail: 'Open, Assigned, In Progress and Blocked',
              },
            ]
          : [
              {
                label: 'Incidents in displayed locations',
                value: report.rows.reduce((sum, row) => sum + row.incident_count, 0),
                detail: 'Selected period, category and scope',
              },
              {
                label: report.minimum_incidents === 2 ? 'Repeated locations' : 'Locations',
                value: report.rows.length,
                detail:
                  report.minimum_incidents === 2
                    ? 'At least two incidents per location in this period'
                    : 'Locations with reported incidents in this period',
              },
            ]
  return <SummaryStats metrics={metrics} />
}
