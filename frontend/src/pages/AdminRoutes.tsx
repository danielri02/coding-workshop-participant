import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminLayout } from '../components/AdminLayout'
import { ResourcePage } from './ResourcePage'
import { resources } from '../resources/definitions'
import { reports } from '../reports/definitions'
import { ReportPage } from './ReportPage'

/** Load administration resources only after the current account has admin access. */
export default function AdminRoutes() {
  return (
    <Routes>
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="incidents" replace />} />
        {resources
          .filter((resource) => !resource.hidden)
          .map((resource) => (
            <Route
              key={resource.key}
              path={resource.key}
              element={<ResourcePage key={resource.key} resource={resource} />}
            />
          ))}
        {reports.map((report) => (
          <Route
            key={report.key}
            path={`reports/${report.key}`}
            element={<ReportPage key={report.key} definition={report} />}
          />
        ))}
      </Route>
      <Route path="*" element={<Navigate to="/admin/incidents" replace />} />
    </Routes>
  )
}
