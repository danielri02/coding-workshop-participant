import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'dotenv'
import { publicApiSettings, type ApiEnvironment } from '../src/services/apiConfig'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function readEnvironment(path: string): Record<string, string> {
  return existsSync(path) ? parse(readFileSync(path)) : {}
}

/** Share the backend's root .env and keep workshop-generated discovery as a fallback. */
export function applicationEnvironment(
  root = projectRoot,
  shell: NodeJS.ProcessEnv = process.env,
): ApiEnvironment {
  const selected = shell.APP_ENV_FILE
  const sharedPath = resolve(root, selected || '.env')
  if (selected && !existsSync(sharedPath))
    throw new Error('APP_ENV_FILE must name an existing environment file')
  const values = {
    ...readEnvironment(resolve(root, 'frontend/.env.local')),
    ...(selected === '' ? {} : readEnvironment(sharedPath)),
    ...Object.fromEntries(Object.entries(shell).filter(([, value]) => value !== undefined)),
  }
  const api: ApiEnvironment = {}
  for (const name of publicApiSettings) {
    const value = values[name]
    if (value !== undefined) api[name] = value
  }
  return api
}

/** Explicitly expose public API settings while keeping all backend secrets server-side. */
export function publicEnvironmentDefinitions(api: ApiEnvironment): Record<string, string> {
  return Object.fromEntries(
    publicApiSettings.map((name) => [`import.meta.env.${name}`, JSON.stringify(api[name] || '')]),
  )
}
