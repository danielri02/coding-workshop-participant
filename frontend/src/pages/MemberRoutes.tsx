import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { MemberLayout } from '../components/MemberLayout'
import { IncidentListPage } from '../incidents/IncidentListPage'
import { TicketDetailsPage } from '../incidents/TicketDetailsPage'
import { IncidentDetailsPage } from '../incidents/IncidentDetailsPage'
import { incidentViews, type IncidentScope } from '../incidents/scope'

/** Engineers retain employee access while assigned-work routes require their capability. */
export default function MemberRoutes() {
  const { user } = useAuth()
  const scopes: IncidentScope[] = user?.engineer_profile ? ['assigned', 'reported'] : ['reported']
  const home = incidentViews[scopes[0]].path
  return (
    <Routes>
      <Route element={<MemberLayout />}>
        {scopes.map((scope) => (
          <Route key={scope} path={incidentViews[scope].path}>
            <Route index element={<IncidentListPage key={scope} scope={scope} />} />
            <Route
              path=":incidentId"
              element={
                scope === 'reported' ? (
                  <TicketDetailsPage />
                ) : (
                  <IncidentDetailsPage key={scope} scope={scope} />
                )
              }
            />
          </Route>
        ))}
      </Route>
      <Route path="/employee/incidents" element={<Navigate to="/employee/tickets" replace />} />
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  )
}
