import { rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

rmSync('coverage/browser', { recursive: true, force: true })
const result = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, E2E_COVERAGE: '1' },
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
