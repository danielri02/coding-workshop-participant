import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminLayout } from '../components/AdminLayout'
import { ResourcePage } from './ResourcePage'
import { resources } from '../resources/definitions'

/** Load administration resources only after the current account has admin access. */
export default function AdminRoutes() {
  return (
    <Routes>
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="incidents" replace />} />
        {resources.map((resource) => (
          <Route
            key={resource.key}
            path={resource.key}
            element={<ResourcePage key={resource.key} resource={resource} />}
          />
        ))}
      </Route>
      <Route path="*" element={<Navigate to="/admin/incidents" replace />} />
    </Routes>
  )
}

AdminRoutes.propTypes = {}
