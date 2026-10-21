import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { missingWorkshopMapping, workshopProxy } from './config/workshopProxy'

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')
  const proxy = workshopProxy(environment)
  return {
    plugins: [react(), missingWorkshopMapping(environment)],
    server: { port: 3000, strictPort: true, proxy },
    preview: { proxy },
  }
})
