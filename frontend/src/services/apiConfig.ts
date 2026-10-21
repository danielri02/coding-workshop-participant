import { workshopService } from '../generated/domain'

export interface ApiEnvironment {
  VITE_API_MODE?: string
  VITE_API_URL?: string
  VITE_API_ENDPOINTS?: string
}

/** Keep direct ASGI development an explicit override of the workshop default. */
export function isDirectApi(environment: ApiEnvironment): boolean {
  const mode = environment.VITE_API_MODE || 'workshop'
  if (mode !== 'workshop' && mode !== 'direct')
    throw new Error('VITE_API_MODE must be workshop or direct.')
  return mode === 'direct'
}

/** Read the service mapping produced by the unmodified workshop generator. */
export function workshopEndpoint(environment: ApiEnvironment): string | undefined {
  let mappings: unknown
  try {
    mappings = JSON.parse(environment.VITE_API_ENDPOINTS || '{}')
  } catch {
    throw new Error('VITE_API_ENDPOINTS must contain the workshop-generated JSON mapping.')
  }
  if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings))
    throw new Error('VITE_API_ENDPOINTS must contain the workshop-generated JSON mapping.')
  const endpoint = Reflect.get(mappings, workshopService.name)
  if (endpoint === undefined) return undefined
  if (typeof endpoint !== 'string' || !endpoint)
    throw new Error(`The workshop endpoint for ${workshopService.name} must be a URL or path.`)
  return endpoint
}

/** Use same-origin Vite routing locally and the generated service path in cloud builds. */
export function apiBaseUrl(environment: ApiEnvironment, development: boolean): string {
  const base = (environment.VITE_API_URL || '').replace(/\/$/, '')
  if (isDirectApi(environment)) return base || 'http://localhost:8000'
  const endpoint = workshopEndpoint(environment)
  if (development || (endpoint && /^https?:\/\//.test(endpoint))) return workshopService.prefix
  return `${base}${endpoint || workshopService.prefix}`
}
