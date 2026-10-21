import { Navigate, Route, Routes } from 'react-router-dom'
import { EmployeeLayout } from '../employee/EmployeeLayout'
import { EmployeeIncidentsPage } from '../employee/EmployeeIncidentsPage'
import { EmployeeIncidentPage } from '../employee/EmployeeIncidentPage'

/** Keep admin URLs and components outside the employee workspace. */
export default function EmployeeRoutes() {
  return (
    <Routes>
      <Route path="/employee" element={<EmployeeLayout />}>
        <Route index element={<Navigate to="incidents" replace />} />
        <Route path="incidents" element={<EmployeeIncidentsPage />} />
        <Route path="incidents/:incidentId" element={<EmployeeIncidentPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/employee/incidents" replace />} />
    </Routes>
  )
}
