import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import istanbul from 'vite-plugin-istanbul'
import { applicationEnvironment, publicEnvironmentDefinitions } from './config/environment'
import { missingWorkshopMapping, workshopProxy } from './config/workshopProxy'

export default defineConfig(({ command }) => {
  const environment = applicationEnvironment()
  const proxy = workshopProxy(environment)
  const measuringCoverage = command === 'serve' && process.env.E2E_COVERAGE === '1'
  return {
    // Disable Vite's independent env loading; expose only the shared public allowlist.
    envDir: false as const,
    envPrefix: [],
    define: publicEnvironmentDefinitions(environment),
    plugins: [
      react(),
      missingWorkshopMapping(environment),
      ...(measuringCoverage
        ? [
            istanbul({
              include: 'src/**/*',
              exclude: ['src/generated/**', 'src/types.ts', 'src/vite-env.d.ts'],
              extension: ['.ts', '.tsx'],
            }),
          ]
        : []),
    ],
    build: { sourcemap: measuringCoverage },
    // Disable hot-reload wrappers only during coverage so counters describe app code.
    server: { port: 3000, strictPort: true, proxy, hmr: measuringCoverage ? false : undefined },
    preview: { proxy },
  }
})
