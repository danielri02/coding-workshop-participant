import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { test } from 'vitest'
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

test('Vite avoids LocalStack origin rejection while retaining authentication and request data', async () => {
  const upstream = createHttpServer(async (request, response) => {
    // LocalStack's edge CORS check rejects browser origins before Lambda runs.
    if (request.headers.origin || request.headers.referer) {
      response.writeHead(403)
      response.end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    response.setHeader('Content-Type', 'application/json')
    if (request.url?.startsWith('/incidents') && !request.headers.authorization) {
      response.writeHead(401)
      response.end(JSON.stringify({ detail: 'Not authenticated' }))
      return
    }
    response.end(
      JSON.stringify({
        path: request.url,
        authorization: request.headers.authorization,
        contentType: request.headers['content-type'],
        body: Buffer.concat(chunks).toString(),
        browserHeaders: Object.keys(request.headers).filter(
          (name) => name === 'origin' || name === 'referer' || name.startsWith('sec-fetch-'),
        ),
      }),
    )
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const target = upstream.address()
  assert.ok(target && typeof target !== 'string')
  const { createServer } = await import('vite')
  const server = await createServer({
    configFile: false,
    envDir: false,
    server: {
      host: '127.0.0.1',
      port: 0,
      proxy: workshopProxy({
        VITE_API_ENDPOINTS: JSON.stringify({ facilities: `http://127.0.0.1:${target.port}/` }),
      }),
    },
    logLevel: 'silent',
  })
  try {
    await server.listen()
    const address = server.httpServer?.address()
    assert.ok(address && typeof address !== 'string')
    const base = `http://127.0.0.1:${address.port}/api/facilities`
    const headers = {
      Origin: 'http://localhost:3000',
      Referer: 'http://localhost:3000/admin/incidents',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
    }
    const health = await fetch(`${base}/health`)
    assert.equal(health.status, 200)
    await health.json()
    const loginBody = JSON.stringify({ email: 'admin@acme.inc', password: 'fixture' })
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: loginBody,
    })
    assert.equal(login.status, 200, 'browser headers must not trigger the upstream empty 403')
    const loginRequest = await login.json()
    assert.equal(loginRequest.path, '/auth/login')
    assert.equal(loginRequest.body, loginBody)
    assert.equal(loginRequest.contentType, 'application/json')
    assert.deepEqual(loginRequest.browserHeaders, [])
    const protectedResponse = await fetch(`${base}/incidents/grid?search=a%26b&page=1`, {
      headers: { ...headers, Authorization: 'Bearer fixture-access-token' },
    })
    assert.equal(protectedResponse.status, 200)
    const protectedRequest = await protectedResponse.json()
    assert.equal(protectedRequest.path, '/incidents/grid?search=a%26b&page=1')
    assert.equal(protectedRequest.authorization, 'Bearer fixture-access-token')
    assert.deepEqual(protectedRequest.browserHeaders, [])
    const anonymous = await fetch(`${base}/incidents`, { headers })
    assert.equal(anonymous.status, 401)
    assert.deepEqual(await anonymous.json(), { detail: 'Not authenticated' })
  } finally {
    await server.close()
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
