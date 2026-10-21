import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  outputDir: process.env.E2E_OUTPUT_DIR || '/tmp/coding-workshop-e2e-results',
  reporter: 'list',
  use: {
    actionTimeout: 10000,
    navigationTimeout: 20000,
    baseURL: 'http://localhost:3011',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
          args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--use-gl=angle',
            '--use-angle=swiftshader',
          ],
        }
      : {},
  },
  webServer: {
    command: 'npm run dev -- --host localhost --port 3011',
    url: 'http://localhost:3011',
    reuseExistingServer: false,
    env: {
      VITE_API_MODE: process.env.E2E_API_MODE || 'direct',
      VITE_API_URL:
        process.env.E2E_API_MODE === 'workshop'
          ? 'http://localhost:3001'
          : process.env.E2E_API_URL || 'http://localhost:8000',
      VITE_API_ENDPOINTS: JSON.stringify({
        facilities: process.env.E2E_API_URL || 'http://localhost:8000',
      }),
    },
  },
})
