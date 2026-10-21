import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const handler = runInNewContext(
  readFileSync(new URL('../../infra/facilities_spa.js', import.meta.url), 'utf8') + '\nhandler',
) as (event: {
  request: { uri: string; method: string; headers: Record<string, { value: string }> }
}) => { uri: string }

test('CloudFront rewrites only browser frontend navigation and retains API/asset paths', () => {
  for (const path of ['/', '/admin/incidents', '/employee/incidents/123', '/engineer/incidents'])
    assert.equal(
      handler({
        request: { uri: path, method: 'GET', headers: { accept: { value: 'text/html' } } },
      }).uri,
      '/index.html',
    )
  for (const [path, method, accept] of [
    ['/api/facilities/health', 'GET', 'text/html'],
    ['/api/facilities/incidents/999', 'GET', 'application/json'],
    ['/api/facilities/auth/login', 'POST', 'text/html'],
    ['/assets/index.js', 'GET', 'text/html'],
    ['/admin/missing.js', 'GET', 'text/html'],
    ['/admin/incidents', 'GET', 'application/json'],
    ['/admin/incidents', 'POST', 'text/html'],
  ])
    assert.equal(
      handler({ request: { uri: path!, method: method!, headers: { accept: { value: accept! } } } })
        .uri,
      path,
    )
})
