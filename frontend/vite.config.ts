import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { applicationEnvironment, publicEnvironmentDefinitions } from './config/environment'
import { missingWorkshopMapping, workshopProxy } from './config/workshopProxy'

export default defineConfig(() => {
  const environment = applicationEnvironment()
  const proxy = workshopProxy(environment)
  return {
    // Disable Vite's independent env loading; expose only the shared public allowlist.
    envDir: false as const,
    envPrefix: [],
    define: publicEnvironmentDefinitions(environment),
    plugins: [react(), missingWorkshopMapping(environment)],
    server: { port: 3000, strictPort: true, proxy },
    preview: { proxy },
  }
})
