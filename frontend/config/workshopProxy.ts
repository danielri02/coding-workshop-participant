import type { Plugin, ProxyOptions, ViteDevServer } from 'vite'
import { workshopService } from '../src/generated/domain'
import { isDirectApi, workshopEndpoint, type ApiEnvironment } from '../src/services/apiConfig'

/** Resolve generated Lambda targets without routing bearer tokens through port 3001. */
export function workshopProxy(environment: ApiEnvironment): Record<string, ProxyOptions> {
  if (isDirectApi(environment)) return {}
  const endpoint = workshopEndpoint(environment)
  if (!endpoint) return {}
  const target = new URL(endpoint, environment.VITE_API_URL || 'http://localhost:3001')
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password)
    throw new Error('The workshop API endpoint must be an HTTP(S) URL without credentials.')
  return {
    [workshopService.prefix]: {
      target: target.toString(),
      changeOrigin: true,
      // The Lambda adapter handles unprefixed local and prefixed CloudFront paths.
      rewrite: (path) => path.slice(workshopService.prefix.length) || '/',
    },
  }
}

/** Explain missing discovery before Vite's SPA fallback can masquerade as an API. */
export function missingWorkshopMapping(environment: ApiEnvironment): Plugin {
  const missing = !isDirectApi(environment) && !workshopEndpoint(environment)
  const message = `The workshop has no ${workshopService.name} API endpoint. Run ./bin/deploy-backend.sh local, then ./bin/start-dev.sh to deploy the service and regenerate frontend/.env.local.`
  const configure = (server: Pick<ViteDevServer, 'middlewares'>) => {
    if (!missing) return
    server.middlewares.use(workshopService.prefix, (_request, response) => {
      response.statusCode = 503
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ detail: message }))
    })
  }
  return {
    name: 'workshop-api-discovery',
    configureServer: configure,
    configurePreviewServer: configure,
  }
}
