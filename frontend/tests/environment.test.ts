import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'vitest'
import { applicationEnvironment, publicEnvironmentDefinitions } from '../config/environment'

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'shared-environment-'))
  mkdirSync(resolve(root, 'frontend'))
  writeFileSync(
    resolve(root, 'frontend/.env.local'),
    'VITE_API_URL=http://localhost:3001\nVITE_API_ENDPOINTS=\'{"facilities":"http://lambda.localhost:4566/"}\'\n',
  )
  writeFileSync(
    resolve(root, '.env'),
    'VITE_API_MODE=workshop\nPOSTGRES_PASS=private-password\nJWT_SECRET_KEY=private-signing-key\nDATABASE_RESET_KEY=private-reset-key\nSEED_ADMIN_PASSWORD=private-admin-password\nVITE_UNAPPROVED=private-canary\n',
  )
  return root
}

test('root settings combine with workshop discovery and shell overrides', () => {
  const root = fixture()
  try {
    const settings = applicationEnvironment(root, {})
    assert.equal(settings.VITE_API_MODE, 'workshop')
    assert.equal(settings.VITE_API_URL, 'http://localhost:3001')
    assert.match(settings.VITE_API_ENDPOINTS || '', /facilities/)
    assert.deepEqual(Object.keys(settings).sort(), [
      'VITE_API_ENDPOINTS',
      'VITE_API_MODE',
      'VITE_API_URL',
    ])
    writeFileSync(
      resolve(root, '.env'),
      'VITE_API_MODE=direct\nVITE_API_URL=http://localhost:8000\n',
    )
    assert.equal(applicationEnvironment(root, {}).VITE_API_URL, 'http://localhost:8000')
    assert.equal(
      applicationEnvironment(root, { VITE_API_URL: 'https://cloud.example' }).VITE_API_URL,
      'https://cloud.example',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('alternate shared file uses the repository root, literal values, and can be disabled', () => {
  const root = fixture()
  try {
    writeFileSync(resolve(root, 'selected.env'), "VITE_API_URL='https://example/${LITERAL}'\n")
    assert.equal(
      applicationEnvironment(root, { APP_ENV_FILE: 'selected.env' }).VITE_API_URL,
      'https://example/${LITERAL}',
    )
    assert.equal(applicationEnvironment(root, { APP_ENV_FILE: '' }).VITE_API_MODE, undefined)
    assert.throws(
      () => applicationEnvironment(root, { APP_ENV_FILE: 'missing.env' }),
      /APP_ENV_FILE/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('only approved API values enter the browser definitions', () => {
  const root = fixture()
  try {
    const definitions = publicEnvironmentDefinitions(applicationEnvironment(root, {}))
    assert.equal(Object.keys(definitions).length, 3)
    assert.doesNotMatch(
      JSON.stringify(definitions),
      /private-|POSTGRES|JWT|DATABASE_RESET|SEED_|UNAPPROVED/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
