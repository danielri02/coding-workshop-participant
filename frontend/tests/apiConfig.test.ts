import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apiBaseUrl, isDirectApi, workshopEndpoint } from '../src/services/apiConfig'
import { workshopProxy } from '../config/workshopProxy'

const local = {
  VITE_API_URL: 'http://localhost:3001',
  VITE_API_ENDPOINTS: JSON.stringify({ facilities: 'http://lambda.localhost:4566/' }),
}

test('generated workshop settings use the application proxy by default', () => {
  assert.equal(isDirectApi(local), false)
  assert.equal(apiBaseUrl(local, true), '/api/facilities')
  assert.equal(workshopEndpoint(local), 'http://lambda.localhost:4566/')
  const proxy = workshopProxy(local)['/api/facilities']
  assert.equal(proxy.target, 'http://lambda.localhost:4566/')
  assert.equal(
    proxy.rewrite?.('/api/facilities/incidents/grid?search=a%26b&page=1'),
    '/incidents/grid?search=a%26b&page=1',
  )
  assert.equal(proxy.rewrite?.('/api/facilities'), '/')
})

test('an explicit direct override supports standalone FastAPI tests', () => {
  const environment = { ...local, VITE_API_MODE: 'direct', VITE_API_URL: 'http://localhost:8000/' }
  assert.equal(apiBaseUrl(environment, true), 'http://localhost:8000')
  assert.deepEqual(workshopProxy(environment), {})
})

test('cloud paths are composed without adding the service prefix twice', () => {
  const environment = {
    VITE_API_URL: 'https://demo.example/',
    VITE_API_ENDPOINTS: JSON.stringify({ facilities: '/api/facilities' }),
  }
  assert.equal(apiBaseUrl(environment, false), 'https://demo.example/api/facilities')
  assert.equal(
    workshopProxy(environment)['/api/facilities'].target,
    'https://demo.example/api/facilities',
  )
})

test('incomplete discovery has no silent fallback to port 3001', () => {
  assert.equal(apiBaseUrl({}, true), '/api/facilities')
  assert.deepEqual(workshopProxy({}), {})
  assert.throws(() => workshopEndpoint({ VITE_API_ENDPOINTS: 'not JSON' }), /JSON mapping/)
  assert.throws(
    () => workshopProxy({ VITE_API_ENDPOINTS: JSON.stringify({ facilities: 'file:///private' }) }),
    /HTTP/,
  )
  assert.throws(() => isDirectApi({ VITE_API_MODE: 'invalid' }), /workshop or direct/)
})

test('a missing workshop service returns JSON 503 before SPA fallback', async () => {
  const { createServer } = await import('vite')
  const { missingWorkshopMapping } = await import('../config/workshopProxy')
  const server = await createServer({
    configFile: false,
    plugins: [missingWorkshopMapping({})],
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'silent',
  })
  try {
    await server.listen()
    const address = server.httpServer?.address()
    assert.ok(address && typeof address !== 'string')
    const response = await fetch(`http://127.0.0.1:${address.port}/api/facilities/auth/login`, {
      method: 'POST',
    })
    assert.equal(response.status, 503)
    const body = await response.json()
    assert.match(body.detail, /deploy-local.sh/)
    assert.match(response.headers.get('content-type') || '', /application\/json/)
  } finally {
    await server.close()
  }
})
