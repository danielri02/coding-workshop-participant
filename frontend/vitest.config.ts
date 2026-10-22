import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/generated/**', 'src/types.ts', 'src/vite-env.d.ts'],
      reportsDirectory: 'coverage/unit',
      reporter: ['text', 'html', 'json', 'json-summary', 'lcov'],
    },
  },
})
